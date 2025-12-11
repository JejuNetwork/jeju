// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";

/**
 * @title Bazaar
 * @author Jeju Network
 * @notice Universal marketplace supporting ERC721, ERC1155, and ERC20 tokens
 * @dev Multi-asset marketplace with multi-currency payment support
 *
 * Asset Types Supported:
 * - ERC721: Unique NFTs (characters, unique items)
 * - ERC1155: Semi-fungible tokens (stackable items, resources)
 * - ERC20: Fungible tokens (gold, currencies)
 *
 * Payment Currencies Supported:
 * - Native ETH
 * - Game Gold (ERC-20) - any game's in-game currency
 * - USDC ERC-20
 * - Any ERC-20 token
 *
 * Features:
 * - List any token type for sale in any payment currency
 * - Direct listings (fixed price)
 * - Auction listings (coming soon)
 * - Royalty support for creators
 * - Platform fee collection
 * - ERC-4337 Paymaster integration
 *
 * Fee Structure:
 * - Platform fee: 2.5% of sale price
 * - Creator royalty: 0-10% (set per collection)
 *
 * Use Cases:
 * - Trade Game Items (ERC1155) for Gold (ERC20) or ETH
 * - Sell unique NFTs (ERC721) for USDC
 * - Exchange Gold tokens (ERC20) for other currencies
 * - P2P token swaps with platform guarantees
 */
contract Bazaar is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    // ============ Enums ============

    enum AssetType {
        ERC721,
        ERC1155,
        ERC20
    }

    enum Currency {
        ETH,
        HG,
        USDC,
        CUSTOM_ERC20
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
        AssetType assetType;
        address assetContract;
        uint256 tokenId; // For ERC721/ERC1155 (0 for ERC20)
        uint256 amount; // For ERC1155/ERC20 (1 for ERC721)
        Currency currency;
        address customCurrencyAddress; // For CUSTOM_ERC20 currency
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

    /// @notice Game Gold token address (the primary in-game currency)
    address public immutable gameGold;

    /// @notice USDC token address
    address public immutable usdc;

    /// @notice Next listing ID
    uint256 private _nextListingId = 1;

    /// @notice Mapping from listing ID to listing data
    mapping(uint256 => Listing) public listings;

    /// @notice Mapping from asset contract => token ID => listing ID (for ERC721/ERC1155)
    /// @dev For ERC20, tokenId is always 0
    mapping(address => mapping(uint256 => uint256)) public tokenListings;

    /// @notice Mapping from asset contract to creator royalty in basis points
    mapping(address => uint256) public creatorRoyaltyBps;

    /// @notice Mapping from asset contract to creator address
    mapping(address => address) public creatorAddresses;

    /// @notice ERC-8004 Identity Registry for seller verification (optional)
    IIdentityRegistry public identityRegistry;

    /// @notice Mapping from listing ID to seller's agent ID (0 if not verified)
    mapping(uint256 => uint256) public listingAgentId;

    /// @notice Mapping from agent ID to their listings
    mapping(uint256 => uint256[]) public agentListings;

    // ============ Events ============

    event ListingCreated(
        uint256 indexed listingId,
        address indexed seller,
        AssetType assetType,
        address indexed assetContract,
        uint256 tokenId,
        uint256 amount,
        Currency currency,
        uint256 price
    );

    event ListingSold(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        AssetType assetType,
        uint256 amount,
        uint256 price,
        Currency currency
    );

    event ListingCancelled(uint256 indexed listingId, address indexed seller, AssetType assetType);

    event PlatformFeeUpdated(uint256 newFeeBps);
    event FeeRecipientUpdated(address newRecipient);
    event CreatorRoyaltyUpdated(address indexed assetContract, uint256 royaltyBps);

    // ============ Errors ============

    error InvalidPrice();
    error InvalidAmount();
    error InvalidCurrency();
    error InvalidAssetContract();
    error InvalidAssetType();
    error NotAssetOwner();
    error InsufficientBalance();
    error AssetNotApproved();
    error ListingNotFound();
    error ListingNotActive();
    error CannotBuyOwnListing();
    error InsufficientPayment();
    error InvalidFee();
    error TransferFailed();
    error AlreadyListed();

    // ============ Constructor ============

    constructor(address initialOwner, address _gameGold, address _usdc, address _feeRecipient)
        Ownable(initialOwner)
    {
        if (_gameGold == address(0) || _usdc == address(0) || _feeRecipient == address(0)) {
            revert InvalidAssetContract();
        }

        gameGold = _gameGold;
        usdc = _usdc;
        feeRecipient = _feeRecipient;
    }

    // ============ External Functions ============

    /**
     * @notice Create a direct listing for any asset type
     * @param assetType Type of asset (ERC721, ERC1155, ERC20)
     * @param assetContract Address of the asset contract
     * @param tokenId Token ID (for ERC721/ERC1155, 0 for ERC20)
     * @param amount Amount to sell (1 for ERC721, >1 for ERC1155/ERC20)
     * @param currency Currency to accept (ETH, HG, USDC, CUSTOM_ERC20)
     * @param customCurrencyAddress Address for CUSTOM_ERC20 (ignored for other currencies)
     * @param price Price in the selected currency
     * @param duration Duration in seconds (0 = no expiration)
     * @return listingId The ID of the created listing
     */
    function createListing(
        AssetType assetType,
        address assetContract,
        uint256 tokenId,
        uint256 amount,
        Currency currency,
        address customCurrencyAddress,
        uint256 price,
        uint256 duration
    ) external nonReentrant returns (uint256) {
        if (price == 0) revert InvalidPrice();
        if (amount == 0) revert InvalidAmount();
        if (assetContract == address(0)) revert InvalidAssetContract();
        if (currency == Currency.CUSTOM_ERC20 && customCurrencyAddress == address(0)) {
            revert InvalidCurrency();
        }

        // Verify ownership and approval based on asset type
        if (assetType == AssetType.ERC721) {
            if (amount != 1) revert InvalidAmount();
            IERC721 nft = IERC721(assetContract);
            if (nft.ownerOf(tokenId) != msg.sender) revert NotAssetOwner();
            if (!nft.isApprovedForAll(msg.sender, address(this)) && nft.getApproved(tokenId) != address(this)) {
                revert AssetNotApproved();
            }
        } else if (assetType == AssetType.ERC1155) {
            IERC1155 multiToken = IERC1155(assetContract);
            if (multiToken.balanceOf(msg.sender, tokenId) < amount) {
                revert InsufficientBalance();
            }
            if (!multiToken.isApprovedForAll(msg.sender, address(this))) {
                revert AssetNotApproved();
            }
        } else if (assetType == AssetType.ERC20) {
            if (tokenId != 0) revert InvalidAssetType(); // ERC20 doesn't use tokenId
            IERC20 token = IERC20(assetContract);
            if (token.balanceOf(msg.sender) < amount) revert InsufficientBalance();
            if (token.allowance(msg.sender, address(this)) < amount) {
                revert AssetNotApproved();
            }
        } else {
            revert InvalidAssetType();
        }

        // Check if already listed
        uint256 existingListingId = tokenListings[assetContract][tokenId];
        if (existingListingId != 0 && listings[existingListingId].status == ListingStatus.ACTIVE) {
            revert AlreadyListed();
        }

        uint256 listingId = _nextListingId++;
        uint256 expiresAt = duration > 0 ? block.timestamp + duration : 0;

        listings[listingId] = Listing({
            listingId: listingId,
            seller: msg.sender,
            assetType: assetType,
            assetContract: assetContract,
            tokenId: tokenId,
            amount: amount,
            currency: currency,
            customCurrencyAddress: customCurrencyAddress,
            price: price,
            listingType: ListingType.DIRECT,
            status: ListingStatus.ACTIVE,
            createdAt: block.timestamp,
            expiresAt: expiresAt
        });

        tokenListings[assetContract][tokenId] = listingId;

        emit ListingCreated(listingId, msg.sender, assetType, assetContract, tokenId, amount, currency, price);

        return listingId;
    }

    /**
     * @notice Buy a listed asset
     * @param listingId Listing ID to purchase
     * @dev For ETH purchases, send exact amount. For token purchases, must approve first.
     * @custom:security CEI pattern: Update state before external calls to prevent reentrancy
     */
    function buyListing(uint256 listingId) external payable nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.seller == address(0)) revert ListingNotFound();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();
        if (listing.expiresAt > 0 && block.timestamp > listing.expiresAt) revert ListingNotActive();
        if (listing.seller == msg.sender) revert CannotBuyOwnListing();

        // Cache values before state changes
        uint256 price = listing.price;
        address seller = listing.seller;
        AssetType assetType = listing.assetType;
        address assetContract = listing.assetContract;
        uint256 tokenId = listing.tokenId;
        uint256 amount = listing.amount;
        Currency currency = listing.currency;
        address customCurrencyAddress = listing.customCurrencyAddress;

        // Calculate fees
        uint256 platformFee = (price * platformFeeBps) / 10000;
        uint256 creatorRoyalty = 0;

        address creator = creatorAddresses[assetContract];
        if (creator != address(0)) {
            uint256 royaltyBps = creatorRoyaltyBps[assetContract];
            creatorRoyalty = (price * royaltyBps) / 10000;
        }

        uint256 sellerProceeds = price - platformFee - creatorRoyalty;

        // EFFECTS: Update state BEFORE external calls (CEI pattern)
        listing.status = ListingStatus.SOLD;
        delete tokenListings[assetContract][tokenId];

        // Emit event before external calls for transparency
        emit ListingSold(listingId, msg.sender, seller, assetType, amount, price, currency);

        // INTERACTIONS: Handle payment based on currency
        if (currency == Currency.ETH) {
            if (msg.value != price) revert InsufficientPayment();

            // Transfer funds
            _transferETH(feeRecipient, platformFee);
            if (creatorRoyalty > 0 && creator != address(0)) {
                _transferETH(creator, creatorRoyalty);
            }
            _transferETH(seller, sellerProceeds);
        } else {
            // ERC-20 payment
            address tokenAddress = address(0);
            if (currency == Currency.HG) {
                tokenAddress = gameGold;
            } else if (currency == Currency.USDC) {
                tokenAddress = usdc;
            } else if (currency == Currency.CUSTOM_ERC20) {
                tokenAddress = customCurrencyAddress;
            } else {
                revert InvalidCurrency();
            }

            IERC20 token = IERC20(tokenAddress);

            // Transfer tokens from buyer
            token.safeTransferFrom(msg.sender, feeRecipient, platformFee);

            if (creatorRoyalty > 0 && creator != address(0)) {
                token.safeTransferFrom(msg.sender, creator, creatorRoyalty);
            }

            token.safeTransferFrom(msg.sender, seller, sellerProceeds);
        }

        // Transfer asset based on type
        if (assetType == AssetType.ERC721) {
            IERC721(assetContract).transferFrom(seller, msg.sender, tokenId);
        } else if (assetType == AssetType.ERC1155) {
            IERC1155(assetContract).safeTransferFrom(seller, msg.sender, tokenId, amount, "");
        } else if (assetType == AssetType.ERC20) {
            IERC20(assetContract).safeTransferFrom(seller, msg.sender, amount);
        } else {
            revert InvalidAssetType();
        }
    }

    /**
     * @notice Cancel a listing
     * @param listingId Listing ID to cancel
     */
    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.seller != msg.sender) revert NotAssetOwner();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();

        listing.status = ListingStatus.CANCELLED;
        delete tokenListings[listing.assetContract][listing.tokenId];

        emit ListingCancelled(listingId, msg.sender, listing.assetType);
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
        if (newRecipient == address(0)) revert InvalidAssetContract();
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }

    /**
     * @notice Set creator royalty for a collection (owner only)
     * @param assetContract Asset contract address (ERC721/ERC1155/ERC20)
     * @param creator Creator address
     * @param royaltyBps Royalty in basis points (max 10%)
     */
    function setCreatorRoyalty(address assetContract, address creator, uint256 royaltyBps) external onlyOwner {
        if (royaltyBps > 1000) revert InvalidFee(); // Max 10%
        creatorAddresses[assetContract] = creator;
        creatorRoyaltyBps[assetContract] = royaltyBps;
        emit CreatorRoyaltyUpdated(assetContract, royaltyBps);
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
     * @notice Check if an asset is listed
     * @param assetContract Asset contract address (ERC721/ERC1155/ERC20)
     * @param tokenId Token ID (for ERC721/ERC1155, 0 for ERC20)
     * @return listingId Active listing ID, 0 if not listed
     */
    function getTokenListing(address assetContract, uint256 tokenId) external view returns (uint256) {
        uint256 listingId = tokenListings[assetContract][tokenId];
        if (listingId != 0 && listings[listingId].status == ListingStatus.ACTIVE) {
            return listingId;
        }
        return 0;
    }

    // ============ Internal Functions ============

    function _transferETH(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Returns the contract version
     * @return Version string in semver format
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ============ ERC-8004 Integration ============

    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event SellerAgentLinked(uint256 indexed listingId, uint256 indexed agentId);

    /**
     * @notice Set the ERC-8004 Identity Registry
     * @param _identityRegistry Address of the IdentityRegistry contract
     */
    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    /**
     * @notice Link an existing listing to seller's ERC-8004 agent ID
     * @param listingId The listing to link
     * @param agentId The seller's agent ID
     */
    function linkListingToAgent(uint256 listingId, uint256 agentId) external {
        Listing storage listing = listings[listingId];
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotFound();
        if (listing.seller != msg.sender) revert NotAssetOwner();

        if (address(identityRegistry) != address(0)) {
            require(identityRegistry.agentExists(agentId), "Invalid agent ID");
            require(identityRegistry.ownerOf(agentId) == msg.sender, "Not agent owner");
        }

        listingAgentId[listingId] = agentId;
        agentListings[agentId].push(listingId);

        emit SellerAgentLinked(listingId, agentId);
    }

    /**
     * @notice Get all listings by an ERC-8004 agent
     * @param agentId The agent ID to query
     * @return Array of listing IDs
     */
    function getListingsByAgent(uint256 agentId) external view returns (uint256[] memory) {
        return agentListings[agentId];
    }

    /**
     * @notice Check if a listing seller is a verified ERC-8004 agent
     * @param listingId Listing to check
     * @return True if seller is registered as an agent
     */
    function isVerifiedSeller(uint256 listingId) external view returns (bool) {
        uint256 agentId = listingAgentId[listingId];
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }

    /**
     * @notice Get seller's agent ID for a listing
     * @param listingId Listing to query
     * @return agentId The seller's agent ID (0 if not linked)
     */
    function getListingAgentId(uint256 listingId) external view returns (uint256) {
        return listingAgentId[listingId];
    }
}
