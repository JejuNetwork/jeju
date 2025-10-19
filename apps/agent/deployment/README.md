# ElizaOS Deployment Directory

This directory contains all configurations, scripts, and documentation for deploying ElizaOS to various app stores and distribution platforms.

## Directory Structure

```
deployment/
├── README.md                  # This file
├── README_APPSTORE.md         # Comprehensive app store deployment guide
├── setup-app-stores.sh        # Quick setup script
├── steam/                     # Steam deployment files
├── microsoft-store/           # Microsoft Store deployment files
├── mac-app-store/            # Mac App Store deployment files
└── linux-stores/             # Linux distribution files (Snap, Flatpak)
```

## Quick Start

1. **Run the setup script** (from this directory):

   ```bash
   cd deployment
   ./setup-app-stores.sh
   ```

2. **Review platform requirements**:

   - See `README_APPSTORE.md` for comprehensive documentation
   - Each platform has its own README in its respective folder

3. **Configure your credentials**:
   - Set up environment variables for each platform
   - Download required SDKs and certificates

## Platform Overview

### 🎮 Steam

- **Location**: `steam/`
- **Cost**: $100 one-time
- **Features**: Achievements, Cloud Saves, Workshop

### 🪟 Microsoft Store

- **Location**: `microsoft-store/`
- **Cost**: $19-99 one-time
- **Format**: MSIX packages

### 🍎 Mac App Store

- **Location**: `mac-app-store/`
- **Cost**: $99/year
- **Requirements**: Apple Developer account, code signing

### 🐧 Linux Stores

- **Location**: `linux-stores/`
- **Platforms**: Snap Store (free), Flathub (free)
- **Formats**: Snap packages, Flatpak bundles

## Automated Deployment

GitHub Actions workflow is configured for automated deployment:

- **Workflow**: `.github/workflows/app-store-deploy.yml`
- **Triggers**: On release or manual dispatch
- **Platforms**: All stores can be deployed automatically

## Required Secrets

Configure these in your GitHub repository settings:

### Steam

- `STEAM_USERNAME`
- `STEAM_PASSWORD`
- `STEAM_APP_ID`
- `STEAM_CONFIG_VDF`

### Microsoft Store

- `MS_PACKAGE_NAME`
- `MS_PUBLISHER`
- `MS_PUBLISHER_DISPLAY`
- `MS_TENANT_ID`
- `MS_SELLER_ID`
- `MS_CLIENT_ID`
- `MS_CLIENT_SECRET`
- `MS_PRODUCT_ID`
- `MS_CERTIFICATE_PATH`
- `MS_CERTIFICATE_PASSWORD`

### Mac App Store

- `APPLE_ID`
- `APPLE_TEAM_ID`
- `APPLE_APP_PASSWORD`
- `APPLE_CERTIFICATES_P12`
- `APPLE_CERTIFICATES_PASSWORD`
- `APPLE_PROVISIONING_PROFILE`

### Linux Stores

- `SNAPCRAFT_STORE_CREDENTIALS`

## Build Commands

From the deployment directory:

```bash
# Steam
cd steam && ./scripts/build_steam.sh

# Microsoft Store
cd microsoft-store && powershell ./scripts/build_msix.ps1

# Mac App Store
cd mac-app-store && ./scripts/build_mas.sh

# Snap Store
cd linux-stores/snap && snapcraft

# Flathub
cd linux-stores/flatpak && flatpak-builder --repo=repo build-dir com.elizaos.Game.yml
```

## Support

For platform-specific issues:

- **Steam**: [Steamworks Forums](https://steamcommunity.com/groups/steamworks/discussions/)
- **Microsoft**: [Partner Center Support](https://partner.microsoft.com/support)
- **Apple**: [Developer Forums](https://developer.apple.com/forums/)
- **Linux**: [Snapcraft Forum](https://forum.snapcraft.io/), [Flatpak Matrix](https://matrix.to/#/#flatpak:matrix.org)
