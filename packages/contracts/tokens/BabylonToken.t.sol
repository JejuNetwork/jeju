// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {BabylonToken} from "../../src/tokens/BabylonToken.sol";

contract BabylonTokenTest is Test {
    BabylonToken public token;
    address public owner;
    address public feeDistributor;
    address public treasury;
    address public creator;
    address public user1;
    address public user2;

    uint256 public constant INITIAL_SUPPLY = 1_000_000_000 * 1e18;

    function setUp() public {
        owner = makeAddr("owner");
        feeDistributor = makeAddr("feeDistributor");
        treasury = makeAddr("treasury");
        creator = makeAddr("creator");
        user1 = makeAddr("user1");
        user2 = makeAddr("user2");

        vm.prank(owner);
        token = new BabylonToken(
            "Babylon Token",
            "BABYLON",
            INITIAL_SUPPLY,
            owner,
            true // isHomeChain
        );
    }

    // ==========================================================================
    // DEPLOYMENT TESTS
    // ==========================================================================

    function test_Deploy_SetsCorrectName() public view {
        assertEq(token.name(), "Babylon Token");
    }

    function test_Deploy_SetsCorrectSymbol() public view {
        assertEq(token.symbol(), "BABYLON");
    }

    function test_Deploy_MintsInitialSupplyToOwner() public view {
        assertEq(token.balanceOf(owner), INITIAL_SUPPLY);
        assertEq(token.totalSupply(), INITIAL_SUPPLY);
    }

    function test_Deploy_SetsOwner() public view {
        assertEq(token.owner(), owner);
    }

    function test_Deploy_IsHomeChain() public view {
        assertTrue(token.isHomeChain());
    }

    function test_Deploy_NoSupplyOnSyntheticChain() public {
        vm.prank(owner);
        BabylonToken syntheticToken = new BabylonToken(
            "Babylon Token",
            "BABYLON",
            INITIAL_SUPPLY,
            owner,
            false // not home chain
        );
        assertEq(syntheticToken.totalSupply(), 0);
    }

    // ==========================================================================
    // INITIALIZATION TESTS
    // ==========================================================================

    function test_Initialize_SetsFeeDistributor() public {
        vm.prank(owner);
        token.initialize(
            feeDistributor,
            treasury,
            creator,
            40, // holders fee bps
            20, // creators fee bps
            20, // treasury fee bps
            10, // burn fee bps
            2, // max wallet percent
            1 // max tx percent
        );

        assertEq(token.feeDistributor(), feeDistributor);
        assertEq(token.treasury(), treasury);
        assertEq(token.creatorWallet(), creator);
        assertEq(token.holdersFeeBps(), 40);
        assertEq(token.creatorsFeeBps(), 20);
        assertEq(token.treasuryFeeBps(), 20);
        assertEq(token.burnFeeBps(), 10);
    }

    function test_Initialize_RevertsIfAlreadyInitialized() public {
        vm.startPrank(owner);
        token.initialize(feeDistributor, treasury, creator, 40, 20, 20, 10, 2, 1);

        vm.expectRevert(BabylonToken.AlreadyInitialized.selector);
        token.initialize(feeDistributor, treasury, creator, 40, 20, 20, 10, 2, 1);
        vm.stopPrank();
    }

    function test_Initialize_RevertsIfFeeTooHigh() public {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(BabylonToken.InvalidFeePercent.selector, 3000));
        token.initialize(
            feeDistributor,
            treasury,
            creator,
            1000, // 10%
            1000, // 10%
            500, // 5%
            500, // 5% = 30% total > 25% max
            2,
            1
        );
    }

    // ==========================================================================
    // TRANSFER TESTS
    // ==========================================================================

    function test_Transfer_WorksWithoutFees() public {
        vm.prank(owner);
        token.transfer(user1, 1000 * 1e18);

        assertEq(token.balanceOf(user1), 1000 * 1e18);
    }

    function test_Transfer_AppliesFees() public {
        // Initialize with 1% total fee
        vm.prank(owner);
        token.initialize(feeDistributor, treasury, creator, 40, 20, 20, 20, 0, 0);

        // Transfer to user1 first (owner is exempt)
        vm.prank(owner);
        token.transfer(user1, 10000 * 1e18);

        // Now transfer from user1 to user2 (should incur fees)
        uint256 transferAmount = 1000 * 1e18;
        uint256 expectedFee = (transferAmount * 100) / 10000; // 1% fee
        uint256 expectedReceived = transferAmount - expectedFee;

        vm.prank(user1);
        token.transfer(user2, transferAmount);

        assertEq(token.balanceOf(user2), expectedReceived);
    }

    // ==========================================================================
    // MINTER/BURNER TESTS
    // ==========================================================================

    function test_SetMinter_AuthorizesMinting() public {
        address minter = makeAddr("minter");

        vm.prank(owner);
        token.setMinter(minter, true);

        assertTrue(token.authorizedMinters(minter));

        vm.prank(minter);
        token.mint(user1, 1000 * 1e18);

        assertEq(token.balanceOf(user1), 1000 * 1e18);
    }

    function test_Mint_RevertsIfNotAuthorized() public {
        address notMinter = makeAddr("notMinter");

        vm.prank(notMinter);
        vm.expectRevert(BabylonToken.NotAuthorizedMinter.selector);
        token.mint(user1, 1000 * 1e18);
    }

    function test_SetBurner_AuthorizesBurning() public {
        address burner = makeAddr("burner");

        // Give user1 some tokens
        vm.prank(owner);
        token.transfer(user1, 1000 * 1e18);

        // Authorize burner
        vm.prank(owner);
        token.setBurner(burner, true);

        // Burner can burn from user1 without allowance
        vm.prank(burner);
        token.burnFrom(user1, 500 * 1e18);

        assertEq(token.balanceOf(user1), 500 * 1e18);
    }

    // ==========================================================================
    // MAX LIMITS TESTS
    // ==========================================================================

    function test_MaxWallet_EnforcedOnTransfer() public {
        vm.startPrank(owner);
        token.initialize(feeDistributor, treasury, creator, 0, 0, 0, 0, 1, 0); // 1% max wallet

        uint256 maxWalletAmount = (INITIAL_SUPPLY * 1) / 100;

        // This should fail - exceeds max wallet
        vm.expectRevert(
            abi.encodeWithSelector(BabylonToken.ExceedsMaxWallet.selector, maxWalletAmount + 1, maxWalletAmount)
        );
        token.transfer(user1, maxWalletAmount + 1);

        vm.stopPrank();
    }

    function test_MaxTx_EnforcedOnTransfer() public {
        vm.startPrank(owner);
        token.initialize(feeDistributor, treasury, creator, 0, 0, 0, 0, 0, 1); // 1% max tx, no max wallet

        // Transfer to user1 first
        token.transfer(user1, INITIAL_SUPPLY / 2);
        vm.stopPrank();

        // Max tx is 1% of total supply
        uint256 maxTxAmount = (token.totalSupply() * 1) / 100;

        // This should fail - exceeds max tx
        vm.prank(user1);
        vm.expectRevert(
            abi.encodeWithSelector(BabylonToken.ExceedsMaxTransaction.selector, maxTxAmount + 1, maxTxAmount)
        );
        token.transfer(user2, maxTxAmount + 1);
    }

    // ==========================================================================
    // PAUSE TESTS
    // ==========================================================================

    function test_Pause_BlocksTransfers() public {
        vm.prank(owner);
        token.transfer(user1, 1000 * 1e18);

        vm.prank(owner);
        token.setPaused(true);

        vm.prank(user1);
        vm.expectRevert(BabylonToken.TransfersPaused.selector);
        token.transfer(user2, 100 * 1e18);
    }

    function test_Unpause_AllowsTransfers() public {
        vm.startPrank(owner);
        token.transfer(user1, 1000 * 1e18);
        token.setPaused(true);
        token.setPaused(false);
        vm.stopPrank();

        vm.prank(user1);
        token.transfer(user2, 100 * 1e18);

        assertEq(token.balanceOf(user2), 100 * 1e18);
    }
}

