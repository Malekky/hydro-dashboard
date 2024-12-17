import pkg from '@cosmjs/cosmwasm-stargate';
const { CosmWasmClient } = pkg;
import fetch from 'node-fetch';

const getProjectColor = (projectName) => {
    const colorMap = {
        'Demex': '#8884d8',
        'Margined': '#82ca9d',
        'Neptune Finance': '#ffc658',
        'Drop': '#ff8042',
        'Shade Protocol': '#a4de6c',
        'Nolus': '#d0ed57',
        'White Whale': '#83a6ed',
        'Fenix Directive': '#8dd1e1',
        'Mars Protocol': '#82ca9d',
        'Stride': '#a4de6c',
        'Unknown Proposer': '#cccccc'
    };
    
    return colorMap[projectName] || '#cccccc';
};

const standardizeProposerName = (proposer, title) => {
    if (!proposer && !title) return 'Unknown Proposer';
    
    const searchText = `${proposer || ''} ${title || ''}`.toLowerCase();
    
    if (searchText.includes('demex')) return 'Demex';
    if (searchText.includes('margined')) return 'Margined';
    if (searchText.includes('neptune finance')) return 'Neptune Finance';
    if (searchText.includes('drop')) return 'Drop';
    if (searchText.includes('shade')) return 'Shade Protocol';
    if (searchText.includes('nolus')) return 'Nolus';
    if (searchText.includes('white whale')) return 'White Whale';
    if (searchText.includes('phoenix directive') || searchText.includes('fenix directive')) return 'Fenix Directive';
    if (searchText.includes('mars protocol')) return 'Mars Protocol';
    if (searchText.includes('stride')) return 'Stride';
    
    return 'Unknown Proposer';
};

const calculateUSDValue = (amount, denom) => {
    const tokenData = {
        'ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81': { ticker: 'USDC', price: 1.0 },
        'ibc/837E876EAB64260D5174BE8171B2889113757A8724258A855D6F8D92EDF41E9A': { ticker: 'SWTH', price: 0.002375 },
        'ibc/B6643B477C69060B125279D9FF69EC20189E4D15DC24CF0457E0BAA9DD1A26AE': { ticker: 'SHD', price: 2.59 },
        'ibc/6C9E6701AC217C0FC7D74B0F7A6265B9B4E3C3CDA6E80AADE5F950A8F52F9972': { ticker: 'NLS', price: 0.01253 },
        'factory/neutron1ndu2wvkrxtane8se2tr48gv7nsm46y5gcqjhux/MARS': { ticker: 'MARS', price: 0.03481 },
        'ibc/3552CECB7BCE1891DB6070D37EC6E954C972B1400141308FCD85FD148BD06DE5': { ticker: 'STRD', price: 0.6984 },
        'untrn': { ticker: 'NTRN', price: 0.5484 }
    };
    
    const { ticker, price } = tokenData[denom] || { ticker: denom, price: 0 };
    let tokenAmount = Number(amount) / 1_000_000;
    
    if (ticker === 'SHD' || ticker === 'SWTH') {
        tokenAmount = tokenAmount / 100;
    }
    
    return tokenAmount * price;
};

const main = async () => {
    try {
        console.log("Connecting to Neutron...");
        const client = await CosmWasmClient.connect("https://neutron-rpc.polkachu.com");
        const hydroContractAddress = "neutron13w6sagl4clacx4c8drhuwfl20cesn3pnllhf37e65ls8zwf6gcgq93t2lp";
        const tributeContractAddress = "neutron1zy38lczkv82c6kkv5rccpnlltjtaz5cl4wc79mwgrtchtwdsc72skwe58t";
        const trancheId = 1;

        const roundsData = [];

        // Process each round
        for (const roundId of [0, 1]) {
            // Track projects and their liquidity
            const liquidityByProposer = new Map();
            const proposalsByProposer = new Map();
            let roundLiquidityTotal = 0n;
            let roundTributeTotal = 0;

            // First, get all proposals to track participants
            const proposalsResponse = await client.queryContractSmart(hydroContractAddress, {
                round_proposals: {
                    round_id: roundId,
                    tranche_id: trancheId,
                    start_from: 0,
                    limit: 100
                }
            });

            if (proposalsResponse?.proposals) {
                proposalsResponse.proposals.forEach(proposal => {
                    const standardizedProposer = standardizeProposerName(proposal.proposer, proposal.title);
                    proposalsByProposer.set(standardizedProposer, true);
                });
            }

            // Collect tribute data
            const roundTributesResponse = await client.queryContractSmart(tributeContractAddress, {
                round_tributes: {
                    round_id: roundId,
                    start_from: 0,
                    limit: 100
                }
            });

            if (roundTributesResponse?.tributes) {
                for (const tribute of roundTributesResponse.tributes) {
                    if (!tribute.refunded) {
                        const proposalResponse = await client.queryContractSmart(hydroContractAddress, {
                            proposal: {
                                round_id: roundId,
                                tranche_id: trancheId,
                                proposal_id: tribute.proposal_id
                            }
                        });
                        roundTributeTotal += calculateUSDValue(tribute.funds.amount, tribute.funds.denom);
                    }
                }
            }

            // Collect liquidity deployment data
            const liquidityDeploymentsResponse = await client.queryContractSmart(hydroContractAddress, {
                round_tranche_liquidity_deployments: {
                    round_id: roundId,
                    tranche_id: trancheId,
                    start_from: 0,
                    limit: 100
                }
            });

            if (liquidityDeploymentsResponse?.liquidity_deployments) {
                for (const deployment of liquidityDeploymentsResponse.liquidity_deployments) {
                    if (deployment.deployed_funds && deployment.deployed_funds[0]) {
                        const amount = BigInt(deployment.deployed_funds[0].amount);
                        const proposalResponse = await client.queryContractSmart(hydroContractAddress, {
                            proposal: {
                                round_id: roundId,
                                tranche_id: trancheId,
                                proposal_id: deployment.proposal_id
                            }
                        });

                        const standardizedProposer = standardizeProposerName(
                            proposalResponse.proposal.proposer,
                            proposalResponse.proposal.title
                        );

                        const currentAmount = liquidityByProposer.get(standardizedProposer) || 0n;
                        liquidityByProposer.set(standardizedProposer, currentAmount + amount);
                        roundLiquidityTotal += amount;
                    }
                }
            }

            // Format liquidity distribution data for the tree map
            const liquidityWon = Array.from(liquidityByProposer.entries())
                .filter(([_, amount]) => amount > 0n)
                .map(([name, amount]) => ({
                    name,
                    value: Number(amount) / 1_000_000,
                    percentage: Number(amount * 100n / roundLiquidityTotal),
                    color: getProjectColor(name)
                }))
                .sort((a, b) => b.value - a.value);

            // Compile round data
            roundsData.push({
                round: roundId,
                trancheSize: Number(roundLiquidityTotal) / 1_000_000,
                tributesPaid: roundTributeTotal,
                projectsParticipated: proposalsByProposer.size,
                liquidityWon
            });
        }

        roundsData.forEach(roundData => {
            roundData.round += 1;  // Convert from 0-based to 1-based numbering
        });

        // Send data to API
        const response = await fetch('http://localhost:3000/api/rounds', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ rounds: roundsData })
        });

        if (response.ok) {
            console.log("Rounds data successfully updated:", roundsData);
        } else {
            console.error("Failed to update rounds data:", await response.text());
        }

    } catch (error) {
        console.error("\nError:", error.message);
        if (error.stack) {
            console.error("\nStack trace:", error.stack);
        }
    }
};

// Run immediately on start
main();

// Then run every 12 hours
setInterval(main, 43200000);

console.log("Script started at:", new Date().toLocaleString());
console.log("Set to query and update API every 12 hours");