#!/bin/bash
#
# Deploy SimplePaymaster and ELIZAOS Token for Gasless Transactions
#
# This deploys:
# 1. ELIZAOS token on L2
# 2. SimplePaymaster that sponsors gas for ELIZAOS holders
#
# Prerequisites:
# - L2 is running and producing blocks
# - Foundry installed locally (or run via Docker)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTRACTS_DIR="${CONTRACTS_DIR:-$HOME/jeju/packages/contracts}"

# Colors
GREEN='\033[0;32m'
NC='\033[0m'
log() { echo -e "${GREEN}[PAYMASTER]${NC} $1"; }

# Configuration
L2_RPC="${L2_RPC:-http://localhost:9545}"
L2_CHAIN_ID="${L2_CHAIN_ID:-2151908}"
DEPLOYER_PRIVATE_KEY="${DEPLOYER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"

# EntryPoint v0.7.0 address (standard)
ENTRYPOINT_V07="0x0000000071727De22E5E9d8BAf0edAc6f37da032"

# ============================================================================
# Check L2 is ready
# ============================================================================
check_l2() {
    log "Checking L2..."
    BLOCK=$(curl -s -X POST -H "Content-Type: application/json" \
        --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
        "$L2_RPC" | jq -r '.result')

    if [ -z "$BLOCK" ] || [ "$BLOCK" == "null" ]; then
        echo "ERROR: L2 not responding at $L2_RPC"
        exit 1
    fi

    BLOCK_DEC=$((16#${BLOCK#0x}))
    log "L2 at block $BLOCK_DEC"

    if [ "$BLOCK_DEC" -lt 1 ]; then
        log "Waiting for L2 to produce blocks..."
        sleep 10
    fi
}

# ============================================================================
# Deploy contracts via Foundry
# ============================================================================
deploy_with_forge() {
    log "Deploying contracts with Forge..."

    if [ ! -d "$CONTRACTS_DIR" ]; then
        log "Contracts directory not found: $CONTRACTS_DIR"
        log "Creating minimal deployment script..."

        mkdir -p /tmp/paymaster-deploy/src
        cd /tmp/paymaster-deploy

        # Create foundry.toml
        cat > foundry.toml << 'EOF'
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc = "0.8.23"
optimizer = true
optimizer_runs = 200

[rpc_endpoints]
l2 = "${L2_RPC}"
EOF

        # Create ELIZAOS Token
        cat > src/ELIZAOS.sol << 'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ELIZAOS is ERC20 {
    constructor() ERC20("ELIZAOS", "ELIZAOS") {
        _mint(msg.sender, 1_000_000_000 * 10**18);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
EOF

        # Create SimplePaymaster
        cat > src/SimplePaymaster.sol << 'EOF'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.23;

import "account-abstraction/interfaces/IPaymaster.sol";
import "account-abstraction/interfaces/IEntryPoint.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract SimplePaymaster is IPaymaster, Ownable {
    IEntryPoint public immutable entryPoint;
    IERC20 public immutable elizaToken;
    uint256 public minTokenBalance;

    event GasSponsored(address indexed user, uint256 actualGasCost);

    constructor(
        IEntryPoint _entryPoint,
        IERC20 _elizaToken,
        uint256 _minTokenBalance
    ) Ownable(msg.sender) {
        entryPoint = _entryPoint;
        elizaToken = _elizaToken;
        minTokenBalance = _minTokenBalance;
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256
    ) external view returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(entryPoint), "only entrypoint");

        address sender = userOp.sender;
        uint256 tokenBalance = elizaToken.balanceOf(sender);

        if (tokenBalance >= minTokenBalance) {
            return (abi.encode(sender), 0);
        }

        return ("", 1); // Invalid - not enough tokens
    }

    function postOp(
        PostOpMode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256
    ) external {
        require(msg.sender == address(entryPoint), "only entrypoint");
        address user = abi.decode(context, (address));
        emit GasSponsored(user, actualGasCost);
    }

    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function withdrawTo(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    function setMinTokenBalance(uint256 _minBalance) external onlyOwner {
        minTokenBalance = _minBalance;
    }

    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }
}
EOF

        # Install dependencies
        forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
        forge install eth-infinitism/account-abstraction --no-commit || true

        # Build
        forge build

        cd -
    fi

    # Deploy ELIZAOS
    log "Deploying ELIZAOS token..."
    ELIZAOS_OUTPUT=$(forge create \
        --rpc-url "$L2_RPC" \
        --private-key "$DEPLOYER_PRIVATE_KEY" \
        --json \
        src/ELIZAOS.sol:ELIZAOS 2>/dev/null || echo "{}")

    ELIZAOS_ADDRESS=$(echo "$ELIZAOS_OUTPUT" | jq -r '.deployedTo // empty')
    if [ -z "$ELIZAOS_ADDRESS" ]; then
        log "Failed to deploy ELIZAOS, trying alternative..."
        # Try with legacy gas pricing
        ELIZAOS_ADDRESS=$(forge create \
            --rpc-url "$L2_RPC" \
            --private-key "$DEPLOYER_PRIVATE_KEY" \
            --legacy \
            src/ELIZAOS.sol:ELIZAOS 2>&1 | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
    fi

    if [ -z "$ELIZAOS_ADDRESS" ]; then
        log "ERROR: Failed to deploy ELIZAOS"
        exit 1
    fi

    log "ELIZAOS deployed at: $ELIZAOS_ADDRESS"

    # Deploy SimplePaymaster
    log "Deploying SimplePaymaster..."
    MIN_BALANCE="1000000000000000000" # 1 ELIZAOS

    PAYMASTER_OUTPUT=$(forge create \
        --rpc-url "$L2_RPC" \
        --private-key "$DEPLOYER_PRIVATE_KEY" \
        --json \
        --constructor-args "$ENTRYPOINT_V07" "$ELIZAOS_ADDRESS" "$MIN_BALANCE" \
        src/SimplePaymaster.sol:SimplePaymaster 2>/dev/null || echo "{}")

    PAYMASTER_ADDRESS=$(echo "$PAYMASTER_OUTPUT" | jq -r '.deployedTo // empty')
    if [ -z "$PAYMASTER_ADDRESS" ]; then
        PAYMASTER_ADDRESS=$(forge create \
            --rpc-url "$L2_RPC" \
            --private-key "$DEPLOYER_PRIVATE_KEY" \
            --legacy \
            --constructor-args "$ENTRYPOINT_V07" "$ELIZAOS_ADDRESS" "$MIN_BALANCE" \
            src/SimplePaymaster.sol:SimplePaymaster 2>&1 | grep -oP '0x[a-fA-F0-9]{40}' | head -1)
    fi

    if [ -z "$PAYMASTER_ADDRESS" ]; then
        log "ERROR: Failed to deploy SimplePaymaster"
        exit 1
    fi

    log "SimplePaymaster deployed at: $PAYMASTER_ADDRESS"

    # Fund the paymaster
    log "Funding Paymaster with ETH for gas..."
    cast send \
        --rpc-url "$L2_RPC" \
        --private-key "$DEPLOYER_PRIVATE_KEY" \
        "$PAYMASTER_ADDRESS" \
        "deposit()" \
        --value 10ether || log "Failed to fund paymaster (may need manual funding)"

    # Save deployment info
    cat > "$SCRIPT_DIR/../config/paymaster-deployment.json" << EOF
{
    "network": "jeju-l2",
    "chainId": $L2_CHAIN_ID,
    "rpc": "$L2_RPC",
    "deployedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "contracts": {
        "ELIZAOS": "$ELIZAOS_ADDRESS",
        "SimplePaymaster": "$PAYMASTER_ADDRESS",
        "EntryPoint": "$ENTRYPOINT_V07"
    },
    "config": {
        "minTokenBalance": "$MIN_BALANCE"
    }
}
EOF

    log ""
    log "=========================================="
    log "  PAYMASTER DEPLOYMENT COMPLETE"
    log "=========================================="
    log ""
    log "ELIZAOS:         $ELIZAOS_ADDRESS"
    log "SimplePaymaster: $PAYMASTER_ADDRESS"
    log "EntryPoint:      $ENTRYPOINT_V07"
    log ""
    log "Deployment saved to: $SCRIPT_DIR/../config/paymaster-deployment.json"
    log ""
}

# ============================================================================
# Main
# ============================================================================
main() {
    check_l2
    deploy_with_forge
}

main "$@"
