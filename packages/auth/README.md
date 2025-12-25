# @jejunetwork/auth

**Open-source, self-hostable alternative to Privy.** OAuth3 authentication with TEE-backed key management, FROST threshold MPC signing, MFA (Passkeys/TOTP), and W3C Verifiable Credentials.

## Features

- **🔐 TEE-Backed Security** - Keys managed inside Trusted Execution Environments (dstack/Intel TDX or Phala CVM)
- **🔑 FROST MPC Signing** - 2-of-3 threshold signatures across distributed nodes
- **🌐 Multi-Provider Auth** - Wallet (SIWE), Farcaster (SIWF), Google, Apple, Twitter, GitHub, Discord, **Email**, **Phone/SMS**
- **🛡️ Multi-Factor Auth** - WebAuthn/Passkeys, TOTP (authenticator apps), backup codes
- **📜 Verifiable Credentials** - W3C-compliant identity attestations
- **⛓️ Cross-Chain Identity** - Open Intents for multi-chain account deployment
- **🏷️ JNS Integration** - Decentralized app and identity resolution
- **💾 IPFS Storage** - Encrypted session and credential storage
- **💰 x402 Payments** - Micropayment integration for services
- **⚛️ React SDK** - Complete hooks and components for React apps

## Installation

```bash
bun add @jejunetwork/auth
# or
npm install @jejunetwork/auth
```

## Provider Setup

For detailed instructions on setting up each authentication provider (Google, GitHub, Twitter, Discord, Apple, Farcaster, Email, Phone), see:

**📖 [Provider Setup Guide](./docs/PROVIDER_SETUP.md)**

Quick links:
- [Understanding Callback URLs](./docs/PROVIDER_SETUP.md#understanding-callback-urls)
- [Google OAuth Setup](./docs/PROVIDER_SETUP.md#google-oauth)
- [GitHub OAuth Setup](./docs/PROVIDER_SETUP.md#github-oauth)
- [Twitter/X OAuth Setup](./docs/PROVIDER_SETUP.md#twitterx-oauth)
- [Discord OAuth Setup](./docs/PROVIDER_SETUP.md#discord-oauth)
- [Apple Sign-In Setup](./docs/PROVIDER_SETUP.md#apple-sign-in)
- [Farcaster Setup](./docs/PROVIDER_SETUP.md#farcaster)
- [Email Authentication](./docs/PROVIDER_SETUP.md#email-authentication)
- [Phone/SMS Authentication](./docs/PROVIDER_SETUP.md#phonesms-authentication)
- [Environment Variables Reference](./docs/PROVIDER_SETUP.md#environment-variables-reference)

## Quick Start

### Client-Side SDK

```typescript
import { 
  createOAuth3Client, 
  AuthProvider,
  // Credentials
  VerifiableCredentialIssuer,
  // Providers
  FarcasterProvider,
  GoogleProvider,
  // Infrastructure
  OAuth3JNSService,
  OAuth3StorageService,
} from '@jejunetwork/auth';
import { FROSTCoordinator, generateKeyShares } from '@jejunetwork/kms';

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

Copy the example environment file and configure your providers:

```bash
cp docker/env.example .env
# Edit .env with your provider credentials
```

See [docker/env.example](./docker/env.example) for all available options, or the [Provider Setup Guide](./docs/PROVIDER_SETUP.md#environment-variables-reference) for details.

**Core Variables:**

| Variable | Description | Default |
|----------|-------------|---------|
| `CHAIN_ID` | Network chain ID | `420691` (localnet) |
| `JEJU_RPC_URL` | RPC endpoint | `http://localhost:6546` |
| `OAUTH3_PORT` | Agent HTTP port | `4200` |
| `TEE_MODE` | TEE provider (`dstack`, `phala`, `simulated`) | `simulated` |

**Provider Variables:**

| Provider | Required Variables |
|----------|-------------------|
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| GitHub | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| Twitter | `TWITTER_CLIENT_ID`, `TWITTER_CLIENT_SECRET` |
| Discord | `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` |
| Apple | `APPLE_CLIENT_ID`, `APPLE_CLIENT_SECRET`, `APPLE_TEAM_ID`, `APPLE_KEY_ID` |
| Email | `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM_ADDRESS` |
| Phone | `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` |

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
| Localnet | 420691 | `http://localhost:6546` |
| Testnet | 420690 | `https://testnet.jejunetwork.org` |
| Mainnet | 420692 | `https://mainnet.jejunetwork.org` |

## Security Considerations

### TEE Attestation

All OAuth3 nodes run inside TEEs and provide attestation quotes that can be verified on-chain via the `OAuth3TEEVerifier` contract.

### MPC Key Management

Keys never exist in full form - they're split across nodes using FROST threshold signatures:

```typescript
import { generateKeyShares, FROSTCoordinator } from '@jejunetwork/kms';

// Generate 3 shares with threshold 2
const shares = generateKeyShares(3, 2);

// Coordinator manages signing sessions
const coordinator = new FROSTCoordinator(nodes, 2);
const signature = await coordinator.sign(messageHash);
```

### Session Storage

Sessions are encrypted client-side before storage on IPFS:

```typescript
import { ThresholdEncryptionService } from '@jejunetwork/auth';

const encryption = new ThresholdEncryptionService(config);
const { ciphertext, encryptedKey } = await encryption.encrypt(sessionData);
```

## Multi-Tenant Apps

Register your app to get multi-tenant OAuth3 support:

```typescript
import { createMultiTenantCouncilManager } from '@jejunetwork/auth';

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

### React SDK (Recommended)

```tsx
// Use the built-in React SDK for the best experience
import { OAuth3Provider, useOAuth3, LoginModal, ConnectedAccount, MFASetup } from '@jejunetwork/auth';

function App() {
  return (
    <OAuth3Provider config={{
      appId: 'myapp.apps.jeju',
      redirectUri: window.location.origin + '/auth/callback',
      chainId: 420690,
    }}>
      <MyApp />
    </OAuth3Provider>
  );
}

function MyApp() {
  const { isAuthenticated, login, logout, session } = useOAuth3();
  const [showLogin, setShowLogin] = useState(false);

  if (isAuthenticated) {
    return (
      <div>
        <ConnectedAccount showLogout onLogout={() => console.log('Logged out')} />
        <MFASetup onComplete={(method) => console.log('MFA enabled:', method)} />
      </div>
    );
  }

  return (
    <>
      <button onClick={() => setShowLogin(true)}>Sign In</button>
      <LoginModal 
        isOpen={showLogin} 
        onClose={() => setShowLogin(false)}
        onSuccess={() => console.log('Logged in!')}
        showEmailPhone // Enable email/phone auth
      />
    </>
  );
}
```

### React Hooks

```tsx
import { useLogin, useMFA, useCredentials, useSession } from '@jejunetwork/auth';

// Login hook with all providers
const { login, loginWithEmail, loginWithPhone, verifyEmailCode, verifyPhoneCode } = useLogin();

// MFA management
const { setupTOTP, verifyTOTP, setupPasskey, generateBackupCodes } = useMFA();

// Credentials management  
const { credentials, issueCredential, verifyCredential } = useCredentials();

// Session management
const { session, isAuthenticated, refreshSession, logout, timeUntilExpiry } = useSession();
```

### Manual Integration

```tsx
import { createOAuth3Client, AuthProvider } from '@jejunetwork/auth';
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
      <button onClick={() => handleLogin(AuthProvider.EMAIL)}>
        Sign in with Email
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

- [Jeju Network](https://jejunetwork.org)
- [Documentation](https://docs.jejunetwork.org/oauth3)
- [GitHub](https://github.com/elizaos/jeju)
- [Discord](https://discord.gg/jeju)
