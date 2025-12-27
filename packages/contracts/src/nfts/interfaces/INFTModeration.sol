// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title INFTModeration
 * @author Jeju Network
 * @notice Interface for NFT moderation integration
 * @dev Implement this to add moderation hooks to NFT contracts
 */
interface INFTModeration {
    /// @notice Check if a user is banned from NFT operations
    /// @param user The address to check
    /// @return banned Whether the user is banned
    function isUserBanned(address user) external view returns (bool banned);

    /// @notice Check if a collection is banned
    /// @param collection The collection address to check
    /// @return banned Whether the collection is banned
    function isCollectionBanned(address collection) external view returns (bool banned);

    /// @notice Check if a specific token is banned
    /// @param collection The collection address
    /// @param tokenId The token ID
    /// @return banned Whether the token is banned
    function isTokenBanned(address collection, uint256 tokenId) external view returns (bool banned);
}

/**
 * @title INFTModerationHooks
 * @author Jeju Network
 * @notice Hooks for NFT contracts to call moderation system
 */
interface INFTModerationHooks {
    /// @notice Called before any NFT transfer
    /// @param collection The collection address
    /// @param from The sender
    /// @param to The recipient
    /// @param tokenId The token ID
    /// @return allowed Whether the transfer should proceed
    function beforeTransfer(address collection, address from, address to, uint256 tokenId)
        external
        view
        returns (bool allowed);

    /// @notice Called before NFT minting
    /// @param collection The collection address
    /// @param to The recipient
    /// @param tokenId The token ID
    /// @return allowed Whether the mint should proceed
    function beforeMint(address collection, address to, uint256 tokenId) external view returns (bool allowed);

    /// @notice Called before NFT bridging
    /// @param collection The collection address
    /// @param owner The current owner
    /// @param tokenId The token ID
    /// @param destinationChain The destination chain ID
    /// @return allowed Whether the bridge should proceed
    function beforeBridge(address collection, address owner, uint256 tokenId, uint256 destinationChain)
        external
        view
        returns (bool allowed);
}
