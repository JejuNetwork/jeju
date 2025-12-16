# @jejunetwork/oauth3

Fully decentralized OAuth3 authentication with TEE-backed key management, FROST threshold MPC signing, and W3C Verifiable Credentials.

## Features

- **🔐 TEE-Backed Security** - Keys managed inside Trusted Execution Environments (dstack/Intel TDX or Phala CVM)
- **🔑 FROST MPC Signing** - 2-of-3 threshold signatures across distributed nodes
- **🌐 Multi-Provider Auth** - Wallet (SIWE), Farcaster (SIWF), Google, Apple, Twitter, GitHub, Discord
- **📜 Verifiable Credentials** - W3C-compliant identity attestations
- **⛓️ Cross-Chain Identity** - Open Intents for multi-chain account deployment
- **🏷️ JNS Integration** - Decentralized app and identity resolution
- **💾 IPFS Storage** - Encrypted session and credential storage
- **💰 x402 Payments** - Micropayment integration for services

## Installation

```bash
bun add @jejunetwork/oauth3
# or
npm install @jejunetwork/oauth3
```

## Quick Start

### Client-Side SDK

```typescript
import { createOAuth3Client, AuthProvider } from '@jejunetwork/oauth3';

// Create client
const oauth3 = createOAuth3Client({
  appId: 'your-app.apps.jeju',
  redirectUri: 'https://your-app.com/auth/callback',
  chainId: 420690, // Jeju Testnet
});

// Initialize (discovers TEE nodes via JNS)
await oauth3.initialize();

// Login with wallet (SIWE)
const session = await oauth3.login({ provider: AuthProvider.WALLET });

// Login with Farcaster
const session = await oauth3.login({ provider: AuthProvider.FARCASTER });

// Login with social provider
const session = await oauth3.login({ provider: AuthProvider.GITHUB });

// Sign a message using MPC
const signature = await oauth3.signMessage({ message: 'Hello World' });

// Link additional provider
await oauth3.linkProvider({ provider: AuthProvider.TWITTER });

// Get verifiable credential
const credential = await oauth3.issueCredential(
  AuthProvider.FARCASTER,
  '12345',  // fid
  'alice'   // username
);
```

### Server-Side (Running Your Own TEE Node)

```typescript
import { startAuthAgent } from '@jejunetwork/oauth3/tee';

// Start the OAuth3 agent server
await startAuthAgent({
  port: 4200,
  chainId: 420690,
  privateKey: process.env.TEE_PRIVATE_KEY,
  mpcEnabled: true,
  mpcThreshold: 2,
  mpcTotalParties: 3,
});
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         OAuth3 Flow                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────┐    ┌──────────┐    ┌─────────────────────────────┐  │
│  │  User  │───▶│ Your App │───▶│    OAuth3 TEE Cluster       │  │
│  └────────┘    └──────────┘    │  ┌─────┐ ┌─────┐ ┌─────┐   │  │
│                                │  │Node1│ │Node2│ │Node3│   │  │
│  Auth Methods:                 │  └──┬──┘ └──┬──┘ └──┬──┘   │  │
│  • Wallet (SIWE)              │     │       │       │       │  │
│  • Farcaster (SIWF)           │     └───────┼───────┘       │  │
│  • Google/Apple/Twitter       │             │               │  │
│  • GitHub/Discord             │      FROST MPC (2-of-3)     │  │
│                               └─────────────────────────────┘  │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    On-Chain Contracts                      │ │
│  │  • JNS Registry (app/identity resolution)                 │ │
│  │  • OAuth3 App Registry (multi-tenant apps)                │ │
│  │  • OAuth3 Identity Registry (identity management)         │ │
│  │  • OAuth3 TEE Verifier (attestation verification)         │ │
│  │  • Smart Account Factory (account abstraction)            │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                  Decentralized Storage                     │ │
│  │  • Sessions (encrypted, IPFS)                              │ │
│  │  • Credentials (encrypted, IPFS)                           │ │
│  │  • Attestations (on-chain + IPFS backup)                   │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment

### Option 1: Docker (Recommended)

#### Local Development

```bash
# Start a local 3-node MPC cluster
bun run docker:local

# Or manually:
docker compose -f docker/dstack.compose.yaml --profile local up
```

#### Testnet (dstack/Intel TDX)

```bash
# Copy and configure environment
cp docker/env.example .env.testnet
# Edit .env.testnet with your values

# Start testnet cluster
docker compose -f docker/dstack.compose.yaml --profile testnet --env-file .env.testnet up -d
```

#### Testnet/Mainnet (Phala CVM)

```bash
# Copy and configure environment
cp docker/env.example .env.phala
# Edit .env.phala with Phala cluster settings

# Start Phala cluster
docker compose -f docker/phala.compose.yaml --profile testnet --env-file .env.phala up -d
```

### Option 2: Direct Deployment

```bash
# Build the package
bun run build

# Start single agent (development)
CHAIN_ID=420691 bun run start:agent

# Start with MPC enabled
MPC_ENABLED=true MPC_THRESHOLD=2 MPC_TOTAL_PARTIES=3 bun run start:agent
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CHAIN_ID` | Network chain ID | `420691` (localnet) |
| `JEJU_RPC_URL` | RPC endpoint | `http://localhost:9545` |
| `OAUTH3_PORT` | Agent HTTP port | `4200` |
| `TEE_MODE` | TEE provider (`dstack`, `phala`, `simulated`) | `simulated` |
| `MPC_ENABLED` | Enable MPC signing | `false` |
| `MPC_THRESHOLD` | Required signers | `2` |
| `MPC_TOTAL_PARTIES` | Total MPC nodes | `3` |
| `IPFS_API_ENDPOINT` | IPFS/DWS API | `http://localhost:4030/storage/api/v0` |
| `IPFS_GATEWAY_ENDPOINT` | IPFS gateway | `http://localhost:4030/storage/ipfs` |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | - |
| `GOOGLE_CLIENT_SECRET` | Google OAuth secret | - |
| `GITHUB_CLIENT_ID` | GitHub OAuth client ID | - |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth secret | - |
| `TWITTER_CLIENT_ID` | Twitter OAuth client ID | - |
| `TWITTER_CLIENT_SECRET` | Twitter OAuth secret | - |
| `DISCORD_CLIENT_ID` | Discord OAuth client ID | - |
| `DISCORD_CLIENT_SECRET` | Discord OAuth secret | - |
| `FARCASTER_FID` | Farcaster FID for signing | - |
| `FARCASTER_SIGNER_KEY` | Farcaster signer private key | - |

## API Reference

### OAuth3Client

```typescript
interface OAuth3Client {
  // Initialization
  initialize(): Promise<void>;
  
  // Authentication
  login(options: LoginOptions): Promise<OAuth3Session>;
  logout(): Promise<void>;
  getSession(): OAuth3Session | null;
  isLoggedIn(): boolean;
  
  // Provider Management
  linkProvider(options: LinkOptions): Promise<LinkedProvider>;
  unlinkProvider(provider: AuthProvider): Promise<void>;
  getLinkedProviders(): LinkedProvider[];
  
  // Signing
  signMessage(options: SignMessageOptions): Promise<Hex>;
  signTransaction(options: TransactionOptions): Promise<Hex>;
  
  // Credentials
  issueCredential(provider: AuthProvider, providerId: string, handle: string): Promise<VerifiableCredential>;
  verifyCredential(credential: VerifiableCredential): Promise<boolean>;
  
  // Infrastructure
  checkInfrastructureHealth(): Promise<{ jns: boolean; storage: boolean; teeNode: boolean }>;
  
  // Events
  on(event: OAuth3EventType, handler: OAuth3EventHandler): void;
  off(event: OAuth3EventType, handler: OAuth3EventHandler): void;
}
```

### TEE Agent Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Agent health check with TEE attestation |
| `/attestation` | GET | Get current TEE attestation quote |
| `/auth/init` | POST | Initialize OAuth flow |
| `/auth/callback` | POST | Handle OAuth callback |
| `/auth/wallet` | POST | Wallet signature authentication |
| `/auth/farcaster` | POST | Farcaster authentication |
| `/session/:id` | GET | Get session by ID |
| `/session/:id/refresh` | POST | Refresh session |
| `/sign` | POST | Sign message with MPC |
| `/credential/issue` | POST | Issue verifiable credential |
| `/credential/verify` | POST | Verify credential |

## Chain IDs

| Network | Chain ID | RPC URL |
|---------|----------|---------|
| Localnet | 420691 | `http://localhost:9545` |
| Testnet | 420690 | `https://testnet.jeju.network` |
| Mainnet | 420692 | `https://mainnet.jeju.network` |

## Security Considerations

### TEE Attestation

All OAuth3 nodes run inside TEEs and provide attestation quotes that can be verified on-chain:

```typescript
import { DstackAuthAgent } from '@jejunetwork/oauth3/tee';

const agent = new DstackAuthAgent(config);
const attestation = await agent.getAttestation();

// Verify on-chain
const isValid = await teeVerifierContract.verifyAttestation(
  attestation.quote,
  attestation.reportData
);
```

### MPC Key Management

Keys never exist in full form - they're split across nodes using FROST threshold signatures:

```typescript
import { generateKeyShares, FROSTCoordinator } from '@jejunetwork/oauth3/mpc';

// Generate 3 shares with threshold 2
const shares = generateKeyShares(3, 2);

// Coordinator manages signing sessions
const coordinator = new FROSTCoordinator(nodes, 2);
const signature = await coordinator.sign(messageHash);
```

### Session Storage

Sessions are encrypted client-side before storage on IPFS:

```typescript
import { ThresholdEncryptionService } from '@jejunetwork/oauth3';

const encryption = new ThresholdEncryptionService(config);
const { ciphertext, encryptedKey } = await encryption.encrypt(sessionData);
```

## Multi-Tenant Apps

Register your app to get multi-tenant OAuth3 support:

```typescript
import { createMultiTenantCouncilManager } from '@jejunetwork/oauth3';

const manager = createMultiTenantCouncilManager(config);

// Deploy a new OAuth3 app with its own council
const { council, oauth3App } = await manager.deployCouncil({
  name: 'My App',
  ceoAgentAddress: '0x...',
  initialAgents: ['0x...', '0x...'],
});

// App is now accessible at: myapp.apps.jeju
```

## Integrating with Your App

### React Example

```tsx
import { createOAuth3Client, AuthProvider } from '@jejunetwork/oauth3';
import { useState, useEffect } from 'react';

const oauth3 = createOAuth3Client({
  appId: 'myapp.apps.jeju',
  redirectUri: window.location.origin + '/auth/callback',
  chainId: 420690,
});

function LoginButton() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    oauth3.initialize().then(() => {
      setSession(oauth3.getSession());
    });
  }, []);

  const handleLogin = async (provider: AuthProvider) => {
    const session = await oauth3.login({ provider });
    setSession(session);
  };

  if (session) {
    return <div>Logged in: {session.smartAccount}</div>;
  }

  return (
    <div>
      <button onClick={() => handleLogin(AuthProvider.WALLET)}>
        Connect Wallet
      </button>
      <button onClick={() => handleLogin(AuthProvider.FARCASTER)}>
        Sign in with Farcaster
      </button>
      <button onClick={() => handleLogin(AuthProvider.GITHUB)}>
        Sign in with GitHub
      </button>
    </div>
  );
}
```

### Next.js Callback Handler

```tsx
// app/auth/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AuthCallback() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams?.get('code');
    const state = searchParams?.get('state');
    
    if (code && state) {
      // Complete OAuth flow
      fetch('/api/auth/callback', {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }).then(() => router.push('/dashboard'));
    }
  }, [searchParams, router]);

  return <div>Completing authentication...</div>;
}
```

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/infrastructure.test.ts

# Run with coverage
bun test --coverage
```

## Building

```bash
# Development build (watch mode)
bun run dev

# Production build
bun run build

# Type check
bun run typecheck
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## Links

- [Jeju Network](https://jeju.network)
- [Documentation](https://docs.jeju.network/oauth3)
- [GitHub](https://github.com/elizaos/jeju)
- [Discord](https://discord.gg/jeju)
