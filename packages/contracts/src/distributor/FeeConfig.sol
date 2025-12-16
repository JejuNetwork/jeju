// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title FeeConfig
 * @notice Central fee configuration for the entire Jeju network
 */
contract FeeConfig is Ownable, Pausable {
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant MAX_FEE_BPS = 3000;
    uint256 public constant FEE_INCREASE_TIMELOCK = 3 days;

    struct DistributionFees {
        uint16 appShareBps; // App developer share
        uint16 lpShareBps; // Liquidity provider share
        uint16 contributorShareBps; // Contributor pool share
        uint16 ethLpShareBps; // ETH LP portion of LP share
        uint16 tokenLpShareBps;
    }

    struct ComputeFees {
        uint16 inferencePlatformFeeBps;
        uint16 rentalPlatformFeeBps;
        uint16 triggerPlatformFeeBps;
    }

    struct StorageFees {
        uint16 uploadFeeBps;
        uint16 retrievalFeeBps;
        uint16 pinningFeeBps;
    }

    struct DeFiFees {
        uint16 swapProtocolFeeBps;
        uint16 bridgeFeeBps;
        uint16 crossChainMarginBps;
    }

    struct InfrastructureFees {
        uint16 sequencerRevenueShareBps;
        uint16 oracleTreasuryShareBps;
        uint16 rpcPremiumFeeBps;
        uint16 messagingFeeBps;
    }

    struct MarketplaceFees {
        uint16 bazaarPlatformFeeBps;
        uint16 launchpadCreatorFeeBps;
        uint16 launchpadCommunityFeeBps;
        uint16 x402ProtocolFeeBps;
    }

    struct NamesFees {
        uint256 baseRegistrationPrice;
        uint16 agentDiscountBps;
        uint16 renewalDiscountBps;
    }

    struct TokenFees {
        uint16 xlpRewardShareBps;
        uint16 protocolShareBps;
        uint16 burnShareBps;
        uint16 transferFeeBps;
        uint16 bridgeFeeMinBps;
        uint16 bridgeFeeMaxBps;
        uint16 xlpMinStakeBps;
        uint16 zkProofDiscountBps;
    }

    struct TokenOverride {
        address token;
        bool hasOverride;
        TokenFees fees;
    }

    struct PendingFeeChange {
        bytes32 feeType;
        bytes data;
        uint256 proposedAt;
        uint256 effectiveAt;
        address proposedBy;
        bool executed;
    }

    DistributionFees public distributionFees;
    ComputeFees public computeFees;
    StorageFees public storageFees;
    DeFiFees public defiFees;
    InfrastructureFees public infrastructureFees;
    MarketplaceFees public marketplaceFees;
    NamesFees public namesFees;
    TokenFees public tokenFees;
    mapping(address => TokenOverride) public tokenOverrides;
    address[] public tokensWithOverrides;
    address public council;
    address public ceo;
    address public treasury;

    mapping(bytes32 => PendingFeeChange) public pendingChanges;
    mapping(bytes32 => uint256) public lastUpdated;

    event DistributionFeesUpdated(uint16 appShareBps, uint16 lpShareBps, uint16 contributorShareBps);
    event ComputeFeesUpdated(uint16 inferencePlatformFeeBps, uint16 rentalPlatformFeeBps, uint16 triggerPlatformFeeBps);
    event StorageFeesUpdated(uint16 uploadFeeBps, uint16 retrievalFeeBps, uint16 pinningFeeBps);
    event DeFiFeesUpdated(uint16 swapProtocolFeeBps, uint16 bridgeFeeBps, uint16 crossChainMarginBps);
    event InfrastructureFeesUpdated(
        uint16 sequencerRevenueShareBps, uint16 oracleTreasuryShareBps, uint16 rpcPremiumFeeBps, uint16 messagingFeeBps
    );
    event MarketplaceFeesUpdated(
        uint16 bazaarPlatformFeeBps,
        uint16 launchpadCreatorFeeBps,
        uint16 launchpadCommunityFeeBps,
        uint16 x402ProtocolFeeBps
    );
    event NamesFeesUpdated(uint256 baseRegistrationPrice, uint16 agentDiscountBps, uint16 renewalDiscountBps);
    event TokenFeesUpdated(
        uint16 xlpRewardShareBps,
        uint16 protocolShareBps,
        uint16 burnShareBps,
        uint16 bridgeFeeMinBps,
        uint16 bridgeFeeMaxBps
    );
    event TokenOverrideSet(
        address indexed token,
        uint16 xlpRewardShareBps,
        uint16 protocolShareBps,
        uint16 burnShareBps
    );
    event TokenOverrideRemoved(address indexed token);
    event FeeChangeProposed(bytes32 indexed changeId, bytes32 feeType, uint256 effectiveAt, address proposedBy);
    event FeeChangeExecuted(bytes32 indexed changeId);
    event FeeChangeCancelled(bytes32 indexed changeId);
    event CouncilUpdated(address indexed oldCouncil, address indexed newCouncil);
    event CEOUpdated(address indexed oldCeo, address indexed newCeo);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    error InvalidFeeSum();
    error FeeTooHigh(uint256 fee, uint256 max);
    error NotAuthorized();
    error TimelockNotExpired(uint256 effectiveAt, uint256 currentTime);
    error ChangeNotFound(bytes32 changeId);
    error AlreadyExecuted();
    error InvalidAddress();

    modifier onlyCouncil() {
        if (msg.sender != council && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier onlyCEO() {
        if (msg.sender != ceo && msg.sender != owner()) revert NotAuthorized();
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != council && msg.sender != ceo && msg.sender != owner()) {
            revert NotAuthorized();
        }
        _;
    }

    constructor(address _council, address _ceo, address _treasury, address initialOwner) Ownable(initialOwner) {
        if (_treasury == address(0)) revert InvalidAddress();

        council = _council;
        ceo = _ceo;
        treasury = _treasury;

        // Initialize with default fees
        _initializeDefaultFees();
    }

    function _initializeDefaultFees() internal {
        // Distribution: 45% app, 45% LP, 10% contributors
        distributionFees = DistributionFees({
            appShareBps: 4500,
            lpShareBps: 4500,
            contributorShareBps: 1000,
            ethLpShareBps: 7000,
            tokenLpShareBps: 3000
        });

        computeFees = ComputeFees({inferencePlatformFeeBps: 500, rentalPlatformFeeBps: 300, triggerPlatformFeeBps: 200});
        storageFees = StorageFees({uploadFeeBps: 200, retrievalFeeBps: 100, pinningFeeBps: 100});
        defiFees = DeFiFees({swapProtocolFeeBps: 5, bridgeFeeBps: 10, crossChainMarginBps: 1000});
        infrastructureFees = InfrastructureFees({
            sequencerRevenueShareBps: 500,
            oracleTreasuryShareBps: 1000,
            rpcPremiumFeeBps: 0,
            messagingFeeBps: 10
        });

        marketplaceFees = MarketplaceFees({
            bazaarPlatformFeeBps: 250,
            launchpadCreatorFeeBps: 8000,
            launchpadCommunityFeeBps: 2000,
            x402ProtocolFeeBps: 50
        });

        namesFees = NamesFees({baseRegistrationPrice: 0.001 ether, agentDiscountBps: 500, renewalDiscountBps: 1000});
        tokenFees = TokenFees({
            xlpRewardShareBps: 8000,
            protocolShareBps: 1000,
            burnShareBps: 1000,
            transferFeeBps: 0,
            bridgeFeeMinBps: 5,
            bridgeFeeMaxBps: 100,
            xlpMinStakeBps: 1000,
            zkProofDiscountBps: 2000
        });

        lastUpdated[keccak256("distribution")] = block.timestamp;
        lastUpdated[keccak256("compute")] = block.timestamp;
        lastUpdated[keccak256("storage")] = block.timestamp;
        lastUpdated[keccak256("defi")] = block.timestamp;
        lastUpdated[keccak256("infrastructure")] = block.timestamp;
        lastUpdated[keccak256("marketplace")] = block.timestamp;
        lastUpdated[keccak256("names")] = block.timestamp;
        lastUpdated[keccak256("token")] = block.timestamp;
    }

    function proposeFeeChange(bytes32 feeType, bytes calldata newValues)
        external
        onlyCouncil
        returns (bytes32 changeId)
    {
        changeId = keccak256(abi.encodePacked(feeType, newValues, block.timestamp, msg.sender));

        // Check if this is a fee increase (requires timelock)
        bool isIncrease = _isIncrease(feeType, newValues);
        uint256 effectiveAt = isIncrease ? block.timestamp + FEE_INCREASE_TIMELOCK : block.timestamp;

        pendingChanges[changeId] = PendingFeeChange({
            feeType: feeType,
            data: newValues,
            proposedAt: block.timestamp,
            effectiveAt: effectiveAt,
            proposedBy: msg.sender,
            executed: false
        });

        emit FeeChangeProposed(changeId, feeType, effectiveAt, msg.sender);
    }

    function executeFeeChange(bytes32 changeId) external onlyCEO {
        PendingFeeChange storage change = pendingChanges[changeId];

        if (change.proposedAt == 0) revert ChangeNotFound(changeId);
        if (change.executed) revert AlreadyExecuted();
        if (block.timestamp < change.effectiveAt) {
            revert TimelockNotExpired(change.effectiveAt, block.timestamp);
        }

        change.executed = true;
        _applyFeeChange(change.feeType, change.data);
        emit FeeChangeExecuted(changeId);
    }

    function cancelFeeChange(bytes32 changeId) external onlyGovernance {
        PendingFeeChange storage change = pendingChanges[changeId];

        if (change.proposedAt == 0) revert ChangeNotFound(changeId);
        if (change.executed) revert AlreadyExecuted();

        change.executed = true; // Mark as executed to prevent future execution

        emit FeeChangeCancelled(changeId);
    }

    function setDistributionFees(
        uint16 appShareBps,
        uint16 lpShareBps,
        uint16 contributorShareBps,
        uint16 ethLpShareBps,
        uint16 tokenLpShareBps
    ) external onlyOwner {
        if (appShareBps + lpShareBps + contributorShareBps != BPS_DENOMINATOR) {
            revert InvalidFeeSum();
        }
        if (ethLpShareBps + tokenLpShareBps != BPS_DENOMINATOR) {
            revert InvalidFeeSum();
        }

        distributionFees = DistributionFees({
            appShareBps: appShareBps,
            lpShareBps: lpShareBps,
            contributorShareBps: contributorShareBps,
            ethLpShareBps: ethLpShareBps,
            tokenLpShareBps: tokenLpShareBps
        });

        lastUpdated[keccak256("distribution")] = block.timestamp;
        emit DistributionFeesUpdated(appShareBps, lpShareBps, contributorShareBps);
    }

    /**
     * @notice Update compute fees directly
     */
    function setComputeFees(uint16 inferencePlatformFeeBps, uint16 rentalPlatformFeeBps, uint16 triggerPlatformFeeBps)
        external
        onlyOwner
    {
        if (inferencePlatformFeeBps > MAX_FEE_BPS) revert FeeTooHigh(inferencePlatformFeeBps, MAX_FEE_BPS);
        if (rentalPlatformFeeBps > MAX_FEE_BPS) revert FeeTooHigh(rentalPlatformFeeBps, MAX_FEE_BPS);
        if (triggerPlatformFeeBps > MAX_FEE_BPS) revert FeeTooHigh(triggerPlatformFeeBps, MAX_FEE_BPS);

        computeFees = ComputeFees({
            inferencePlatformFeeBps: inferencePlatformFeeBps,
            rentalPlatformFeeBps: rentalPlatformFeeBps,
            triggerPlatformFeeBps: triggerPlatformFeeBps
        });

        lastUpdated[keccak256("compute")] = block.timestamp;
        emit ComputeFeesUpdated(inferencePlatformFeeBps, rentalPlatformFeeBps, triggerPlatformFeeBps);
    }

    /**
     * @notice Update storage fees directly
     */
    function setStorageFees(uint16 uploadFeeBps, uint16 retrievalFeeBps, uint16 pinningFeeBps) external onlyOwner {
        if (uploadFeeBps > MAX_FEE_BPS) revert FeeTooHigh(uploadFeeBps, MAX_FEE_BPS);
        if (retrievalFeeBps > MAX_FEE_BPS) revert FeeTooHigh(retrievalFeeBps, MAX_FEE_BPS);
        if (pinningFeeBps > MAX_FEE_BPS) revert FeeTooHigh(pinningFeeBps, MAX_FEE_BPS);

        storageFees =
            StorageFees({uploadFeeBps: uploadFeeBps, retrievalFeeBps: retrievalFeeBps, pinningFeeBps: pinningFeeBps});

        lastUpdated[keccak256("storage")] = block.timestamp;
        emit StorageFeesUpdated(uploadFeeBps, retrievalFeeBps, pinningFeeBps);
    }

    /**
     * @notice Update DeFi fees directly
     */
    function setDeFiFees(uint16 swapProtocolFeeBps, uint16 bridgeFeeBps, uint16 crossChainMarginBps)
        external
        onlyOwner
    {
        if (swapProtocolFeeBps > MAX_FEE_BPS) revert FeeTooHigh(swapProtocolFeeBps, MAX_FEE_BPS);
        if (bridgeFeeBps > MAX_FEE_BPS) revert FeeTooHigh(bridgeFeeBps, MAX_FEE_BPS);
        if (crossChainMarginBps > MAX_FEE_BPS) revert FeeTooHigh(crossChainMarginBps, MAX_FEE_BPS);

        defiFees = DeFiFees({
            swapProtocolFeeBps: swapProtocolFeeBps,
            bridgeFeeBps: bridgeFeeBps,
            crossChainMarginBps: crossChainMarginBps
        });

        lastUpdated[keccak256("defi")] = block.timestamp;
        emit DeFiFeesUpdated(swapProtocolFeeBps, bridgeFeeBps, crossChainMarginBps);
    }

    /**
     * @notice Update infrastructure fees directly
     */
    function setInfrastructureFees(
        uint16 sequencerRevenueShareBps,
        uint16 oracleTreasuryShareBps,
        uint16 rpcPremiumFeeBps,
        uint16 messagingFeeBps
    ) external onlyOwner {
        if (sequencerRevenueShareBps > MAX_FEE_BPS) revert FeeTooHigh(sequencerRevenueShareBps, MAX_FEE_BPS);
        if (oracleTreasuryShareBps > MAX_FEE_BPS) revert FeeTooHigh(oracleTreasuryShareBps, MAX_FEE_BPS);

        infrastructureFees = InfrastructureFees({
            sequencerRevenueShareBps: sequencerRevenueShareBps,
            oracleTreasuryShareBps: oracleTreasuryShareBps,
            rpcPremiumFeeBps: rpcPremiumFeeBps,
            messagingFeeBps: messagingFeeBps
        });

        lastUpdated[keccak256("infrastructure")] = block.timestamp;
        emit InfrastructureFeesUpdated(
            sequencerRevenueShareBps, oracleTreasuryShareBps, rpcPremiumFeeBps, messagingFeeBps
        );
    }

    /**
     * @notice Update marketplace fees directly
     */
    function setMarketplaceFees(
        uint16 bazaarPlatformFeeBps,
        uint16 launchpadCreatorFeeBps,
        uint16 launchpadCommunityFeeBps,
        uint16 x402ProtocolFeeBps
    ) external onlyOwner {
        if (bazaarPlatformFeeBps > MAX_FEE_BPS) revert FeeTooHigh(bazaarPlatformFeeBps, MAX_FEE_BPS);
        if (launchpadCreatorFeeBps + launchpadCommunityFeeBps != BPS_DENOMINATOR) {
            revert InvalidFeeSum();
        }

        marketplaceFees = MarketplaceFees({
            bazaarPlatformFeeBps: bazaarPlatformFeeBps,
            launchpadCreatorFeeBps: launchpadCreatorFeeBps,
            launchpadCommunityFeeBps: launchpadCommunityFeeBps,
            x402ProtocolFeeBps: x402ProtocolFeeBps
        });

        lastUpdated[keccak256("marketplace")] = block.timestamp;
        emit MarketplaceFeesUpdated(
            bazaarPlatformFeeBps, launchpadCreatorFeeBps, launchpadCommunityFeeBps, x402ProtocolFeeBps
        );
    }

    /**
     * @notice Update names fees directly
     */
    function setNamesFees(uint256 baseRegistrationPrice, uint16 agentDiscountBps, uint16 renewalDiscountBps)
        external
        onlyOwner
    {
        if (agentDiscountBps > BPS_DENOMINATOR) revert FeeTooHigh(agentDiscountBps, BPS_DENOMINATOR);
        if (renewalDiscountBps > BPS_DENOMINATOR) revert FeeTooHigh(renewalDiscountBps, BPS_DENOMINATOR);

        namesFees = NamesFees({
            baseRegistrationPrice: baseRegistrationPrice,
            agentDiscountBps: agentDiscountBps,
            renewalDiscountBps: renewalDiscountBps
        });

        lastUpdated[keccak256("names")] = block.timestamp;
        emit NamesFeesUpdated(baseRegistrationPrice, agentDiscountBps, renewalDiscountBps);
    }

    /**
     * @notice Update default token fees directly
     * @param xlpRewardShareBps XLP reward share (default 8000 = 80%)
     * @param protocolShareBps Protocol treasury share (default 1000 = 10%)
     * @param burnShareBps Deflationary burn share (default 1000 = 10%)
     * @param bridgeFeeMinBps Minimum bridge fee (default 5 = 0.05%)
     * @param bridgeFeeMaxBps Maximum bridge fee (default 100 = 1%)
     */
    function setTokenFees(
        uint16 xlpRewardShareBps,
        uint16 protocolShareBps,
        uint16 burnShareBps,
        uint16 transferFeeBps,
        uint16 bridgeFeeMinBps,
        uint16 bridgeFeeMaxBps,
        uint16 xlpMinStakeBps,
        uint16 zkProofDiscountBps
    ) external onlyOwner {
        // Fee distribution must sum to 100%
        if (xlpRewardShareBps + protocolShareBps + burnShareBps != BPS_DENOMINATOR) {
            revert InvalidFeeSum();
        }
        if (bridgeFeeMinBps > bridgeFeeMaxBps) revert FeeTooHigh(bridgeFeeMinBps, bridgeFeeMaxBps);
        if (bridgeFeeMaxBps > MAX_FEE_BPS) revert FeeTooHigh(bridgeFeeMaxBps, MAX_FEE_BPS);
        if (transferFeeBps > MAX_FEE_BPS) revert FeeTooHigh(transferFeeBps, MAX_FEE_BPS);
        if (zkProofDiscountBps > BPS_DENOMINATOR) revert FeeTooHigh(zkProofDiscountBps, BPS_DENOMINATOR);

        tokenFees = TokenFees({
            xlpRewardShareBps: xlpRewardShareBps,
            protocolShareBps: protocolShareBps,
            burnShareBps: burnShareBps,
            transferFeeBps: transferFeeBps,
            bridgeFeeMinBps: bridgeFeeMinBps,
            bridgeFeeMaxBps: bridgeFeeMaxBps,
            xlpMinStakeBps: xlpMinStakeBps,
            zkProofDiscountBps: zkProofDiscountBps
        });

        lastUpdated[keccak256("token")] = block.timestamp;
        emit TokenFeesUpdated(xlpRewardShareBps, protocolShareBps, burnShareBps, bridgeFeeMinBps, bridgeFeeMaxBps);
    }

    /**
     * @notice Set fee override for a specific token (BBLN, JEJU, etc.)
     * @param token Token address
     * @param xlpRewardShareBps XLP reward share for this token
     * @param protocolShareBps Protocol share for this token
     * @param burnShareBps Burn share for this token
     * @param transferFeeBps Transfer fee for this token
     * @param bridgeFeeMinBps Minimum bridge fee for this token
     * @param bridgeFeeMaxBps Maximum bridge fee for this token
     */
    function setTokenOverride(
        address token,
        uint16 xlpRewardShareBps,
        uint16 protocolShareBps,
        uint16 burnShareBps,
        uint16 transferFeeBps,
        uint16 bridgeFeeMinBps,
        uint16 bridgeFeeMaxBps,
        uint16 xlpMinStakeBps,
        uint16 zkProofDiscountBps
    ) external onlyOwner {
        require(token != address(0), "Invalid token");
        if (xlpRewardShareBps + protocolShareBps + burnShareBps != BPS_DENOMINATOR) {
            revert InvalidFeeSum();
        }

        bool isNew = !tokenOverrides[token].hasOverride;

        tokenOverrides[token] = TokenOverride({
            token: token,
            hasOverride: true,
            fees: TokenFees({
                xlpRewardShareBps: xlpRewardShareBps,
                protocolShareBps: protocolShareBps,
                burnShareBps: burnShareBps,
                transferFeeBps: transferFeeBps,
                bridgeFeeMinBps: bridgeFeeMinBps,
                bridgeFeeMaxBps: bridgeFeeMaxBps,
                xlpMinStakeBps: xlpMinStakeBps,
                zkProofDiscountBps: zkProofDiscountBps
            })
        });

        if (isNew) {
            tokensWithOverrides.push(token);
        }

        emit TokenOverrideSet(token, xlpRewardShareBps, protocolShareBps, burnShareBps);
    }

    /**
     * @notice Remove fee override for a token (reverts to default)
     * @param token Token address
     */
    function removeTokenOverride(address token) external onlyOwner {
        require(tokenOverrides[token].hasOverride, "No override exists");

        delete tokenOverrides[token];

        // Remove from array
        for (uint256 i = 0; i < tokensWithOverrides.length; i++) {
            if (tokensWithOverrides[i] == token) {
                tokensWithOverrides[i] = tokensWithOverrides[tokensWithOverrides.length - 1];
                tokensWithOverrides.pop();
                break;
            }
        }

        emit TokenOverrideRemoved(token);
    }

    // ============================================================================
    // View Functions (for other contracts to read)
    // ============================================================================

    /**
     * @notice Get app share in basis points
     */
    function getAppShare() external view returns (uint16) {
        return distributionFees.appShareBps;
    }

    /**
     * @notice Get LP share in basis points
     */
    function getLpShare() external view returns (uint16) {
        return distributionFees.lpShareBps;
    }

    /**
     * @notice Get contributor share in basis points
     */
    function getContributorShare() external view returns (uint16) {
        return distributionFees.contributorShareBps;
    }

    /**
     * @notice Get inference platform fee in basis points
     */
    function getInferenceFee() external view returns (uint16) {
        return computeFees.inferencePlatformFeeBps;
    }

    /**
     * @notice Get rental platform fee in basis points
     */
    function getRentalFee() external view returns (uint16) {
        return computeFees.rentalPlatformFeeBps;
    }

    /**
     * @notice Get storage upload fee in basis points
     */
    function getStorageUploadFee() external view returns (uint16) {
        return storageFees.uploadFeeBps;
    }

    /**
     * @notice Get sequencer revenue share in basis points
     */
    function getSequencerRevenueShare() external view returns (uint16) {
        return infrastructureFees.sequencerRevenueShareBps;
    }

    /**
     * @notice Get bazaar platform fee in basis points
     */
    function getBazaarFee() external view returns (uint16) {
        return marketplaceFees.bazaarPlatformFeeBps;
    }

    /**
     * @notice Get all distribution fees
     */
    function getDistributionFees() external view returns (DistributionFees memory) {
        return distributionFees;
    }

    /**
     * @notice Get all compute fees
     */
    function getComputeFees() external view returns (ComputeFees memory) {
        return computeFees;
    }

    /**
     * @notice Get all storage fees
     */
    function getStorageFees() external view returns (StorageFees memory) {
        return storageFees;
    }

    /**
     * @notice Get all DeFi fees
     */
    function getDeFiFees() external view returns (DeFiFees memory) {
        return defiFees;
    }

    /**
     * @notice Get all infrastructure fees
     */
    function getInfrastructureFees() external view returns (InfrastructureFees memory) {
        return infrastructureFees;
    }

    /**
     * @notice Get all marketplace fees
     */
    function getMarketplaceFees() external view returns (MarketplaceFees memory) {
        return marketplaceFees;
    }

    /**
     * @notice Get all names fees
     */
    function getNamesFees() external view returns (NamesFees memory) {
        return namesFees;
    }

    /**
     * @notice Get default token fees
     */
    function getTokenFees() external view returns (TokenFees memory) {
        return tokenFees;
    }

    /**
     * @notice Get token fees for a specific token (returns override if exists, else default)
     * @param token Token address
     * @return fees Token fees (override or default)
     * @return hasOverride Whether this token has a custom override
     */
    function getTokenFeesFor(address token) external view returns (TokenFees memory fees, bool hasOverride) {
        TokenOverride storage override_ = tokenOverrides[token];
        if (override_.hasOverride) {
            return (override_.fees, true);
        }
        return (tokenFees, false);
    }

    /**
     * @notice Get XLP reward share for a token
     * @param token Token address (or address(0) for default)
     */
    function getXlpRewardShare(address token) external view returns (uint16) {
        if (token != address(0) && tokenOverrides[token].hasOverride) {
            return tokenOverrides[token].fees.xlpRewardShareBps;
        }
        return tokenFees.xlpRewardShareBps;
    }

    /**
     * @notice Get bridge fee bounds for a token
     * @param token Token address (or address(0) for default)
     * @return minBps Minimum bridge fee
     * @return maxBps Maximum bridge fee
     */
    function getBridgeFeeBounds(address token) external view returns (uint16 minBps, uint16 maxBps) {
        if (token != address(0) && tokenOverrides[token].hasOverride) {
            return (tokenOverrides[token].fees.bridgeFeeMinBps, tokenOverrides[token].fees.bridgeFeeMaxBps);
        }
        return (tokenFees.bridgeFeeMinBps, tokenFees.bridgeFeeMaxBps);
    }

    /**
     * @notice Get ZK proof discount for a token
     * @param token Token address (or address(0) for default)
     */
    function getZkProofDiscount(address token) external view returns (uint16) {
        if (token != address(0) && tokenOverrides[token].hasOverride) {
            return tokenOverrides[token].fees.zkProofDiscountBps;
        }
        return tokenFees.zkProofDiscountBps;
    }

    /**
     * @notice Get list of all tokens with fee overrides
     */
    function getTokensWithOverrides() external view returns (address[] memory) {
        return tokensWithOverrides;
    }

    /**
     * @notice Get treasury address
     */
    function getTreasury() external view returns (address) {
        return treasury;
    }

    // ============================================================================
    // Admin Functions
    // ============================================================================

    function setCouncil(address newCouncil) external onlyOwner {
        emit CouncilUpdated(council, newCouncil);
        council = newCouncil;
    }

    function setCEO(address newCeo) external onlyOwner {
        emit CEOUpdated(ceo, newCeo);
        ceo = newCeo;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert InvalidAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============================================================================
    // Internal Functions
    // ============================================================================

    /**
     * @dev Check if a fee change represents an increase
     */
    function _isIncrease(bytes32 feeType, bytes memory newValues) internal view returns (bool) {
        if (feeType == keccak256("distribution")) {
            // Distribution changes don't need timelock (they're redistributions)
            return false;
        } else if (feeType == keccak256("compute")) {
            (uint16 inference, uint16 rental, uint16 trigger) = abi.decode(newValues, (uint16, uint16, uint16));
            return inference > computeFees.inferencePlatformFeeBps || rental > computeFees.rentalPlatformFeeBps
                || trigger > computeFees.triggerPlatformFeeBps;
        } else if (feeType == keccak256("storage")) {
            (uint16 upload, uint16 retrieval, uint16 pinning) = abi.decode(newValues, (uint16, uint16, uint16));
            return upload > storageFees.uploadFeeBps || retrieval > storageFees.retrievalFeeBps
                || pinning > storageFees.pinningFeeBps;
        } else if (feeType == keccak256("defi")) {
            (uint16 swap, uint16 bridge, uint16 crossChain) = abi.decode(newValues, (uint16, uint16, uint16));
            return swap > defiFees.swapProtocolFeeBps || bridge > defiFees.bridgeFeeBps
                || crossChain > defiFees.crossChainMarginBps;
        } else if (feeType == keccak256("infrastructure")) {
            (uint16 seq, uint16 oracle, uint16 rpc, uint16 msg_) =
                abi.decode(newValues, (uint16, uint16, uint16, uint16));
            return seq > infrastructureFees.sequencerRevenueShareBps
                || oracle > infrastructureFees.oracleTreasuryShareBps || rpc > infrastructureFees.rpcPremiumFeeBps
                || msg_ > infrastructureFees.messagingFeeBps;
        } else if (feeType == keccak256("marketplace")) {
            (uint16 bazaar,,, uint16 x402) = abi.decode(newValues, (uint16, uint16, uint16, uint16));
            return bazaar > marketplaceFees.bazaarPlatformFeeBps || x402 > marketplaceFees.x402ProtocolFeeBps;
        } else if (feeType == keccak256("token")) {
            // Token fee changes - check if bridge fees or transfer fees increase
            (,,,uint16 transferFee, uint16 bridgeMin, uint16 bridgeMax,,) =
                abi.decode(newValues, (uint16, uint16, uint16, uint16, uint16, uint16, uint16, uint16));
            return transferFee > tokenFees.transferFeeBps 
                || bridgeMin > tokenFees.bridgeFeeMinBps 
                || bridgeMax > tokenFees.bridgeFeeMaxBps;
        }
        return true; // Default to timelock for unknown types
    }

    /**
     * @dev Apply a fee change after timelock
     */
    function _applyFeeChange(bytes32 feeType, bytes memory data) internal {
        if (feeType == keccak256("distribution")) {
            (uint16 app, uint16 lp, uint16 contrib, uint16 ethLp, uint16 tokenLp) =
                abi.decode(data, (uint16, uint16, uint16, uint16, uint16));
            distributionFees = DistributionFees(app, lp, contrib, ethLp, tokenLp);
            emit DistributionFeesUpdated(app, lp, contrib);
        } else if (feeType == keccak256("compute")) {
            (uint16 inference, uint16 rental, uint16 trigger) = abi.decode(data, (uint16, uint16, uint16));
            computeFees = ComputeFees(inference, rental, trigger);
            emit ComputeFeesUpdated(inference, rental, trigger);
        } else if (feeType == keccak256("storage")) {
            (uint16 upload, uint16 retrieval, uint16 pinning) = abi.decode(data, (uint16, uint16, uint16));
            storageFees = StorageFees(upload, retrieval, pinning);
            emit StorageFeesUpdated(upload, retrieval, pinning);
        } else if (feeType == keccak256("defi")) {
            (uint16 swap, uint16 bridge, uint16 crossChain) = abi.decode(data, (uint16, uint16, uint16));
            defiFees = DeFiFees(swap, bridge, crossChain);
            emit DeFiFeesUpdated(swap, bridge, crossChain);
        } else if (feeType == keccak256("infrastructure")) {
            (uint16 seq, uint16 oracle, uint16 rpc, uint16 msg_) = abi.decode(data, (uint16, uint16, uint16, uint16));
            infrastructureFees = InfrastructureFees(seq, oracle, rpc, msg_);
            emit InfrastructureFeesUpdated(seq, oracle, rpc, msg_);
        } else if (feeType == keccak256("marketplace")) {
            (uint16 bazaar, uint16 creator, uint16 community, uint16 x402) =
                abi.decode(data, (uint16, uint16, uint16, uint16));
            marketplaceFees = MarketplaceFees(bazaar, creator, community, x402);
            emit MarketplaceFeesUpdated(bazaar, creator, community, x402);
        } else if (feeType == keccak256("names")) {
            (uint256 base, uint16 agent, uint16 renewal) = abi.decode(data, (uint256, uint16, uint16));
            namesFees = NamesFees(base, agent, renewal);
            emit NamesFeesUpdated(base, agent, renewal);
        } else if (feeType == keccak256("token")) {
            (
                uint16 xlpReward, uint16 protocol, uint16 burn,
                uint16 transfer, uint16 bridgeMin, uint16 bridgeMax,
                uint16 xlpMinStake, uint16 zkDiscount
            ) = abi.decode(data, (uint16, uint16, uint16, uint16, uint16, uint16, uint16, uint16));
            tokenFees = TokenFees(xlpReward, protocol, burn, transfer, bridgeMin, bridgeMax, xlpMinStake, zkDiscount);
            emit TokenFeesUpdated(xlpReward, protocol, burn, bridgeMin, bridgeMax);
        }

        lastUpdated[feeType] = block.timestamp;
    }

    /**
     * @notice Get contract version
     */
    function version() external pure returns (string memory) {
        return "1.1.0";
    }
}
