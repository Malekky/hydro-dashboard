// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal escrow for the solver market (docs/04-solver-market.md).
/// A user locks USDC + a payload {plan, months, recipientEmailHash, expiry}; a solver
/// fulfills by gifting the sub and submitting a bound purchase attestation (verified by a
/// swappable IPurchaseVerifier); on success the USDC is released to the solver. If no
/// solver fulfills by `expiry`, the user refunds.
///
/// Proof is SOLVER-SIDE on purpose: the party owed the escrow (already paid Anthropic) is
/// the prover, so a silent counterparty cannot strand them — mirrors zkp2p's taker proof.
///
/// Not audited; reference implementation. Fork of the Base-native escrow pattern (zkp2p's
/// verifier registry is multisig-permissioned, so we run our own).

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

/// @dev Returns the bound attestation fields iff `proof` is valid for `intentHash`.
interface IPurchaseVerifier {
    function verify(bytes32 intentHash, bytes calldata proof)
        external
        returns (
            bytes32 recipientEmailHash,
            uint8 planRank,
            uint16 months,
            bytes32 orderNullifier,
            uint64 purchasedAt
        );
}

contract GiftIntentEscrow {
    enum State { None, Open, Fulfilled, Refunded }

    struct Intent {
        address user;
        uint256 lockedUsdc;
        bytes32 recipientEmailHash;
        uint8 planRank;       // 0 pro, 1 max5x, 2 max20x
        uint16 months;
        uint64 openedAt;
        uint64 expiry;
        State state;
    }

    IERC20 public immutable usdc;
    IPurchaseVerifier public verifier;
    address public owner;

    mapping(bytes32 => Intent) public intents;       // intentId => Intent
    mapping(bytes32 => bool) public usedNullifiers;  // each real purchase unlocks ≤1 escrow

    event IntentOpened(bytes32 indexed id, address indexed user, uint8 planRank, uint16 months, uint256 lockedUsdc, uint64 expiry);
    event IntentFulfilled(bytes32 indexed id, address indexed solver, bytes32 orderNullifier);
    event IntentRefunded(bytes32 indexed id, address indexed user);
    event VerifierUpdated(address verifier);

    error NotOwner();
    error BadState();
    error NotUser();
    error NotExpired();
    error Expired();
    error NullifierUsed();
    error BindingFailed();

    constructor(address _usdc, address _verifier) {
        usdc = IERC20(_usdc);
        verifier = IPurchaseVerifier(_verifier);
        owner = msg.sender;
    }

    function setVerifier(address _verifier) external {
        if (msg.sender != owner) revert NotOwner();
        verifier = IPurchaseVerifier(_verifier);
        emit VerifierUpdated(_verifier);
    }

    /// @notice User locks USDC for a gift order. `id` is a client-chosen unique salt.
    function open(
        bytes32 id,
        uint256 lockedUsdc,
        bytes32 recipientEmailHash,
        uint8 planRank,
        uint16 months,
        uint64 expiry
    ) external {
        if (intents[id].state != State.None) revert BadState();
        if (expiry <= block.timestamp) revert Expired();
        usdc.transferFrom(msg.sender, address(this), lockedUsdc);
        intents[id] = Intent({
            user: msg.sender,
            lockedUsdc: lockedUsdc,
            recipientEmailHash: recipientEmailHash,
            planRank: planRank,
            months: months,
            openedAt: uint64(block.timestamp),
            expiry: expiry,
            state: State.Open
        });
        emit IntentOpened(id, msg.sender, planRank, months, lockedUsdc, expiry);
    }

    /// @notice Solver submits a purchase proof; on valid binding, USDC releases to them.
    function fulfill(bytes32 id, bytes calldata proof) external {
        Intent storage it = intents[id];
        if (it.state != State.Open) revert BadState();
        if (block.timestamp > it.expiry) revert Expired();

        bytes32 intentHash = keccak256(
            abi.encode(it.recipientEmailHash, it.planRank, it.months, it.openedAt)
        );
        (
            bytes32 emailHash,
            uint8 planRank,
            uint16 months,
            bytes32 nullifier,
            uint64 purchasedAt
        ) = verifier.verify(intentHash, proof);

        // Binding (mirrors lib/solver/intent.ts checkBinding):
        if (emailHash != it.recipientEmailHash) revert BindingFailed();
        if (planRank < it.planRank) revert BindingFailed();
        if (months < it.months) revert BindingFailed();
        if (purchasedAt + 600 < it.openedAt) revert BindingFailed(); // freshness w/ skew
        if (usedNullifiers[nullifier]) revert NullifierUsed();

        usedNullifiers[nullifier] = true;
        it.state = State.Fulfilled;
        usdc.transfer(msg.sender, it.lockedUsdc);
        emit IntentFulfilled(id, msg.sender, nullifier);
    }

    /// @notice After expiry with no fulfillment, the user reclaims their USDC.
    function refund(bytes32 id) external {
        Intent storage it = intents[id];
        if (it.state != State.Open) revert BadState();
        if (msg.sender != it.user) revert NotUser();
        if (block.timestamp <= it.expiry) revert NotExpired();
        it.state = State.Refunded;
        usdc.transfer(it.user, it.lockedUsdc);
        emit IntentRefunded(id, it.user);
    }
}
