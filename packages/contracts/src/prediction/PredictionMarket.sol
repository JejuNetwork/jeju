// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.33;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {JejuMath} from "../libraries/JejuMath.sol";

interface IPredictionOracle {
    enum ContestState {
        PENDING,
        ACTIVE,
        GRACE_PERIOD,
        FINISHED,
        CANCELLED
    }

    enum ContestMode {
        SINGLE_WINNER,
        TOP_THREE,
        FULL_RANKING
    }

    function getOutcome(bytes32 sessionId) external view returns (bool outcome, bool finalized);
    function getContestInfo(bytes32 contestId)
        external
        view
        returns (ContestState state, ContestMode mode, uint256 startTime, uint256 endTime, uint256 optionCount);
    function games(bytes32 sessionId)
        external
        view
        returns (
            bytes32 _sessionId,
            string memory question,
            bool outcome,
            bytes32 commitment,
            bytes32 salt,
            uint256 startTime,
            uint256 endTime,
            bytes memory teeQuote,
            address[] memory winners,
            uint256 totalPayout,
            bool finalized
        );
}

/**
 * @title PredictionMarket
 * @notice LMSR-based prediction market for oracle-based games
 * @dev Implements Logarithmic Market Scoring Rule for continuous automated market making
 *
 * Current Implementation: Binary Markets (YES/NO)
 * - Works with any IPredictionOracle implementation
 * - Maps contest results to binary outcomes
 * - Example: "Will Storm or Blaze win?" (horses 2-3 = YES, horses 0-1 = NO)
 *
 * Future Enhancement: Multi-Option Markets
 * - Add support for "Who will win?" with N options
 * - Implement LMSR across all options simultaneously
 * - Example: Thunder | Lightning | Storm | Blaze (4 separate betting pools)
 * - See docs/enhancements/multi-option-lmsr.md for specification
 *
 * Supported Oracle Types:
 * - PredictionOracle.sol (Caliguland)
 * - Contest.sol (eHorse, contests) - maps rankings to binary
 * - Any IPredictionOracle implementation
 */
contract PredictionMarket is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    enum GameType {
        GENERIC, // Generic prediction market
        CALIGULAND, // Caliguland social deduction game
        CONTEST, // Contest oracle (eHorse, tournaments, etc.)
        CUSTOM // Custom oracle game

    }

    enum MarketCategory {
        GENERAL,
        MODERATION_NETWORK_BAN,
        MODERATION_APP_BAN,
        MODERATION_LABEL_HACKER,
        MODERATION_LABEL_SCAMMER,
        MODERATION_APPEAL,
        GOVERNANCE_VETO
    }

    struct ModerationMetadata {
        uint256 targetAgentId;
        bytes32 evidenceHash;
        address reporter;
        uint256 reportId;
    }

    struct Market {
        bytes32 sessionId;
        string question;
        uint256 yesShares;
        uint256 noShares;
        uint256 liquidityParameter;
        uint256 totalVolume;
        uint256 createdAt;
        bool resolved;
        bool outcome;
        GameType gameType; // Type of game for this market
        address gameContract; // Address of game contract (oracle)
        MarketCategory category; // Moderation category
        bool usesTWAP; // SECURITY: Whether to use TWAP for resolution (prevents manipulation)
        uint256 twapStartTime; // When TWAP observation starts
        uint256 twapEndTime; // When TWAP observation ends
    }

    // ============ TWAP Anti-Manipulation System ============
    // SECURITY: Time-Weighted Average Price prevents last-minute manipulation

    struct TWAPObservation {
        uint256 timestamp;
        uint256 yesShares;
        uint256 noShares;
        uint256 cumulativeYes;
        uint256 cumulativeNo;
    }

    /// @notice TWAP observation period (24 hours minimum for futarchy)
    uint256 public constant TWAP_OBSERVATION_PERIOD = 24 hours;

    /// @notice Minimum observations required for valid TWAP
    uint256 public constant MIN_TWAP_OBSERVATIONS = 24;

    /// @notice TWAP observations per market
    mapping(bytes32 => TWAPObservation[]) public twapObservations;

    /// @notice Last observation timestamp per market
    mapping(bytes32 => uint256) public lastTwapUpdate;

    event TWAPObservationRecorded(bytes32 indexed sessionId, uint256 timestamp, uint256 yesShares, uint256 noShares);
    event TWAPResolution(bytes32 indexed sessionId, uint256 avgYesRatio, bool outcome);

    /// @notice Track deposits per market per token (fixes multi-market payout bug)
    mapping(bytes32 => mapping(address => uint256)) public marketTokenDeposits;

    struct Position {
        uint256 yesShares;
        uint256 noShares;
        uint256 totalSpent;
        uint256 totalReceived;
        bool hasClaimed;
    }

    IERC20 public immutable paymentToken; // Default payment token (was elizaOS)
    IPredictionOracle public immutable oracle;
    address public immutable treasury;

    uint256 public constant PLATFORM_FEE = 100; // 1% in basis points
    uint256 public constant BASIS_POINTS = 10000;
    uint256 public constant DEFAULT_LIQUIDITY = 1000 * 1e18; // Default b parameter

    mapping(bytes32 => Market) public markets;
    mapping(bytes32 => mapping(address => Position)) public positions;

    mapping(address => bool) public supportedTokens;
    mapping(address => bool) public authorizedCreators;
    mapping(bytes32 => ModerationMetadata) public moderationMetadata;

    bytes32[] public allMarketIds;

    event MarketCreated(
        bytes32 indexed sessionId, string question, uint256 liquidity, GameType gameType, address indexed gameContract
    );
    event SharesPurchased(
        bytes32 indexed sessionId,
        address indexed trader,
        bool outcome,
        uint256 shares,
        uint256 cost,
        address paymentToken
    );
    event SharesSold(
        bytes32 indexed sessionId,
        address indexed trader,
        bool outcome,
        uint256 shares,
        uint256 payout,
        address paymentToken
    );
    event MarketResolved(bytes32 indexed sessionId, bool outcome);
    event PayoutClaimed(bytes32 indexed sessionId, address indexed trader, uint256 amount);
    event TokenSupportUpdated(address indexed token, bool supported);

    error MarketExists();
    error MarketNotFound();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error InsufficientShares();
    error SlippageTooHigh();
    error NoWinningShares();
    error AlreadyClaimed();
    error UnsupportedPaymentToken();
    error NotAuthorizedCreator();
    error TradingFrozen();

    constructor(address _defaultToken, address _oracle, address _treasury, address _owner) Ownable(_owner) {
        require(_defaultToken != address(0), "Invalid payment token");
        require(_oracle != address(0), "Invalid oracle");
        require(_treasury != address(0), "Invalid treasury");

        paymentToken = IERC20(_defaultToken);
        oracle = IPredictionOracle(_oracle);
        treasury = _treasury;

        // Enable default token
        supportedTokens[_defaultToken] = true;
    }

    function setTokenSupport(address token, bool supported) external onlyOwner {
        require(token != address(0), "Invalid token address");
        supportedTokens[token] = supported;
        emit TokenSupportUpdated(token, supported);
    }

    function elizaOS() external view returns (address) {
        return address(paymentToken);
    }

    /**
     * @notice Create a new prediction market
     * @param sessionId Oracle session ID
     * @param question Market question
     * @param liquidityParameter LMSR liquidity parameter (b)
     */
    function createMarket(bytes32 sessionId, string calldata question, uint256 liquidityParameter) external onlyOwner {
        _createMarketWithType(
            sessionId, question, liquidityParameter, GameType.GENERIC, address(oracle), MarketCategory.GENERAL
        );
    }

    function createModerationMarket(
        bytes32 sessionId,
        string calldata question,
        uint256 liquidityParameter,
        MarketCategory category,
        ModerationMetadata calldata metadata
    ) external {
        if (!authorizedCreators[msg.sender]) revert NotAuthorizedCreator();
        _createMarketWithType(sessionId, question, liquidityParameter, GameType.GENERIC, address(oracle), category);
        moderationMetadata[sessionId] = metadata;
    }

    function createMarketWithType(
        bytes32 sessionId,
        string calldata question,
        uint256 liquidityParameter,
        GameType gameType,
        address gameContract
    ) external onlyOwner {
        _createMarketWithType(sessionId, question, liquidityParameter, gameType, gameContract, MarketCategory.GENERAL);
    }

    function _createMarketWithType(
        bytes32 sessionId,
        string calldata question,
        uint256 liquidityParameter,
        GameType gameType,
        address gameContract,
        MarketCategory category
    ) private {
        if (markets[sessionId].createdAt != 0) revert MarketExists();
        if (liquidityParameter == 0) {
            liquidityParameter = DEFAULT_LIQUIDITY;
        }

        markets[sessionId] = Market({
            sessionId: sessionId,
            question: question,
            yesShares: 0,
            noShares: 0,
            liquidityParameter: liquidityParameter,
            totalVolume: 0,
            createdAt: block.timestamp,
            resolved: false,
            outcome: false,
            gameType: gameType,
            gameContract: gameContract,
            category: category,
            usesTWAP: false,
            twapStartTime: 0,
            twapEndTime: 0
        });

        allMarketIds.push(sessionId);
        emit MarketCreated(sessionId, question, liquidityParameter, gameType, gameContract);
    }

    function _isTradingFrozen(Market storage market) internal view returns (bool) {
        if (market.gameType != GameType.CONTEST || market.gameContract == address(0)) {
            return false;
        }
        (IPredictionOracle.ContestState state,,,,) =
            IPredictionOracle(market.gameContract).getContestInfo(market.sessionId);
        return state == IPredictionOracle.ContestState.GRACE_PERIOD;
    }

    /**
     * @notice Buy shares in a market with any supported token
     * @param sessionId Market ID
     * @param outcome true for YES, false for NO
     * @param tokenAmount Amount of tokens to spend
     * @param minShares Minimum shares to receive (slippage protection)
     * @param token Payment token (elizaOS, CLANKER, VIRTUAL, or CLANKERMON)
     * @return shares Number of shares purchased
     */
    function buy(bytes32 sessionId, bool outcome, uint256 tokenAmount, uint256 minShares, address token)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        Market storage market = markets[sessionId];
        if (market.createdAt == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();
        if (!supportedTokens[token]) revert UnsupportedPaymentToken();
        if (_isTradingFrozen(market)) revert TradingFrozen();

        // Calculate shares received
        shares = calculateSharesReceived(sessionId, outcome, tokenAmount);
        if (shares < minShares) revert SlippageTooHigh();

        // Transfer tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);

        // Track deposits per market per token
        marketTokenDeposits[sessionId][token] += tokenAmount;

        // Update market state
        if (outcome) {
            market.yesShares += shares;
        } else {
            market.noShares += shares;
        }
        market.totalVolume += tokenAmount;

        // Update user position
        Position storage position = positions[sessionId][msg.sender];
        if (outcome) {
            position.yesShares += shares;
        } else {
            position.noShares += shares;
        }
        position.totalSpent += tokenAmount;

        emit SharesPurchased(sessionId, msg.sender, outcome, shares, tokenAmount, token);
    }

    function buy(bytes32 sessionId, bool outcome, uint256 tokenAmount, uint256 minShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 shares)
    {
        Market storage market = markets[sessionId];
        if (market.createdAt == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();
        if (_isTradingFrozen(market)) revert TradingFrozen();

        address token = address(paymentToken);

        shares = calculateSharesReceived(sessionId, outcome, tokenAmount);
        if (shares < minShares) revert SlippageTooHigh();

        // Transfer tokens from user
        IERC20(token).safeTransferFrom(msg.sender, address(this), tokenAmount);

        // Track deposits per market per token
        marketTokenDeposits[sessionId][token] += tokenAmount;

        // Update market state
        if (outcome) {
            market.yesShares += shares;
        } else {
            market.noShares += shares;
        }
        market.totalVolume += tokenAmount;

        // Update user position
        Position storage position = positions[sessionId][msg.sender];
        if (outcome) {
            position.yesShares += shares;
        } else {
            position.noShares += shares;
        }
        position.totalSpent += tokenAmount;

        emit SharesPurchased(sessionId, msg.sender, outcome, shares, tokenAmount, token);
    }

    function sell(
        bytes32 sessionId,
        bool outcome,
        uint256 shareAmount,
        uint256 minPayout,
        address token,
        uint256 deadline
    ) external nonReentrant whenNotPaused returns (uint256 payout) {
        require(block.timestamp <= deadline, "Transaction expired");

        Market storage market = markets[sessionId];
        if (market.createdAt == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();
        if (!supportedTokens[token]) revert UnsupportedPaymentToken();
        if (_isTradingFrozen(market)) revert TradingFrozen();

        Position storage position = positions[sessionId][msg.sender];

        // Check user has enough shares
        if (outcome && position.yesShares < shareAmount) revert InsufficientShares();
        if (!outcome && position.noShares < shareAmount) revert InsufficientShares();

        // Calculate payout
        payout = calculatePayout(sessionId, outcome, shareAmount);
        if (payout < minPayout) revert SlippageTooHigh();

        // Update market state
        if (outcome) {
            market.yesShares -= shareAmount;
        } else {
            market.noShares -= shareAmount;
        }

        // Update user position
        if (outcome) {
            position.yesShares -= shareAmount;
        } else {
            position.noShares -= shareAmount;
        }
        position.totalReceived += payout;

        marketTokenDeposits[sessionId][token] -= payout;

        IERC20(token).safeTransfer(msg.sender, payout);

        emit SharesSold(sessionId, msg.sender, outcome, shareAmount, payout, token);
    }

    /**
     * @notice Sell shares with default payment token (simple 4-param version)
     */
    function sell(bytes32 sessionId, bool outcome, uint256 shareAmount, uint256 minPayout)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 payout)
    {
        Market storage market = markets[sessionId];
        if (market.createdAt == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();
        if (_isTradingFrozen(market)) revert TradingFrozen();

        address token = address(paymentToken);

        Position storage position = positions[sessionId][msg.sender];

        if (outcome && position.yesShares < shareAmount) revert InsufficientShares();
        if (!outcome && position.noShares < shareAmount) revert InsufficientShares();

        payout = calculatePayout(sessionId, outcome, shareAmount);
        if (payout < minPayout) revert SlippageTooHigh();

        if (outcome) {
            market.yesShares -= shareAmount;
        } else {
            market.noShares -= shareAmount;
        }

        if (outcome) {
            position.yesShares -= shareAmount;
        } else {
            position.noShares -= shareAmount;
        }
        position.totalReceived += payout;

        marketTokenDeposits[sessionId][token] -= payout;

        IERC20(token).safeTransfer(msg.sender, payout);

        emit SharesSold(sessionId, msg.sender, outcome, shareAmount, payout, token);
    }

    /**
     * @notice Resolve market based on oracle outcome
     * @param sessionId Market ID
     */
    function resolveMarket(bytes32 sessionId) external nonReentrant {
        Market storage market = markets[sessionId];
        if (market.createdAt == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();

        (bool oracleOutcome, bool finalized) = oracle.getOutcome(sessionId);
        require(finalized, "Oracle not finalized");

        market.resolved = true;
        market.outcome = oracleOutcome;

        emit MarketResolved(sessionId, oracleOutcome);
    }

    function claimPayout(bytes32 sessionId, address token) external nonReentrant returns (uint256 payout) {
        Market storage market = markets[sessionId];
        if (!market.resolved) revert MarketNotResolved();
        if (!supportedTokens[token]) revert UnsupportedPaymentToken();

        Position storage position = positions[sessionId][msg.sender];
        if (position.hasClaimed) revert AlreadyClaimed();

        // Calculate payout based on winning shares
        uint256 winningShares = market.outcome ? position.yesShares : position.noShares;
        if (winningShares == 0) revert NoWinningShares();

        uint256 totalWinningShares = market.outcome ? market.yesShares : market.noShares;

        // Use market-specific pool instead of entire contract balance
        uint256 marketPool = marketTokenDeposits[sessionId][token];
        uint256 platformFeeAmount = (marketPool * PLATFORM_FEE) / BASIS_POINTS;
        uint256 payoutPool = marketPool - platformFeeAmount;

        payout = (payoutPool * winningShares) / totalWinningShares;
        position.hasClaimed = true;

        // Update market deposits
        marketTokenDeposits[sessionId][token] -= (payout + platformFeeAmount);

        // Transfer platform fee to treasury
        IERC20(token).safeTransfer(treasury, platformFeeAmount);

        // Transfer payout to user
        IERC20(token).safeTransfer(msg.sender, payout);

        emit PayoutClaimed(sessionId, msg.sender, payout);
    }

    function claimPayout(bytes32 sessionId) external nonReentrant returns (uint256 payout) {
        Market storage market = markets[sessionId];
        if (!market.resolved) revert MarketNotResolved();

        address token = address(paymentToken);

        Position storage position = positions[sessionId][msg.sender];
        if (position.hasClaimed) revert AlreadyClaimed();

        uint256 winningShares = market.outcome ? position.yesShares : position.noShares;
        if (winningShares == 0) revert NoWinningShares();

        uint256 totalWinningShares = market.outcome ? market.yesShares : market.noShares;

        uint256 marketPool = marketTokenDeposits[sessionId][token];
        uint256 platformFeeAmount = (marketPool * PLATFORM_FEE) / BASIS_POINTS;
        uint256 payoutPool = marketPool - platformFeeAmount;

        payout = (payoutPool * winningShares) / totalWinningShares;
        position.hasClaimed = true;

        marketTokenDeposits[sessionId][token] -= (payout + platformFeeAmount);

        IERC20(token).safeTransfer(treasury, platformFeeAmount);
        IERC20(token).safeTransfer(msg.sender, payout);

        emit PayoutClaimed(sessionId, msg.sender, payout);
    }

    function calculateSharesReceived(bytes32 sessionId, bool outcome, uint256 elizaOSAmount)
        public
        view
        returns (uint256 shares)
    {
        Market storage market = markets[sessionId];
        uint256 b = market.liquidityParameter;
        uint256 qYes = market.yesShares;
        uint256 qNo = market.noShares;

        uint256 costBefore = _costFunction(qYes, qNo, b);

        uint256 low = 0;
        uint256 high = elizaOSAmount * 10; // Upper bound estimate
        uint256 targetCost = costBefore + elizaOSAmount;

        while (low < high) {
            uint256 mid = (low + high + 1) / 2;
            uint256 newQYes = outcome ? qYes + mid : qYes;
            uint256 newQNo = outcome ? qNo : qNo + mid;
            uint256 costAfter = _costFunction(newQYes, newQNo, b);

            if (costAfter <= targetCost) {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        shares = low;
    }

    function calculatePayout(bytes32 sessionId, bool outcome, uint256 shareAmount)
        public
        view
        returns (uint256 payout)
    {
        Market storage market = markets[sessionId];
        uint256 b = market.liquidityParameter;
        uint256 qYes = market.yesShares;
        uint256 qNo = market.noShares;

        uint256 costBefore = _costFunction(qYes, qNo, b);

        uint256 newQYes = outcome ? qYes - shareAmount : qYes;
        uint256 newQNo = outcome ? qNo : qNo - shareAmount;
        uint256 costAfter = _costFunction(newQYes, newQNo, b);

        payout = costBefore - costAfter;
    }

    function getMarketPrices(bytes32 sessionId) external view returns (uint256 yesPrice, uint256 noPrice) {
        Market storage market = markets[sessionId];
        uint256 b = market.liquidityParameter;
        uint256 qYes = market.yesShares;
        uint256 qNo = market.noShares;

        yesPrice = JejuMath.lmsrPrice(qYes, qNo, b, true);
        noPrice = JejuMath.lmsrPrice(qYes, qNo, b, false);
    }

    function getMarket(bytes32 sessionId) external view returns (Market memory) {
        return markets[sessionId];
    }

    function getPosition(bytes32 sessionId, address trader) external view returns (Position memory) {
        return positions[sessionId][trader];
    }

    function isMarketResolved(bytes32 sessionId) external view returns (bool resolved, bool outcome) {
        Market storage market = markets[sessionId];
        return (market.resolved, market.outcome);
    }

    function getMarketCount() external view returns (uint256) {
        return allMarketIds.length;
    }

    function getMarketIdAt(uint256 index) external view returns (bytes32) {
        return allMarketIds[index];
    }

    function _costFunction(uint256 qYes, uint256 qNo, uint256 b) internal pure returns (uint256) {
        return JejuMath.lmsrCost(qYes, qNo, b);
    }

    function _exp(uint256 x) internal pure returns (uint256) {
        if (x == 0) return JejuMath.PRECISION;
        if (x > JejuMath.MAX_EXP_INPUT) return type(uint256).max / JejuMath.PRECISION;
        return JejuMath.exp(x);
    }

    /**
     * @notice Wrapper for JejuMath.ln
     */
    function _ln(uint256 x) internal pure returns (uint256) {
        return JejuMath.ln(x);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function version() external pure returns (string memory) {
        return "2.0.0";
    }

    function getMarketsByGameType(GameType gameType) external view returns (bytes32[] memory) {
        uint256 count = 0;
        uint256 length = allMarketIds.length;
        for (uint256 i = 0; i < length; i++) {
            if (markets[allMarketIds[i]].gameType == gameType) {
                count++;
            }
        }

        bytes32[] memory filtered = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].gameType == gameType) {
                filtered[index++] = allMarketIds[i];
            }
        }

        return filtered;
    }

    function getMarketsByGame(address gameContract) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].gameContract == gameContract) {
                count++;
            }
        }

        bytes32[] memory filtered = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].gameContract == gameContract) {
                filtered[index++] = allMarketIds[i];
            }
        }

        return filtered;
    }

    function getMarketsByCategory(MarketCategory category) external view returns (bytes32[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].category == category) {
                count++;
            }
        }

        bytes32[] memory filtered = new bytes32[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < allMarketIds.length; i++) {
            if (markets[allMarketIds[i]].category == category) {
                filtered[index++] = allMarketIds[i];
            }
        }

        return filtered;
    }

    function addAuthorizedCreator(address creator) external onlyOwner {
        authorizedCreators[creator] = true;
    }

    function removeAuthorizedCreator(address creator) external onlyOwner {
        authorizedCreators[creator] = false;
    }

    function getModerationMetadata(bytes32 sessionId) external view returns (ModerationMetadata memory) {
        return moderationMetadata[sessionId];
    }

    // ═══════════════════════════════════════════════════════════════════════
    //                         TWAP ANTI-MANIPULATION SYSTEM
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * @notice Enable TWAP for a market (must be done before resolution)
     * @dev Used for futarchy and governance markets to prevent manipulation
     * @param sessionId Market to enable TWAP for
     */
    function enableMarketTWAP(bytes32 sessionId) external {
        Market storage market = markets[sessionId];
        if (market.createdAt == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();
        
        // Only authorized creators (governance contracts) can enable TWAP
        if (!authorizedCreators[msg.sender]) revert NotAuthorizedCreator();
        
        market.usesTWAP = true;
        market.twapStartTime = block.timestamp;
        market.twapEndTime = block.timestamp + TWAP_OBSERVATION_PERIOD;
        
        // Record initial observation
        _recordTWAPObservation(sessionId);
    }

    /**
     * @notice Record a TWAP observation (can be called by anyone)
     * @dev Incentivized by the protocol - keepers can earn rewards
     * @param sessionId Market to observe
     */
    function recordTWAPObservation(bytes32 sessionId) external {
        Market storage market = markets[sessionId];
        if (!market.usesTWAP) revert("TWAP not enabled");
        if (market.resolved) revert MarketAlreadyResolved();
        
        // Minimum 1 hour between observations to prevent spam
        uint256 minInterval = 1 hours;
        if (block.timestamp < lastTwapUpdate[sessionId] + minInterval) {
            revert("Too soon");
        }
        
        _recordTWAPObservation(sessionId);
    }

    /**
     * @notice Internal function to record TWAP observation
     */
    function _recordTWAPObservation(bytes32 sessionId) internal {
        Market storage market = markets[sessionId];
        
        TWAPObservation[] storage observations = twapObservations[sessionId];
        uint256 len = observations.length;
        
        uint256 cumulativeYes = len > 0 ? observations[len - 1].cumulativeYes : 0;
        uint256 cumulativeNo = len > 0 ? observations[len - 1].cumulativeNo : 0;
        
        // Time-weighted accumulation
        if (len > 0) {
            uint256 elapsed = block.timestamp - observations[len - 1].timestamp;
            cumulativeYes += market.yesShares * elapsed;
            cumulativeNo += market.noShares * elapsed;
        }
        
        observations.push(TWAPObservation({
            timestamp: block.timestamp,
            yesShares: market.yesShares,
            noShares: market.noShares,
            cumulativeYes: cumulativeYes,
            cumulativeNo: cumulativeNo
        }));
        
        lastTwapUpdate[sessionId] = block.timestamp;
        
        emit TWAPObservationRecorded(sessionId, block.timestamp, market.yesShares, market.noShares);
    }

    /**
     * @notice Resolve a TWAP-enabled market using time-weighted average
     * @dev Prevents last-minute manipulation by using average price over 24h
     * @param sessionId Market to resolve
     */
    function resolveMarketWithTWAP(bytes32 sessionId) external nonReentrant {
        Market storage market = markets[sessionId];
        if (market.createdAt == 0) revert MarketNotFound();
        if (market.resolved) revert MarketAlreadyResolved();
        if (!market.usesTWAP) revert("Use resolveMarket instead");
        if (block.timestamp < market.twapEndTime) revert("TWAP period not ended");
        
        TWAPObservation[] storage observations = twapObservations[sessionId];
        if (observations.length < MIN_TWAP_OBSERVATIONS) revert("Insufficient observations");
        
        // Record final observation
        _recordTWAPObservation(sessionId);
        
        // Calculate TWAP
        uint256 len = observations.length;
        TWAPObservation storage first = observations[0];
        TWAPObservation storage last = observations[len - 1];
        
        uint256 totalTime = last.timestamp - first.timestamp;
        if (totalTime == 0) revert("Invalid TWAP period");
        
        uint256 avgYes = (last.cumulativeYes - first.cumulativeYes) / totalTime;
        uint256 avgNo = (last.cumulativeNo - first.cumulativeNo) / totalTime;
        
        // Resolve based on which side had higher average weight
        // YES wins if avgYes / (avgYes + avgNo) > 0.5
        bool outcome = avgYes > avgNo;
        
        market.resolved = true;
        market.outcome = outcome;
        
        // Calculate the ratio for logging (scaled to basis points)
        uint256 totalAvg = avgYes + avgNo;
        uint256 yesRatioBps = totalAvg > 0 ? (avgYes * 10000) / totalAvg : 5000;
        
        emit TWAPResolution(sessionId, yesRatioBps, outcome);
        emit MarketResolved(sessionId, outcome);
    }

    /**
     * @notice Get current TWAP data for a market
     */
    function getTWAPData(bytes32 sessionId) external view returns (
        uint256 observationCount,
        uint256 currentAvgYes,
        uint256 currentAvgNo,
        uint256 twapStartTime,
        uint256 twapEndTime,
        bool ready
    ) {
        Market storage market = markets[sessionId];
        TWAPObservation[] storage observations = twapObservations[sessionId];
        
        observationCount = observations.length;
        twapStartTime = market.twapStartTime;
        twapEndTime = market.twapEndTime;
        ready = observationCount >= MIN_TWAP_OBSERVATIONS && block.timestamp >= market.twapEndTime;
        
        if (observationCount >= 2) {
            TWAPObservation storage first = observations[0];
            TWAPObservation storage last = observations[observationCount - 1];
            
            uint256 totalTime = last.timestamp - first.timestamp;
            if (totalTime > 0) {
                currentAvgYes = (last.cumulativeYes - first.cumulativeYes) / totalTime;
                currentAvgNo = (last.cumulativeNo - first.cumulativeNo) / totalTime;
            }
        }
    }
}
