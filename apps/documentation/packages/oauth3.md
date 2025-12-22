# OAuth3

Open-source, self-hostable alternative to Privy. Decentralized authentication with TEE-backed key management and FROST MPC signing.

## Features

- **TEE-Backed Security** - Keys managed inside Trusted Execution Environments
- **FROST MPC Signing** - 2-of-3 threshold signatures across distributed nodes
- **Multi-Provider Auth** - Wallet (SIWE), Farcaster, Google, Apple, Twitter, GitHub, Discord, Email, Phone
- **Multi-Factor Auth** - WebAuthn/Passkeys, TOTP, backup codes
- **Verifiable Credentials** - W3C-compliant identity attestations
- **React SDK** - Complete hooks and components

## Installation

```bash
bun add @jejunetwork/oauth3
```

## Quick Start

### React Integration

```tsx
import { OAuth3Provider, useOAuth3, LoginModal } from '@jejunetwork/oauth3/react';

function App() {
  return (
    <OAuth3Provider config={{
      appId: 'myapp.apps.jeju',
      redirectUri: window.location.origin + '/auth/callback',
      chainId: 420691,
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
        <p>Connected: {session.smartAccount}</p>
        <button onClick={logout}>Logout</button>
      </div>
    );
  }

  return (
    <>
      <button onClick={() => setShowLogin(true)}>Sign In</button>
      <LoginModal 
        isOpen={showLogin} 
        onClose={() => setShowLogin(false)}
        showEmailPhone
      />
    </>
  );
}
```

### Client SDK

```typescript
import { createOAuth3Client, AuthProvider } from '@jejunetwork/oauth3';

const oauth3 = createOAuth3Client({
  appId: 'your-app.apps.jeju',
  redirectUri: 'https://your-app.com/auth/callback',
  chainId: 420691,
});

await oauth3.initialize();

// Login with wallet (SIWE)
const session = await oauth3.login({ provider: AuthProvider.WALLET });

// Login with Farcaster
const session = await oauth3.login({ provider: AuthProvider.FARCASTER });

// Login with social provider
const session = await oauth3.login({ provider: AuthProvider.GITHUB });

// Sign message using MPC
const signature = await oauth3.signMessage({ message: 'Hello World' });

// Link additional provider
await oauth3.linkProvider({ provider: AuthProvider.TWITTER });
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         OAuth3 Flow                              │
├─────────────────────────────────────────────────────────────────┤
│  ┌────────┐    ┌──────────┐    ┌─────────────────────────────┐  │
│  │  User  │───▶│ Your App │───▶│    OAuth3 TEE Cluster       │  │
│  └────────┘    └──────────┘    │  ┌─────┐ ┌─────┐ ┌─────┐   │  │
│                                │  │Node1│ │Node2│ │Node3│   │  │
│  Auth Methods:                 │  └──┬──┘ └──┬──┘ └──┬──┘   │  │
│  • Wallet (SIWE)              │     │       │       │       │  │
│  • Farcaster (SIWF)           │     └───────┼───────┘       │  │
│  • Google/Apple/Twitter       │             │               │  │
│  • GitHub/Discord             │      FROST MPC (2-of-3)     │  │
│  • Email/Phone                └─────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Auth Providers

| Provider | Type | Setup Required |
|----------|------|----------------|
| Wallet | SIWE | None |
| Farcaster | SIWF | None |
| Google | OAuth | Google Cloud Console |
| Apple | OAuth | Apple Developer |
| Twitter | OAuth | Twitter Developer |
| GitHub | OAuth | GitHub Settings |
| Discord | OAuth | Discord Developer |
| Email | Magic Link | SMTP server |
| Phone | SMS | Twilio/similar |

## React Hooks

```tsx
import { 
  useLogin, 
  useMFA, 
  useCredentials, 
  useSession 
} from '@jejunetwork/oauth3/react';

// Login
const { login, loginWithEmail, verifyEmailCode } = useLogin();

// MFA
const { setupTOTP, verifyTOTP, setupPasskey } = useMFA();

// Credentials
const { credentials, issueCredential, verifyCredential } = useCredentials();

// Session
const { session, isAuthenticated, refreshSession, logout } = useSession();
```

## Self-Hosting

Run your own OAuth3 TEE cluster:

### Docker (Recommended)

```bash
# Local 3-node MPC cluster
docker compose -f docker/dstack.compose.yaml --profile local up

# Testnet (Intel TDX)
docker compose -f docker/dstack.compose.yaml --profile testnet up -d
```

### Direct

```bash
# Single agent
CHAIN_ID=420691 bun run start:agent

# With MPC
MPC_ENABLED=true MPC_THRESHOLD=2 MPC_TOTAL_PARTIES=3 bun run start:agent
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `CHAIN_ID` | Network chain ID |
| `JEJU_RPC_URL` | RPC endpoint |
| `OAUTH3_PORT` | Agent HTTP port (default: 4200) |
| `TEE_MODE` | `dstack`, `phala`, or `simulated` |
| `GOOGLE_CLIENT_ID` | Google OAuth |
| `GITHUB_CLIENT_ID` | GitHub OAuth |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Agent health with TEE attestation |
| `/attestation` | GET | TEE attestation quote |
| `/auth/init` | POST | Initialize OAuth flow |
| `/auth/callback` | POST | Handle OAuth callback |
| `/auth/wallet` | POST | Wallet signature auth |
| `/auth/farcaster` | POST | Farcaster auth |
| `/session/:id` | GET | Get session |
| `/sign` | POST | Sign with MPC |
| `/credential/issue` | POST | Issue verifiable credential |

## Security

### TEE Attestation

Nodes run inside TEEs and provide verifiable attestation:

```typescript
const attestation = await oauth3.getAttestation();
const isValid = await verifyOnChain(attestation);
```

### MPC Key Management

Keys are split across nodes using FROST threshold signatures (2-of-3):

```typescript
const signature = await coordinator.sign(messageHash);
// Requires 2 of 3 nodes to participate
```

## Related

- [SDK Identity](/build/sdk/identity) - Identity integration
- [Agent Concepts](/learn/agents) - ERC-8004 identity
- [EIL/OIF](/integrate/overview) - Cross-chain identity

---

<details>
<summary>📋 Copy as Context</summary>

```
OAuth3 - Decentralized Authentication

Open-source Privy alternative. TEE-backed keys, FROST MPC signing, multi-provider auth.

Installation: bun add @jejunetwork/oauth3

React:
<OAuth3Provider config={{ appId: 'myapp.apps.jeju', chainId: 420691 }}>
  <App />
</OAuth3Provider>

const { isAuthenticated, login, logout } = useOAuth3();

Providers: Wallet (SIWE), Farcaster, Google, Apple, Twitter, GitHub, Discord, Email, Phone

Client:
const oauth3 = createOAuth3Client({ appId, redirectUri, chainId });
await oauth3.initialize();
const session = await oauth3.login({ provider: AuthProvider.WALLET });
const signature = await oauth3.signMessage({ message: 'Hello' });

Self-host:
docker compose -f docker/dstack.compose.yaml --profile local up

TEE modes: dstack (Intel TDX), phala, simulated
MPC: FROST 2-of-3 threshold signing

API: /auth/init, /auth/callback, /auth/wallet, /sign, /credential/issue
```

</details>

