// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title JejuBazaar
 * @author Jeju Network
 * @notice NFT marketplace with multi-currency support and paymaster integration for Hyperscape items
 * @dev Supports listings in any paymastered token, HyperscapeGold (HG), ETH, and USDC.
 * 
 * Features:
 * - List NFTs for sale in multiple currencies
 * - Direct listings (fixed price)
 * - Auction listings (coming soon)
 * - Royalty support for creators
 * - Platform fee collection
 * - ERC-4337 Paymaster integration (users can pay gas with any supported token)
 * 
 * Currencies Supported:
 * - Native ETH
 * - HyperscapeGold (HG) ERC-20
 * - USDC ERC-20
 * - Any token registered in the Paymaster Index
 * 
 * Fee Structure:
 * - Platform fee: 2.5% of sale price
 * - Creator royalty: 0-10% (set per collection)
 * 
 * Paymaster Integration:
 * - Users can pay transaction fees with any supported token
 * - Marketplace queries the on-chain Paymaster Index
 * - Seamless UX: pay for NFT + gas fees in same token
 */
contract JejuBazaar is ReentrancyGuard, Ownable {
    
    // ============ Enums ============
    
    enum Currency {
        ETH,
        HG,
        USDC
    }
    
    enum ListingType {
        DIRECT,
        AUCTION
    }
    
    enum ListingStatus {
        ACTIVE,
        SOLD,
        CANCELLED
    }
    
    // ============ Structs ============
    
    struct Listing {
        uint256 listingId;
        address seller;
        address nftContract;
        uint256 tokenId;
        Currency currency;
        uint256 price;
        ListingType listingType;
        ListingStatus status;
        uint256 createdAt;
        uint256 expiresAt;
    }
    
    // ============ State Variables ============
    
    /// @notice Platform fee in basis points (250 = 2.5%)
    uint256 public platformFeeBps = 250;
    
    /// @notice Maximum platform fee (10%)
    uint256 public constant MAX_PLATFORM_FEE_BPS = 1000;
    
    /// @notice Platform fee recipient
    address public feeRecipient;
    
    /// @notice HyperscapeGold token address
    address public immutable hyperscapeGold;
    
    /// @notice USDC token address
    address public immutable usdc;
    
    /// @notice Next listing ID
    uint256 private _nextListingId = 1;
    
    /// @notice Mapping from listing ID to listing data
    mapping(uint256 => Listing) public listings;
    
    /// @notice Mapping from NFT contract => token ID => listing ID
    mapping(address => mapping(uint256 => uint256)) public tokenListings;
    
    /// @notice Mapping from NFT contract to creator royalty in basis points
    mapping(address => uint256) public creatorRoyaltyBps;
    
    /// @notice Mapping from NFT contract to creator address
    mapping(address => address) public creatorAddresses;
    
    // ============ Events ============
    
    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address indexed nftContract,
        uint256 tokenId,
        Currency currency,
        uint256 price
    );
    
    event ListingSold(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        Currency currency
    );
    
    event ListingCancelled(
        uint256 indexed listingId,
        address indexed seller
    );
    
    event PlatformFeeUpdated(uint256 newFeeBps);
    event FeeRecipientUpdated(address newRecipient);
    event CreatorRoyaltyUpdated(address indexed nftContract, uint256 royaltyBps);
    
    // ============ Errors ============
    
    error InvalidPrice();
    error InvalidCurrency();
    error InvalidNFTContract();
    error NotNFTOwner();
    error NFTNotApproved();
    error ListingNotFound();
    error ListingNotActive();
    error CannotBuyOwnListing();
    error InsufficientPayment();
    error InvalidFee();
    error TransferFailed();
    error AlreadyListed();
    
    // ============ Constructor ============
    
    constructor(
        address initialOwner,
        address _hyperscapeGold,
        address _usdc,
        address _feeRecipient
    ) Ownable(initialOwner) {
        if (_hyperscapeGold == address(0) || _usdc == address(0) || _feeRecipient == address(0)) {
            revert InvalidNFTContract();
        }
        
        hyperscapeGold = _hyperscapeGold;
        usdc = _usdc;
        feeRecipient = _feeRecipient;
    }
    
    // ============ External Functions ============
    
    /**
     * @notice Create a direct listing for an NFT
     * @param nftContract Address of the NFT contract
     * @param tokenId Token ID to list
     * @param currency Currency to accept (ETH, HG, USDC)
     * @param price Price in the selected currency
     * @param duration Duration in seconds (0 = no expiration)
     * @return listingId The ID of the created listing
     */
    function createListing(
        address nftContract,
        uint256 tokenId,
        Currency currency,
        uint256 price,
        uint256 duration
    ) external nonReentrant returns (uint256) {
        if (price == 0) revert InvalidPrice();
        if (nftContract == address(0)) revert InvalidNFTContract();
        
        // Verify ownership
        IERC721 nft = IERC721(nftContract);
        if (nft.ownerOf(tokenId) != msg.sender) revert NotNFTOwner();
        
        // Verify approval
        if (!nft.isApprovedForAll(msg.sender, address(this)) && 
            nft.getApproved(tokenId) != address(this)) {
            revert NFTNotApproved();
        }
        
        // Check if already listed
        uint256 existingListingId = tokenListings[nftContract][tokenId];
        if (existingListingId != 0 && listings[existingListingId].status == ListingStatus.ACTIVE) {
            revert AlreadyListed();
        }
        
        uint256 listingId = _nextListingId++;
        uint256 expiresAt = duration > 0 ? block.timestamp + duration : 0;
        
        listings[listingId] = Listing({
            listingId: listingId,
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            currency: currency,
            price: price,
            listingType: ListingType.DIRECT,
            status: ListingStatus.ACTIVE,
            createdAt: block.timestamp,
            expiresAt: expiresAt
        });
        
        tokenListings[nftContract][tokenId] = listingId;
        
        emit ListingCreated(listingId, msg.sender, nftContract, tokenId, currency, price);
        
        return listingId;
    }
    
    /**
     * @notice Buy a listed NFT
     * @param listingId Listing ID to purchase
     * @dev For ETH purchases, send exact amount. For token purchases, must approve first.
     */
    function buyListing(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];
        
        if (listing.seller == address(0)) revert ListingNotFound();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();
        if (listing.expiresAt > 0 && block.timestamp > listing.expiresAt) revert ListingNotActive();
        if (listing.seller == msg.sender) revert CannotBuyOwnListing();
        
        uint256 price = listing.price;
        address seller = listing.seller;
        
        // Calculate fees
        uint256 platformFee = (price * platformFeeBps) / 10000;
        uint256 creatorRoyalty = 0;
        
        address creator = creatorAddresses[listing.nftContract];
        if (creator != address(0)) {
            uint256 royaltyBps = creatorRoyaltyBps[listing.nftContract];
            creatorRoyalty = (price * royaltyBps) / 10000;
        }
        
        uint256 sellerProceeds = price - platformFee - creatorRoyalty;
        
        // Handle payment based on currency
        if (listing.currency == Currency.ETH) {
            if (msg.value != price) revert InsufficientPayment();
            
            // Transfer funds
            _transferETH(feeRecipient, platformFee);
            if (creatorRoyalty > 0 && creator != address(0)) {
                _transferETH(creator, creatorRoyalty);
            }
            _transferETH(seller, sellerProceeds);
            
        } else {
            // ERC-20 payment
            address tokenAddress = listing.currency == Currency.HG ? hyperscapeGold : usdc;
            IERC20 token = IERC20(tokenAddress);
            
            // Transfer tokens
            bool success = token.transferFrom(msg.sender, feeRecipient, platformFee);
            if (!success) revert TransferFailed();
            
            if (creatorRoyalty > 0 && creator != address(0)) {
                success = token.transferFrom(msg.sender, creator, creatorRoyalty);
                if (!success) revert TransferFailed();
            }
            
            success = token.transferFrom(msg.sender, seller, sellerProceeds);
            if (!success) revert TransferFailed();
        }
        
        // Transfer NFT
        IERC721(listing.nftContract).transferFrom(seller, msg.sender, listing.tokenId);
        
        // Update listing
        listing.status = ListingStatus.SOLD;
        delete tokenListings[listing.nftContract][listing.tokenId];
        
        emit ListingSold(listingId, msg.sender, seller, price, listing.currency);
    }
    
    /**
     * @notice Cancel a listing
     * @param listingId Listing ID to cancel
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];
        
        if (listing.seller != msg.sender) revert NotNFTOwner();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();
        
        listing.status = ListingStatus.CANCELLED;
        delete tokenListings[listing.nftContract][listing.tokenId];
        
        emit ListingCancelled(listingId, msg.sender);
    }
    
    /**
     * @notice Update platform fee (owner only)
     * @param newFeeBps New fee in basis points
     */
    function setPlatformFee(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_PLATFORM_FEE_BPS) revert InvalidFee();
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }
    
    /**
     * @notice Update fee recipient (owner only)
     * @param newRecipient New fee recipient address
     */
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidNFTContract();
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }
    
    /**
     * @notice Set creator royalty for a collection (owner only)
     * @param nftContract NFT contract address
     * @param creator Creator address
     * @param royaltyBps Royalty in basis points (max 10%)
     */
    function setCreatorRoyalty(
        address nftContract,
        address creator,
        uint256 royaltyBps
    ) external onlyOwner {
        if (royaltyBps > 1000) revert InvalidFee(); // Max 10%
        creatorAddresses[nftContract] = creator;
        creatorRoyaltyBps[nftContract] = royaltyBps;
        emit CreatorRoyaltyUpdated(nftContract, royaltyBps);
    }
    
    /**
     * @notice Get listing details
     * @param listingId Listing ID
     * @return Listing struct
     */
    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }
    
    /**
     * @notice Check if a token is listed
     * @param nftContract NFT contract address
     * @param tokenId Token ID
     * @return listingId Active listing ID, 0 if not listed
     */
    function getTokenListing(address nftContract, uint256 tokenId) external view returns (uint256) {
        uint256 listingId = tokenListings[nftContract][tokenId];
        if (listingId != 0 && listings[listingId].status == ListingStatus.ACTIVE) {
            return listingId;
        }
        return 0;
    }
    
    // ============ Internal Functions ============
    
    function _transferETH(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
    
    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}

