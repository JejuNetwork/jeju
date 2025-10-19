#!/bin/bash
# Steam Upload Script for ElizaOS

set -e

echo "🚀 Uploading ElizaOS to Steam..."

# Check environment variables
if [ -z "$STEAM_USERNAME" ] || [ -z "$STEAM_PASSWORD" ] || [ -z "$STEAM_APP_ID" ]; then
    echo "❌ Error: Required environment variables not set"
    echo "Please set: STEAM_USERNAME, STEAM_PASSWORD, STEAM_APP_ID"
    exit 1
fi

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
STEAM_DIR="$SCRIPT_DIR/.."
DEPLOYMENT_DIR="$STEAM_DIR/.."
PROJECT_ROOT="$DEPLOYMENT_DIR/.."
STEAMCMD_DIR="$STEAM_DIR/steamcmd"

# Download SteamCMD if not present
if [ ! -f "$STEAMCMD_DIR/steamcmd.sh" ] && [ ! -f "$STEAMCMD_DIR/steamcmd.exe" ]; then
    echo "📥 Downloading SteamCMD..."
    mkdir -p "$STEAMCMD_DIR"
    cd "$STEAMCMD_DIR"
    
    case "$OSTYPE" in
      darwin*)
        curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz" | tar zxvf -
        ;;
      linux*)
        curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz" | tar zxvf -
        ;;
      msys*|mingw*|cygwin*)
        curl -sqL "https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip" -o steamcmd.zip
        unzip -o steamcmd.zip
        rm steamcmd.zip
        ;;
    esac
fi

# Generate VDF files
echo "📝 Generating VDF configuration files..."

# Get version from package.json
VERSION=$(cat "$PROJECT_ROOT/packages/game/package.json" | grep '"version"' | cut -d'"' -f4)
BUILD_ID=$(date +%s)

# Create app build VDF
cat > "$STEAM_DIR/vdf/app_build_${STEAM_APP_ID}.vdf" << EOF
"AppBuild"
{
    "AppID" "${STEAM_APP_ID}"
    "Desc" "ElizaOS v${VERSION} - Build ${BUILD_ID}"
    "BuildOutput" "../output/"
    "ContentRoot" "../build/"
    "SetLive" "Default"
    
    "Depots"
    {
        "${STEAM_APP_ID}1" "depot_build_${STEAM_APP_ID}1.vdf"
    }
}
EOF

# Platform-specific depot configuration
case "$OSTYPE" in
  darwin*)
    DEPOT_OS="macos"
    FILE_MAPPING="*"
    ;;
  linux*)
    DEPOT_OS="linux"
    FILE_MAPPING="*"
    ;;
  msys*|mingw*|cygwin*)
    DEPOT_OS="windows"
    FILE_MAPPING="*"
    ;;
esac

# Create depot build VDF
cat > "$STEAM_DIR/vdf/depot_build_${STEAM_APP_ID}1.vdf" << EOF
"DepotBuildConfig"
{
    "DepotID" "${STEAM_APP_ID}1"
    "ContentRoot" "../build/"
    "FileMapping"
    {
        "LocalPath" "${FILE_MAPPING}"
        "DepotPath" "."
        "recursive" "1"
    }
    "FileExclusion" "*.pdb"
    "FileExclusion" "*.log"
    "FileExclusion" "steam_appid.txt"
}
EOF

# Create login script for SteamCMD
STEAMCMD_SCRIPT="$STEAM_DIR/upload_script.txt"
cat > "$STEAMCMD_SCRIPT" << EOF
@ShutdownOnFailedCommand 1
@NoPromptForPassword 1
force_install_dir ../
login ${STEAM_USERNAME} ${STEAM_PASSWORD}
run_app_build ../vdf/app_build_${STEAM_APP_ID}.vdf
quit
EOF

# Run SteamCMD
echo "📤 Uploading to Steam..."
cd "$STEAMCMD_DIR"

case "$OSTYPE" in
  msys*|mingw*|cygwin*)
    ./steamcmd.exe +runscript "$STEAMCMD_SCRIPT"
    ;;
  *)
    ./steamcmd.sh +runscript "$STEAMCMD_SCRIPT"
    ;;
esac

# Clean up sensitive files
rm -f "$STEAMCMD_SCRIPT"

echo "✅ Upload complete!"
echo ""
echo "Next steps:"
echo "1. Check the build on Steamworks: https://partner.steamgames.com/apps/builds/${STEAM_APP_ID}"
echo "2. Set the build live for testing or release"
echo "3. Update store page if needed"