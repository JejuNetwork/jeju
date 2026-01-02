# Optimism Devnet - Full OP Stack with Derivation Pipeline
#
# This sets up a REAL OP Stack where L2 blocks are derived from L1:
# - L1: Geth with L1 OP Stack contracts deployed
# - op-node: Derives L2 blocks from L1 deposits
# - op-geth: Executes L2 transactions from op-node
# - op-batcher: Submits L2 batches to L1
# - op-proposer: Submits L2 output roots to L1
#
# Uses ethpandaops/optimism-package for proper setup

def run(plan, args={}):
    """
    Deploy a full OP Stack devnet using ethpandaops/optimism-package.
    
    This provides real L1 → L2 derivation, not dev mode.
    """
    
    plan.print("=" * 70)
    plan.print("Deploying Full OP Stack Devnet")
    plan.print("=" * 70)
    plan.print("")
    
    # Use the official ethpandaops optimism-package
    # This sets up everything correctly including:
    # - L1 with lighthouse beacon + geth execution
    # - L2 with op-geth + op-node
    # - op-batcher and op-proposer
    # - All L1 contracts deployed
    
    optimism_config = {
        "participants": [
            {
                "el_type": "op-geth",
                "cl_type": "op-node",
                "count": 1,
            }
        ],
        "network_params": {
            "network_id": "901",
            "seconds_per_slot": 2,
            "genesis_delay": 10,
        },
        "additional_services": [
            "op-batcher",
            "op-proposer",
        ],
    }
    
    # Import the optimism package
    optimism = plan.import_package("github.com/ethpandaops/optimism-package")
    
    # Run the optimism package
    result = optimism.run(plan, optimism_config)
    
    plan.print("")
    plan.print("=" * 70)
    plan.print("OP Stack Devnet Deployed")
    plan.print("=" * 70)
    plan.print("")
    plan.print("Use 'kurtosis enclave inspect <enclave>' for endpoints")
    plan.print("")
    
    return result


