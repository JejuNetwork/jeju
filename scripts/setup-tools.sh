#!/usr/bin/env bash
# Setup tools and dependencies for Jeju Network
# This script runs before bun install (preinstall hook)

set -euo pipefail

echo "🔧 Setting up development tools..."

# Initialize git submodules for contract libraries
# These are required for Foundry to compile contracts
CONTRACTS_LIB_DIR="packages/contracts/lib"

if [ -f .gitmodules ] && [ -d packages/contracts ]; then
  echo "📚 Initializing git submodules..."
  
  # Ensure lib directory exists
  mkdir -p "${CONTRACTS_LIB_DIR}"
  
  # Try to initialize submodules via git first
  if git submodule update --init --recursive --depth 1 "${CONTRACTS_LIB_DIR}" 2>/dev/null; then
    echo "  ✅ Submodules initialized via git"
  else
    echo "  ⚠️  Git submodule init failed, trying manual clone..."
    
    # Fallback: manually clone required submodules if they don't exist
    declare -A SUBMODULES=(
      ["account-abstraction"]="https://github.com/eth-infinitism/account-abstraction"
      ["openzeppelin-contracts"]="https://github.com/OpenZeppelin/openzeppelin-contracts"
      ["openzeppelin-contracts-upgradeable"]="https://github.com/OpenZeppelin/openzeppelin-contracts-upgradeable"
      ["forge-std"]="https://github.com/foundry-rs/forge-std"
      ["optimism"]="https://github.com/ethereum-optimism/optimism"
    )
    
    for submodule in "${!SUBMODULES[@]}"; do
      submodule_path="${CONTRACTS_LIB_DIR}/${submodule}"
      if [ ! -d "${submodule_path}" ] || [ ! -d "${submodule_path}/.git" ]; then
        echo "    Cloning ${submodule}..."
        git clone --depth 1 "${SUBMODULES[$submodule]}" "${submodule_path}" 2>/dev/null || {
          echo "    ⚠️  Failed to clone ${submodule}"
        }
      fi
    done
  fi
  
  echo "✅ Contract libraries ready"
else
  echo "⚠️  Skipping submodule initialization (.gitmodules or packages/contracts not found)"
fi

echo "✅ Setup complete"

