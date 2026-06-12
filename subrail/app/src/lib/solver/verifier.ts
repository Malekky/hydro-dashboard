import type { GiftPurchaseAttestation } from './intent';

/**
 * Verifier abstraction (docs/04-solver-market.md §Settlement). A solver's raw purchase
 * artifacts (claude.ai order page / receipt email / TEE-captured session) are turned into a
 * bound GiftPurchaseAttestation by one of several backends — swappable behind this
 * interface so v1 can ship TEE capture (Peer-style) and migrate to zkTLS/zkEmail without
 * touching the escrow or app flow.
 */

export type VerifierKind = 'tee' | 'zktls' | 'zkemail';

export interface VerificationResult {
  ok: boolean;
  attestation?: GiftPurchaseAttestation;
  /** EIP-712 / Groth16 calldata the on-chain escrow's verifier consumes. */
  onchainProof?: `0x${string}`;
  error?: string;
}

export interface PurchaseVerifier {
  kind: VerifierKind;
  /**
   * Turn captured solver-side purchase artifacts into a bound, on-chain-checkable proof.
   * `capture` is opaque here: the TEE backend takes the Peer-extension session bundle, the
   * zkTLS backend a Reclaim/Primus proof, the zkEmail backend a raw .eml.
   */
  verify(capture: unknown): Promise<VerificationResult>;
}

/**
 * v1 backend: TEE attestation of the solver's captured claude.ai session — the zkp2p V3
 * pattern (our attester validates the capture, emits an EIP-712 attestation a Base verifier
 * consumes). Single-operator for now; disclosed; paired with the optimistic bond+window.
 * Wired once we have a captured claude.ai order artifact (the $20 unknown in §04).
 */
export class TeePurchaseVerifier implements PurchaseVerifier {
  kind = 'tee' as const;
  constructor(private readonly opts: { attestationServiceUrl: string }) {}
  async verify(): Promise<VerificationResult> {
    void this.opts;
    return { ok: false, error: 'not implemented: capture a real claude.ai order artifact first (docs/04-solver-market.md)' };
  }
}
