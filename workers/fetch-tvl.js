import pkg from '@cosmjs/cosmwasm-stargate';
const { CosmWasmClient } = pkg;
import fetch from 'node-fetch';

const main = async () => {
  try {
    console.log("Connecting to Neutron...");
    const client = await CosmWasmClient.connect("https://neutron-rpc.polkachu.com");
    const contractAddress = "neutron13w6sagl4clacx4c8drhuwfl20cesn3pnllhf37e65ls8zwf6gcgq93t2lp";

    // Query total locked tokens
    console.log("Querying total locked tokens...");
    const totalLockedTokensResponse = await client.queryContractSmart(contractAddress, {
      total_locked_tokens: {}
    });
    
    // Send data to your Next.js API
    const response = await fetch('http://localhost:3000/api/tvl', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ tvl: totalLockedTokensResponse.total_locked_tokens })
    });

    if (response.ok) {
      console.log("\nTotal Locked Tokens:", totalLockedTokensResponse.total_locked_tokens);
      console.log("Data successfully sent to API");
    } else {
      console.error("Failed to update API:", await response.text());
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