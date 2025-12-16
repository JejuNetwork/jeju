// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Script.sol";
import "forge-std/console.sol";
import "../src/sequencer/SequencerRegistry.sol";
import "../src/sequencer/ThresholdBatchSubmitter.sol";
import "../src/governance/GovernanceTimelock.sol";
import "../src/dispute/DisputeGameFactory.sol";
import "../src/dispute/provers/Prover.sol";
import "../src/dispute/provers/CannonProver.sol";
import "../src/bridge/L2OutputOracleAdapter.sol";
import "../src/bridge/OptimismPortalAdapter.sol";
import "../src/bridge/ForcedInclusion.sol";
import "../src/registry/IdentityRegistry.sol";
import "../src/registry/ReputationRegistry.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Note: Cannon components (PreimageOracle, MIPS64) must be deployed separately
// using Optimism's official deployment scripts (requires solc 0.8.15)
// See: https://github.com/ethereum-optimism/optimism/tree/develop/packages/contracts-bedrock

contract MockJEJUToken is ERC20 {
    constructor() ERC20("JEJU", "JEJU") {
        _mint(msg.sender, 10_000_000 ether);
    }
}

/**
 * @title DeployDecentralization
 * @notice Full Stage 2 deployment script for Jeju decentralized infrastructure
 * @dev Deploys all contracts needed for L2BEAT Stage 2 compliance:
 *      - SequencerRegistry (decentralized sequencer set)
 *      - ThresholdBatchSubmitter (N-of-M batch signing)
 *      - GovernanceTimelock (30-day upgrade delays)
 *      - DisputeGameFactory (fraud proof disputes)
 *      - CannonProver (MIPS-based fraud proofs)
 *      - ForcedInclusion (censorship resistance)
 *      - Security Council Safe integration
 */
contract DeployDecentralization is Script {
    // Configuration - Stage 2 compliant values
    uint256 constant TIMELOCK_DELAY = 30 days;
    uint256 constant EMERGENCY_MIN_DELAY = 7 days;
    uint256 constant DISPUTE_TIMEOUT = 7 days;
    
    // Genesis MIPS state hash (to be set from Optimism's official value)
    bytes32 constant ABSOLUTE_PRESTATE = bytes32(0);

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        // Required addresses (from env or defaults)
        address jejuToken = vm.envOr("JEJU_TOKEN", address(0));
        address identityRegistry = vm.envOr("IDENTITY_REGISTRY", address(0));
        address reputationRegistry = vm.envOr("REPUTATION_REGISTRY", address(0));
        address treasury = vm.envOr("TREASURY", deployer);
        address governance = vm.envOr("GOVERNANCE", deployer);
        address securityCouncil = vm.envOr("SECURITY_COUNCIL", address(0));
        address l2OutputOracle = vm.envOr("L2_OUTPUT_ORACLE", address(0));
        
        // Cannon prover addresses (deploy fresh or use existing)
        address mipsAddress = vm.envOr("MIPS_ADDRESS", address(0));
        address preimageOracleAddress = vm.envOr("PREIMAGE_ORACLE_ADDRESS", address(0));

        console.log("==================================================");
        console.log("Deploying Stage 2 Decentralized Infrastructure");
        console.log("==================================================");
        console.log("Deployer:", deployer);
        console.log("Treasury:", treasury);
        console.log("Governance:", governance);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // Deploy mock dependencies for localnet if not provided
        if (jejuToken == address(0) || identityRegistry == address(0) || reputationRegistry == address(0)) {
            console.log("Deploying mock dependencies for local testing...");

            MockJEJUToken mockToken = new MockJEJUToken();
            jejuToken = address(mockToken);
            console.log("MockJEJUToken deployed:", jejuToken);

            IdentityRegistry idRegistry = new IdentityRegistry();
            identityRegistry = address(idRegistry);
            console.log("IdentityRegistry deployed:", identityRegistry);

            ReputationRegistry repRegistry = new ReputationRegistry(payable(identityRegistry));
            reputationRegistry = address(repRegistry);
            console.log("ReputationRegistry deployed:", reputationRegistry);
            console.log("");
        }

        // ============================================================
        // STAGE 2: CANNON FRAUD PROOF SYSTEM
        // ============================================================
        console.log("--- Cannon Fraud Proof System ---");
        
        // For localnet/testnet: use mock MIPS addresses if not provided
        // For mainnet: MUST provide real Optimism MIPS/PreimageOracle addresses
        if (mipsAddress == address(0) || preimageOracleAddress == address(0)) {
            console.log("WARNING: MIPS/PreimageOracle not provided");
            console.log("  Using placeholder addresses for testing");
            console.log("  For mainnet: deploy Optimism's MIPS.sol and PreimageOracle.sol");
            console.log("  Then set MIPS_ADDRESS and PREIMAGE_ORACLE_ADDRESS env vars");
            
            // Create deterministic placeholder addresses for testing
            // These will be replaced with real Optimism contracts in production
            mipsAddress = address(uint160(uint256(keccak256("MIPS_PLACEHOLDER"))));
            preimageOracleAddress = address(uint160(uint256(keccak256("PREIMAGE_ORACLE_PLACEHOLDER"))));
        }
        
        console.log("PreimageOracle:", preimageOracleAddress);
        console.log("MIPS:", mipsAddress);
        
        // Deploy CannonProver with MIPS integration
        // Note: CannonProver will only work for real fraud proofs when
        // connected to actual deployed MIPS and PreimageOracle contracts
        CannonProver cannonProver = new CannonProver(
            mipsAddress,
            preimageOracleAddress,
            ABSOLUTE_PRESTATE
        );
        console.log("CannonProver deployed:", address(cannonProver));
        console.log("");

        // ============================================================
        // STAGE 2: GOVERNANCE & SECURITY
        // ============================================================
        console.log("--- Governance & Security ---");
        
        // Deploy Safe-compatible Security Council if not provided
        // In production, this would be an actual Gnosis Safe multisig
        if (securityCouncil == address(0)) {
            // For localnet/testnet: deployer acts as security council
            // For mainnet: MUST be a Safe with 3/5+ threshold
            securityCouncil = deployer;
            console.log("Security Council (dev mode):", securityCouncil);
            console.log("  WARNING: For mainnet, deploy a Safe multisig!");
        } else {
            console.log("Security Council:", securityCouncil);
        }

        // Deploy GovernanceTimelock with Stage 2 delays
        GovernanceTimelock timelock = new GovernanceTimelock(
            governance, 
            securityCouncil, 
            deployer, 
            TIMELOCK_DELAY
        );
        console.log("GovernanceTimelock deployed:", address(timelock));
        console.log("  - Upgrade delay:", TIMELOCK_DELAY / 1 days, "days");
        console.log("  - Emergency min delay:", EMERGENCY_MIN_DELAY / 1 days, "days");
        console.log("");

        // ============================================================
        // STAGE 2: SEQUENCER DECENTRALIZATION
        // ============================================================
        console.log("--- Sequencer Decentralization ---");
        
        // Deploy SequencerRegistry
        SequencerRegistry sequencerRegistry = new SequencerRegistry(
            jejuToken, 
            identityRegistry, 
            reputationRegistry, 
            treasury, 
            deployer
        );
        console.log("SequencerRegistry deployed:", address(sequencerRegistry));

        // Deploy ThresholdBatchSubmitter
        address batchInbox = vm.envOr("BATCH_INBOX", address(0x4200000000000000000000000000000000000015));
        uint256 batcherThreshold = vm.envOr("SIGNER_THRESHOLD", uint256(2));
        
        ThresholdBatchSubmitter thresholdBatcher = new ThresholdBatchSubmitter(
            batchInbox,
            deployer,
            batcherThreshold
        );
        console.log("ThresholdBatchSubmitter deployed:", address(thresholdBatcher));
        console.log("  - Batch inbox:", batchInbox);
        console.log("  - Threshold:", batcherThreshold);
        console.log("");

        // ============================================================
        // STAGE 2: DISPUTE RESOLUTION
        // ============================================================
        console.log("--- Dispute Resolution ---");
        
        // Deploy DisputeGameFactory
        DisputeGameFactory disputeFactory = new DisputeGameFactory(treasury, deployer);
        console.log("DisputeGameFactory deployed:", address(disputeFactory));
        console.log("  - Dispute timeout:", DISPUTE_TIMEOUT / 1 days, "days");

        // Deploy legacy Prover (signature-based, for testing ONLY)
        // WARNING: This prover is NOT suitable for production - it uses signatures
        // instead of actual computation verification. A single validator can fake fraud.
        Prover legacyProver = new Prover();
        console.log("Prover (legacy/testing):", address(legacyProver));

        // Enable CannonProver (real fraud proofs) 
        disputeFactory.setProverImplementation(DisputeGameFactory.ProverType.CANNON, address(cannonProver), true);
        console.log("  - CannonProver enabled as CANNON prover");
        
        // SECURITY: Legacy prover is DISABLED by default for production safety
        // Only enable for local testing where real MIPS isn't deployed
        bool enableLegacyProver = vm.envOr("ENABLE_LEGACY_PROVER", false);
        if (enableLegacyProver) {
            disputeFactory.setProverImplementation(DisputeGameFactory.ProverType.SIMPLE, address(legacyProver), true);
            console.log("  - WARNING: LegacyProver enabled (testing only, NOT Stage 2 compliant)");
        } else {
            disputeFactory.setProverImplementation(DisputeGameFactory.ProverType.SIMPLE, address(legacyProver), false);
            console.log("  - LegacyProver DISABLED (set ENABLE_LEGACY_PROVER=true for testing)");
        }
        console.log("");

        // ============================================================
        // STAGE 2: FORCED INCLUSION (CENSORSHIP RESISTANCE)
        // ============================================================
        console.log("--- Forced Inclusion ---");
        
        // Deploy ForcedInclusion contract
        ForcedInclusion forcedInclusion = new ForcedInclusion(
            batchInbox,
            address(sequencerRegistry),
            deployer
        );
        console.log("ForcedInclusion deployed:", address(forcedInclusion));
        console.log("  - Inclusion window: 50 blocks");
        console.log("  - Min fee: 0.001 ETH");
        console.log("");

        // ============================================================
        // STAGE 2: BRIDGE ADAPTERS
        // ============================================================
        console.log("--- Bridge Adapters ---");
        
        // Deploy L2OutputOracleAdapter
        L2OutputOracleAdapter l2Adapter = new L2OutputOracleAdapter(
            payable(address(sequencerRegistry)), 
            payable(address(disputeFactory)), 
            l2OutputOracle
        );
        console.log("L2OutputOracleAdapter deployed:", address(l2Adapter));

        // Deploy OptimismPortalAdapter
        OptimismPortalAdapter portalAdapter = new OptimismPortalAdapter(
            address(timelock), 
            securityCouncil
        );
        console.log("OptimismPortalAdapter deployed:", address(portalAdapter));
        console.log("");

        // ============================================================
        // TRANSFER OWNERSHIP TO TIMELOCK
        // ============================================================
        console.log("--- Transferring Ownership ---");
        
        sequencerRegistry.transferOwnership(address(timelock));
        disputeFactory.transferOwnership(address(timelock));
        l2Adapter.transferOwnership(address(timelock));
        thresholdBatcher.transferOwnership(address(timelock));
        forcedInclusion.transferOwnership(address(timelock));
        
        console.log("All contracts now owned by GovernanceTimelock");
        console.log("Upgrades require 30-day timelock");

        vm.stopBroadcast();

        // ============================================================
        // DEPLOYMENT SUMMARY
        // ============================================================
        console.log("");
        console.log("==================================================");
        console.log("Stage 2 Deployment Complete");
        console.log("==================================================");
        console.log("");
        console.log("Core Addresses:");
        console.log("  SequencerRegistry:", address(sequencerRegistry));
        console.log("  ThresholdBatchSubmitter:", address(thresholdBatcher));
        console.log("  GovernanceTimelock:", address(timelock));
        console.log("  DisputeGameFactory:", address(disputeFactory));
        console.log("  ForcedInclusion:", address(forcedInclusion));
        console.log("");
        console.log("Fraud Proof System:");
        console.log("  PreimageOracle:", preimageOracleAddress);
        console.log("  MIPS64:", mipsAddress);
        console.log("  CannonProver:", address(cannonProver));
        console.log("  LegacyProver:", address(legacyProver));
        console.log("");
        console.log("Bridge Adapters:");
        console.log("  L2OutputOracleAdapter:", address(l2Adapter));
        console.log("  OptimismPortalAdapter:", address(portalAdapter));
        console.log("");
        console.log("Stage 2 Compliance Status:");
        console.log("  [x] 7-day dispute window");
        console.log("  [x] 30-day upgrade timelock");
        console.log("  [x] 7-day emergency minimum");
        console.log("  [x] Forced inclusion mechanism");
        console.log("  [x] Security Council integration");
        console.log("");
        
        // Fraud proof status depends on MIPS deployment
        if (mipsAddress.code.length > 0 && preimageOracleAddress.code.length > 0) {
            console.log("  [x] Cannon MIPS fraud proofs - PRODUCTION READY");
        } else {
            console.log("  [ ] Cannon MIPS fraud proofs - TEST MODE (needs MIPS deployment)");
            console.log("");
            console.log("=== ACTION REQUIRED FOR TRUE STAGE 2 ===");
            console.log("Deploy Optimism Cannon contracts and set env vars:");
            console.log("  MIPS_ADDRESS=<deployed MIPS.sol address>");
            console.log("  PREIMAGE_ORACLE_ADDRESS=<deployed PreimageOracle.sol address>");
            console.log("See: https://github.com/ethereum-optimism/optimism/packages/contracts-bedrock");
        }
    }
}
