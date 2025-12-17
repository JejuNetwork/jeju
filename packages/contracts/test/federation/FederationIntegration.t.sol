// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {NetworkRegistry} from "../../src/federation/NetworkRegistry.sol";
import {RegistryHub} from "../../src/federation/RegistryHub.sol";
import {RegistrySyncOracle} from "../../src/federation/RegistrySyncOracle.sol";
import {SolanaVerifier} from "../../src/federation/SolanaVerifier.sol";
import {FederationGovernance} from "../../src/federation/FederationGovernance.sol";

/**
 * @title FederationIntegrationTest
 * @notice End-to-end integration tests for the Jeju Federation
 * 
 * Tests cover:
 * - Full network registration and verification flow
 * - Cross-chain registry synchronization
 * - Meta-registry (RegistryHub) tracking across chains
 * - Solana integration via Wormhole
 * - Multi-network federation scenarios
 */
contract FederationIntegrationTest is Test {
    // Core contracts
    NetworkRegistry networkRegistry;
    RegistryHub registryHub;
    RegistrySyncOracle syncOracle;
    SolanaVerifier solanaVerifier;
    FederationGovernance governance;

    // Actors
    address deployer;
    address hubOperator;
    address jejuOperator;
    address fork1Operator;
    address fork2Operator;
    address relayer;
    address aiOracle;
    address councilGovernance;
    address treasury;
    address guardian1;
    address guardian2;
    address guardian3;

    // Chain IDs
    uint256 constant HUB_CHAIN_ID = 1; // Ethereum mainnet (hub)
    uint256 constant JEJU_CHAIN_ID = 420690;
    uint256 constant FORK1_CHAIN_ID = 420691;
    uint256 constant FORK2_CHAIN_ID = 420692;
    uint16 constant SOLANA_CHAIN_ID = 1; // Wormhole Solana

    function setUp() public {
        deployer = makeAddr("deployer");
        hubOperator = makeAddr("hubOperator");
        jejuOperator = makeAddr("jejuOperator");
        fork1Operator = makeAddr("fork1Operator");
        fork2Operator = makeAddr("fork2Operator");
        relayer = makeAddr("relayer");
        aiOracle = makeAddr("aiOracle");
        councilGovernance = makeAddr("councilGovernance");
        treasury = makeAddr("treasury");
        guardian1 = makeAddr("guardian1");
        guardian2 = makeAddr("guardian2");
        guardian3 = makeAddr("guardian3");

        vm.deal(deployer, 100 ether);
        vm.deal(hubOperator, 100 ether);
        vm.deal(jejuOperator, 100 ether);
        vm.deal(fork1Operator, 100 ether);
        vm.deal(fork2Operator, 100 ether);

        vm.startPrank(deployer);

        // Deploy core contracts
        networkRegistry = new NetworkRegistry(deployer);
        registryHub = new RegistryHub(relayer);
        syncOracle = new RegistrySyncOracle();
        solanaVerifier = new SolanaVerifier(relayer, keccak256("trusted-emitter"));

        // Deploy governance
        governance = new FederationGovernance(
            address(networkRegistry),
            councilGovernance,
            address(0), // prediction market (mock)
            aiOracle,
            treasury
        );

        // Wire up governance
        networkRegistry.setFederationGovernance(address(governance));

        // Add guardians
        governance.addGuardian(guardian1, 1);
        governance.addGuardian(guardian2, 2);
        governance.addGuardian(guardian3, 3);

        // Add relayer to sync oracle
        syncOracle.setRelayer(relayer, true);

        vm.stopPrank();
    }

    // ============ Full Federation Flow Tests ============

    /**
     * @notice Test the complete flow: network registration → verification → registry sync
     */
    function test_FullFederationFlow() public {
        // === PHASE 1: Register Networks ===

        // Register Jeju mainnet with verification stake
        vm.startPrank(jejuOperator);
        NetworkRegistry.NetworkContracts memory jejuContracts;
        networkRegistry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Jeju Network",
            "https://rpc.jeju.network",
            "https://explorer.jeju.network",
            "wss://ws.jeju.network",
            jejuContracts,
            keccak256("jeju-genesis")
        );
        vm.stopPrank();

        // Register fork networks
        vm.startPrank(fork1Operator);
        networkRegistry.registerNetwork{value: 5 ether}(
            FORK1_CHAIN_ID,
            "Fork 1 Network",
            "https://rpc.fork1.network",
            "",
            "",
            jejuContracts,
            keccak256("fork1-genesis")
        );
        vm.stopPrank();

        vm.startPrank(fork2Operator);
        networkRegistry.registerNetwork{value: 1 ether}(
            FORK2_CHAIN_ID,
            "Fork 2 Network",
            "https://rpc.fork2.network",
            "",
            "",
            jejuContracts,
            keccak256("fork2-genesis")
        );
        vm.stopPrank();

        // Verify networks registered
        assertEq(networkRegistry.totalNetworks(), 3);
        assertEq(networkRegistry.activeNetworks(), 3);

        // === PHASE 2: AI Evaluation & Governance Approval ===
        uint256 baseTime = block.timestamp;

        // Get proposal ID for Jeju
        bytes32 proposalId = _getProposalId(JEJU_CHAIN_ID);

        // AI Oracle evaluates
        vm.prank(aiOracle);
        governance.submitAIEvaluation(proposalId, 95, 90, 85, 80);

        // Wait for market voting (7+ days)
        vm.warp(baseTime + 8 days);
        governance.resolveMarketVoting(proposalId);

        // Autocrat approves (sets timelockEnds = block.timestamp + 7 days)
        vm.prank(councilGovernance);
        governance.submitAutocratDecision(
            proposalId,
            true,
            keccak256("approved"),
            "Network meets quality standards"
        );

        // Wait for timelock (7+ days after autocrat decision at t+8 days)
        // timelockEnds = (baseTime + 8 days) + 7 days = baseTime + 15 days
        // So we need to warp to at least baseTime + 16 days
        vm.warp(baseTime + 16 days);

        // Execute
        governance.executeProposal(proposalId);

        // Verify Jeju is now VERIFIED
        assertTrue(networkRegistry.isSequencerEligible(JEJU_CHAIN_ID));
        assertEq(networkRegistry.verifiedNetworks(), 1);

        // === PHASE 3: Register Meta-Registry (RegistryHub) ===

        // Register chains in RegistryHub
        vm.prank(jejuOperator);
        registryHub.registerChain{value: 10 ether}(
            JEJU_CHAIN_ID,
            RegistryHub.ChainType.EVM,
            "Jeju Network",
            "https://rpc.jeju.network"
        );

        vm.prank(fork1Operator);
        registryHub.registerChain{value: 5 ether}(
            FORK1_CHAIN_ID,
            RegistryHub.ChainType.EVM,
            "Fork 1 Network",
            "https://rpc.fork1.network"
        );

        // Verify chains in hub
        assertEq(registryHub.totalChains(), 2);
        assertTrue(registryHub.isTrustedForConsensus(JEJU_CHAIN_ID));
        assertTrue(registryHub.isTrustedForConsensus(FORK1_CHAIN_ID));

        // === PHASE 4: Register Individual Registries ===

        // Register Identity registry for Jeju
        bytes32 identityAddress = bytes32(uint256(uint160(address(0x1111))));
        vm.prank(jejuOperator);
        registryHub.registerRegistry(
            JEJU_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            identityAddress,
            "Jeju Identity Registry",
            "1.0.0",
            "ipfs://identity-metadata"
        );

        // Register Solver registry
        bytes32 solverAddress = bytes32(uint256(uint160(address(0x2222))));
        vm.prank(jejuOperator);
        registryHub.registerRegistry(
            JEJU_CHAIN_ID,
            RegistryHub.RegistryType.SOLVER,
            solverAddress,
            "Jeju Solver Registry",
            "1.0.0",
            "ipfs://solver-metadata"
        );

        // Verify registries
        assertEq(registryHub.totalRegistries(), 2);

        bytes32[] memory jejuRegistries = registryHub.getRegistriesByChain(JEJU_CHAIN_ID);
        assertEq(jejuRegistries.length, 2);

        // === PHASE 5: Cross-Chain Sync ===

        vm.startPrank(relayer);

        // Sync Identity registry from Jeju
        syncOracle.submitUpdate(
            JEJU_CHAIN_ID,
            RegistrySyncOracle.RegistryType.IDENTITY,
            identityAddress,
            1000, // 1000 agents registered
            keccak256("identity-merkle-root"),
            12345 // block number
        );

        // Sync from Fork1
        syncOracle.submitUpdate(
            FORK1_CHAIN_ID,
            RegistrySyncOracle.RegistryType.IDENTITY,
            bytes32(uint256(uint160(address(0x3333)))),
            500, // 500 agents
            keccak256("fork1-identity-root"),
            6789
        );

        vm.stopPrank();

        // Verify syncs
        assertEq(syncOracle.totalUpdates(), 2);

        RegistrySyncOracle.RegistryUpdate memory jejuUpdate = syncOracle.getLatestUpdate(
            JEJU_CHAIN_ID,
            RegistrySyncOracle.RegistryType.IDENTITY
        );
        assertEq(jejuUpdate.entryCount, 1000);
    }

    /**
     * @notice Test multi-chain identity federation
     */
    function test_MultiChainIdentityFederation() public {
        // Setup chains in hub
        _setupChainsInHub();

        // Register identity registries on each chain
        bytes32 jejuIdentity = bytes32(uint256(uint160(address(0x1111))));
        bytes32 fork1Identity = bytes32(uint256(uint160(address(0x2222))));
        bytes32 fork2Identity = bytes32(uint256(uint160(address(0x3333))));

        vm.startPrank(jejuOperator);
        registryHub.registerRegistry(
            JEJU_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            jejuIdentity,
            "Jeju Identity",
            "1.0.0",
            ""
        );
        vm.stopPrank();

        vm.startPrank(fork1Operator);
        registryHub.registerRegistry(
            FORK1_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            fork1Identity,
            "Fork1 Identity",
            "1.0.0",
            ""
        );
        vm.stopPrank();

        vm.startPrank(fork2Operator);
        registryHub.registerRegistry(
            FORK2_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            fork2Identity,
            "Fork2 Identity",
            "1.0.0",
            ""
        );
        vm.stopPrank();

        // Verify all identity registries tracked
        bytes32[] memory identityRegistries = registryHub.getRegistriesByType(RegistryHub.RegistryType.IDENTITY);
        assertEq(identityRegistries.length, 3);
    }

    /**
     * @notice Test Solana integration with federation
     */
    function test_SolanaFederationIntegration() public {
        // Add Solana SPL-2022 token (ai16z style)
        bytes32 ai16zMint = bytes32(uint256(0x111111111111));
        bytes32 daosFunMint = bytes32(uint256(0x222222222222));

        vm.startPrank(deployer);

        solanaVerifier.addVerifiedEntry(
            ai16zMint,
            bytes32(uint256(0xAAA)),
            "AI16Z Token",
            "AI16Z",
            "https://arweave.net/ai16z",
            SolanaVerifier.SolanaProgramType.SPL_TOKEN_2022,
            1000000000 * 10**9,
            9
        );

        solanaVerifier.addVerifiedEntry(
            daosFunMint,
            bytes32(uint256(0xBBB)),
            "DAOs Fun Token",
            "DAOS",
            "https://arweave.net/daosfun",
            SolanaVerifier.SolanaProgramType.CUSTOM_REGISTRY,
            500000000 * 10**9,
            9
        );

        vm.stopPrank();

        // Also register Solana in RegistryHub
        vm.prank(deployer);
        registryHub.registerSolanaRegistry{value: 1 ether}(
            ai16zMint,
            RegistryHub.RegistryType.IDENTITY,
            "AI16Z Identity Registry",
            "ipfs://ai16z-metadata"
        );

        // Verify Solana entries
        assertTrue(solanaVerifier.isVerified(ai16zMint));
        assertTrue(solanaVerifier.isVerified(daosFunMint));
        assertEq(solanaVerifier.totalEntries(), 2);

        // Verify RegistryHub has Solana
        RegistryHub.ChainInfo memory solanaChain = registryHub.getChain(SOLANA_CHAIN_ID);
        assertEq(solanaChain.name, "Solana");
        assertEq(uint8(solanaChain.chainType), uint8(RegistryHub.ChainType.SOLANA));
    }

    /**
     * @notice Test cross-chain trust establishment
     */
    function test_CrossChainTrustNetwork() public {
        // Register networks
        _registerNetworkInRegistry(JEJU_CHAIN_ID, jejuOperator, 10 ether);
        _registerNetworkInRegistry(FORK1_CHAIN_ID, fork1Operator, 5 ether);
        _registerNetworkInRegistry(FORK2_CHAIN_ID, fork2Operator, 5 ether);

        // Establish trust relationships
        vm.prank(jejuOperator);
        networkRegistry.establishTrust(JEJU_CHAIN_ID, FORK1_CHAIN_ID);

        vm.prank(fork1Operator);
        networkRegistry.establishTrust(FORK1_CHAIN_ID, JEJU_CHAIN_ID);

        vm.prank(fork1Operator);
        networkRegistry.establishTrust(FORK1_CHAIN_ID, FORK2_CHAIN_ID);

        // Verify trust network
        assertTrue(networkRegistry.isMutuallyTrusted(JEJU_CHAIN_ID, FORK1_CHAIN_ID));
        assertTrue(networkRegistry.isTrusted(FORK1_CHAIN_ID, FORK2_CHAIN_ID));
        assertFalse(networkRegistry.isTrusted(FORK2_CHAIN_ID, FORK1_CHAIN_ID));

        // Jeju's trusted peers
        uint256[] memory jejuPeers = networkRegistry.getTrustedPeers(JEJU_CHAIN_ID);
        assertEq(jejuPeers.length, 1);
        assertEq(jejuPeers[0], FORK1_CHAIN_ID);

        // Fork1's trusted peers
        uint256[] memory fork1Peers = networkRegistry.getTrustedPeers(FORK1_CHAIN_ID);
        assertEq(fork1Peers.length, 2);
    }

    /**
     * @notice Test sequencer rotation across verified networks
     */
    function test_SequencerRotationMultipleNetworks() public {
        // Create multiple verified networks with explicit time tracking
        uint256 currentTime = block.timestamp;
        
        // First network
        _registerNetworkInRegistry(JEJU_CHAIN_ID, jejuOperator, 10 ether);
        bytes32 proposalId1 = _getProposalId(JEJU_CHAIN_ID);
        vm.prank(aiOracle);
        governance.submitAIEvaluation(proposalId1, 90, 90, 90, 90);
        vm.warp(currentTime + 8 days);
        governance.resolveMarketVoting(proposalId1);
        vm.prank(councilGovernance);
        governance.submitAutocratDecision(proposalId1, true, keccak256("approved1"), "Approved");
        vm.warp(currentTime + 16 days);
        governance.executeProposal(proposalId1);
        currentTime = currentTime + 16 days;
        
        // Second network
        _registerNetworkInRegistry(FORK1_CHAIN_ID, fork1Operator, 10 ether);
        bytes32 proposalId2 = _getProposalId(FORK1_CHAIN_ID);
        vm.prank(aiOracle);
        governance.submitAIEvaluation(proposalId2, 90, 90, 90, 90);
        vm.warp(currentTime + 8 days);
        governance.resolveMarketVoting(proposalId2);
        vm.prank(councilGovernance);
        governance.submitAutocratDecision(proposalId2, true, keccak256("approved2"), "Approved");
        vm.warp(currentTime + 16 days);
        governance.executeProposal(proposalId2);
        currentTime = currentTime + 16 days;
        
        // Third network
        _registerNetworkInRegistry(FORK2_CHAIN_ID, fork2Operator, 10 ether);
        bytes32 proposalId3 = _getProposalId(FORK2_CHAIN_ID);
        vm.prank(aiOracle);
        governance.submitAIEvaluation(proposalId3, 90, 90, 90, 90);
        vm.warp(currentTime + 8 days);
        governance.resolveMarketVoting(proposalId3);
        vm.prank(councilGovernance);
        governance.submitAutocratDecision(proposalId3, true, keccak256("approved3"), "Approved");
        vm.warp(currentTime + 16 days);
        governance.executeProposal(proposalId3);
        currentTime = currentTime + 16 days;

        // Get verified chains
        uint256[] memory verified = governance.getVerifiedChainIds();
        assertEq(verified.length, 3);

        // Initial sequencer
        uint256 seq1 = governance.getCurrentSequencer();
        assertEq(seq1, JEJU_CHAIN_ID);

        // Rotate (rotationInterval = 1 day)
        vm.warp(currentTime + 2 days);
        governance.rotateSequencer();

        uint256 seq2 = governance.getCurrentSequencer();
        assertEq(seq2, FORK1_CHAIN_ID);

        // Rotate again
        vm.warp(currentTime + 4 days);
        governance.rotateSequencer();

        uint256 seq3 = governance.getCurrentSequencer();
        assertEq(seq3, FORK2_CHAIN_ID);

        // Wraps around
        vm.warp(currentTime + 6 days);
        governance.rotateSequencer();

        uint256 seq4 = governance.getCurrentSequencer();
        assertEq(seq4, JEJU_CHAIN_ID);
    }

    /**
     * @notice Test federated entry synchronization
     */
    function test_FederatedEntrySync() public {
        _setupChainsInHub();

        // Register identity registry
        bytes32 identityAddress = bytes32(uint256(uint160(address(0x1111))));
        vm.prank(jejuOperator);
        registryHub.registerRegistry(
            JEJU_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            identityAddress,
            "Jeju Identity",
            "1.0.0",
            ""
        );

        // Get registry ID
        bytes32 registryId = registryHub.computeRegistryId(
            JEJU_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            identityAddress
        );

        // Federate a high-value identity (e.g., verified agent)
        bytes32 originId = keccak256("agent-12345");
        vm.prank(jejuOperator);
        registryHub.federateEntry(
            registryId,
            originId,
            "Verified AI Agent",
            "ipfs://agent-metadata"
        );

        // Verify entry
        bytes32 entryId = registryHub.computeEntryId(registryId, originId);
        RegistryHub.RegistryEntry memory entry = registryHub.getEntry(entryId);

        assertEq(entry.name, "Verified AI Agent");
        assertEq(entry.registryId, registryId);
        assertEq(registryHub.totalFederatedEntries(), 1);
    }

    // ============ Helpers ============

    function _setupChainsInHub() internal {
        vm.prank(jejuOperator);
        registryHub.registerChain{value: 10 ether}(
            JEJU_CHAIN_ID,
            RegistryHub.ChainType.EVM,
            "Jeju Network",
            "https://rpc.jeju.network"
        );

        vm.prank(fork1Operator);
        registryHub.registerChain{value: 5 ether}(
            FORK1_CHAIN_ID,
            RegistryHub.ChainType.EVM,
            "Fork 1 Network",
            "https://rpc.fork1.network"
        );

        vm.prank(fork2Operator);
        registryHub.registerChain{value: 1 ether}(
            FORK2_CHAIN_ID,
            RegistryHub.ChainType.EVM,
            "Fork 2 Network",
            "https://rpc.fork2.network"
        );
    }

    function _registerNetworkInRegistry(uint256 chainId, address operator, uint256 stake) internal {
        vm.startPrank(operator);
        NetworkRegistry.NetworkContracts memory contracts;
        networkRegistry.registerNetwork{value: stake}(
            chainId,
            "Network",
            "https://rpc.network",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();
    }

    function _getProposalId(uint256 chainId) internal view returns (bytes32) {
        // Use the governance's chainIdToProposal mapping directly
        return governance.chainIdToProposal(chainId);
    }

    function _createVerifiedNetwork(uint256 chainId, address operator) internal {
        uint256 baseTime = block.timestamp;
        
        _registerNetworkInRegistry(chainId, operator, 10 ether);

        bytes32 proposalId = _getProposalId(chainId);

        vm.prank(aiOracle);
        governance.submitAIEvaluation(proposalId, 90, 90, 90, 90);

        // Wait for market voting to end (MARKET_VOTING_PERIOD = 7 days)
        vm.warp(baseTime + 8 days);
        governance.resolveMarketVoting(proposalId);

        vm.prank(councilGovernance);
        governance.submitAutocratDecision(proposalId, true, keccak256("approved"), "Approved");

        // Wait for timelock (TIMELOCK_PERIOD = 7 days after autocrat decision)
        // timelockEnds = (baseTime + 8 days) + 7 days = baseTime + 15 days
        vm.warp(baseTime + 16 days);
        governance.executeProposal(proposalId);
    }
}
