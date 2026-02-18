# Jeju Network L2 Contract Deployment Guide

This document outlines the contracts that need to be deployed on the Jeju L2 network and their deployment order.

## Current Deployment Status

### Localnet (Chain ID: 31337)
See `deployments/localnet/deployment.json` for currently deployed addresses.

**Deployed:**
- Core infrastructure: `serviceRegistry`, `identityRegistry`
- DWS: `cdnRegistry`, `workerRegistry`, `storageManager`
- JNS: `registry`, `resolver`, `registrar`, `reverseRegistrar`
- Crucible: `agentVault`, `roomRegistry`, `triggerRegistry`
- Bazaar: `predictionMarket`, `predictionOracle`

**Missing (needs deployment):**
- Tokens: `jeju`, `usdc`
- Paymaster system: `tokenRegistry`, `paymasterFactory`, `multiTokenPaymaster`
- Node staking: `nodeStakingManager`, `autoSlasher`, `multiOracleConsensus`
- Moderation: `banManager`, `reputationLabelManager`
- DeFi: `liquidityVault`, `feeDistributor`

## Deployment Phases

### Phase 1: Foundation (No Dependencies)
Deploy these first as they have no contract dependencies.

| Contract | File | Purpose |
|----------|------|---------|
| `PriceOracle` | `src/oracle/PriceOracle.sol` | Token price feeds for USD valuations |
| `IdentityRegistry` | `src/registry/IdentityRegistry.sol` | ERC-8004 agent identity system |
| `ServiceRegistry` | `src/services/ServiceRegistry.sol` | Service/provider registry |

### Phase 2: Moderation & Reputation
Depends on Phase 1 (IdentityRegistry).

| Contract | File | Dependencies |
|----------|------|--------------|
| `BanManager` | `src/moderation/BanManager.sol` | IdentityRegistry |
| `ReputationRegistry` | `src/registry/ReputationRegistry.sol` | IdentityRegistry |
| `ValidationRegistry` | `src/registry/ValidationRegistry.sol` | IdentityRegistry |
| `ReputationLabelManager` | `src/moderation/ReputationLabelManager.sol` | BanManager |

### Phase 3: Tokens
Deploy token contracts.

| Contract | File | Dependencies |
|----------|------|--------------|
| `NetworkUSDC` | `src/tokens/NetworkUSDC.sol` | None |
| `Token (JEJU)` | `src/tokens/Token.sol` | BanManager |

After deploying tokens, configure prices in PriceOracle:
```solidity
priceOracle.setPrice(usdcAddress, 1e18);  // $1
priceOracle.setPrice(jejuAddress, tokenPriceInUSD);
```

### Phase 4: Payment Infrastructure
Depends on Phase 1-3.

| Contract | File | Dependencies |
|----------|------|--------------|
| `TokenRegistry` | `src/paymaster/TokenRegistry.sol` | Owner only |
| `PaymasterFactory` | `src/paymaster/PaymasterFactory.sol` | TokenRegistry, EntryPoint, PriceOracle |
| `MultiTokenPaymaster` | `src/services/MultiTokenPaymaster.sol` | EntryPoint, tokens |
| `CreditManager` | `src/services/CreditManager.sol` | USDC, JEJU tokens |

Configuration:
```solidity
// Register supported tokens
tokenRegistry.registerToken(usdcAddress, "USDC", 6);
tokenRegistry.registerToken(jejuAddress, "JEJU", 18);

// Deploy per-token paymasters
paymasterFactory.deployPaymaster(usdcAddress);
paymasterFactory.deployPaymaster(jejuAddress);
```

### Phase 5: Node Staking (Critical for L2)
Enables node operators to register and stake.

| Contract | File | Dependencies |
|----------|------|--------------|
| `NodeStakingManager` | `src/staking/NodeStakingManager.sol` | TokenRegistry, PaymasterFactory, PriceOracle |
| `DelegatedNodeStaking` | `src/staking/DelegatedNodeStaking.sol` | NodeStakingManager |
| `AutoSlasher` | `src/staking/AutoSlasher.sol` | NodeStakingManager |
| `MultiOracleConsensus` | `src/staking/MultiOracleConsensus.sol` | Owner |

NodeStakingManager configuration:
```solidity
NodeStakingManager staking = new NodeStakingManager(
    tokenRegistry,
    paymasterFactory,
    priceOracle,
    performanceOracle,  // MultiOracleConsensus or trusted address
    owner
);

// Configure parameters
staking.setMinStakeUSD(1000 ether);      // Minimum $1000 stake
staking.setPaymasterFees(500, 200);      // 5% reward cut, 2% stake cut
staking.setIdentityRegistry(identityRegistry);
```

### Phase 6: DWS Services
Decentralized Web Services infrastructure.

| Contract | File | Purpose |
|----------|------|---------|
| `JNSRegistry` | `src/names/JNSRegistry.sol` | .jeju name service |
| `JNSResolver` | `src/names/JNSResolver.sol` | Name resolution |
| `StorageManager` | `src/storage/StorageManager.sol` | IPFS/Arweave coordination |
| `WorkerRegistry` | `src/compute/WorkerRegistry.sol` | Serverless workers |
| `CDNRegistry` | `src/cdn/CDNRegistry.sol` | Edge node management |
| `VPNRegistry` | `src/vpn/VPNRegistry.sol` | VPN node coordination |

### Phase 7: Cross-Chain (OIF & EIL)
Open Intents Framework and Ethereum Interop Layer.

| Contract | File | Purpose |
|----------|------|---------|
| `SolverRegistry` | `src/oif/SolverRegistry.sol` | Cross-chain solver coordination |
| `InputSettler` | `src/oif/InputSettler.sol` | Intent input settlement |
| `OutputSettler` | `src/oif/OutputSettler.sol` | Intent output settlement |
| `L1StakeManager` | `src/bridge/eil/L1StakeManager.sol` | L1 stake coordination |

### Phase 8: X402 (Gasless Payments)
HTTP 402 payment integration.

| Contract | File | Purpose |
|----------|------|---------|
| `X402Facilitator` | `src/x402/X402Facilitator.sol` | Gasless payment routing |
| `X402IntentBridge` | `src/x402/X402IntentBridge.sol` | Intent-based payment bridging |

## Deployment Scripts

Available scripts in `script/`:

| Script | Purpose |
|--------|---------|
| `Deploy.s.sol` | Master deployment (Phases 1-4) |
| `DeployDWS.s.sol` | DWS services |
| `DeployOIFLocalnet.s.sol` | OIF contracts |
| `DeployProofOfCloud.s.sol` | Cloud computing |
| `DeployX402.s.sol` | X402 payment layer |

### Running Deployments

```bash
# Set environment
export PRIVATE_KEY=0x...
export RPC_URL=http://localhost:9545

# Deploy core infrastructure
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast

# Deploy DWS
forge script script/DeployDWS.s.sol:DeployDWS --rpc-url $RPC_URL --broadcast

# Deploy with verification (testnet/mainnet)
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --verify
```

## Key Contract Addresses

### Standard Addresses (All Networks)
- EntryPoint (ERC-4337 v0.7): `0x0000000071727De22E5E9d8BAf0edAc6f37da032`
- WETH (L2 precompile): `0x4200000000000000000000000000000000000006`

### L2 Bridge Precompiles
- L2CrossDomainMessenger: `0x4200000000000000000000000000000000000007`
- L2StandardBridge: `0x4200000000000000000000000000000000000010`
- L2ToL1MessagePasser: `0x4200000000000000000000000000000000000016`

## Notes

- All staking contracts support multi-token staking (JEJU, USDC, etc.)
- Paymaster enables gasless transactions for registered tokens
- Node registration requires minimum stake (configurable, default $1000 USD equivalent)
- Performance-based rewards and slashing are automated via oracle consensus

## Token Integration

### Paymaster-Based Gas Abstraction

The Jeju L2 uses **ERC-4337 Paymasters** for gas abstraction. Users can pay for gas using **$ELIZAOS**, **JEJU**, or **USDC** tokens instead of ETH.

#### How It Works

1. **TreasuryPaymaster** (`packages/auth/src/paymaster/treasury-paymaster.ts`):
   - Sponsors user transactions from a treasury contract
   - Uses MPC signing via SecureSigningService
   - Policy-based limits (max gas per tx, daily limits per user)

2. **MultiTokenPaymaster** (`packages/contracts/src/services/MultiTokenPaymaster.sol`):
   - Supports ELIZAOS, JEJU, USDC, ETH payments
   - Credit-based system with prepaid balances
   - Fast path: Deduct from prepaid credits (instant)
   - Slow path: Include token transfer in UserOp (top-up)

#### User Experience

- Users DON'T need native ETH for gas
- They can pay with ELIZAOS, JEJU, or USDC
- Or get sponsored via treasury paymaster (for whitelisted operations)

### Multi-Token Paymaster

The `MultiTokenPaymaster` contract (`src/services/MultiTokenPaymaster.sol`) provides ERC-4337 sponsored transactions with:

- **JEJU**: Native network token with ban enforcement
- **USDC**: Stable payments via NetworkUSDC (EIP-3009)
- **ETH/WETH**: Standard ETH payments

**Payment Flow:**
1. **Fast Path** (prepaid credits): User has balance in CreditManager → instant sponsorship
2. **Slow Path** (initial/top-up): User includes token transfer in UserOp → overpayment credited

**Fee Distribution:**
- 45% to app developers
- 45% to liquidity providers
- 10% to contributors

### Token Configuration

```solidity
// Register tokens in TokenRegistry
tokenRegistry.registerToken(elizaosAddress, "ELIZAOS", 18);
tokenRegistry.registerToken(usdcAddress, "USDC", 6);
tokenRegistry.registerToken(jejuAddress, "JEJU", 18);

// Set prices in PriceOracle
priceOracle.setPrice(elizaosAddress, 0.0001 ether);  // Example price
priceOracle.setPrice(usdcAddress, 1 ether);          // $1
priceOracle.setPrice(jejuAddress, tokenPriceInUSD);
```
