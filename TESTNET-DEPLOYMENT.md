# Jeju L2 Testnet Deployment

Live testnet deployed on OP Stack, connected to Sepolia L1.

## Network Info

| Field | Value |
|-------|-------|
| Chain ID | `420690` (`0x66b32`) |
| L1 | Sepolia (`11155111`) |
| RPC | `https://jeju-testnet.fartbag.fun/` |
| WebSocket | `wss://jeju-testnet.fartbag.fun/ws` |
| Bundler (ERC-4337) | `https://jeju-testnet.fartbag.fun/bundler` |
| Block Time | 2 seconds |
| Fork Level | Isthmus + Jovian (all forks at genesis) |

## Add to Wallet

```json
{
  "chainId": "0x66b32",
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

### Core Contracts (Redeployed Feb 21 2026 with chain ID 420690)

| Contract | Address |
|----------|---------|
| ELIZAOS Token | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| IdentityRegistry | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| ComputeRegistry | `0xa82ff9afd8f496c3d6ac40e2a0f282e47488cfc9` |
| FeeConfig | `0x1613beb3b2c4f22ee086b2b38c1476a3ce7f78e8` |
| DAORegistry | `0x851356ae760d987e095750cceb3bc6014560891c` |
| DAOFunding | `0xf5059a5d33d5853360d16c683c16e67980206f36` |

### JNS (Jeju Name Service)

| Contract | Address |
|----------|---------|
| JNSRegistry | `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512` |
| JNSResolver | `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0` |
| JNSRegistrar | `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9` |
| JNSReverseRegistrar | `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9` |

### DWS (Decentralized Web Services)

| Contract | Address |
|----------|---------|
| StorageManager | `0x3Aa5ebB10DC797CAC828524e59A333d0A371443c` |
| WorkerRegistry | `0xc6e7DF5E7b4f2A278906862b61205850344D4e7d` |
| CDNRegistry | `0x59b670e9fA9D0A427751Af201D676719a970857b` |
| RepoRegistry | `0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1` |
| PackageRegistry | `0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44` |

### ERC-4337 Account Abstraction

| Contract | Address |
|----------|---------|
| EntryPoint v0.7 (canonical) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |

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
- **EntryPoint v0.9 uses EIP-712 typed data hash** — incompatible with Alto bundler's v0.7 hash computation. UserOps must be submitted via direct `handleOps` calls, not through the bundler's `eth_sendUserOperation` RPC. The bundler can still be used for v0.7 EntryPoint operations.
- SimpleAccount v0.9 `_validateSignature` uses `ECDSA.recover(userOpHash, signature)` without `toEthSignedMessageHash()` — sign with `account.sign({ hash })` not `account.signMessage()`


