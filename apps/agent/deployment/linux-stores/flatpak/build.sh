#!/bin/bash
# Flatpak build script for ElizaOS

set -e

echo "📦 Building ElizaOS..."

# Change to the source directory
cd /run/build/elizaos

# Build the game package
cd packages/game

# Install dependencies
echo "📥 Installing dependencies..."
npm install

# Build the application
echo "🔨 Building application..."
npm run build

# Install the application
echo "📁 Installing to /app..."

# Create directories
mkdir -p /app/bin
mkdir -p /app/share/elizaos
mkdir -p /app/share/applications
mkdir -p /app/share/icons/hicolor/512x512/apps
mkdir -p /app/share/metainfo

# Copy binary
cp src-tauri/target/release/elizaos /app/bin/

# Copy resources
cp -r dist/* /app/share/elizaos/

# Create wrapper script
cat > /app/bin/elizaos-wrapper << 'EOF'
#!/bin/bash
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export GDK_BACKEND=x11,wayland
exec /app/bin/elizaos "$@"
EOF
chmod +x /app/bin/elizaos-wrapper

# Update the main command to use wrapper
mv /app/bin/elizaos /app/bin/elizaos.real
ln -s /app/bin/elizaos-wrapper /app/bin/elizaos

echo "✅ Build complete!"