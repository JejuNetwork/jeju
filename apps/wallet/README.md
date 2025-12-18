# Network Wallet

**Fully permissionless agentic multi-chain wallet with seamless cross-chain UX.**

No chain switching. No manual bridging. No external API keys. Pay gas with any token. Account abstraction first.

## Platform Support

### Browser Extensions (5 browsers)

| Browser | Build Command | Store | Status |
|---------|---------------|-------|--------|
| Chrome | `bun run build:ext:chrome` | Chrome Web Store | ✅ Ready |
| Firefox | `bun run build:ext:firefox` | Firefox Add-ons | ✅ Ready |
| Safari | `bun run build:ext:safari` | Safari Extensions | ✅ Ready |
| Edge | `bun run build:ext:edge` | Edge Add-ons | ✅ Ready |
| Brave | `bun run build:ext:brave` | Uses Chrome MV3 | ✅ Ready |

### Desktop Apps (3 operating systems)

| Platform | Build Command | Distribution | Status |
|----------|---------------|--------------|--------|
| macOS (Apple Silicon) | `bun run tauri:build:mac` | DMG, Homebrew | ✅ Ready |
| macOS (Intel) | `bun run tauri:build:mac` | DMG | ✅ Ready |
| Windows | `bun run tauri:build:win` | MSI, Microsoft Store (MSIX) | ✅ Ready |
| Linux | `bun run tauri:build:linux` | DEB, AppImage, Snap, Flatpak | ✅ Ready |

### Mobile Apps (2 platforms)

| Platform | Build Command | Distribution | Status |
|----------|---------------|--------------|--------|
| Android | `bun run android:build:release` | Play Store (AAB), APK, F-Droid | ✅ Ready |
| iOS | `bun run ios:build` | App Store, TestFlight | ✅ Ready |

### Web App

| Platform | Build Command | Hosting | Status |
|----------|---------------|---------|--------|
| Web | `bun run build` | Any static host | ✅ Ready |

---

## Features

- **ElizaOS Agent Integration** - Chat-based wallet powered by ElizaOS framework
- **Bridgeless Cross-Chain Transfers** - Use EIL (Ethereum Interop Layer) for trustless atomic swaps
- **Intent-Based Transactions** - Express what you want via OIF (Open Intents Framework), solvers handle the rest
- **Multi-Token Gas Payment** - Pay gas in USDC, DAI, or any supported token
- **Account Abstraction (ERC-4337)** - Smart accounts with gasless transactions, batching, recovery
- **Unified Balance View** - See all assets across all chains in one place
- **Fully Permissionless** - No WalletConnect, no external APIs, all Jeju infrastructure

---

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

---

## Development Commands

### Web App
```bash
bun run dev          # Dev server at :4015
bun run build        # Production build
bun run preview      # Preview production build
```

### Browser Extensions
```bash
# Individual builds
bun run build:ext:chrome    # Chrome (Manifest V3)
bun run build:ext:firefox   # Firefox (Manifest V2)
bun run build:ext:safari    # Safari (Manifest V3)
bun run build:ext:edge      # Edge (Manifest V3)
bun run build:ext:brave     # Brave (uses Chrome MV3)

# Build all extensions
bun run build:extensions

# Load in browser:
# Chrome:  chrome://extensions → Load unpacked → select dist-ext-chrome/
# Firefox: about:debugging → Load Temporary Add-on → select dist-ext-firefox/manifest.json
# Safari:  Run `xcrun safari-web-extension-converter dist-ext-safari/` then load in Xcode
# Edge:    edge://extensions → Load unpacked → select dist-ext-edge/
# Brave:   brave://extensions → Load unpacked → select dist-ext-brave/
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
bun run android:build         # Build debug APK
bun run android:build:release # Build release APK + AAB
bun run android:run           # Run on device/emulator
bun run android:open          # Open in Android Studio

# iOS (requires macOS)
bun run ios:build             # Build and sync
bun run ios:open              # Open in Xcode
bun run ios:run               # Run on simulator
```

### Testing
```bash
bun run test              # Unit tests
bun run test:watch        # Watch mode
bun run test:coverage     # With coverage
bun run test:e2e          # E2E tests (Playwright)
bun run test:e2e:headed   # E2E with browser UI
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      NETWORK WALLET                          │
├──────────────────────────────────────────────────────────────┤
│  PLATFORMS                                                   │
│  ┌───────┐ ┌─────────────────────────┐ ┌────────┐ ┌───────┐ │
│  │  Web  │ │       Extensions        │ │Desktop │ │Mobile │ │
│  │ Vite  │ │Chrome/FF/Safari/Edge/Br │ │ Tauri  │ │Capacit│ │
│  └───┬───┘ └───────────┬─────────────┘ └───┬────┘ └───┬───┘ │
│      └─────────────────┼───────────────────┴──────────┘     │
│                        │                                     │
│  ┌─────────────────────┴────────────────────────────────────┐│
│  │                   WALLET CORE SDK                        ││
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌────────────┐  ││
│  │  │   EIL   │  │   OIF   │  │ Keyring │  │     AA     │  ││
│  │  │ Client  │  │ Client  │  │ Service │  │   Client   │  ││
│  │  └─────────┘  └─────────┘  └─────────┘  └────────────┘  ││
│  └──────────────────────────────────────────────────────────┘│
├──────────────────────────────────────────────────────────────┤
│  JEJU INFRASTRUCTURE  (No External APIs)                     │
│  ┌──────────────────────────────────────────────────────────┐│
│  │  RPC:     rpc.jeju.network/{eth,base,arbitrum,optimism}  ││
│  │  Oracle:  On-chain Jeju Oracle Network                   ││
│  │  Indexer: Self-hosted GraphQL indexer                    ││
│  │  Solver:  OIF decentralized solver network               ││
│  │  Bundler: ERC-4337 bundler infrastructure                ││
│  └──────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────┘
```

---

## CI/CD & Release

### GitHub Workflows

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `wallet-ci.yml` | PR/Push to main | Lint, test, build all platforms |
| `wallet-release.yml` | Release published | Build, sign, publish to all stores |

### Build Artifacts

| Platform | Artifact | Distribution |
|----------|----------|--------------|
| Web | `dist/` | Static hosting |
| Chrome | `dist-ext-chrome/` | Chrome Web Store |
| Firefox | `dist-ext-firefox/` | Firefox Add-ons |
| Safari | `dist-ext-safari/` | Safari Extensions |
| Edge | `dist-ext-edge/` | Edge Add-ons |
| Brave | `dist-ext-brave/` | Brave Store |
| macOS (ARM) | `.dmg` | Direct download, Homebrew |
| macOS (Intel) | `.dmg` | Direct download |
| Windows | `.msi`, `.msix` | Direct download, Microsoft Store |
| Linux | `.deb`, `.AppImage` | Direct download, package managers |
| Linux (Snap) | `.snap` | Snap Store |
| Linux (Flatpak) | `.flatpak` | Flathub |
| Android | `.apk`, `.aab` | Play Store, F-Droid, direct download |
| iOS | `.ipa` | App Store, TestFlight |

---

## Required GitHub Secrets

### Desktop Signing (Tauri)

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `TAURI_PRIVATE_KEY` | Tauri update signing key | `bunx tauri signer generate -w ~/.tauri/jeju.key` |
| `TAURI_KEY_PASSWORD` | Key password | Set during generation |

### macOS Code Signing & Notarization

| Secret | Description | How to Get |
|--------|-------------|------------|
| `APPLE_CERTIFICATE_BASE64` | Developer ID cert (.p12) | Export from Keychain, `base64 -i cert.p12` |
| `APPLE_CERTIFICATE_PASSWORD` | Certificate password | Set during export |
| `APPLE_SIGNING_IDENTITY` | Signing identity | e.g., "Developer ID Application: Name (ID)" |
| `APPLE_ID` | Apple ID email | Your Apple account |
| `APPLE_APP_PASSWORD` | App-specific password | https://appleid.apple.com |
| `APPLE_TEAM_ID` | 10-char team ID | Apple Developer portal |

### iOS App Store

| Secret | Description | How to Get |
|--------|-------------|------------|
| `IOS_CERTIFICATE_BASE64` | Distribution cert (.p12) | Export from Keychain |
| `IOS_CERTIFICATE_PASSWORD` | Certificate password | Set during export |
| `IOS_PROVISIONING_PROFILE_BASE64` | Profile (.mobileprovision) | `base64 -i profile.mobileprovision` |
| `IOS_PROVISIONING_PROFILE_NAME` | Profile name | Apple Developer portal |
| `IOS_TEAM_ID` | Team ID | Apple Developer portal |
| `KEYCHAIN_PASSWORD` | Temp keychain password | Any random string |
| `APPSTORE_ISSUER_ID` | API issuer ID | App Store Connect → API |
| `APPSTORE_API_KEY_ID` | API key ID | App Store Connect → API |
| `APPSTORE_API_PRIVATE_KEY` | .p8 file contents | Download from App Store Connect |

### Android Play Store

| Secret | Description | How to Generate |
|--------|-------------|-----------------|
| `ANDROID_KEYSTORE_BASE64` | Keystore (.jks) base64 | `keytool -genkey ...`, then `base64 -i keystore.jks` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | Set during creation |
| `ANDROID_KEY_ALIAS` | Key alias | e.g., "jeju" |
| `ANDROID_KEY_PASSWORD` | Key password | Set during creation |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | Service account JSON | Google Play Console → API access |

### Chrome Web Store

| Secret | Description | How to Get |
|--------|-------------|------------|
| `CHROME_EXTENSION_ID` | Extension ID | Chrome Web Store dashboard |
| `CHROME_CLIENT_ID` | OAuth client ID | Google Cloud Console |
| `CHROME_CLIENT_SECRET` | OAuth client secret | Google Cloud Console |
| `CHROME_REFRESH_TOKEN` | OAuth refresh token | [Token generator](https://nicholasyoder.github.io/chrome-webstore-api-token-generator/) |

### Firefox Add-ons

| Secret | Description | How to Get |
|--------|-------------|------------|
| `FIREFOX_API_KEY` | AMO API key | https://addons.mozilla.org/developers/addon/api/key/ |
| `FIREFOX_API_SECRET` | AMO API secret | Same page |

### Edge Add-ons

| Secret | Description | How to Get |
|--------|-------------|------------|
| `EDGE_PRODUCT_ID` | Product ID | Edge Partner Center |
| `EDGE_CLIENT_ID` | Client ID | Azure AD app registration |
| `EDGE_CLIENT_SECRET` | Client secret | Azure AD app registration |
| `EDGE_ACCESS_TOKEN_URL` | Token URL | Azure AD endpoints |

### Snap Store

| Secret | Description | How to Get |
|--------|-------------|------------|
| `SNAPCRAFT_TOKEN` | Snapcraft credentials | `snapcraft export-login --snaps=network-wallet` |

### Microsoft Store

| Secret | Description | How to Get |
|--------|-------------|------------|
| `MSSTORE_CLIENT_ID` | Azure AD client ID | Azure portal |
| `MSSTORE_CLIENT_SECRET` | Azure AD secret | Azure portal |
| `MSSTORE_TENANT_ID` | Azure AD tenant | Azure portal |
| `MSSTORE_PRODUCT_ID` | Store product ID | Partner Center |

### Windows Code Signing (Optional)

| Secret | Description | How to Get |
|--------|-------------|------------|
| `WINDOWS_CERT_BASE64` | Code signing cert (.pfx) | Certificate authority |
| `WINDOWS_CERT_PASSWORD` | Certificate password | Set during export |

---

## Local Development Setup

### Generate Tauri Signing Key
```bash
bunx tauri signer generate -w ~/.tauri/jeju-wallet.key
# Save output as TAURI_PRIVATE_KEY
```

### Generate Android Keystore
```bash
keytool -genkey -v -keystore jeju-wallet.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias jeju -storepass YOUR_PASSWORD

# For local development, create android/keystore.properties:
# storeFile=../path/to/jeju-wallet.jks
# storePassword=your-keystore-password
# keyAlias=jeju
# keyPassword=your-key-password
```

### iOS Certificate Setup
1. Create App Store distribution certificate in Apple Developer portal
2. Export as .p12 file with password
3. Create provisioning profile for App Store distribution
4. For CI, base64 encode: `base64 -i Certificates.p12 | tr -d '\n'`

---

## Store Listings

Store metadata is organized in:

```
apps/wallet/
├── fastlane/
│   ├── Fastfile              # iOS/Android deployment automation
│   ├── Appfile               # App identifiers
│   ├── Matchfile             # iOS code signing
│   └── metadata/
│       ├── android/en-US/    # Play Store listing
│       │   ├── title.txt
│       │   ├── short_description.txt
│       │   ├── full_description.txt
│       │   └── changelogs/
│       └── ios/en-US/        # App Store listing
│           ├── name.txt
│           ├── subtitle.txt
│           ├── description.txt
│           ├── keywords.txt
│           └── release_notes.txt
├── store/
│   ├── chrome/               # Chrome Web Store
│   │   ├── description.txt
│   │   └── short_description.txt
│   └── firefox/              # Firefox Add-ons
│       └── description.txt
├── snap/                     # Snap Store
│   ├── snapcraft.yaml
│   └── local/
│       └── network-wallet.desktop
├── flatpak/                  # Flathub
│   ├── network.jeju.wallet.yml
│   ├── network.jeju.wallet.desktop
│   └── network.jeju.wallet.metainfo.xml
├── msix/                     # Microsoft Store
│   ├── AppxManifest.xml
│   └── mapping.txt
└── fdroid/                   # F-Droid
    └── network.jeju.wallet.yml
```

---

## Deep Links & Universal Links

### URL Schemes

| Platform | Scheme | Example |
|----------|--------|---------|
| All | `jeju://` | `jeju://send?to=0x...&amount=1.0` |
| WalletConnect | `wc://` | `wc:a]...` |

### Universal Links (iOS/Android)

| Domain | Purpose |
|--------|---------|
| `wallet.jejunetwork.org` | App links, web credentials |

### Desktop Protocol Handler

The Tauri app registers `jeju://` scheme on installation.

---

## ElizaOS Agent

The wallet is powered by an ElizaOS agent that handles:
- Natural language transaction requests ("Send 0.5 ETH to alice.eth")
- Portfolio queries and DeFi guidance
- Swap routing and cross-chain operations
- Security analysis and transaction simulation

### Configuration

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
bun run eliza:dev

# Or connect to existing ElizaOS server
VITE_ELIZA_API_URL=http://your-eliza-server:3000 bun run dev
```

---

## Contract Integration

| Contract | Purpose |
|----------|---------|
| `CrossChainPaymaster` | Multi-token gas payment, EIL voucher system |
| `L1StakeManager` | XLP stake verification for cross-chain security |
| `InputSettler` | OIF intent submission on source chain |
| `OutputSettler` | OIF intent fulfillment on destination chain |
| `SolverRegistry` | Active solver discovery |
| `EntryPoint` | ERC-4337 account abstraction |

---

## Security

1. **Key Storage**: Platform-specific secure storage (Keychain iOS, Keystore Android, OS keyring desktop)
2. **Transaction Simulation**: Always simulate before sending
3. **Cross-Chain Verification**: Verify oracle attestations for OIF
4. **Paymaster Trust**: Only use verified paymasters from Jeju's registry
5. **Smart Account Recovery**: Social recovery for smart accounts

---

## Network Configuration

### Localnet (Development)
```bash
# Start local development environment
bun run jeju dev  # or: anvil --chain-id 1337 --port 9545

# RPC: http://localhost:9545
# Chain ID: 1337
```

### Testnet (Base Sepolia)
```bash
export VITE_JEJU_RPC_URL=https://rpc.testnet.jeju.network
```

### Production (Base Mainnet)
```bash
export VITE_JEJU_RPC_URL=https://rpc.jeju.network
```

---

## License

MIT
