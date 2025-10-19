#!/bin/bash
# Steam Build Script for ElizaOS

set -e

echo "🎮 Building ElizaOS for Steam..."

# Check environment variables
if [ -z "$STEAM_APP_ID" ]; then
    echo "❌ Error: STEAM_APP_ID not set"
    exit 1
fi

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
STEAM_DIR="$SCRIPT_DIR/.."
DEPLOYMENT_DIR="$STEAM_DIR/.."
PROJECT_ROOT="$DEPLOYMENT_DIR/.."

# Create steam_appid.txt for development
echo "$STEAM_APP_ID" > "$STEAM_DIR/steam_appid.txt"

# Build the Tauri application
echo "📦 Building Tauri application..."
cd "$PROJECT_ROOT/packages/game"

# Clean previous builds
rm -rf src-tauri/target/release/bundle

# Build for production with Steam features
TAURI_STEAM_BUILD=1 npm run build

# Create Steam build directory
STEAM_BUILD_DIR="$STEAM_DIR/build"
rm -rf "$STEAM_BUILD_DIR"
mkdir -p "$STEAM_BUILD_DIR"

# Platform-specific build
case "$OSTYPE" in
  darwin*)
    echo "🍎 Building for macOS..."
    # Copy macOS app bundle
    cp -R "src-tauri/target/release/bundle/macos/ELIZA.app" "$STEAM_BUILD_DIR/"
    # Copy steam_appid.txt to app bundle
    cp "$STEAM_DIR/steam_appid.txt" "$STEAM_BUILD_DIR/ELIZA.app/Contents/MacOS/"
    ;;
  linux*)
    echo "🐧 Building for Linux..."
    # Copy Linux binary and resources
    cp "src-tauri/target/release/elizaos" "$STEAM_BUILD_DIR/"
    cp "$STEAM_DIR/steam_appid.txt" "$STEAM_BUILD_DIR/"
    # Copy required libraries
    mkdir -p "$STEAM_BUILD_DIR/lib"
    ldd "src-tauri/target/release/elizaos" | grep "=> /" | awk '{print $3}' | xargs -I '{}' cp -v '{}' "$STEAM_BUILD_DIR/lib/"
    # Create launch script
    cat > "$STEAM_BUILD_DIR/launch.sh" << 'EOF'
#!/bin/bash
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
export LD_LIBRARY_PATH="$SCRIPT_DIR/lib:$LD_LIBRARY_PATH"
"$SCRIPT_DIR/elizaos" "$@"
EOF
    chmod +x "$STEAM_BUILD_DIR/launch.sh"
    ;;
  msys*|mingw*|cygwin*)
    echo "🪟 Building for Windows..."
    # Copy Windows executable and resources
    cp "src-tauri/target/release/elizaos.exe" "$STEAM_BUILD_DIR/"
    cp "$STEAM_DIR/steam_appid.txt" "$STEAM_BUILD_DIR/"
    # Copy Visual C++ redistributables if needed
    if [ -d "src-tauri/target/release/bundle/windows/vc_redist" ]; then
      cp -R "src-tauri/target/release/bundle/windows/vc_redist" "$STEAM_BUILD_DIR/"
    fi
    ;;
  *)
    echo "❌ Unsupported platform: $OSTYPE"
    exit 1
    ;;
esac

# Copy game resources
echo "📁 Copying game resources..."
mkdir -p "$STEAM_BUILD_DIR/resources"
cp -R "$PROJECT_ROOT/packages/game/dist"/* "$STEAM_BUILD_DIR/resources/" 2>/dev/null || true

# Copy Steam SDK redistributables
echo "📚 Copying Steam SDK files..."
if [ -d "$STEAM_DIR/sdk/redistributable_bin" ]; then
  case "$OSTYPE" in
    darwin*)
      cp "$STEAM_DIR/sdk/redistributable_bin/osx/libsteam_api.dylib" "$STEAM_BUILD_DIR/ELIZA.app/Contents/MacOS/" || true
      ;;
    linux*)
      if [ -f "$STEAM_DIR/sdk/redistributable_bin/linux64/libsteam_api.so" ]; then
        cp "$STEAM_DIR/sdk/redistributable_bin/linux64/libsteam_api.so" "$STEAM_BUILD_DIR/lib/"
      fi
      ;;
    msys*|mingw*|cygwin*)
      if [ -f "$STEAM_DIR/sdk/redistributable_bin/win64/steam_api64.dll" ]; then
        cp "$STEAM_DIR/sdk/redistributable_bin/win64/steam_api64.dll" "$STEAM_BUILD_DIR/"
      fi
      ;;
  esac
else
  echo "⚠️  Warning: Steam SDK not found. Please download and extract to $STEAM_DIR/sdk/"
fi

# Create build info
cat > "$STEAM_BUILD_DIR/build_info.txt" << EOF
ElizaOS Steam Build
Version: $(cat "$PROJECT_ROOT/packages/game/package.json" | grep '"version"' | cut -d'"' -f4)
Build Date: $(date)
Platform: $OSTYPE
App ID: $STEAM_APP_ID
EOF

echo "✅ Steam build complete!"
echo "📁 Build location: $STEAM_BUILD_DIR"
echo ""
echo "Next steps:"
echo "1. Test the build locally with Steam running"
echo "2. Run ./upload_steam.sh to upload to Steam"