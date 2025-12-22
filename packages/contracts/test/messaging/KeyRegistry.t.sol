// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console} from "forge-std/Test.sol";
import {MessagingKeyRegistry} from "../../src/messaging/MessagingKeyRegistry.sol";

contract KeyRegistryTest is Test {
    MessagingKeyRegistry public registry;

    uint256 alicePrivateKey = 0xA11CE;
    uint256 bobPrivateKey = 0xB0B;
    address public alice;
    address public bob;

    bytes32 public aliceIdentityKey = bytes32(uint256(1));
    bytes32 public aliceSignedPreKey = bytes32(uint256(2));

    bytes32 public bobIdentityKey = bytes32(uint256(4));
    bytes32 public bobSignedPreKey = bytes32(uint256(5));

    function setUp() public {
        registry = new MessagingKeyRegistry();
        alice = vm.addr(alicePrivateKey);
        bob = vm.addr(bobPrivateKey);
    }

    // Helper to create valid signature
    function _signPreKey(bytes32 preKey, address user, uint256 privateKey) internal view returns (bytes memory) {
        bytes32 message = keccak256(abi.encodePacked(preKey, user, block.chainid));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    // ============ Registration Tests ============

    function test_RegisterKeyBundle() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);

        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        MessagingKeyRegistry.PublicKeyBundle memory bundle = registry.getKeyBundle(alice);

        assertEq(bundle.identityKey, aliceIdentityKey);
        assertEq(bundle.signedPreKey, aliceSignedPreKey);
        assertTrue(bundle.isActive);
        assertGt(bundle.registeredAt, 0);
    }

    function test_RegisterKeyBundle_EmitsEvent() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);

        vm.expectEmit(true, false, false, true);
        emit MessagingKeyRegistry.KeyBundleRegistered(alice, aliceIdentityKey, aliceSignedPreKey, block.timestamp);

        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);
    }

    function test_RevertWhen_AlreadyRegistered() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);

        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        vm.expectRevert(MessagingKeyRegistry.KeyAlreadyRegistered.selector);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);
    }

    function test_RevertWhen_InvalidIdentityKey() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);

        vm.expectRevert(MessagingKeyRegistry.InvalidKeyLength.selector);
        vm.prank(alice);
        registry.registerKeyBundle(bytes32(0), aliceSignedPreKey, sig);
    }

    function test_RevertWhen_InvalidSignature() public {
        // Sign with wrong key
        bytes memory badSig = _signPreKey(aliceSignedPreKey, alice, bobPrivateKey);

        vm.expectRevert(MessagingKeyRegistry.Unauthorized.selector);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, badSig);
    }

    // ============ Key Rotation Tests ============

    function test_RotateSignedPreKey() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        bytes32 newPreKey = bytes32(uint256(100));
        bytes memory newSig = _signPreKey(newPreKey, alice, alicePrivateKey);

        vm.prank(alice);
        registry.rotateSignedPreKey(newPreKey, newSig);

        MessagingKeyRegistry.PublicKeyBundle memory bundle = registry.getKeyBundle(alice);
        assertEq(bundle.signedPreKey, newPreKey);
    }

    function test_RevertWhen_RotateWithoutRegistration() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);

        vm.expectRevert(MessagingKeyRegistry.KeyNotRegistered.selector);
        vm.prank(alice);
        registry.rotateSignedPreKey(aliceSignedPreKey, sig);
    }

    // ============ One-Time Pre-Keys Tests ============

    function test_UploadOneTimePreKeys() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        bytes32[] memory keys = new bytes32[](3);
        keys[0] = bytes32(uint256(10));
        keys[1] = bytes32(uint256(11));
        keys[2] = bytes32(uint256(12));

        vm.prank(alice);
        registry.uploadOneTimePreKeys(keys);

        uint256 count = registry.getAvailablePreKeyCount(alice);
        assertEq(count, 3);
    }

    function test_ConsumeOneTimePreKey() public {
        // Warp to realistic timestamp (rate limit uses block.timestamp)
        vm.warp(1700000000);

        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        bytes32[] memory keys = new bytes32[](2);
        keys[0] = bytes32(uint256(10));
        keys[1] = bytes32(uint256(11));

        vm.prank(alice);
        registry.uploadOneTimePreKeys(keys);

        vm.prank(bob);
        (bytes32 preKey, uint256 keyIndex) = registry.consumeOneTimePreKey(alice);

        assertEq(preKey, keys[0]);
        assertEq(keyIndex, 0);
        assertEq(registry.getAvailablePreKeyCount(alice), 1);
    }

    function test_PreKeyConsumption_RateLimited() public {
        // Warp to realistic timestamp
        vm.warp(1700000000);

        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        bytes32[] memory keys = new bytes32[](3);
        keys[0] = bytes32(uint256(10));
        keys[1] = bytes32(uint256(11));
        keys[2] = bytes32(uint256(12));

        vm.prank(alice);
        registry.uploadOneTimePreKeys(keys);

        // First consumption succeeds
        vm.prank(bob);
        registry.consumeOneTimePreKey(alice);

        // Second consumption from same address is rate limited
        vm.expectRevert(MessagingKeyRegistry.PreKeyConsumptionRateLimited.selector);
        vm.prank(bob);
        registry.consumeOneTimePreKey(alice);

        // After cooldown, it works again
        vm.warp(block.timestamp + 1 hours + 1);
        vm.prank(bob);
        registry.consumeOneTimePreKey(alice);
    }

    function test_RevertWhen_NoPreKeysAvailable() public {
        // Warp to realistic timestamp
        vm.warp(1700000000);

        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        vm.expectRevert(MessagingKeyRegistry.NoPreKeysAvailable.selector);
        vm.prank(bob);
        registry.consumeOneTimePreKey(alice);
    }

    // ============ Revocation Tests ============

    function test_RevokeKeyBundle() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        vm.prank(alice);
        registry.revokeKeyBundle();

        MessagingKeyRegistry.PublicKeyBundle memory bundle = registry.getKeyBundle(alice);
        assertFalse(bundle.isActive);
        assertTrue(registry.isPermanentlyRevoked(alice));
    }

    function test_CannotReregisterAfterRevocation() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        vm.prank(alice);
        registry.revokeKeyBundle();

        // Cannot register again
        vm.expectRevert(MessagingKeyRegistry.PermanentlyRevoked.selector);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);
    }

    function test_CannotUpdateIdentityKeyAfterRevocation() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        vm.prank(alice);
        registry.revokeKeyBundle();

        bytes32 newKey = bytes32(uint256(999));
        bytes memory newSig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);

        vm.expectRevert(MessagingKeyRegistry.PermanentlyRevoked.selector);
        vm.prank(alice);
        registry.updateIdentityKey(newKey, aliceSignedPreKey, newSig);
    }

    function test_HasActiveKeyBundle() public {
        assertFalse(registry.hasActiveKeyBundle(alice));

        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        assertTrue(registry.hasActiveKeyBundle(alice));

        vm.prank(alice);
        registry.revokeKeyBundle();

        assertFalse(registry.hasActiveKeyBundle(alice));
    }

    // ============ Identity Key Update Tests ============

    function test_UpdateIdentityKey() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        bytes32 newIdentityKey = bytes32(uint256(999));
        bytes memory newSig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);

        vm.prank(alice);
        registry.updateIdentityKey(newIdentityKey, aliceSignedPreKey, newSig);

        MessagingKeyRegistry.PublicKeyBundle memory bundle = registry.getKeyBundle(alice);
        assertEq(bundle.identityKey, newIdentityKey);

        bytes32[] memory history = registry.getKeyHistory(alice);
        assertEq(history.length, 2);
        assertEq(history[0], aliceIdentityKey); // From registration
        assertEq(history[1], aliceIdentityKey); // From update
    }

    // ============ Agent Key Tests ============

    function test_RegisterAgentKey() public {
        uint256 agentId = 12345;
        bytes memory sig = _signAgentPreKey(agentId, aliceSignedPreKey, alice, alicePrivateKey);

        vm.prank(alice);
        registry.registerAgentKey(agentId, aliceIdentityKey, aliceSignedPreKey, sig);

        MessagingKeyRegistry.PublicKeyBundle memory bundle = registry.getAgentKeyBundle(agentId);

        assertEq(bundle.identityKey, aliceIdentityKey);
        assertTrue(bundle.isActive);
        assertEq(registry.agentKeyOwner(agentId), alice);
    }

    function test_RevokeAgentKey() public {
        uint256 agentId = 12345;
        bytes memory sig = _signAgentPreKey(agentId, aliceSignedPreKey, alice, alicePrivateKey);

        vm.prank(alice);
        registry.registerAgentKey(agentId, aliceIdentityKey, aliceSignedPreKey, sig);

        vm.prank(alice);
        registry.revokeAgentKey(agentId);

        MessagingKeyRegistry.PublicKeyBundle memory bundle = registry.getAgentKeyBundle(agentId);
        assertFalse(bundle.isActive);
    }

    function test_OnlyOwnerCanRevokeAgentKey() public {
        uint256 agentId = 12345;
        bytes memory sig = _signAgentPreKey(agentId, aliceSignedPreKey, alice, alicePrivateKey);

        vm.prank(alice);
        registry.registerAgentKey(agentId, aliceIdentityKey, aliceSignedPreKey, sig);

        vm.expectRevert(MessagingKeyRegistry.Unauthorized.selector);
        vm.prank(bob);
        registry.revokeAgentKey(agentId);
    }

    // ============ Batch Query Tests ============

    function test_GetKeyBundles() public {
        bytes memory aliceSig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, aliceSig);

        bytes memory bobSig = _signPreKey(bobSignedPreKey, bob, bobPrivateKey);
        vm.prank(bob);
        registry.registerKeyBundle(bobIdentityKey, bobSignedPreKey, bobSig);

        address[] memory users = new address[](2);
        users[0] = alice;
        users[1] = bob;

        MessagingKeyRegistry.PublicKeyBundle[] memory bundles = registry.getKeyBundles(users);

        assertEq(bundles.length, 2);
        assertEq(bundles[0].identityKey, aliceIdentityKey);
        assertEq(bundles[1].identityKey, bobIdentityKey);
    }

    // ============ Pre-Key Rotation Check Tests ============

    function test_NeedsPreKeyRotation() public {
        bytes memory sig = _signPreKey(aliceSignedPreKey, alice, alicePrivateKey);
        vm.prank(alice);
        registry.registerKeyBundle(aliceIdentityKey, aliceSignedPreKey, sig);

        assertFalse(registry.needsPreKeyRotation(alice));

        // Fast forward 8 days
        vm.warp(block.timestamp + 8 days);

        assertTrue(registry.needsPreKeyRotation(alice));
    }

    function test_Version() public view {
        assertEq(registry.version(), "1.2.0");
    }

    // ============ Helpers ============

    function _signAgentPreKey(uint256 agentId, bytes32 preKey, address user, uint256 privateKey)
        internal
        view
        returns (bytes memory)
    {
        bytes32 message = keccak256(abi.encodePacked(agentId, preKey, user, block.chainid));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }
}
