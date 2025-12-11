// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title NFTLaunchpad
 * @author Jeju Network
 * @notice NFT marketplace with 100% fee split between creator and community
 * @dev Extends Bazaar functionality with configurable fee splits
 *
 * Fee Structure:
 * - ZERO platform fees
 * - 100% of trading fees go to creator + community
 * - Creator/community split is configurable per collection (0-100%)
 * - Default: 80% creator, 20% community
 *
 * Collection Registration:
 * - Creators register their collection with fee config
 * - Can set community vault per collection or use global default
 * - Fee split can be updated by collection owner
 *
 * Supported Assets:
 * - ERC721 NFTs
 * - ERC1155 semi-fungibles
 */
contract NFTLaunchpad is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ═══════════════════════════════════════════════════════════════════════
    //                              ENUMS
    // ═══════════════════════════════════════════════════════════════════════

    enum AssetType {
        ERC721,
        ERC1155
    }

    enum Currency {
        ETH,
        CUSTOM_ERC20
    }

    enum ListingStatus {
        ACTIVE,
        SOLD,
        CANCELLED
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STRUCTS
    // ═══════════════════════════════════════════════════════════════════════

    struct CollectionConfig {
        address creator;
        uint16 creatorFeeBps;      // Creator's share of sale price (basis points)
        uint16 communityFeeBps;    // Community's share of sale price (basis points)
        address communityVault;     // Where community fees go
        bool registered;
    }

    struct Listing {
        uint256 listingId;
        address seller;
        AssetType assetType;
        address collection;
        uint256 tokenId;
        uint256 amount;
        Currency currency;
        address currencyAddress;
        uint256 price;
        ListingStatus status;
        uint256 createdAt;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              STATE
    // ═══════════════════════════════════════════════════════════════════════

    /// @notice Collection configurations
    mapping(address => CollectionConfig) public collections;

    /// @notice All listings by ID
    mapping(uint256 => Listing) public listings;

    /// @notice Active listing by collection => tokenId
    mapping(address => mapping(uint256 => uint256)) public tokenListings;

    /// @notice Next listing ID
    uint256 private _nextListingId = 1;

    /// @notice Default community vault
    address public defaultCommunityVault;

    /// @notice Default fee split (80% creator, 20% community)
    uint16 public constant DEFAULT_CREATOR_FEE_BPS = 8000;
    uint16 public constant DEFAULT_COMMUNITY_FEE_BPS = 2000;

    /// @notice Total fee (100% = 10000 bps)
    uint16 public constant TOTAL_FEE_BPS = 10000;

    // ═══════════════════════════════════════════════════════════════════════
    //                              EVENTS
    // ═══════════════════════════════════════════════════════════════════════

    event CollectionRegistered(
        address indexed collection,
        address indexed creator,
        uint16 creatorFeeBps,
        uint16 communityFeeBps,
        address communityVault
    );

    event CollectionFeeUpdated(
        address indexed collection,
        uint16 newCreatorFeeBps,
        uint16 newCommunityFeeBps
    );

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        address indexed collection,
        uint256 tokenId,
        uint256 amount,
        uint256 price
    );

    event ListingSold(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 creatorFee,
        uint256 communityFee
    );

    event ListingCancelled(uint256 indexed listingId);

    // ═══════════════════════════════════════════════════════════════════════
    //                              ERRORS
    // ═══════════════════════════════════════════════════════════════════════

    error InvalidFeeConfig();
    error CollectionNotRegistered();
    error NotCollectionOwner();
    error InvalidAmount();
    error InvalidPrice();
    error NotAssetOwner();
    error NotApproved();
    error ListingNotFound();
    error ListingNotActive();
    error CannotBuyOwn();
    error InsufficientPayment();
    error TransferFailed();
    error AlreadyListed();

    // ═══════════════════════════════════════════════════════════════════════
    //                              CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════

    constructor(address _defaultCommunityVault, address _owner) Ownable(_owner) {
        defaultCommunityVault = _defaultCommunityVault;
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         COLLECTION REGISTRATION
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Register a collection with custom fee split
     * @param collection NFT collection address
     * @param creatorFeeBps Creator's share in basis points (0-10000)
     * @param communityVault Address to receive community fees (0 = default)
     */
    function registerCollection(
        address collection,
        uint16 creatorFeeBps,
        address communityVault
    ) external {
        if (creatorFeeBps > TOTAL_FEE_BPS) revert InvalidFeeConfig();
        
        uint16 communityFeeBps = TOTAL_FEE_BPS - creatorFeeBps;

        collections[collection] = CollectionConfig({
            creator: msg.sender,
            creatorFeeBps: creatorFeeBps,
            communityFeeBps: communityFeeBps,
            communityVault: communityVault == address(0) ? defaultCommunityVault : communityVault,
            registered: true
        });

        emit CollectionRegistered(
            collection,
            msg.sender,
            creatorFeeBps,
            communityFeeBps,
            communityVault == address(0) ? defaultCommunityVault : communityVault
        );
    }

    /**
     * @notice Update fee split for a collection
     * @param collection NFT collection address
     * @param creatorFeeBps New creator share in basis points
     */
    function updateCollectionFees(address collection, uint16 creatorFeeBps) external {
        CollectionConfig storage config = collections[collection];
        if (!config.registered) revert CollectionNotRegistered();
        if (config.creator != msg.sender) revert NotCollectionOwner();
        if (creatorFeeBps > TOTAL_FEE_BPS) revert InvalidFeeConfig();

        uint16 communityFeeBps = TOTAL_FEE_BPS - creatorFeeBps;
        config.creatorFeeBps = creatorFeeBps;
        config.communityFeeBps = communityFeeBps;

        emit CollectionFeeUpdated(collection, creatorFeeBps, communityFeeBps);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              LISTINGS
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Create a listing for an NFT
     * @param assetType ERC721 or ERC1155
     * @param collection Collection address
     * @param tokenId Token ID
     * @param amount Amount (1 for ERC721)
     * @param currency ETH or CUSTOM_ERC20
     * @param currencyAddress ERC20 address if CUSTOM_ERC20
     * @param price Listing price
     */
    function createListing(
        AssetType assetType,
        address collection,
        uint256 tokenId,
        uint256 amount,
        Currency currency,
        address currencyAddress,
        uint256 price
    ) external nonReentrant returns (uint256 listingId) {
        if (price == 0) revert InvalidPrice();
        if (amount == 0) revert InvalidAmount();

        // Auto-register collection with default fees if not registered
        if (!collections[collection].registered) {
            collections[collection] = CollectionConfig({
                creator: msg.sender,
                creatorFeeBps: DEFAULT_CREATOR_FEE_BPS,
                communityFeeBps: DEFAULT_COMMUNITY_FEE_BPS,
                communityVault: defaultCommunityVault,
                registered: true
            });
        }

        // Verify ownership and approval
        if (assetType == AssetType.ERC721) {
            if (amount != 1) revert InvalidAmount();
            IERC721 nft = IERC721(collection);
            if (nft.ownerOf(tokenId) != msg.sender) revert NotAssetOwner();
            if (!nft.isApprovedForAll(msg.sender, address(this)) && 
                nft.getApproved(tokenId) != address(this)) {
                revert NotApproved();
            }
        } else {
            IERC1155 nft = IERC1155(collection);
            if (nft.balanceOf(msg.sender, tokenId) < amount) revert NotAssetOwner();
            if (!nft.isApprovedForAll(msg.sender, address(this))) revert NotApproved();
        }

        // Check existing listing
        uint256 existingId = tokenListings[collection][tokenId];
        if (existingId != 0 && listings[existingId].status == ListingStatus.ACTIVE) {
            revert AlreadyListed();
        }

        listingId = _nextListingId++;

        listings[listingId] = Listing({
            listingId: listingId,
            seller: msg.sender,
            assetType: assetType,
            collection: collection,
            tokenId: tokenId,
            amount: amount,
            currency: currency,
            currencyAddress: currencyAddress,
            price: price,
            status: ListingStatus.ACTIVE,
            createdAt: block.timestamp
        });

        tokenListings[collection][tokenId] = listingId;

        emit ListingCreated(listingId, msg.sender, collection, tokenId, amount, price);
    }

    /**
     * @notice Buy a listed NFT
     * @param listingId Listing to purchase
     */
    function buyListing(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.seller == address(0)) revert ListingNotFound();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();
        if (listing.seller == msg.sender) revert CannotBuyOwn();

        // Cache values
        uint256 price = listing.price;
        address seller = listing.seller;
        address collection = listing.collection;
        uint256 tokenId = listing.tokenId;
        uint256 amount = listing.amount;
        AssetType assetType = listing.assetType;
        Currency currency = listing.currency;
        address currencyAddress = listing.currencyAddress;

        // Get fee config
        CollectionConfig storage config = collections[collection];
        uint256 creatorFee = (price * config.creatorFeeBps) / TOTAL_FEE_BPS;
        uint256 communityFee = price - creatorFee; // Remainder to community

        // Update state first (CEI)
        listing.status = ListingStatus.SOLD;
        delete tokenListings[collection][tokenId];

        // Handle payment
        if (currency == Currency.ETH) {
            if (msg.value != price) revert InsufficientPayment();

            // Send to creator
            if (creatorFee > 0) {
                (bool s1,) = config.creator.call{value: creatorFee}("");
                if (!s1) revert TransferFailed();
            }

            // Send to community vault
            if (communityFee > 0) {
                (bool s2,) = config.communityVault.call{value: communityFee}("");
                if (!s2) revert TransferFailed();
            }
        } else {
            IERC20 token = IERC20(currencyAddress);
            if (creatorFee > 0) {
                token.safeTransferFrom(msg.sender, config.creator, creatorFee);
            }
            if (communityFee > 0) {
                token.safeTransferFrom(msg.sender, config.communityVault, communityFee);
            }
        }

        // Transfer NFT
        if (assetType == AssetType.ERC721) {
            IERC721(collection).transferFrom(seller, msg.sender, tokenId);
        } else {
            IERC1155(collection).safeTransferFrom(seller, msg.sender, tokenId, amount, "");
        }

        emit ListingSold(listingId, msg.sender, seller, price, creatorFee, communityFee);
    }

    /**
     * @notice Cancel a listing
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.seller != msg.sender) revert NotAssetOwner();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();

        listing.status = ListingStatus.CANCELLED;
        delete tokenListings[listing.collection][listing.tokenId];

        emit ListingCancelled(listingId);
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function getCollectionConfig(address collection) external view returns (CollectionConfig memory) {
        return collections[collection];
    }

    function getTokenListing(address collection, uint256 tokenId) external view returns (uint256) {
        uint256 listingId = tokenListings[collection][tokenId];
        if (listingId != 0 && listings[listingId].status == ListingStatus.ACTIVE) {
            return listingId;
        }
        return 0;
    }

    /**
     * @notice Preview fee distribution for a sale
     */
    function previewFees(address collection, uint256 price) external view returns (
        uint256 creatorFee,
        uint256 communityFee,
        address creator,
        address communityVault
    ) {
        CollectionConfig storage config = collections[collection];
        if (!config.registered) {
            // Use defaults
            creatorFee = (price * DEFAULT_CREATOR_FEE_BPS) / TOTAL_FEE_BPS;
            communityFee = price - creatorFee;
            creator = address(0);
            communityVault = defaultCommunityVault;
        } else {
            creatorFee = (price * config.creatorFeeBps) / TOTAL_FEE_BPS;
            communityFee = price - creatorFee;
            creator = config.creator;
            communityVault = config.communityVault;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                              ADMIN
    // ═══════════════════════════════════════════════════════════════════════

    function setDefaultCommunityVault(address vault) external onlyOwner {
        defaultCommunityVault = vault;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
