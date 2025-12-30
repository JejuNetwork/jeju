# Jeju Localnet - Full Stack with SQLit + Solana
# Pure TCP ports only - no UDP/QUIC issues on macOS!

# Pinned versions for reproducibility (December 2025)
OP_STACK_VERSION = "v1.16.3"
GETH_VERSION = "v1.16.7"  # Fusaka-compatible (required for PeerDAS + blob capacity)
OP_GETH_VERSION = "v1.101603.5"  # Latest stable op-geth version
OP_RETH_VERSION = "v1.1.2"
SOLANA_VERSION = "v2.1.0"  # Solana validator version

# SQLit - use the upstream image
SQLIT_IMAGE = "sqlit/sqlit:latest"

# Solana test validator - disabled by default as no official Docker image available
# Build custom or use community image if needed
SOLANA_IMAGE = "solanalabs/solana:v1.18.26"

def run(plan, args={}):
    """
    Full Jeju stack for local development:
    - L1: Geth --dev (auto-mines, no consensus needed)
    - L2: op-geth + op-node with P2P disabled (no UDP)
    - SQLit: SQLit block producer for decentralized storage
    - Solana: Test validator for cross-chain MEV/LP operations
    - Only TCP ports = works on macOS Docker Desktop
    """
    
    # Allow custom image overrides via args
    sqlit_image = args.get("sqlit_image", SQLIT_IMAGE)
    solana_image = args.get("solana_image", SOLANA_IMAGE)
    enable_sqlit = args.get("enable_sqlit", False)  # Disabled by default - official image has incompatible entrypoint
    enable_solana = args.get("enable_solana", False)  # Disabled by default - no reliable Docker image
    
    plan.print("Starting Jeju Localnet...")
    plan.print("OP Stack: " + OP_STACK_VERSION)
    plan.print("SQLit: " + sqlit_image)
    if enable_solana:
        plan.print("Solana: " + solana_image)
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
    
    services = ["geth-l1", "op-geth"]
    
    # SQLit: Decentralized database for messaging and storage (optional)
    if enable_sqlit:
        sqlit_config = plan.render_templates(
            config={
                "config.yaml": struct(
                    template="""# SQLit single-node config for local development
WorkingRoot: "/data"
ThisNodeID: "00000000000000000000000000000000"
ListenAddr: "0.0.0.0:4661"
APIAddr: "0.0.0.0:4661"
LogLevel: "info"
Genesis:
  Timestamp: "2024-01-01T00:00:00Z"
  BaseVersion: "1.0.0"
""",
                    data={},
                ),
            },
            name="sqlit-config",
        )
        
        sqlit = plan.add_service(
            name="sqlit",
            config=ServiceConfig(
                image=sqlit_image,
                ports={
                    "api": PortSpec(number=4661, transport_protocol="TCP", application_protocol="http"),
                    "rpc": PortSpec(number=4661, transport_protocol="TCP"),
                },
                cmd=[
                    "-config", "/app/config.yaml",
                    "-single-node",
                ],
                env_vars={
                    "SQLIT_LOG_LEVEL": "info",
                },
                files={
                    "/app": sqlit_config,
                },
            )
        )
        
        plan.print("SQLit started")
        services.append("sqlit")
    
    if enable_solana:
        solana = plan.add_service(
            name="solana-validator",
            config=ServiceConfig(
                image=solana_image,
                ports={
                    "rpc": PortSpec(number=8899, transport_protocol="TCP", application_protocol="http"),
                    "ws": PortSpec(number=8900, transport_protocol="TCP", application_protocol="ws"),
                    "faucet": PortSpec(number=9900, transport_protocol="TCP", application_protocol="http"),
                },
                cmd=[
                    "solana-test-validator",
                    "--bind-address", "0.0.0.0",
                    "--rpc-port", "8899",
                    "--faucet-port", "9900",
                    "--ledger", "/data/ledger",
                    "--log",
                    "--reset",  # Start fresh each time
                    "--quiet",
                ],
                env_vars={
                    "RUST_LOG": "solana_runtime::system_instruction_processor=warn,solana_runtime::message_processor=warn,solana_bpf_loader=warn,solana_rbpf=warn",
                },
            )
        )
        
        plan.print("Solana Test Validator started")
        services.append("solana-validator")
    
    plan.print("")
    plan.print("=" * 70)
    plan.print("Jeju Localnet Deployed")
    plan.print("=" * 70)
    plan.print("")
    plan.print("Endpoints:")
    plan.print("  L1 RPC:     http://127.0.0.1:6545")
    plan.print("  L2 RPC:     http://127.0.0.1:6546  (use port forwarding)")
    if enable_sqlit:
        plan.print("  SQLit API:    http://127.0.0.1:4661  (use port forwarding)")
    if enable_solana:
        plan.print("  Solana RPC: http://127.0.0.1:8899  (use port forwarding)")
        plan.print("  Solana WS:  ws://127.0.0.1:8900   (use port forwarding)")
    plan.print("")
    plan.print("Get actual ports with:")
    plan.print("  kurtosis enclave inspect jeju-localnet")
    plan.print("")
    plan.print("Port forwarding commands:")
    plan.print("  kurtosis port print jeju-localnet op-geth rpc")
    if enable_sqlit:
        plan.print("  kurtosis port print jeju-localnet sqlit api")
    if enable_solana:
        plan.print("  kurtosis port print jeju-localnet solana-validator rpc")
    plan.print("")
    
    return {"status": "success", "services": services}
