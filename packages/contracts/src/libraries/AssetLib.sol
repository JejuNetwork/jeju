// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title AssetLib
 * @author Jeju Network
 * @notice Library for multi-asset transfers (ETH, ERC20, ERC721, ERC1155)
 */
library AssetLib {
    using SafeERC20 for IERC20;

    /// @notice Asset type enumeration
    enum AssetType {
        NATIVE, // ETH
        ERC20, // Fungible tokens
        ERC721, // Non-fungible tokens
        ERC1155 // Semi-fungible tokens

    }

    /// @notice Asset descriptor for transfers
    struct Asset {
        AssetType assetType;
        address token; // Token contract address (address(0) for NATIVE)
        uint256 tokenId; // Token ID (0 for ERC20/NATIVE, actual ID for NFTs)
        uint256 amount; // Amount (1 for ERC721, actual amount for others)
    }

    // ============ Errors ============

    error InvalidAssetType();
    error InsufficientBalance();
    error NotAssetOwner();
    error AssetNotApproved();
    error TransferFailed();
    error InvalidAmount();
    error InvalidRecipient();

    // ============ Transfer Functions ============

    /**
     * @notice Transfer asset from one address to another
     * @param asset Asset descriptor
     * @param from Source address
     * @param to Destination address
     * @dev For NATIVE, caller must have sent sufficient msg.value
     */
    function transferFrom(Asset memory asset, address from, address to) internal {
        if (to == address(0)) revert InvalidRecipient();

        if (asset.assetType == AssetType.NATIVE) {
            // Native ETH - must be transferred via call
            (bool success,) = to.call{value: asset.amount}("");
            if (!success) revert TransferFailed();
        } else if (asset.assetType == AssetType.ERC20) {
            IERC20(asset.token).safeTransferFrom(from, to, asset.amount);
        } else if (asset.assetType == AssetType.ERC721) {
            IERC721(asset.token).transferFrom(from, to, asset.tokenId);
        } else if (asset.assetType == AssetType.ERC1155) {
            IERC1155(asset.token).safeTransferFrom(from, to, asset.tokenId, asset.amount, "");
        } else {
            revert InvalidAssetType();
        }
    }

    /**
     * @notice Transfer asset from contract to recipient
     * @param asset Asset descriptor
     * @param to Destination address
     */
    function safeTransfer(Asset memory asset, address to) internal {
        if (to == address(0)) revert InvalidRecipient();

        if (asset.assetType == AssetType.NATIVE) {
            (bool success,) = to.call{value: asset.amount}("");
            if (!success) revert TransferFailed();
        } else if (asset.assetType == AssetType.ERC20) {
            IERC20(asset.token).safeTransfer(to, asset.amount);
        } else if (asset.assetType == AssetType.ERC721) {
            IERC721(asset.token).transferFrom(address(this), to, asset.tokenId);
        } else if (asset.assetType == AssetType.ERC1155) {
            IERC1155(asset.token).safeTransferFrom(address(this), to, asset.tokenId, asset.amount, "");
        } else {
            revert InvalidAssetType();
        }
    }

    // ============ Validation Functions ============

    /**
     * @notice Validate ownership of an asset
     * @param asset Asset descriptor
     * @param owner Address to check
     * @return hasOwnership True if owner has sufficient balance/ownership
     */
    function validateOwnership(Asset memory asset, address owner) internal view returns (bool hasOwnership) {
        if (asset.assetType == AssetType.NATIVE) {
            return owner.balance >= asset.amount;
        } else if (asset.assetType == AssetType.ERC20) {
            return IERC20(asset.token).balanceOf(owner) >= asset.amount;
        } else if (asset.assetType == AssetType.ERC721) {
            return IERC721(asset.token).ownerOf(asset.tokenId) == owner;
        } else if (asset.assetType == AssetType.ERC1155) {
            return IERC1155(asset.token).balanceOf(owner, asset.tokenId) >= asset.amount;
        }
        return false;
    }

    /**
     * @notice Validate approval for asset transfer
     * @param asset Asset descriptor
     * @param owner Asset owner
     * @param spender Address that needs approval
     * @return hasApproval True if spender is approved
     */
    function validateApproval(Asset memory asset, address owner, address spender)
        internal
        view
        returns (bool hasApproval)
    {
        if (asset.assetType == AssetType.NATIVE) {
            return true; // Native ETH doesn't need approval
        } else if (asset.assetType == AssetType.ERC20) {
            return IERC20(asset.token).allowance(owner, spender) >= asset.amount;
        } else if (asset.assetType == AssetType.ERC721) {
            return IERC721(asset.token).isApprovedForAll(owner, spender)
                || IERC721(asset.token).getApproved(asset.tokenId) == spender;
        } else if (asset.assetType == AssetType.ERC1155) {
            return IERC1155(asset.token).isApprovedForAll(owner, spender);
        }
        return false;
    }

    /**
     * @notice Validate ownership and approval in one call
     * @param asset Asset descriptor
     * @param owner Asset owner
     * @param spender Address that will transfer
     */
    function requireOwnershipAndApproval(Asset memory asset, address owner, address spender) internal view {
        if (!validateOwnership(asset, owner)) {
            if (asset.assetType == AssetType.ERC721) {
                revert NotAssetOwner();
            } else {
                revert InsufficientBalance();
            }
        }
        if (!validateApproval(asset, owner, spender)) {
            revert AssetNotApproved();
        }
    }

    // ============ Helper Functions ============

    /**
     * @notice Get balance of an asset for an address
     * @param asset Asset descriptor (tokenId used for NFTs)
     * @param owner Address to check
     * @return balance Current balance
     */
    function balanceOf(Asset memory asset, address owner) internal view returns (uint256 balance) {
        if (asset.assetType == AssetType.NATIVE) {
            return owner.balance;
        } else if (asset.assetType == AssetType.ERC20) {
            return IERC20(asset.token).balanceOf(owner);
        } else if (asset.assetType == AssetType.ERC721) {
            return IERC721(asset.token).ownerOf(asset.tokenId) == owner ? 1 : 0;
        } else if (asset.assetType == AssetType.ERC1155) {
            return IERC1155(asset.token).balanceOf(owner, asset.tokenId);
        }
        return 0;
    }

    /**
     * @notice Create an ERC20 asset descriptor
     * @param token Token address
     * @param amount Amount
     */
    function erc20(address token, uint256 amount) internal pure returns (Asset memory) {
        return Asset({assetType: AssetType.ERC20, token: token, tokenId: 0, amount: amount});
    }

    /**
     * @notice Create an ERC721 asset descriptor
     * @param token NFT contract address
     * @param tokenId Token ID
     */
    function erc721(address token, uint256 tokenId) internal pure returns (Asset memory) {
        return Asset({assetType: AssetType.ERC721, token: token, tokenId: tokenId, amount: 1});
    }

    /**
     * @notice Create an ERC1155 asset descriptor
     * @param token Token contract address
     * @param tokenId Token ID
     * @param amount Amount
     */
    function erc1155(address token, uint256 tokenId, uint256 amount) internal pure returns (Asset memory) {
        return Asset({assetType: AssetType.ERC1155, token: token, tokenId: tokenId, amount: amount});
    }

    /**
     * @notice Create a native ETH asset descriptor
     * @param amount Amount in wei
     */
    function native(uint256 amount) internal pure returns (Asset memory) {
        return Asset({assetType: AssetType.NATIVE, token: address(0), tokenId: 0, amount: amount});
    }
}
