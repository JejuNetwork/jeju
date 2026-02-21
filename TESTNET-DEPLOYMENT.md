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
| JEJU/ELIZAOS Token | `0x5FbDB2315678afecb367f032d93F642f64180aa3` |
| IdentityRegistry | `0x40918Ba7f132E0aCba2CE4de4c4baF9BD2D7D849` |
| ComputeRegistry | `0xa82ff9afd8f496c3d6ac40e2a0f282e47488cfc9` |
| FeeConfig | `0x1613beb3b2c4f22ee086b2b38c1476a3ce7f78e8` |
| DAORegistry | `0x851356ae760d987e095750cceb3bc6014560891c` |
| DAOFunding | `0xf5059a5d33d5853360d16c683c16e67980206f36` |
| NodeStakingManager | `0x638A246F0Ec8883eF68280293FFE8Cfbabe61B44` |
| PriceOracle | `0xfbC22278A96299D91d41C453234d97b4F5Eb9B2d` |

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
| MultiTokenPaymaster | `0x5fc748f1FEb28d7b76fa1c6B07D8ba2d5535177c` |
| PaymasterFactory | `0xB82008565FdC7e44609fA118A4a681E92581e680` |
| CrossChainPaymaster | `0x38a024C0b412B9d1db8BC398140D00F5Af3093D4` |
| CrossChainSwapRouter | `0x525C7063E7C20997BaaE9bDa922159152D0e8417` |

**Paymaster Configuration:**
- Token: JEJU/ELIZAOS (`0x5FbDB...`)
- Fee margin: 5% (500 basis points)
- Oracle prices: ETH=$2500, JEJU/ELIZAOS=$1
- EntryPoint deposit: 1 ETH

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

### IdentityRegistry Configuration

- **Governance**: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (deployer)
- **Supported Stake Tokens**: ETH (address(0)), ELIZAOS (`0x5FbDB...`)
- **Stake Tiers**: NONE (free), SMALL (1 ELIZAOS), MEDIUM (10 ELIZAOS), HIGH (100 ELIZAOS)

### Node Staking

| Contract | Address |
|----------|---------|
| NodeStakingManager | `0x638A246F0Ec8883eF68280293FFE8Cfbabe61B44` |
| PerformanceOracle | `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (deployer) |

**Dependencies (set up on deploy):**
- TokenRegistry (`0x4631...`): JEJU registered via `registerToken`
- PaymasterFactory (`0xB820...`): JEJU paymaster deployed via `deployPaymaster`
- PriceOracle (`0xfbC2...`): JEJU price set to $1 via `setPrice`

**Configuration:**
- Min stake: $1000 USD equivalent
- Max nodes per operator: 5
- Min staking period: 7 days
- Base reward: $100/month per node
- Geographic bonus: +50% for underserved regions (Africa, South America)
- Uptime threshold: 99%+ for full rewards

### Not Deployed

| Contract | Status |
|----------|--------|
| Agents Vault (`0x8464...`) | Not deployed |
| Agents RoomRegistry (`0x71C9...`) | Not deployed |
| Agents TriggerRegistry (`0x948B...`) | Not deployed |
| Cloud ServiceRegistry (`0xbCF2...`) | Not deployed |

## Services

| Service | Port | Endpoint |
|---------|------|----------|
| op-geth (RPC) | 9545 | `https://jeju-testnet.fartbag.fun/` |
| op-geth (WS) | 9546 | `wss://jeju-testnet.fartbag.fun/ws` |
| op-node | 7545 | internal |
| op-batcher | 6545 | internal |
| Alto Bundler | 4337 | `https://jeju-testnet.fartbag.fun/bundler` |
| PoW Faucet | 8088 | `https://jeju-testnet.fartbag.fun/faucet/` |
| Gateway API | 4013 | `https://jeju-testnet.fartbag.fun/gateway/` |
| Faucet API | 4014 | `https://jeju-testnet.fartbag.fun/gateway/api/faucet/` |
| DWS Console | 4030 | `http://52.206.203.24/` (AWS) |
| OAuth3 | 4200 | `http://52.206.203.24:4200/` (AWS, proxied via DWS) |

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

## Gateway Portal

The gateway web UI is live at `https://jeju-testnet.fartbag.fun/gateway/` with the following features:

- **Browse**: View registered agents from the IdentityRegistry (reads directly from contract)
- **Registry**: Register new agents with JEJU token staking (ERC-8004)
- **Faucet**: Claim 100 JEJU tokens per 12h cooldown (requires agent registration). Gas grants available for unregistered users
- **Nodes**: Register DWS/compute nodes with token staking, view performance metrics

### Faucet API

Standalone faucet server running on port 4014, proxied via nginx at `/gateway/api/faucet/`.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/faucet/info` | GET | Faucet configuration and requirements |
| `/api/faucet/status/:address` | GET | Eligibility, cooldown, balance for an address |
| `/api/faucet/claim` | POST | Claim JEJU tokens (body: `{ address }`) |
| `/api/faucet/gas-grant` | POST | Claim gas ETH for registration (body: `{ address }`) |

**Runtime:** `DEPLOYER_PRIVATE_KEY=0x... USE_MEMORY_STATE=true JEJU_TESTNET_RPC_URL=http://127.0.0.1:9545 bun run api/faucet-server.ts`

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
- **CrossChainPaymaster** exceeds 24KB max contract code size (26.7KB even with via-ir optimizer). Needs refactoring to deploy.

### Sequencer Architecture

The testnet runs a single sequencer (op-batcher) that submits batches to Sepolia L1. If the sequencer goes down:
- L2 blocks stop being finalized on L1, but unsafe blocks continue locally via op-geth
- Users can force-include transactions via the L1 OptimismPortal (ForcedInclusion contract deployed)
- The sequencer key is required to resume batch submission; no automatic failover exists
- User funds remain safe on L1 and can be withdrawn via the dispute game mechanism

For production, consider integrating a shared sequencer (Espresso, Astria) for decentralized sequencing and failover.
