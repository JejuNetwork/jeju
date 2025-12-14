# Signing & Deployment Setup Guide

This guide explains how to set up code signing and deployment for all platforms.

## Required GitHub Secrets

### General
- `WALLETCONNECT_PROJECT_ID` - WalletConnect project ID from https://cloud.walletconnect.com

### Tauri Desktop (macOS/Windows/Linux)
- `TAURI_PRIVATE_KEY` - Tauri update signing key (generate with `tauri signer generate`)
- `TAURI_KEY_PASSWORD` - Password for the signing key

### macOS Code Signing (for notarized builds)
- `APPLE_CERTIFICATE_BASE64` - Developer ID certificate (.p12) base64 encoded
- `APPLE_CERTIFICATE_PASSWORD` - Certificate password
- `APPLE_SIGNING_IDENTITY` - e.g., "Developer ID Application: Your Name (TEAMID)"
- `APPLE_ID` - Apple ID email
- `APPLE_APP_PASSWORD` - App-specific password from https://appleid.apple.com
- `APPLE_TEAM_ID` - Your Apple Developer Team ID

### iOS App Store
- `IOS_CERTIFICATE_BASE64` - Distribution certificate (.p12) base64 encoded
- `IOS_CERTIFICATE_PASSWORD` - Certificate password
- `IOS_PROVISIONING_PROFILE_BASE64` - App Store provisioning profile base64 encoded
- `IOS_PROVISIONING_PROFILE_NAME` - Profile name (e.g., "Jeju Wallet AppStore")
- `IOS_TEAM_ID` - Apple Developer Team ID
- `KEYCHAIN_PASSWORD` - Temporary keychain password (can be random)
- `APPSTORE_ISSUER_ID` - App Store Connect API issuer ID
- `APPSTORE_API_KEY_ID` - App Store Connect API key ID
- `APPSTORE_API_PRIVATE_KEY` - App Store Connect API private key (.p8 content)

### Android Play Store
- `ANDROID_KEYSTORE_BASE64` - Release keystore (.jks) base64 encoded
- `ANDROID_KEYSTORE_PASSWORD` - Keystore password
- `ANDROID_KEY_ALIAS` - Key alias in keystore
- `ANDROID_KEY_PASSWORD` - Key password
- `GOOGLE_PLAY_SERVICE_ACCOUNT` - Google Play Console service account JSON

### Chrome Web Store
- `CHROME_EXTENSION_ID` - Extension ID from Chrome Web Store
- `CHROME_CLIENT_ID` - OAuth client ID
- `CHROME_CLIENT_SECRET` - OAuth client secret
- `CHROME_REFRESH_TOKEN` - OAuth refresh token

### Firefox Add-ons
- `FIREFOX_API_KEY` - AMO API key
- `FIREFOX_API_SECRET` - AMO API secret

---

## Setup Instructions

### 1. Generate Tauri Signing Key
```bash
cd apps/wallet
bunx tauri signer generate -w ~/.tauri/jeju-wallet.key
# Save the private key to TAURI_PRIVATE_KEY secret
# Save the password to TAURI_KEY_PASSWORD secret
```

### 2. Android Keystore Setup
```bash
# Generate keystore
keytool -genkey -v -keystore jeju-wallet.jks -keyalg RSA -keysize 2048 -validity 10000 -alias jeju

# Base64 encode for GitHub secrets
base64 -i jeju-wallet.jks | tr -d '\n' > keystore.base64
# Copy content to ANDROID_KEYSTORE_BASE64 secret
```

### 3. iOS Certificate Setup
1. Create App Store distribution certificate in Apple Developer portal
2. Export as .p12 file with password
3. Base64 encode:
```bash
base64 -i Certificates.p12 | tr -d '\n' > cert.base64
```
4. Create provisioning profile for App Store distribution
5. Download and base64 encode:
```bash
base64 -i profile.mobileprovision | tr -d '\n' > profile.base64
```

### 4. App Store Connect API Key
1. Go to https://appstoreconnect.apple.com/access/api
2. Create new API key with App Manager role
3. Download .p8 file
4. Copy Issuer ID and Key ID

### 5. Google Play Service Account
1. Go to Google Play Console > Settings > API access
2. Create service account with release permissions
3. Download JSON key file
4. Copy entire JSON content to GOOGLE_PLAY_SERVICE_ACCOUNT secret

### 6. Chrome Web Store API
1. Go to https://console.cloud.google.com
2. Create OAuth 2.0 credentials
3. Use https://nicholasyoder.github.io/chrome-webstore-api-token-generator/ to get refresh token
4. Get extension ID from Chrome Web Store developer dashboard

### 7. Firefox Add-ons API
1. Go to https://addons.mozilla.org/developers/addon/api/key/
2. Generate API credentials
3. Copy key and secret

---

## Local Development

### Android Local Signing
Create `android/keystore.properties`:
```properties
storeFile=../path/to/jeju-wallet.jks
storePassword=your-keystore-password
keyAlias=jeju
keyPassword=your-key-password
```

### Running Locally
```bash
# Web
bun run dev

# Chrome Extension (load dist-ext-chrome as unpacked)
bun run build:ext:chrome

# Android
bun run android:build
bun run android:run

# iOS (requires macOS)
bun run ios:build
bun run ios:open  # Opens Xcode

# Desktop (Tauri)
bun run tauri:dev
```

