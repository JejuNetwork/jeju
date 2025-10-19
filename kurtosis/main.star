# Jeju Localnet - Minimal Working Implementation for macOS
# Pure TCP ports only - no UDP/QUIC issues!

def run(plan, args={}):
    """
    Minimal L1 + L2 that works on macOS
    
    Strategy: 
    - L1: Geth --dev (auto-mines, no consensus needed)
    - L2: op-geth + op-node with P2P disabled (no UDP)
    - Only TCP ports = works on macOS Docker Desktop
    """
    
    plan.print("🚀 Starting Jeju Localnet...")
    plan.print("")
    
    # L1: Geth in dev mode
    l1 = plan.add_service(
        name="geth-l1",
        config=ServiceConfig(
            image="ethereum/client-go:latest",
            ports={
                "rpc": PortSpec(number=8545, transport_protocol="TCP", application_protocol="http"),
                "ws": PortSpec(number=8546, transport_protocol="TCP", application_protocol="ws"),
            },
            cmd=[
                "--dev",
                "--dev.period=1",
                "--http",
                "--http.addr=0.0.0.0",
                "--http.port=8545",
                "--http.api=eth,net,web3,debug,personal",
                "--http.corsdomain=*",
                "--ws",
                "--ws.addr=0.0.0.0",
                "--ws.port=8546",
                "--ws.api=eth,net,web3",
                "--ws.origins=*",
                # Note: --dev mode uses its own network ID, can't override
                "--nodiscover",
            ]
        )
    )
    
    plan.print("✅ L1 started")
    
    # L2: op-geth (simplified - just RPC for now)
    l2_el = plan.add_service(
        name="op-geth",
        config=ServiceConfig(
            image="us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:latest",
            ports={
                "rpc": PortSpec(number=9545, transport_protocol="TCP", application_protocol="http"),
                "ws": PortSpec(number=9546, transport_protocol="TCP", application_protocol="ws"),
                # Skipping authrpc - not needed for basic dev mode
            },
            cmd=[
                "--dev",
                "--dev.period=2",  # Mine a block every 2 seconds
                "--http",
                "--http.addr=0.0.0.0",
                "--http.port=9545",
                "--http.api=eth,net,web3,debug,txpool,admin",
                "--http.corsdomain=*",
                "--ws",
                "--ws.addr=0.0.0.0",
                "--ws.port=9546",
                "--ws.api=eth,net,web3,debug",
                "--ws.origins=*",
                "--nodiscover",
                "--maxpeers=0",
            ]
        )
    )
    
    plan.print("✅ L2 Execution started")
    plan.print("")
    plan.print("Note: This is a simplified L2 for local development.")
    plan.print("      op-node and batcher are not included in this minimal setup.")
    plan.print("      You have a working L2 execution layer you can deploy contracts to!")
    
    plan.print("")
    plan.print("=" * 70)
    plan.print("✅ Localnet Deployed!")
    plan.print("=" * 70)
    plan.print("")
    plan.print("Get endpoints with:")
    plan.print("  kurtosis enclave inspect jeju-localnet")
    plan.print("")
    plan.print("Get L2 RPC port:")
    plan.print("  kurtosis port print jeju-localnet op-geth rpc")
    plan.print("")
    
    return {"status": "success"}
