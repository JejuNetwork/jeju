# Agent Task: Tutorials Documentation

## Scope
Create step-by-step tutorials for common use cases.

## Tutorials to Write

1. Deploy a gasless NFT collection
2. Build a trading agent
3. Create an x402 paid API
4. Register a custom token
5. Build a cross-chain swap interface

## Output Files

### 1. `apps/documentation/tutorials/overview.md`

```markdown
# Tutorials

Step-by-step guides for building on Jeju.

## Beginner

### [Gasless NFT Collection](/tutorials/gasless-nft)
Deploy an NFT collection where users mint without paying gas.

### [Register a Token](/tutorials/register-token)
Add your token to the paymaster for gas payments.

## Intermediate

### [Trading Agent](/tutorials/trading-agent)
Build an autonomous trading agent with ERC-8004 identity.

### [x402 Paid API](/tutorials/x402-api)
Monetize your API with pay-per-request using x402.

## Advanced

### [Cross-Chain Swap UI](/tutorials/cross-chain-swap)
Build a frontend for cross-chain token swaps via OIF.

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/tutorials/gasless-nft.md`

```markdown
# Gasless NFT Collection

Deploy an NFT where users mint without paying gas.

## What You'll Build

An NFT collection where:
- Users connect wallet
- Click "Mint"
- NFT is minted with no gas payment required
- You (the deployer) sponsor the gas

## Prerequisites

- Bun installed
- Foundry installed
- Testnet ETH

## Step 1: Create NFT Contract

\`\`\`solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GaslessNFT is ERC721, Ownable {
    uint256 public nextTokenId;
    
    constructor() ERC721("Gasless NFT", "GNFT") Ownable(msg.sender) {}
    
    function mint(address to) external {
        _mint(to, nextTokenId++);
    }
}
\`\`\`

## Step 2: Deploy Contract

\`\`\`bash
forge create src/GaslessNFT.sol:GaslessNFT \
  --rpc-url https://testnet-rpc.jejunetwork.org \
  --private-key $PRIVATE_KEY
\`\`\`

## Step 3: Set Up Paymaster

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({
  network: 'testnet',
  privateKey: process.env.PRIVATE_KEY,
});

// Deposit to sponsor gas
await client.payments.depositToPaymaster({
  amount: parseEther('1'),
});

// Whitelist your contract
await client.payments.whitelistContract({
  contract: NFT_ADDRESS,
});
\`\`\`

## Step 4: Build Frontend

\`\`\`typescript
const mintGasless = async () => {
  const tx = await client.payments.sponsoredCall({
    to: NFT_ADDRESS,
    data: encodeFunctionData({
      abi: GaslessNFTAbi,
      functionName: 'mint',
      args: [userAddress],
    }),
  });
  
  console.log('Minted:', tx.hash);
};
\`\`\`

## Full Code

See `apps/example-app/gasless-nft` for the complete example.

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/tutorials/trading-agent.md`

```markdown
# Build a Trading Agent

Create an autonomous trading agent with on-chain identity.

## What You'll Build

An agent that:
- Registers on-chain via ERC-8004
- Monitors token prices
- Executes trades based on strategy
- Exposes A2A endpoint for commands

## Prerequisites

- Bun installed
- Basic TypeScript knowledge
- Testnet ETH + tokens

## Step 1: Set Up Project

\`\`\`bash
mkdir trading-agent && cd trading-agent
bun init
bun add @jejunetwork/sdk
\`\`\`

## Step 2: Register Agent

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({
  network: 'testnet',
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

await client.identity.registerAgent({
  name: 'My Trading Bot',
  description: 'Automated trading on Bazaar',
  endpoints: {
    a2a: 'https://my-bot.example.com/a2a',
  },
  labels: ['trading', 'defi'],
});
\`\`\`

## Step 3: Implement Strategy

\`\`\`typescript
const executeStrategy = async () => {
  const price = await client.defi.getPrice('JEJU', 'USDC');
  
  if (price < 0.95) {
    await client.defi.swap({
      tokenIn: 'USDC',
      tokenOut: 'JEJU',
      amountIn: parseUnits('100', 6),
      minAmountOut: parseEther('100'),
    });
  }
};

// Run every minute
setInterval(executeStrategy, 60000);
\`\`\`

## Step 4: Add A2A Endpoint

\`\`\`typescript
const server = client.a2a.createServer({
  port: 4200,
  handlers: {
    get_status: async () => ({
      balance: await client.getBalance(),
      positions: await getPositions(),
    }),
    execute_trade: async ({ tokenIn, tokenOut, amount }) => {
      return await client.defi.swap({ tokenIn, tokenOut, amountIn: amount });
    },
  },
});

await server.start();
\`\`\`

## Step 5: Deploy

[Deployment instructions]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/tutorials.md`

