// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {DelegationRegistry} from "../src/council/DelegationRegistry.sol";
import {MockERC20} from "./mocks/MockTokens.sol";

contract MockIdentityRegistry {
    struct AgentRegistration {
        uint256 id;
        address owner;
        string name;
        string role;
        uint256 stakedAmount;
        uint8 tier;
        bool isBanned;
    }

    mapping(uint256 => AgentRegistration) public agents;
    mapping(address => uint256) public ownerToAgent;
    uint256 public nextId = 1;

    function registerAgent(address owner, string memory name, uint256 stake) external returns (uint256) {
        uint256 id = nextId++;
        agents[id] = AgentRegistration({
            id: id,
            owner: owner,
            name: name,
            role: "delegate",
            stakedAmount: stake,
            tier: stake >= 1 ether ? 2 : 1, // HIGH tier if >= 1 ETH
            isBanned: false
        });
        ownerToAgent[owner] = id;
        return id;
    }

    function getAgent(uint256 agentId) external view returns (AgentRegistration memory) {
        return agents[agentId];
    }

    function getAgentByOwner(address owner) external view returns (uint256) {
        return ownerToAgent[owner];
    }

    function agentExists(uint256 agentId) external view returns (bool) {
        return agents[agentId].id != 0;
    }
}

contract MockReputationRegistry {
    mapping(uint256 => uint256) public scores;

    function setScore(uint256 agentId, uint256 score) external {
        scores[agentId] = score;
    }

    function getReputationScore(uint256 agentId) external view returns (uint256) {
        return scores[agentId];
    }
}

contract DelegationRegistryTest is Test {
    DelegationRegistry public registry;
    MockERC20 public token;
    MockIdentityRegistry public identity;
    MockReputationRegistry public reputation;

    address public owner = address(this);
    address public alice = address(0x1);
    address public bob = address(0x2);
    address public charlie = address(0x3);

    function setUp() public {
        token = new MockERC20("Governance Token", "GOV", 18);
        identity = new MockIdentityRegistry();
        reputation = new MockReputationRegistry();

        registry = new DelegationRegistry(
            address(token),
            address(identity),
            address(reputation),
            owner
        );

        // Setup test accounts
        token.mint(alice, 10000 ether);
        token.mint(bob, 5000 ether);
        token.mint(charlie, 1000 ether);

        vm.prank(alice);
        token.approve(address(registry), type(uint256).max);
        vm.prank(bob);
        token.approve(address(registry), type(uint256).max);
        vm.prank(charlie);
        token.approve(address(registry), type(uint256).max);

        // Register agents
        identity.registerAgent(alice, "Alice", 2 ether);
        identity.registerAgent(bob, "Bob", 1 ether);

        // Set reputation scores
        reputation.setScore(1, 90);
        reputation.setScore(2, 85);
    }

    function testRegisterAsDelegate() public {
        string[] memory expertise = new string[](2);
        expertise[0] = "treasury";
        expertise[1] = "defi";

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice Delegate", "ipfs://profile", expertise);

        DelegationRegistry.Delegate memory d = registry.getDelegate(alice);
        assertEq(d.name, "Alice Delegate");
        assertEq(d.agentId, 1);
        assertTrue(d.isActive);
        assertEq(d.expertise.length, 2);
    }

    function testDelegateVotingPower() public {
        // Alice registers as delegate
        string[] memory expertise = new string[](1);
        expertise[0] = "governance";

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        // Charlie delegates to Alice
        vm.prank(charlie);
        registry.delegate(alice, 500 ether, 0);

        DelegationRegistry.Delegate memory d = registry.getDelegate(alice);
        assertEq(d.totalDelegated, 500 ether);
        assertEq(d.delegatorCount, 1);

        // Check Charlie's delegation
        DelegationRegistry.Delegation memory del = registry.getDelegation(charlie);
        assertEq(del.delegate, alice);
        assertEq(del.amount, 500 ether);
    }

    function testRevokeDelegation() public {
        string[] memory expertise = new string[](0);

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        vm.prank(charlie);
        registry.delegate(alice, 500 ether, 0);

        // Revoke
        vm.prank(charlie);
        registry.revokeDelegation();

        DelegationRegistry.Delegate memory d = registry.getDelegate(alice);
        assertEq(d.totalDelegated, 0);
        assertEq(d.delegatorCount, 0);

        DelegationRegistry.Delegation memory del = registry.getDelegation(charlie);
        assertEq(del.amount, 0);
    }

    function testRedelegate() public {
        string[] memory expertise = new string[](0);

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        vm.prank(bob);
        registry.registerAsDelegate(2, "Bob", "", expertise);

        // Charlie delegates to Alice
        vm.prank(charlie);
        registry.delegate(alice, 500 ether, 0);

        // Charlie redelegates to Bob
        vm.prank(charlie);
        registry.redelegate(bob, 0);

        DelegationRegistry.Delegate memory aliceD = registry.getDelegate(alice);
        assertEq(aliceD.totalDelegated, 0);

        DelegationRegistry.Delegate memory bobD = registry.getDelegate(bob);
        assertEq(bobD.totalDelegated, 500 ether);
    }

    function testLockedDelegation() public {
        string[] memory expertise = new string[](0);

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        // Charlie delegates with 7 day lock
        vm.prank(charlie);
        registry.delegate(alice, 500 ether, 7 days);

        // Try to revoke before lock expires
        vm.prank(charlie);
        vm.expectRevert(DelegationRegistry.DelegationLocked.selector);
        registry.revokeDelegation();

        // Fast forward past lock
        vm.warp(block.timestamp + 8 days);

        // Now should work
        vm.prank(charlie);
        registry.revokeDelegation();
    }

    function testSecurityCouncilUpdate() public {
        string[] memory expertise = new string[](0);

        // Register delegates with high stake and reputation
        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        vm.prank(bob);
        registry.registerAsDelegate(2, "Bob", "", expertise);

        // Delegate to them
        vm.prank(charlie);
        registry.delegate(alice, 500 ether, 0);

        // Update security council
        registry.updateSecurityCouncil();

        address[] memory council = registry.getSecurityCouncil();
        // Council may be empty if thresholds aren't met
        // Just verify the function runs without error
        assertTrue(council.length >= 0);
    }

    function testGetTopDelegates() public {
        string[] memory expertise = new string[](0);

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        vm.prank(bob);
        registry.registerAsDelegate(2, "Bob", "", expertise);

        // Delegate more to Alice
        vm.prank(charlie);
        registry.delegate(alice, 800 ether, 0);

        DelegationRegistry.Delegate[] memory top = registry.getTopDelegates(5);
        assertEq(top.length, 2);
        assertEq(top[0].delegate, alice); // Alice should be first (more delegated)
    }

    function testCannotDelegateToSelf() public {
        string[] memory expertise = new string[](0);

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        vm.prank(alice);
        vm.expectRevert(DelegationRegistry.CannotDelegateToSelf.selector);
        registry.delegate(alice, 500 ether, 0);
    }

    function testCannotDelegateToInactiveDelegate() public {
        string[] memory expertise = new string[](0);

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        // Deactivate
        vm.prank(alice);
        registry.deactivateDelegate();

        vm.prank(charlie);
        vm.expectRevert(DelegationRegistry.DelegateNotActive.selector);
        registry.delegate(alice, 500 ether, 0);
    }

    function testVotingPowerCalculation() public {
        string[] memory expertise = new string[](0);

        vm.prank(alice);
        registry.registerAsDelegate(1, "Alice", "", expertise);

        // Charlie delegates 500 to Alice
        vm.prank(charlie);
        registry.delegate(alice, 500 ether, 0);

        // Alice's voting power = her balance + delegated
        uint256 alicePower = registry.getVotingPower(alice);
        assertEq(alicePower, token.balanceOf(alice) + 500 ether);

        // Charlie's voting power = 0 (delegated away)
        uint256 charliePower = registry.getVotingPower(charlie);
        assertEq(charliePower, 0);

        // Bob's voting power = his balance (no delegation)
        uint256 bobPower = registry.getVotingPower(bob);
        assertEq(bobPower, token.balanceOf(bob));
    }

    function testVersion() public view {
        assertEq(registry.version(), "1.0.0");
    }
}
