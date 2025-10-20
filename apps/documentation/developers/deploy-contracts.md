# Deploy Contracts

Guide to deploying smart contracts on Jeju.

## Quick Deploy

### Localnet

```bash
cd contracts

# Deploy with Foundry
forge script script/Deploy.s.sol \
  --broadcast \
  --rpc-url http://localhost:9545 \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

### Testnet

```bash
forge script script/Deploy.s.sol \
  --broadcast \
  --rpc-url https://testnet-rpc.jeju.network \
  --private-key $TESTNET_PRIVATE_KEY \
  --verify
```

### Mainnet

```bash
forge script script/Deploy.s.sol \
  --broadcast \
  --rpc-url https://rpc.jeju.network \
  --private-key $MAINNET_PRIVATE_KEY \
  --verify
```

## Deployment Scripts

### Core System

```bash
# Deploy liquidity system (paymaster, vault, distributor)
forge script script/DeployLiquiditySystem.s.sol --broadcast

# Deploy node operator rewards
forge script script/DeployRewards.s.sol --broadcast

# Deploy oracle system
forge script script/DeployCrossChainOracle.s.sol --broadcast
```

### Using TypeScript

```typescript
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('https://rpc.jeju.network');
const wallet = new ethers.Wallet(privateKey, provider);

// Deploy contract
const factory = new ethers.ContractFactory(abi, bytecode, wallet);
const contract = await factory.deploy(...args);
await contract.waitForDeployment();

console.log('Deployed to:', await contract.getAddress());
```

## Verification

### On Block Explorer

```bash
forge verify-contract \
  --chain-id 420691 \
  --compiler-version v0.8.28 \
  $CONTRACT_ADDRESS \
  src/YourContract.sol:YourContract
```

## Best Practices

1. **Test on localnet first**
2. **Then deploy to testnet**  
3. **Verify contracts**
4. **Test interactions**
5. **Finally deploy to mainnet**

## Resources

- [Quick Start](./quick-start.md)
- [Local Development](./local-development.md)
- [Contract Addresses](/contracts)

