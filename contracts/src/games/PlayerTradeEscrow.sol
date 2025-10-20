// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PlayerTradeEscrow
 * @author Jeju Network
 * @notice Secure P2P trading escrow for game tokens and items
 * @dev Escrow system for safe player-to-player trades supporting:
 *      - ERC-20 tokens (Gold)
 *      - ERC-721 NFTs (unique items)
 *      - ERC-1155 tokens (stackable and unique items)
 *      - Multi-asset trades (mix of different token types)
 *      - Atomic execution (all or nothing)
 *      - Review period before confirmation
 *
 * Trade Flow:
 * 1. Player A creates trade with Player B
 * 2. Player A deposits their offered assets
 * 3. Player B deposits their offered assets
 * 4. Both players review and confirm
 * 5. Trade executes atomically
 *
 * Safety Features:
 * - Both players must confirm before execution
 * - Either player can cancel before both confirm
 * - Trades expire after timeout
 * - Assets locked in escrow during trade
 * - Reentrancy protection
 *
 * @custom:security-contact security@jeju.network
 */
contract PlayerTradeEscrow is IERC721Receiver, IERC1155Receiver, ReentrancyGuard, Ownable {
    // ============ Enums ============

    enum TokenType {
        ERC20,
        ERC721,
        ERC1155
    }

    // ============ Structs ============

    /// @notice Trade item struct
    struct TradeItem {
        address tokenContract;    // Token contract address
        uint256 tokenId;          // Token ID (0 for ERC-20, itemId for ERC-721/1155)
        uint256 amount;           // Amount (for ERC-20/1155)
        TokenType tokenType;      // Type of token
    }

    /// @notice Trade struct
    struct Trade {
        uint256 tradeId;
        address playerA;
        address playerB;
        bool playerADeposited;
        bool playerBDeposited;
        bool playerAConfirmed;
        bool playerBConfirmed;
        bool executed;
        bool cancelled;
        uint256 createdAt;
        uint256 expiresAt;
    }

    // ============ Constants ============

    /// @notice Trade expiration time (7 days)
    uint256 public constant TRADE_EXPIRATION = 7 days;

    /// @notice Minimum review time before execution (1 minute)
    uint256 public constant MIN_REVIEW_TIME = 1 minutes;

    // ============ State Variables ============

    /// @notice Counter for trade IDs
    uint256 private _nextTradeId;

    /// @notice Mapping from trade ID to trade
    mapping(uint256 => Trade) public trades;

    /// @notice Mapping from trade ID to player A's items
    mapping(uint256 => TradeItem[]) private _itemsA;

    /// @notice Mapping from trade ID to player B's items
    mapping(uint256 => TradeItem[]) private _itemsB;

    /// @notice Approved token contracts for ERC-20
    mapping(address => bool) public approvedERC20;

    /// @notice Approved NFT contracts for ERC-721
    mapping(address => bool) public approvedERC721;

    /// @notice Approved token contracts for ERC-1155
    mapping(address => bool) public approvedERC1155;

    // ============ Events ============

    event TradeCreated(uint256 indexed tradeId, address indexed playerA, address indexed playerB);
    event ItemsDeposited(uint256 indexed tradeId, address indexed player, uint256 itemCount);
    event TradeConfirmed(uint256 indexed tradeId, address indexed player);
    event TradeExecuted(uint256 indexed tradeId);
    event TradeCancelled(uint256 indexed tradeId, address indexed canceller);
    event ContractApproved(address indexed tokenContract, TokenType tokenType, bool approved);

    // ============ Errors ============

    error Unauthorized();
    error InvalidTrade();
    error TradeExpired();
    error TradeAlreadyCancelled();
    error TradeAlreadyExecuted();
    error AlreadyDeposited();
    error NotDeposited();
    error AlreadyConfirmed();
    error ReviewTimeNotMet();
    error BothMustConfirm();
    error ContractNotApproved();
    error InvalidItem();
    error InvalidTokenType();

    // ============ Constructor ============

    /**
     * @notice Deploy PlayerTradeEscrow
     * @param _owner Contract owner
     */
    constructor(address _owner) Ownable(_owner) {
        _nextTradeId = 1;
    }

    // ============ Trade Creation ============

    /**
     * @notice Create a new trade
     * @param playerB The other player in the trade
     * @return tradeId The created trade ID
     */
    function createTrade(address playerB) external returns (uint256 tradeId) {
        if (playerB == address(0) || playerB == msg.sender) revert InvalidTrade();

        tradeId = _nextTradeId++;
        trades[tradeId] = Trade({
            tradeId: tradeId,
            playerA: msg.sender,
            playerB: playerB,
            playerADeposited: false,
            playerBDeposited: false,
            playerAConfirmed: false,
            playerBConfirmed: false,
            executed: false,
            cancelled: false,
            createdAt: block.timestamp,
            expiresAt: block.timestamp + TRADE_EXPIRATION
        });

        emit TradeCreated(tradeId, msg.sender, playerB);
    }

    // ============ Deposit Functions ============

    /**
     * @notice Deposit items for a trade
     * @param tradeId Trade ID
     * @param items Array of items to deposit
     */
    function depositItems(
        uint256 tradeId,
        TradeItem[] memory items
    ) external nonReentrant {
        Trade storage trade = trades[tradeId];
        _validateTradeActive(trade);

        bool isPlayerA = msg.sender == trade.playerA;
        bool isPlayerB = msg.sender == trade.playerB;
        if (!isPlayerA && !isPlayerB) revert Unauthorized();

        if (isPlayerA && trade.playerADeposited) revert AlreadyDeposited();
        if (isPlayerB && trade.playerBDeposited) revert AlreadyDeposited();

        // Transfer items to escrow
        // Gas optimized: cache array length
        uint256 itemCount = items.length;
        for (uint256 i = 0; i < itemCount; i++) {
            TradeItem memory item = items[i];
            
            if (item.tokenType == TokenType.ERC20) {
                if (!approvedERC20[item.tokenContract]) revert ContractNotApproved();
                if (item.amount == 0) revert InvalidItem();
                
                IERC20(item.tokenContract).transferFrom(msg.sender, address(this), item.amount);
            } else if (item.tokenType == TokenType.ERC721) {
                if (!approvedERC721[item.tokenContract]) revert ContractNotApproved();
                
                IERC721(item.tokenContract).safeTransferFrom(
                    msg.sender,
                    address(this),
                    item.tokenId
                );
            } else if (item.tokenType == TokenType.ERC1155) {
                if (!approvedERC1155[item.tokenContract]) revert ContractNotApproved();
                if (item.amount == 0) revert InvalidItem();
                
                IERC1155(item.tokenContract).safeTransferFrom(
                    msg.sender,
                    address(this),
                    item.tokenId,
                    item.amount,
                    ""
                );
            } else {
                revert InvalidTokenType();
            }

            if (isPlayerA) {
                _itemsA[tradeId].push(item);
            } else {
                _itemsB[tradeId].push(item);
            }
        }

        if (isPlayerA) {
            trade.playerADeposited = true;
        } else {
            trade.playerBDeposited = true;
        }

        emit ItemsDeposited(tradeId, msg.sender, items.length);
    }

    // ============ Confirmation & Execution ============

    /**
     * @notice Confirm trade after reviewing
     * @param tradeId Trade ID
     */
    function confirmTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        _validateTradeActive(trade);

        bool isPlayerA = msg.sender == trade.playerA;
        bool isPlayerB = msg.sender == trade.playerB;
        if (!isPlayerA && !isPlayerB) revert Unauthorized();

        if (!trade.playerADeposited || !trade.playerBDeposited) revert NotDeposited();

        // Require minimum review time
        if (block.timestamp < trade.createdAt + MIN_REVIEW_TIME) {
            revert ReviewTimeNotMet();
        }

        if (isPlayerA) {
            if (trade.playerAConfirmed) revert AlreadyConfirmed();
            trade.playerAConfirmed = true;
        } else {
            if (trade.playerBConfirmed) revert AlreadyConfirmed();
            trade.playerBConfirmed = true;
        }

        emit TradeConfirmed(tradeId, msg.sender);

        // Auto-execute if both confirmed
        if (trade.playerAConfirmed && trade.playerBConfirmed) {
            _executeTrade(tradeId);
        }
    }

    /**
     * @notice Cancel trade
     * @param tradeId Trade ID
     */
    function cancelTrade(uint256 tradeId) external nonReentrant {
        Trade storage trade = trades[tradeId];
        
        if (trade.cancelled) revert TradeAlreadyCancelled();
        if (trade.executed) revert TradeAlreadyExecuted();

        bool isPlayerA = msg.sender == trade.playerA;
        bool isPlayerB = msg.sender == trade.playerB;
        if (!isPlayerA && !isPlayerB) revert Unauthorized();

        // Can't cancel if both confirmed
        if (trade.playerAConfirmed && trade.playerBConfirmed) revert BothMustConfirm();

        trade.cancelled = true;

        // Return deposited items
        if (trade.playerADeposited) {
            _returnItems(tradeId, trade.playerA, _itemsA[tradeId]);
        }
        if (trade.playerBDeposited) {
            _returnItems(tradeId, trade.playerB, _itemsB[tradeId]);
        }

        emit TradeCancelled(tradeId, msg.sender);
    }

    // ============ View Functions ============

    /**
     * @notice Get trade details
     * @param tradeId Trade ID
     * @return Trade struct
     */
    function getTrade(uint256 tradeId) external view returns (Trade memory) {
        return trades[tradeId];
    }

    /**
     * @notice Get trade items
     * @param tradeId Trade ID
     * @return itemsA Player A's items
     * @return itemsB Player B's items
     */
    function getTradeItems(
        uint256 tradeId
    ) external view returns (TradeItem[] memory itemsA, TradeItem[] memory itemsB) {
        return (_itemsA[tradeId], _itemsB[tradeId]);
    }

    // ============ Admin Functions ============

    /**
     * @notice Approve token contract
     * @param tokenContract Contract address
     * @param tokenType Type of token (ERC20, ERC721, ERC1155)
     * @param approved True to approve, false to revoke
     */
    function setContractApproval(
        address tokenContract,
        TokenType tokenType,
        bool approved
    ) external onlyOwner {
        if (tokenType == TokenType.ERC20) {
            approvedERC20[tokenContract] = approved;
        } else if (tokenType == TokenType.ERC721) {
            approvedERC721[tokenContract] = approved;
        } else if (tokenType == TokenType.ERC1155) {
            approvedERC1155[tokenContract] = approved;
        } else {
            revert InvalidTokenType();
        }
        emit ContractApproved(tokenContract, tokenType, approved);
    }

    /**
     * @notice Get contract version
     * @return Version string
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // ============ Internal Functions ============

    /**
     * @notice Execute trade
     * @param tradeId Trade ID
     */
    function _executeTrade(uint256 tradeId) internal {
        Trade storage trade = trades[tradeId];
        trade.executed = true;

        // Transfer player A's items to player B
        _transferItems(tradeId, trade.playerB, _itemsA[tradeId]);

        // Transfer player B's items to player A
        _transferItems(tradeId, trade.playerA, _itemsB[tradeId]);

        emit TradeExecuted(tradeId);
    }

    /**
     * @notice Transfer items to recipient
     * @param recipient Recipient address
     * @param items Items to transfer
     */
    function _transferItems(
        uint256,
        address recipient,
        TradeItem[] storage items
    ) internal {
        // Gas optimized: cache array length
        uint256 itemCount = items.length;
        for (uint256 i = 0; i < itemCount; i++) {
            TradeItem storage item = items[i];
            
            if (item.tokenType == TokenType.ERC20) {
                IERC20(item.tokenContract).transfer(recipient, item.amount);
            } else if (item.tokenType == TokenType.ERC721) {
                IERC721(item.tokenContract).safeTransferFrom(
                    address(this),
                    recipient,
                    item.tokenId
                );
            } else if (item.tokenType == TokenType.ERC1155) {
                IERC1155(item.tokenContract).safeTransferFrom(
                    address(this),
                    recipient,
                    item.tokenId,
                    item.amount,
                    ""
                );
            }
        }
    }

    /**
     * @notice Return items to original owner
     * @param tradeId Trade ID
     * @param owner Owner address
     * @param items Items to return
     */
    function _returnItems(
        uint256 tradeId,
        address owner,
        TradeItem[] storage items
    ) internal {
        _transferItems(tradeId, owner, items);
    }

    /**
     * @notice Validate trade is active
     * @param trade Trade struct
     */
    function _validateTradeActive(Trade storage trade) internal view {
        if (trade.playerA == address(0)) revert InvalidTrade();
        if (trade.cancelled) revert TradeAlreadyCancelled();
        if (trade.executed) revert TradeAlreadyExecuted();
        if (block.timestamp > trade.expiresAt) revert TradeExpired();
    }

    // ============ IERC721Receiver Implementation ============

    /**
     * @notice Handle ERC-721 token receipt
     */
    function onERC721Received(
        address,
        address,
        uint256,
        bytes memory
    ) public pure override returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ============ IERC1155Receiver Implementation ============

    /**
     * @notice Handle ERC-1155 single token receipt
     */
    function onERC1155Received(
        address,
        address,
        uint256,
        uint256,
        bytes memory
    ) public pure override returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    /**
     * @notice Handle ERC-1155 batch token receipt
     */
    function onERC1155BatchReceived(
        address,
        address,
        uint256[] memory,
        uint256[] memory,
        bytes memory
    ) public pure override returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    /**
     * @notice ERC-165 support
     */
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IERC721Receiver).interfaceId 
            || interfaceId == type(IERC1155Receiver).interfaceId;
    }
}
