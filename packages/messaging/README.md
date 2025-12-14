# @jeju/messaging

Decentralized private messaging protocol for Jeju L2.

## Features

- **End-to-end encryption** - X25519 key exchange + AES-256-GCM
- **Decentralized relay network** - Permissionless node operators with economic incentives
- **On-chain key registry** - Public keys stored on Jeju L2 for discovery
- **IPFS storage** - Message persistence with content-addressed storage
- **x402 micropayments** - Pay-per-message economic model

## Quick Start

### Install

```bash
bun add @jeju/messaging
```

### Usage

```typescript
import { createMessagingClient } from '@jeju/messaging';

// Create client
const client = createMessagingClient({
  rpcUrl: 'http://localhost:9545',
  address: '0xYourAddress',
  relayUrl: 'http://localhost:3200',
  keyRegistryAddress: '0x...',
  nodeRegistryAddress: '0x...',
});

// Initialize with wallet signature (derives encryption keys)
const signature = await wallet.signMessage(client.getKeyDerivationMessage());
await client.initialize(signature);

// Send encrypted message
await client.sendMessage({
  to: '0xRecipientAddress',
  content: 'Hello, private world!',
});

// Listen for incoming messages
client.onMessage((event) => {
  if (event.type === 'message:new') {
    console.log('New message:', event.data.content);
  }
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Jeju L2                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ NodeRegistry │  │ KeyRegistry  │  │ StakingPool  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
    ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
    │ Relay Node  │  │ Relay Node  │  │ Relay Node  │
    │   (us-east) │  │  (eu-west)  │  │  (ap-south) │
    └─────────────┘  └─────────────┘  └─────────────┘
              │               │               │
              └───────────────┼───────────────┘
                              ▼
                    ┌─────────────────┐
                    │  Jeju Storage   │
                    │    (IPFS)       │
                    └─────────────────┘
```

## Running the Demo

```bash
# 1. Start Jeju localnet (from root)
cd ../..
bun run dev

# 2. Run the demo
cd packages/messaging
bun run demo
```

## Running Tests

```bash
bun test
```

## Running a Relay Node

### Local Development

```bash
# Start relay node
bun run node

# With IPFS
IPFS_URL=http://localhost:5001 bun run node
```

### AWS Deployment

```bash
cd terraform

# Configure
cp variables.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Deploy
terraform init
terraform plan
terraform apply
```

## Smart Contracts

### KeyRegistry

Stores public encryption keys on-chain for discovery:

```solidity
// Register your key bundle
keyRegistry.registerKeyBundle(
  identityKey,    // X25519 public key (bytes32)
  signedPreKey,   // Rotating pre-key
  preKeySignature // Signature for verification
);

// Look up someone's key
(bytes32 key, bool active) = keyRegistry.getKeyBundle(address);
```

### MessageNodeRegistry

Registry for relay node operators:

```solidity
// Register as node operator (requires stake)
nodeRegistry.registerNode(
  "https://relay.example.com",  // Endpoint
  "us-east",                    // Region
  1000 ether                    // Stake amount
);

// Find healthy nodes
(bytes32 nodeId, string endpoint) = nodeRegistry.getRandomHealthyNode("us-east");
```

## Cryptography

### Key Derivation

Users derive messaging keys from their Ethereum wallet:

```typescript
// Sign a specific message
const signature = await wallet.signMessage(
  'Sign this message to enable Jeju Messaging.\n\n' +
  'This signature will be used to derive your encryption keys.\n' +
  'It does not grant access to your funds.'
);

// Derive X25519 key pair
const keyPair = deriveKeyPairFromWallet(address, signature);
```

### Message Encryption

Messages are encrypted using:

1. **X25519 ECDH** - Derive shared secret
2. **HKDF** - Expand shared secret into encryption key
3. **AES-256-GCM** - Encrypt message with authenticated encryption

```typescript
// Encrypt
const encrypted = encryptMessage(message, recipientPublicKey);

// Decrypt
const decrypted = decryptMessage(encrypted, recipientPrivateKey);
```

## Economics

### Message Fees

- Base fee: ~$0.0001 per message
- Protocol cut: 5%
- Node operator: 95%

### Node Staking

- Minimum stake: 1000 JEJU
- Rewards based on:
  - Messages relayed
  - Uptime score
  - Delivery success rate
  - Geographic diversity

### Slashing

Nodes can be slashed for:
- Censorship (proven non-delivery)
- Data leaks
- Extended downtime

## API Reference

### Client Methods

| Method | Description |
|--------|-------------|
| `initialize(signature)` | Initialize with wallet signature |
| `sendMessage(request)` | Send encrypted message |
| `onMessage(handler)` | Subscribe to message events |
| `getMessages(chatId)` | Get cached messages |
| `isConnected()` | Check connection status |
| `disconnect()` | Disconnect from relay |

### Events

| Event | Description |
|-------|-------------|
| `message:new` | New message received |
| `message:delivered` | Message delivered to recipient |
| `message:read` | Message read by recipient |
| `error` | Error occurred |

## License

MIT

