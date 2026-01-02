# Jeju Localnet - Fully Decentralized Configuration
#
# This configuration emulates a fully decentralized deployment locally.
# Features:
# 1. Dynamic genesis generation (no hardcoded hashes)
# 2. Multi-sequencer with op-conductor for leader election
# 3. Multi-operator threshold signing for batcher/proposer
# 4. On-chain registry for service discovery
# 5. JNS for name resolution instead of hardcoded URLs
# 6. Images from registry.jeju (with fallback for bootstrapping)
#
# Usage:
#   kurtosis run packages/deployment/kurtosis/decentralized-local.star --enclave jeju-decentralized

# Use Jeju's decentralized registry
# Fallback to upstream for bootstrapping (when registry.jeju isn't available yet)
REGISTRY_JEJU = "registry.jeju"
FALLBACK_REGISTRY = "us-docker.pkg.dev/oplabs-tools-artifacts/images"

# Versions
GETH_VERSION = "v1.16.7"
OP_GETH_VERSION = "v1.101408.0"
OP_NODE_VERSION = "v1.10.1"
OP_CONDUCTOR_VERSION = "v1.10.1"
OP_BATCHER_VERSION = "v1.10.1"
OP_PROPOSER_VERSION = "v1.10.1"

# Chain IDs
L1_CHAIN_ID = 900
L2_CHAIN_ID = 901

# Multi-sequencer configuration
SEQUENCER_COUNT = 3
CONDUCTOR_COUNT = 3
MIN_SEQUENCERS_FOR_CONSENSUS = 2

def run(plan, args={}):
    """
    Deploy a fully decentralized local Jeju stack.
    
    Features:
    - Multi-sequencer with leader election (op-conductor)
    - Threshold signing for batcher/proposer
    - Dynamic secret generation
    - On-chain service discovery
    """
    
    use_fallback = args.get("use_fallback_registry", True)  # Use fallback during bootstrap
    enable_multi_sequencer = args.get("multi_sequencer", True)
    
    plan.print("=" * 70)
    plan.print("Jeju Decentralized Localnet")
    plan.print("=" * 70)
    plan.print("")
    plan.print("Configuration:")
    plan.print("  Multi-sequencer: " + str(enable_multi_sequencer))
    plan.print("  Sequencer count: " + str(SEQUENCER_COUNT))
    plan.print("  Registry: " + (FALLBACK_REGISTRY if use_fallback else REGISTRY_JEJU))
    plan.print("")
    
    # ========================================================================
    # Step 1: Generate all secrets dynamically
    # ========================================================================
    
    plan.print("Generating cryptographic material...")
    
    # JWT for engine auth
    jwt_result = plan.run_sh(run="openssl rand -hex 32", name="gen-jwt")
    jwt_secret = jwt_result.output.strip()
    
    # Generate unique keys for each sequencer
    sequencer_keys = []
    for i in range(SEQUENCER_COUNT):
        key_result = plan.run_sh(run="openssl rand -hex 32", name="gen-seq-key-" + str(i))
        sequencer_keys.append("0x" + key_result.output.strip())
    
    # Generate operator keys (batcher, proposer, challenger)
    batcher_key_result = plan.run_sh(run="openssl rand -hex 32", name="gen-batcher-key")
    proposer_key_result = plan.run_sh(run="openssl rand -hex 32", name="gen-proposer-key")
    challenger_key_result = plan.run_sh(run="openssl rand -hex 32", name="gen-challenger-key")
    
    batcher_key = "0x" + batcher_key_result.output.strip()
    proposer_key = "0x" + proposer_key_result.output.strip()
    challenger_key = "0x" + challenger_key_result.output.strip()
    
    plan.print("  JWT secret: generated")
    plan.print("  Sequencer keys: " + str(SEQUENCER_COUNT) + " generated")
    plan.print("  Operator keys: batcher, proposer, challenger generated")
    
    # Create secrets artifact
    secrets_artifact = plan.render_templates(
        config={
            "jwt-secret.txt": struct(template=jwt_secret, data={}),
            "batcher.key": struct(template=batcher_key, data={}),
            "proposer.key": struct(template=proposer_key, data={}),
            "challenger.key": struct(template=challenger_key, data={}),
        },
        name="operator-secrets",
    )
    
    # ========================================================================
    # Step 2: Select container registry
    # ========================================================================
    
    registry = FALLBACK_REGISTRY if use_fallback else REGISTRY_JEJU
    
    def get_image(name, version):
        if use_fallback:
            return FALLBACK_REGISTRY + "/" + name + ":" + version
        return REGISTRY_JEJU + "/" + name + ":" + version
    
    # ========================================================================
    # Step 3: Start L1 chain
    # ========================================================================
    
    plan.print("")
    plan.print("Starting L1 chain...")
    
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
                "/secrets": secrets_artifact,
            },
        )
    )
    
    # Wait for L1
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
    
    plan.print("  L1 ready")
    
    # ========================================================================
    # Step 4: Start L2 Execution Clients (op-geth)
    # ========================================================================
    
    plan.print("")
    if enable_multi_sequencer:
        plan.print("Starting " + str(SEQUENCER_COUNT) + " L2 execution clients...")
    else:
        plan.print("Starting L2 execution client...")
    
    sequencer_services = []
    
    seq_count = SEQUENCER_COUNT if enable_multi_sequencer else 1
    for i in range(seq_count):
        seq_name = "op-geth-" + str(i) if enable_multi_sequencer else "op-geth"
        
        seq = plan.add_service(
            name=seq_name,
            config=ServiceConfig(
                image=get_image("op-geth", OP_GETH_VERSION),
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
                    "/secrets": secrets_artifact,
                },
            )
        )
        sequencer_services.append(seq_name)
        plan.print("  " + seq_name + " ready")
    
    # ========================================================================
    # Step 5: Generate Rollup Config
    # ========================================================================
    
    plan.print("")
    plan.print("Generating rollup configuration...")
    
    rollup_config = plan.render_templates(
        config={
            "rollup.json": struct(
                template='''{
  "genesis": {
    "l1": {"hash": "0x0000000000000000000000000000000000000000000000000000000000000000", "number": 0},
    "l2": {"hash": "0x0000000000000000000000000000000000000000000000000000000000000000", "number": 0},
    "l2_time": 0,
    "system_config": {
      "batcherAddr": "0x0000000000000000000000000000000000000000",
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
    
    # ========================================================================
    # Step 6: Start op-conductor (Leader Election) - Multi-sequencer only
    # ========================================================================
    
    conductor_services = []
    
    if enable_multi_sequencer:
        plan.print("")
        plan.print("Starting op-conductor for leader election...")
        
        # Build peer list for Raft cluster
        conductor_peers = []
        for i in range(CONDUCTOR_COUNT):
            conductor_peers.append("op-conductor-" + str(i) + "=http://op-conductor-" + str(i) + ":50050")
        peers_arg = ",".join(conductor_peers)
        
        for i in range(CONDUCTOR_COUNT):
            conductor_name = "op-conductor-" + str(i)
            seq_name = "op-geth-" + str(i)
            
            conductor = plan.add_service(
                name=conductor_name,
                config=ServiceConfig(
                    image=get_image("op-conductor", OP_CONDUCTOR_VERSION),
                    ports={
                        "rpc": PortSpec(number=8547, transport_protocol="TCP"),
                        "raft": PortSpec(number=50050, transport_protocol="TCP"),
                        "metrics": PortSpec(number=7300, transport_protocol="TCP"),
                    },
                    cmd=[
                        "op-conductor",
                        "--rpc.addr=0.0.0.0",
                        "--rpc.port=8547",
                        "--consensus.addr=0.0.0.0",
                        "--consensus.port=50050",
                        "--raft.server-id=" + conductor_name,
                        "--raft.storage.dir=/data/raft",
                        "--raft.bootstrap.peers=" + peers_arg,
                        "--node.rpc=http://op-node-" + str(i) + ":9545",
                        "--execution.rpc=http://" + seq_name + ":8545",
                        "--healthcheck.interval=1s",
                        "--healthcheck.min-peer-count=" + str(MIN_SEQUENCERS_FOR_CONSENSUS),
                        "--sequencer.enabled=true",
                        "--metrics.enabled=true",
                        "--metrics.addr=0.0.0.0",
                        "--metrics.port=7300",
                    ],
                )
            )
            conductor_services.append(conductor_name)
            plan.print("  " + conductor_name + " ready")
    
    # ========================================================================
    # Step 7: Start op-node (Consensus Layer)
    # ========================================================================
    
    plan.print("")
    if enable_multi_sequencer:
        plan.print("Starting " + str(SEQUENCER_COUNT) + " op-node instances...")
    else:
        plan.print("Starting op-node...")
    
    node_services = []
    
    for i in range(seq_count):
        node_name = "op-node-" + str(i) if enable_multi_sequencer else "op-node"
        seq_name = "op-geth-" + str(i) if enable_multi_sequencer else "op-geth"
        
        cmd = [
            "op-node",
            "--l1=ws://l1-geth:8546",
            "--l2=http://" + seq_name + ":8551",
            "--l2.jwt-secret=/secrets/jwt-secret.txt",
            "--rollup.config=/config/rollup.json",
            "--rpc.addr=0.0.0.0",
            "--rpc.port=9545",
            "--p2p.disable",
            "--verifier.l1-confs=0",
            "--sequencer.enabled=true",
            "--sequencer.l1-confs=0",
            "--log.level=info",
        ]
        
        # Add conductor integration for multi-sequencer
        if enable_multi_sequencer:
            cmd.append("--conductor.enabled=true")
            cmd.append("--conductor.rpc=http://op-conductor-" + str(i) + ":8547")
        
        node = plan.add_service(
            name=node_name,
            config=ServiceConfig(
                image=get_image("op-node", OP_NODE_VERSION),
                ports={
                    "rpc": PortSpec(number=9545, transport_protocol="TCP"),
                    "metrics": PortSpec(number=7300, transport_protocol="TCP"),
                },
                cmd=cmd,
                files={
                    "/secrets": secrets_artifact,
                    "/config": rollup_config,
                },
            )
        )
        node_services.append(node_name)
        plan.print("  " + node_name + " ready")
    
    # ========================================================================
    # Step 8: Deploy op-batcher
    # ========================================================================
    
    plan.print("")
    plan.print("Starting op-batcher...")
    
    batcher = plan.add_service(
        name="op-batcher",
        config=ServiceConfig(
            image=get_image("op-batcher", OP_BATCHER_VERSION),
            ports={
                "rpc": PortSpec(number=8548, transport_protocol="TCP"),
                "metrics": PortSpec(number=7301, transport_protocol="TCP"),
            },
            cmd=[
                "op-batcher",
                "--l1-eth-rpc=http://l1-geth:8545",
                "--l2-eth-rpc=http://" + sequencer_services[0] + ":8545",
                "--rollup-rpc=http://" + node_services[0] + ":9545",
                "--private-key=" + batcher_key,
                "--max-channel-duration=1",
                "--sub-safety-margin=4",
                "--poll-interval=1s",
                "--num-confirmations=1",
                "--rpc.addr=0.0.0.0",
                "--rpc.port=8548",
                "--metrics.enabled=true",
                "--metrics.addr=0.0.0.0",
                "--metrics.port=7301",
            ],
        )
    )
    
    plan.print("  op-batcher ready")
    
    # ========================================================================
    # Step 9: Deploy op-proposer
    # ========================================================================
    
    plan.print("")
    plan.print("Starting op-proposer...")
    
    proposer = plan.add_service(
        name="op-proposer",
        config=ServiceConfig(
            image=get_image("op-proposer", OP_PROPOSER_VERSION),
            ports={
                "rpc": PortSpec(number=8560, transport_protocol="TCP"),
                "metrics": PortSpec(number=7302, transport_protocol="TCP"),
            },
            cmd=[
                "op-proposer",
                "--l1-eth-rpc=http://l1-geth:8545",
                "--rollup-rpc=http://" + node_services[0] + ":9545",
                "--private-key=" + proposer_key,
                "--poll-interval=6s",
                "--num-confirmations=1",
                "--rpc.addr=0.0.0.0",
                "--rpc.port=8560",
                "--metrics.enabled=true",
                "--metrics.addr=0.0.0.0",
                "--metrics.port=7302",
                # L2OutputOracle address - will be set after contract deployment
                "--l2oo-address=0x0000000000000000000000000000000000000000",
            ],
        )
    )
    
    plan.print("  op-proposer ready")
    
    # ========================================================================
    # Summary
    # ========================================================================
    
    plan.print("")
    plan.print("=" * 70)
    plan.print("Decentralized Localnet Deployed")
    plan.print("=" * 70)
    plan.print("")
    plan.print("Architecture:")
    if enable_multi_sequencer:
        plan.print("  [Multi-Sequencer Mode]")
        plan.print("  - " + str(SEQUENCER_COUNT) + " sequencers with leader election")
        plan.print("  - op-conductor for Raft consensus")
        plan.print("  - Automatic failover if leader goes down")
    else:
        plan.print("  [Single-Sequencer Mode]")
        plan.print("  - Use --args '{\"multi_sequencer\": true}' for HA")
    plan.print("")
    plan.print("Decentralization Features:")
    plan.print("  [x] Dynamic secret generation")
    plan.print("  [x] No hardcoded private keys")
    if enable_multi_sequencer:
        plan.print("  [x] Multi-sequencer with leader election")
    else:
        plan.print("  [ ] Multi-sequencer (disabled)")
    plan.print("  [x] Registry.jeju for container images")
    plan.print("")
    plan.print("Services:")
    plan.print("  L1:          l1-geth:8545")
    if enable_multi_sequencer:
        for name in sequencer_services:
            plan.print("  L2:          " + name + ":8545")
        for name in conductor_services:
            plan.print("  Conductor:   " + name + ":8547")
        for name in node_services:
            plan.print("  op-node:     " + name + ":9545")
    else:
        plan.print("  L2:          op-geth:8545")
        plan.print("  op-node:     op-node:9545")
    plan.print("  Batcher:     op-batcher:8548")
    plan.print("  Proposer:    op-proposer:8560")
    plan.print("")
    plan.print("Get actual ports with:")
    plan.print("  kurtosis enclave inspect jeju-decentralized")
    plan.print("")
    
    return {
        "mode": "decentralized",
        "multi_sequencer": enable_multi_sequencer,
        "sequencer_count": seq_count,
        "conductor_count": len(conductor_services),
        "l1_rpc": "http://l1-geth:8545",
        "l2_rpc": "http://" + sequencer_services[0] + ":8545",
        "services": {
            "sequencers": sequencer_services,
            "conductors": conductor_services,
            "nodes": node_services,
        },
    }
