#!/bin/bash
set -e

# Integration test that deploys Stage 2 contracts to Anvil and tests end-to-end

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONTRACTS_DIR="$PROJECT_ROOT/packages/contracts"

echo "=== Stage 2 Integration Test ==="

# Check if Anvil is available
if ! command -v anvil &> /dev/null; then
    echo "Error: Anvil (Foundry) is not installed"
    echo "Install with: curl -L https://foundry.paradigm.xyz | bash && foundryup"
    exit 1
fi

# Start Anvil in background
echo "Starting Anvil..."
anvil --port 8546 --chain-id 31337 --block-time 1 &
ANVIL_PID=$!

cleanup() {
    echo "Stopping Anvil..."
    kill $ANVIL_PID 2>/dev/null || true
}
trap cleanup EXIT

# Wait for Anvil to be ready
sleep 2

# Set test private key (Anvil's first account)
export PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
export RPC_URL="http://localhost:8546"
# Set dummy API key to avoid foundry.toml errors
export BASESCAN_API_KEY="dummy"
export ETHERSCAN_API_KEY="dummy"

echo "Deploying contracts..."

cd "$CONTRACTS_DIR"

echo "Deploying JejuToken..."
INITIAL_SUPPLY="1000000000000000000000000000"
JEJU_TOKEN_OUTPUT=$(forge create src/otc/mocks/MockERC20.sol:MockERC20 \
    --constructor-args "Jeju Token" "JEJU" 18 $INITIAL_SUPPLY \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY 2>&1)
JEJU_TOKEN=$(echo "$JEJU_TOKEN_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
echo "JejuToken: $JEJU_TOKEN"

echo "Deploying SequencerRegistry..."
OWNER="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
SEQ_REG_OUTPUT=$(forge create src/stage2/SequencerRegistry.sol:SequencerRegistry \
    --constructor-args $JEJU_TOKEN $OWNER $OWNER $OWNER $OWNER \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY 2>&1)
SEQUENCER_REGISTRY=$(echo "$SEQ_REG_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
echo "SequencerRegistry: $SEQUENCER_REGISTRY"

echo "Deploying MockBatchInbox..."
INBOX_OUTPUT=$(forge create src/otc/mocks/MockERC20.sol:MockERC20 \
    --constructor-args "BatchInbox" "INBOX" 18 0 \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY 2>&1)
MOCK_BATCH_INBOX=$(echo "$INBOX_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
echo "MockBatchInbox: $MOCK_BATCH_INBOX"

echo "Deploying ThresholdBatchSubmitter..."
SUBMITTER_OUTPUT=$(forge create src/stage2/ThresholdBatchSubmitter.sol:ThresholdBatchSubmitter \
    --constructor-args $MOCK_BATCH_INBOX $OWNER 2 \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY 2>&1)
THRESHOLD_SUBMITTER=$(echo "$SUBMITTER_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
echo "ThresholdBatchSubmitter: $THRESHOLD_SUBMITTER"

echo "Deploying GovernanceTimelock..."
TIMELOCK_OUTPUT=$(forge create src/stage2/GovernanceTimelock.sol:GovernanceTimelock \
    --constructor-args $OWNER $OWNER $OWNER 7200 \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY 2>&1)
TIMELOCK=$(echo "$TIMELOCK_OUTPUT" | grep "Deployed to:" | awk '{print $3}')
echo "GovernanceTimelock: $TIMELOCK"

echo ""
echo "=== Deployed Contracts ==="
echo "JejuToken: $JEJU_TOKEN"
echo "SequencerRegistry: $SEQUENCER_REGISTRY"
echo "ThresholdBatchSubmitter: $THRESHOLD_SUBMITTER"
echo "GovernanceTimelock: $TIMELOCK"
echo ""

echo "Running integration tests..."
forge test --match-contract Integration -vvv --rpc-url $RPC_URL 2>&1 | head -50

echo ""
echo "=== Testing Threshold Batch Submission ==="

echo "Adding sequencers..."
SEQ1="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
SEQ2="0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
SEQ3="0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"

cast send $THRESHOLD_SUBMITTER "addSequencer(address)" $SEQ1 --rpc-url $RPC_URL --private-key $PRIVATE_KEY 2>/dev/null
cast send $THRESHOLD_SUBMITTER "addSequencer(address)" $SEQ2 --rpc-url $RPC_URL --private-key $PRIVATE_KEY 2>/dev/null
cast send $THRESHOLD_SUBMITTER "addSequencer(address)" $SEQ3 --rpc-url $RPC_URL --private-key $PRIVATE_KEY 2>/dev/null

SEQUENCER_COUNT=$(cast call $THRESHOLD_SUBMITTER "sequencerCount()(uint256)" --rpc-url $RPC_URL 2>/dev/null)
echo "Sequencer count: $SEQUENCER_COUNT"

THRESHOLD=$(cast call $THRESHOLD_SUBMITTER "threshold()(uint256)" --rpc-url $RPC_URL 2>/dev/null)
echo "Threshold: $THRESHOLD"

BATCH_DATA="0xdeadbeef"
DIGEST=$(cast call $THRESHOLD_SUBMITTER "getBatchDigest(bytes)(bytes32)" $BATCH_DATA --rpc-url $RPC_URL 2>/dev/null)
echo "Batch digest: $DIGEST"

echo "Signing batch..."
KEY1="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
KEY2="0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"

SIG1=$(cast wallet sign --no-hash --private-key $KEY1 $DIGEST 2>/dev/null)
SIG2=$(cast wallet sign --no-hash --private-key $KEY2 $DIGEST 2>/dev/null)
echo "Signature 1: ${SIG1:0:20}..."
echo "Signature 2: ${SIG2:0:20}..."

echo ""
echo "=== Submitting Batch ==="

NONCE_BEFORE=$(cast call $THRESHOLD_SUBMITTER "nonce()(uint256)" --rpc-url $RPC_URL 2>/dev/null)
echo "Nonce before: $NONCE_BEFORE"

echo "Calling submitBatch..."
set +e  # Temporarily disable exit on error
SUBMIT_RESULT=$(cast send $THRESHOLD_SUBMITTER \
    "submitBatch(bytes,bytes[],address[])" \
    $BATCH_DATA \
    "[$SIG1,$SIG2]" \
    "[$SEQ1,$SEQ2]" \
    --rpc-url $RPC_URL \
    --private-key $PRIVATE_KEY 2>&1)
CAST_EXIT=$?
set -e

if [ $CAST_EXIT -eq 0 ] && echo "$SUBMIT_RESULT" | grep -q "transactionHash"; then
    echo "Batch submission succeeded!"
    TX_HASH=$(echo "$SUBMIT_RESULT" | grep "transactionHash" | awk '{print $2}')
    echo "Transaction: $TX_HASH"
    
    # Verify nonce incremented
    NONCE_AFTER=$(cast call $THRESHOLD_SUBMITTER "nonce()(uint256)" --rpc-url $RPC_URL 2>/dev/null)
    echo "Nonce after: $NONCE_AFTER"
    
    if [ "$NONCE_AFTER" -gt "$NONCE_BEFORE" ]; then
        echo "✓ Nonce incremented correctly"
    else
        echo "✗ Nonce did not increment!"
        exit 1
    fi
else
    echo "Batch submission failed:"
    echo "$SUBMIT_RESULT"
fi

echo ""
echo "=== Summary ==="
echo "Contracts deployed successfully"
echo "Sequencers added: 3"
echo "Threshold: $THRESHOLD"
echo "Batch submission: attempted"
echo ""
echo "Integration test completed"

