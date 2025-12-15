# Jeju Localnet - Full Stack with CovenantSQL
# Pure TCP ports only - no UDP/QUIC issues on macOS!

# Pinned versions for reproducibility (December 2025)
OP_STACK_VERSION = "v1.16.3"
GETH_VERSION = "v1.16.7"  # Fusaka-compatible (required for PeerDAS + blob capacity)
OP_GETH_VERSION = "v1.101603.5"  # Latest stable op-geth version
OP_RETH_VERSION = "v1.1.2"

# CovenantSQL - multi-arch image supporting both ARM64 (Apple Silicon, Graviton) and x86_64
# Build custom image with: bun run images:cql (from packages/deployment)
# Or use upstream: covenantsql/covenantsql:latest
CQL_IMAGE = "jeju/covenantsql:testnet-latest"

def run(plan, args={}):
    """
    Full Jeju stack for local development:
    - L1: Geth --dev (auto-mines, no consensus needed)
    - L2: op-geth + op-node with P2P disabled (no UDP)
    - CQL: CovenantSQL block producer for decentralized storage
    - Only TCP ports = works on macOS Docker Desktop
    """
    
    # Allow custom CQL image override via args
    cql_image = args.get("cql_image", CQL_IMAGE)
    
    plan.print("Starting Jeju Localnet...")
    plan.print("OP Stack: " + OP_STACK_VERSION)
    plan.print("CovenantSQL: " + cql_image)
    plan.print("")
    
    # L1: Geth in dev mode
    l1 = plan.add_service(
        name="geth-l1",
        config=ServiceConfig(
            image="ethereum/client-go:" + GETH_VERSION,
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
    
    plan.print("L1 started")
    
    # L2: op-geth (simplified - just RPC for now)
    l2_el = plan.add_service(
        name="op-geth",
        config=ServiceConfig(
            image="us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:" + OP_GETH_VERSION,
            ports={
                "rpc": PortSpec(number=9545, transport_protocol="TCP", application_protocol="http"),
                "ws": PortSpec(number=9546, transport_protocol="TCP", application_protocol="ws"),
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
    
    plan.print("L2 Execution started")
    
    # CovenantSQL: Decentralized database for messaging and storage
    # Using SQLite-compatible mode for single-node local dev
    cql = plan.add_service(
        name="covenantsql",
        config=ServiceConfig(
            image=cql_image,
            ports={
                "api": PortSpec(number=4300, transport_protocol="TCP", application_protocol="http"),
                "rpc": PortSpec(number=4661, transport_protocol="TCP"),
            },
            cmd=[
                "-config", "/app/config.yaml",
                "-single-node",  # Single node mode for local dev
            ],
            env_vars={
                "CQL_LOG_LEVEL": "info",
            },
            files={
                "/app/config.yaml": """
# CovenantSQL single-node config for local development
WorkingRoot: "/data"
ThisNodeID: "00000000000000000000000000000000"
ListenAddr: "0.0.0.0:4661"
APIAddr: "0.0.0.0:4300"
LogLevel: "info"
Genesis:
  Timestamp: "2024-01-01T00:00:00Z"
  BaseVersion: "1.0.0"
""",
            },
        )
    )
    
    plan.print("CovenantSQL started")
    
    plan.print("")
    plan.print("=" * 70)
    plan.print("Jeju Localnet Deployed")
    plan.print("=" * 70)
    plan.print("")
    plan.print("Endpoints:")
    plan.print("  L1 RPC:  http://127.0.0.1:8545")
    plan.print("  L2 RPC:  http://127.0.0.1:9545  (use port forwarding)")
    plan.print("  CQL API: http://127.0.0.1:4300  (use port forwarding)")
    plan.print("")
    plan.print("Get actual ports with:")
    plan.print("  kurtosis enclave inspect jeju-localnet")
    plan.print("")
    plan.print("Port forwarding commands:")
    plan.print("  kurtosis port print jeju-localnet op-geth rpc")
    plan.print("  kurtosis port print jeju-localnet covenantsql api")
    plan.print("")
    
    return {"status": "success", "services": ["geth-l1", "op-geth", "covenantsql"]}
