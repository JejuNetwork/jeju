# Installation Guide

Complete guide to installing all prerequisites for Jeju development.

## System Requirements

- **RAM**: 16GB minimum, 32GB recommended
- **Storage**: 50GB free space
- **CPU**: 4+ cores
- **OS**: macOS (M1/M2/Intel), Linux, or Windows WSL2

## Quick Install (macOS)

```bash
# Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Install Docker Desktop
brew install --cask docker

# Install Kurtosis
brew install kurtosis-tech/tap/kurtosis

# Install Bun
curl -fsSL https://bun.sh/install | bash

# Install Foundry (for contract operations)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify installations
docker --version && kurtosis version && bun --version && cast --version
```

## Detailed Installation by Platform

### macOS

#### 1. Docker Desktop

```bash
brew install --cask docker
```

Then:
1. Open Docker Desktop application
2. Complete the setup wizard
3. Verify: `docker ps` (should show no errors)

#### 2. Kurtosis

```bash
brew install kurtosis-tech/tap/kurtosis
kurtosis version  # Should show v0.90.0+
```

#### 3. Bun

```bash
curl -fsSL https://bun.sh/install | bash

# Add to PATH (add to ~/.zshrc or ~/.bashrc)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Reload shell
source ~/.zshrc  # or ~/.bashrc

# Verify
bun --version  # Should show 1.0.0+
```

#### 4. Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify
cast --version
forge --version
```

### Linux (Ubuntu/Debian)

#### 1. Docker

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker ps
```

#### 2. Kurtosis

```bash
echo "deb [trusted=yes] https://apt.fury.io/kurtosis-tech/ /" | sudo tee /etc/apt/sources.list.d/kurtosis.list
sudo apt-get update
sudo apt-get install -y kurtosis-cli

# Verify
kurtosis version
```

#### 3. Bun

```bash
curl -fsSL https://bun.sh/install | bash

# Add to PATH (add to ~/.bashrc)
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

# Reload shell
source ~/.bashrc

# Verify
bun --version
```

#### 4. Foundry

```bash
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Verify
cast --version
```

### Windows (WSL2)

#### 1. Enable WSL2

```powershell
# Run in PowerShell as Administrator
wsl --install
```

Restart your computer.

#### 2. Install Docker Desktop

1. Download from: https://www.docker.com/products/docker-desktop
2. Install and enable WSL2 backend
3. Open WSL2 terminal for remaining steps

#### 3. Inside WSL2

Follow the Linux installation instructions above.

## Post-Installation Setup

### Configure Docker Resources

Docker needs sufficient resources to run Jeju:

**macOS/Windows**:
1. Open Docker Desktop
2. Go to Settings → Resources
3. Configure:
   - **Memory**: 8GB minimum, 16GB recommended
   - **CPUs**: 4 minimum, 8 recommended
   - **Disk**: 50GB minimum
4. Click "Apply & Restart"

**Linux**: Docker uses host resources (no configuration needed)

### Start Kurtosis Engine

```bash
# Start the engine
kurtosis engine start

# Verify it's running
kurtosis engine status
# Should show: "Running"
```

### Verify Everything Works

Run this verification script:

```bash
cat > verify-install.sh << 'EOF'
#!/bin/bash

echo "🔍 Verifying Jeju Prerequisites..."
echo ""

# Check Docker
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version | awk '{print $3}' | sed 's/,//')
    echo "✅ Docker: $DOCKER_VERSION"
    
    if docker ps &> /dev/null; then
        echo "✅ Docker daemon: Running"
    else
        echo "❌ Docker daemon: Not running"
        exit 1
    fi
else
    echo "❌ Docker: Not installed"
    exit 1
fi

# Check Kurtosis
if command -v kurtosis &> /dev/null; then
    KURTOSIS_VERSION=$(kurtosis version | head -1 | awk '{print $2}')
    echo "✅ Kurtosis: $KURTOSIS_VERSION"
else
    echo "❌ Kurtosis: Not installed"
    exit 1
fi

# Check Bun
if command -v bun &> /dev/null; then
    BUN_VERSION=$(bun --version)
    echo "✅ Bun: v$BUN_VERSION"
else
    echo "❌ Bun: Not installed"
    exit 1
fi

# Check Foundry
if command -v cast &> /dev/null; then
    CAST_VERSION=$(cast --version | head -1)
    echo "✅ Foundry: $CAST_VERSION"
else
    echo "⚠️  Foundry: Not installed (optional)"
fi

echo ""
echo "🎉 Ready to build on Jeju!"
EOF

chmod +x verify-install.sh
./verify-install.sh
```

## Optional Tools

### VS Code Extensions

```bash
code --install-extension ms-azuretools.vscode-docker
code --install-extension dbaeumer.vscode-eslint
code --install-extension esbenp.prettier-vscode
```

### Useful CLI Tools

```bash
# jq for JSON processing
brew install jq

# watch for monitoring
brew install watch

# httpie for API testing
brew install httpie
```

## Troubleshooting

### Docker Desktop won't start (macOS)

```bash
# Reset Docker to factory defaults
# Docker Desktop → Troubleshoot → Reset to factory defaults
```

### Docker permission denied (Linux)

```bash
# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in, or run:
newgrp docker
```

### Kurtosis installation fails

```bash
# macOS: Manual installation
ARCH=$(uname -m)
curl -L "https://github.com/kurtosis-tech/kurtosis/releases/latest/download/kurtosis-cli_darwin_${ARCH}.tar.gz" | tar xz
sudo mv kurtosis /usr/local/bin/

# Linux: Manual installation
ARCH=$(uname -m)
curl -L "https://github.com/kurtosis-tech/kurtosis/releases/latest/download/kurtosis-cli_linux_${ARCH}.tar.gz" | tar xz
sudo mv kurtosis /usr/local/bin/
```

### Bun installation fails

```bash
# Manual installation
curl -fsSL https://bun.sh/install | bash

# Add to shell config
echo 'export BUN_INSTALL="$HOME/.bun"' >> ~/.bashrc
echo 'export PATH="$BUN_INSTALL/bin:$PATH"' >> ~/.bashrc

# Reload
source ~/.bashrc
```

### M1/M2 Mac Issues

Modern M1/M2 Macs should work out of the box. If you encounter issues:

```bash
# Verify Rosetta 2 is installed
softwareupdate --install-rosetta
```

### Port Conflicts

If ports 8545 or 9545 are in use:

```bash
# Find process using the port
lsof -i :9545

# Kill it
kill -9 <PID>
```

## Next Steps

Once everything is installed:

1. ✅ Clone the repository
2. ✅ Install dependencies: `bun install`
3. ✅ Start localnet: `bun run localnet:start`

See the [Quick Start Guide](./quick-start) for next steps.

## Getting Help

If you're stuck:

- **Discord**: [Join our community](https://discord.gg/jeju)
- **GitHub Issues**: [Report a bug](https://github.com/elizaos/jeju/issues)
- **Documentation**: [Browse all docs](/)

