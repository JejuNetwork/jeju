// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import {AssetLib} from "../../src/libraries/AssetLib.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockERC721 is ERC721 {
    constructor() ERC721("MockNFT", "MNFT") {}

    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}

contract MockERC1155 is ERC1155 {
    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}

contract AssetLibHarness is IERC721Receiver, IERC1155Receiver {
    using AssetLib for AssetLib.Asset;

    function transferFrom(AssetLib.Asset memory asset, address from, address to) external {
        AssetLib.transferFrom(asset, from, to);
    }

    function safeTransfer(AssetLib.Asset memory asset, address to) external {
        AssetLib.safeTransfer(asset, to);
    }

    function validateOwnership(AssetLib.Asset memory asset, address owner) external view returns (bool) {
        return AssetLib.validateOwnership(asset, owner);
    }

    function validateApproval(AssetLib.Asset memory asset, address owner, address spender)
        external
        view
        returns (bool)
    {
        return AssetLib.validateApproval(asset, owner, spender);
    }

    function requireOwnershipAndApproval(AssetLib.Asset memory asset, address owner, address spender) external view {
        AssetLib.requireOwnershipAndApproval(asset, owner, spender);
    }

    function balanceOf(AssetLib.Asset memory asset, address owner) external view returns (uint256) {
        return AssetLib.balanceOf(asset, owner);
    }

    function erc20(address token, uint256 amount) external pure returns (AssetLib.Asset memory) {
        return AssetLib.erc20(token, amount);
    }

    function erc721(address token, uint256 tokenId) external pure returns (AssetLib.Asset memory) {
        return AssetLib.erc721(token, tokenId);
    }

    function erc1155(address token, uint256 tokenId, uint256 amount) external pure returns (AssetLib.Asset memory) {
        return AssetLib.erc1155(token, tokenId, amount);
    }

    function native(uint256 amount) external pure returns (AssetLib.Asset memory) {
        return AssetLib.native(amount);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    receive() external payable {}
}

contract AssetLibTest is Test {
    AssetLibHarness harness;
    MockERC20 erc20Token;
    MockERC721 erc721Token;
    MockERC1155 erc1155Token;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        harness = new AssetLibHarness();
        erc20Token = new MockERC20();
        erc721Token = new MockERC721();
        erc1155Token = new MockERC1155();

        vm.deal(alice, 100 ether);
        vm.deal(address(harness), 100 ether);
    }

    // ============ Factory Tests ============

    function test_erc20_factory() public view {
        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 1000);
        assertEq(uint8(asset.assetType), uint8(AssetLib.AssetType.ERC20));
        assertEq(asset.token, address(erc20Token));
        assertEq(asset.tokenId, 0);
        assertEq(asset.amount, 1000);
    }

    function test_erc721_factory() public view {
        AssetLib.Asset memory asset = harness.erc721(address(erc721Token), 42);
        assertEq(uint8(asset.assetType), uint8(AssetLib.AssetType.ERC721));
        assertEq(asset.token, address(erc721Token));
        assertEq(asset.tokenId, 42);
        assertEq(asset.amount, 1);
    }

    function test_erc1155_factory() public view {
        AssetLib.Asset memory asset = harness.erc1155(address(erc1155Token), 5, 100);
        assertEq(uint8(asset.assetType), uint8(AssetLib.AssetType.ERC1155));
        assertEq(asset.token, address(erc1155Token));
        assertEq(asset.tokenId, 5);
        assertEq(asset.amount, 100);
    }

    function test_native_factory() public view {
        AssetLib.Asset memory asset = harness.native(1 ether);
        assertEq(uint8(asset.assetType), uint8(AssetLib.AssetType.NATIVE));
        assertEq(asset.token, address(0));
        assertEq(asset.tokenId, 0);
        assertEq(asset.amount, 1 ether);
    }

    // ============ ERC20 Transfer Tests ============

    function test_erc20_transferFrom() public {
        erc20Token.mint(alice, 1000);

        vm.prank(alice);
        erc20Token.approve(address(harness), 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);
        harness.transferFrom(asset, alice, bob);

        assertEq(erc20Token.balanceOf(alice), 500);
        assertEq(erc20Token.balanceOf(bob), 500);
    }

    function test_erc20_safeTransfer() public {
        erc20Token.mint(address(harness), 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);
        harness.safeTransfer(asset, bob);

        assertEq(erc20Token.balanceOf(address(harness)), 500);
        assertEq(erc20Token.balanceOf(bob), 500);
    }

    // ============ ERC721 Transfer Tests ============

    function test_erc721_transferFrom() public {
        erc721Token.mint(alice, 1);

        vm.prank(alice);
        erc721Token.approve(address(harness), 1);

        AssetLib.Asset memory asset = harness.erc721(address(erc721Token), 1);
        harness.transferFrom(asset, alice, bob);

        assertEq(erc721Token.ownerOf(1), bob);
    }

    function test_erc721_safeTransfer() public {
        erc721Token.mint(address(harness), 1);

        AssetLib.Asset memory asset = harness.erc721(address(erc721Token), 1);
        harness.safeTransfer(asset, bob);

        assertEq(erc721Token.ownerOf(1), bob);
    }

    // ============ ERC1155 Transfer Tests ============

    function test_erc1155_transferFrom() public {
        erc1155Token.mint(alice, 1, 100);

        vm.prank(alice);
        erc1155Token.setApprovalForAll(address(harness), true);

        AssetLib.Asset memory asset = harness.erc1155(address(erc1155Token), 1, 50);
        harness.transferFrom(asset, alice, address(harness));

        assertEq(erc1155Token.balanceOf(alice, 1), 50);
        assertEq(erc1155Token.balanceOf(address(harness), 1), 50);
    }

    function test_erc1155_safeTransfer() public {
        erc1155Token.mint(address(harness), 1, 100);

        AssetLib.Asset memory asset = harness.erc1155(address(erc1155Token), 1, 50);
        harness.safeTransfer(asset, alice);

        assertEq(erc1155Token.balanceOf(address(harness), 1), 50);
        assertEq(erc1155Token.balanceOf(alice, 1), 50);
    }

    // ============ Native ETH Transfer Tests ============

    function test_native_safeTransfer() public {
        uint256 bobBalanceBefore = bob.balance;

        AssetLib.Asset memory asset = harness.native(1 ether);
        harness.safeTransfer(asset, bob);

        assertEq(bob.balance, bobBalanceBefore + 1 ether);
    }

    // ============ Validation Tests ============

    function test_validateOwnership_erc20() public {
        erc20Token.mint(alice, 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);
        assertTrue(harness.validateOwnership(asset, alice));
        assertFalse(harness.validateOwnership(asset, bob));
    }

    function test_validateOwnership_erc721() public {
        erc721Token.mint(alice, 1);

        AssetLib.Asset memory asset = harness.erc721(address(erc721Token), 1);
        assertTrue(harness.validateOwnership(asset, alice));
        assertFalse(harness.validateOwnership(asset, bob));
    }

    function test_validateOwnership_erc1155() public {
        erc1155Token.mint(alice, 1, 100);

        AssetLib.Asset memory asset = harness.erc1155(address(erc1155Token), 1, 50);
        assertTrue(harness.validateOwnership(asset, alice));
        assertFalse(harness.validateOwnership(asset, bob));
    }

    function test_validateOwnership_native() public {
        AssetLib.Asset memory asset = harness.native(1 ether);
        assertTrue(harness.validateOwnership(asset, alice));
        assertFalse(harness.validateOwnership(asset, bob)); // bob has 0 ETH
    }

    function test_validateApproval_erc20() public {
        erc20Token.mint(alice, 1000);

        vm.prank(alice);
        erc20Token.approve(address(harness), 500);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);
        assertTrue(harness.validateApproval(asset, alice, address(harness)));
        assertFalse(harness.validateApproval(asset, alice, bob));
    }

    function test_validateApproval_erc721() public {
        erc721Token.mint(alice, 1);

        vm.prank(alice);
        erc721Token.approve(address(harness), 1);

        AssetLib.Asset memory asset = harness.erc721(address(erc721Token), 1);
        assertTrue(harness.validateApproval(asset, alice, address(harness)));
        assertFalse(harness.validateApproval(asset, alice, bob));
    }

    function test_validateApproval_native_always_true() public view {
        AssetLib.Asset memory asset = harness.native(1 ether);
        assertTrue(harness.validateApproval(asset, alice, address(harness)));
    }

    function test_requireOwnershipAndApproval_success() public {
        erc20Token.mint(alice, 1000);

        vm.prank(alice);
        erc20Token.approve(address(harness), 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);
        harness.requireOwnershipAndApproval(asset, alice, address(harness));
    }

    function test_requireOwnershipAndApproval_revert_no_balance() public {
        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);

        vm.expectRevert(AssetLib.InsufficientBalance.selector);
        harness.requireOwnershipAndApproval(asset, alice, address(harness));
    }

    function test_requireOwnershipAndApproval_revert_no_approval() public {
        erc20Token.mint(alice, 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);

        vm.expectRevert(AssetLib.AssetNotApproved.selector);
        harness.requireOwnershipAndApproval(asset, alice, address(harness));
    }

    function test_requireOwnershipAndApproval_erc721_revert_not_owner() public {
        erc721Token.mint(bob, 1);

        AssetLib.Asset memory asset = harness.erc721(address(erc721Token), 1);

        vm.expectRevert(AssetLib.NotAssetOwner.selector);
        harness.requireOwnershipAndApproval(asset, alice, address(harness));
    }

    // ============ Balance Tests ============

    function test_balanceOf_erc20() public {
        erc20Token.mint(alice, 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 0);
        assertEq(harness.balanceOf(asset, alice), 1000);
    }

    function test_balanceOf_erc721() public {
        erc721Token.mint(alice, 1);

        AssetLib.Asset memory asset = harness.erc721(address(erc721Token), 1);
        assertEq(harness.balanceOf(asset, alice), 1);
        assertEq(harness.balanceOf(asset, bob), 0);
    }

    function test_balanceOf_native() public view {
        AssetLib.Asset memory asset = harness.native(0);
        assertEq(harness.balanceOf(asset, alice), 100 ether);
    }

    // ============ Revert Tests ============

    function test_transferFrom_revert_invalid_recipient() public {
        erc20Token.mint(alice, 1000);

        vm.prank(alice);
        erc20Token.approve(address(harness), 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);

        vm.expectRevert(AssetLib.InvalidRecipient.selector);
        harness.transferFrom(asset, alice, address(0));
    }

    function test_safeTransfer_revert_invalid_recipient() public {
        erc20Token.mint(address(harness), 1000);

        AssetLib.Asset memory asset = harness.erc20(address(erc20Token), 500);

        vm.expectRevert(AssetLib.InvalidRecipient.selector);
        harness.safeTransfer(asset, address(0));
    }
}
