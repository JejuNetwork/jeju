# @jejunetwork/messaging

Unified messaging protocol for Jeju Network - public (Farcaster) and private (XMTP) messaging.

## Features

### Public Messaging (Farcaster)

- **Hub Client** - Read casts, profiles, reactions, and links
- **Posting** - Cast, reply, react, follow/unfollow
- **Direct Casts** - Encrypted FID-to-FID DMs
- **Signer Management** - Ed25519 key generation and on-chain registration
- **Frames** - Support for Farcaster Frames

### Private Messaging (XMTP)

- **End-to-end encryption** - X25519 key exchange + AES-256-GCM
- **Decentralized relay network** - Permissionless node operators with economic incentives
- **On-chain key registry** - Public keys stored on Jeju L2 for discovery
- **MLS Groups** - Group messaging with Message Layer Security
- **IPFS storage** - Message persistence with content-addressed storage
- **x402 micropayments** - Pay-per-message economic model

## Quick Start

### Install

```bash
bun add @jejunetwork/messaging
```

### Private Messaging (XMTP)

```typescript
import { createMessagingClient } from '@jejunetwork/messaging';

// Create client
const client = createMessagingClient({
  rpcUrl: 'http://localhost:6546',
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

### Public Messaging (Farcaster)

```typescript
import { 
  FarcasterClient, 
  FarcasterPoster,
  DirectCastClient,
  DEFAULT_HUBS 
} from '@jejunetwork/messaging';

// Read from Farcaster
const hub = new FarcasterClient({ hubUrl: DEFAULT_HUBS.mainnet });
const profile = await hub.getProfile(fid);
const casts = await hub.getCastsByFid(fid);

// Post to Farcaster (requires Ed25519 signer)
const poster = new FarcasterPoster({
  fid: 12345,
  signerPrivateKey,
  hubUrl: DEFAULT_HUBS.mainnet,
});
await poster.cast('Hello Farcaster!');
await poster.like({ fid: 54321, hash: '0x...' });
await poster.follow(54321);

// Encrypted Direct Casts
const dc = new DirectCastClient({
  fid: 12345,
  signerPrivateKey,
  hubUrl: DEFAULT_HUBS.mainnet,
  relayUrl: 'http://localhost:3300',
});
await dc.initialize();
await dc.send({ recipientFid: 54321, text: 'Private message via DC!' });
```

### Unified Messaging

```typescript
import { createUnifiedMessagingService } from '@jejunetwork/messaging';

const service = createUnifiedMessagingService({
  messaging: { rpcUrl, address, relayUrl },
  farcaster: { fid, signerPrivateKey, hubUrl },
});

await service.initialize(signature);

// Auto-routes based on recipient type
await service.sendMessage('0xAddress...', 'XMTP message');  // Wallet address -> XMTP
await service.sendMessage(12345, 'Farcaster DM');            // FID -> Direct Cast
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
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐   ┌─────────────────┐   ┌─────────────────┐
│  Farcaster    │   │   XMTP Relay    │   │   MLS Groups    │
│  Hub Network  │   │   (Private)     │   │   (Private)     │
└───────────────┘   └─────────────────┘   └─────────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌─────────────────┐
                    │  Jeju Storage   │
                    │    (IPFS)       │
                    └─────────────────┘
```

## Exports

### XMTP Private Messaging

- `createMessagingClient` - Client factory
- `MessagingClient` - Browser-compatible client
- Crypto utilities: `encryptMessage`, `decryptMessage`, `deriveKeyPairFromWallet`

### Farcaster Public Messaging

- `FarcasterClient` - Hub read client
- `FarcasterPoster` - Posting client
- `DirectCastClient` - Encrypted DM client
- `FarcasterSignerManager` - Signer key management
- `SignerRegistration` - On-chain signer registration

### MLS Group Messaging

- `JejuMLSClient` - MLS client for groups
- `JejuGroup` - Group management
- Content types: `text`, `image`, `file`, `reaction`, `transaction`

### DWS Workers

- `createMessagingWorker` - Decentralized messaging relay worker
- `createFarcasterWorker` - Decentralized Farcaster signer worker

## Running Tests

```bash
bun test
```

## API Reference

### MessagingClient Methods

| Method | Description |
|--------|-------------|
| `initialize(signature)` | Initialize with wallet signature |
| `sendMessage(request)` | Send encrypted message |
| `onMessage(handler)` | Subscribe to message events |
| `getMessages(chatId)` | Get cached messages |
| `isConnected()` | Check connection status |
| `disconnect()` | Disconnect from relay |

### FarcasterPoster Methods

| Method | Description |
|--------|-------------|
| `cast(text, options?)` | Post a cast |
| `reply(text, target)` | Reply to a cast |
| `like(target)` / `unlike(target)` | Like/unlike a cast |
| `recast(target)` / `unrecast(target)` | Recast/unrecast |
| `follow(fid)` / `unfollow(fid)` | Follow/unfollow user |
| `thread(texts[], options?)` | Post a thread |
| `deleteCast(hash)` | Delete a cast |

### DirectCastClient Methods

| Method | Description |
|--------|-------------|
| `initialize()` | Initialize client |
| `send(params)` | Send encrypted DM |
| `getConversations()` | List conversations |
| `getMessages(fid, options?)` | Get messages with user |
| `markAsRead(fid)` | Mark conversation as read |
| `onMessage(handler)` | Subscribe to new messages |

## License

MIT
