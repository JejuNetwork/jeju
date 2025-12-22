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

#### Unit Tests
```bash
bun run test              # Run all unit tests (190+ tests)
bun run test:watch        # Watch mode
bun run test:coverage     # With coverage report
```

#### E2E Tests (Playwright)
```bash
# Live E2E tests (requires localnet running)
bun run test:e2e          # All live E2E tests (47+ tests)
bun run test:e2e:live     # Same as above

# Extension E2E tests (requires headed browser)
bun run test:e2e:extension  # Test extension in Chrome (6 tests)

# MetaMask integration tests (requires Synpress cache)
bun run synpress:cache      # Create MetaMask wallet cache (first time)
bun run test:e2e:metamask   # Run MetaMask E2E tests (10 tests)

# All E2E tests
bun run test:e2e:all        # Run all E2E test suites
bun run test:e2e:headed     # Run with browser UI visible
bun run test:e2e:debug      # Debug mode

# CI-specific (with Xvfb for headed tests)
bun run test:e2e:ci         # Run all E2E with virtual display
bun run synpress:cache:ci   # Create cache with virtual display
```

#### Test Coverage
| Test Type | Count | Description |
|-----------|-------|-------------|
| Unit Tests | 190+ | Core logic, hooks, services |
| Live E2E | 47+ | App loading, RPC, transactions, UI |
| Extension E2E | 6 | dApp connection, EIP-6963 |
| MetaMask E2E | 10 | Wallet connection, signing, transactions |
| **Total** | **253+** | All automated tests |

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
│  │  RPC:     rpc.jejunetwork.org/{eth,base,arbitrum,optimism}  ││
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
VITE_JEJU_RPC_URL=https://rpc.jejunetwork.org
VITE_JEJU_GATEWAY_URL=https://compute.jejunetwork.org
VITE_JEJU_INDEXER_URL=https://indexer.jejunetwork.org
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
export VITE_JEJU_RPC_URL=https://rpc.testnet.jejunetwork.org
```

### Production (Base Mainnet)
```bash
export VITE_JEJU_RPC_URL=https://rpc.jejunetwork.org
```

# Signing & Deployment Setup Guide

This guide explains how to set up code signing and deployment for all platforms.

## Table of Contents

1. [Desktop (Tauri)](#1-desktop-tauri)
2. [macOS Notarization](#2-macos-notarization)
3. [Windows Code Signing](#3-windows-code-signing)
4. [iOS App Store](#4-ios-app-store)
5. [Android Play Store](#5-android-play-store)
6. [Chrome Web Store](#6-chrome-web-store)
7. [Firefox Add-ons](#7-firefox-add-ons)
8. [Edge Add-ons](#8-edge-add-ons)
9. [Snap Store](#9-snap-store)
10. [Microsoft Store](#10-microsoft-store)
11. [F-Droid](#11-f-droid)

---

## 1. Desktop (Tauri)

Tauri uses its own signing system for auto-updates.

### Generate Signing Key

```bash
cd apps/wallet
bunx tauri signer generate -w ~/.tauri/network-wallet.key
```

This outputs:
- A private key (save to `TAURI_PRIVATE_KEY` secret)
- A password (save to `TAURI_KEY_PASSWORD` secret)
- A public key (included in `tauri.conf.json` for verification)

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `TAURI_PRIVATE_KEY` | The full private key output |
| `TAURI_KEY_PASSWORD` | The password you set |

---

## 2. macOS Notarization

Apple requires notarization for apps distributed outside the App Store.

### Prerequisites

1. Apple Developer Program membership ($99/year)
2. Developer ID Application certificate
3. App-specific password for notarization

### Setup Steps

1. **Create Developer ID Certificate**
   - Go to https://developer.apple.com/account/resources/certificates/list
   - Click "+" → "Developer ID Application"
   - Download and install in Keychain

2. **Export Certificate**
   ```bash
   # Open Keychain Access, find "Developer ID Application: Your Name"
   # Right-click → Export → Save as .p12 with password
   
   # Base64 encode for CI
   base64 -i DeveloperIDApplication.p12 | tr -d '\n' > cert.txt
   ```

3. **Create App-Specific Password**
   - Go to https://appleid.apple.com/account/manage
   - Sign In → App-Specific Passwords → Generate

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `APPLE_CERTIFICATE_BASE64` | Base64 encoded .p12 certificate |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 export password |
| `APPLE_SIGNING_IDENTITY` | "Developer ID Application: Your Name (TEAMID)" |
| `APPLE_ID` | your-apple-id@example.com |
| `APPLE_APP_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Your 10-character Team ID |

---

## 3. Windows Code Signing

Windows code signing requires an EV or standard code signing certificate.

### Options

1. **EV Certificate** (Extended Validation) - Immediate SmartScreen trust
2. **Standard Certificate** - Builds trust over time with downloads

### Certificate Providers

- DigiCert, Sectigo, GlobalSign, SSL.com

### Setup

```bash
# Export certificate as .pfx
# Base64 encode
base64 -i certificate.pfx | tr -d '\n' > cert.txt
```

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `WINDOWS_CERT_BASE64` | Base64 encoded .pfx |
| `WINDOWS_CERT_PASSWORD` | Certificate password |

---

## 4. iOS App Store

### Prerequisites

1. Apple Developer Program membership
2. App Store distribution certificate
3. App Store provisioning profile

### Setup Steps

1. **Create Distribution Certificate**
   - https://developer.apple.com/account/resources/certificates/list
   - Click "+" → "Apple Distribution"
   - Generate CSR using Keychain Access
   - Download and install certificate

2. **Create App ID**
   - https://developer.apple.com/account/resources/identifiers/list
   - Click "+" → "App IDs"
   - Bundle ID: `network.jeju.wallet`

3. **Create Provisioning Profile**
   - https://developer.apple.com/account/resources/profiles/list
   - Click "+" → "App Store"
   - Select your App ID and certificate

4. **Export Certificate**
   ```bash
   # Export from Keychain as .p12
   base64 -i Certificates.p12 | tr -d '\n' > cert.txt
   
   # Base64 encode provisioning profile
   base64 -i NetworkWallet_AppStore.mobileprovision | tr -d '\n' > profile.txt
   ```

5. **Create App Store Connect API Key**
   - https://appstoreconnect.apple.com/access/api
   - Click "+" → Generate with "App Manager" role
   - Download .p8 key file

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `IOS_CERTIFICATE_BASE64` | Base64 encoded .p12 |
| `IOS_CERTIFICATE_PASSWORD` | .p12 password |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64 encoded .mobileprovision |
| `IOS_PROVISIONING_PROFILE_NAME` | Profile name from Developer portal |
| `IOS_TEAM_ID` | Your Team ID |
| `KEYCHAIN_PASSWORD` | Random string for CI keychain |
| `APPSTORE_ISSUER_ID` | From API keys page |
| `APPSTORE_API_KEY_ID` | Key ID from API keys page |
| `APPSTORE_API_PRIVATE_KEY` | Contents of .p8 file |

---

## 5. Android Play Store

### Generate Signing Key

```bash
# Create keystore
keytool -genkey -v \
  -keystore network-wallet.jks \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -alias network-wallet \
  -dname "CN=Network Wallet, O=Jeju Network, C=US"

# Base64 encode for CI
base64 -i network-wallet.jks | tr -d '\n' > keystore.txt
```

### Local Development

Create `android/keystore.properties`:

```properties
storeFile=../network-wallet.jks
storePassword=your-keystore-password
keyAlias=network-wallet
keyPassword=your-key-password
```

### Setup Play Store API

1. Go to Google Play Console → Settings → API access
2. Link or create a Google Cloud project
3. Create service account with "Release manager" role
4. Download JSON key file

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `ANDROID_KEYSTORE_BASE64` | Base64 encoded .jks |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password |
| `ANDROID_KEY_ALIAS` | Key alias (e.g., "network-wallet") |
| `ANDROID_KEY_PASSWORD` | Key password |
| `GOOGLE_PLAY_SERVICE_ACCOUNT` | Entire JSON key file contents |

---

## 6. Chrome Web Store

### Prerequisites

1. Google Cloud project
2. Chrome Web Store developer account ($5 one-time fee)

### Setup Steps

1. **Register Extension**
   - Go to https://chrome.google.com/webstore/developer/dashboard
   - Pay $5 registration fee
   - Upload initial extension to get Extension ID

2. **Create OAuth Credentials**
   - Go to https://console.cloud.google.com/apis/credentials
   - Create OAuth 2.0 Client ID (Desktop app type)
   - Note Client ID and Client Secret

3. **Get Refresh Token**
   - Use https://nicholasyoder.github.io/chrome-webstore-api-token-generator/
   - Authorize with your Google account
   - Copy the refresh token

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `CHROME_EXTENSION_ID` | 32-character extension ID |
| `CHROME_CLIENT_ID` | OAuth client ID |
| `CHROME_CLIENT_SECRET` | OAuth client secret |
| `CHROME_REFRESH_TOKEN` | OAuth refresh token |

---

## 7. Firefox Add-ons

### Setup Steps

1. Go to https://addons.mozilla.org/developers/addon/api/key/
2. Generate API credentials
3. Note your JWT issuer (key) and secret

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `FIREFOX_API_KEY` | JWT issuer |
| `FIREFOX_API_SECRET` | JWT secret |

---

## 8. Edge Add-ons

### Prerequisites

1. Microsoft Partner Center account
2. Azure AD app registration

### Setup Steps

1. **Submit Extension to Partner Center**
   - https://partner.microsoft.com/dashboard/microsoftedge/
   - Create new extension submission
   - Note the Product ID

2. **Create Azure AD App**
   - https://portal.azure.com → Azure Active Directory → App registrations
   - Create new registration
   - Add API permissions: "Windows Store submission API"
   - Create client secret

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `EDGE_PRODUCT_ID` | From Partner Center |
| `EDGE_CLIENT_ID` | Azure AD app client ID |
| `EDGE_CLIENT_SECRET` | Azure AD client secret |
| `EDGE_ACCESS_TOKEN_URL` | `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` |

---

## 9. Snap Store

### Prerequisites

1. Ubuntu One account
2. Snapcraft login

### Setup Steps

```bash
# Login to Snapcraft
snapcraft login

# Export credentials for CI
snapcraft export-login --snaps=network-wallet snapcraft.txt
```

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `SNAPCRAFT_TOKEN` | Contents of snapcraft.txt |

---

## 10. Microsoft Store

### Prerequisites

1. Microsoft Partner Center account
2. Azure AD app registration

### Setup Steps

1. **Reserve App Name**
   - https://partner.microsoft.com/dashboard/products
   - Create new app → Reserve name

2. **Create Azure AD App**
   - Associate your Partner Center with Azure AD
   - Create app registration with Store submission permissions

3. **Get Credentials**
   - Note Tenant ID, Client ID, and create Client Secret

### GitHub Secrets Required

| Secret | Value |
|--------|-------|
| `MSSTORE_TENANT_ID` | Azure AD tenant ID |
| `MSSTORE_CLIENT_ID` | Azure AD app client ID |
| `MSSTORE_CLIENT_SECRET` | Azure AD client secret |
| `MSSTORE_PRODUCT_ID` | From Partner Center |

---

## 11. F-Droid

F-Droid builds apps from source, so no signing secrets are needed in CI.

### Setup Steps

1. Submit your app to F-Droid: https://f-droid.org/docs/Submitting_to_F-Droid_Quickstart/
2. Create metadata file at `fdroid/network.jeju.wallet.yml`
3. F-Droid will build and sign the app themselves

---

## Local Development Quick Reference

### All-in-One Setup Script

```bash
#!/bin/bash
# Generate all signing keys for local development

# 1. Tauri signing key
bunx tauri signer generate -w ~/.tauri/network-wallet.key

# 2. Android keystore
keytool -genkey -v \
  -keystore ~/.android/network-wallet.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias network-wallet

# Create android/keystore.properties
cat > android/keystore.properties << EOF
storeFile=~/.android/network-wallet.jks
storePassword=YOUR_PASSWORD
keyAlias=network-wallet
keyPassword=YOUR_PASSWORD
EOF

echo "Done! Now configure the remaining secrets in GitHub."
```

---

## Verifying Setup

After configuring all secrets, test the release workflow:

```bash
# Trigger a test release
gh workflow run wallet-release.yml -f version=0.0.1-test -f publish_stores=false
```

Check the Actions tab for any failures and address missing secrets.


---

## License

MIT
