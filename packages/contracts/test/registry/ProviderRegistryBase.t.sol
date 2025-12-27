// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {StorageProviderRegistry} from "../../src/storage/StorageProviderRegistry.sol";
import {CDNRegistry} from "../../src/cdn/CDNRegistry.sol";
import {ICDNTypes} from "../../src/cdn/ICDNTypes.sol";
import {IStorageTypes} from "../../src/storage/IStorageTypes.sol";

contract MockIdentityRegistry {
    mapping(uint256 => address) public owners;
    mapping(uint256 => bool) public exists;
    mapping(uint256 => bool) public banned;

    function setAgent(uint256 agentId, address owner_) external {
        owners[agentId] = owner_;
        exists[agentId] = true;
    }

    function setBanned(uint256 agentId, bool isBanned) external {
        banned[agentId] = isBanned;
    }

    function ownerOf(uint256 agentId) external view returns (address) {
        return owners[agentId];
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return exists[agentId];
    }

    function getMarketplaceInfo(uint256 agentId)
        external
        view
        returns (string memory, string memory, string memory, string memory, bool, uint8, bool)
    {
        return ("", "", "", "", false, 0, banned[agentId]);
    }
}

contract MockBanManager {
    mapping(address => bool) public addressBans;

    function banAddress(address addr) external {
        addressBans[addr] = true;
    }

    function isAddressBanned(address addr) external view returns (bool) {
        return addressBans[addr];
    }
}

contract ProviderRegistryBaseTest is Test {
    StorageProviderRegistry storageRegistry;
    CDNRegistry cdnRegistry;
    MockIdentityRegistry identityRegistry;
    MockBanManager banManager;

    address owner = makeAddr("owner");
    address provider1 = makeAddr("provider1");
    address provider2 = makeAddr("provider2");
    address attacker = makeAddr("attacker");

    uint256 constant MIN_STAKE = 0.1 ether;
    uint256 constant AGENT_ID_1 = 100;
    uint256 constant AGENT_ID_2 = 200;

    function setUp() public {
        identityRegistry = new MockIdentityRegistry();
        banManager = new MockBanManager();

        vm.startPrank(owner);
        storageRegistry = new StorageProviderRegistry(owner, address(identityRegistry), address(banManager), MIN_STAKE);
        cdnRegistry = new CDNRegistry(owner, address(identityRegistry), address(banManager), MIN_STAKE);
        vm.stopPrank();

        // Setup agent IDs
        identityRegistry.setAgent(AGENT_ID_1, provider1);
        identityRegistry.setAgent(AGENT_ID_2, provider2);

        // Fund providers
        vm.deal(provider1, 10 ether);
        vm.deal(provider2, 10 ether);
    }

    // ============ Storage Registry Tests ============

    function test_StorageRegistry_RegisterWithoutAgent() public {
        vm.prank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        assertEq(storageRegistry.providerCount(), 1);
        IStorageTypes.Provider memory p = storageRegistry.getProvider(provider1);
        assertEq(p.owner, provider1);
        assertEq(p.name, "Test Provider");
        assertTrue(p.active);
    }

    function test_StorageRegistry_RegisterWithAgent() public {
        vm.prank(provider1);
        storageRegistry.registerWithAgent{value: MIN_STAKE}(
            "Test Provider",
            "https://storage.test.com",
            uint8(IStorageTypes.ProviderType.IPFS_NODE),
            bytes32(0),
            AGENT_ID_1
        );

        assertEq(storageRegistry.providerCount(), 1);
        assertEq(storageRegistry.getAgentByProvider(provider1), AGENT_ID_1);
        assertEq(storageRegistry.getProviderByAgent(AGENT_ID_1), provider1);
    }

    function test_StorageRegistry_RegisterFailsWithInsufficientStake() public {
        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE - 1}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );
    }

    function test_StorageRegistry_RegisterFailsWhenBanned() public {
        banManager.banAddress(provider1);

        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );
    }

    function test_StorageRegistry_RegisterWithBannedAgent() public {
        identityRegistry.setBanned(AGENT_ID_1, true);

        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.registerWithAgent{value: MIN_STAKE}(
            "Test Provider",
            "https://storage.test.com",
            uint8(IStorageTypes.ProviderType.IPFS_NODE),
            bytes32(0),
            AGENT_ID_1
        );
    }

    function test_StorageRegistry_RegisterWithWrongAgentOwner() public {
        // Provider2 tries to register with Provider1's agent
        vm.prank(provider2);
        vm.expectRevert();
        storageRegistry.registerWithAgent{value: MIN_STAKE}(
            "Test Provider",
            "https://storage.test.com",
            uint8(IStorageTypes.ProviderType.IPFS_NODE),
            bytes32(0),
            AGENT_ID_1
        );
    }

    function test_StorageRegistry_DoubleRegistrationFails() public {
        vm.startPrank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider 2", "https://storage2.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );
        vm.stopPrank();
    }

    function test_StorageRegistry_DeactivateAndReactivate() public {
        vm.startPrank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        storageRegistry.deactivate();
        IStorageTypes.Provider memory p = storageRegistry.getProvider(provider1);
        assertFalse(p.active);

        storageRegistry.reactivate();
        p = storageRegistry.getProvider(provider1);
        assertTrue(p.active);
        vm.stopPrank();
    }

    function test_StorageRegistry_AddAndWithdrawStake() public {
        vm.startPrank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        // Add more stake
        storageRegistry.addStake{value: 0.5 ether}();
        IStorageTypes.Provider memory p = storageRegistry.getProvider(provider1);
        assertEq(p.stake, MIN_STAKE + 0.5 ether);

        // Withdraw excess
        uint256 balanceBefore = provider1.balance;
        storageRegistry.withdrawStake(0.5 ether);
        assertEq(provider1.balance, balanceBefore + 0.5 ether);
        vm.stopPrank();
    }

    function test_StorageRegistry_WithdrawBelowMinimumFails() public {
        vm.startPrank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        vm.expectRevert();
        storageRegistry.withdrawStake(0.01 ether); // Would go below minimum
        vm.stopPrank();
    }

    // ============ CDN Registry Tests ============

    function test_CDNRegistry_RegisterProvider() public {
        vm.prank(provider1);
        cdnRegistry.registerProvider{value: MIN_STAKE}(
            "CDN Provider", "https://cdn.test.com", ICDNTypes.ProviderType.CLOUDFLARE, bytes32(0)
        );

        assertEq(cdnRegistry.providerCount(), 1);
    }

    function test_CDNRegistry_RegisterProviderWithAgent() public {
        vm.prank(provider1);
        cdnRegistry.registerProviderWithAgent{value: MIN_STAKE}(
            "CDN Provider", "https://cdn.test.com", ICDNTypes.ProviderType.CLOUDFLARE, bytes32(0), AGENT_ID_1
        );

        assertEq(cdnRegistry.getAgentByProvider(provider1), AGENT_ID_1);
    }

    function test_CDNRegistry_RegisterEdgeNode() public {
        vm.prank(provider1);
        bytes32 nodeId = cdnRegistry.registerEdgeNode{value: 0.001 ether}(
            "https://edge1.test.com", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED
        );

        assertTrue(nodeId != bytes32(0));
        assertEq(cdnRegistry.nodeCount(), 1);
    }

    function test_CDNRegistry_RegisterEdgeNodeWithAgent() public {
        vm.prank(provider1);
        bytes32 nodeId = cdnRegistry.registerEdgeNodeWithAgent{value: 0.001 ether}(
            "https://edge1.test.com", ICDNTypes.Region.US_EAST_1, ICDNTypes.ProviderType.DECENTRALIZED, AGENT_ID_1
        );

        assertTrue(nodeId != bytes32(0));
    }

    // ============ Shared Behavior Tests ============

    function test_GetActiveProviders_ReturnsCorrectList() public {
        // Register two providers
        vm.prank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Provider 1", "https://p1.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        vm.prank(provider2);
        storageRegistry.register{value: MIN_STAKE}(
            "Provider 2", "https://p2.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        address[] memory active = storageRegistry.getActiveProviders();
        assertEq(active.length, 2);

        // Deactivate one
        vm.prank(provider1);
        storageRegistry.deactivate();

        active = storageRegistry.getActiveProviders();
        assertEq(active.length, 1);
        assertEq(active[0], provider2);
    }

    function test_IsProviderBanned_ChecksAgentBan() public {
        vm.prank(provider1);
        storageRegistry.registerWithAgent{value: MIN_STAKE}(
            "Test Provider",
            "https://storage.test.com",
            uint8(IStorageTypes.ProviderType.IPFS_NODE),
            bytes32(0),
            AGENT_ID_1
        );

        assertFalse(storageRegistry.isProviderBanned(provider1));

        identityRegistry.setBanned(AGENT_ID_1, true);
        assertTrue(storageRegistry.isProviderBanned(provider1));
    }

    function test_Pause_BlocksRegistration() public {
        vm.prank(owner);
        storageRegistry.pause();

        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );
    }

    function test_Unpause_AllowsRegistration() public {
        vm.startPrank(owner);
        storageRegistry.pause();
        storageRegistry.unpause();
        vm.stopPrank();

        vm.prank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        assertEq(storageRegistry.providerCount(), 1);
    }

    function test_SetMinProviderStake() public {
        vm.prank(owner);
        storageRegistry.setMinProviderStake(0.5 ether);

        assertEq(storageRegistry.minProviderStake(), 0.5 ether);

        // Old stake should fail
        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );
    }

    function test_SetMinProviderStake_OnlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert();
        storageRegistry.setMinProviderStake(0.5 ether);
    }

    // ============ Boundary Tests ============

    function test_Register_ExactMinimumStake() public {
        vm.prank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        assertEq(storageRegistry.providerCount(), 1);
    }

    function test_Register_EmptyNameFails() public {
        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE}(
            "", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );
    }

    function test_Register_EmptyEndpointFails() public {
        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );
    }

    function test_Register_InvalidProviderTypeFails() public {
        vm.prank(provider1);
        vm.expectRevert();
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider",
            "https://storage.test.com",
            255, // Invalid type
            bytes32(0)
        );
    }

    // ============ Fuzz Tests ============

    function testFuzz_Register_WithVaryingStake(uint256 stake) public {
        stake = bound(stake, MIN_STAKE, 100 ether);
        vm.deal(provider1, stake);

        vm.prank(provider1);
        storageRegistry.register{value: stake}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        IStorageTypes.Provider memory p = storageRegistry.getProvider(provider1);
        assertEq(p.stake, stake);
    }

    function testFuzz_AddAndWithdrawStake(uint256 addAmount, uint256 withdrawAmount) public {
        addAmount = bound(addAmount, 0.01 ether, 10 ether);
        vm.deal(provider1, MIN_STAKE + addAmount);

        vm.startPrank(provider1);
        storageRegistry.register{value: MIN_STAKE}(
            "Test Provider", "https://storage.test.com", uint8(IStorageTypes.ProviderType.IPFS_NODE), bytes32(0)
        );

        storageRegistry.addStake{value: addAmount}();

        uint256 totalStake = MIN_STAKE + addAmount;
        withdrawAmount = bound(withdrawAmount, 0, totalStake - MIN_STAKE);

        if (withdrawAmount > 0) {
            storageRegistry.withdrawStake(withdrawAmount);
            IStorageTypes.Provider memory p = storageRegistry.getProvider(provider1);
            assertEq(p.stake, totalStake - withdrawAmount);
        }
        vm.stopPrank();
    }
}
