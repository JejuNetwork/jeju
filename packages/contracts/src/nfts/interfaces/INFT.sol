// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title INFT
 * @author Jeju Network
 * @notice Core interfaces for Jeju NFT ecosystem
 */

/// @notice NFT asset types
enum NFTAssetType {
    ERC721,
    ERC1155
}

/// @notice Provenance entry for tracking NFT history
struct ProvenanceEntry {
    uint256 chainId;
    uint256 blockNumber;
    uint256 timestamp;
    address from;
    address to;
}

/// @notice Wrapped NFT metadata
struct WrappedNFTInfo {
    bool isWrapped;
    uint256 homeChainId;
    address originalCollection;
    uint256 originalTokenId;
    uint256 wrappedAt;
}

/**
 * @title IProvenanceTracker
 * @notice Track NFT provenance across transfers and chains
 */
interface IProvenanceTracker {
    event ProvenanceRecorded(
        uint256 indexed tokenId,
        uint256 chainId,
        address indexed from,
        address indexed to
    );

    /// @notice Get provenance history for a token
    function getProvenance(uint256 tokenId) external view returns (ProvenanceEntry[] memory);

    /// @notice Get provenance entry count
    function getProvenanceCount(uint256 tokenId) external view returns (uint256);
}

/**
 * @title IRoyaltyEnforcer
 * @notice Enforce ERC-2981 royalties on transfers
 */
interface IRoyaltyEnforcer {
    event RoyaltyPaid(
        address indexed collection,
        uint256 indexed tokenId,
        address indexed receiver,
        uint256 amount
    );

    /// @notice Calculate and distribute royalties
    /// @param collection The NFT collection
    /// @param tokenId The token ID
    /// @param salePrice The sale price
    /// @return receiver The royalty receiver
    /// @return royaltyAmount The royalty amount
    function calculateRoyalty(
        address collection,
        uint256 tokenId,
        uint256 salePrice
    ) external view returns (address receiver, uint256 royaltyAmount);
}

/**
 * @title ICrossChainNFT
 * @notice Interface for cross-chain capable NFTs
 */
interface ICrossChainNFT {
    event NFTBridgeInitiated(
        uint256 indexed tokenId,
        uint32 indexed destinationDomain,
        bytes32 recipient,
        bytes32 messageId
    );

    event NFTBridgeReceived(
        uint256 indexed tokenId,
        uint32 indexed originDomain,
        address indexed recipient
    );

    /// @notice Bridge an NFT to another chain
    /// @param destinationDomain The Hyperlane domain ID
    /// @param recipient The recipient as bytes32
    /// @param tokenId The token to bridge
    /// @return messageId The Hyperlane message ID
    function bridgeNFT(
        uint32 destinationDomain,
        bytes32 recipient,
        uint256 tokenId
    ) external payable returns (bytes32 messageId);

    /// @notice Get quote for bridging
    /// @param destinationDomain The destination domain
    /// @param tokenId The token ID
    /// @return fee The gas fee in native token
    function quoteBridge(uint32 destinationDomain, uint256 tokenId) external view returns (uint256 fee);

    /// @notice Check if a token is currently locked for bridging
    /// @param tokenId The token ID
    /// @return locked Whether the token is locked
    function lockedTokens(uint256 tokenId) external view returns (bool locked);
}

/**
 * @title IGameItems
 * @notice Interface for game items (ERC-1155 with game integration)
 */
interface IGameItems {
    event ItemMinted(
        uint256 indexed itemId,
        address indexed to,
        uint256 amount,
        bytes32 indexed gameId
    );

    event ItemBurned(
        uint256 indexed itemId,
        address indexed from,
        uint256 amount,
        bytes32 indexed gameId
    );

    event ItemTransferred(
        uint256 indexed itemId,
        address indexed from,
        address indexed to,
        uint256 amount
    );

    /// @notice Mint items (only authorized game operators)
    /// @param to Recipient
    /// @param itemId Item type ID
    /// @param amount Number of items
    /// @param gameId The game this item belongs to
    function mintItem(address to, uint256 itemId, uint256 amount, bytes32 gameId) external;

    /// @notice Batch mint items
    /// @param to Recipient
    /// @param itemIds Array of item type IDs
    /// @param amounts Array of amounts
    /// @param gameId The game these items belong to
    function mintBatch(address to, uint256[] calldata itemIds, uint256[] calldata amounts, bytes32 gameId) external;

    /// @notice Burn items (with owner consent)
    /// @param from Owner
    /// @param itemId Item type ID
    /// @param amount Number to burn
    function burnItem(address from, uint256 itemId, uint256 amount) external;

    /// @notice Check if address is authorized game operator
    /// @param operator The address to check
    /// @param gameId The game ID
    /// @return authorized Whether the operator is authorized
    function isGameOperator(address operator, bytes32 gameId) external view returns (bool authorized);
}

/**
 * @title IIdentityNFT
 * @notice Interface for identity-linked NFTs
 */
interface IIdentityNFT {
    /// @notice Get the identity (agent ID) that owns this NFT
    /// @param tokenId The token ID
    /// @return agentId The owning agent's ID (0 if owned by EOA)
    function getOwningIdentity(uint256 tokenId) external view returns (uint256 agentId);

    /// @notice Check if an identity can transfer this NFT
    /// @param agentId The agent ID
    /// @param tokenId The token ID
    /// @return canTransfer Whether the agent can transfer
    function canIdentityTransfer(uint256 agentId, uint256 tokenId) external view returns (bool canTransfer);
}
