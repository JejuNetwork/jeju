// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IEIL - Ethereum Interop Layer Interfaces
 * @notice Standard interfaces for EIL protocol components
 */
interface ICrossChainPaymaster {
    struct VoucherRequest {
        address requester;
        address token;
        uint256 amount;
        address destinationToken;
        uint256 destinationChainId;
        address recipient;
        uint256 gasOnDestination;
        uint256 maxFee;
        uint256 feeIncrement;
        uint256 deadline;
        uint256 createdBlock;
        bool claimed;
        bool expired;
        bool refunded;
    }

    struct Voucher {
        bytes32 requestId;
        address xlp;
        uint256 sourceChainId;
        uint256 destinationChainId;
        address sourceToken;
        address destinationToken;
        uint256 amount;
        uint256 fee;
        uint256 gasProvided;
        uint256 issuedBlock;
        uint256 expiresBlock;
        bool fulfilled;
        bool slashed;
        bool claimed;
    }

    function createVoucherRequest(
        address token,
        uint256 amount,
        address destinationToken,
        uint256 destinationChainId,
        address recipient,
        uint256 gasOnDestination,
        uint256 maxFee,
        uint256 feeIncrement
    ) external returns (bytes32 requestId);

    function getCurrentFee(bytes32 requestId) external view returns (uint256);

    function refundExpiredRequest(bytes32 requestId) external;

    function depositLiquidity(address token, uint256 amount) external;

    function depositETH() external payable;

    function withdrawLiquidity(address token, uint256 amount) external;

    function withdrawETH(uint256 amount) external;

    function issueVoucher(bytes32 requestId, bytes calldata signature) external returns (bytes32 voucherId);

    function claimSourceFunds(bytes32 voucherId) external;

    function fulfillVoucher(
        bytes32 voucherId,
        bytes32 requestId,
        address xlp,
        address token,
        uint256 amount,
        address recipient,
        uint256 gasAmount,
        bytes calldata xlpSignature
    ) external;

    function getXLPLiquidity(address xlp, address token) external view returns (uint256);

    function getXLPETH(address xlp) external view returns (uint256);

    function canFulfillRequest(bytes32 requestId) external view returns (bool);

    function getRequest(bytes32 requestId) external view returns (VoucherRequest memory);

    function getVoucher(bytes32 voucherId) external view returns (Voucher memory);

    event VoucherRequested(
        bytes32 indexed requestId,
        address indexed requester,
        address token,
        uint256 amount,
        uint256 destinationChainId,
        address recipient,
        uint256 maxFee,
        uint256 deadline
    );

    event VoucherIssued(bytes32 indexed voucherId, bytes32 indexed requestId, address indexed xlp, uint256 fee);

    event VoucherFulfilled(bytes32 indexed voucherId, address indexed recipient, uint256 amount);
}

interface IL1StakeManager {
    struct XLPStake {
        uint256 stakedAmount;
        uint256 unbondingAmount;
        uint256 unbondingStartTime;
        uint256 slashedAmount;
        bool isActive;
        uint256 registeredAt;
    }

    function register(uint256[] calldata chains) external payable;

    function addStake() external payable;

    function startUnbonding(uint256 amount) external;

    function completeUnbonding() external;

    function cancelUnbonding() external;

    function registerChain(uint256 chainId) external;

    function unregisterChain(uint256 chainId) external;

    function slash(address xlp, uint256 chainId, bytes32 voucherId, uint256 amount, address victim) external;

    function getStake(address xlp) external view returns (XLPStake memory);

    function getXLPChains(address xlp) external view returns (uint256[] memory);

    function isXLPActive(address xlp) external view returns (bool);

    function getEffectiveStake(address xlp) external view returns (uint256);

    function supportsChain(address xlp, uint256 chainId) external view returns (bool);

    event XLPRegistered(address indexed xlp, uint256 stakedAmount, uint256[] chains);
    event StakeDeposited(address indexed xlp, uint256 amount, uint256 totalStake);
    event UnbondingStarted(address indexed xlp, uint256 amount, uint256 unbondingComplete);
    event StakeWithdrawn(address indexed xlp, uint256 amount);
    event XLPSlashed(address indexed xlp, bytes32 indexed voucherId, uint256 amount, address victim);
}
