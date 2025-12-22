// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test, console2} from "forge-std/Test.sol";
import {Token, IBanManager} from "../../src/tokens/Token.sol";

contract MockBanManager is IBanManager {
    mapping(address => bool) public banned;

    function setBanned(address account, bool status) external {
        banned[account] = status;
    }

    function isAddressBanned(address target) external view returns (bool) {
        return banned[target];
    }
}

contract TokenTest is Test {
    Token public token;
    MockBanManager public banManager;

    address public owner = address(1);
    address public user1 = address(2);
    address public user2 = address(3);
    address public treasury = address(4);
    address public creator = address(5);
    address public rewardPool = address(6);

    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 10**18;
    uint256 public constant MAX_SUPPLY = 10_000_000_000 * 10**18;

    function _getDomainSeparator() internal view returns (bytes32) {
        (,string memory name, string memory version,,,,) = token.eip712Domain();
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                block.chainid,
                address(token)
            )
        );
    }

    function setUp() public {
        vm.startPrank(owner);

        banManager = new MockBanManager();

        token = new Token(
            "Test Token",
            "TEST",
            INITIAL_SUPPLY,
            owner,
            MAX_SUPPLY,
            true // home chain
        );

        vm.stopPrank();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              BASIC TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_InitialState() public view {
        assertEq(token.name(), "Test Token");
        assertEq(token.symbol(), "TEST");
        assertEq(token.decimals(), 18);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY);
    }

    function test_Transfer() public {
        uint256 amount = 1000 * 10**18;

        vm.prank(owner);
        token.transfer(user1, amount);

        assertEq(token.balanceOf(user1), amount);
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY - amount);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              FEE TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_SetFees() public {
        vm.prank(owner);
        token.setFees(
            100,  // 1% creator
            100,  // 1% holder
            50,   // 0.5% treasury
            50,   // 0.5% burn
            25,   // 0.25% LP
            creator,
            rewardPool,
            treasury
        );

        assertEq(token.totalFeeBps(), 300); // 3% total
    }

    function test_TransferWithFees() public {
        vm.startPrank(owner);

        // Setup fees
        token.setFees(100, 100, 50, 50, 0, creator, rewardPool, treasury);

        // Transfer to non-exempt user
        token.transfer(user1, 10000 * 10**18);
        vm.stopPrank();

        // User1 transfers to user2, fees should apply
        vm.prank(user1);
        token.transfer(user2, 1000 * 10**18);

        // 3% fee = 30 tokens
        uint256 expectedReceived = 970 * 10**18;
        assertEq(token.balanceOf(user2), expectedReceived);

        // Check fee distribution
        assertEq(token.balanceOf(creator), 10 * 10**18); // 1%
        assertEq(token.balanceOf(rewardPool), 10 * 10**18); // 1%
        assertEq(token.balanceOf(treasury), 5 * 10**18); // 0.5%
        // 0.5% burned = 5 tokens
    }

    function test_FeeExempt() public {
        vm.startPrank(owner);

        token.setFees(100, 100, 50, 50, 0, creator, rewardPool, treasury);
        token.setFeeExempt(user1, true);
        token.transfer(user1, 10000 * 10**18);

        vm.stopPrank();

        // Transfer from exempt user - no fees
        vm.prank(user1);
        token.transfer(user2, 1000 * 10**18);

        assertEq(token.balanceOf(user2), 1000 * 10**18);
    }

    function test_MaxFees() public {
        vm.prank(owner);
        vm.expectRevert(Token.InvalidFeeConfig.selector);
        token.setFees(1000, 1000, 500, 100, 0, creator, rewardPool, treasury); // 26% > 25%
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              BAN TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_BanEnforcement() public {
        vm.startPrank(owner);

        token.setBanManager(address(banManager));
        token.setConfig(0, 0, true, false, false);
        token.transfer(user1, 1000 * 10**18);

        vm.stopPrank();

        // Ban user1
        banManager.setBanned(user1, true);

        // Transfer from banned user should fail
        vm.prank(user1);
        vm.expectRevert(abi.encodeWithSelector(Token.BannedUser.selector, user1));
        token.transfer(user2, 100 * 10**18);
    }

    function test_BanExempt() public {
        vm.startPrank(owner);

        token.setBanManager(address(banManager));
        token.setConfig(0, 0, true, false, false);
        token.setBanExempt(user2, true);
        token.transfer(user1, 1000 * 10**18);

        vm.stopPrank();

        banManager.setBanned(user1, true);

        // Transfer TO ban-exempt address should work
        vm.prank(user1);
        token.transfer(user2, 100 * 10**18);

        assertEq(token.balanceOf(user2), 100 * 10**18);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              LIMIT TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_MaxWallet() public {
        vm.startPrank(owner);

        // 1% max wallet
        token.setConfig(100, 0, false, false, false);
        token.setLimitExempt(user1, false);

        vm.stopPrank();

        uint256 maxWallet = token.maxWallet();
        assertEq(maxWallet, INITIAL_SUPPLY / 100);

        // Transfer up to max should work
        vm.prank(owner);
        token.transfer(user1, maxWallet);

        assertEq(token.balanceOf(user1), maxWallet);

        // Any more should fail
        vm.prank(owner);
        vm.expectRevert();
        token.transfer(user1, 1);
    }

    function test_MaxTransaction() public {
        vm.startPrank(owner);

        // 0.5% max tx
        token.setConfig(0, 50, false, false, false);
        token.transfer(user1, INITIAL_SUPPLY / 10);

        vm.stopPrank();

        uint256 maxTx = token.maxTransaction();
        assertEq(maxTx, INITIAL_SUPPLY / 200);

        // Transfer over max should fail
        vm.prank(user1);
        vm.expectRevert();
        token.transfer(user2, maxTx + 1);

        // Transfer at max should work
        vm.prank(user1);
        token.transfer(user2, maxTx);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              MINTING TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Mint() public {
        uint256 mintAmount = 1000 * 10**18;

        vm.prank(owner);
        token.mint(user1, mintAmount);

        assertEq(token.balanceOf(user1), mintAmount);
        assertEq(token.totalSupply(), INITIAL_SUPPLY + mintAmount);
    }

    function test_MintExceedsMax() public {
        uint256 remaining = MAX_SUPPLY - INITIAL_SUPPLY;

        vm.prank(owner);
        vm.expectRevert(Token.ExceedsMaxSupply.selector);
        token.mint(user1, remaining + 1);
    }

    function test_MintOnlyOwner() public {
        vm.prank(user1);
        vm.expectRevert();
        token.mint(user1, 1000 * 10**18);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              FAUCET TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Faucet() public {
        vm.startPrank(owner);
        token.setConfig(0, 0, false, false, true);
        vm.stopPrank();

        // Need to warp past initial cooldown since owner claimed in constructor
        vm.warp(block.timestamp + token.faucetCooldown() + 1);

        vm.prank(user1);
        token.faucet();

        assertEq(token.balanceOf(user1), token.faucetAmount());
    }

    function test_FaucetCooldown() public {
        vm.startPrank(owner);
        token.setConfig(0, 0, false, false, true);
        vm.stopPrank();

        vm.warp(block.timestamp + token.faucetCooldown() + 1);

        vm.startPrank(user1);
        token.faucet();

        vm.expectRevert();
        token.faucet();

        vm.warp(block.timestamp + token.faucetCooldown() + 1);
        token.faucet();
        vm.stopPrank();

        assertEq(token.balanceOf(user1), token.faucetAmount() * 2);
    }

    function test_FaucetDisabled() public {
        vm.prank(user1);
        vm.expectRevert(Token.FaucetDisabled.selector);
        token.faucet();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              PAUSE TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_Pause() public {
        vm.startPrank(owner);
        // First transfer some tokens to user1 while not paused
        token.transfer(user1, 1000 * 10**18);
        // Then pause
        token.setConfig(0, 0, false, true, false);
        vm.stopPrank();

        vm.prank(user1);
        vm.expectRevert(Token.TransfersPaused.selector);
        token.transfer(user2, 100 * 10**18);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              EIP-3009 TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_TransferWithAuthorization() public {
        uint256 privateKey = 0xBEEF;
        address signer = vm.addr(privateKey);

        vm.prank(owner);
        token.transfer(signer, 1000 * 10**18);

        uint256 value = 100 * 10**18;
        uint256 validAfter = 0;
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 nonce = keccak256("test-nonce");

        bytes32 structHash = keccak256(abi.encode(
            token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH(),
            signer,
            user1,
            value,
            validAfter,
            validBefore,
            nonce
        ));

        bytes32 digest = keccak256(abi.encodePacked(
            "\x19\x01",
            _getDomainSeparator(),
            structHash
        ));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(privateKey, digest);
        bytes memory signature = abi.encodePacked(r, s, v);

        vm.prank(user2); // Any relayer can submit
        token.transferWithAuthorization(
            signer,
            user1,
            value,
            validAfter,
            validBefore,
            nonce,
            signature
        );

        assertEq(token.balanceOf(user1), value);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //                              VIEW TESTS
    // ═══════════════════════════════════════════════════════════════════════════

    function test_CirculatingSupply() public {
        vm.startPrank(owner);

        token.setFees(0, 0, 0, 100, 0, address(0), address(0), address(0)); // 1% burn
        token.transfer(user1, 10000 * 10**18);

        vm.stopPrank();

        vm.prank(user1);
        token.transfer(user2, 1000 * 10**18);

        // 1% of 1000 = 10 burned
        assertTrue(token.totalBurned() > 0);
        assertTrue(token.circulatingSupply() < INITIAL_SUPPLY);
    }

    function test_Version() public view {
        assertEq(token.version(), "2.0.0");
    }
}
