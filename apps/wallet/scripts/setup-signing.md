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
