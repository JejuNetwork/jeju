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

### Tokens

| Contract | Address |
|----------|---------|
| JEJU/ELIZAOS Token | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| NetworkUSDC | `0x7A9Ec1d04904907De0ED7b6839CcdD59c3716AC9` |

### Core Registry & Infrastructure (Redeployed Feb 21 2026 with chain ID 420690)

| Contract | Address |
|----------|---------|
| IdentityRegistry | `0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6` |
| ReputationRegistry | `0xC9a43158891282A2B1475592D5719c001986Aaec` |
| ValidationRegistry | `0x1c85638e118b37167e9298c2268758e058DdfDA0` |
| ComputeRegistry | `0xa82ff9afd8f496c3d6ac40e2a0f282e47488cfc9` |
| PriceOracle | `0xfbC22278A96299D91d41C453234d97b4F5Eb9B2d` |
| ServiceRegistry | `0x46b142DD1E924FAb83eCc3c08e4D46E82f005e0E` |
| FeeConfig | `0x1613beb3b2c4f22ee086b2b38c1476a3ce7f78e8` |
| DAORegistry | `0x851356ae760d987e095750cceb3bc6014560891c` |
| DAOFunding | `0xf5059a5d33d5853360d16c683c16e67980206f36` |

### Moderation

| Contract | Address |
|----------|---------|
| BanManager | `0x367761085BF3C12e5DA2Df99AC6E1a824612b8fb` |
| ReputationLabelManager | `0x4C2F7092C2aE51D986bEFEe378e50BD4dB99C901` |
| UserBlockRegistry | `0xD5ac451B0c50B9476107823Af206eD814a2e2580` |

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
| EntryPoint v0.7 (jeju-l2 lib) | `0x0E801D84Fa97b50751Dbf25036d067dCf18858bF` |
| EntryPoint v0.9 (main repo) | `0x4826533b4897376654bb4d4ad88b7fafd0c98528` |
| EntryPoint v0.7 (canonical) | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| SimpleAccountFactory | `0x9d4454B023096f34B160D6B654540c56A1F81688` |

### Paymaster Stack

| Contract | Address |
|----------|---------|
| ManualPriceOracle | `0x99bbA657f2BbC93c02D617f8bA121cB8Fc104Acf` |
| LiquidityPaymaster | `0x8f86403A4DE0BB5791fa46B8e795C547942fE4Cf` |
| CreditManager | `0x49fd2BE640DB2910c2fAb69bB8531Ab6E76127ff` |
| TokenRegistry | `0x4631BCAbD6dF18D94796344963cB60d44a4136b6` |

**Paymaster Configuration:**
- Token: JEJU/ELIZAOS (`0x5FbDB...`)
- Fee margin: 5% (500 basis points)
- Oracle prices: ETH=$2500, JEJU/ELIZAOS=$1
- EntryPoint deposit: 1 ETH

### Governance (Timelocks)

| Contract | Address |
|----------|---------|
| StandardTimelock (2 day) | `0x5067457698Fd6Fa1C6964e416b3f42713513B3dD` |
| CriticalTimelock (7 day) | `0x18E317A7D70d8fBf8e6E893616b52390EbBdb629` |
| EmergencyTimelock (6 hour) | `0x4b6aB5F819A515382B0dEB6935D793817bB4af28` |
| GovernanceTimelock | `0x276C216D241856199A83bf27b2286659e5b877D3` |

### OIF (Open Intents Framework)

| Contract | Address |
|----------|---------|
| SolverRegistry | `0x86A2EE8FAf9A840F7a2c64CA3d51209F9A02081D` |
| SimpleOracle | `0xA4899D35897033b927acFCf422bc745916139776` |
| InputSettler | `0xf953b3A269d80e3eB0F2947630Da976B896A8C5b` |
| OutputSettler | `0xAA292E8611aDF267e563f334Ee42320aC96D0463` |

### EIL (Ethereum Interop Layer)

| Contract | Address |
|----------|---------|
| L1StakeManager | `0x5c74c94173F05dA1720953407cbb920F3DF9f887` |

### X402 (Gasless Payments)

| Contract | Address |
|----------|---------|
| X402Facilitator | `0x720472c8ce72c2A2D711333e064ABD3E6BbEAdd3` |
| X402IntentBridge | `0xe8D2A1E88c91DCd5433208d4152Cc4F399a7e91d` |

### Federation

| Contract | Address |
|----------|---------|
| NetworkRegistry | `0xc0F115A19107322cFBf1cDBC7ea011C19EbDB4F8` |
| RegistryHub | `0xc96304e3c037f81dA488ed9dEa1D8F2a48278a75` |
| RegistrySyncOracle | `0x34B40BA116d5Dec75548a9e9A8f15411461E8c70` |
| SolanaVerifier | `0xA7c59f010700930003b33aB25a7a0679C860f29c` |
| FederatedIdentity | `0xD0141E899a65C95a556fE2B27e5982A6DE7fDD7A` |
| FederatedLiquidity | `0x07882Ae1ecB7429a84f1D53048d35c4bB2056877` |
| FederatedSolver | `0x22753E4264FDDc6181dc7cce468904A80a363E44` |

### Decentralization

| Contract | Address |
|----------|---------|
| SequencerRegistry | `0xfaAddC93baf78e89DCf37bA67943E1bE8F37Bb8c` |
| ThresholdBatchSubmitter | `0x3347B4d90ebe72BeFb30444C9966B2B990aE9FcB` |
| DisputeGameFactory (L2) | `0x3155755b79aA083bd953911C92705B7aA82a18F9` |
| ForcedInclusion | `0x5bf5b11053e734690269C6B9D438F8C9d48F528A` |
| OptimismPortalAdapter | `0xffa7CA1AEEEbBc30C874d32C7e22F052BbEa0429` |
| L2OutputOracleAdapter | `0x3aAde2dCD2Df6a8cAc689EE797591b2913658659` |

### Other Registries

| Contract | Address |
|----------|---------|
| AppFeeRegistry | `0xCace1b78160AE76398F486c8a18044da0d66d86D` |
| SQLitIdentityRegistry | `0xF8e31cb472bc70500f08Cd84917E5A1912Ec8397` |

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
- `Deploy.s.sol` - Core infrastructure (PriceOracle, ServiceRegistry, Registries, Moderation, OIF, EIL, X402)

## Services

| Service | Port | Endpoint |
|---------|------|----------|
| op-geth (RPC) | 9545 | `https://jeju-testnet.fartbag.fun/` |
| op-geth (WS) | 9546 | `wss://jeju-testnet.fartbag.fun/ws` |
| op-node | 7545 | internal |
| op-batcher | 6545 | internal |
| Alto Bundler | 4337 | `https://jeju-testnet.fartbag.fun/bundler` |

## E2E Paymaster Test

The paymaster system has been verified end-to-end. Users can pay gas with JEJU/ELIZAOS tokens:

```bash
# Run the e2e test
export DEPLOYER_PRIVATE_KEY=0x...
node packages/contracts/scripts/e2e-paymaster-elizaos.mjs
```

**Verified flow:**
1. Deploy smart wallet via EntryPoint + SimpleAccountFactory
2. Approve JEJU/ELIZAOS tokens to LiquidityPaymaster
3. Send paymaster-sponsored transaction (gas paid in JEJU/ELIZAOS, no ETH needed)

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
- **MultiTokenPaymaster and CrossChainPaymaster** cannot deploy with canonical EntryPoint v0.7 (ERC165 interface mismatch). Use EntryPoint v0.9 (`0x4826533b...`) for these contracts. CrossChainPaymaster also exceeds max code size.
- **PaymasterFactory** fails to compile when LiquidityPaymaster.sol is in the same project (BasePaymaster constructor arg count mismatch between v0.7 and v0.9 libs)


