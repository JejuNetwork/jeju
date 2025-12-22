// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {INFTPaymaster, NFTVoucherRequest, NFTVoucher, NFTAssetType} from "./INFTEIL.sol";
import {AssetLib} from "../../libraries/AssetLib.sol";

/**
 * @title NFTPaymaster
 * @author Jeju Network
 * @notice EIL-compliant paymaster for trustless cross-chain NFT transfers
 * @dev Uses AssetLib for unified NFT handling and EILUtils for fee calculations
 */
contract NFTPaymaster is 
    INFTPaymaster,
    Ownable,
    ReentrancyGuard,
    IERC721Receiver,
    IERC1155Receiver
{
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ============ Constants ============

    uint256 public constant REQUEST_TIMEOUT = 100;
    uint256 public constant VOUCHER_TIMEOUT = 200;
    uint256 public constant CLAIM_DELAY = 300;
    uint256 public constant MIN_FEE = 0.0001 ether;

    // ============ State Variables ============

    uint256 public immutable chainId;
    address public immutable l1StakeManager;

    mapping(bytes32 => NFTVoucherRequest) public voucherRequests;
    mapping(bytes32 => NFTVoucher) public vouchers;
    mapping(address => uint256) public xlpVerifiedStake;
    mapping(address => mapping(uint256 => mapping(address => address))) public xlpWrappedCollections;
    mapping(address => bool) public supportedCollections;
    uint256 private _requestNonce;
    mapping(bytes32 => bool) public fulfilledVoucherHashes;
    uint256 public totalRequests;
    uint256 public totalNFTsBridged;

    // ============ Errors ============

    error UnsupportedCollection();
    error InvalidRecipient();
    error InvalidFee();
    error RequestExpired();
    error RequestNotExpired();
    error RequestAlreadyClaimed();
    error RequestAlreadyRefunded();
    error VoucherExpiredError();
    error VoucherAlreadyFulfilled();
    error InvalidVoucherSignature();
    error InsufficientXLPStake();
    error ClaimDelayNotPassed();
    error OnlyXLP();
    error TransferFailed();
    error VoucherAlreadyClaimed();
    error WrappedCollectionNotRegistered();

    // ============ Constructor ============

    constructor(uint256 _chainId, address _l1StakeManager) Ownable(msg.sender) {
        chainId = _chainId;
        l1StakeManager = _l1StakeManager;
    }

    // ============ Collection Management ============

    function setSupportedCollection(address collection, bool supported) external onlyOwner {
        supportedCollections[collection] = supported;
    }

    function registerWrappedCollection(
        uint256 sourceChainId,
        address sourceCollection,
        address wrappedCollection
    ) external override {
        xlpWrappedCollections[msg.sender][sourceChainId][sourceCollection] = wrappedCollection;
        emit WrappedCollectionRegistered(sourceChainId, sourceCollection, wrappedCollection);
    }

    function updateXLPStake(address xlp, uint256 stake) external onlyOwner {
        xlpVerifiedStake[xlp] = stake;
    }

    // ============ Voucher Request ============

    function createNFTVoucherRequest(
        NFTAssetType assetType,
        address collection,
        uint256 tokenId,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        uint256 gasOnDestination,
        uint256 maxFee,
        uint256 feeIncrement
    ) external payable nonReentrant override returns (bytes32 requestId) {
        if (!supportedCollections[collection]) revert UnsupportedCollection();
        if (recipient == address(0)) revert InvalidRecipient();
        if (maxFee < MIN_FEE) revert InvalidFee();
        if (msg.value < maxFee) revert InvalidFee();

        // Force amount to 1 for ERC721
        if (assetType == NFTAssetType.ERC721) amount = 1;

        // Build asset and validate using AssetLib
        AssetLib.Asset memory asset = _buildNFTAsset(assetType, collection, tokenId, amount);
        AssetLib.requireOwnershipAndApproval(asset, msg.sender, address(this));

        // Generate request ID
        requestId = keccak256(
            abi.encodePacked(
                msg.sender, collection, tokenId, destinationChainId, 
                block.number, block.timestamp, ++_requestNonce
            )
        );

        // Store request
        voucherRequests[requestId] = NFTVoucherRequest({
            requester: msg.sender,
            assetType: assetType,
            collection: collection,
            tokenId: tokenId,
            amount: amount,
            destinationChainId: destinationChainId,
            recipient: recipient,
            gasOnDestination: gasOnDestination,
            maxFee: maxFee,
            feeIncrement: feeIncrement,
            deadline: block.number + REQUEST_TIMEOUT,
            createdBlock: block.number,
            metadataHash: bytes32(0),
            claimed: false,
            expired: false,
            refunded: false,
            bidCount: 0,
            winningXLP: address(0),
            winningFee: 0
        });

        // Transfer NFT using AssetLib
        AssetLib.transferFrom(asset, msg.sender, address(this));

        // Refund excess ETH
        uint256 excess = msg.value - maxFee;
        if (excess > 0) {
            AssetLib.safeTransfer(AssetLib.native(excess), msg.sender);
        }

        totalRequests++;

        emit NFTVoucherRequested(
            requestId, msg.sender, assetType, collection, tokenId, amount,
            destinationChainId, recipient, maxFee, block.number + REQUEST_TIMEOUT
        );
    }

    function getCurrentFee(bytes32 requestId) public view override returns (uint256 currentFee) {
        NFTVoucherRequest storage request = voucherRequests[requestId];
        if (request.requester == address(0)) return 0;

        uint256 elapsedBlocks = block.number - request.createdBlock;
        currentFee = MIN_FEE + (elapsedBlocks * request.feeIncrement);
        if (currentFee > request.maxFee) currentFee = request.maxFee;
    }

    function refundExpiredRequest(bytes32 requestId) external nonReentrant override {
        NFTVoucherRequest storage request = voucherRequests[requestId];

        if (request.requester == address(0)) revert InvalidRecipient();
        if (request.claimed) revert RequestAlreadyClaimed();
        if (request.refunded) revert RequestAlreadyRefunded();
        if (block.number <= request.deadline) revert RequestNotExpired();

        // Cache values
        address requester = request.requester;
        NFTAssetType assetType = request.assetType;
        address collection = request.collection;
        uint256 tokenId = request.tokenId;
        uint256 amount = request.amount;
        uint256 maxFee = request.maxFee;

        // Update state
        request.expired = true;
        request.refunded = true;

        emit NFTVoucherExpired(requestId, requester);
        emit NFTRefunded(requestId, requester, collection, tokenId, amount);

        // Return NFT using AssetLib
        AssetLib.Asset memory asset = _buildNFTAsset(assetType, collection, tokenId, amount);
        AssetLib.safeTransfer(asset, requester);

        // Return fee
        if (maxFee > 0) {
            AssetLib.safeTransfer(AssetLib.native(maxFee), requester);
        }
    }

    // ============ Voucher Issuance ============

    function issueNFTVoucher(
        bytes32 requestId,
        bytes calldata signature
    ) external nonReentrant override returns (bytes32 voucherId) {
        NFTVoucherRequest storage request = voucherRequests[requestId];

        if (request.requester == address(0)) revert InvalidRecipient();
        if (request.claimed) revert RequestAlreadyClaimed();
        if (request.expired || block.number > request.deadline) revert RequestExpired();

        // Verify XLP has wrapped collection registered
        address wrappedCollection = xlpWrappedCollections[msg.sender][chainId][request.collection];
        if (wrappedCollection == address(0)) revert WrappedCollectionNotRegistered();

        // Verify XLP stake
        uint256 requiredStake = 0.01 ether;
        if (xlpVerifiedStake[msg.sender] < requiredStake) revert InsufficientXLPStake();

        // Calculate fee
        uint256 fee = getCurrentFee(requestId);

        // Generate voucher ID
        voucherId = keccak256(abi.encodePacked(requestId, msg.sender, block.number, signature));

        // Verify signature
        bytes32 commitment = keccak256(
            abi.encodePacked(
                requestId, msg.sender, request.collection, request.tokenId,
                request.amount, fee, request.destinationChainId
            )
        );
        address signer = commitment.toEthSignedMessageHash().recover(signature);
        if (signer != msg.sender) revert InvalidVoucherSignature();

        // Mark request claimed
        request.claimed = true;
        request.winningXLP = msg.sender;
        request.winningFee = fee;

        // Store voucher
        vouchers[voucherId] = NFTVoucher({
            requestId: requestId,
            xlp: msg.sender,
            assetType: request.assetType,
            sourceChainId: chainId,
            destinationChainId: request.destinationChainId,
            sourceCollection: request.collection,
            destinationCollection: wrappedCollection,
            tokenId: request.tokenId,
            amount: request.amount,
            fee: fee,
            gasProvided: request.gasOnDestination,
            issuedBlock: block.number,
            expiresBlock: block.number + VOUCHER_TIMEOUT,
            fulfilled: false,
            slashed: false,
            claimed: false
        });

        totalNFTsBridged++;

        emit NFTVoucherIssued(voucherId, requestId, msg.sender, fee);
    }

    // ============ Voucher Fulfillment ============

    function fulfillNFTVoucher(
        bytes32 voucherId,
        bytes32 requestId,
        address xlp,
        address collection,
        uint256 tokenId,
        uint256 amount,
        address recipient,
        uint256 gasAmount,
        bytes calldata xlpSignature
    ) external nonReentrant override {
        bytes32 voucherHash = keccak256(
            abi.encodePacked(
                voucherId, requestId, xlp, collection, tokenId, amount, recipient, gasAmount, chainId
            )
        );

        if (fulfilledVoucherHashes[voucherHash]) revert VoucherAlreadyFulfilled();

        address signer = voucherHash.toEthSignedMessageHash().recover(xlpSignature);
        if (signer != xlp) revert InvalidVoucherSignature();

        fulfilledVoucherHashes[voucherHash] = true;
        vouchers[voucherId].fulfilled = true;

        emit NFTVoucherFulfilled(voucherId, recipient, collection, tokenId, amount);
    }

    // ============ Claim Source NFT ============

    function claimSourceNFT(bytes32 voucherId) external nonReentrant override {
        NFTVoucher storage voucher = vouchers[voucherId];

        if (voucher.xlp != msg.sender) revert OnlyXLP();
        if (!voucher.fulfilled) revert VoucherExpiredError();
        if (voucher.slashed) revert OnlyXLP();
        if (voucher.claimed) revert VoucherAlreadyClaimed();
        if (block.number < voucher.issuedBlock + CLAIM_DELAY) revert ClaimDelayNotPassed();

        // Cache values
        NFTAssetType assetType = voucher.assetType;
        address collection = voucher.sourceCollection;
        uint256 tokenId = voucher.tokenId;
        uint256 amount = voucher.amount;
        uint256 fee = voucher.fee;

        // Update state
        voucher.claimed = true;

        emit SourceNFTClaimed(voucher.requestId, msg.sender, collection, tokenId, amount, fee);

        // Transfer NFT using AssetLib
        AssetLib.Asset memory asset = _buildNFTAsset(assetType, collection, tokenId, amount);
        AssetLib.safeTransfer(asset, msg.sender);

        // Transfer fee
        if (fee > 0) {
            AssetLib.safeTransfer(AssetLib.native(fee), msg.sender);
        }
    }

    // ============ Internal Functions ============

    function _buildNFTAsset(
        NFTAssetType assetType,
        address collection,
        uint256 tokenId,
        uint256 amount
    ) internal pure returns (AssetLib.Asset memory) {
        if (assetType == NFTAssetType.ERC721) {
            return AssetLib.erc721(collection, tokenId);
        } else {
            return AssetLib.erc1155(collection, tokenId, amount);
        }
    }

    // ============ View Functions ============

    function getRequest(bytes32 requestId) external view override returns (NFTVoucherRequest memory) {
        return voucherRequests[requestId];
    }

    function getVoucher(bytes32 voucherId) external view override returns (NFTVoucher memory) {
        return vouchers[voucherId];
    }

    function canFulfillRequest(bytes32 requestId) external view returns (bool) {
        NFTVoucherRequest storage request = voucherRequests[requestId];
        return request.requester != address(0) && !request.claimed && !request.expired && block.number <= request.deadline;
    }

    function getXLPWrappedCollection(address xlp, uint256 sourceChainId, address sourceCollection) external view returns (address) {
        return xlpWrappedCollections[xlp][sourceChainId][sourceCollection];
    }

    function getStats() external view returns (uint256 _totalRequests, uint256 _totalNFTsBridged) {
        return (totalRequests, totalNFTsBridged);
    }

    // ============ ERC721/1155 Receiver ============

    function onERC721Received(address, address, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure override returns (bytes4) {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure override returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId || interfaceId == type(IERC1155Receiver).interfaceId;
    }

    receive() external payable {}

    function version() external pure returns (string memory) {
        return "2.0.0";
    }
}
