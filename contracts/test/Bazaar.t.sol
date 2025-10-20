// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/marketplace/Bazaar.sol";
import "../src/games/Items.sol";
import "../src/games/Gold.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockNFT
 * @dev Simple ERC721 for testing
 */
contract MockNFT is ERC721 {
    uint256 private _tokenIds;
    
    constructor() ERC721("MockNFT", "MNFT") {}
    
    function mint(address to) external returns (uint256) {
        _tokenIds++;
        _mint(to, _tokenIds);
        return _tokenIds;
    }
}

/**
 * @title MockUSDC
 * @dev Simple ERC20 for testing
 */
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {
        _mint(msg.sender, 1000000 * 10**6); // 1M USDC
    }
    
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/**
 * @title BazaarTest
 * @dev Comprehensive tests for the Bazaar multi-asset marketplace
 */
contract BazaarTest is Test {
    Bazaar public bazaar;
    Items public items;
    Gold public gold;
    MockNFT public nft;
    MockUSDC public usdc;
    
    address public owner;
    address public seller;
    address public buyer;
    address public feeRecipient;
    address public creator;
    address public gameSigner;
    uint256 public gameSignerKey;
    
    uint256 public constant GAME_AGENT_ID = 1;
    
    function setUp() public {
        owner = address(this);
        seller = makeAddr("seller");
        buyer = makeAddr("buyer");
        feeRecipient = makeAddr("feeRecipient");
        creator = makeAddr("creator");
        
        // Create game signer with known private key for signing
        gameSignerKey = 0xA11CE;
        gameSigner = vm.addr(gameSignerKey);
        
        // Deploy tokens
        gold = new Gold(GAME_AGENT_ID, gameSigner, owner);
        items = new Items(GAME_AGENT_ID, gameSigner, owner);
        nft = new MockNFT();
        usdc = new MockUSDC();
        
        // Deploy Bazaar
        bazaar = new Bazaar(owner, address(gold), address(usdc), feeRecipient);
        
        // Setup - give users tokens
        vm.deal(seller, 10 ether);
        vm.deal(buyer, 10 ether);
        
        gold.emergencyMint(seller, 10000 * 10**18);
        gold.emergencyMint(buyer, 10000 * 10**18);
        
        usdc.mint(seller, 10000 * 10**6);
        usdc.mint(buyer, 10000 * 10**6);
    }
    
    // ============ ERC721 Tests ============
    
    function test_CreateListing_ERC721() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1, // amount (must be 1 for ERC721)
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0 // no expiration
        );
        vm.stopPrank();
        
        assertEq(listingId, 1);
        
        Bazaar.Listing memory listing = bazaar.getListing(listingId);
        assertEq(uint8(listing.assetType), uint8(Bazaar.AssetType.ERC721));
        assertEq(listing.seller, seller);
        assertEq(listing.assetContract, address(nft));
        assertEq(listing.tokenId, tokenId);
        assertEq(listing.amount, 1);
        assertEq(listing.price, 1 ether);
        assertEq(uint8(listing.status), uint8(Bazaar.ListingStatus.ACTIVE));
    }
    
    function test_BuyListing_ERC721_WithETH() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0
        );
        vm.stopPrank();
        
        uint256 sellerBalanceBefore = seller.balance;
        uint256 feeRecipientBalanceBefore = feeRecipient.balance;
        
        vm.prank(buyer);
        bazaar.buyListing{value: 1 ether}(listingId);
        
        // Verify NFT transfer
        assertEq(nft.ownerOf(tokenId), buyer);
        
        // Verify payments (2.5% platform fee)
        uint256 platformFee = (1 ether * 250) / 10000; // 0.025 ether
        assertEq(seller.balance, sellerBalanceBefore + 1 ether - platformFee);
        assertEq(feeRecipient.balance, feeRecipientBalanceBefore + platformFee);
    }
    
    function test_Revert_ERC721_InvalidAmount() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        
        vm.expectRevert(Bazaar.InvalidAmount.selector);
        bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            2, // Invalid: must be 1 for ERC721
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0
        );
        vm.stopPrank();
    }
    
    // ============ ERC1155 Tests ============
    
    function test_CreateListing_ERC1155_Stackable() public {
        // Create stackable item (arrows)
        uint256 arrowsId = items.createItemType("Bronze Arrows", true, 5, 0, 0, 0);
        
        // Mint 100 arrows to seller (needs game server signature)
        bytes32 instanceId = keccak256(abi.encodePacked(seller, arrowsId, uint256(100)));
        bytes32 messageHash = keccak256(abi.encodePacked(seller, arrowsId, uint256(100), instanceId));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(seller);
        items.mintItem(arrowsId, 100, instanceId, signature);
        
        vm.startPrank(seller);
        items.setApprovalForAll(address(bazaar), true);
        
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC1155,
            address(items),
            arrowsId,
            100, // selling all 100 arrows
            Bazaar.Currency.HG,
            address(0),
            50 * 10**18, // 50 Gold
            0
        );
        vm.stopPrank();
        
        Bazaar.Listing memory listing = bazaar.getListing(listingId);
        assertEq(uint8(listing.assetType), uint8(Bazaar.AssetType.ERC1155));
        assertEq(listing.amount, 100);
        assertEq(uint8(listing.currency), uint8(Bazaar.Currency.HG));
    }
    
    function test_BuyListing_ERC1155_WithGold() public {
        // Create and mint stackable items
        uint256 arrowsId = items.createItemType("Bronze Arrows", true, 5, 0, 0, 0);
        bytes32 instanceId = keccak256(abi.encodePacked(seller, arrowsId, uint256(100)));
        bytes32 messageHash = keccak256(abi.encodePacked(seller, arrowsId, uint256(100), instanceId));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(seller);
        items.mintItem(arrowsId, 100, instanceId, signature);
        
        vm.startPrank(seller);
        items.setApprovalForAll(address(bazaar), true);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC1155,
            address(items),
            arrowsId,
            100,
            Bazaar.Currency.HG,
            address(0),
            50 * 10**18,
            0
        );
        vm.stopPrank();
        
        uint256 sellerGoldBefore = gold.balanceOf(seller);
        
        vm.startPrank(buyer);
        gold.approve(address(bazaar), 50 * 10**18);
        bazaar.buyListing(listingId);
        vm.stopPrank();
        
        // Verify item transfer
        assertEq(items.balanceOf(buyer, arrowsId), 100);
        assertEq(items.balanceOf(seller, arrowsId), 0);
        
        // Verify gold payment (2.5% fee)
        uint256 platformFee = (50 * 10**18 * 250) / 10000;
        assertEq(gold.balanceOf(seller), sellerGoldBefore + 50 * 10**18 - platformFee);
        assertEq(gold.balanceOf(feeRecipient), platformFee);
    }
    
    function test_CreateListing_ERC1155_Unique() public {
        // Create unique item (legendary sword)
        uint256 swordId = items.createItemType("Legendary Sword", false, 50, 0, 10, 4);
        
        bytes32 instanceId = keccak256(abi.encodePacked(seller, swordId, block.timestamp));
        bytes32 messageHash = keccak256(abi.encodePacked(seller, swordId, uint256(1), instanceId));
        bytes32 ethSignedHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(gameSignerKey, ethSignedHash);
        bytes memory signature = abi.encodePacked(r, s, v);
        
        vm.prank(seller);
        items.mintItem(swordId, 1, instanceId, signature);
        
        vm.startPrank(seller);
        items.setApprovalForAll(address(bazaar), true);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC1155,
            address(items),
            swordId,
            1, // unique item
            Bazaar.Currency.ETH,
            address(0),
            2 ether,
            0
        );
        vm.stopPrank();
        
        Bazaar.Listing memory listing = bazaar.getListing(listingId);
        assertEq(listing.amount, 1);
    }
    
    // ============ ERC20 Tests ============
    
    function test_CreateListing_ERC20() public {
        vm.startPrank(seller);
        gold.approve(address(bazaar), 1000 * 10**18);
        
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC20,
            address(gold),
            0, // tokenId must be 0 for ERC20
            1000 * 10**18,
            Bazaar.Currency.USDC,
            address(0),
            100 * 10**6, // 100 USDC
            0
        );
        vm.stopPrank();
        
        Bazaar.Listing memory listing = bazaar.getListing(listingId);
        assertEq(uint8(listing.assetType), uint8(Bazaar.AssetType.ERC20));
        assertEq(listing.tokenId, 0);
        assertEq(listing.amount, 1000 * 10**18);
    }
    
    function test_BuyListing_ERC20_WithUSDC() public {
        vm.startPrank(seller);
        gold.approve(address(bazaar), 1000 * 10**18);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC20,
            address(gold),
            0,
            1000 * 10**18,
            Bazaar.Currency.USDC,
            address(0),
            100 * 10**6,
            0
        );
        vm.stopPrank();
        
        uint256 sellerUsdcBefore = usdc.balanceOf(seller);
        uint256 buyerGoldBefore = gold.balanceOf(buyer);
        
        vm.startPrank(buyer);
        usdc.approve(address(bazaar), 100 * 10**6);
        bazaar.buyListing(listingId);
        vm.stopPrank();
        
        // Verify gold transfer
        assertEq(gold.balanceOf(buyer), buyerGoldBefore + 1000 * 10**18);
        
        // Verify USDC payment (2.5% fee)
        uint256 platformFee = (100 * 10**6 * 250) / 10000;
        assertEq(usdc.balanceOf(seller), sellerUsdcBefore + 100 * 10**6 - platformFee);
        assertEq(usdc.balanceOf(feeRecipient), platformFee);
    }
    
    function test_Revert_ERC20_NonZeroTokenId() public {
        vm.startPrank(seller);
        gold.approve(address(bazaar), 1000 * 10**18);
        
        vm.expectRevert(Bazaar.InvalidAssetType.selector);
        bazaar.createListing(
            Bazaar.AssetType.ERC20,
            address(gold),
            1, // Invalid: must be 0 for ERC20
            1000 * 10**18,
            Bazaar.Currency.USDC,
            address(0),
            100 * 10**6,
            0
        );
        vm.stopPrank();
    }
    
    // ============ Custom Currency Tests ============
    
    function test_CreateListing_CustomCurrency() public {
        MockUSDC customToken = new MockUSDC();
        customToken.mint(buyer, 1000 * 10**6);
        
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.CUSTOM_ERC20,
            address(customToken),
            50 * 10**6,
            0
        );
        vm.stopPrank();
        
        Bazaar.Listing memory listing = bazaar.getListing(listingId);
        assertEq(uint8(listing.currency), uint8(Bazaar.Currency.CUSTOM_ERC20));
        assertEq(listing.customCurrencyAddress, address(customToken));
    }
    
    function test_BuyListing_CustomCurrency() public {
        MockUSDC customToken = new MockUSDC();
        customToken.mint(buyer, 1000 * 10**6);
        
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.CUSTOM_ERC20,
            address(customToken),
            50 * 10**6,
            0
        );
        vm.stopPrank();
        
        vm.startPrank(buyer);
        customToken.approve(address(bazaar), 50 * 10**6);
        bazaar.buyListing(listingId);
        vm.stopPrank();
        
        assertEq(nft.ownerOf(tokenId), buyer);
        
        uint256 platformFee = (50 * 10**6 * 250) / 10000;
        assertGt(customToken.balanceOf(seller), 0);
        assertEq(customToken.balanceOf(feeRecipient), platformFee);
    }
    
    // ============ Royalty Tests ============
    
    function test_BuyListing_WithRoyalty() public {
        // Set 5% royalty for NFT collection
        bazaar.setCreatorRoyalty(address(nft), creator, 500); // 5%
        
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0
        );
        vm.stopPrank();
        
        uint256 creatorBalanceBefore = creator.balance;
        
        vm.prank(buyer);
        bazaar.buyListing{value: 1 ether}(listingId);
        
        // Verify royalty payment
        uint256 royalty = (1 ether * 500) / 10000; // 5%
        assertEq(creator.balance, creatorBalanceBefore + royalty);
    }
    
    // ============ Listing Management Tests ============
    
    function test_CancelListing() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0
        );
        
        bazaar.cancelListing(listingId);
        vm.stopPrank();
        
        Bazaar.Listing memory listing = bazaar.getListing(listingId);
        assertEq(uint8(listing.status), uint8(Bazaar.ListingStatus.CANCELLED));
    }
    
    function test_Revert_BuyOwnListing() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0
        );
        
        vm.expectRevert(Bazaar.CannotBuyOwnListing.selector);
        bazaar.buyListing{value: 1 ether}(listingId);
        vm.stopPrank();
    }
    
    function test_Revert_AlreadyListed() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0
        );
        
        vm.expectRevert(Bazaar.AlreadyListed.selector);
        bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            2 ether,
            0
        );
        vm.stopPrank();
    }
    
    function test_ListingExpiration() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            1 days // expires in 1 day
        );
        vm.stopPrank();
        
        // Warp time past expiration
        vm.warp(block.timestamp + 2 days);
        
        vm.prank(buyer);
        vm.expectRevert(Bazaar.ListingNotActive.selector);
        bazaar.buyListing{value: 1 ether}(listingId);
    }
    
    function test_GetTokenListing() public {
        uint256 tokenId = nft.mint(seller);
        
        vm.startPrank(seller);
        nft.approve(address(bazaar), tokenId);
        uint256 listingId = bazaar.createListing(
            Bazaar.AssetType.ERC721,
            address(nft),
            tokenId,
            1,
            Bazaar.Currency.ETH,
            address(0),
            1 ether,
            0
        );
        vm.stopPrank();
        
        uint256 foundListingId = bazaar.getTokenListing(address(nft), tokenId);
        assertEq(foundListingId, listingId);
    }
    
    // ============ Admin Tests ============
    
    function test_SetPlatformFee() public {
        bazaar.setPlatformFee(500); // 5%
        assertEq(bazaar.platformFeeBps(), 500);
    }
    
    function test_Revert_SetPlatformFee_TooHigh() public {
        vm.expectRevert(Bazaar.InvalidFee.selector);
        bazaar.setPlatformFee(1001); // > 10%
    }
    
    function test_SetFeeRecipient() public {
        address newRecipient = makeAddr("newRecipient");
        bazaar.setFeeRecipient(newRecipient);
        assertEq(bazaar.feeRecipient(), newRecipient);
    }
    
    function test_Version() public view {
        string memory ver = bazaar.version();
        assertEq(ver, "1.0.0");
    }
}

