# Jeju Wallet

**Fully permissionless agentic multi-chain wallet with seamless cross-chain UX.**

No chain switching. No manual bridging. No external API keys. Pay gas with any token. Account abstraction first.

## Platform Support

| Platform | Build | Status |
|----------|-------|--------|
| Web App | `bun run build` | ✅ Ready |
| Chrome Extension | `bun run build:ext:chrome` | ✅ Ready |
| Firefox Extension | `bun run build:ext:firefox` | ✅ Ready |
| macOS (arm64/x64) | `bun run tauri:build:mac` | ✅ Ready |
| Windows | `bun run tauri:build:win` | ✅ Ready |
| Linux | `bun run tauri:build:linux` | ✅ Ready |
| Android | `bun run android:build` | ✅ Ready |
| iOS | `bun run ios:build` | ✅ Ready |

## Features

- **ElizaOS Agent Integration** - Chat-based wallet powered by ElizaOS framework
- **Bridgeless Cross-Chain Transfers** - Use EIL (Ethereum Interop Layer) for trustless atomic swaps
- **Intent-Based Transactions** - Express what you want via OIF (Open Intents Framework), solvers handle the rest
- **Multi-Token Gas Payment** - Pay gas in USDC, DAI, or any supported token
- **Account Abstraction (ERC-4337)** - Smart accounts with gasless transactions, batching, recovery
- **Unified Balance View** - See all assets across all chains in one place
- **Fully Permissionless** - No WalletConnect, no external APIs, all Jeju infrastructure

## ElizaOS Agent

The Jeju Wallet is powered by an ElizaOS agent that handles:
- Natural language transaction requests ("Send 0.5 ETH to alice.eth")
- Portfolio queries and DeFi guidance
- Swap routing and cross-chain operations
- Security analysis and transaction simulation

### Agent Configuration

The wallet connects to ElizaOS in this priority order:
1. **ElizaOS Server** - If `VITE_ELIZA_API_URL` is configured
2. **Jeju Inference Gateway** - Decentralized compute network
3. **Local Fallback** - Basic command parsing (offline mode)

### Environment Variables

```bash
# ElizaOS Configuration (optional - enables full agent features)
VITE_ELIZA_API_URL=http://localhost:3000    # ElizaOS server URL
VITE_ELIZA_AGENT_ID=jeju-wallet             # Agent ID to connect to
VITE_ELIZA_WS_URL=http://localhost:3000     # WebSocket for real-time updates

# Jeju Infrastructure (default RPC, no API keys needed)
VITE_JEJU_RPC_URL=https://rpc.jeju.network
VITE_JEJU_GATEWAY_URL=https://compute.jeju.network
VITE_JEJU_INDEXER_URL=https://indexer.jeju.network
```

### Running with ElizaOS

```bash
# Start ElizaOS with Jeju Wallet agent
cd apps/wallet
bun run eliza:dev      # Starts ElizaOS with wallet plugin

# Or connect to existing ElizaOS server
VITE_ELIZA_API_URL=http://your-eliza-server:3000 bun run dev
```

### Plugin Development

The wallet plugin exports actions compatible with ElizaOS:

```typescript
import { jejuWalletPlugin } from '@jejunetwork/wallet';

// Use in ElizaOS character
export const character = {
  plugins: [jejuWalletPlugin],
  // ...
};
```

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                       JEJU WALLET                            │
├──────────────────────────────────────────────────────────────┤
│  PLATFORMS                                                   │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌────────┐ │
│  │   Web   │ │Extension│ │ Desktop │ │ Android │ │  iOS   │ │
│  │  Vite   │ │Chrome/FF│ │  Tauri  │ │Capacitor│ │Capacitor│ │
│  └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └───┬────┘ │
│       └───────────┴───────────┼───────────┴──────────┘      │
│                               │                              │
│  ┌────────────────────────────┴────────────────────────────┐ │
│  │                    WALLET CORE SDK                       │ │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────────┐  │ │
│  │  │   EIL   │  │   OIF   │  │  Keyring │  │     AA     │  │ │
│  │  │ Client  │  │ Client  │  │ Service  │  │   Client   │  │ │
│  │  └────┬────┘  └────┬────┘  └─────┬────┘  └──────┬─────┘  │ │
│  │       └────────────┼─────────────┴──────────────┘        │ │
│  └────────────────────┼─────────────────────────────────────┘ │
├───────────────────────┼──────────────────────────────────────┤
│  JEJU INFRASTRUCTURE  │  (No External APIs)                  │
│  ┌────────────────────┴─────────────────────────────────────┐│
│  │  RPC:     rpc.jeju.network/{eth,base,arbitrum,optimism}  ││
│  │  Oracle:  On-chain Jeju Oracle Network                   ││
│  │  Indexer: Self-hosted GraphQL indexer                    ││
│  │  Solver:  OIF decentralized solver network               ││
│  │  Bundler: ERC-4337 bundler infrastructure                ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install dependencies
bun install

# Run development server
bun run dev

# Run tests
bun run test

# Build all platforms
bun run build:all
```

## Development Commands

### Web App
```bash
bun run dev          # Dev server at :4015
bun run build        # Production build
bun run preview      # Preview production build
```

### Browser Extensions
```bash
bun run build:ext:chrome    # Chrome (Manifest V3)
bun run build:ext:firefox   # Firefox (Manifest V2)
bun run build:all           # All platforms

# Load in browser:
# Chrome: chrome://extensions → Load unpacked → select dist-ext-chrome/
# Firefox: about:debugging → Load Temporary Add-on → select dist-ext-firefox/manifest.json
```

### Desktop (Tauri)
```bash
bun run tauri:dev           # Dev with hot reload
bun run tauri:build         # Build for current platform
bun run tauri:build:mac     # macOS (arm64 + x64)
bun run tauri:build:win     # Windows
bun run tauri:build:linux   # Linux (deb + AppImage)
```

### Mobile (Capacitor)
```bash
# Android
bun run android:build       # Build debug APK
bun run android:build:release  # Build release APK + AAB
bun run android:run         # Run on device/emulator
bun run android:open        # Open in Android Studio

# iOS (requires macOS)
bun run ios:build           # Build and sync
bun run ios:open            # Open in Xcode
bun run ios:run             # Run on simulator
```

### Testing
```bash
bun run test                # Unit tests (Vitest)
bun run test:watch          # Watch mode
bun run test:coverage       # With coverage
bun run test:e2e            # E2E tests (Playwright)
bun run test:e2e:headed     # E2E with browser UI
```

---

## CI/CD & Release

### GitHub Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `wallet-ci.yml` | PR/Push to main | Lint, test, build all platforms |
| `wallet-release.yml` | Release published | Build, sign, publish to stores |

### Artifacts Generated

- **Web**: `dist/` folder, deployable to any static host
- **Chrome**: `dist-ext-chrome/` → Chrome Web Store
- **Firefox**: `dist-ext-firefox/` → Firefox Add-ons
- **macOS**: `.dmg` installer (arm64 + x64)
- **Windows**: `.msi` installer
- **Linux**: `.deb` + `.AppImage`
- **Android**: `.apk` (direct install) + `.aab` (Play Store)
- **iOS**: `.ipa` → App Store Connect

---

## Required GitHub Secrets

### Code Signing - Desktop (Tauri)

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `TAURI_PRIVATE_KEY` | Tauri update signing key | `bunx tauri signer generate -w ~/.tauri/jeju.key` |
| `TAURI_KEY_PASSWORD` | Key password | Set during generation |

### Code Signing - macOS

| Secret | Description | How to Get |
|--------|-------------|------------|
| `APPLE_CERTIFICATE_BASE64` | Developer ID cert (.p12) base64 | Export from Keychain, `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password | Set during export |
| `APPLE_SIGNING_IDENTITY` | e.g., "Developer ID Application: Name (ID)" | Apple Developer portal |
| `APPLE_ID` | Apple ID email | Your Apple account |
| `APPLE_APP_PASSWORD` | App-specific password | https://appleid.apple.com |
| `APPLE_TEAM_ID` | 10-char team ID | Apple Developer portal |

### Code Signing - iOS

| Secret | Description | How to Get |
|--------|-------------|------------|
| `IOS_CERTIFICATE_BASE64` | Distribution cert (.p12) base64 | Export from Keychain |
| `IOS_CERTIFICATE_PASSWORD` | Certificate password | Set during export |
| `IOS_PROVISIONING_PROFILE_BASE64` | Provisioning profile base64 | `base64 -i profile.mobileprovision` |
| `IOS_PROVISIONING_PROFILE_NAME` | Profile name | Apple Developer portal |
| `IOS_TEAM_ID` | Team ID | Apple Developer portal |
| `KEYCHAIN_PASSWORD` | Temp keychain password | Any random string |

### Code Signing - Android

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `ANDROID_KEYSTORE_BASE64` | Keystore (.jks) base64 | `keytool -genkey ...`, then `base64 -i keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | Set during creation |
| `ANDROID_KEY_ALIAS` | Key alias | e.g., "jeju" |
| `ANDROID_KEY_PASSWORD` | Key password | Set during creation |

### Store Publishing - App Store Connect

| Secret | Description | How to Get |
|--------|-------------|------------|
| `APPSTORE_ISSUER_ID` | API issuer ID | https://appstoreconnect.apple.com/access/api |
| `APPSTORE_API_KEY_ID` | API key ID | Create in App Store Connect |
| `APPSTORE_API_PRIVATE_KEY` | .p8 file contents | Download from App Store Connect |

### Store Publishing - Google Play

| Secret | Description | How to Get |
|--------|-------------|------------|
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | Service account JSON | Google Play Console → API access |

### Store Publishing - Chrome Web Store

| Secret | Description | How to Get |
|--------|-------------|------------|
| `CHROME_EXTENSION_ID` | Extension ID | Chrome Web Store dashboard |
| `CHROME_CLIENT_ID` | OAuth client ID | Google Cloud Console |
| `CHROME_CLIENT_SECRET` | OAuth client secret | Google Cloud Console |
| `CHROME_REFRESH_TOKEN` | OAuth refresh token | [Token generator](https://nicholasyoder.github.io/chrome-webstore-api-token-generator/) |

### Store Publishing - Firefox Add-ons

| Secret | Description | How to Get |
|--------|-------------|------------|
| `FIREFOX_API_KEY` | AMO API key | https://addons.mozilla.org/developers/addon/api/key/ |
| `FIREFOX_API_SECRET` | AMO API secret | Same page |

---

## Local Development Setup

### Android Local Signing

Create `android/keystore.properties`:
```properties
storeFile=../path/to/jeju-wallet.jks
storePassword=your-keystore-password
keyAlias=jeju
keyPassword=your-key-password
```

### Generate Android Keystore
```bash
keytool -genkey -v -keystore jeju-wallet.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias jeju -storepass YOUR_PASSWORD
```

### Generate Tauri Signing Key
```bash
bunx tauri signer generate -w ~/.tauri/jeju-wallet.key
```

---

## Contract Integration

The wallet integrates with these Jeju contracts:

| Contract | Purpose |
|----------|---------|
| `CrossChainPaymaster` | Multi-token gas payment, EIL voucher system |
| `L1StakeManager` | XLP stake verification for cross-chain security |
| `InputSettler` | OIF intent submission on source chain |
| `OutputSettler` | OIF intent fulfillment on destination chain |
| `SolverRegistry` | Active solver discovery |
| `EntryPoint` | ERC-4337 account abstraction |

## dApp Connection Methods

| Platform | Method | Protocol |
|----------|--------|----------|
| Browser Extension | `window.ethereum` | EIP-1193, EIP-6963 |
| Mobile | Deep links | `jeju://` scheme |
| Desktop | Protocol handler | `jeju://` scheme |

## Security Considerations

1. **Key Storage**: Platform-specific secure storage (Keychain iOS, Keystore Android, OS keyring desktop)
2. **Transaction Simulation**: Always simulate before sending
3. **Cross-Chain Verification**: Verify oracle attestations for OIF
4. **Paymaster Trust**: Only use verified paymasters from Jeju's registry
5. **Smart Account Recovery**: Social recovery for smart accounts

## Environment Variables

### Inference API Keys (Required for AI Chat)

The AI chat requires a real LLM API key. Set ONE of these:

| Variable | Provider | Get Key |
|----------|----------|---------|
| `OPENAI_API_KEY` | OpenAI (GPT-4o) | https://platform.openai.com/api-keys |
| `ANTHROPIC_API_KEY` | Anthropic (Claude) | https://console.anthropic.com/ |
| `GROQ_API_KEY` | Groq (Llama 3.1) | https://console.groq.com/keys |

Groq is recommended for development - it's the fastest and has a free tier.

```bash
# Example: Set Groq API key
export GROQ_API_KEY=gsk_xxxxxxxxxxxxx
```

### Wallet Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_JEJU_RPC_URL` | Jeju RPC base URL | `https://rpc.jeju.network` |
| `VITE_JEJU_GATEWAY_URL` | AI inference gateway | `http://localhost:4100` (dev), `https://compute.jeju.network` (prod) |
| `VITE_JEJU_INDEXER_URL` | Indexer URL | `http://localhost:4352` |
| `VITE_JEJU_GRAPHQL_URL` | GraphQL endpoint | `http://localhost:4350/graphql` |
| `VITE_JEJU_BUNDLER_URL` | ERC-4337 bundler | `http://localhost:4337` |
| `VITE_JEJU_SOLVER_URL` | OIF solver API | `https://solver.jeju.network/api` |

## Network Configuration

### Localnet (Development)
```bash
# Start local development environment
bun run jeju dev  # or manually: anvil --chain-id 1337 --port 9545

# RPC: http://localhost:9545
# Chain ID: 1337
# Inference: http://localhost:4100
```

### Testnet (Base Sepolia)
```bash
# Configure testnet
export VITE_JEJU_RPC_URL=https://rpc.testnet.jeju.network
export VITE_JEJU_GATEWAY_URL=https://compute.testnet.jeju.network

# Deploy testnet
bun run scripts/setup-testnet.ts
```

### Production (Base Mainnet)
```bash
# Configure production
export VITE_JEJU_RPC_URL=https://rpc.jeju.network
export VITE_JEJU_GATEWAY_URL=https://compute.jeju.network

# Build for production
bun run build
```

## License

MIT
