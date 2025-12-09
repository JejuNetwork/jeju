# Agent Registry (ERC-8004)

On-chain identity for apps and agents. Enables discovery, reputation, and verification.

## Why Register?

| Benefit | Description |
|---------|-------------|
| Discovery | Agents find you via on-chain search |
| Reputation | Accumulate feedback from users/clients |
| Revenue | Set revenue wallet, earn from paymaster fees |
| Verification | Third-party validators attest capabilities |

## Register an Agent

### Via Script

```bash
bun run scripts/register-agents.ts --network testnet
```

### Via Contract

```bash
cast send $IDENTITY_REGISTRY \
  "register(string)" "ipfs://QmYourAgentConfig" \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### With Metadata

```bash
# Register with name and endpoint
cast send $IDENTITY_REGISTRY \
  "register(string,(string,bytes)[])" \
  "ipfs://config" \
  '[("name","0x4d79204167656e74"),("endpoint","0x...")]' \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Set Revenue Wallet

Earn 50% of paymaster fees when users interact with your app:

```bash
cast send $IDENTITY_REGISTRY \
  "setMetadata(uint256,string,bytes)" \
  $AGENT_ID \
  "revenueWallet" \
  $(cast abi-encode "x(address)" $YOUR_WALLET) \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## Query Agents

```bash
# Total agents
cast call $IDENTITY_REGISTRY "totalAgents()" --rpc-url $RPC_URL

# Owner of agent
cast call $IDENTITY_REGISTRY "ownerOf(uint256)" $AGENT_ID --rpc-url $RPC_URL

# Agent metadata
cast call $IDENTITY_REGISTRY "getMetadata(uint256,string)" $AGENT_ID "name" --rpc-url $RPC_URL
```

## Reputation

### Give Feedback

Requires agent's authorization signature:

```bash
cast send $REPUTATION_REGISTRY \
  "giveFeedback(uint256,uint8,bytes32,bytes32,string,bytes32,bytes)" \
  $AGENT_ID \
  85 \
  "service" \
  "quality" \
  "ipfs://feedback" \
  $FILE_HASH \
  $AUTH_SIGNATURE \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

### Get Summary

```bash
cast call $REPUTATION_REGISTRY \
  "getSummary(uint256,address[],bytes32,bytes32)" \
  $AGENT_ID \
  "[]" \
  "service" \
  "0x0" \
  --rpc-url $RPC_URL
```

## Validation

Request third-party verification of agent capabilities:

```bash
cast send $VALIDATION_REGISTRY \
  "validationRequest(address,uint256,string,bytes32)" \
  $VALIDATOR_ADDRESS \
  $AGENT_ID \
  "ipfs://request" \
  $REQUEST_HASH \
  --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY
```

## jeju-manifest.json

Every app should have a manifest in its root:

```json
{
  "name": "My App",
  "description": "What it does",
  "version": "1.0.0",
  "port": 4000,
  "agent": {
    "tags": ["defi", "trading"],
    "capabilities": ["swap", "bridge"]
  }
}
```

## Contracts

| Contract | Purpose |
|----------|---------|
| IdentityRegistry | ERC-721 agent NFTs, metadata |
| ReputationRegistry | Feedback/ratings with auth |
| ValidationRegistry | Third-party attestations |
