// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ILiquidationEngine, IPerpetualMarket, IInsuranceFund, IMarginManager} from "./interfaces/IPerpetualMarket.sol";

/**
 * @title LiquidationEngine
 * @notice Manages liquidations for perpetual positions
 */
contract LiquidationEngine is ILiquidationEngine, Ownable, ReentrancyGuard {
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant HEALTH_PRECISION = 1e18;

    IPerpetualMarket public perpMarket;
    IMarginManager public marginManager;
    IInsuranceFund public insuranceFund;

    // Liquidation parameters
    uint256 public liquidationBonusBps = 500; // 5% to liquidators
    uint256 public insuranceFeeBps = 200; // 2% to insurance fund
    uint256 public maxLiquidationSizeBps = 5000; // Max 50% of position per liquidation

    // Stats
    uint256 public totalLiquidations;
    uint256 public totalLiquidatedVolume;
    uint256 public totalLiquidatorRewards;
    uint256 public totalInsuranceFees;
    uint256 public totalBadDebt;

    // Keeper tracking
    mapping(address => uint256) public keeperLiquidations;
    mapping(address => uint256) public keeperRewards;

    error PositionNotLiquidatable();
    error EmptyBatch();
    error OnlyPerpMarket();

    constructor(address _perpMarket, address _marginManager, address _insuranceFund, address initialOwner)
        Ownable(initialOwner)
    {
        perpMarket = IPerpetualMarket(_perpMarket);
        marginManager = IMarginManager(_marginManager);
        insuranceFund = IInsuranceFund(_insuranceFund);
    }

    function liquidate(bytes32 positionId) external nonReentrant returns (uint256 reward) {
        // Check if liquidatable
        (bool canLiq,) = perpMarket.isLiquidatable(positionId);
        if (!canLiq) revert PositionNotLiquidatable();

        // Get position details
        IPerpetualMarket.Position memory position = perpMarket.getPosition(positionId);

        // Execute liquidation through perp market
        reward = perpMarket.liquidate(positionId);

        // Update stats
        totalLiquidations++;
        totalLiquidatedVolume += position.size;
        totalLiquidatorRewards += reward;

        keeperLiquidations[msg.sender]++;
        keeperRewards[msg.sender] += reward;

        emit LiquidationExecuted(
            positionId,
            msg.sender,
            perpMarket.getMarkPrice(position.marketId),
            reward,
            (position.margin * insuranceFeeBps) / BPS_DENOMINATOR
        );

        return reward;
    }

    function batchLiquidate(bytes32[] calldata positionIds) external nonReentrant returns (uint256[] memory rewards) {
        if (positionIds.length == 0) revert EmptyBatch();

        rewards = new uint256[](positionIds.length);

        for (uint256 i = 0; i < positionIds.length; i++) {
            (bool canLiq,) = perpMarket.isLiquidatable(positionIds[i]);

            if (canLiq) {
                IPerpetualMarket.Position memory position = perpMarket.getPosition(positionIds[i]);

                rewards[i] = perpMarket.liquidate(positionIds[i]);

                totalLiquidations++;
                totalLiquidatedVolume += position.size;
                totalLiquidatorRewards += rewards[i];

                keeperLiquidations[msg.sender]++;
                keeperRewards[msg.sender] += rewards[i];

                emit LiquidationExecuted(
                    positionIds[i],
                    msg.sender,
                    perpMarket.getMarkPrice(position.marketId),
                    rewards[i],
                    (position.margin * insuranceFeeBps) / BPS_DENOMINATOR
                );
            }
        }

        return rewards;
    }

    function getLiquidationParams()
        external
        view
        returns (uint256 liquidationBonus, uint256 insuranceFee, uint256 maxLiquidationSize)
    {
        return (liquidationBonusBps, insuranceFeeBps, maxLiquidationSizeBps);
    }

    /**
     * @notice Check if a position is liquidatable and get details
     * @param positionId Position to check
     * @return canLiquidate Whether position can be liquidated
     * @return healthFactor Position health (< 1e18 = liquidatable)
     * @return estimatedReward Estimated keeper reward
     */
    function checkLiquidation(bytes32 positionId)
        external
        view
        returns (bool canLiquidate, uint256 healthFactor, uint256 estimatedReward)
    {
        (canLiquidate, healthFactor) = perpMarket.isLiquidatable(positionId);

        if (canLiquidate) {
            IPerpetualMarket.Position memory position = perpMarket.getPosition(positionId);
            estimatedReward = (position.margin * liquidationBonusBps) / BPS_DENOMINATOR;
        }
    }

    /**
     * @notice Get keeper statistics
     * @param keeper Keeper address
     * @return liquidations Number of liquidations
     * @return rewards Total rewards earned
     */
    function getKeeperStats(address keeper) external view returns (uint256 liquidations, uint256 rewards) {
        return (keeperLiquidations[keeper], keeperRewards[keeper]);
    }

    /**
     * @notice Get global liquidation statistics
     */
    function getGlobalStats()
        external
        view
        returns (
            uint256 _totalLiquidations,
            uint256 _totalLiquidatedVolume,
            uint256 _totalLiquidatorRewards,
            uint256 _totalInsuranceFees,
            uint256 _totalBadDebt
        )
    {
        return (totalLiquidations, totalLiquidatedVolume, totalLiquidatorRewards, totalInsuranceFees, totalBadDebt);
    }

    /**
     * @notice Handle bad debt from a liquidation
     * @param positionId Position that had bad debt
     * @param token Debt token
     * @param amount Bad debt amount
     * @dev Called by PerpetualMarket when liquidation results in negative equity
     */
    function handleBadDebt(bytes32 positionId, address token, uint256 amount) external {
        if (msg.sender != address(perpMarket)) revert OnlyPerpMarket();

        // Try to cover from insurance fund
        uint256 covered = insuranceFund.coverBadDebt(token, amount);

        if (covered < amount) {
            // Remaining is socialized loss
            uint256 socialized = amount - covered;
            totalBadDebt += socialized;

            emit BadDebtSocialized(positionId, socialized);
        }
    }

    /**
     * @notice Update liquidation parameters
     * @param _liquidationBonusBps Keeper bonus in basis points
     * @param _insuranceFeeBps Insurance fund fee in basis points
     * @param _maxLiquidationSizeBps Max liquidation size in basis points
     */
    function setLiquidationParams(
        uint256 _liquidationBonusBps,
        uint256 _insuranceFeeBps,
        uint256 _maxLiquidationSizeBps
    ) external onlyOwner {
        require(_liquidationBonusBps + _insuranceFeeBps <= 2000, "Fees too high"); // Max 20%
        require(_maxLiquidationSizeBps <= BPS_DENOMINATOR, "Invalid max size");

        liquidationBonusBps = _liquidationBonusBps;
        insuranceFeeBps = _insuranceFeeBps;
        maxLiquidationSizeBps = _maxLiquidationSizeBps;
    }

    /**
     * @notice Update contract references
     */
    function setPerpMarket(address _perpMarket) external onlyOwner {
        perpMarket = IPerpetualMarket(_perpMarket);
    }

    function setMarginManager(address _marginManager) external onlyOwner {
        marginManager = IMarginManager(_marginManager);
    }

    function setInsuranceFund(address _insuranceFund) external onlyOwner {
        insuranceFund = IInsuranceFund(_insuranceFund);
    }
}
