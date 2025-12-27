// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IIdentityRegistry} from "../registry/interfaces/IIdentityRegistry.sol";
import {AssetLib} from "../libraries/AssetLib.sol";
import {ModerationMixin} from "../moderation/ModerationMixin.sol";
import {BlockingMixin} from "../moderation/BlockingMixin.sol";

interface IFeeConfigBazaar {
    function getBazaarFee() external view returns (uint16);
    function getTreasury() external view returns (address);
}

/**
 * @title Marketplace
 * @notice Universal marketplace supporting ERC721, ERC1155, and ERC20 tokens
 */
contract Marketplace is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;
    using ModerationMixin for ModerationMixin.Data;
    using BlockingMixin for BlockingMixin.Data;

    ModerationMixin.Data public moderation;
    BlockingMixin.Data public blocking;

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

    struct Listing {
        uint256 listingId;
        address seller;
        AssetType assetType;
        address assetContract;
        uint256 tokenId;
        uint256 amount;
        Currency currency;
        address customCurrencyAddress;
        uint256 price;
        ListingType listingType;
        ListingStatus status;
        uint256 createdAt;
        uint256 expiresAt;
    }

    uint256 public platformFeeBps = 250;
    uint256 public constant MAX_PLATFORM_FEE_BPS = 1000;
    address public feeRecipient;
    IFeeConfigBazaar public feeConfig;
    uint256 public totalPlatformFeesCollected;
    address public immutable gameGold;
    address public immutable usdc;
    uint256 private _nextListingId = 1;

    mapping(uint256 => Listing) public listings;
    mapping(address => mapping(uint256 => uint256)) public tokenListings;
    mapping(address => uint256) public creatorRoyaltyBps;
    mapping(address => address) public creatorAddresses;
    IIdentityRegistry public identityRegistry;
    mapping(uint256 => uint256) public listingAgentId;
    mapping(uint256 => uint256[]) public agentListings;

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
    event PlatformFeeCollected(uint256 indexed listingId, uint256 amount, uint256 feeBps);
    event FeeConfigUpdated(address indexed oldConfig, address indexed newConfig);
    event IdentityRegistryUpdated(address indexed oldRegistry, address indexed newRegistry);
    event SellerAgentLinked(uint256 indexed listingId, uint256 indexed agentId);

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
    error UserIsBanned();
    error UserBlocked();

    modifier notBanned() {
        if (moderation.isAddressBanned(msg.sender)) revert UserIsBanned();
        _;
    }

    constructor(address initialOwner, address _gameGold, address _usdc, address _feeRecipient) Ownable(initialOwner) {
        if (_gameGold == address(0) || _usdc == address(0) || _feeRecipient == address(0)) {
            revert InvalidAssetContract();
        }

        gameGold = _gameGold;
        usdc = _usdc;
        feeRecipient = _feeRecipient;
    }

    function createListing(
        AssetType assetType,
        address assetContract,
        uint256 tokenId,
        uint256 amount,
        Currency currency,
        address customCurrencyAddress,
        uint256 price,
        uint256 duration
    ) external nonReentrant notBanned returns (uint256) {
        if (price == 0) revert InvalidPrice();
        if (amount == 0) revert InvalidAmount();
        if (assetContract == address(0)) revert InvalidAssetContract();
        if (currency == Currency.CUSTOM_ERC20 && customCurrencyAddress == address(0)) {
            revert InvalidCurrency();
        }

        // Build asset descriptor and validate using AssetLib
        AssetLib.Asset memory asset = _buildAsset(assetType, assetContract, tokenId, amount);
        AssetLib.requireOwnershipAndApproval(asset, msg.sender, address(this));

        // Additional ERC20 tokenId validation
        if (assetType == AssetType.ERC20 && tokenId != 0) revert InvalidAssetType();

        // ERC721 must have amount = 1
        if (assetType == AssetType.ERC721 && amount != 1) revert InvalidAmount();

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

    function buyListing(uint256 listingId) external payable nonReentrant notBanned {
        Listing storage listing = listings[listingId];

        if (listing.seller == address(0)) revert ListingNotFound();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();
        if (listing.expiresAt > 0 && block.timestamp > listing.expiresAt) revert ListingNotActive();
        if (listing.seller == msg.sender) revert CannotBuyOwnListing();

        // Check if seller has blocked the buyer
        if (blocking.isBlocked(msg.sender, listing.seller)) revert UserBlocked();

        // Cache values
        uint256 price = listing.price;
        address seller = listing.seller;
        AssetType assetType = listing.assetType;
        address assetContract = listing.assetContract;
        uint256 tokenId = listing.tokenId;
        uint256 amount = listing.amount;
        Currency currency = listing.currency;
        address customCurrencyAddress = listing.customCurrencyAddress;

        // Calculate fees
        uint256 currentFeeBps = _getPlatformFeeBps();
        uint256 platformFee = (price * currentFeeBps) / 10000;
        uint256 creatorRoyalty = 0;

        address creator = creatorAddresses[assetContract];
        if (creator != address(0)) {
            uint256 royaltyBps = creatorRoyaltyBps[assetContract];
            creatorRoyalty = (price * royaltyBps) / 10000;
        }

        uint256 sellerProceeds = price - platformFee - creatorRoyalty;
        address recipient = _getFeeRecipient();

        // EFFECTS: Update state BEFORE external calls (CEI)
        listing.status = ListingStatus.SOLD;
        delete tokenListings[assetContract][tokenId];
        totalPlatformFeesCollected += platformFee;

        emit ListingSold(listingId, msg.sender, seller, assetType, amount, price, currency);
        emit PlatformFeeCollected(listingId, platformFee, currentFeeBps);

        // INTERACTIONS: Handle payment using AssetLib
        _handlePayment(currency, customCurrencyAddress, price, platformFee, creatorRoyalty, seller, creator, recipient);

        // Transfer asset using AssetLib
        AssetLib.Asset memory asset = _buildAsset(assetType, assetContract, tokenId, amount);
        AssetLib.transferFrom(asset, seller, msg.sender);
    }

    function cancelListing(uint256 listingId) external nonReentrant {
        Listing storage listing = listings[listingId];

        if (listing.seller != msg.sender) revert NotAssetOwner();
        if (listing.status != ListingStatus.ACTIVE) revert ListingNotActive();

        listing.status = ListingStatus.CANCELLED;
        delete tokenListings[listing.assetContract][listing.tokenId];

        emit ListingCancelled(listingId, msg.sender, listing.assetType);
    }

    function setPlatformFee(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_PLATFORM_FEE_BPS) revert InvalidFee();
        platformFeeBps = newFeeBps;
        emit PlatformFeeUpdated(newFeeBps);
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidAssetContract();
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(newRecipient);
    }

    function setFeeConfig(address _feeConfig) external onlyOwner {
        address oldConfig = address(feeConfig);
        feeConfig = IFeeConfigBazaar(_feeConfig);
        emit FeeConfigUpdated(oldConfig, _feeConfig);
    }

    function setCreatorRoyalty(address assetContract, address creator, uint256 royaltyBps) external onlyOwner {
        if (royaltyBps > 1000) revert InvalidFee();
        creatorAddresses[assetContract] = creator;
        creatorRoyaltyBps[assetContract] = royaltyBps;
        emit CreatorRoyaltyUpdated(assetContract, royaltyBps);
    }

    function setIdentityRegistry(address _identityRegistry) external onlyOwner {
        address oldRegistry = address(identityRegistry);
        identityRegistry = IIdentityRegistry(_identityRegistry);
        moderation.setIdentityRegistry(_identityRegistry);
        emit IdentityRegistryUpdated(oldRegistry, _identityRegistry);
    }

    function setBanManager(address _banManager) external onlyOwner {
        moderation.setBanManager(_banManager);
    }

    function setBlockRegistry(address _blockRegistry) external onlyOwner {
        blocking.setBlockRegistry(_blockRegistry);
    }

    function isUserBlocked(address source, address target) external view returns (bool) {
        return blocking.isBlocked(source, target);
    }

    function isUserBanned(address user) external view returns (bool) {
        return moderation.isAddressBanned(user);
    }

    // ============ View Functions ============

    function getEffectivePlatformFee() external view returns (uint256) {
        return _getPlatformFeeBps();
    }

    function getPlatformFeeStats()
        external
        view
        returns (uint256 _totalPlatformFeesCollected, uint256 _currentFeeBps, address _recipient)
    {
        return (totalPlatformFeesCollected, _getPlatformFeeBps(), _getFeeRecipient());
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function getTokenListing(address assetContract, uint256 tokenId) external view returns (uint256) {
        uint256 listingId = tokenListings[assetContract][tokenId];
        if (listingId != 0 && listings[listingId].status == ListingStatus.ACTIVE) {
            return listingId;
        }
        return 0;
    }

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

    function getListingsByAgent(uint256 agentId) external view returns (uint256[] memory) {
        return agentListings[agentId];
    }

    function isVerifiedSeller(uint256 listingId) external view returns (bool) {
        uint256 agentId = listingAgentId[listingId];
        if (agentId == 0) return false;
        if (address(identityRegistry) == address(0)) return false;
        return identityRegistry.agentExists(agentId);
    }

    function getListingAgentId(uint256 listingId) external view returns (uint256) {
        return listingAgentId[listingId];
    }

    function version() external pure returns (string memory) {
        return "2.1.0";
    }

    function _buildAsset(AssetType assetType, address assetContract, uint256 tokenId, uint256 amount)
        internal
        pure
        returns (AssetLib.Asset memory)
    {
        if (assetType == AssetType.ERC721) {
            return AssetLib.erc721(assetContract, tokenId);
        } else if (assetType == AssetType.ERC1155) {
            return AssetLib.erc1155(assetContract, tokenId, amount);
        } else {
            return AssetLib.erc20(assetContract, amount);
        }
    }

    function _handlePayment(
        Currency currency,
        address customCurrencyAddress,
        uint256 price,
        uint256 platformFee,
        uint256 creatorRoyalty,
        address seller,
        address creator,
        address recipient
    ) internal {
        uint256 sellerProceeds = price - platformFee - creatorRoyalty;

        if (currency == Currency.ETH) {
            if (msg.value != price) revert InsufficientPayment();

            AssetLib.safeTransfer(AssetLib.native(platformFee), recipient);
            if (creatorRoyalty > 0 && creator != address(0)) {
                AssetLib.safeTransfer(AssetLib.native(creatorRoyalty), creator);
            }
            AssetLib.safeTransfer(AssetLib.native(sellerProceeds), seller);
        } else {
            address tokenAddress = _getPaymentToken(currency, customCurrencyAddress);
            IERC20 token = IERC20(tokenAddress);

            token.safeTransferFrom(msg.sender, recipient, platformFee);
            if (creatorRoyalty > 0 && creator != address(0)) {
                token.safeTransferFrom(msg.sender, creator, creatorRoyalty);
            }
            token.safeTransferFrom(msg.sender, seller, sellerProceeds);
        }
    }

    function _getPaymentToken(Currency currency, address customCurrencyAddress) internal view returns (address) {
        if (currency == Currency.HG) return gameGold;
        if (currency == Currency.USDC) return usdc;
        if (currency == Currency.CUSTOM_ERC20) return customCurrencyAddress;
        revert InvalidCurrency();
    }

    function _getPlatformFeeBps() internal view returns (uint256) {
        if (address(feeConfig) != address(0)) {
            return feeConfig.getBazaarFee();
        }
        return platformFeeBps;
    }

    function _getFeeRecipient() internal view returns (address) {
        if (address(feeConfig) != address(0)) {
            address configRecipient = feeConfig.getTreasury();
            if (configRecipient != address(0)) {
                return configRecipient;
            }
        }
        return feeRecipient;
    }
}
