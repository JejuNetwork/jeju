# Contract Deployment

Deploy and verify smart contracts across networks.

## Quick Reference

```bash
cd packages/contracts

# Localnet
forge script script/DeployLocalnet.s.sol \
  --rpc-url http://127.0.0.1:9545 \
  --broadcast

# Testnet
PRIVATE_KEY=$KEY forge script script/DeployTestnet.s.sol \
  --rpc-url https://testnet-rpc.jeju.network \
  --broadcast --verify

# Mainnet (via Safe)
forge script script/DeployMainnet.s.sol \
  --rpc-url https://rpc.jeju.network \
  --slow
# Then submit to multi-sig
```

## Deployment Scripts

### Available Scripts

**DeployLocalnet.s.sol** deploys all contracts for local development. **DeployTestnet.s.sol** performs full testnet deployment with verification. **DeployMainnet.s.sol** handles production deployment via multi-sig.

For specific systems: **DeployOIF.s.sol** deploys the Open Intents Framework contracts. **DeployEIL.s.sol** deploys the Ethereum Interop Layer. **DeployMultiTokenSystem.s.sol** deploys the paymaster system. **DeployIdentityRegistry.s.sol** deploys ERC-8004 identity contracts. **DeployTokens.s.sol** deploys token contracts. **DeployJNS.s.sol** deploys the name service.

### Script Pattern

```solidity
// script/DeployMyContract.s.sol
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MyContract.sol";

contract DeployMyContract is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerKey);
        
        MyContract mc = new MyContract(arg1, arg2);
        console.log("MyContract deployed:", address(mc));
        
        vm.stopBroadcast();
    }
}
```

## Deploy Individual Contracts

### Using Forge Create

```bash
forge create src/MyContract.sol:MyContract \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  --constructor-args arg1 arg2
```

### Using Scripts

```bash
forge script script/DeployMyContract.s.sol \
  --rpc-url $RPC_URL \
  --broadcast
```

### With Verification

```bash
forge script script/DeployMyContract.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $ETHERSCAN_API_KEY
```

## Verification

### Automatic (During Deploy)

```bash
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --verify
```

### Manual

```bash
forge verify-contract $ADDRESS src/MyContract.sol:MyContract \
  --chain-id 420691 \
  --etherscan-api-key $ETHERSCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,uint256)" $arg1 $arg2)
```

### With Libraries

```bash
forge verify-contract $ADDRESS src/MyContract.sol:MyContract \
  --chain-id 420691 \
  --libraries src/lib/MyLib.sol:MyLib:$LIB_ADDRESS
```

## Upgradeable Contracts

### UUPS Pattern

```solidity
// Implementation
contract MyContractV1 is UUPSUpgradeable {
    function initialize(address admin) external initializer {
        __UUPSUpgradeable_init();
        _admin = admin;
    }
    
    function _authorizeUpgrade(address) internal override onlyAdmin {}
}

// Deploy
contract DeployUpgradeable is Script {
    function run() external {
        vm.startBroadcast();
        
        // Deploy implementation
        MyContractV1 impl = new MyContractV1();
        
        // Deploy proxy
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeCall(MyContractV1.initialize, admin)
        );
        
        vm.stopBroadcast();
    }
}
```

### Upgrade

```bash
forge script script/UpgradeMyContract.s.sol \
  --rpc-url $RPC_URL \
  --broadcast
```

## Multi-Network Deployment

### Deploy to Multiple Chains

```bash
# Create deployment script
# script/DeployMultiChain.s.sol

# Run for each chain
for network in sepolia baseSepolia arbitrumSepolia; do
  forge script script/DeployMultiChain.s.sol \
    --rpc-url $(jq -r ".$network.rpcUrl" packages/config/contracts.json) \
    --broadcast --verify
done
```

### Cross-Chain OIF

```bash
# Deploy InputSettler on source chains
forge script script/DeployOIF.s.sol:DeployInput \
  --rpc-url https://sepolia.base.org \
  --broadcast --verify

# Deploy OutputSettler on Jeju
forge script script/DeployOIF.s.sol:DeployOutput \
  --rpc-url https://rpc.jeju.network \
  --broadcast --verify
```

## Update Configuration

After deployment, update config files:

```bash
# 1. Update contracts.json
vim packages/config/contracts.json

# 2. Rebuild config package
cd packages/config && bun run build

# 3. Commit changes
git add packages/config/contracts.json
git commit -m "chore: update contract addresses for testnet"
```

## Deployment Records

Deployment records are saved in `packages/contracts/broadcast/`:

```
broadcast/
├── DeployOIF.s.sol/
│   ├── 420690/           # Testnet
│   │   ├── run-latest.json
│   │   └── run-1234567890.json
│   └── 420691/           # Mainnet
│       └── run-latest.json
```

## Gas Optimization

### Estimate Gas

```bash
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --gas-estimate
```

### Optimize Deployment

```bash
# Build with optimizer
forge build --optimize --optimizer-runs 200

# Deploy with gas price control
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --gas-price 20gwei \
  --priority-gas-price 1gwei
```

## Troubleshooting

### Transaction Stuck

```bash
# Speed up with higher gas
forge script script/Deploy.s.sol \
  --rpc-url $RPC_URL \
  --broadcast \
  --gas-price 50gwei \
  --resume
```

### Verification Failed

```bash
# Check source matches
forge verify-check $GUID --chain-id 420691

# Flatten and verify manually
forge flatten src/MyContract.sol > flat.sol
# Then verify via explorer UI
```

### Out of Gas

```bash
# Increase gas limit
forge script script/Deploy.s.sol \
  --gas-limit 10000000
```

