#!/bin/bash
# Setup script for app store deployment directories
# Run this from the deployment folder

echo "🚀 Setting up app store deployment structure..."

# Ensure we're in the deployment directory
if [ ! -f "README_APPSTORE.md" ]; then
    echo "❌ Error: Please run this script from the deployment folder"
    exit 1
fi

# Create directory structure
directories=(
    "steam/scripts"
    "steam/vdf"
    "steam/assets/screenshots"
    "steam/sdk"
    "microsoft-store/scripts"
    "microsoft-store/assets"
    "mac-app-store/scripts"
    "mac-app-store/assets/screenshots"
    "linux-stores/snap"
    "linux-stores/flatpak/icons"
)

for dir in "${directories[@]}"; do
    mkdir -p "$dir"
    echo "📁 Created $dir"
done

# Make scripts executable
chmod +x steam/scripts/*.sh 2>/dev/null || true
chmod +x mac-app-store/scripts/*.sh 2>/dev/null || true
chmod +x linux-stores/flatpak/build.sh 2>/dev/null || true

# Create placeholder files
touch steam/steam_appid.txt
touch microsoft-store/priconfig.xml
touch mac-app-store/Info.plist

# Create .gitignore for sensitive files
cat > .gitignore << EOF
# Steam
steam/sdk/
steam/steamcmd/
steam/build/
steam/output/
steam/upload_script.txt
steam/steam_appid.txt

# Microsoft Store
microsoft-store/output/
microsoft-store/*.pfx
microsoft-store/*.cer

# Mac App Store
mac-app-store/build/
mac-app-store/embedded.provisionprofile
mac-app-store/*.p12

# Linux Stores
linux-stores/snap/*.snap
linux-stores/snap/parts/
linux-stores/snap/stage/
linux-stores/snap/prime/
linux-stores/flatpak/build-dir/
linux-stores/flatpak/repo/
linux-stores/flatpak/.flatpak-builder/
linux-stores/flatpak/*.flatpak

# General
*.log
*.tmp
.DS_Store
EOF

echo ""
echo "✅ App store deployment structure created!"
echo ""
echo "📋 Next steps:"
echo "1. Review README_APPSTORE.md for detailed deployment instructions"
echo "2. Set up developer accounts for each platform"
echo "3. Configure environment variables and secrets"
echo "4. Download platform-specific SDKs (Steam, Windows SDK)"
echo "5. Create app store assets (icons, screenshots, descriptions)"
echo ""
echo "🔐 Required secrets for GitHub Actions:"
echo "   - STEAM_USERNAME, STEAM_APP_ID, STEAM_CONFIG_VDF"
echo "   - MS_PACKAGE_NAME, MS_PUBLISHER, MS_TENANT_ID, etc."
echo "   - APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD"
echo "   - SNAPCRAFT_STORE_CREDENTIALS"
echo ""
echo "📦 Platform-specific setup guides:"
echo "   - Steam: steam/README.md"
echo "   - Microsoft Store: microsoft-store/README.md"
echo "   - Mac App Store: mac-app-store/README.md"
echo "   - Linux Stores: linux-stores/*/README.md"