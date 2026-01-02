# Real OP Stack - Full L1 ↔ L2 with Derivation
#
# This uses ethpandaops/optimism-package to set up a REAL OP Stack where:
# - L1 has real OP Stack contracts deployed
# - op-node derives L2 blocks from L1 deposits
# - op-batcher submits L2 batches to L1
# - op-proposer submits L2 output roots
#
# Prerequisites:
#   1. kurtosis engine start
#   2. kurtosis run github.com/ethpandaops/ethereum-package (for L1)
#
# Usage:
#   kurtosis run packages/deployment/kurtosis/real-op-stack.star --enclave op-real

# Import the optimism package from ethpandaops
optimism = import_module("github.com/ethpandaops/optimism-package/main.star")

def run(plan, args={}):
    """
    Deploy a REAL OP Stack with full derivation pipeline.
    
    This is NOT dev mode - it's a proper L1 ↔ L2 setup suitable for
    integration testing of cross-chain messaging.
    """
    
    plan.print("=" * 70)
    plan.print("Starting REAL OP Stack with Full Derivation")
    plan.print("=" * 70)
    plan.print("")
    plan.print("This sets up:")
    plan.print("  - L1 with all OP Stack contracts deployed")
    plan.print("  - op-node deriving L2 blocks from L1")
    plan.print("  - op-geth executing derived transactions")
    plan.print("  - op-batcher submitting L2 batches to L1")
    plan.print("  - op-proposer submitting L2 output roots")
    plan.print("")
    
    # Configuration for the OP Stack
    optimism_config = {
        # L2 participant configuration
        "participants": [
            {
                "el_type": "op-geth",
                "cl_type": "op-node",
                "count": 1,
            }
        ],
        
        # Network parameters
        "network_params": {
            "network_id": "901",
            "seconds_per_slot": 2,
            "genesis_delay": 10,
            "fjord_time_offset": 0,  # Enable Fjord immediately
        },
        
        # Include batcher and proposer
        "additional_services": [
            "op-batcher",
            "op-proposer",
        ],
        
        # Persistent data (optional)
        "persistent": False,
    }
    
    # Run the optimism package
    result = optimism.run(plan, optimism_config)
    
    # Print useful information
    plan.print("")
    plan.print("=" * 70)
    plan.print("OP Stack Deployed Successfully")
    plan.print("=" * 70)
    plan.print("")
    plan.print("To get endpoints, run:")
    plan.print("  kurtosis enclave inspect <enclave-name>")
    plan.print("")
    plan.print("L1 → L2 Deposit Test:")
    plan.print("  1. Call OptimismPortal.depositTransaction() on L1")
    plan.print("  2. Wait ~4s for op-node to derive the deposit")
    plan.print("  3. Check recipient balance on L2")
    plan.print("")
    plan.print("L2 → L1 Withdrawal Test:")
    plan.print("  1. Call L2ToL1MessagePasser.initiateWithdrawal() on L2")
    plan.print("  2. Wait for op-batcher to submit batch (~10s)")
    plan.print("  3. Wait for op-proposer to submit output (~12s)")
    plan.print("  4. Generate Merkle proof from L2")
    plan.print("  5. Prove withdrawal on L1")
    plan.print("  6. Wait 7 days (or skip time in test)")
    plan.print("  7. Finalize withdrawal on L1")
    plan.print("")
    
    return result


