# Developer Quick Start

Start building on Jeju in minutes. This guide assumes you have basic Ethereum development experience.

## Prerequisites

- Node.js or Bun installed
- Foundry (Anvil + Forge)
- MetaMask or another web3 wallet
- Basic Solidity knowledge

## 1. Get Testnet ETH

### Option A: Faucet (Recommended)

Visit https://faucet.jeju.network and request testnet ETH.

### Option B: Bridge from Sepolia

1. Get Sepolia ETH: https://www.alchemy.com/faucets/ethereum-sepolia
2. Bridge to Base Sepolia: https://superbridge.app
3. Bridge to Jeju Testnet: https://testnet-bridge.jeju.network

### Option C: Request in Discord

For larger amounts, ask in [#testnet-faucet](https://discord.gg/jeju).

## 2. Configure Network

### Add Jeju Testnet to MetaMask

```
Network Name: Jeju Testnet
RPC URL: https://testnet-rpc.jeju.network
Chain ID: 420690
Currency Symbol: ETH
Block Explorer: https://testnet-explorer.jeju.network
```

Or use [chainlist.org/chain/420690](https://chainlist.org/chain/420690) for one-click setup.

## 3. Deploy Your First Contract

### Using Foundry (Recommended)

```bash
# Create new project
forge init my-jeju-project
cd my-jeju-project

# Write a simple contract
cat > src/Counter.sol << 'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract Counter {
    uint256 public count;
    
    function increment() public {
        count++;
    }
    
    function getCount() public view returns (uint256) {
        return count;
    }
}
EOF

# Deploy to Jeju Testnet
forge create src/Counter.sol:Counter \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $PRIVATE_KEY

# Deployed to: 0x... (save this address)
```

### Using Foundry with Forge Script

```bash
# Create new project (already initialized with Foundry)
cd my-jeju-project

# Write a deployment script
cat > script/Deploy.s.sol << 'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/Counter.sol";

contract DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerPrivateKey);

        Counter counter = new Counter();
        
        vm.stopBroadcast();
    }
}
EOF

# Deploy to Jeju Testnet
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast \
  --verify
```

## 4. Interact with Contract

### Using Cast (Foundry)

```bash
# Read count
cast call $CONTRACT_ADDRESS "getCount()" \
  --rpc-url https://testnet-rpc.jeju.network

# Increment
cast send $CONTRACT_ADDRESS "increment()" \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $PRIVATE_KEY

# View on explorer
open https://testnet-explorer.jeju.network/address/$CONTRACT_ADDRESS
```

### Using Ethers.js

```typescript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider(
  'https://testnet-rpc.jeju.network'
);

const signer = new ethers.Wallet(privateKey, provider);

const counter = new ethers.Contract(
  contractAddress,
  ['function increment()', 'function getCount() view returns (uint256)'],
  signer
);

// Read
const count = await counter.getCount();
console.log('Count:', count);

// Write
const tx = await counter.increment();
await tx.wait();
console.log('Incremented!');
```

### Using Viem

```typescript
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { jejuTestnet } from './chains';

const account = privateKeyToAccount(`0x${privateKey}`);

const publicClient = createPublicClient({
  chain: jejuTestnet,
  transport: http(),
});

const walletClient = createWalletClient({
  account,
  chain: jejuTestnet,
  transport: http(),
});

// Read
const count = await publicClient.readContract({
  address: contractAddress,
  abi: counterABI,
  functionName: 'getCount',
});

// Write
const hash = await walletClient.writeContract({
  address: contractAddress,
  abi: counterABI,
  functionName: 'increment',
});

await publicClient.waitForTransactionReceipt({ hash });
```

## 5. Build a dApp Frontend

### Next.js + Wagmi

```bash
# Create Next.js app
npx create-next-app@latest my-jeju-dapp --typescript --tailwind --app
cd my-jeju-dapp

# Install dependencies
npm install wagmi viem @tanstack/react-query

# Configure chains
cat > src/chains.ts << 'EOF'
import { defineChain } from 'viem';

export const jejuTestnet = defineChain({
  id: 420690,
  name: 'Jeju Testnet',
  network: 'jeju-testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testnet-rpc.jeju.network'] },
  },
  blockExplorers: {
    default: { name: 'Explorer', url: 'https://testnet-explorer.jeju.network' },
  },
  testnet: true,
});
EOF

# Configure Wagmi
cat > src/wagmi.ts << 'EOF'
import { configureChains, createConfig } from 'wagmi';
import { publicProvider } from 'wagmi/providers/public';
import { MetaMaskConnector } from 'wagmi/connectors/metaMask';
import { jejuTestnet } from './chains';

const { chains, publicClient } = configureChains(
  [jejuTestnet],
  [publicProvider()]
);

export const config = createConfig({
  autoConnect: true,
  connectors: [new MetaMaskConnector({ chains })],
  publicClient,
});

export { chains };
EOF

# Create a component
mkdir -p src/components
cat > src/components/Counter.tsx << 'EOF'
'use client';

import { useContractRead, useContractWrite } from 'wagmi';

const contractAddress = 'YOUR_CONTRACT_ADDRESS';
const abi = [
  'function getCount() view returns (uint256)',
  'function increment()',
];

export function Counter() {
  const { data: count } = useContractRead({
    address: contractAddress,
    abi,
    functionName: 'getCount',
  });

  const { write: increment } = useContractWrite({
    address: contractAddress,
    abi,
    functionName: 'increment',
  });

  return (
    <div>
      <p>Count: {count?.toString()}</p>
      <button onClick={() => increment()}>Increment</button>
    </div>
  );
}
EOF

# Run dev server
npm run dev
```

## 6. Test Your dApp

### Local Testing

```bash
# Start local Jeju network
bun run localnet:start

# Update RPC URL to localhost
# http://127.0.0.1:9545

# Deploy and test locally
forge create ... --rpc-url http://127.0.0.1:9545
```

### Testnet Testing

1. Deploy to Jeju Testnet
2. Test all functionality
3. Get feedback from community
4. Fix bugs
5. Prepare for mainnet

## 7. Deploy to Mainnet

Once thoroughly tested:

```bash
# Deploy to Jeju Mainnet
forge create src/Counter.sol:Counter \
  --rpc-url https://rpc.jeju.network \
  --private-key $MAINNET_PRIVATE_KEY \
  --verify

# Update frontend to use mainnet
# RPC: https://rpc.jeju.network
# Chain ID: 420691
```

## Example Projects

### Example Code

Example contracts and integrations are available in the main repository. Check the repository for:
- Foundry contract templates
- Frontend integration examples
- DeFi protocol integrations
- Testing examples

## Resources

### Tools

- **Block Explorer**: https://testnet-explorer.jeju.network
- **Faucet**: https://faucet.jeju.network
- **Bridge**: https://testnet-bridge.jeju.network
- **RPC**: https://testnet-rpc.jeju.network

### Documentation

- [Network Information](/network/testnet)
- [Contract Addresses](/contracts)
- [DeFi Protocols](/developers/defi-protocols)
- [API Reference](/developers/rpc-methods)

### Community

- **Discord**: [discord.gg/jeju](https://discord.gg/jeju)
- **GitHub**: [github.com/elizaos/jeju](https://github.com/elizaos/jeju)
- **Twitter**: [@jejunetwork](https://twitter.com/jejunetwork)

## Next Steps

- [**Local Development**](./local-development) - Deep dive into development
- [**Deploy Contracts**](./deploy-contracts) - Advanced deployment
- [**DeFi Integration**](./defi-protocols) - Use DeFi protocols
- [**Run an RPC Node**](/developers/run-rpc-node) - Operate your own infrastructure

## Need Help?

- Ask in [Discord #dev-support](https://discord.gg/jeju)
- Check [FAQs](/support)
- Read [full documentation](/)

