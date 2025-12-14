// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {FeeConfig} from "../distributor/FeeConfig.sol";

/**
 * @title FeeGovernance
 * @author Jeju Network
 * @notice Helper contract for encoding fee change proposals for the Council
 * @dev Provides typed functions to create calldata for FeeConfig proposals
 *
 * Usage:
 * 1. Call one of the encode* functions to get the calldata
 * 2. Submit a proposal to Council with:
 *    - proposalType: PARAMETER_CHANGE
 *    - targetContract: FeeConfig address
 *    - callData: result from encode function
 * 3. When executed, the Council will call FeeConfig.proposeFeeChange()
 *
 * The FeeConfig contract handles timelocks and execution.
 *
 * @custom:security-contact security@jeju.network
 */
contract FeeGovernance {
    // ============ Fee Type Constants ============

    bytes32 public constant FEE_TYPE_DISTRIBUTION = keccak256("distribution");
    bytes32 public constant FEE_TYPE_COMPUTE = keccak256("compute");
    bytes32 public constant FEE_TYPE_STORAGE = keccak256("storage");
    bytes32 public constant FEE_TYPE_DEFI = keccak256("defi");
    bytes32 public constant FEE_TYPE_INFRASTRUCTURE = keccak256("infrastructure");
    bytes32 public constant FEE_TYPE_MARKETPLACE = keccak256("marketplace");
    bytes32 public constant FEE_TYPE_NAMES = keccak256("names");

    // ============ Encoding Functions ============

    /**
     * @notice Encode distribution fee change proposal
     * @param appShareBps App developer share (4500 = 45%)
     * @param lpShareBps LP share (4500 = 45%)
     * @param contributorShareBps Contributor share (1000 = 10%)
     * @param ethLpShareBps ETH LP portion of LP share (7000 = 70%)
     * @param tokenLpShareBps Token LP portion of LP share (3000 = 30%)
     * @return callData Encoded calldata for FeeConfig.proposeFeeChange
     */
    function encodeDistributionFeeChange(
        uint16 appShareBps,
        uint16 lpShareBps,
        uint16 contributorShareBps,
        uint16 ethLpShareBps,
        uint16 tokenLpShareBps
    ) external pure returns (bytes memory callData) {
        require(appShareBps + lpShareBps + contributorShareBps == 10000, "Must sum to 100%");
        require(ethLpShareBps + tokenLpShareBps == 10000, "LP must sum to 100%");

        bytes memory newValues = abi.encode(
            appShareBps,
            lpShareBps,
            contributorShareBps,
            ethLpShareBps,
            tokenLpShareBps
        );

        callData = abi.encodeCall(FeeConfig.proposeFeeChange, (FEE_TYPE_DISTRIBUTION, newValues));
    }

    /**
     * @notice Encode compute fee change proposal
     * @param inferencePlatformFeeBps Platform fee on inference (500 = 5%)
     * @param rentalPlatformFeeBps Platform fee on rentals (300 = 3%)
     * @param triggerPlatformFeeBps Platform fee on triggers (200 = 2%)
     */
    function encodeComputeFeeChange(
        uint16 inferencePlatformFeeBps,
        uint16 rentalPlatformFeeBps,
        uint16 triggerPlatformFeeBps
    ) external pure returns (bytes memory callData) {
        require(inferencePlatformFeeBps <= 3000, "Max 30%");
        require(rentalPlatformFeeBps <= 3000, "Max 30%");
        require(triggerPlatformFeeBps <= 3000, "Max 30%");

        bytes memory newValues = abi.encode(
            inferencePlatformFeeBps,
            rentalPlatformFeeBps,
            triggerPlatformFeeBps
        );

        callData = abi.encodeCall(FeeConfig.proposeFeeChange, (FEE_TYPE_COMPUTE, newValues));
    }

    /**
     * @notice Encode storage fee change proposal
     * @param uploadFeeBps Fee on uploads (200 = 2%)
     * @param retrievalFeeBps Fee on retrievals (100 = 1%)
     * @param pinningFeeBps Fee on pinning (100 = 1%)
     */
    function encodeStorageFeeChange(
        uint16 uploadFeeBps,
        uint16 retrievalFeeBps,
        uint16 pinningFeeBps
    ) external pure returns (bytes memory callData) {
        require(uploadFeeBps <= 3000, "Max 30%");
        require(retrievalFeeBps <= 3000, "Max 30%");
        require(pinningFeeBps <= 3000, "Max 30%");

        bytes memory newValues = abi.encode(uploadFeeBps, retrievalFeeBps, pinningFeeBps);

        callData = abi.encodeCall(FeeConfig.proposeFeeChange, (FEE_TYPE_STORAGE, newValues));
    }

    /**
     * @notice Encode DeFi fee change proposal
     * @param swapProtocolFeeBps AMM protocol fee (5 = 0.05%)
     * @param bridgeFeeBps Bridge fee (10 = 0.1%)
     * @param crossChainMarginBps Cross-chain paymaster margin (1000 = 10%)
     */
    function encodeDeFiFeeChange(
        uint16 swapProtocolFeeBps,
        uint16 bridgeFeeBps,
        uint16 crossChainMarginBps
    ) external pure returns (bytes memory callData) {
        require(swapProtocolFeeBps <= 3000, "Max 30%");
        require(bridgeFeeBps <= 3000, "Max 30%");
        require(crossChainMarginBps <= 3000, "Max 30%");

        bytes memory newValues = abi.encode(swapProtocolFeeBps, bridgeFeeBps, crossChainMarginBps);

        callData = abi.encodeCall(FeeConfig.proposeFeeChange, (FEE_TYPE_DEFI, newValues));
    }

    /**
     * @notice Encode infrastructure fee change proposal
     * @param sequencerRevenueShareBps Sequencer revenue share (500 = 5%)
     * @param oracleTreasuryShareBps Oracle treasury share (1000 = 10%)
     * @param rpcPremiumFeeBps RPC premium fee (0 = free)
     * @param messagingFeeBps Cross-chain messaging fee (10 = 0.1%)
     */
    function encodeInfrastructureFeeChange(
        uint16 sequencerRevenueShareBps,
        uint16 oracleTreasuryShareBps,
        uint16 rpcPremiumFeeBps,
        uint16 messagingFeeBps
    ) external pure returns (bytes memory callData) {
        require(sequencerRevenueShareBps <= 5000, "Max 50%");
        require(oracleTreasuryShareBps <= 5000, "Max 50%");

        bytes memory newValues = abi.encode(
            sequencerRevenueShareBps,
            oracleTreasuryShareBps,
            rpcPremiumFeeBps,
            messagingFeeBps
        );

        callData = abi.encodeCall(FeeConfig.proposeFeeChange, (FEE_TYPE_INFRASTRUCTURE, newValues));
    }

    /**
     * @notice Encode marketplace fee change proposal
     * @param bazaarPlatformFeeBps Bazaar marketplace fee (250 = 2.5%)
     * @param launchpadCreatorFeeBps Launchpad creator fee (8000 = 80%)
     * @param launchpadCommunityFeeBps Launchpad community fee (2000 = 20%)
     * @param x402ProtocolFeeBps x402 protocol fee (50 = 0.5%)
     */
    function encodeMarketplaceFeeChange(
        uint16 bazaarPlatformFeeBps,
        uint16 launchpadCreatorFeeBps,
        uint16 launchpadCommunityFeeBps,
        uint16 x402ProtocolFeeBps
    ) external pure returns (bytes memory callData) {
        require(bazaarPlatformFeeBps <= 3000, "Max 30%");
        require(launchpadCreatorFeeBps + launchpadCommunityFeeBps == 10000, "Must sum to 100%");

        bytes memory newValues = abi.encode(
            bazaarPlatformFeeBps,
            launchpadCreatorFeeBps,
            launchpadCommunityFeeBps,
            x402ProtocolFeeBps
        );

        callData = abi.encodeCall(FeeConfig.proposeFeeChange, (FEE_TYPE_MARKETPLACE, newValues));
    }

    /**
     * @notice Encode names fee change proposal
     * @param baseRegistrationPrice Base price per year in wei
     * @param agentDiscountBps Discount for ERC-8004 agents (500 = 5%)
     * @param renewalDiscountBps Discount for renewals (1000 = 10%)
     */
    function encodeNamesFeeChange(
        uint256 baseRegistrationPrice,
        uint16 agentDiscountBps,
        uint16 renewalDiscountBps
    ) external pure returns (bytes memory callData) {
        require(agentDiscountBps <= 10000, "Max 100%");
        require(renewalDiscountBps <= 10000, "Max 100%");

        bytes memory newValues = abi.encode(baseRegistrationPrice, agentDiscountBps, renewalDiscountBps);

        callData = abi.encodeCall(FeeConfig.proposeFeeChange, (FEE_TYPE_NAMES, newValues));
    }

    // ============ Execution Calldata Encoding ============

    /**
     * @notice Encode call to execute a pending fee change
     * @param changeId The ID of the pending change to execute
     */
    function encodeExecuteFeeChange(bytes32 changeId) external pure returns (bytes memory callData) {
        callData = abi.encodeCall(FeeConfig.executeFeeChange, (changeId));
    }

    /**
     * @notice Encode call to cancel a pending fee change
     * @param changeId The ID of the pending change to cancel
     */
    function encodeCancelFeeChange(bytes32 changeId) external pure returns (bytes memory callData) {
        callData = abi.encodeCall(FeeConfig.cancelFeeChange, (changeId));
    }

    // ============ View Functions ============

    /**
     * @notice Get human-readable fee type name
     */
    function getFeeTypeName(bytes32 feeType) external pure returns (string memory) {
        if (feeType == FEE_TYPE_DISTRIBUTION) return "distribution";
        if (feeType == FEE_TYPE_COMPUTE) return "compute";
        if (feeType == FEE_TYPE_STORAGE) return "storage";
        if (feeType == FEE_TYPE_DEFI) return "defi";
        if (feeType == FEE_TYPE_INFRASTRUCTURE) return "infrastructure";
        if (feeType == FEE_TYPE_MARKETPLACE) return "marketplace";
        if (feeType == FEE_TYPE_NAMES) return "names";
        return "unknown";
    }

    /**
     * @notice Validate that a fee type is known
     */
    function isValidFeeType(bytes32 feeType) external pure returns (bool) {
        return feeType == FEE_TYPE_DISTRIBUTION ||
               feeType == FEE_TYPE_COMPUTE ||
               feeType == FEE_TYPE_STORAGE ||
               feeType == FEE_TYPE_DEFI ||
               feeType == FEE_TYPE_INFRASTRUCTURE ||
               feeType == FEE_TYPE_MARKETPLACE ||
               feeType == FEE_TYPE_NAMES;
    }
}
