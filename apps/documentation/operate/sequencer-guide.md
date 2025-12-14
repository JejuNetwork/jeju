# Jeju Sequencer Operator Guide

This guide explains how to join the Jeju network as a sequencer operator, including staking requirements, slashing conditions, and fee structure.

## Requirements

### Hardware
- **CPU**: 8+ cores
- **RAM**: 32GB minimum
- **Storage**: 2TB NVMe SSD
- **Network**: 1Gbps symmetric

### Software
- Docker 24+
- One of: Geth v1.14+, Reth v1.1+, or Nethermind v1.28+

## Staking Requirements

| Parameter | Value |
|-----------|-------|
| Minimum Stake | 1,000 JEJU |
| Maximum Stake | 100,000 JEJU |
| Unstaking Period | 7 days |

Higher stakes increase your selection weight for block production.

## Registration Process

### 1. Register an Agent Identity

First, register an agent in the IdentityRegistry:

```solidity
// Register agent (no upfront stake required for identity)
uint256 agentId = identityRegistry.register("ipfs://your-metadata-uri");
```

### 2. Approve JEJU Token

```solidity
jejuToken.approve(sequencerRegistryAddress, stakeAmount);
```

### 3. Register as Sequencer

```solidity
sequencerRegistry.register(agentId, stakeAmount);
```

### 4. Run Your Node

Choose one of three supported execution clients:

#### Geth
```bash
docker run -d --name jeju-sequencer-geth \
  -v /data/jeju:/data \
  -v /secrets:/secrets:ro \
  -p 8545:8545 -p 8546:8546 -p 30303:30303 \
  us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:v1.101315.2 \
  --http --http.addr=0.0.0.0 --http.api=eth,net,web3,debug,txpool \
  --authrpc.addr=0.0.0.0 --authrpc.jwtsecret=/secrets/jwt-secret.txt \
  --rollup.sequencerhttp=http://op-node:8547
```

#### Reth
```bash
docker run -d --name jeju-sequencer-reth \
  -v /data/jeju:/data \
  -v /secrets:/secrets:ro \
  -p 8545:8545 -p 8546:8546 -p 30303:30303 \
  ghcr.io/paradigmxyz/op-reth:v1.1.2 \
  node --http --http.addr=0.0.0.0 --http.api=eth,net,web3,txpool,trace \
  --authrpc.addr=0.0.0.0 --authrpc.jwtsecret=/secrets/jwt-secret.txt \
  --rollup.sequencer-http=http://op-node:8547
```

#### Nethermind
```bash
docker run -d --name jeju-sequencer-nethermind \
  -v /data/jeju:/data \
  -v /secrets:/secrets:ro \
  -p 8545:8545 -p 8546:8546 -p 30303:30303 \
  nethermind/nethermind:1.28.0 \
  --config=op-mainnet \
  --JsonRpc.Enabled=true --JsonRpc.Host=0.0.0.0 \
  --JsonRpc.EnginePort=8551 --JsonRpc.JwtSecretFile=/secrets/jwt-secret.txt
```

## Slashing Conditions

| Offense | Penalty | Recovery |
|---------|---------|----------|
| Double Signing | 10% of stake | Permanent ban |
| Censorship | 5% of stake | Can re-stake after cooldown |
| Downtime (100+ blocks) | 1% of stake | Warning, can continue |
| Governance Ban | 100% of stake | Permanent ban |

### Double Signing Detection
If you sign two different blocks at the same height:
```solidity
// Automatic detection and slashing
sequencerRegistry.recordBlockProposed(sequencer, blockNumber);
// If already signed at this height → slash + ban
```

### Censorship Detection
If you fail to include forced-inclusion transactions:
```solidity
// After INCLUSION_WINDOW (50 blocks), anyone can force-include
forcedInclusion.forceInclude(txHash);
// Sequencer who should have included is slashed
```

## Selection Algorithm

Your probability of being selected as block producer is weighted by:

```
weight = (stake × 0.5) + (stake × 0.5 × reputationScore / 100)
```

Where:
- `stake`: Your staked JEJU tokens
- `reputationScore`: 0-100 based on your agent's reputation

## Threshold Signing

Batch submissions require N-of-M signatures (default: 2-of-3).

### As a Threshold Signer
1. Your sequencer address must be added to `ThresholdBatchSubmitter`
2. When batches are ready, you'll receive signature requests via P2P
3. Sign the EIP-712 digest and return to the coordinator

```typescript
// Batch digest format
const domain = {
  name: "ThresholdBatchSubmitter",
  version: "1",
  chainId: 420690,
  verifyingContract: thresholdBatchSubmitterAddress
};

const types = {
  Batch: [
    { name: "batchHash", type: "bytes32" },
    { name: "nonce", type: "uint256" }
  ]
};
```

## Fees

| Fee Type | Amount | Recipient |
|----------|--------|-----------|
| Block Production | L2 gas fees | Sequencer |
| Forced Inclusion | 0.001 ETH min | Treasury |
| Dispute Bond | 1-100 ETH | Winner/Treasury |

## Monitoring

### Check Your Status
```bash
# Get your sequencer info
cast call $SEQUENCER_REGISTRY "sequencers(address)" $YOUR_ADDRESS

# Get all active sequencers
cast call $SEQUENCER_REGISTRY "getActiveSequencers()"

# Get your selection weight
cast call $SEQUENCER_REGISTRY "getSelectionWeight(address)" $YOUR_ADDRESS
```

### Metrics Endpoints
- Geth: `http://localhost:6060/debug/metrics/prometheus`
- Reth: `http://localhost:9001/metrics`
- Nethermind: `http://localhost:8008/metrics`

## Unstaking

```solidity
// Initiate unstake (enters 7-day cooldown)
sequencerRegistry.unregister();

// After cooldown, tokens are returned automatically
```

## Client Diversity

For network health, we encourage running different clients:

| Client | Current % | Target |
|--------|-----------|--------|
| Geth | 60% | 33% |
| Reth | 30% | 33% |
| Nethermind | 10% | 33% |

Operators running minority clients may receive bonus rewards in future governance proposals.

## Support

- Discord: [discord.gg/jejunetwork](https://discord.gg/jejunetwork)
- Documentation: [docs.jejunetwork.org](https://docs.jejunetwork.org)
- GitHub: [github.com/JejuNetwork/jeju](https://github.com/JejuNetwork/jeju)

