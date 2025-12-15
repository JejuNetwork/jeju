// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IFeeConfig
 * @author Jeju Network
 * @notice Interface for the central fee configuration contract
 * @dev All fee-related contracts should read from this interface
 */
interface IFeeConfig {
    // ============ Structs ============

    struct DistributionFees {
        uint16 appShareBps;
        uint16 lpShareBps;
        uint16 contributorShareBps;
        uint16 ethLpShareBps;
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

    // ============ Individual Fee Getters ============

    function getAppShare() external view returns (uint16);
    function getLpShare() external view returns (uint16);
    function getContributorShare() external view returns (uint16);
    function getInferenceFee() external view returns (uint16);
    function getRentalFee() external view returns (uint16);
    function getStorageUploadFee() external view returns (uint16);
    function getSequencerRevenueShare() external view returns (uint16);
    function getBazaarFee() external view returns (uint16);
    function getTreasury() external view returns (address);

    // ============ Bulk Fee Getters ============

    function getDistributionFees() external view returns (DistributionFees memory);
    function getComputeFees() external view returns (ComputeFees memory);
    function getStorageFees() external view returns (StorageFees memory);
    function getDeFiFees() external view returns (DeFiFees memory);
    function getInfrastructureFees() external view returns (InfrastructureFees memory);
    function getMarketplaceFees() external view returns (MarketplaceFees memory);
    function getNamesFees() external view returns (NamesFees memory);

    // ============ Governance Functions ============

    function proposeFeeChange(bytes32 feeType, bytes calldata newValues) external returns (bytes32 changeId);
    function executeFeeChange(bytes32 changeId) external;
    function cancelFeeChange(bytes32 changeId) external;

    // ============ Events ============

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
    event FeeChangeProposed(bytes32 indexed changeId, bytes32 feeType, uint256 effectiveAt, address proposedBy);
    event FeeChangeExecuted(bytes32 indexed changeId);
    event FeeChangeCancelled(bytes32 indexed changeId);
}
