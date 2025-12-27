// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/compute/ComputeRegistry.sol";
import "../../src/registry/interfaces/IIdentityRegistry.sol";
import "../../src/registry/ERC8004ProviderMixin.sol";
import "../../src/moderation/BanManager.sol";

contract MockIdentityRegistry is IIdentityRegistry {
    mapping(uint256 => address) private _owners;
    mapping(uint256 => bool) private _exists;
    mapping(uint256 => bool) private _banned;
    uint256 private _nextAgentId = 1;

    function _register() internal returns (uint256) {
        uint256 agentId = _nextAgentId++;
        _owners[agentId] = msg.sender;
        _exists[agentId] = true;
        return agentId;
    }

    function register(string calldata tokenURI_) external returns (uint256) {
        return _register();
    }

    function register(string calldata tokenURI_, MetadataEntry[] calldata metadata) external returns (uint256) {
        return _register();
    }

    function register() external returns (uint256) {
        return _register();
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return _exists[agentId];
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        require(_exists[agentId], "Agent does not exist");
        return _owners[agentId];
    }

    function setBanned(uint256 agentId, bool banned) external {
        _banned[agentId] = banned;
    }

    function getMarketplaceInfo(uint256 agentId)
        external
        view
        returns (string memory, string memory, string memory, string memory, bool, uint8, bool banned)
    {
        require(_exists[agentId], "Agent does not exist");
        return ("", "", "", "", false, 0, _banned[agentId]);
    }

    // ERC721 stubs
    function balanceOf(address) external pure returns (uint256) {
        return 0;
    }

    function tokenURI(uint256) external pure returns (string memory) {
        return "";
    }

    function name() external pure returns (string memory) {
        return "MockIdentityRegistry";
    }

    function symbol() external pure returns (string memory) {
        return "MIR";
    }

    function approve(address, uint256) external pure {}

    function setApprovalForAll(address, bool) external pure {}

    function getApproved(uint256) external pure returns (address) {
        return address(0);
    }

    function isApprovedForAll(address, address) external pure returns (bool) {
        return false;
    }

    function safeTransferFrom(address, address, uint256) external pure {}

    function safeTransferFrom(address, address, uint256, bytes memory) external pure {}

    function transferFrom(address, address, uint256) external pure {}

    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }

    function setMetadata(uint256, string calldata, bytes calldata) external pure {}

    function getMetadata(uint256, string calldata) external pure returns (bytes memory) {
        return "";
    }

    function setAgentUri(uint256, string calldata) external pure {}

    function updateTags(uint256, string[] calldata) external pure {}

    function getAgentsByTag(string calldata) external pure returns (uint256[] memory) {
        return new uint256[](0);
    }

    function getAgentTags(uint256) external pure returns (string[] memory) {
        return new string[](0);
    }

    function setA2AEndpoint(uint256, string calldata) external pure {}

    function getA2AEndpoint(uint256) external pure returns (string memory) {
        return "";
    }

    function setMCPEndpoint(uint256, string calldata) external pure {}

    function getMCPEndpoint(uint256) external pure returns (string memory) {
        return "";
    }

    function setEndpoints(uint256, string calldata, string calldata) external pure {}

    function setServiceType(uint256, string calldata) external pure {}

    function getServiceType(uint256) external pure returns (string memory) {
        return "";
    }

    function setCategory(uint256, string calldata) external pure {}

    function getCategory(uint256) external pure returns (string memory) {
        return "";
    }

    function setX402Support(uint256, bool) external pure {}

    function getX402Support(uint256) external pure returns (bool) {
        return false;
    }

    function supportsInterface(bytes4) external pure returns (bool) {
        return true;
    }
}

contract ComputeRegistryIntegrationTest is Test {
    ComputeRegistry public registry;
    MockIdentityRegistry public identityRegistry;
    BanManager public banManager;
    address public owner;
    address public provider1;
    address public provider2;
    address public bannedProvider;

    function setUp() public {
        owner = address(this);
        provider1 = makeAddr("provider1");
        provider2 = makeAddr("provider2");
        bannedProvider = makeAddr("bannedProvider");

        vm.deal(provider1, 10 ether);
        vm.deal(provider2, 10 ether);
        vm.deal(bannedProvider, 10 ether);

        identityRegistry = new MockIdentityRegistry();
        banManager = new BanManager(owner, owner);
        registry = new ComputeRegistry(owner, address(identityRegistry), address(banManager), 0.01 ether);
    }

    function test_RegisterWithAgent() public {
        vm.startPrank(provider1);
        uint256 agentId = identityRegistry.register("ipfs://test");
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        ComputeRegistry.Provider memory provider = registry.getProvider(provider1);

        assertEq(provider.agentId, agentId);
        assertEq(registry.getAgentByProvider(provider1), agentId);
        assertEq(registry.getProviderByAgent(agentId), provider1);
        assertTrue(registry.hasValidAgent(provider1));
        assertTrue(registry.isVerifiedAgent(provider1));

        vm.stopPrank();
    }

    function test_RegisterWithAgentFailsIfNotOwner() public {
        vm.startPrank(provider1);
        uint256 agentId = identityRegistry.register("ipfs://test");
        vm.stopPrank();

        vm.startPrank(provider2);
        vm.expectRevert(abi.encodeWithSignature("NotAgentOwner()"));
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        vm.stopPrank();
    }

    function test_RegisterWithAgentFailsIfAgentDoesNotExist() public {
        vm.startPrank(provider1);

        vm.expectRevert(abi.encodeWithSignature("InvalidAgentId()"));
        registry.registerWithAgent{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)), 999);

        vm.stopPrank();
    }

    function test_RegisterWithAgentFailsIfAgentAlreadyLinked() public {
        vm.startPrank(provider1);

        uint256 agentId = identityRegistry.register("ipfs://test");
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        vm.stopPrank();

        vm.startPrank(provider2);
        vm.expectRevert(ERC8004ProviderMixin.NotAgentOwner.selector);
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider 2", "https://api2.test.com", bytes32(uint256(2)), agentId
        );
        vm.stopPrank();
    }

    function test_RequireAgentRegistration() public {
        registry.setRequireAgentRegistration(true);
        vm.startPrank(provider1);
        vm.expectRevert(abi.encodeWithSignature("AgentRequired()"));
        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));
        uint256 agentId = identityRegistry.register("ipfs://test");
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        vm.stopPrank();
    }

    // ============ Ban Checking Tests ============

    function test_RegisterFailsIfAddressBanned() public {
        // Ban provider1's address
        vm.prank(owner);
        banManager.applyAddressBan(bannedProvider, bytes32(0), "Test ban");

        vm.startPrank(bannedProvider);

        vm.expectRevert(abi.encodeWithSignature("AddressIsBanned(address)", bannedProvider));
        registry.register{value: 0.01 ether}("Banned Provider", "https://banned.test.com", bytes32(uint256(1)));

        vm.stopPrank();
    }

    function test_RegisterWithAgentFailsIfAgentBanned() public {
        vm.startPrank(provider1);

        uint256 agentId = identityRegistry.register("ipfs://test");
        identityRegistry.setBanned(agentId, true);
        vm.expectRevert(ERC8004ProviderMixin.AgentIsBanned.selector);
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        vm.stopPrank();
    }

    function test_RegisterWithAgentFailsIfAddressBanned() public {
        // Ban provider1's address
        vm.prank(owner);
        banManager.applyAddressBan(provider1, bytes32(0), "Test ban");

        vm.startPrank(provider1);

        uint256 agentId = identityRegistry.register("ipfs://test");

        vm.expectRevert(abi.encodeWithSignature("AddressIsBanned(address)", provider1));
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        vm.stopPrank();
    }

    function test_IsProviderBanned() public {
        vm.startPrank(provider1);

        uint256 agentId = identityRegistry.register("ipfs://test");
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        assertFalse(registry.isProviderBanned(provider1));
        vm.stopPrank();
        vm.prank(owner);
        banManager.applyAddressBan(provider1, bytes32(0), "Test ban");
        assertTrue(registry.isProviderBanned(provider1));
    }

    function test_IsProviderBannedByAgent() public {
        vm.startPrank(provider1);

        uint256 agentId = identityRegistry.register("ipfs://test");
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );

        assertFalse(registry.isProviderBanned(provider1));
        vm.stopPrank();
        identityRegistry.setBanned(agentId, true);
        assertTrue(registry.isProviderBanned(provider1));
    }

    function test_SetIdentityRegistry() public {
        MockIdentityRegistry newRegistry = new MockIdentityRegistry();
        registry.setIdentityRegistry(address(newRegistry));
        vm.startPrank(provider1);
        uint256 agentId = newRegistry.register("ipfs://test");
        registry.registerWithAgent{value: 0.01 ether}(
            "Test Provider", "https://api.test.com", bytes32(uint256(1)), agentId
        );
        vm.stopPrank();
    }

    function test_SetBanManager() public {
        BanManager newBanManager = new BanManager(owner, owner);

        registry.setBanManager(address(newBanManager));

        // Verify it was updated by checking ban
        vm.prank(owner);
        newBanManager.applyAddressBan(provider1, bytes32(0), "Test ban");

        vm.startPrank(provider1);
        vm.expectRevert(abi.encodeWithSignature("AddressIsBanned(address)", provider1));
        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_SetRequireAgentRegistration() public {
        vm.startPrank(provider1);
        registry.register{value: 0.01 ether}("Test Provider", "https://api.test.com", bytes32(uint256(1)));
        vm.stopPrank();
        registry.setRequireAgentRegistration(true);
        vm.startPrank(provider2);
        vm.expectRevert(abi.encodeWithSignature("AgentRequired()"));
        registry.register{value: 0.01 ether}("Test Provider 2", "https://api2.test.com", bytes32(uint256(2)));
        vm.stopPrank();
    }
}
