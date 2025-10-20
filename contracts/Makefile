# Jeju Contracts Makefile

.PHONY: help build test test-registry test-all clean deploy-local

help:
	@echo "Jeju Network - Smart Contract Commands"
	@echo ""
	@echo "Available targets:"
	@echo "  make build          - Compile all contracts"
	@echo "  make test           - Run all tests"
	@echo "  make test-registry  - Run registry tests only (73 tests)"
	@echo "  make test-all       - Run all tests with gas report"
	@echo "  make clean          - Clean build artifacts"
	@echo "  make deploy-local   - Deploy to local network"
	@echo ""

build:
	@echo "🔨 Building contracts..."
	@forge build

test:
	@echo "🧪 Running all tests..."
	@forge test

test-registry:
	@echo "🧪 Running registry tests (TEE attestation, service discovery, identity)..."
	@forge test --match-contract ".*Registry.*"
	@echo ""
	@echo "✅ Registry test suite complete"
	@echo "   - IdentityRegistry: 18 tests"
	@echo "   - ReputationRegistry: 24 tests" 
	@echo "   - ValidationRegistry: 24 tests"
	@echo "   - Integration: 7 tests"
	@echo "   Total: 73 registry tests"

test-all:
	@echo "🧪 Running all tests with gas report..."
	@forge test --gas-report

clean:
	@echo "🧹 Cleaning build artifacts..."
	@forge clean

deploy-local:
	@echo "🚀 Deploying to localnet..."
	@forge script script/DeployLiquiditySystem.s.sol:DeployLiquiditySystem \
		--rpc-url http://localhost:8545 \
		--broadcast

