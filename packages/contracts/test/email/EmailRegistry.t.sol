// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {EmailRegistry} from "../../src/email/EmailRegistry.sol";
import {IEmailRegistry} from "../../src/email/IEmailRegistry.sol";

contract MockJNS {
    mapping(bytes32 => address) public owners;

    function owner(bytes32 node) external view returns (address) {
        return owners[node];
    }

    function setOwner(bytes32 node, address _owner) external {
        owners[node] = _owner;
    }
}

contract EmailRegistryTest is Test {
    EmailRegistry public registry;
    MockJNS public jns;

    address public owner;
    address public user1;
    address public user2;
    address public relay;

    bytes32 public constant JNS_NODE_1 = keccak256("user1.jeju");
    bytes32 public constant JNS_NODE_2 = keccak256("user2.jeju");
    bytes32 public constant PUBLIC_KEY_HASH = keccak256("pubkey123");

    function setUp() public {
        owner = makeAddr("owner");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");
        relay = makeAddr("relay");

        vm.deal(owner, 100 ether);
        vm.deal(user1, 100 ether);
        vm.deal(user2, 100 ether);

        jns = new MockJNS();
        jns.setOwner(JNS_NODE_1, user1);
        jns.setOwner(JNS_NODE_2, user2);

        vm.prank(owner);
        registry = new EmailRegistry(address(jns), address(0), "jeju.mail", owner);

        vm.prank(owner);
        registry.setAuthorizedRelay(relay, true);
    }

    // ============ Registration Tests ============

    function test_RegisterFreeAccount() public {
        address[] memory relays = new address[](1);
        relays[0] = relay;

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(account.owner, user1);
        assertEq(account.publicKeyHash, PUBLIC_KEY_HASH);
        assertEq(uint8(account.tier), uint8(IEmailRegistry.AccountTier.FREE));
        assertEq(uint8(account.status), uint8(IEmailRegistry.AccountStatus.ACTIVE));
    }

    function test_RegisterWithStake() public {
        address[] memory relays = new address[](1);
        relays[0] = relay;

        vm.prank(user1);
        registry.registerWithStake{value: 0.1 ether}(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(account.owner, user1);
        assertEq(uint8(account.tier), uint8(IEmailRegistry.AccountTier.STAKED));
        assertEq(account.stakedAmount, 0.1 ether);
    }

    function test_Register_RevertIfNotJNSOwner() public {
        address[] memory relays = new address[](0);

        vm.prank(user2);
        vm.expectRevert(EmailRegistry.NotJNSOwner.selector);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);
    }

    function test_Register_RevertIfAlreadyRegistered() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(user1);
        vm.expectRevert(EmailRegistry.AlreadyRegistered.selector);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);
    }

    function test_RegisterWithStake_RevertIfInsufficientStake() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        vm.expectRevert(EmailRegistry.InsufficientStake.selector);
        registry.registerWithStake{value: 0.01 ether}(JNS_NODE_1, PUBLIC_KEY_HASH, relays);
    }

    // ============ Account Management Tests ============

    function test_UpdateAccount() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        bytes32 newPubKeyHash = keccak256("newpubkey456");
        address[] memory newRelays = new address[](1);
        newRelays[0] = relay;

        vm.prank(user1);
        registry.updateAccount(newPubKeyHash, newRelays);

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(account.publicKeyHash, newPubKeyHash);
    }

    function test_Stake() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        IEmailRegistry.EmailAccount memory accountBefore = registry.getAccount(user1);
        assertEq(uint8(accountBefore.tier), uint8(IEmailRegistry.AccountTier.FREE));

        vm.prank(user1);
        registry.stake{value: 0.2 ether}();

        IEmailRegistry.EmailAccount memory accountAfter = registry.getAccount(user1);
        assertEq(uint8(accountAfter.tier), uint8(IEmailRegistry.AccountTier.STAKED));
        assertEq(accountAfter.stakedAmount, 0.2 ether);
    }

    function test_RequestAndUnstake() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.registerWithStake{value: 0.2 ether}(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(user1);
        registry.requestUnstake();

        // Move time forward past cooldown
        vm.warp(block.timestamp + 7 days + 1);

        uint256 balanceBefore = user1.balance;

        vm.prank(user1);
        registry.unstake();

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(uint8(account.tier), uint8(IEmailRegistry.AccountTier.FREE));
        assertEq(account.stakedAmount, 0);
        assertEq(user1.balance, balanceBefore + 0.2 ether);
    }

    function test_Unstake_RevertIfCooldownActive() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.registerWithStake{value: 0.2 ether}(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(user1);
        registry.requestUnstake();

        // Move time forward but not past cooldown
        vm.warp(block.timestamp + 3 days);

        vm.prank(user1);
        vm.expectRevert(EmailRegistry.UnstakeCooldownActive.selector);
        registry.unstake();
    }

    // ============ Config Tests ============

    function test_SetConfig() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.registerWithStake{value: 0.1 ether}(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        IEmailRegistry.EmailConfig memory config = IEmailRegistry.EmailConfig({
            allowExternalInbound: false,
            allowExternalOutbound: true,
            encryptionRequired: true,
            spamFilterLevel: 3,
            autoForwardAddress: ""
        });

        vm.prank(user1);
        registry.setConfig(config);

        IEmailRegistry.EmailConfig memory savedConfig = registry.getConfig(user1);
        assertFalse(savedConfig.allowExternalInbound);
        assertTrue(savedConfig.encryptionRequired);
    }

    function test_SetConfig_RevertIfFreeAccountEnablesExternal() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        IEmailRegistry.EmailConfig memory config = IEmailRegistry.EmailConfig({
            allowExternalInbound: true,
            allowExternalOutbound: true, // Not allowed for free tier
            encryptionRequired: false,
            spamFilterLevel: 2,
            autoForwardAddress: ""
        });

        vm.prank(user1);
        vm.expectRevert(EmailRegistry.ExternalNotAllowed.selector);
        registry.setConfig(config);
    }

    // ============ Usage Tracking Tests ============

    function test_RecordEmailSent() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(relay);
        registry.recordEmailSent(user1, 1024, false);

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(account.emailsSentToday, 1);
        assertEq(account.quotaUsedBytes, 1024);
    }

    function test_RecordEmailSent_RevertIfExternal_FreeAccount() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(relay);
        vm.expectRevert(EmailRegistry.ExternalNotAllowed.selector);
        registry.recordEmailSent(user1, 1024, true);
    }

    function test_RecordEmailSent_RevertIfRateLimitExceeded() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        // Send 50 emails (free tier limit)
        for (uint256 i = 0; i < 50; i++) {
            vm.prank(relay);
            registry.recordEmailSent(user1, 100, false);
        }

        // 51st should fail
        vm.prank(relay);
        vm.expectRevert(EmailRegistry.RateLimitExceeded.selector);
        registry.recordEmailSent(user1, 100, false);
    }

    function test_RecordStorageChange() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(relay);
        registry.recordStorageChange(user1, 1000000);

        (uint256 used,) = registry.getQuota(user1);
        assertEq(used, 1000000);

        vm.prank(relay);
        registry.recordStorageChange(user1, -500000);

        (used,) = registry.getQuota(user1);
        assertEq(used, 500000);
    }

    // ============ Moderation Tests ============

    function test_SuspendAccount() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(owner);
        registry.suspendAccount(user1, "TOS violation");

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(uint8(account.status), uint8(IEmailRegistry.AccountStatus.SUSPENDED));
    }

    function test_BanAccount() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.registerWithStake{value: 0.2 ether}(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(owner);
        registry.banAccount(user1, "Spam abuse");

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(uint8(account.status), uint8(IEmailRegistry.AccountStatus.BANNED));
        assertEq(account.stakedAmount, 0); // Stake slashed
    }

    function test_RestoreAccount() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(owner);
        registry.suspendAccount(user1, "TOS violation");

        vm.prank(owner);
        registry.restoreAccount(user1);

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(uint8(account.status), uint8(IEmailRegistry.AccountStatus.ACTIVE));
    }

    // ============ Deactivation Tests ============

    function test_Deactivate() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.registerWithStake{value: 0.2 ether}(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        uint256 balanceBefore = user1.balance;

        vm.prank(user1);
        registry.deactivate();

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(uint8(account.status), uint8(IEmailRegistry.AccountStatus.INACTIVE));
        assertEq(user1.balance, balanceBefore + 0.2 ether); // Stake returned
    }

    // ============ View Functions Tests ============

    function test_GetAccountByJNS() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        IEmailRegistry.EmailAccount memory account = registry.getAccountByJNS(JNS_NODE_1);
        assertEq(account.owner, user1);
    }

    function test_CanSendExternal() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        assertFalse(registry.canSendExternal(user1));

        vm.prank(user1);
        registry.stake{value: 0.1 ether}();

        assertTrue(registry.canSendExternal(user1));
    }

    function test_GetRateLimit() public {
        address[] memory relays = new address[](0);

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        (uint256 sent, uint256 limit, uint256 resetsAt) = registry.getRateLimit(user1);
        assertEq(sent, 0);
        assertEq(limit, 50); // FREE_RATE_LIMIT
        assertTrue(resetsAt > block.timestamp);
    }

    // ============ Admin Functions Tests ============

    function test_PauseUnpause() public {
        vm.prank(owner);
        registry.pause();

        address[] memory relays = new address[](0);

        vm.prank(user1);
        vm.expectRevert();
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        vm.prank(owner);
        registry.unpause();

        vm.prank(user1);
        registry.register(JNS_NODE_1, PUBLIC_KEY_HASH, relays);

        IEmailRegistry.EmailAccount memory account = registry.getAccount(user1);
        assertEq(account.owner, user1);
    }
}
