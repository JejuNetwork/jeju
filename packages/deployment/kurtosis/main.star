# Jeju Localnet - Full OP Stack with SQLit + Solana
#
# This sets up a complete local development environment:
# - L1: Geth with OP Stack contracts (dev mode)
# - L2: op-geth + op-node with derivation pipeline
# - SQLit: Decentralized database (optional)
# - Solana: Test validator for cross-chain operations (optional)
#
# Usage:
#   # Simple mode (two independent chains, no derivation)
#   kurtosis run packages/deployment/kurtosis --enclave jeju-localnet
#
#   # Real OP Stack with derivation
#   kurtosis run packages/deployment/kurtosis --enclave jeju-localnet --args '{"real": true}'
#
#   # With SQLit
#   kurtosis run packages/deployment/kurtosis --enclave jeju-localnet --args '{"enable_sqlit": true}'

# Pinned versions for reproducibility (January 2026)
GETH_VERSION = "v1.16.7"  # Fusaka-compatible (required for PeerDAS + blob capacity)
OP_GETH_VERSION = "v1.101408.0"  # Latest stable op-geth version
OP_NODE_VERSION = "v1.10.1"  # Latest stable op-node version

# Chain configuration
L1_CHAIN_ID = 900
L2_CHAIN_ID = 901

# SQLit - use the upstream image
SQLIT_IMAGE = "sqlit/sqlit:latest"

# Solana test validator
SOLANA_IMAGE = "solanalabs/solana:v1.18.26"

# Predeploy addresses (OP Stack standard)
L2_CROSS_DOMAIN_MESSENGER = "0x4200000000000000000000000000000000000007"
L2_TO_L1_MESSAGE_PASSER = "0x4200000000000000000000000000000000000016"
L2_STANDARD_BRIDGE = "0x4200000000000000000000000000000000000010"

def run(plan, args={}):
    """
    Deploy Jeju localnet.
    
    Args:
        real: If true, use real OP Stack with op-node derivation
        enable_sqlit: If true, start SQLit node
        enable_solana: If true, start Solana test validator
        sqlit_image: Custom SQLit image
        solana_image: Custom Solana image
    """
    
    real = args.get("real", False)
    enable_sqlit = args.get("enable_sqlit", False)
    enable_solana = args.get("enable_solana", False)
    sqlit_image = args.get("sqlit_image", SQLIT_IMAGE)
    solana_image = args.get("solana_image", SOLANA_IMAGE)
    
    plan.print("Starting Jeju Localnet...")
    plan.print("Mode: " + ("Real OP Stack" if real else "Simple (dev mode)"))
    plan.print("Geth: " + GETH_VERSION)
    plan.print("OP-Geth: " + OP_GETH_VERSION)
    if real:
        plan.print("OP-Node: " + OP_NODE_VERSION)
    plan.print("")
    
    services = []
    
    if real:
        result = run_real_op_stack(plan, args)
        services.extend(["l1-geth", "op-geth", "op-node"])
    else:
        result = run_simple(plan, args)
        services.extend(["geth-l1", "op-geth"])
    
    # Optional: SQLit
    if enable_sqlit:
        start_sqlit(plan, sqlit_image)
        services.append("sqlit")
    
    # Optional: Solana
    if enable_solana:
        start_solana(plan, solana_image)
        services.append("solana-validator")
    
    print_endpoints(plan, real, enable_sqlit, enable_solana)
    
    return {"status": "success", "services": services, **result}


def run_simple(plan, args):
    """Simple mode: Two independent chains (no derivation)."""
    
    plan.print("=" * 70)
    plan.print("WARNING: Simple mode - NO L1 <-> L2 derivation")
    plan.print("         Deposits on L1 will NOT appear on L2")
    plan.print("         Use --args '{\"real\": true}' for real OP Stack")
    plan.print("=" * 70)
    plan.print("")
    
    # L1: Geth in dev mode
    l1 = plan.add_service(
        name="geth-l1",
        config=ServiceConfig(
            image="ethereum/client-go:" + GETH_VERSION,
            ports={
                "rpc": PortSpec(number=8545, transport_protocol="TCP"),
                "ws": PortSpec(number=8546, transport_protocol="TCP"),
            },
            cmd=[
                "--dev",
                "--dev.period=1",
                "--http",
                "--http.addr=0.0.0.0",
                "--http.port=8545",
                "--http.api=eth,net,web3,debug,personal,admin",
                "--http.corsdomain=*",
                "--ws",
                "--ws.addr=0.0.0.0",
                "--ws.port=8546",
                "--ws.api=eth,net,web3",
                "--ws.origins=*",
                "--nodiscover",
            ]
        )
    )
    
    plan.print("L1 (Geth --dev) started")
    
    # L2: op-geth in dev mode
    l2 = plan.add_service(
        name="op-geth",
        config=ServiceConfig(
            image="us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:" + OP_GETH_VERSION,
            ports={
                "rpc": PortSpec(number=9545, transport_protocol="TCP"),
                "ws": PortSpec(number=9546, transport_protocol="TCP"),
            },
            cmd=[
                "--dev",
                "--dev.period=2",
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
                "--networkid=" + str(L2_CHAIN_ID),
            ]
        )
    )
    
    plan.print("L2 (op-geth --dev) started")
    
    return {
        "mode": "simple",
        "l1_rpc": "http://geth-l1:8545",
        "l2_rpc": "http://op-geth:9545",
        "derivation": False,
    }


def run_real_op_stack(plan, args):
    """Real mode: L2 derived from L1 via op-node."""
    
    plan.print("=" * 70)
    plan.print("Starting Real OP Stack with Derivation")
    plan.print("L1 Chain ID: " + str(L1_CHAIN_ID))
    plan.print("L2 Chain ID: " + str(L2_CHAIN_ID))
    plan.print("=" * 70)
    plan.print("")
    
    # Generate JWT secret for engine auth
    jwt_result = plan.run_sh(
        run="openssl rand -hex 32",
        name="generate-jwt"
    )
    jwt_secret = jwt_result.output.strip()
    
    jwt_artifact = plan.render_templates(
        config={
            "jwt-secret.txt": struct(
                template=jwt_secret,
                data={},
            ),
        },
        name="jwt-secret",
    )
    
    # L1: Geth with auth RPC
    l1 = plan.add_service(
        name="l1-geth",
        config=ServiceConfig(
            image="ethereum/client-go:" + GETH_VERSION,
            ports={
                "rpc": PortSpec(number=8545, transport_protocol="TCP"),
                "ws": PortSpec(number=8546, transport_protocol="TCP"),
                "authrpc": PortSpec(number=8551, transport_protocol="TCP"),
            },
            cmd=[
                "--dev",
                "--dev.period=2",
                "--http",
                "--http.addr=0.0.0.0",
                "--http.port=8545",
                "--http.api=eth,net,web3,debug,personal,admin,txpool",
                "--http.corsdomain=*",
                "--ws",
                "--ws.addr=0.0.0.0",
                "--ws.port=8546",
                "--ws.api=eth,net,web3,debug",
                "--ws.origins=*",
                "--authrpc.addr=0.0.0.0",
                "--authrpc.port=8551",
                "--authrpc.vhosts=*",
                "--authrpc.jwtsecret=/secrets/jwt-secret.txt",
                "--nodiscover",
                "--networkid=" + str(L1_CHAIN_ID),
            ],
            files={
                "/secrets": jwt_artifact,
            },
        )
    )
    
    plan.print("L1 Geth started")
    
    # Wait for L1 to be ready
    plan.wait(
        service_name="l1-geth",
        recipe=PostHttpRequestRecipe(
            port_id="rpc",
            endpoint="/",
            content_type="application/json",
            body='{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}',
        ),
        field="code",
        assertion="==",
        target_value=200,
        timeout="60s",
    )
    
    # L2: op-geth (Execution Layer)
    l2_geth = plan.add_service(
        name="op-geth",
        config=ServiceConfig(
            image="us-docker.pkg.dev/oplabs-tools-artifacts/images/op-geth:" + OP_GETH_VERSION,
            ports={
                "rpc": PortSpec(number=8545, transport_protocol="TCP"),
                "ws": PortSpec(number=8546, transport_protocol="TCP"),
                "authrpc": PortSpec(number=8551, transport_protocol="TCP"),
            },
            cmd=[
                "--dev",
                "--dev.period=2",
                "--http",
                "--http.addr=0.0.0.0",
                "--http.port=8545",
                "--http.api=eth,net,web3,debug,txpool,engine",
                "--http.corsdomain=*",
                "--ws",
                "--ws.addr=0.0.0.0",
                "--ws.port=8546",
                "--ws.api=eth,net,web3,debug",
                "--ws.origins=*",
                "--authrpc.addr=0.0.0.0",
                "--authrpc.port=8551",
                "--authrpc.vhosts=*",
                "--authrpc.jwtsecret=/secrets/jwt-secret.txt",
                "--nodiscover",
                "--networkid=" + str(L2_CHAIN_ID),
                "--maxpeers=0",
                "--gcmode=archive",
            ],
            files={
                "/secrets": jwt_artifact,
            },
        )
    )
    
    plan.print("op-geth started")
    
    # Rollup config
    rollup_config = plan.render_templates(
        config={
            "rollup.json": struct(
                template='''{
  "genesis": {
    "l1": {"hash": "0x0000000000000000000000000000000000000000000000000000000000000000", "number": 0},
    "l2": {"hash": "0x0000000000000000000000000000000000000000000000000000000000000000", "number": 0},
    "l2_time": 0,
    "system_config": {
      "batcherAddr": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      "overhead": "0x0000000000000000000000000000000000000000000000000000000000000000",
      "scalar": "0x00000000000000000000000000000000000000000000000000000000000f4240",
      "gasLimit": 30000000
    }
  },
  "block_time": 2,
  "max_sequencer_drift": 600,
  "seq_window_size": 3600,
  "channel_timeout": 300,
  "l1_chain_id": ''' + str(L1_CHAIN_ID) + ''',
  "l2_chain_id": ''' + str(L2_CHAIN_ID) + ''',
  "regolith_time": 0,
  "canyon_time": 0,
  "delta_time": 0,
  "ecotone_time": 0,
  "fjord_time": 0,
  "granite_time": 0,
  "holocene_time": 0,
  "isthmus_time": 0,
  "batch_inbox_address": "0xff00000000000000000000000000000000000901",
  "deposit_contract_address": "0x0000000000000000000000000000000000000000",
  "l1_system_config_address": "0x0000000000000000000000000000000000000000"
}''',
                data={},
            ),
        },
        name="rollup-config",
    )
    
    # op-node (Consensus/Derivation Layer)
    op_node = plan.add_service(
        name="op-node",
        config=ServiceConfig(
            image="us-docker.pkg.dev/oplabs-tools-artifacts/images/op-node:" + OP_NODE_VERSION,
            ports={
                "rpc": PortSpec(number=9545, transport_protocol="TCP"),
                "metrics": PortSpec(number=7300, transport_protocol="TCP"),
            },
            cmd=[
                "op-node",
                "--l1=ws://l1-geth:8546",
                "--l2=http://op-geth:8551",
                "--l2.jwt-secret=/secrets/jwt-secret.txt",
                "--rollup.config=/config/rollup.json",
                "--rpc.addr=0.0.0.0",
                "--rpc.port=9545",
                "--p2p.disable",
                "--verifier.l1-confs=0",
                "--sequencer.enabled=true",
                "--sequencer.l1-confs=0",
                "--log.level=info",
            ],
            files={
                "/secrets": jwt_artifact,
                "/config": rollup_config,
            },
        )
    )
    
    plan.print("op-node started")
    
    return {
        "mode": "real",
        "l1_rpc": "http://l1-geth:8545",
        "l2_rpc": "http://op-geth:8545",
        "op_node_rpc": "http://op-node:9545",
        "derivation": True,
    }


def start_sqlit(plan, sqlit_image):
    """Start SQLit node."""
    
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
                "api": PortSpec(number=4661, transport_protocol="TCP"),
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


def start_solana(plan, solana_image):
    """Start Solana test validator."""
    
    solana = plan.add_service(
        name="solana-validator",
        config=ServiceConfig(
            image=solana_image,
            ports={
                "rpc": PortSpec(number=8899, transport_protocol="TCP"),
                "ws": PortSpec(number=8900, transport_protocol="TCP"),
                "faucet": PortSpec(number=9900, transport_protocol="TCP"),
            },
            cmd=[
                "solana-test-validator",
                "--bind-address", "0.0.0.0",
                "--rpc-port", "8899",
                "--faucet-port", "9900",
                "--ledger", "/data/ledger",
                "--log",
                "--reset",
                "--quiet",
            ],
            env_vars={
                "RUST_LOG": "solana_runtime::system_instruction_processor=warn,solana_runtime::message_processor=warn,solana_bpf_loader=warn,solana_rbpf=warn",
            },
        )
    )
    
    plan.print("Solana Test Validator started")


def print_endpoints(plan, real, enable_sqlit, enable_solana):
    """Print endpoint information."""
    
    plan.print("")
    plan.print("=" * 70)
    plan.print("Jeju Localnet Deployed")
    plan.print("=" * 70)
    plan.print("")
    plan.print("Get actual ports with:")
    plan.print("  kurtosis enclave inspect jeju-localnet")
    plan.print("")
    plan.print("Port forwarding:")
    if real:
        plan.print("  kurtosis port print jeju-localnet l1-geth rpc")
    else:
        plan.print("  kurtosis port print jeju-localnet geth-l1 rpc")
    plan.print("  kurtosis port print jeju-localnet op-geth rpc")
    if enable_sqlit:
        plan.print("  kurtosis port print jeju-localnet sqlit api")
    if enable_solana:
        plan.print("  kurtosis port print jeju-localnet solana-validator rpc")
    plan.print("")
    plan.print("To deploy L1 OP Stack contracts:")
    plan.print("  cd packages/contracts")
    plan.print("  forge script script/DeployL1OpStack.s.sol --rpc-url <L1_RPC> --broadcast")
    plan.print("")
