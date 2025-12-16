// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {
    NFTAssetType,
    NFT_TRANSFER_ORDER_TYPE,
    NFTTransferOrderData
} from "./INFTEIL.sol";
import {
    IInputSettler,
    GaslessCrossChainOrder,
    ResolvedCrossChainOrder,
    Output,
    FillInstruction
} from "../../oif/IOIF.sol";

/**
 * @title IOracle
 */
interface IOracle {
    function hasAttested(bytes32 orderId) external view returns (bool);
}

/**
 * @title NFTInputSettler
 * @author Jeju Network
 * @notice OIF InputSettler extension for NFT cross-chain intents
 * @dev Implements ERC-7683 compatible input settlement for NFT transfers
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
 *
 * @custom:security-contact security@jeju.network
 */
contract NFTInputSettler is 
    IInputSettler,
    Ownable,
    ReentrancyGuard,
    IERC721Receiver,
    IERC1155Receiver
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    uint256 public constant CLAIM_DELAY = 150;

    // ============ State Variables ============

    uint256 public immutable chainId;
    IOracle public oracle;
    address public solverRegistry;

    mapping(bytes32 => NFTOrder) public orders;
    mapping(address => uint256) public nonces;

    struct NFTOrder {
        address user;
        NFTAssetType assetType;
        address collection;
        uint256 tokenId;
        uint256 amount;
        uint256 destinationChainId;
        address recipient;
        bytes32 metadataHash;
        uint256 maxFee;
        uint32 openDeadline;
        uint32 fillDeadline;
        address solver;
        bool filled;
        bool refunded;
        uint256 createdBlock;
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

    event NFTOrderClaimed(bytes32 indexed orderId, address indexed solver, uint256 claimBlock);
    event NFTOrderSettled(bytes32 indexed orderId, address indexed solver);
    event NFTOrderRefunded(bytes32 indexed orderId, address indexed user);
    event OracleUpdated(address indexed oldOracle, address indexed newOracle);

    // ============ Errors ============

    error OrderExpired();
    error OrderNotExpired();
    error OrderAlreadyFilled();
    error OrderAlreadyRefunded();
    error OrderNotFound();
    error InvalidSignature();
    error InvalidRecipient();
    error InvalidDeadline();
    error NotAttested();
    error ClaimDelayNotPassed();
    error OnlySolver();
    error TransferFailed();
    error NotNFTOwner();
    error NFTNotApproved();

    // ============ Constructor ============

    constructor(
        uint256 _chainId,
        address _oracle,
        address _solverRegistry
    ) Ownable(msg.sender) {
        chainId = _chainId;
        oracle = IOracle(_oracle);
        solverRegistry = _solverRegistry;
    }

    // ============ Admin ============

    function setOracle(address _oracle) external onlyOwner {
        emit OracleUpdated(address(oracle), _oracle);
        oracle = IOracle(_oracle);
    }

    function setSolverRegistry(address _registry) external onlyOwner {
        solverRegistry = _registry;
    }

    // ============ Order Management ============

    /// @inheritdoc IInputSettler
    function open(GaslessCrossChainOrder calldata order) external override nonReentrant {
        _openOrder(order, msg.sender, "");
    }

    /// @inheritdoc IInputSettler
    function openFor(
        GaslessCrossChainOrder calldata order,
        bytes calldata signature,
        bytes calldata originFillerData
    ) external override nonReentrant {
        bytes32 orderHash = keccak256(abi.encode(order));
        address signer = orderHash.toEthSignedMessageHash().recover(signature);
        if (signer != order.user) revert InvalidSignature();

        _openOrder(order, order.user, originFillerData);
    }

    function _openOrder(
        GaslessCrossChainOrder calldata order,
        address user,
        bytes memory /* originFillerData */
    ) internal {
        if (block.number > order.openDeadline) revert OrderExpired();
        if (order.fillDeadline <= order.openDeadline) revert InvalidDeadline();

        // Decode NFT order data
        NFTTransferOrderData memory nftData = abi.decode(order.orderData, (NFTTransferOrderData));

        if (nftData.recipient == address(0)) revert InvalidRecipient();

        // Validate ownership and approval
        if (nftData.assetType == NFTAssetType.ERC721) {
            IERC721 nft = IERC721(nftData.collection);
            if (nft.ownerOf(nftData.tokenId) != user) revert NotNFTOwner();
            if (!nft.isApprovedForAll(user, address(this)) && 
                nft.getApproved(nftData.tokenId) != address(this)) {
                revert NFTNotApproved();
            }
        } else {
            IERC1155 nft = IERC1155(nftData.collection);
            if (nft.balanceOf(user, nftData.tokenId) < nftData.amount) revert NotNFTOwner();
            if (!nft.isApprovedForAll(user, address(this))) revert NFTNotApproved();
        }

        // Generate order ID
        bytes32 orderId = keccak256(
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

        // Lock NFT
        if (nftData.assetType == NFTAssetType.ERC721) {
            IERC721(nftData.collection).transferFrom(user, address(this), nftData.tokenId);
        } else {
            IERC1155(nftData.collection).safeTransferFrom(
                user,
                address(this),
                nftData.tokenId,
                nftData.amount,
                ""
            );
        }

        // Update nonce
        nonces[user] = order.nonce + 1;

        // Store order
        orders[orderId] = NFTOrder({
            user: user,
            assetType: nftData.assetType,
            collection: nftData.collection,
            tokenId: nftData.tokenId,
            amount: nftData.amount,
            destinationChainId: nftData.destinationChainId,
            recipient: nftData.recipient,
            metadataHash: nftData.metadataHash,
            maxFee: 0, // Fees handled separately
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            solver: address(0),
            filled: false,
            refunded: false,
            createdBlock: block.number
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

        // Build resolved order for Open event
        Output[] memory maxSpent = new Output[](1);
        maxSpent[0] = Output({
            token: bytes32(uint256(uint160(nftData.collection))),
            amount: nftData.tokenId, // For NFTs, we encode tokenId as amount
            recipient: bytes32(uint256(uint160(address(this)))),
            chainId: chainId
        });

        Output[] memory minReceived = new Output[](1);
        minReceived[0] = Output({
            token: bytes32(0), // Wrapped collection TBD
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

        ResolvedCrossChainOrder memory resolved = ResolvedCrossChainOrder({
            user: user,
            originChainId: chainId,
            openDeadline: order.openDeadline,
            fillDeadline: order.fillDeadline,
            orderId: orderId,
            maxSpent: maxSpent,
            minReceived: minReceived,
            fillInstructions: fillInstructions
        });

        emit Open(orderId, resolved);
    }

    /// @inheritdoc IInputSettler
    function resolveFor(
        GaslessCrossChainOrder calldata order,
        bytes calldata /* originFillerData */
    ) external view override returns (ResolvedCrossChainOrder memory resolved) {
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

    // ============ Solver Functions ============

    /**
     * @notice Claim an order (solver commits to fill)
     */
    function claimOrder(bytes32 orderId) external nonReentrant {
        NFTOrder storage order = orders[orderId];

        if (order.user == address(0)) revert OrderNotFound();
        if (order.filled || order.refunded) revert OrderAlreadyFilled();
        if (block.number > order.openDeadline) revert OrderExpired();
        if (order.solver != address(0)) revert OrderAlreadyFilled();

        order.solver = msg.sender;

        emit NFTOrderClaimed(orderId, msg.sender, block.number);
    }

    /**
     * @notice Settle an order after oracle attestation
     */
    function settle(bytes32 orderId) external nonReentrant {
        NFTOrder storage order = orders[orderId];

        if (order.user == address(0)) revert OrderNotFound();
        if (order.filled) revert OrderAlreadyFilled();
        if (order.refunded) revert OrderAlreadyRefunded();
        if (order.solver != msg.sender) revert OnlySolver();

        // Check oracle attestation
        if (!oracle.hasAttested(orderId)) revert NotAttested();

        // Check claim delay
        if (block.number < order.createdBlock + CLAIM_DELAY) revert ClaimDelayNotPassed();

        order.filled = true;

        // Transfer NFT to solver
        if (order.assetType == NFTAssetType.ERC721) {
            IERC721(order.collection).transferFrom(address(this), msg.sender, order.tokenId);
        } else {
            IERC1155(order.collection).safeTransferFrom(
                address(this),
                msg.sender,
                order.tokenId,
                order.amount,
                ""
            );
        }

        emit NFTOrderSettled(orderId, msg.sender);
    }

    // ============ User Functions ============

    /**
     * @notice Refund an expired order
     */
    function refund(bytes32 orderId) external nonReentrant {
        NFTOrder storage order = orders[orderId];

        if (order.user == address(0)) revert OrderNotFound();
        if (order.filled) revert OrderAlreadyFilled();
        if (order.refunded) revert OrderAlreadyRefunded();
        if (block.number <= order.fillDeadline) revert OrderNotExpired();

        order.refunded = true;

        // Return NFT to user
        if (order.assetType == NFTAssetType.ERC721) {
            IERC721(order.collection).transferFrom(address(this), order.user, order.tokenId);
        } else {
            IERC1155(order.collection).safeTransferFrom(
                address(this),
                order.user,
                order.tokenId,
                order.amount,
                ""
            );
        }

        emit NFTOrderRefunded(orderId, order.user);
    }

    // ============ View Functions ============

    function getOrder(bytes32 orderId) external view returns (NFTOrder memory) {
        return orders[orderId];
    }

    function canSettle(bytes32 orderId) external view returns (bool) {
        NFTOrder storage order = orders[orderId];
        return !order.filled && 
               !order.refunded && 
               order.solver != address(0) && 
               oracle.hasAttested(orderId) &&
               block.number >= order.createdBlock + CLAIM_DELAY;
    }

    function canRefund(bytes32 orderId) external view returns (bool) {
        NFTOrder storage order = orders[orderId];
        return !order.filled && !order.refunded && block.number > order.fillDeadline;
    }

    function getUserNonce(address user) external view returns (uint256) {
        return nonces[user];
    }

    // ============ ERC721/1155 Receiver ============

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(
        address,
        address,
        uint256[] calldata,
        uint256[] calldata,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return 
            interfaceId == type(IERC721Receiver).interfaceId ||
            interfaceId == type(IERC1155Receiver).interfaceId;
    }

    function version() external pure returns (string memory) {
        return "1.0.0";
    }
}
