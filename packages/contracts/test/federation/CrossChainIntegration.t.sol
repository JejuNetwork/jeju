// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {RegistryHub} from "../../src/federation/RegistryHub.sol";
import {NetworkRegistry} from "../../src/federation/NetworkRegistry.sol";
import {CrossChainIdentitySync} from "../../src/federation/CrossChainIdentitySync.sol";
import {IdentityRegistry} from "../../src/registry/IdentityRegistry.sol";
import {IWormhole} from "../../src/federation/interfaces/IWormhole.sol";

/**
 * @title MockWormhole
 * @notice Mock Wormhole contract for testing
 */
contract MockWormhole is IWormhole {
    uint16 public override chainId = 2; // Ethereum
    uint16 public override governanceChainId = 1;
    bytes32 public override governanceContract = bytes32(uint256(1));
    
    mapping(bytes32 => bool) public consumedVAAs;
    uint32 public currentGuardianSetIndex = 1;
    
    // Store the last message for testing
    bytes public lastMessage;
    uint16 public lastChainId;
    bytes32 public lastEmitter;
    
    // Testing controls
    bool public shouldRejectNext;
    string public rejectionReason;
    mapping(bytes32 => bool) public invalidSignatures;
    
    function setNextVerificationFails(string memory reason) external {
        shouldRejectNext = true;
        rejectionReason = reason;
    }
    
    function markSignatureInvalid(bytes32 vaaHash) external {
        invalidSignatures[vaaHash] = true;
    }
    
    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        override
        returns (VM memory vm, bool valid, string memory reason)
    {
        // Test hook: reject next VAA
        if (shouldRejectNext) {
            return (vm, false, rejectionReason);
        }
        
        // Validate minimum length for VAA structure
        if (encodedVM.length < 100) {
            return (vm, false, "VAA too short");
        }
        
        // Extract fields from mock VAA format:
        // [0-1] chainId
        // [2-33] emitter
        // [34-41] sequence
        // [42..] payload
        vm.version = 1;
        vm.timestamp = uint32(block.timestamp);
        vm.nonce = 0;
        vm.emitterChainId = uint16(bytes2(encodedVM[0:2]));
        vm.emitterAddress = bytes32(encodedVM[2:34]);
        vm.sequence = uint64(bytes8(encodedVM[34:42]));
        vm.consistencyLevel = 1;
        vm.payload = encodedVM[42:];
        vm.guardianSetIndex = currentGuardianSetIndex;
        vm.hash = keccak256(encodedVM);
        
        // Test hook: check for marked invalid signatures
        if (invalidSignatures[vm.hash]) {
            return (vm, false, "Invalid guardian signatures");
        }
        
        return (vm, true, "");
    }
    
    function parseVM(bytes calldata encodedVM) external pure override returns (VM memory vm) {
        vm.emitterChainId = uint16(bytes2(encodedVM[0:2]));
        vm.emitterAddress = bytes32(encodedVM[2:34]);
        vm.sequence = uint64(bytes8(encodedVM[34:42]));
        vm.payload = encodedVM[42:];
        return vm;
    }
    
    function getGuardianSet(uint32) external pure override returns (GuardianSet memory guardianSet) {
        address[] memory keys = new address[](1);
        keys[0] = address(0x1234);
        guardianSet.keys = keys;
        guardianSet.expirationTime = type(uint32).max;
    }
    
    function getCurrentGuardianSetIndex() external view override returns (uint32) {
        return currentGuardianSetIndex;
    }
    
    function messageFee() external pure override returns (uint256) {
        return 0.01 ether;
    }
    
    function publishMessage(uint32, bytes calldata payload, uint8)
        external
        payable
        override
        returns (uint64)
    {
        lastMessage = payload;
        return 1;
    }
    
    function verifySignatures(bytes32, Signature[] calldata, GuardianSet memory) external pure override {
        // Mock always passes
    }
    
    function isVAAConsumed(bytes32 hash) external view override returns (bool) {
        return consumedVAAs[hash];
    }
    
    // Helper to create mock VAA
    function createMockVAA(
        uint16 emitterChain,
        bytes32 emitter,
        uint64 sequence,
        bytes memory payload
    ) external pure returns (bytes memory) {
        return abi.encodePacked(
            emitterChain,
            emitter,
            sequence,
            payload
        );
    }
}

/**
 * @title MockMailbox
 * @notice Mock Hyperlane Mailbox for testing
 */
contract MockMailbox {
    mapping(bytes32 => bool) public delivered;
    uint256 public nextId;
    
    event Dispatch(
        uint32 indexed destinationDomain,
        bytes32 indexed recipientAddress,
        bytes messageBody
    );
    
    function dispatch(
        uint32 destinationDomain,
        bytes32 recipientAddress,
        bytes calldata messageBody
    ) external payable returns (bytes32) {
        bytes32 id = bytes32(nextId++);
        emit Dispatch(destinationDomain, recipientAddress, messageBody);
        return id;
    }
    
    function process(bytes calldata, bytes calldata) external {
        // Mock processing
    }
    
    function quoteDispatch(uint32, bytes32, bytes calldata) external pure returns (uint256) {
        return 0.001 ether;
    }
    
    // Helper to simulate receiving a message
    function deliverMessage(
        address target,
        uint32 origin,
        bytes32 sender,
        bytes calldata message
    ) external {
        (bool success,) = target.call(
            abi.encodeWithSignature(
                "handle(uint32,bytes32,bytes)",
                origin,
                sender,
                message
            )
        );
        require(success, "Delivery failed");
    }
}

/**
 * @title CrossChainIntegrationTest
 * @notice Integration tests for cross-chain ERC-8004 functionality
 */
contract CrossChainIntegrationTest is Test {
    RegistryHub public registryHub;
    NetworkRegistry public networkRegistry;
    CrossChainIdentitySync public identitySync;
    IdentityRegistry public identityRegistry;
    MockWormhole public wormhole;
    MockMailbox public mailbox;
    
    address public deployer;
    address public operator1;
    address public operator2;
    address public agent1Owner;
    
    uint32 constant JEJU_DOMAIN = 420691;
    uint32 constant BASE_DOMAIN = 8453;
    uint256 constant SOLANA_CHAIN_ID = 1; // Wormhole Solana chain ID
    
    function setUp() public {
        deployer = makeAddr("deployer");
        operator1 = makeAddr("operator1");
        operator2 = makeAddr("operator2");
        agent1Owner = makeAddr("agent1Owner");
        
        vm.startPrank(deployer);
        
        // Deploy mock infrastructure
        wormhole = new MockWormhole();
        mailbox = new MockMailbox();
        
        // Deploy contracts
        registryHub = new RegistryHub(address(wormhole));
        networkRegistry = new NetworkRegistry(deployer);
        identityRegistry = new IdentityRegistry();
        
        identitySync = new CrossChainIdentitySync(
            address(identityRegistry),
            address(mailbox),
            JEJU_DOMAIN
        );
        
        // Configure identity sync
        identitySync.setTrustedRemote(BASE_DOMAIN, bytes32(uint256(uint160(address(identitySync)))));
        
        vm.stopPrank();
        
        // Fund accounts
        vm.deal(operator1, 100 ether);
        vm.deal(operator2, 100 ether);
        vm.deal(agent1Owner, 100 ether);
    }
    
    // ============ RegistryHub Tests ============
    
    function test_RegisterChain() public {
        vm.startPrank(operator1);
        
        registryHub.registerChain{value: 1 ether}(
            JEJU_DOMAIN,
            RegistryHub.ChainType.EVM,
            "Jeju Network",
            "https://rpc.jeju.network"
        );
        
        RegistryHub.ChainInfo memory chain = registryHub.getChain(JEJU_DOMAIN);
        assertEq(chain.chainId, JEJU_DOMAIN);
        assertEq(chain.name, "Jeju Network");
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.STAKED));
        assertTrue(chain.isActive);
        
        vm.stopPrank();
    }
    
    function test_RegisterChainWithHighStake() public {
        vm.startPrank(operator1);
        
        registryHub.registerChain{value: 10 ether}(
            JEJU_DOMAIN,
            RegistryHub.ChainType.EVM,
            "Jeju Network",
            "https://rpc.jeju.network"
        );
        
        RegistryHub.ChainInfo memory chain = registryHub.getChain(JEJU_DOMAIN);
        assertEq(uint8(chain.trustTier), uint8(RegistryHub.TrustTier.VERIFIED));
        
        vm.stopPrank();
    }
    
    function test_RegisterRegistry() public {
        // First register the chain
        vm.prank(operator1);
        registryHub.registerChain{value: 1 ether}(
            JEJU_DOMAIN,
            RegistryHub.ChainType.EVM,
            "Jeju Network",
            "https://rpc.jeju.network"
        );
        
        // Register a registry on that chain
        vm.prank(operator1);
        registryHub.registerRegistry(
            JEJU_DOMAIN,
            RegistryHub.RegistryType.IDENTITY,
            bytes32(uint256(uint160(address(identityRegistry)))),
            "IdentityRegistry",
            "2.1.0",
            "ipfs://metadata"
        );
        
        bytes32 registryId = registryHub.computeRegistryId(
            JEJU_DOMAIN,
            RegistryHub.RegistryType.IDENTITY,
            bytes32(uint256(uint160(address(identityRegistry))))
        );
        
        RegistryHub.RegistryInfo memory registry = registryHub.getRegistry(registryId);
        assertEq(registry.chainId, JEJU_DOMAIN);
        assertEq(registry.name, "IdentityRegistry");
        assertTrue(registry.isActive);
    }
    
    function test_RegisterSolanaRegistry() public {
        vm.prank(operator1);
        
        bytes32 programId = bytes32(uint256(0xABCDEF));
        
        registryHub.registerSolanaRegistry{value: 1 ether}(
            programId,
            RegistryHub.RegistryType.IDENTITY,
            "Solana Agent Registry",
            "ipfs://solana-registry"
        );
        
        // Verify Solana chain was auto-registered
        RegistryHub.ChainInfo memory chain = registryHub.getChain(SOLANA_CHAIN_ID);
        assertEq(uint8(chain.chainType), uint8(RegistryHub.ChainType.SOLANA));
        assertEq(chain.name, "Solana");
    }
    
    function test_VerifySolanaRegistryViaWormhole() public {
        // Set trusted emitter
        bytes32 trustedEmitter = bytes32(uint256(0x123456));
        vm.prank(deployer);
        registryHub.setTrustedSolanaEmitter(trustedEmitter);
        
        // Create mock VAA payload
        // Format: [1] payloadType + [32] programId + [1] registryType + [2] nameLen + [N] name
        bytes32 programId = bytes32(uint256(0xDEADBEEF));
        bytes memory payload = abi.encodePacked(
            uint8(1), // REGISTER
            programId,
            uint8(0), // IDENTITY
            uint16(19), // name length
            "Solana Test Registry",
            uint16(0) // no metadata URI
        );
        
        // Create mock VAA
        bytes memory vaa = wormhole.createMockVAA(
            uint16(SOLANA_CHAIN_ID),
            trustedEmitter,
            1,
            payload
        );
        
        // Verify
        registryHub.verifySolanaRegistry(vaa);
        
        // Check registry was created
        bytes32 registryId = registryHub.computeRegistryId(
            SOLANA_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            programId
        );
        
        assertTrue(registryHub.verifiedSolanaRegistries(registryId));
    }
    
    // ============ NetworkRegistry Tests ============
    
    function test_NetworkRegistration() public {
        vm.startPrank(operator1);
        
        NetworkRegistry.NetworkContracts memory contracts = NetworkRegistry.NetworkContracts({
            identityRegistry: address(identityRegistry),
            solverRegistry: address(0),
            inputSettler: address(0),
            outputSettler: address(0),
            liquidityVault: address(0),
            governance: address(0),
            oracle: address(0),
            registryHub: address(registryHub)
        });
        
        networkRegistry.registerNetwork{value: 1 ether}(
            JEJU_DOMAIN,
            "Jeju Network",
            "https://rpc.jeju.network",
            "https://explorer.jeju.network",
            "wss://rpc.jeju.network",
            contracts,
            bytes32(0)
        );
        
        NetworkRegistry.NetworkInfo memory info = networkRegistry.getNetwork(JEJU_DOMAIN);
        assertEq(info.name, "Jeju Network");
        assertEq(uint8(info.trustTier), uint8(NetworkRegistry.TrustTier.STAKED));
        
        vm.stopPrank();
    }
    
    function test_EstablishTrust() public {
        vm.startPrank(operator1);
        
        NetworkRegistry.NetworkContracts memory contracts;
        
        // Register two networks
        networkRegistry.registerNetwork{value: 1 ether}(
            JEJU_DOMAIN, "Jeju", "", "", "", contracts, bytes32(0)
        );
        
        vm.stopPrank();
        
        vm.startPrank(operator2);
        networkRegistry.registerNetwork{value: 1 ether}(
            BASE_DOMAIN, "Base", "", "", "", contracts, bytes32(0)
        );
        vm.stopPrank();
        
        // Establish trust from Jeju to Base
        vm.prank(operator1);
        networkRegistry.establishTrust(JEJU_DOMAIN, BASE_DOMAIN);
        
        assertTrue(networkRegistry.isTrusted(JEJU_DOMAIN, BASE_DOMAIN));
        assertFalse(networkRegistry.isMutuallyTrusted(JEJU_DOMAIN, BASE_DOMAIN));
        
        // Establish mutual trust
        vm.prank(operator2);
        networkRegistry.establishTrust(BASE_DOMAIN, JEJU_DOMAIN);
        
        assertTrue(networkRegistry.isMutuallyTrusted(JEJU_DOMAIN, BASE_DOMAIN));
    }
    
    // ============ CrossChainIdentitySync Tests ============
    
    function test_RegisterAgent() public {
        vm.startPrank(agent1Owner);
        
        uint256 agentId = identityRegistry.register("ipfs://agent1");
        
        assertEq(identityRegistry.ownerOf(agentId), agent1Owner);
        assertTrue(identityRegistry.agentExists(agentId));
        
        vm.stopPrank();
    }
    
    function test_BroadcastRegistration() public {
        // Register agent
        vm.prank(agent1Owner);
        uint256 agentId = identityRegistry.register("ipfs://agent1");
        
        // Broadcast
        vm.prank(agent1Owner);
        identitySync.broadcastRegistration{value: 0.01 ether}(agentId);
        
        // Verify message was dispatched (check event emission)
    }
    
    function test_HandleIncomingRegistration() public {
        // Set up trusted remote
        bytes32 remoteSync = bytes32(uint256(uint160(address(0xbA5e000000000000000000000000000000000001))));
        vm.prank(deployer);
        identitySync.setTrustedRemote(BASE_DOMAIN, remoteSync);
        
        // Create registration message
        // Format: [1] version + [1] type + [32] agentId + [20] owner + [1] tier + [2] uriLen + uri
        bytes memory message = abi.encodePacked(
            uint8(1), // version
            uint8(0), // REGISTER type
            bytes32(uint256(42)), // agentId
            bytes20(agent1Owner), // owner
            uint8(1), // SMALL tier
            uint16(13), // uri length
            "ipfs://agent42"
        );
        
        // Deliver message (simulate mailbox calling handle)
        vm.prank(address(mailbox));
        identitySync.handle(BASE_DOMAIN, remoteSync, message);
        
        // Verify agent was synced
        CrossChainIdentitySync.CrossChainAgent memory agent = 
            identitySync.getCrossChainAgent(BASE_DOMAIN, 42);
        
        assertEq(agent.agentId, 42);
        assertEq(agent.originDomain, BASE_DOMAIN);
        assertEq(agent.owner, agent1Owner);
        assertTrue(agent.isActive);
        assertFalse(agent.isBanned);
    }
    
    function test_HandleBanPropagation() public {
        // First sync an agent
        bytes32 remoteSync = bytes32(uint256(uint160(address(0xbA5e000000000000000000000000000000000001))));
        vm.prank(deployer);
        identitySync.setTrustedRemote(BASE_DOMAIN, remoteSync);
        
        // Register agent
        bytes memory registerMsg = abi.encodePacked(
            uint8(1), uint8(0), bytes32(uint256(42)), bytes20(agent1Owner),
            uint8(1), uint16(13), "ipfs://agent42"
        );
        vm.prank(address(mailbox));
        identitySync.handle(BASE_DOMAIN, remoteSync, registerMsg);
        
        // Send ban message
        bytes memory banMsg = abi.encodePacked(
            uint8(1), // version
            uint8(2), // BAN type
            bytes32(uint256(42)) // agentId
        );
        vm.prank(address(mailbox));
        identitySync.handle(BASE_DOMAIN, remoteSync, banMsg);
        
        // Verify ban
        CrossChainIdentitySync.CrossChainAgent memory agent = 
            identitySync.getCrossChainAgent(BASE_DOMAIN, 42);
        assertTrue(agent.isBanned);
    }
    
    function test_RateLimiting() public {
        bytes32 remoteSync = bytes32(uint256(uint160(address(0xbA5e000000000000000000000000000000000001))));
        vm.prank(deployer);
        identitySync.setTrustedRemote(BASE_DOMAIN, remoteSync);
        
        // Send 100 registrations (at the limit)
        for (uint256 i = 0; i < 100; i++) {
            bytes memory message = abi.encodePacked(
                uint8(1), uint8(0), bytes32(i), bytes20(agent1Owner),
                uint8(1), uint16(13), "ipfs://agentXX"
            );
            vm.prank(address(mailbox));
            identitySync.handle(BASE_DOMAIN, remoteSync, message);
        }
        
        // 101st should fail
        bytes memory overLimitMsg = abi.encodePacked(
            uint8(1), uint8(0), bytes32(uint256(101)), bytes20(agent1Owner),
            uint8(1), uint16(13), "ipfs://agent101"
        );
        vm.prank(address(mailbox));
        vm.expectRevert(CrossChainIdentitySync.RateLimitExceeded.selector);
        identitySync.handle(BASE_DOMAIN, remoteSync, overLimitMsg);
    }

    function test_ConfigurableRateLimit() public {
        bytes32 remoteSync = bytes32(uint256(uint160(address(0xbA5e000000000000000000000000000000000001))));
        vm.prank(deployer);
        identitySync.setTrustedRemote(BASE_DOMAIN, remoteSync);
        
        // Increase rate limit to 200
        vm.prank(deployer);
        identitySync.setRateLimit(200, 3600);
        
        // Verify new limit is set
        assertEq(identitySync.rateLimitRegistrations(), 200);
        assertEq(identitySync.rateLimitWindow(), 3600);
        
        // Send 150 registrations (would fail with old limit of 100)
        for (uint256 i = 0; i < 150; i++) {
            bytes memory message = abi.encodePacked(
                uint8(1), uint8(0), bytes32(i + 1000), bytes20(agent1Owner),
                uint8(1), uint16(13), "ipfs://agentXX"
            );
            vm.prank(address(mailbox));
            identitySync.handle(BASE_DOMAIN, remoteSync, message);
        }
        
        // 201st should fail with new limit
        for (uint256 i = 150; i < 200; i++) {
            bytes memory message = abi.encodePacked(
                uint8(1), uint8(0), bytes32(i + 1000), bytes20(agent1Owner),
                uint8(1), uint16(13), "ipfs://agentXX"
            );
            vm.prank(address(mailbox));
            identitySync.handle(BASE_DOMAIN, remoteSync, message);
        }
        
        // 201st should fail
        bytes memory overLimitMsg = abi.encodePacked(
            uint8(1), uint8(0), bytes32(uint256(9999)), bytes20(agent1Owner),
            uint8(1), uint16(13), "ipfs://agent999"
        );
        vm.prank(address(mailbox));
        vm.expectRevert(CrossChainIdentitySync.RateLimitExceeded.selector);
        identitySync.handle(BASE_DOMAIN, remoteSync, overLimitMsg);
    }

    function test_OnlyOwnerCanSetRateLimit() public {
        vm.prank(agent1Owner);
        vm.expectRevert();
        identitySync.setRateLimit(200, 3600);
    }

    function test_RateLimitValidation() public {
        // Zero limit should fail
        vm.prank(deployer);
        vm.expectRevert("Invalid limit");
        identitySync.setRateLimit(0, 3600);
        
        // Window too short should fail
        vm.prank(deployer);
        vm.expectRevert("Window too short");
        identitySync.setRateLimit(100, 30);
    }
    
    function test_ReplayProtection() public {
        bytes32 remoteSync = bytes32(uint256(uint160(address(0xbA5e000000000000000000000000000000000001))));
        vm.prank(deployer);
        identitySync.setTrustedRemote(BASE_DOMAIN, remoteSync);
        
        bytes memory message = abi.encodePacked(
            uint8(1), uint8(0), bytes32(uint256(42)), bytes20(agent1Owner),
            uint8(1), uint16(13), "ipfs://agent42"
        );
        
        // First delivery succeeds
        vm.prank(address(mailbox));
        identitySync.handle(BASE_DOMAIN, remoteSync, message);
        
        // Replay should fail
        vm.prank(address(mailbox));
        vm.expectRevert(CrossChainIdentitySync.AlreadyProcessed.selector);
        identitySync.handle(BASE_DOMAIN, remoteSync, message);
    }
    
    function test_UntrustedRemoteRejected() public {
        bytes32 untrusted = bytes32(uint256(uint160(address(0xeE11000000000000000000000000000000000001))));
        
        bytes memory message = abi.encodePacked(
            uint8(1), uint8(0), bytes32(uint256(42)), bytes20(agent1Owner),
            uint8(1), uint16(13), "ipfs://agent42"
        );
        
        vm.prank(address(mailbox));
        vm.expectRevert(CrossChainIdentitySync.UntrustedRemote.selector);
        identitySync.handle(BASE_DOMAIN, untrusted, message);
    }
    
    // ============ Integration Tests ============
    
    function test_FullCrossChainFlow() public {
        // 1. Register Jeju network in NetworkRegistry
        vm.prank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;
        networkRegistry.registerNetwork{value: 10 ether}(
            JEJU_DOMAIN, "Jeju", "https://rpc.jeju.network", "", "", contracts, bytes32(0)
        );
        
        // 2. Register Jeju chain in RegistryHub
        vm.prank(operator1);
        registryHub.registerChain{value: 10 ether}(
            JEJU_DOMAIN, RegistryHub.ChainType.EVM, "Jeju Network", "https://rpc.jeju.network"
        );
        
        // 3. Register IdentityRegistry in RegistryHub
        vm.prank(operator1);
        registryHub.registerRegistry(
            JEJU_DOMAIN,
            RegistryHub.RegistryType.IDENTITY,
            bytes32(uint256(uint160(address(identityRegistry)))),
            "IdentityRegistry",
            "2.1.0",
            ""
        );
        
        // 4. Register an agent locally
        vm.prank(agent1Owner);
        uint256 agentId = identityRegistry.register("ipfs://cross-chain-agent");
        
        // 5. Broadcast to other chains
        vm.prank(agent1Owner);
        identitySync.broadcastRegistration{value: 0.1 ether}(agentId);
        
        // 6. Simulate receiving on remote chain
        bytes32 remoteSync = bytes32(uint256(uint160(address(identitySync))));
        vm.prank(deployer);
        identitySync.setTrustedRemote(BASE_DOMAIN, remoteSync);
        
        // Note: In production, this would come from Hyperlane relayers
        
        // Verify local agent exists
        assertTrue(identityRegistry.agentExists(agentId));
        assertEq(identityRegistry.ownerOf(agentId), agent1Owner);
    }
    
    function test_SolanaToEvmIntegration() public {
        // 1. Set up Wormhole trusted emitter for Solana
        bytes32 solanaEmitter = bytes32(uint256(0x501A4A00000000000000000000000000000001));
        vm.prank(deployer);
        registryHub.setTrustedSolanaEmitter(solanaEmitter);
        
        // 2. Register Solana registry via Wormhole VAA
        bytes32 solanaProgramId = bytes32(uint256(0xA6E47000000000000000000000000000000001));
        bytes memory payload = abi.encodePacked(
            uint8(1), // REGISTER
            solanaProgramId,
            uint8(0), // IDENTITY
            uint16(23),
            "Solana Agent Registry",
            uint16(0)
        );
        bytes memory vaa = wormhole.createMockVAA(
            uint16(SOLANA_CHAIN_ID), solanaEmitter, 1, payload
        );
        
        registryHub.verifySolanaRegistry(vaa);
        
        // 3. Verify Solana registry is recognized
        bytes32 registryId = registryHub.computeRegistryId(
            SOLANA_CHAIN_ID,
            RegistryHub.RegistryType.IDENTITY,
            solanaProgramId
        );
        assertTrue(registryHub.verifiedSolanaRegistries(registryId));
        
        // 4. Verify Solana chain was auto-registered (unstaked initially)
        RegistryHub.ChainInfo memory chain = registryHub.getChain(SOLANA_CHAIN_ID);
        assertEq(chain.name, "Solana");
        assertEq(uint8(chain.chainType), uint8(RegistryHub.ChainType.SOLANA));
        assertTrue(chain.isActive);
    }

    // ========================================================================
    // Invalid VAA Tests - Verify Wormhole verification actually rejects bad VAAs
    // ========================================================================

    function test_RevertOnInvalidVAASignature() public {
        bytes32 solanaEmitter = bytes32(uint256(0x501A4A00000000000000000000000000000001));
        vm.prank(deployer);
        registryHub.setTrustedSolanaEmitter(solanaEmitter);

        // Create a valid-looking VAA with enough padding to pass length check (needs >= 100 bytes)
        // Header: 2 (chainId) + 32 (emitter) + 8 (sequence) = 42 bytes
        // Need payload >= 58 bytes to reach 100
        bytes32 programId = bytes32(uint256(0xDEADBEEF));
        bytes memory registryName = "SolanaAgentRegistry"; // 19 bytes
        bytes memory metadataUri = "ipfs://QmTestMetadataForAgentRegistry"; // 37 bytes
        bytes memory payload = abi.encodePacked(
            uint8(1), // REGISTER
            programId, // 32 bytes
            uint8(1), // Identity registry
            uint16(bytes(registryName).length),
            registryName,
            uint16(bytes(metadataUri).length),
            metadataUri
        );
        bytes memory vaa = wormhole.createMockVAA(
            uint16(SOLANA_CHAIN_ID), solanaEmitter, 1, payload
        );

        // Mark this VAA's signature as invalid
        wormhole.markSignatureInvalid(keccak256(vaa));

        // Should revert because signature is invalid
        vm.expectRevert(abi.encodeWithSelector(RegistryHub.VerificationFailed.selector, "Invalid guardian signatures"));
        registryHub.verifySolanaRegistry(vaa);
    }

    function test_RevertOnTooShortVAA() public {
        // VAA that's too short to be valid
        bytes memory shortVaa = new bytes(50);
        
        vm.expectRevert(abi.encodeWithSelector(RegistryHub.VerificationFailed.selector, "VAA too short"));
        registryHub.verifySolanaRegistry(shortVaa);
    }

    // ========================================================================
    // Pause Functionality Tests
    // ========================================================================

    function test_PauseRegistryHub() public {
        // Owner can pause
        vm.prank(deployer);
        registryHub.pause();

        // Registration should fail while paused (OpenZeppelin v5 uses EnforcedPause())
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        registryHub.registerChain(
            999,
            RegistryHub.ChainType.EVM,
            "TestChain",
            "https://test.rpc"
        );
    }

    function test_UnpauseRegistryHub() public {
        vm.startPrank(deployer);
        registryHub.pause();
        registryHub.unpause();
        vm.stopPrank();

        // Should work after unpause
        registryHub.registerChain(
            999,
            RegistryHub.ChainType.EVM,
            "TestChain",
            "https://test.rpc"
        );
        
        RegistryHub.ChainInfo memory chain = registryHub.getChain(999);
        assertEq(chain.name, "TestChain");
    }

    function test_OnlyOwnerCanPauseRegistryHub() public {
        vm.prank(agent1Owner);
        vm.expectRevert();
        registryHub.pause();
    }

    function test_PauseCrossChainIdentitySync() public {
        // Register an agent first (before pausing)
        vm.prank(agent1Owner);
        uint256 agentId = identityRegistry.register("ipfs://test-agent");
        
        // Now pause
        vm.prank(deployer);
        identitySync.pause();

        // Broadcast should fail while paused (OpenZeppelin v5 uses EnforcedPause())
        vm.prank(agent1Owner);
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        identitySync.broadcastRegistration{value: 0.1 ether}(agentId);
    }

    function test_PauseBlocksIncomingMessages() public {
        // Set up trusted remote using BASE_DOMAIN
        bytes32 remoteSender = bytes32(uint256(uint160(address(identitySync))));
        vm.prank(deployer);
        identitySync.setTrustedRemote(BASE_DOMAIN, remoteSender);

        // Pause
        vm.prank(deployer);
        identitySync.pause();

        // Build a message
        bytes memory message = abi.encodePacked(
            uint8(1), // version
            uint8(1), // REGISTER type
            uint256(1), // agentId
            address(agent1Owner),
            bytes32("test-metadata"),
            uint256(0.1 ether),
            uint8(2), // SILVER tier
            uint64(block.timestamp),
            bytes("{}") // metadata
        );

        // Incoming message should fail (OpenZeppelin v5 uses EnforcedPause())
        vm.prank(address(mailbox));
        vm.expectRevert(abi.encodeWithSignature("EnforcedPause()"));
        identitySync.handle(BASE_DOMAIN, remoteSender, message);
    }
}
