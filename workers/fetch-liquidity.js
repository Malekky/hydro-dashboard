import pkg from '@cosmjs/cosmwasm-stargate';
const { CosmWasmClient } = pkg;
import fetch from 'node-fetch';

const main = async () => {
  try {
    console.log("Connecting to Neutron...");
    const client = await CosmWasmClient.connect("https://neutron-rpc.polkachu.com");
    const contractAddress = "neutron13w6sagl4clacx4c8drhuwfl20cesn3pnllhf37e65ls8zwf6gcgq93t2lp";

    console.log("Querying liquidity deployments...");
    const liquidityDeploymentsResponse = await client.queryContractSmart(contractAddress, {
      round_tranche_liquidity_deployments: {
        round_id: 0,
        tranche_id: 1,
        start_from: 0,
        limit: 10
      }
    });

    if (liquidityDeploymentsResponse && liquidityDeploymentsResponse.liquidity_deployments) {
      const totalDeployed = liquidityDeploymentsResponse.liquidity_deployments.reduce((acc, deployment) => {
        if (deployment.deployed_funds && deployment.deployed_funds[0]) {
          return acc + BigInt(deployment.deployed_funds[0].amount);
        }
        return acc;
      }, 0n);

      const totalDeployedNumber = Number(totalDeployed);
      
      const response = await fetch('http://localhost:3000/api/liquidity', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ liquidity: totalDeployedNumber })
      });

      if (response.ok) {
        console.log("\nTotal Deployed Funds (ATOM):", totalDeployedNumber / 1_000_000);
        console.log("Data successfully sent to API");
      } else {
        console.error("Failed to update API:", await response.text());
      }
    }
  } catch (error) {
    console.error("\nError:", error.message);
    if (error.stack) {
      console.error("\nStack trace:", error.stack);
    }
  }
};

main();
setInterval(main, 43200000);

console.log("Script started at:", new Date().toLocaleString());
console.log("Set to query and update API every 12 hours");