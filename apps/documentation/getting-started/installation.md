# Installation

## Requirements

- RAM: 16GB+
- Storage: 50GB+
- CPU: 4+ cores

## macOS

```bash
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

## Linux

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

echo "deb [trusted=yes] https://apt.fury.io/kurtosis-tech/ /" | sudo tee /etc/apt/sources.list.d/kurtosis.list
sudo apt update && sudo apt install -y kurtosis-cli

curl -fsSL https://bun.sh/install | bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
```

## Verify

```bash
docker --version    # 24.0+
kurtosis version    # 0.90+
bun --version       # 1.0+
forge --version     # any
```

## Docker Settings

For Docker Desktop, set:
- Memory: 8GB+
- CPUs: 4+

## Next

[Quick Start](./quick-start)
