# Tutorial: Gasless NFT Drop

Build an NFT collection where users mint for free (you pay the gas).

**Time:** 30 minutes  
**Level:** Beginner  
**You'll Learn:**
- Deploy ERC-721 contract
- Create sponsored paymaster
- Build mint UI with wagmi

## What We're Building

A simple NFT collection where:
1. Users connect wallet
2. Click "Mint"
3. Receive NFT (no gas required)
4. You (the app) pay all gas costs

## Prerequisites

- [Jeju running locally](/build/quick-start)
- Basic Solidity and React knowledge

## Step 1: Create Project

```bash
mkdir gasless-nft && cd gasless-nft

# Initialize
bun init -y
bun add viem wagmi @tanstack/react-query

# Foundry for contracts
forge init contracts --no-git
cd contracts
forge install OpenZeppelin/openzeppelin-contracts
```

## Step 2: Write the NFT Contract

```solidity
// contracts/src/GaslessNFT.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GaslessNFT is ERC721, Ownable {
    uint256 private _tokenIdCounter;
    uint256 public constant MAX_SUPPLY = 1000;
    string private _baseTokenURI;

    constructor(string memory baseURI) 
        ERC721("Gasless NFT", "GNFT") 
        Ownable(msg.sender) 
    {
        _baseTokenURI = baseURI;
    }

    function mint(address to) external returns (uint256) {
        require(_tokenIdCounter < MAX_SUPPLY, "Max supply reached");
        
        uint256 tokenId = _tokenIdCounter++;
        _safeMint(to, tokenId);
        
        return tokenId;
    }

    function totalMinted() external view returns (uint256) {
        return _tokenIdCounter;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
```

## Step 3: Deploy Contract

```bash
# In contracts directory
forge script script/Deploy.s.sol:DeployGaslessNFT \
  --rpc-url http://127.0.0.1:9545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --broadcast
```

Create the deploy script:

```solidity
// contracts/script/Deploy.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/GaslessNFT.sol";

contract DeployGaslessNFT is Script {
    function run() external {
        vm.startBroadcast();
        
        GaslessNFT nft = new GaslessNFT("ipfs://your-base-uri/");
        console.log("GaslessNFT deployed:", address(nft));
        
        vm.stopBroadcast();
    }
}
```

Save the deployed address:

```bash
export NFT_ADDRESS=0x... # From deploy output
```

## Step 4: Create Sponsored Paymaster

Now we create a paymaster that pays for all mints:

```typescript
// scripts/create-paymaster.ts
import { createWalletClient, http, parseEther } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { jeju } from './chains';

const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
const client = createWalletClient({
  account,
  chain: jeju,
  transport: http('http://127.0.0.1:9545'),
});

async function main() {
  const PAYMASTER_FACTORY = '0x...'; // From Jeju deployment
  const NFT_ADDRESS = process.env.NFT_ADDRESS;

  // Create sponsored paymaster
  const hash = await client.writeContract({
    address: PAYMASTER_FACTORY,
    abi: PaymasterFactoryAbi,
    functionName: 'createSponsoredPaymaster',
    args: [
      account.address,  // Sponsor (you)
      [NFT_ADDRESS],    // Contracts to sponsor
    ],
  });

  console.log('Created paymaster:', hash);

  // Get paymaster address
  const paymaster = await client.readContract({
    address: PAYMASTER_FACTORY,
    abi: PaymasterFactoryAbi,
    functionName: 'getPaymaster',
    args: [account.address],
  });

  console.log('Paymaster address:', paymaster);

  // Deposit ETH to fund gas
  await client.writeContract({
    address: paymaster,
    abi: SponsoredPaymasterAbi,
    functionName: 'deposit',
    value: parseEther('1'), // Deposit 1 ETH
  });

  console.log('Deposited 1 ETH to paymaster');
}

main();
```

## Step 5: Build the Frontend

```tsx
// src/App.tsx
import { useState } from 'react';
import { useAccount, useConnect, useWriteContract } from 'wagmi';
import { injected } from 'wagmi/connectors';

const NFT_ADDRESS = '0x...';
const PAYMASTER_ADDRESS = '0x...';

export function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect();
  const [minting, setMinting] = useState(false);
  const [tokenId, setTokenId] = useState<number | null>(null);

  const { writeContract } = useWriteContract();

  async function handleMint() {
    if (!address) return;
    
    setMinting(true);
    try {
      const hash = await writeContract({
        address: NFT_ADDRESS,
        abi: GaslessNFTAbi,
        functionName: 'mint',
        args: [address],
        // This is the magic - paymaster pays gas
        paymaster: PAYMASTER_ADDRESS,
      });
      
      console.log('Minted! TX:', hash);
      // In real app, wait for receipt and parse tokenId
      setTokenId(Date.now()); // Placeholder
    } catch (e) {
      console.error('Mint failed:', e);
    } finally {
      setMinting(false);
    }
  }

  return (
    <div className="app">
      <h1>Gasless NFT</h1>
      <p>Mint an NFT for free. We pay the gas!</p>

      {!isConnected ? (
        <button onClick={() => connect({ connector: injected() })}>
          Connect Wallet
        </button>
      ) : (
        <div>
          <p>Connected: {address}</p>
          
          {tokenId ? (
            <div className="success">
              🎉 Minted NFT #{tokenId}
            </div>
          ) : (
            <button onClick={handleMint} disabled={minting}>
              {minting ? 'Minting...' : 'Mint NFT (Free!)'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

## Step 6: Configure wagmi

```typescript
// src/wagmi.ts
import { createConfig, http } from 'wagmi';
import { defineChain } from 'viem';

export const jejuLocalnet = defineChain({
  id: 1337,
  name: 'Jeju Localnet',
  network: 'jeju-localnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:9545'] },
  },
});

export const config = createConfig({
  chains: [jejuLocalnet],
  transports: {
    [jejuLocalnet.id]: http(),
  },
});
```

## Step 7: Test It

```bash
# Start frontend
bun run dev

# Open http://localhost:5173
# 1. Connect MetaMask (add Jeju Localnet network)
# 2. Click "Mint NFT"
# 3. Confirm transaction (no gas cost!)
# 4. See your NFT
```

## Step 8: Deploy to Testnet

```bash
# Deploy contract to testnet
forge script script/Deploy.s.sol:DeployGaslessNFT \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $DEPLOYER_KEY \
  --broadcast --verify

# Create paymaster on testnet
NETWORK=testnet bun run scripts/create-paymaster.ts

# Update frontend config and deploy
```

## How It Works

```
User clicks Mint
       ↓
Wallet builds UserOperation
       ↓
UserOp includes paymaster address
       ↓
Bundler submits to EntryPoint
       ↓
EntryPoint checks with Paymaster:
  "Will you pay for this?"
       ↓
Paymaster checks:
  - Is NFT contract in whitelist? ✓
  - Do I have ETH deposited? ✓
  → "Yes, I'll pay"
       ↓
NFT mints to user
       ↓
Gas deducted from Paymaster deposit
       ↓
User pays: $0
```

## Cost Estimation

| Item | Cost |
|------|------|
| Contract deployment | ~$0.50 |
| Paymaster creation | ~$0.05 |
| Per-mint gas | ~$0.001 |
| 1000 mints | ~$1.00 |

With 1 ETH deposited, you can sponsor ~100,000 mints.

## Next Steps

- Add metadata and images to IPFS
- Implement max mint per wallet
- Add reveal mechanics
- Build gallery page

## Full Code

See complete example: [github.com/elizaos/jeju-examples/gasless-nft](https://github.com/elizaos/jeju-examples/gasless-nft)

