// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {NetworkRegistry} from "../../src/federation/NetworkRegistry.sol";

/**
 * @title NetworkRegistryTest
 * @notice Tests for the core network registry contract
 * 
 * Tests cover:
 * - Network registration with different stake levels
 * - Trust tier management (UNSTAKED, STAKED, VERIFIED)
 * - Governance integration for VERIFIED status
 * - Cross-network trust relationships
 * - Stake management and withdrawal
 * - Superchain status
 */
contract NetworkRegistryTest is Test {
    NetworkRegistry registry;
    
    address owner;
    address verificationAuthority;
    address governance;
    address operator1;
    address operator2;
    address operator3;

    uint256 constant JEJU_CHAIN_ID = 420690;
    uint256 constant FORK_CHAIN_ID = 420691;
    uint256 constant TEST_CHAIN_ID = 420692;

    function setUp() public {
        owner = makeAddr("owner");
        verificationAuthority = makeAddr("verificationAuthority");
        governance = makeAddr("governance");
        operator1 = makeAddr("operator1");
        operator2 = makeAddr("operator2");
        operator3 = makeAddr("operator3");

        vm.deal(operator1, 100 ether);
        vm.deal(operator2, 100 ether);
        vm.deal(operator3, 100 ether);

        vm.startPrank(owner);
        registry = new NetworkRegistry(verificationAuthority);
        registry.setFederationGovernance(governance);
        vm.stopPrank();
    }

    // ============ Basic Registration Tests ============

    function test_RegisterNetworkUnstaked() public {
        vm.startPrank(operator1);

        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork(
            JEJU_CHAIN_ID,
            "Jeju Network",
            "https://rpc.jeju.network",
            "https://explorer.jeju.network",
            "wss://ws.jeju.network",
            contracts,
            keccak256("genesis")
        );

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);

        assertEq(network.chainId, JEJU_CHAIN_ID);
        assertEq(network.name, "Jeju Network");
        assertEq(network.operator, operator1);
        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.UNSTAKED));
        assertTrue(network.isActive);
        assertFalse(network.isVerified);
        assertEq(network.stake, 0);

        vm.stopPrank();
    }

    function test_RegisterNetworkStaked() public {
        vm.startPrank(operator1);

        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 5 ether}(
            JEJU_CHAIN_ID,
            "Staked Network",
            "https://rpc.staked.network",
            "",
            "",
            contracts,
            bytes32(0)
        );

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);

        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.STAKED));
        assertEq(network.stake, 5 ether);
        assertFalse(network.isVerified);
        assertTrue(registry.canParticipateInConsensus(JEJU_CHAIN_ID));
        assertFalse(registry.isSequencerEligible(JEJU_CHAIN_ID));

        vm.stopPrank();
    }

    function test_RegisterNetworkWithVerificationStake() public {
        vm.startPrank(operator1);

        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Verification Stake Network",
            "https://rpc.network",
            "",
            "",
            contracts,
            bytes32(0)
        );

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);

        // Should be STAKED (not VERIFIED) with pending governance
        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.STAKED));
        assertFalse(network.isVerified);
        assertTrue(registry.pendingVerification(JEJU_CHAIN_ID));

        vm.stopPrank();
    }

    // ============ Governance Integration Tests ============

    function test_SetVerifiedByGovernance() public {
        // Register with verification stake
        vm.startPrank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: 10 ether}(
            JEJU_CHAIN_ID,
            "Pending Verification",
            "https://rpc.network",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();

        // Governance approves
        vm.prank(governance);
        registry.setVerifiedByGovernance(JEJU_CHAIN_ID);

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);

        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.VERIFIED));
        assertTrue(network.isVerified);
        assertFalse(registry.pendingVerification(JEJU_CHAIN_ID));
        assertTrue(registry.isSequencerEligible(JEJU_CHAIN_ID));
        assertEq(registry.verifiedNetworks(), 1);
    }

    function test_RevokeVerifiedStatus() public {
        // Setup verified network
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);

        assertTrue(registry.getNetwork(JEJU_CHAIN_ID).isVerified);
        assertEq(registry.verifiedNetworks(), 1);

        // Governance revokes
        vm.prank(governance);
        registry.revokeVerifiedStatus(JEJU_CHAIN_ID);

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);

        assertFalse(network.isVerified);
        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.STAKED));
        assertEq(registry.verifiedNetworks(), 0);
        assertFalse(registry.isSequencerEligible(JEJU_CHAIN_ID));
    }

    function test_SlashStake() public {
        // Setup verified network
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);

        NetworkRegistry.NetworkInfo memory before = registry.getNetwork(JEJU_CHAIN_ID);
        assertEq(before.stake, 10 ether);

        address treasury = makeAddr("treasury");

        // Slash 50%
        vm.prank(governance);
        registry.slashStake(JEJU_CHAIN_ID, 5000, treasury);

        NetworkRegistry.NetworkInfo memory after_ = registry.getNetwork(JEJU_CHAIN_ID);

        assertEq(after_.stake, 5 ether);
        assertEq(treasury.balance, 5 ether);
        // Still verified (above 1 ETH but below 10 ETH for new verification)
        assertFalse(after_.isVerified); // Revoked due to being below VERIFICATION_STAKE
        assertEq(uint8(after_.trustTier), uint8(NetworkRegistry.TrustTier.STAKED));
    }

    function test_SlashStakeBelowMinimum() public {
        // Setup verified network
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);

        address treasury = makeAddr("treasury");

        // Slash 99%
        vm.prank(governance);
        registry.slashStake(JEJU_CHAIN_ID, 9900, treasury);

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);

        assertEq(network.stake, 0.1 ether);
        assertEq(uint8(network.trustTier), uint8(NetworkRegistry.TrustTier.UNSTAKED));
        assertFalse(network.isVerified);
    }

    function test_RevertWhen_NonGovernanceCallsGovernanceFunction() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 10 ether);

        vm.prank(operator1);
        vm.expectRevert(NetworkRegistry.NotGovernance.selector);
        registry.setVerifiedByGovernance(JEJU_CHAIN_ID);
    }

    // ============ Stake Management Tests ============

    function test_AddStake() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        vm.startPrank(operator1);
        registry.addStake{value: 5 ether}(JEJU_CHAIN_ID);
        vm.stopPrank();

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        assertEq(network.stake, 6 ether);
    }

    function test_AddStakeTriggersGovernance() public {
        // Start with 5 ETH (below verification threshold)
        _registerNetwork(JEJU_CHAIN_ID, operator1, 5 ether);

        assertFalse(registry.pendingVerification(JEJU_CHAIN_ID));

        // Add 5 more (crossing 10 ETH threshold)
        vm.prank(operator1);
        registry.addStake{value: 5 ether}(JEJU_CHAIN_ID);

        assertTrue(registry.pendingVerification(JEJU_CHAIN_ID));
    }

    function test_WithdrawStake() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 5 ether);

        // Deactivate first
        vm.startPrank(operator1);
        registry.deactivateNetwork(JEJU_CHAIN_ID);

        uint256 balanceBefore = operator1.balance;
        registry.withdrawStake(JEJU_CHAIN_ID);
        vm.stopPrank();

        assertEq(operator1.balance, balanceBefore + 5 ether);

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        assertEq(network.stake, 0);
    }

    function test_RevertWhen_WithdrawWhileActive() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 5 ether);

        vm.prank(operator1);
        vm.expectRevert(NetworkRegistry.StillActive.selector);
        registry.withdrawStake(JEJU_CHAIN_ID);
    }

    // ============ Trust Relationship Tests ============

    function test_EstablishTrust() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);
        _registerNetwork(FORK_CHAIN_ID, operator2, 1 ether);

        vm.prank(operator1);
        registry.establishTrust(JEJU_CHAIN_ID, FORK_CHAIN_ID);

        assertTrue(registry.isTrusted(JEJU_CHAIN_ID, FORK_CHAIN_ID));
        assertFalse(registry.isTrusted(FORK_CHAIN_ID, JEJU_CHAIN_ID));

        uint256[] memory peers = registry.getTrustedPeers(JEJU_CHAIN_ID);
        assertEq(peers.length, 1);
        assertEq(peers[0], FORK_CHAIN_ID);
    }

    function test_MutualTrust() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);
        _registerNetwork(FORK_CHAIN_ID, operator2, 1 ether);

        vm.prank(operator1);
        registry.establishTrust(JEJU_CHAIN_ID, FORK_CHAIN_ID);

        vm.prank(operator2);
        registry.establishTrust(FORK_CHAIN_ID, JEJU_CHAIN_ID);

        assertTrue(registry.isMutuallyTrusted(JEJU_CHAIN_ID, FORK_CHAIN_ID));
    }

    function test_RevokeTrust() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);
        _registerNetwork(FORK_CHAIN_ID, operator2, 1 ether);

        vm.startPrank(operator1);
        registry.establishTrust(JEJU_CHAIN_ID, FORK_CHAIN_ID);
        
        assertTrue(registry.isTrusted(JEJU_CHAIN_ID, FORK_CHAIN_ID));
        
        registry.revokeTrust(JEJU_CHAIN_ID, FORK_CHAIN_ID);
        vm.stopPrank();

        assertFalse(registry.isTrusted(JEJU_CHAIN_ID, FORK_CHAIN_ID));
    }

    function test_RevertWhen_TrustSelf() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        vm.prank(operator1);
        vm.expectRevert(NetworkRegistry.CannotTrustSelf.selector);
        registry.establishTrust(JEJU_CHAIN_ID, JEJU_CHAIN_ID);
    }

    // ============ Network Update Tests ============

    function test_UpdateNetwork() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        vm.prank(operator1);
        registry.updateNetwork(
            JEJU_CHAIN_ID,
            "Updated Name",
            "https://new-rpc.network",
            "https://new-explorer.network",
            "wss://new-ws.network"
        );

        NetworkRegistry.NetworkInfo memory network = registry.getNetwork(JEJU_CHAIN_ID);
        assertEq(network.name, "Updated Name");
        assertEq(network.rpcUrl, "https://new-rpc.network");
    }

    function test_UpdateContracts() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        NetworkRegistry.NetworkContracts memory newContracts = NetworkRegistry.NetworkContracts({
            identityRegistry: address(0x1),
            solverRegistry: address(0x2),
            inputSettler: address(0x3),
            outputSettler: address(0x4),
            liquidityVault: address(0x5),
            governance: address(0x6),
            oracle: address(0x7),
            registryHub: address(0x8)
        });

        vm.prank(operator1);
        registry.updateContracts(JEJU_CHAIN_ID, newContracts);

        NetworkRegistry.NetworkContracts memory contracts = registry.getNetworkContracts(JEJU_CHAIN_ID);
        assertEq(contracts.identityRegistry, address(0x1));
        assertEq(contracts.registryHub, address(0x8));
    }

    function test_DeactivateNetwork() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        assertTrue(registry.getNetwork(JEJU_CHAIN_ID).isActive);
        assertEq(registry.activeNetworks(), 1);

        vm.prank(operator1);
        registry.deactivateNetwork(JEJU_CHAIN_ID);

        assertFalse(registry.getNetwork(JEJU_CHAIN_ID).isActive);
        assertEq(registry.activeNetworks(), 0);
    }

    // ============ Superchain Status Tests ============

    function test_SetSuperchainStatus() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        assertFalse(registry.getNetwork(JEJU_CHAIN_ID).isSuperchain);

        vm.prank(verificationAuthority);
        registry.setSuperchainStatus(JEJU_CHAIN_ID, true);

        assertTrue(registry.getNetwork(JEJU_CHAIN_ID).isSuperchain);
    }

    function test_RevertWhen_UnauthorizedSetsSuperchain() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        vm.prank(operator1);
        vm.expectRevert(NetworkRegistry.NotVerificationAuthority.selector);
        registry.setSuperchainStatus(JEJU_CHAIN_ID, true);
    }

    // ============ View Function Tests ============

    function test_GetActiveNetworks() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);
        _registerNetwork(FORK_CHAIN_ID, operator2, 1 ether);
        _registerNetwork(TEST_CHAIN_ID, operator3, 1 ether);

        // Deactivate one
        vm.prank(operator2);
        registry.deactivateNetwork(FORK_CHAIN_ID);

        uint256[] memory active = registry.getActiveNetworks();
        assertEq(active.length, 2);
    }

    function test_GetVerifiedNetworks() public {
        _createVerifiedNetwork(JEJU_CHAIN_ID, operator1);
        _registerNetwork(FORK_CHAIN_ID, operator2, 1 ether);
        _createVerifiedNetwork(TEST_CHAIN_ID, operator3);

        uint256[] memory verified = registry.getVerifiedNetworks();
        assertEq(verified.length, 2);
    }

    function test_GetAllNetworkIds() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);
        _registerNetwork(FORK_CHAIN_ID, operator2, 1 ether);
        _registerNetwork(TEST_CHAIN_ID, operator3, 1 ether);

        uint256[] memory all = registry.getAllNetworkIds();
        assertEq(all.length, 3);
    }

    // ============ Error Cases ============

    function test_RevertWhen_RegisterDuplicate() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        vm.startPrank(operator2);
        NetworkRegistry.NetworkContracts memory contracts;
        vm.expectRevert(NetworkRegistry.NetworkExists.selector);
        registry.registerNetwork(
            JEJU_CHAIN_ID,
            "Duplicate",
            "",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();
    }

    function test_RevertWhen_InvalidChainId() public {
        vm.startPrank(operator1);
        NetworkRegistry.NetworkContracts memory contracts;
        vm.expectRevert(NetworkRegistry.InvalidChainId.selector);
        registry.registerNetwork(
            0, // Invalid
            "Zero Chain",
            "",
            "",
            "",
            contracts,
            bytes32(0)
        );
        vm.stopPrank();
    }

    function test_RevertWhen_NotOperator() public {
        _registerNetwork(JEJU_CHAIN_ID, operator1, 1 ether);

        vm.prank(operator2);
        vm.expectRevert(NetworkRegistry.NotOperator.selector);
        registry.updateNetwork(JEJU_CHAIN_ID, "Unauthorized", "", "", "");
    }

    function test_Version() public view {
        assertEq(registry.version(), "1.0.0");
    }

    // ============ Helpers ============

    function _registerNetwork(uint256 chainId, address operator, uint256 stake) internal {
        vm.startPrank(operator);
        NetworkRegistry.NetworkContracts memory contracts;
        registry.registerNetwork{value: stake}(
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

    function _createVerifiedNetwork(uint256 chainId, address operator) internal {
        _registerNetwork(chainId, operator, 10 ether);

        vm.prank(governance);
        registry.setVerifiedByGovernance(chainId);
    }
}

