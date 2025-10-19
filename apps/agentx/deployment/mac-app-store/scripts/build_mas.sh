#!/bin/bash
# Mac App Store Build Script for ElizaOS

set -e

echo "🍎 Building ElizaOS for Mac App Store..."

# Check environment variables
if [ -z "$APPLE_TEAM_ID" ]; then
    echo "❌ Error: APPLE_TEAM_ID not set"
    echo "Get your Team ID from https://developer.apple.com/account"
    exit 1
fi

# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
MAS_DIR="$SCRIPT_DIR/.."
DEPLOYMENT_DIR="$MAS_DIR/.."
PROJECT_ROOT="$DEPLOYMENT_DIR/.."

# Build output directory
BUILD_DIR="$MAS_DIR/build"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# Build the Tauri application with Mac App Store configuration
echo "📦 Building Tauri application for Mac App Store..."
cd "$PROJECT_ROOT/packages/game"

# Clean previous builds
rm -rf src-tauri/target/release/bundle

# Create Mac App Store specific Tauri configuration
MAS_CONFIG="$MAS_DIR/tauri.mas.conf.json"
cat > "$MAS_CONFIG" << EOF
{
  "tauri": {
    "bundle": {
      "identifier": "com.elizaos.game",
      "macOS": {
        "category": "public.app-category.games",
        "entitlements": "$MAS_DIR/entitlements-mas.plist",
        "hardenedRuntime": true,
        "signingIdentity": "3rd Party Mac Developer Application: $APPLE_TEAM_ID",
        "providerShortName": "$APPLE_TEAM_ID"
      }
    },
    "updater": {
      "active": false
    }
  }
}
EOF

# Build with Mac App Store configuration
TAURI_APPLE_TEAM_ID="$APPLE_TEAM_ID" \
TAURI_BUNDLE_IDENTIFIER="com.elizaos.game" \
npm run tauri build -- --config "$MAS_CONFIG"

# Find the built app bundle
APP_PATH=$(find src-tauri/target/release/bundle/macos -name "*.app" | head -1)

if [ -z "$APP_PATH" ]; then
    echo "❌ Error: Could not find built app bundle"
    exit 1
fi

echo "📱 Found app bundle: $APP_PATH"

# Copy app to build directory
cp -R "$APP_PATH" "$BUILD_DIR/"
APP_NAME=$(basename "$APP_PATH")

# Update Info.plist for Mac App Store
echo "📝 Updating Info.plist for Mac App Store..."
INFO_PLIST="$BUILD_DIR/$APP_NAME/Contents/Info.plist"

# Add Mac App Store specific keys
/usr/libexec/PlistBuddy -c "Add :LSApplicationCategoryType string public.app-category.games" "$INFO_PLIST" 2>/dev/null || true
/usr/libexec/PlistBuddy -c "Add :ITSAppUsesNonExemptEncryption bool false" "$INFO_PLIST" 2>/dev/null || true

# Copy provisioning profile if available
if [ -f "$MAS_DIR/embedded.provisionprofile" ]; then
    echo "📋 Copying provisioning profile..."
    cp "$MAS_DIR/embedded.provisionprofile" "$BUILD_DIR/$APP_NAME/Contents/embedded.provisionprofile"
else
    echo "⚠️  Warning: No provisioning profile found at $MAS_DIR/embedded.provisionprofile"
    echo "Download from https://developer.apple.com/account/resources/profiles/list"
fi

# Sign the app with Mac App Store certificates
echo "🔐 Signing app for Mac App Store..."

# Sign frameworks and nested code
find "$BUILD_DIR/$APP_NAME" -name "*.dylib" -o -name "*.framework" | while read -r item; do
    echo "Signing: $item"
    codesign --force --sign "3rd Party Mac Developer Application: $APPLE_TEAM_ID" \
             --entitlements "$MAS_DIR/entitlements-mas.plist" \
             --requirements "=designated => anchor apple generic and identifier \"com.elizaos.game\" and (certificate leaf[field.1.2.840.113635.100.6.1.9] /* exists */ or certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = \"$APPLE_TEAM_ID\")" \
             "$item"
done

# Sign the main app bundle
codesign --force --sign "3rd Party Mac Developer Application: $APPLE_TEAM_ID" \
         --entitlements "$MAS_DIR/entitlements-mas.plist" \
         --requirements "=designated => anchor apple generic and identifier \"com.elizaos.game\" and (certificate leaf[field.1.2.840.113635.100.6.1.9] /* exists */ or certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = \"$APPLE_TEAM_ID\")" \
         "$BUILD_DIR/$APP_NAME"

# Verify the signature
echo "✅ Verifying signature..."
codesign --verify --deep --strict --verbose=2 "$BUILD_DIR/$APP_NAME"

# Check for App Store compliance
echo "🔍 Checking App Store compliance..."
spctl -a -t execute -vv "$BUILD_DIR/$APP_NAME"

# Create a pkg installer for App Store submission
echo "📦 Creating installer package..."
PKG_PATH="$BUILD_DIR/ELIZA.pkg"

productbuild --component "$BUILD_DIR/$APP_NAME" /Applications \
             --sign "3rd Party Mac Developer Installer: $APPLE_TEAM_ID" \
             --product "$BUILD_DIR/$APP_NAME/Contents/Info.plist" \
             "$PKG_PATH"

# Verify the installer
echo "✅ Verifying installer package..."
pkgutil --check-signature "$PKG_PATH"

# Clean up temporary config
rm -f "$MAS_CONFIG"

echo "✅ Mac App Store build complete!"
echo "📦 App bundle: $BUILD_DIR/$APP_NAME"
echo "📦 Installer: $PKG_PATH"
echo ""
echo "Next steps:"
echo "1. Validate the package: ./validate_mas.sh"
echo "2. Upload to App Store Connect: ./upload_mas.sh"
echo "3. Submit for review in App Store Connect"