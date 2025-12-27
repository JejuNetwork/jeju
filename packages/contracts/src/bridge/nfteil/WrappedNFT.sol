// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {ERC721Royalty} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Royalty.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWrappedNFT, WrappedNFTInfo, ProvenanceEntry, INFTRoyaltyEnforcer} from "./INFTEIL.sol";

/**
 * @title WrappedNFT
 * @author Jeju Network
 * @notice Protocol-owned contract for wrapped NFTs from other chains
 * @dev
 * - Permissionless wrapping: Anyone can wrap NFTs from other chains
 * - Original tokenId preserved: Wrapped token has same tokenId as original
 * - Metadata cached: TokenURI stored on-chain for availability
 * - Provenance tracked: Full cross-chain history recorded
 * - Royalties enforced: Synced from home chain via cross-chain messages
 *
 * This is deployed once per chain by the protocol.
 * Each wrapped NFT stores info about its original (home chain, collection, tokenId).
 *
 * @custom:security-contact security@jejunetwork.org
 */
contract WrappedNFT is ERC721URIStorage, ERC721Royalty, Ownable, ReentrancyGuard, IWrappedNFT, INFTRoyaltyEnforcer {
    // ============ State ============

    /// @notice Wrapped token info: wrappedTokenId => OriginalInfo
    mapping(uint256 => WrappedNFTInfo) public wrappedTokens;

    /// @notice Reverse lookup: hash(homeChainId, collection, tokenId) => wrappedTokenId
    mapping(bytes32 => uint256) public originalToWrapped;

    /// @notice Provenance history per token
    mapping(uint256 => ProvenanceEntry[]) private _provenance;

    /// @notice Whether a tokenId is actively wrapped
    mapping(uint256 => bool) public isTokenWrapped;

    /// @notice Royalty info per original collection: hash(homeChainId, collection) => (receiver, bps)
    mapping(bytes32 => RoyaltyConfig) public collectionRoyalties;

    /// @notice Authorized bridge contracts that can wrap/unwrap
    mapping(address => bool) public authorizedBridges;

    /// @notice Total wrapped tokens
    uint256 public totalWrapped;

    /// @notice Total unwrapped (returned to home chain)
    uint256 public totalUnwrapped;

    struct RoyaltyConfig {
        address receiver;
        uint96 feeBps;
        bool isSet;
    }

    // ============ Events ============

    event BridgeAuthorized(address indexed bridge, bool authorized);

    // ============ Errors ============

    error TokenNotWrapped();
    error TokenAlreadyWrapped();
    error UnauthorizedBridge();
    error InvalidParams();
    error NotTokenOwner();

    // ============ Modifiers ============

    modifier onlyAuthorizedBridge() {
        if (!authorizedBridges[msg.sender] && msg.sender != owner()) {
            revert UnauthorizedBridge();
        }
        _;
    }

    // ============ Constructor ============

    constructor(string memory name_, string memory symbol_, address initialOwner)
        ERC721(name_, symbol_)
        Ownable(initialOwner)
    {}

    // ============ Wrapping ============

    /**
     * @notice Wrap an NFT from another chain
     * @param homeChainId Home chain ID of the original NFT
     * @param originalCollection Original collection address
     * @param originalTokenId Original token ID
     * @param tokenURI_ Token metadata URI
     * @param recipient Address to receive the wrapped NFT
     * @return wrappedTokenId The wrapped token ID (same as originalTokenId)
     * @dev Preserves original tokenId. If tokenId already wrapped, will revert.
     */
    function wrap(
        uint256 homeChainId,
        address originalCollection,
        uint256 originalTokenId,
        string calldata tokenURI_,
        address recipient
    ) external nonReentrant onlyAuthorizedBridge returns (uint256 wrappedTokenId) {
        if (recipient == address(0)) revert InvalidParams();
        if (originalCollection == address(0)) revert InvalidParams();

        // Use same tokenId as original
        wrappedTokenId = originalTokenId;

        // Check not already wrapped
        bytes32 originalKey = _getOriginalKey(homeChainId, originalCollection, originalTokenId);
        if (originalToWrapped[originalKey] != 0 || isTokenWrapped[wrappedTokenId]) {
            revert TokenAlreadyWrapped();
        }

        // Store wrapped info
        wrappedTokens[wrappedTokenId] = WrappedNFTInfo({
            homeChainId: homeChainId,
            originalCollection: originalCollection,
            originalTokenId: originalTokenId,
            tokenURI: tokenURI_,
            metadataHash: keccak256(bytes(tokenURI_)),
            bridgedAt: block.timestamp,
            bridgedBy: msg.sender
        });

        originalToWrapped[originalKey] = wrappedTokenId;
        isTokenWrapped[wrappedTokenId] = true;
        totalWrapped++;

        // Mint to recipient
        _safeMint(recipient, wrappedTokenId);
        _setTokenURI(wrappedTokenId, tokenURI_);

        // Apply collection royalty if set
        bytes32 collectionKey = keccak256(abi.encodePacked(homeChainId, originalCollection));
        RoyaltyConfig storage royalty = collectionRoyalties[collectionKey];
        if (royalty.isSet) {
            _setTokenRoyalty(wrappedTokenId, royalty.receiver, royalty.feeBps);
        }

        // Record provenance
        _recordProvenance(wrappedTokenId, homeChainId, originalCollection, recipient);

        emit NFTWrapped(wrappedTokenId, homeChainId, originalCollection, originalTokenId, recipient);
    }

    /**
     * @notice Unwrap to initiate bridge back to home chain
     * @param tokenId Wrapped token ID to unwrap
     * @dev Burns the wrapped token. Bridge contract handles the actual transfer.
     */
    function unwrap(uint256 tokenId) external nonReentrant {
        if (!isTokenWrapped[tokenId]) revert TokenNotWrapped();
        if (ownerOf(tokenId) != msg.sender) revert NotTokenOwner();

        WrappedNFTInfo storage info = wrappedTokens[tokenId];

        // Record provenance before unwrap
        _recordProvenance(tokenId, block.chainid, address(this), msg.sender);

        // Clear wrapped state
        bytes32 originalKey = _getOriginalKey(info.homeChainId, info.originalCollection, info.originalTokenId);
        delete originalToWrapped[originalKey];
        isTokenWrapped[tokenId] = false;
        totalUnwrapped++;

        // Burn the wrapped token
        _burn(tokenId);

        emit NFTUnwrapped(tokenId, info.homeChainId, info.originalCollection, info.originalTokenId, msg.sender);
    }

    /**
     * @notice Unwrap by authorized bridge (for cross-chain return)
     */
    function unwrapByBridge(uint256 tokenId, address owner) external nonReentrant onlyAuthorizedBridge {
        if (!isTokenWrapped[tokenId]) revert TokenNotWrapped();
        if (ownerOf(tokenId) != owner) revert NotTokenOwner();

        WrappedNFTInfo storage info = wrappedTokens[tokenId];

        bytes32 originalKey = _getOriginalKey(info.homeChainId, info.originalCollection, info.originalTokenId);
        delete originalToWrapped[originalKey];
        isTokenWrapped[tokenId] = false;
        totalUnwrapped++;

        _burn(tokenId);

        emit NFTUnwrapped(tokenId, info.homeChainId, info.originalCollection, info.originalTokenId, owner);
    }

    // ============ View Functions ============

    /**
     * @notice Get original NFT info for a wrapped token
     */
    function getOriginalInfo(uint256 tokenId) external view returns (WrappedNFTInfo memory) {
        if (!isTokenWrapped[tokenId]) revert TokenNotWrapped();
        return wrappedTokens[tokenId];
    }

    /**
     * @notice Get provenance history
     */
    function getProvenance(uint256 tokenId) external view returns (ProvenanceEntry[] memory) {
        return _provenance[tokenId];
    }

    /**
     * @notice Check if tokenId is wrapped
     */
    function isWrapped(uint256 tokenId) external view returns (bool) {
        return isTokenWrapped[tokenId];
    }

    /**
     * @notice Get wrapped tokenId for original NFT
     */
    function getWrappedTokenId(uint256 homeChainId, address originalCollection, uint256 originalTokenId)
        external
        view
        returns (uint256)
    {
        bytes32 key = _getOriginalKey(homeChainId, originalCollection, originalTokenId);
        return originalToWrapped[key];
    }

    // ============ Royalty Functions ============

    /**
     * @notice Set universal royalty for all wrapped NFTs from a collection
     */
    function setUniversalRoyalty(uint256 homeChainId, address originalCollection, address receiver, uint96 feeBps)
        external
        onlyOwner
    {
        bytes32 collectionKey = keccak256(abi.encodePacked(homeChainId, originalCollection));
        collectionRoyalties[collectionKey] = RoyaltyConfig({receiver: receiver, feeBps: feeBps, isSet: true});

        emit RoyaltySet(homeChainId, originalCollection, receiver, feeBps);
    }

    /**
     * @notice Sync royalty from home chain (called by bridge)
     */
    function syncRoyaltyFromHome(
        uint256 homeChainId,
        address originalCollection,
        address receiver,
        uint96 feeBps,
        bytes calldata /* proof */
    ) external onlyAuthorizedBridge {
        bytes32 collectionKey = keccak256(abi.encodePacked(homeChainId, originalCollection));
        collectionRoyalties[collectionKey] = RoyaltyConfig({receiver: receiver, feeBps: feeBps, isSet: true});

        emit RoyaltySet(homeChainId, originalCollection, receiver, feeBps);
        emit RoyaltySynced(homeChainId, originalCollection, keccak256(abi.encodePacked(receiver, feeBps)));
    }

    /**
     * @notice Get royalty info (ERC-2981)
     */
    function getRoyaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address receiver, uint256 royaltyAmount)
    {
        return royaltyInfo(tokenId, salePrice);
    }

    // ============ Admin ============

    /**
     * @notice Authorize a bridge contract
     */
    function authorizeBridge(address bridge, bool authorized) external onlyOwner {
        authorizedBridges[bridge] = authorized;
        emit BridgeAuthorized(bridge, authorized);
    }

    /**
     * @notice Update metadata for a wrapped token (bridge only)
     */
    function updateMetadata(uint256 tokenId, string calldata newURI) external onlyAuthorizedBridge {
        if (!isTokenWrapped[tokenId]) revert TokenNotWrapped();

        _setTokenURI(tokenId, newURI);
        wrappedTokens[tokenId].tokenURI = newURI;
        wrappedTokens[tokenId].metadataHash = keccak256(bytes(newURI));
    }

    // ============ Internal ============

    function _getOriginalKey(uint256 homeChainId, address collection, uint256 tokenId)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(homeChainId, collection, tokenId));
    }

    function _recordProvenance(uint256 tokenId, uint256 chainId, address collection, address owner) internal {
        _provenance[tokenId].push(
            ProvenanceEntry({
                chainId: chainId,
                collection: collection,
                tokenId: tokenId,
                timestamp: block.timestamp,
                txHash: bytes32(0),
                owner: owner
            })
        );

        emit ProvenanceRecorded(tokenId, chainId, collection, block.timestamp, owner);
    }

    // ============ Required Overrides ============

    function tokenURI(uint256 tokenId) public view override(ERC721URIStorage, ERC721) returns (string memory) {
        return ERC721URIStorage.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721URIStorage, ERC721Royalty)
        returns (bool)
    {
        return ERC721URIStorage.supportsInterface(interfaceId) || ERC721Royalty.supportsInterface(interfaceId);
    }

    /**
     * @dev Override _update to hook into state changes (OZ v5 pattern)
     */
    function _update(address to, uint256 tokenId, address auth) internal virtual override returns (address) {
        address previousOwner = super._update(to, tokenId, auth);

        // If burning, reset royalty
        if (to == address(0)) {
            _resetTokenRoyalty(tokenId);
        }

        return previousOwner;
    }

    /**
     * @notice Get wrapped NFT stats
     */
    function getStats()
        external
        view
        returns (uint256 _totalWrapped, uint256 _totalUnwrapped, uint256 activelyWrapped)
    {
        return (totalWrapped, totalUnwrapped, totalWrapped - totalUnwrapped);
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
