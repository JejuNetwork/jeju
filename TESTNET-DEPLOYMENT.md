# Jeju L2 Testnet Deployment

Live testnet deployed on OP Stack, connected to Sepolia L1.

## Network Info

| Field | Value |
|-------|-------|
| Chain ID | `2151908` (`0x20d5e4`) |
| L1 | Sepolia (`11155111`) |
| RPC | `https://jeju-testnet.fartbag.fun/` |
| WebSocket | `wss://jeju-testnet.fartbag.fun/ws` |
| Bundler (ERC-4337) | `https://jeju-testnet.fartbag.fun/bundler` |
| Block Time | 2 seconds |
| Fork Level | Isthmus + Jovian (all forks at genesis) |

## Add to Wallet

```json
{
  "chainId": "0x20d5e4",
  "chainName": "Jeju Testnet",
  "rpcUrls": ["https://jeju-testnet.fartbag.fun/"],
  "nativeCurrency": { "name": "Ether", "symbol": "ETH", "decimals": 18 }
}
```

## L1 Contracts (Sepolia)

| Contract | Address |
|----------|---------|
| DisputeGameFactory | `0xFb746754bAc2D52bf488C5f470a078eD693643d3` |
| L1CrossDomainMessenger | `0x0B01d94FcB444660df4699DD7C379a20875E3c36` |
| OptimismPortal2 | `0x9d484A3c375E5faAEe6202fc0622342E128b6326` |
| SystemConfig | `0xF1D47AF01ea6C17f7E8F3Ad2edee603ab8b189eB` |

## L2 Core Contracts

### Deploy.s.sol (Main Deployment)

| Contract | Address |
|----------|---------|
| PriceOracle | `0xB224F7607215139130Ea79111358C1908E69F30e` |
| ServiceRegistry | `0x1096dF0E910ea8abE5A5AfD448f2C355f4c92eFf` |
| IdentityRegistry | `0xd2013Cad96d6f5ca25C0cB1e55A373EA30529369` |
| ReputationRegistry | `0x6cfc5F9b0e5fe29470778b018aAaEb014281Ea19` |
| ValidationRegistry | `0x2962566C122941412a8E30BEaa62b235f88F912f` |
| BanManager | `0xE4aBFd2e67240dFfFA8433E04dF094F3B5206272` |
| ReputationLabelManager | `0xFc86aecCf568E966C404387037195eEe2F97f51D` |
| NetworkUSDC | `0x432FeA762270DD4f209A14f7d5e7c4eF92075E3C` |
| JEJU Token | `0x897b37eD9B92fA39a96044515a0d91690EAA30BB` |
| CreditManager | `0x3E145f1C100EcBf6CeaA02E1D4cea8A936063b38` |
| TokenRegistry | `0x57954230bF80B09Fa54d65CcAdaAc02f44f79E45` |
| PaymasterFactory | `0x6694b781852A94f885927B114704B83B4222fC21` |
| MultiTokenPaymaster | `0x0C349D357a006Ae32aF7cd56479384F740D74003` |
| SolverRegistry | `0x4E5cAcEdc21C554B16748d1DbDb3bA414F8e4181` |
| SimpleOracle (OIF) | `0x20a227891403Ca3A2cFCA9D24B5fc8c5d8Eaa3D5` |
| InputSettler | `0x517a57f43C34ABB3A49DE4aEfcc84250F3063712` |
| OutputSettler | `0x879D7f7097ab4A506083bd43Be777deC316Ff46f` |
| L1StakeManager | `0x22C41fAeb5b70E61c56c04FdB0CD880eBd971AD5` |
| CrossChainPaymaster | `0xb62A9DE44C64b354Ceb9CE1e53443EE24CBCb4dc` |
| X402Facilitator | `0x6a52B358f39Bd117b063D63cedc9b016B9F2831e` |
| X402IntentBridge | `0x12FE1fB20900337C295C85AF671A88bc7548e08c` |

### ERC-4337 Account Abstraction

| Contract | Address |
|----------|---------|
| EntryPoint v0.7 (canonical) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| EntryPoint v0.9 | `0x3eb934d56d14fa073ef859c13a7ab9c5f8eeb948` |
| SimpleAccountFactory (v0.9) | `0x58A55Dc97a3bBA3CD16d927e3Ed5b3c90F8E1A4c` |

### Paymaster Stack

| Contract | Address |
|----------|---------|
| ELIZAOS Token | `0x8332E76E40805aC9B06f3B11c1F415D608F66Db3` |
| LiquidityPaymaster | `0xA539885c451072af0BcA62f570B8AD296823830A` |
| PriceOracle (Paymaster) | `0x47C9B4Bb4680163CFf384B184aCC1d12eF75295a` |

**Paymaster Configuration:**
- Token: ELIZAOS (`0x8332...`)
- Fee margin: 5% (500 basis points)
- Oracle prices: ETH=$2500, ELIZAOS=$1
- EntryPoint deposit: 0.2 ETH

### Additional Deployments

All contracts from the following deploy scripts have been deployed:
- `DeployDWS` - JNS Registry, Resolver, Registrar, Storage, Worker/CDN/Repo/Package registries
- `DeployGovernance` - Standard/Critical/Emergency Timelocks
- `DeployComputeAll` - LedgerManager, InferenceServing
- `DeployTraining` - ComputeRegistry, MPCKeyRegistry, TrainingCoordinator/Rewards/Registry, NodePerformanceOracle
- `DeployDA` - DAOperatorRegistry, DABlobRegistry, DAAttestationManager
- `DeployLiquidity` - Liquidity contracts
- `DeployContentRegistry` - Content registration
- `DeployCommerce` - Commerce contracts
- `DeployDecentralizedRPC` - Decentralized RPC
- `DeployAppFeeRegistry` - App fee management
- `DeployDAORegistry` - DAO registry
- `DeployBoardGovernance` - Board governance
- `DeployCrucible` - Crucible contracts
- `DeployProofOfCloud` - Proof of Cloud
- `DeploySQLitRegistry` - SQLit registry
- `DeployDWSMarketplace` - DWS marketplace
- `DeployGitPkg` - Git package registry
- `DeployFederation` - Federation contracts
- `DeployELIZAOS` - ElizaOS integration
- `DeployTEE` - TEE contracts
- `DeployDecentralization` - Decentralization contracts
- `DeployX402` - X402 payment
- `DeployUserBlockRegistry` - User block registry

## Services

| Service | Port | Endpoint |
|---------|------|----------|
| op-geth (RPC) | 9545 | `https://jeju-testnet.fartbag.fun/` |
| op-geth (WS) | 9546 | `wss://jeju-testnet.fartbag.fun/ws` |
| op-node | 7545 | internal |
| op-batcher | 6545 | internal |
| Alto Bundler | 4337 | `https://jeju-testnet.fartbag.fun/bundler` |

## E2E Paymaster Test

The paymaster system has been verified end-to-end. Users can pay gas with ELIZAOS tokens:

```bash
# Run the e2e test
export DEPLOYER_PRIVATE_KEY=0x...
node packages/contracts/scripts/e2e-paymaster-elizaos.mjs
```

**Verified flow:**
1. Deploy smart wallet via EntryPoint + SimpleAccountFactory
2. Approve ELIZAOS tokens to LiquidityPaymaster
3. Send paymaster-sponsored transaction (gas paid in ELIZAOS, no ETH needed)

## Infrastructure Notes

### OP Stack Components
- **op-geth**: Execution engine (Docker, x86_64 via QEMU on ARM64)
- **op-node**: Consensus/derivation from Sepolia L1
- **op-batcher**: Batch submission to Sepolia (with `--throttle.unsafe-da-bytes-lower-threshold=0`)
- **Alto Bundler**: Pimlico ERC-4337 bundler (native Node.js)

### Known Issues
- `--rollup.sequencerhttp` must NOT be set on the sequencer's op-geth (causes tx forwarding loop)
- BasePaymaster in account-abstraction v0.9 requires ERC165-compatible EntryPoint (not canonical v0.7)
- `forge create --constructor-args` must come AFTER `--private-key` ([foundry#770](https://github.com/foundry-rs/foundry/issues/770))
- ManualPriceOracle does not implement the IPriceOracle interface; use PriceOracle instead
