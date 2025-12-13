// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../../src/launchpad/NFTLaunchpad.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

contract MockERC721 is ERC721 {
    uint256 private _tokenIdCounter;

    constructor() ERC721("Mock NFT", "MNFT") {}

    function mint(address to) external returns (uint256) {
        uint256 tokenId = _tokenIdCounter++;
        _mint(to, tokenId);
        return tokenId;
    }
}

contract MockERC1155 is ERC1155 {
    constructor() ERC1155("") {}

    function mint(address to, uint256 id, uint256 amount) external {
        _mint(to, id, amount, "");
    }
}

contract NFTLaunchpadTest is Test {
    NFTLaunchpad public nftLaunchpad;
    MockERC721 public mockERC721;
    MockERC1155 public mockERC1155;

    address public owner = address(0x1);
    address public creator = address(0x2);
    address public seller = address(0x3);
    address public buyer = address(0x4);
    address public communityVault = address(0x5);

    uint256 constant INITIAL_ETH = 100 ether;

    function setUp() public {
        vm.deal(owner, INITIAL_ETH);
        vm.deal(creator, INITIAL_ETH);
        vm.deal(seller, INITIAL_ETH);
        vm.deal(buyer, INITIAL_ETH);
        vm.deal(communityVault, 0);

        vm.prank(owner);
        nftLaunchpad = new NFTLaunchpad(communityVault, owner);

        mockERC721 = new MockERC721();
        mockERC1155 = new MockERC1155();
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         COLLECTION REGISTRATION
    // ═══════════════════════════════════════════════════════════════════════

    function test_RegisterCollection() public {
        vm.prank(creator);
        nftLaunchpad.registerCollection(
            address(mockERC721),
            8000, // 80% creator
            address(0) // Use default community vault
        );

        NFTLaunchpad.CollectionConfig memory config = nftLaunchpad.getCollectionConfig(address(mockERC721));
        assertTrue(config.registered);
        assertEq(config.creator, creator);
        assertEq(config.creatorFeeBps, 8000);
        assertEq(config.communityFeeBps, 2000);
        assertEq(config.communityVault, communityVault);
    }

    function test_RegisterCollectionWithCustomVault() public {
        address customVault = address(0x999);

        vm.prank(creator);
        nftLaunchpad.registerCollection(
            address(mockERC721),
            5000, // 50/50 split
            customVault
        );

        NFTLaunchpad.CollectionConfig memory config = nftLaunchpad.getCollectionConfig(address(mockERC721));
        assertEq(config.communityVault, customVault);
        assertEq(config.creatorFeeBps, 5000);
        assertEq(config.communityFeeBps, 5000);
    }

    function test_RegisterCollection100PercentCreator() public {
        vm.prank(creator);
        nftLaunchpad.registerCollection(
            address(mockERC721),
            10000, // 100% creator
            address(0)
        );

        NFTLaunchpad.CollectionConfig memory config = nftLaunchpad.getCollectionConfig(address(mockERC721));
        assertEq(config.creatorFeeBps, 10000);
        assertEq(config.communityFeeBps, 0);
    }

    function test_RegisterCollection100PercentCommunity() public {
        vm.prank(creator);
        nftLaunchpad.registerCollection(
            address(mockERC721),
            0, // 0% creator = 100% community
            address(0)
        );

        NFTLaunchpad.CollectionConfig memory config = nftLaunchpad.getCollectionConfig(address(mockERC721));
        assertEq(config.creatorFeeBps, 0);
        assertEq(config.communityFeeBps, 10000);
    }

    function test_UpdateCollectionFees() public {
        vm.startPrank(creator);
        nftLaunchpad.registerCollection(address(mockERC721), 8000, address(0));
        nftLaunchpad.updateCollectionFees(address(mockERC721), 6000);
        vm.stopPrank();

        NFTLaunchpad.CollectionConfig memory config = nftLaunchpad.getCollectionConfig(address(mockERC721));
        assertEq(config.creatorFeeBps, 6000);
        assertEq(config.communityFeeBps, 4000);
    }

    function test_OnlyCreatorCanUpdateFees() public {
        vm.prank(creator);
        nftLaunchpad.registerCollection(address(mockERC721), 8000, address(0));

        vm.prank(seller);
        vm.expectRevert(NFTLaunchpad.NotCollectionOwner.selector);
        nftLaunchpad.updateCollectionFees(address(mockERC721), 6000);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         LISTING TESTS
    // ═══════════════════════════════════════════════════════════════════════

    function test_CreateERC721Listing() public {
        // Mint NFT to seller
        uint256 tokenId = mockERC721.mint(seller);

        // Approve marketplace
        vm.prank(seller);
        mockERC721.approve(address(nftLaunchpad), tokenId);

        // Create listing
        vm.prank(seller);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC721,
            address(mockERC721),
            tokenId,
            1,
            NFTLaunchpad.Currency.ETH,
            address(0),
            1 ether
        );

        NFTLaunchpad.Listing memory listing = nftLaunchpad.getListing(listingId);
        assertEq(listing.seller, seller);
        assertEq(listing.collection, address(mockERC721));
        assertEq(listing.tokenId, tokenId);
        assertEq(listing.price, 1 ether);
        assertEq(uint8(listing.status), uint8(NFTLaunchpad.ListingStatus.ACTIVE));
    }

    function test_BuyERC721WithFeeDistribution() public {
        // Register collection with 80/20 split
        vm.prank(creator);
        nftLaunchpad.registerCollection(address(mockERC721), 8000, address(0));

        // Mint and list
        uint256 tokenId = mockERC721.mint(seller);
        vm.startPrank(seller);
        mockERC721.approve(address(nftLaunchpad), tokenId);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC721,
            address(mockERC721),
            tokenId,
            1,
            NFTLaunchpad.Currency.ETH,
            address(0),
            1 ether
        );
        vm.stopPrank();

        // Record balances before
        uint256 creatorBalBefore = creator.balance;
        uint256 communityBalBefore = communityVault.balance;

        // Buy
        vm.prank(buyer);
        nftLaunchpad.buyListing{value: 1 ether}(listingId);

        // Verify NFT transferred
        assertEq(mockERC721.ownerOf(tokenId), buyer);

        // Verify fee distribution (80% to creator, 20% to community)
        assertEq(creator.balance - creatorBalBefore, 0.8 ether);
        assertEq(communityVault.balance - communityBalBefore, 0.2 ether);
    }

    function test_BuyWith100PercentCreator() public {
        // Register with 100% creator
        vm.prank(creator);
        nftLaunchpad.registerCollection(address(mockERC721), 10000, address(0));

        uint256 tokenId = mockERC721.mint(seller);
        vm.startPrank(seller);
        mockERC721.approve(address(nftLaunchpad), tokenId);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC721,
            address(mockERC721),
            tokenId,
            1,
            NFTLaunchpad.Currency.ETH,
            address(0),
            1 ether
        );
        vm.stopPrank();

        uint256 creatorBalBefore = creator.balance;
        uint256 communityBalBefore = communityVault.balance;

        vm.prank(buyer);
        nftLaunchpad.buyListing{value: 1 ether}(listingId);

        // 100% to creator, 0% to community
        assertEq(creator.balance - creatorBalBefore, 1 ether);
        assertEq(communityVault.balance - communityBalBefore, 0);
    }

    function test_BuyWith100PercentCommunity() public {
        // Register with 100% community
        vm.prank(creator);
        nftLaunchpad.registerCollection(address(mockERC721), 0, address(0));

        uint256 tokenId = mockERC721.mint(seller);
        vm.startPrank(seller);
        mockERC721.approve(address(nftLaunchpad), tokenId);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC721,
            address(mockERC721),
            tokenId,
            1,
            NFTLaunchpad.Currency.ETH,
            address(0),
            1 ether
        );
        vm.stopPrank();

        uint256 creatorBalBefore = creator.balance;
        uint256 communityBalBefore = communityVault.balance;

        vm.prank(buyer);
        nftLaunchpad.buyListing{value: 1 ether}(listingId);

        // 0% to creator, 100% to community
        assertEq(creator.balance - creatorBalBefore, 0);
        assertEq(communityVault.balance - communityBalBefore, 1 ether);
    }

    function test_ERC1155Listing() public {
        // Mint ERC1155
        mockERC1155.mint(seller, 1, 100);

        vm.startPrank(seller);
        mockERC1155.setApprovalForAll(address(nftLaunchpad), true);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC1155,
            address(mockERC1155),
            1,
            50, // Selling 50 out of 100
            NFTLaunchpad.Currency.ETH,
            address(0),
            0.5 ether
        );
        vm.stopPrank();

        NFTLaunchpad.Listing memory listing = nftLaunchpad.getListing(listingId);
        assertEq(listing.amount, 50);
    }

    function test_CancelListing() public {
        uint256 tokenId = mockERC721.mint(seller);

        vm.startPrank(seller);
        mockERC721.approve(address(nftLaunchpad), tokenId);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC721,
            address(mockERC721),
            tokenId,
            1,
            NFTLaunchpad.Currency.ETH,
            address(0),
            1 ether
        );

        nftLaunchpad.cancelListing(listingId);
        vm.stopPrank();

        NFTLaunchpad.Listing memory listing = nftLaunchpad.getListing(listingId);
        assertEq(uint8(listing.status), uint8(NFTLaunchpad.ListingStatus.CANCELLED));
    }

    function test_PreviewFees() public {
        vm.prank(creator);
        nftLaunchpad.registerCollection(address(mockERC721), 7500, address(0)); // 75/25

        (uint256 creatorFee, uint256 communityFee, address creatorAddr, address vault) =
            nftLaunchpad.previewFees(address(mockERC721), 1 ether);

        assertEq(creatorFee, 0.75 ether);
        assertEq(communityFee, 0.25 ether);
        assertEq(creatorAddr, creator);
        assertEq(vault, communityVault);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         ERROR CASES
    // ═══════════════════════════════════════════════════════════════════════

    function test_CannotBuyOwnListing() public {
        uint256 tokenId = mockERC721.mint(seller);

        vm.startPrank(seller);
        mockERC721.approve(address(nftLaunchpad), tokenId);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC721,
            address(mockERC721),
            tokenId,
            1,
            NFTLaunchpad.Currency.ETH,
            address(0),
            1 ether
        );

        vm.expectRevert(NFTLaunchpad.CannotBuyOwn.selector);
        nftLaunchpad.buyListing{value: 1 ether}(listingId);
        vm.stopPrank();
    }

    function test_InsufficientPayment() public {
        uint256 tokenId = mockERC721.mint(seller);

        vm.startPrank(seller);
        mockERC721.approve(address(nftLaunchpad), tokenId);
        uint256 listingId = nftLaunchpad.createListing(
            NFTLaunchpad.AssetType.ERC721,
            address(mockERC721),
            tokenId,
            1,
            NFTLaunchpad.Currency.ETH,
            address(0),
            1 ether
        );
        vm.stopPrank();

        vm.prank(buyer);
        vm.expectRevert(NFTLaunchpad.InsufficientPayment.selector);
        nftLaunchpad.buyListing{value: 0.5 ether}(listingId);
    }

    function test_InvalidFeeConfigReverts() public {
        vm.prank(creator);
        vm.expectRevert(NFTLaunchpad.InvalidFeeConfig.selector);
        nftLaunchpad.registerCollection(address(mockERC721), 10001, address(0));
    }
}
