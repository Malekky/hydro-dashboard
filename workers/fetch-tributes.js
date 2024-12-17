import pkg from '@cosmjs/cosmwasm-stargate';
const { CosmWasmClient } = pkg;
import fetch from 'node-fetch';

const tokenData = {
    'ibc/B559A80D62249C8AA07A380E2A2BEA6E5CA9A6F079C912C3A9E9B494105E4F81': { ticker: 'USDC', price: 1.0 },
    'ibc/837E876EAB64260D5174BE8171B2889113757A8724258A855D6F8D92EDF41E9A': { ticker: 'SWTH', price: 0.002375 },
    'ibc/B6643B477C69060B125279D9FF69EC20189E4D15DC24CF0457E0BAA9DD1A26AE': { ticker: 'SHD', price: 2.59 },
    'ibc/6C9E6701AC217C0FC7D74B0F7A6265B9B4E3C3CDA6E80AADE5F950A8F52F9972': { ticker: 'NLS', price: 0.01253 },
    'factory/neutron1ndu2wvkrxtane8se2tr48gv7nsm46y5gcqjhux/MARS': { ticker: 'MARS', price: 0.03481 },
    'ibc/3552CECB7BCE1891DB6070D37EC6E954C972B1400141308FCD85FD148BD06DE5': { ticker: 'STRD', price: 0.6984 },
    'untrn': { ticker: 'NTRN', price: 0.5484 }
};

const getTokenData = (denom) => tokenData[denom] || { ticker: denom, price: 0 };

const calculateUSDValue = (amount, denom) => {
    const { ticker, price } = getTokenData(denom);
    let tokenAmount = Number(amount) / 1_000_000;
    
    if (ticker === 'SHD' || ticker === 'SWTH') {
        tokenAmount = tokenAmount / 100;
    }
    
    return tokenAmount * price;
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

const main = async () => {
    try {
        console.log("Connecting to Neutron...");
        const client = await CosmWasmClient.connect("https://neutron-rpc.polkachu.com");
        const hydroContractAddress = "neutron13w6sagl4clacx4c8drhuwfl20cesn3pnllhf37e65ls8zwf6gcgq93t2lp";
        const tributeContractAddress = "neutron1zy38lczkv82c6kkv5rccpnlltjtaz5cl4wc79mwgrtchtwdsc72skwe58t";
        const trancheId = 1;

        const proposalsByTitle = new Map();
        const proposalsByProposer = new Map();
        const individualTributes = [];
        const groupedTributes = new Map();

        // First, get all proposals and map them by title and proposer
        for (const roundId of [0, 1]) {
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
                    const title = proposal.title;
                    const standardizedProposer = standardizeProposerName(proposal.proposer, proposal.title);

                    // Map by title for tribute calculations
                    if (!proposalsByTitle.has(title)) {
                        proposalsByTitle.set(title, {
                            ids: [],
                            rounds: {
                                0: new Map(),
                                1: new Map()
                            },
                            total: new Map()
                        });
                    }
                    proposalsByTitle.get(title).ids.push(proposal.proposal_id);

                    // Map by proposer for project data
                    if (!proposalsByProposer.has(standardizedProposer)) {
                        proposalsByProposer.set(standardizedProposer, {
                            ids: [],
                            total: new Map()
                        });
                    }
                    proposalsByProposer.get(standardizedProposer).ids.push(proposal.proposal_id);
                });
            }
        }

        let grandTotalUSD = 0;

        // Collect tribute data
        for (const roundId of [0, 1]) {
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

                        const title = proposalResponse.proposal.title;
                        const standardizedProposer = standardizeProposerName(proposalResponse.proposal.proposer, title);
                        
                        // Update title-based data
                        const titleData = proposalsByTitle.get(title);
                        if (titleData) {
                            const roundAmount = titleData.rounds[roundId].get(tribute.funds.denom) || 0n;
                            titleData.rounds[roundId].set(tribute.funds.denom, roundAmount + BigInt(tribute.funds.amount));
                            
                            const totalAmount = titleData.total.get(tribute.funds.denom) || 0n;
                            titleData.total.set(tribute.funds.denom, totalAmount + BigInt(tribute.funds.amount));

                            const usdValue = calculateUSDValue(tribute.funds.amount, tribute.funds.denom);
                            individualTributes.push({
                                roundId,
                                usdValue,
                                amount: tribute.funds.amount,
                                denom: tribute.funds.denom
                            });
                        }

                        // Update proposer-based data
                        const proposerData = proposalsByProposer.get(standardizedProposer);
                        if (proposerData) {
                            const totalAmount = proposerData.total.get(tribute.funds.denom) || 0n;
                            proposerData.total.set(tribute.funds.denom, totalAmount + BigInt(tribute.funds.amount));
                        }
                    }
                }
            }
        }

        // Calculate project-specific data
        const projectTributes = Array.from(proposalsByProposer.entries())
            .map(([name, data]) => {
                let value = 0;
                data.total.forEach((amount, denom) => {
                    value += calculateUSDValue(amount, denom);
                });
                
                return {
                    name,
                    value,
                    color: getProjectColor(name)
                };
            })
            .filter(project => project.value > 0)
            .sort((a, b) => b.value - a.value);

        // Calculate total metrics
        grandTotalUSD = projectTributes.reduce((sum, project) => sum + project.value, 0);
        const nonZeroTributes = individualTributes.filter(t => t.usdValue > 0);

        const metrics = {
            totalTributes: grandTotalUSD,
            lowestTribute: nonZeroTributes.length > 0 ? Math.min(...nonZeroTributes.map(t => t.usdValue)) : null,
            averageTribute: nonZeroTributes.length > 0 ? nonZeroTributes.reduce((sum, t) => sum + t.usdValue, 0) / nonZeroTributes.length : null,
            highestTribute: Math.max(...Array.from(groupedTributes.values())),
            projectTributes: projectTributes
        };

        // Send metrics to API
        const response = await fetch('http://localhost:3000/api/tributes', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(metrics)
        });

        if (response.ok) {
            console.log("Tribute metrics successfully updated:", metrics);
        } else {
            console.error("Failed to update tribute metrics:", await response.text());
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