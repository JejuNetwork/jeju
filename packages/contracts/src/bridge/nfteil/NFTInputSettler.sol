// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {NFTAssetType, NFT_TRANSFER_ORDER_TYPE, NFTTransferOrderData} from "./INFTEIL.sol";
import {
    IInputSettler, GaslessCrossChainOrder, ResolvedCrossChainOrder, Output, FillInstruction
} from "../../oif/IOIF.sol";
import {BaseInputSettler} from "../../oif/BaseInputSettler.sol";
import {AssetLib} from "../../libraries/AssetLib.sol";

/**
 * @title NFTInputSettler
 * @author Jeju Network
 * @notice OIF InputSettler extension for NFT cross-chain intents
 * @dev Extends BaseInputSettler with ERC721/ERC1155-specific asset handling
 *
 * ## How it works:
 * 1. User submits NFT transfer intent via open() or openFor() (gasless)
 * 2. User's NFT is locked in this contract
 * 3. Solver fills the intent by providing wrapped NFT on destination
 * 4. Oracle attests that wrapped NFT was delivered
 * 5. Once attested, solver can claim locked NFT
 *
 * ## Security:
 * - NFT locked until oracle attestation OR expiry
 * - Users can refund expired intents
 * - Solver must be registered in SolverRegistry
 */
contract NFTInputSettler is BaseInputSettler, IERC721Receiver, IERC1155Receiver {
    // ============ State Variables ============

    /// @notice NFT order storage
    mapping(bytes32 => NFTOrder) public orders;

    // ============ Structs ============

    struct NFTOrder {
        NFTAssetType assetType;
        address collection;
        uint256 tokenId;
        uint256 amount;
        uint256 destinationChainId;
        address recipient;
        bytes32 metadataHash;
    }

    // ============ Events ============

    event NFTOrderCreated(
        bytes32 indexed orderId,
        address indexed user,
        NFTAssetType assetType,
        address collection,
        uint256 tokenId,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        uint32 fillDeadline
    );

    event NFTOrderSettled(bytes32 indexed orderId, address indexed solver);
    event NFTOrderRefunded(bytes32 indexed orderId, address indexed user);

    // ============ Errors ============

    error InvalidRecipient();
    error NotNFTOwner();
    error NFTNotApproved();

    // ============ Constructor ============

    constructor(uint256 _chainId, address _oracle, address _solverRegistry)
        BaseInputSettler(_chainId, _oracle, _solverRegistry)
    {}

    // ============ Asset Handling Implementation ============

    /// @inheritdoc BaseInputSettler
    function _lockAssets(GaslessCrossChainOrder calldata order, address user)
        internal
        override
        returns (bytes32 orderId)
    {
        // Decode NFT order data
        NFTTransferOrderData memory nftData = abi.decode(order.orderData, (NFTTransferOrderData));

        if (nftData.recipient == address(0)) revert InvalidRecipient();

        // Build asset descriptor
        AssetLib.Asset memory asset;
        if (nftData.assetType == NFTAssetType.ERC721) {
            asset = AssetLib.erc721(nftData.collection, nftData.tokenId);
        } else {
            asset = AssetLib.erc1155(nftData.collection, nftData.tokenId, nftData.amount);
        }

        // Validate ownership and approval
        AssetLib.requireOwnershipAndApproval(asset, user, address(this));

        // Generate order ID
        orderId = keccak256(
            abi.encodePacked(
                user,
                order.nonce,
                chainId,
                nftData.collection,
                nftData.tokenId,
                nftData.destinationChainId,
                block.number
            )
        );

        // Lock NFT using AssetLib
        AssetLib.transferFrom(asset, user, address(this));

        // Store order
        orders[orderId] = NFTOrder({
            assetType: nftData.assetType,
            collection: nftData.collection,
            tokenId: nftData.tokenId,
            amount: nftData.amount,
            destinationChainId: nftData.destinationChainId,
            recipient: nftData.recipient,
            metadataHash: nftData.metadataHash
        });

        emit NFTOrderCreated(
            orderId,
            user,
            nftData.assetType,
            nftData.collection,
            nftData.tokenId,
            nftData.amount,
            nftData.destinationChainId,
            nftData.recipient,
            order.fillDeadline
        );
    }

    /// @inheritdoc BaseInputSettler
    function _releaseAssetsToSolver(bytes32 orderId, address solver) internal override {
        NFTOrder storage order = orders[orderId];

        // Build asset and transfer
        AssetLib.Asset memory asset;
        if (order.assetType == NFTAssetType.ERC721) {
            asset = AssetLib.erc721(order.collection, order.tokenId);
        } else {
            asset = AssetLib.erc1155(order.collection, order.tokenId, order.amount);
        }

        AssetLib.safeTransfer(asset, solver);
        emit NFTOrderSettled(orderId, solver);
    }

    /// @inheritdoc BaseInputSettler
    function _refundAssetsToUser(bytes32 orderId) internal override {
        NFTOrder storage order = orders[orderId];
        OrderState storage state = _orderStates[orderId];

        // Build asset and transfer
        AssetLib.Asset memory asset;
        if (order.assetType == NFTAssetType.ERC721) {
            asset = AssetLib.erc721(order.collection, order.tokenId);
        } else {
            asset = AssetLib.erc1155(order.collection, order.tokenId, order.amount);
        }

        AssetLib.safeTransfer(asset, state.user);
        emit NFTOrderRefunded(orderId, state.user);
    }

    /// @inheritdoc BaseInputSettler
    function _buildResolvedOrder(
        GaslessCrossChainOrder calldata order,
        bytes32 orderId,
        address user,
        bytes memory /* originFillerData */
    ) internal view override returns (ResolvedCrossChainOrder memory resolved) {
        NFTOrder storage nftOrder = orders[orderId];

        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(nftOrder.collection))),
            amount: nftOrder.tokenId, // For NFTs, encode tokenId as amount
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: chainId
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(0), // Wrapped collection TBD
            amount: nftOrder.tokenId,
            recipient: bytes32(uint256(uint160(nftOrder.recipient))),
            chainId: nftOrder.destinationChainId
        });

        FillInstruction[] memory fillInstructions = new FillInstruction[](1);
        fillInstructions[0] = FillInstruction({
            destinationChainId: SafeCast.toUint64(nftOrder.destinationChainId),
            destinationSettler: bytes32(0),
            originData: ""
        });

        resolved = ResolvedCrossChainOrder({
            user: user,
            originChainId: chainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fillInstructions
        });
    }

    // ============ View Functions ============

    /// @notice Resolve a gasless order into a full resolved order
    function resolveFor(GaslessCrossChainOrder calldata order, bytes calldata /* originFillerData */ )
        external
        view
        override
        returns (ResolvedCrossChainOrder memory resolved)
    {
        NFTTransferOrderData memory nftData = abi.decode(order.orderData, (NFTTransferOrderData));

        bytes32 orderId = keccak256(
            abi.encodePacked(
                order.user,
                order.nonce,
                chainId,
                nftData.collection,
                nftData.tokenId,
                nftData.destinationChainId,
                block.number
            )
        );

        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(nftData.collection))),
            amount: nftData.tokenId,
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: chainId
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(0),
            amount: nftData.tokenId,
            recipient: bytes32(uint256(uint160(nftData.recipient))),
            chainId: nftData.destinationChainId
        });

        FillInstruction[] memory fillInstructions = new FillInstruction[](1);
        fillInstructions[0] = FillInstruction({
            destinationChainId: SafeCast.toUint64(nftData.destinationChainId),
            destinationSettler: bytes32(0),
            originData: ""
        });

        resolved = ResolvedCrossChainOrder({
            user: order.user,
            originChainId: chainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fillInstructions
        });
    }

    /**
     * @notice Get NFT order details
     * @param orderId Order ID
     * @return order NFT order details
     */
    function getOrder(bytes32 orderId) external view returns (NFTOrder memory) {
        return orders[orderId];
    }

    // ============ ERC721/1155 Receiver ============

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        override
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
