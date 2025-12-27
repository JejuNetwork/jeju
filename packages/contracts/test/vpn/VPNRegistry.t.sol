// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {VPNRegistry} from "../../src/vpn/VPNRegistry.sol";

contract VPNRegistryTest is Test {
    VPNRegistry public registry;

    address public owner;
    address public treasury;
    address public coordinator;
    address public operator1;
    address public operator2;
    address public client;

    bytes2 public constant US = "US";
    bytes2 public constant NL = "NL";
    bytes2 public constant CN = "CN"; // Blocked country

    function setUp() public {
        owner = makeAddr("owner");
        treasury = makeAddr("treasury");
        coordinator = makeAddr("coordinator");
        operator1 = makeAddr("operator1");
        operator2 = makeAddr("operator2");
        client = makeAddr("client");

        vm.deal(owner, 100 ether);
        vm.deal(operator1, 100 ether);
        vm.deal(operator2, 100 ether);

        vm.prank(owner);
        registry = new VPNRegistry(owner, treasury);

        vm.prank(owner);
        registry.setCoordinator(coordinator);
    }

    function _getDefaultCapabilities() internal pure returns (VPNRegistry.NodeCapabilities memory) {
        return VPNRegistry.NodeCapabilities({
            supportsWireGuard: true,
            supportsSOCKS5: true,
            supportsHTTPConnect: false,
            servesCDN: false,
            isVPNExit: true
        });
    }

    // ============ Registration Tests ============

    function test_RegisterNode() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);

        assertEq(node.operator, operator1);
        assertEq(node.countryCode, US);
        assertEq(node.endpoint, "vpn1.jeju.network:51820");
        assertEq(node.wireguardPubKey, "WgPubKey123ABC");
        assertEq(node.stake, 0.1 ether);
        assertTrue(node.active);
    }

    function test_RegisterNode_RevertIfAlreadyRegistered() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(operator1);
        vm.expectRevert(VPNRegistry.NodeAlreadyRegistered.selector);
        registry.register{value: 0.1 ether}(
            NL, keccak256("eu-west-1"), "vpn2.jeju.network:51820", "WgPubKey456DEF", _getDefaultCapabilities()
        );
    }

    function test_RegisterNode_RevertIfInsufficientStake() public {
        vm.prank(operator1);
        vm.expectRevert(abi.encodeWithSelector(VPNRegistry.InsufficientStake.selector, 0.005 ether, 0.01 ether));
        registry.register{value: 0.005 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );
    }

    function test_RegisterNode_RevertIfBlockedCountry() public {
        vm.prank(operator1);
        vm.expectRevert(VPNRegistry.CountryBlocked.selector);
        registry.register{value: 0.1 ether}(
            CN, keccak256("cn-north-1"), "vpn1.blocked.network:51820", "WgPubKey789GHI", _getDefaultCapabilities()
        );
    }

    // ============ Node Update Tests ============

    function test_UpdateNode() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(operator1);
        registry.updateNode("vpn-new.jeju.network:51820", "NewWgPubKey", _getDefaultCapabilities());

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);

        assertEq(node.endpoint, "vpn-new.jeju.network:51820");
        assertEq(node.wireguardPubKey, "NewWgPubKey");
    }

    function test_UpdateNode_RevertIfNotRegistered() public {
        vm.prank(operator1);
        vm.expectRevert(VPNRegistry.NodeNotRegistered.selector);
        registry.updateNode("vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities());
    }

    // ============ Stake Management Tests ============

    function test_AddStake() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(operator1);
        registry.addStake{value: 0.5 ether}();

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);
        assertEq(node.stake, 0.6 ether);
    }

    function test_WithdrawStake() public {
        vm.prank(operator1);
        registry.register{value: 1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        uint256 balanceBefore = operator1.balance;

        vm.prank(operator1);
        registry.withdrawStake(0.5 ether);

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);
        assertEq(node.stake, 0.5 ether);
        assertEq(operator1.balance, balanceBefore + 0.5 ether);
    }

    function test_WithdrawStake_RevertIfBreachesMinimum() public {
        vm.prank(operator1);
        registry.register{value: 0.05 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(operator1);
        vm.expectRevert(VPNRegistry.WithdrawalWouldBreachMinimum.selector);
        registry.withdrawStake(0.045 ether);
    }

    // ============ Node Activation Tests ============

    function test_DeactivateAndReactivateNode() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(operator1);
        registry.deactivate();

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);
        assertFalse(node.active);

        vm.prank(operator1);
        registry.reactivate();

        node = registry.getNode(operator1);
        assertTrue(node.active);
    }

    // ============ Session Recording Tests ============

    function test_RecordSession() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(coordinator);
        registry.recordSession(operator1, client, 1000000, true);

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);
        assertEq(node.totalBytesServed, 1000000);
        assertEq(node.totalSessions, 1);
        assertEq(node.successfulSessions, 1);
    }

    function test_RecordSession_Failed() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(coordinator);
        registry.recordSession(operator1, client, 500000, false);

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);
        assertEq(node.totalBytesServed, 500000);
        assertEq(node.totalSessions, 1);
        assertEq(node.successfulSessions, 0);
    }

    // ============ Contribution Tests ============

    function test_RecordContribution() public {
        vm.prank(coordinator);
        registry.recordContribution(client, 1000000, 500000);

        (uint256 vpnBytesUsed, uint256 bytesContributed,,) = registry.contributions(client);

        assertEq(vpnBytesUsed, 1000000);
        assertEq(bytesContributed, 500000);
    }

    // ============ Slashing Tests ============

    function test_Slash() public {
        vm.prank(operator1);
        registry.register{value: 1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        uint256 treasuryBalanceBefore = treasury.balance;

        vm.prank(owner);
        registry.slash(operator1, 0.5 ether, "Malicious behavior");

        VPNRegistry.VPNNode memory node = registry.getNode(operator1);
        assertEq(node.stake, 0.5 ether);
        assertEq(treasury.balance, treasuryBalanceBefore + 0.5 ether);
    }

    function test_Slash_RevertIfExceedsStake() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(owner);
        vm.expectRevert(VPNRegistry.SlashExceedsStake.selector);
        registry.slash(operator1, 1 ether, "Too much slash");
    }

    // ============ Country Management Tests ============

    function test_SetCountryAllowed() public {
        bytes2 newCountry = "IN";

        vm.prank(owner);
        registry.setCountryAllowed(newCountry, true);

        assertTrue(registry.allowedCountries(newCountry));
    }

    function test_SetCountryBlocked() public {
        bytes2 newBlocked = "SY";

        vm.prank(owner);
        registry.setCountryBlocked(newBlocked, true);

        assertTrue(registry.blockedCountries(newBlocked));
    }

    // ============ View Functions Tests ============

    function test_GetNodeCount() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(operator2);
        registry.register{value: 0.1 ether}(
            NL, keccak256("eu-west-1"), "vpn2.jeju.network:51820", "WgPubKey456DEF", _getDefaultCapabilities()
        );

        assertEq(registry.getNodeCount(), 2);
    }

    function test_GetNodesByCountry() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(operator2);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-west-1"), "vpn2.jeju.network:51820", "WgPubKey456DEF", _getDefaultCapabilities()
        );

        address[] memory usNodes = registry.getNodesByCountry(US);
        assertEq(usNodes.length, 2);
    }

    function test_IsActive() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        assertTrue(registry.isActive(operator1));
        assertFalse(registry.isActive(operator2));
    }

    // ============ Admin Tests ============

    function test_SetMinNodeStake() public {
        vm.prank(owner);
        registry.setMinNodeStake(0.5 ether);

        assertEq(registry.minNodeStake(), 0.5 ether);
    }

    function test_SetProtocolFeeBps() public {
        vm.prank(owner);
        registry.setProtocolFeeBps(300);

        assertEq(registry.protocolFeeBps(), 300);
    }

    function test_PauseUnpause() public {
        vm.prank(owner);
        registry.pause();

        vm.prank(operator1);
        vm.expectRevert();
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        vm.prank(owner);
        registry.unpause();

        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        assertEq(registry.getNodeCount(), 1);
    }

    function test_Heartbeat() public {
        vm.prank(operator1);
        registry.register{value: 0.1 ether}(
            US, keccak256("us-east-1"), "vpn1.jeju.network:51820", "WgPubKey123ABC", _getDefaultCapabilities()
        );

        VPNRegistry.VPNNode memory nodeBefore = registry.getNode(operator1);

        vm.warp(block.timestamp + 1 hours);

        vm.prank(operator1);
        registry.heartbeat();

        VPNRegistry.VPNNode memory nodeAfter = registry.getNode(operator1);
        assertTrue(nodeAfter.lastSeen > nodeBefore.lastSeen);
    }
}
