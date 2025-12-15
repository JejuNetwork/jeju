# OAuth3 Demo

Decentralized authentication demo with TEE-backed key management. Login with 11+ providers to create an on-chain identity and smart account.

## Supported Providers

| Provider | Type | Status |
|----------|------|--------|
| Wallet (SIWE) | Web3 | ✅ Built-in |
| Discord | OAuth 2.0 | ✅ Ready |
| Twitter/X | OAuth 2.0 + PKCE | ✅ Ready |
| Google | OAuth 2.0 + PKCE | ✅ Ready |
| GitHub | OAuth 2.0 | ✅ Ready |
| Facebook | OAuth 2.0 | ✅ Ready |
| Instagram | OAuth 2.0 | ✅ Ready |
| LinkedIn | OAuth 2.0 | ✅ Ready |
| TikTok | OAuth 2.0 + PKCE | ✅ Ready |
| Slack | OAuth 2.0 | ✅ Ready |
| Notion | OAuth 2.0 | ✅ Ready |
| Farcaster | Sign-In | ✅ Ready |

## Features

- **Multi-Provider Login**: 11+ OAuth providers + wallet SIWE
- **TEE-Attested Sessions**: All sessions are cryptographically attested (simulated mode available)
- **On-Chain Identity**: Creates a unified identity linked to your authentication providers
- **ERC-4337 Smart Account**: Deploy a gasless smart account tied to your identity
- **W3C Verifiable Credentials**: Issue portable identity attestations
- **Cross-Chain Support**: Same identity across Jeju, Base, Ethereum, and more

## Quick Start

### 1. Configure OAuth Providers

Copy `env.example` to `.env.local` and add your credentials.

**Discord** (https://discord.com/developers/applications):
```env
OAUTH_DISCORD_CLIENT_ID=your_client_id
OAUTH_DISCORD_CLIENT_SECRET=your_client_secret
```

**For all providers, add redirect URI:**
```
http://localhost:3000/auth/callback
```

### 2. Run the Demo

```bash
# Start both the UI and auth server
bun run dev

# Or run separately:
bun run dev:ui    # Vite on port 3000
bun run dev:auth  # Auth server on port 4200
```

The auth server shows which providers are enabled:

```
╔═══════════════════════════════════════════════════════════════════╗
║                    OAuth3 Demo Auth Server                         ║
╠═══════════════════════════════════════════════════════════════════╣
║  Enabled Providers:                                                ║
║    ✓ wallet (SIWE)                                                 ║
║    ✓ discord                                                       ║
║    ✗ twitter  (not configured)                                     ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 3. Deploy Contracts (optional)

```bash
cd /packages/contracts

# Deploy to localnet
forge script script/DeployOAuth3.s.sol --rpc-url http://localhost:9545 --broadcast
```

## Provider Setup Guide

### Discord
1. Go to https://discord.com/developers/applications
2. Create New Application
3. Go to OAuth2 → General
4. Add redirect: `http://localhost:3000/auth/callback`
5. Copy Client ID and Client Secret

### Twitter/X
1. Go to https://developer.twitter.com/en/portal/dashboard
2. Create Project → App
3. Set up OAuth 2.0 (with PKCE)
4. Add callback: `http://localhost:3000/auth/callback`
5. Copy Client ID and Client Secret

### Google
1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID (Web application)
3. Add authorized redirect: `http://localhost:3000/auth/callback`
4. Copy Client ID and Client Secret

### GitHub
1. Go to https://github.com/settings/developers
2. New OAuth App
3. Set callback: `http://localhost:3000/auth/callback`
4. Copy Client ID and Client Secret

### Facebook/Instagram
1. Go to https://developers.facebook.com/apps
2. Create App → Consumer
3. Add Facebook Login product
4. Set redirect: `http://localhost:3000/auth/callback`
5. Copy App ID and App Secret

### LinkedIn
1. Go to https://www.linkedin.com/developers/apps
2. Create App
3. Add Sign In with LinkedIn product
4. Set redirect: `http://localhost:3000/auth/callback`
5. Copy Client ID and Client Secret

### TikTok
1. Go to https://developers.tiktok.com/
2. Create App
3. Add Login Kit
4. Set redirect: `http://localhost:3000/auth/callback`
5. Copy Client Key and Client Secret

### Slack
1. Go to https://api.slack.com/apps
2. Create New App
3. Add OAuth & Permissions
4. Add redirect: `http://localhost:3000/auth/callback`
5. Add scopes: identity.basic, identity.email, identity.avatar
6. Copy Client ID and Client Secret

### Notion
1. Go to https://www.notion.so/my-integrations
2. Create New Integration
3. Set as Public integration
4. Add redirect: `http://localhost:3000/auth/callback`
5. Copy OAuth Client ID and Secret

### Farcaster
1. Get API key from https://neynar.com/
2. Add `NEYNAR_API_KEY` to env

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      OAuth3 Demo App                         │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Login Modal │  │ Session Info │  │ Identity/Account  │  │
│  │ (11+ OAuth  │  │ (TEE attest) │  │ (On-chain state)  │  │
│  │  providers) │  │              │  │                   │  │
│  └─────────────┘  └──────────────┘  └───────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │
                   ┌─────────▼─────────┐
                   │  Auth Server      │
                   │  (Simulated TEE)  │
                   │  Port 4200        │
                   └─────────┬─────────┘
                             │
    ┌────────────────────────┼────────────────────┐
    │                        │                    │
┌───▼───┐  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
│Discord│  │ Twitter │  │ Google  │  │ GitHub  │
│ OAuth │  │  OAuth  │  │  OAuth  │  │  OAuth  │
└───────┘  └─────────┘  └─────────┘  └─────────┘
    │                        │
┌───▼───┐  ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
│  Meta │  │LinkedIn │  │ TikTok  │  │  Slack  │
│ OAuth │  │  OAuth  │  │  OAuth  │  │  OAuth  │
└───────┘  └─────────┘  └─────────┘  └─────────┘
```

## Running E2E Tests

```bash
# Install Playwright browsers
bunx playwright install

# Run Synpress tests
bun run test:e2e

# Run headed (visible browser)
bun run test:e2e:headed
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check + enabled providers |
| `/providers` | GET | List all providers with status |
| `/attestation` | GET | Get TEE attestation |
| `/auth/init` | POST | Start OAuth flow |
| `/auth/callback` | POST | Handle OAuth callback |
| `/auth/wallet` | POST | Wallet SIWE login |
| `/session/:id` | GET | Get session |
| `/session/:id/refresh` | POST | Refresh session |
| `/session/:id` | DELETE | Logout |
| `/sign` | POST | Sign message with session key |
| `/credential/issue` | POST | Issue verifiable credential |
| `/credential/verify` | POST | Verify credential |

## Environment Variables

See `env.example` for complete list of all provider configurations.

## Smart Contracts

The OAuth3 system uses four main contracts:

| Contract | Purpose |
|----------|---------|
| `OAuth3IdentityRegistry` | On-chain identity storage, provider linking |
| `OAuth3AppRegistry` | Multi-tenant OAuth app registration |
| `OAuth3TEEVerifier` | TEE attestation verification, node staking |
| `AccountFactory` | ERC-4337 smart account deployment |

Deploy with:
```bash
cd packages/contracts
forge script script/DeployOAuth3.s.sol --rpc-url $RPC_URL --broadcast
```

## License

MIT
