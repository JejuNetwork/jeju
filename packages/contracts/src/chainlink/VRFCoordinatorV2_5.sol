// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Minimal interface for Chainlink price feed
interface IAggregatorV3 {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title VRFCoordinatorV2_5
/// @notice Oracle-based randomness coordinator (note: no cryptographic proof verification)
contract VRFCoordinatorV2_5 is Ownable2Step, ReentrancyGuard {
    struct Subscription {
        uint96 balance;
        uint96 nativeBalance;
        uint64 reqCount;
        address owner;
        address[] consumers;
    }

    struct FeeConfig {
        uint32 fulfillmentFlatFeeLinkPPM;
        uint32 fulfillmentFlatFeeNativePPM;
        uint8 premiumPercentage;
        uint8 nativePremiumPercentage;
    }

    struct RequestCommitment {
        uint64 blockNum;
        uint64 subId;
        uint32 callbackGasLimit;
        uint32 numWords;
        address sender;
    }

    IERC20 public immutable LINK;
    address public immutable LINK_NATIVE_FEED;

    mapping(uint64 => Subscription) public subscriptions;
    mapping(address => uint64) public consumerToSub;
    mapping(uint256 => RequestCommitment) public requestCommitments;
    mapping(bytes32 => bool) public provingKeyHashes;
    mapping(address => bool) public oracles;

    uint64 public currentSubId;
    uint256 public currentRequestId;
    uint16 public minimumRequestConfirmations = 3;
    uint32 public maxGasLimit = 2_500_000;
    uint32 public maxNumWords = 500;
    uint32 public gasAfterPaymentCalculation = 33285;
    FeeConfig public feeConfig;
    address public feeRecipient;
    address public governance;

    // SECURITY: Timelocks for oracle changes
    uint256 public constant ORACLE_CHANGE_DELAY = 24 hours;

    struct PendingOracleChange {
        address oracle;
        bytes32 keyHash;
        bool isRegister; // true = register, false = deregister
        uint256 executeAfter;
        bool executed;
    }

    mapping(bytes32 => PendingOracleChange) public pendingOracleChanges;

    event OracleChangeProposed(
        bytes32 indexed changeId, address oracle, bytes32 keyHash, bool isRegister, uint256 executeAfter
    );
    event OracleChangeExecuted(bytes32 indexed changeId);
    event OracleChangeCancelled(bytes32 indexed changeId);

    error OracleChangeNotFound();
    error OracleChangeNotReady();
    error OracleChangeAlreadyExecuted();

    event SubscriptionCreated(uint64 indexed subId, address owner);
    event SubscriptionFunded(uint64 indexed subId, uint256 oldBalance, uint256 newBalance);
    event SubscriptionFundedNative(uint64 indexed subId, uint256 oldBalance, uint256 newBalance);
    event SubscriptionCanceled(uint64 indexed subId, address to, uint256 amountLink, uint256 amountNative);
    event ConsumerAdded(uint64 indexed subId, address consumer);
    event ConsumerRemoved(uint64 indexed subId, address consumer);
    event RandomWordsRequested(
        bytes32 indexed keyHash,
        uint256 requestId,
        uint256 preSeed,
        uint64 indexed subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        bytes extraArgs,
        address indexed sender
    );
    event RandomWordsFulfilled(uint256 indexed requestId, uint256[] output, bool success, uint96 payment);
    event ConfigSet(uint16 minimumRequestConfirmations, uint32 maxGasLimit, FeeConfig feeConfig);
    event ProvingKeyRegistered(bytes32 indexed keyHash, address indexed oracle);
    event ProvingKeyDeregistered(bytes32 indexed keyHash, address indexed oracle);
    event OracleSet(address indexed oracle, bool authorized);
    event FeeRecipientSet(address indexed recipient);
    event GovernanceSet(address indexed governance);

    error InvalidSubscription();
    error InvalidConsumer();
    error InsufficientBalance();
    error InvalidCallbackGasLimit(uint32 provided, uint32 max);
    error InvalidNumWords(uint32 provided, uint32 max);
    error InvalidRequestConfirmations(uint16 provided, uint16 min, uint16 max);
    error InvalidKeyHash();
    error NoCorrespondingRequest();
    error NotOracle();
    error NotGovernance();
    error TooManyConsumers();
    error PendingRequestExists();
    error MustBeSubOwner(address owner);
    error MustBeRequestOwner(address expected, address actual);
    error ETHTransferFailed();

    modifier onlyOracle() {
        if (!oracles[msg.sender]) revert NotOracle();
        _;
    }

    modifier onlyGovernance() {
        if (msg.sender != governance && msg.sender != owner()) revert NotGovernance();
        _;
    }

    modifier onlySubOwner(uint64 subId) {
        if (subscriptions[subId].owner != msg.sender) revert MustBeSubOwner(subscriptions[subId].owner);
        _;
    }

    constructor(address link, address linkNativeFeed, address _governance) Ownable(msg.sender) {
        LINK = IERC20(link);
        LINK_NATIVE_FEED = linkNativeFeed;
        governance = _governance;
        feeRecipient = msg.sender;
        feeConfig = FeeConfig({
            fulfillmentFlatFeeLinkPPM: 500000,
            fulfillmentFlatFeeNativePPM: 500000,
            premiumPercentage: 0,
            nativePremiumPercentage: 0
        });
    }

    function createSubscription() external returns (uint64 subId) {
        subId = ++currentSubId;
        subscriptions[subId] =
            Subscription({balance: 0, nativeBalance: 0, reqCount: 0, owner: msg.sender, consumers: new address[](0)});
        emit SubscriptionCreated(subId, msg.sender);
    }

    function fundSubscription(uint64 subId, uint96 amount) external {
        Subscription storage sub = subscriptions[subId];
        if (sub.owner == address(0)) revert InvalidSubscription();
        LINK.transferFrom(msg.sender, address(this), amount);
        uint96 oldBalance = sub.balance;
        sub.balance += amount;
        emit SubscriptionFunded(subId, oldBalance, sub.balance);
    }

    function fundSubscriptionNative(uint64 subId) external payable {
        Subscription storage sub = subscriptions[subId];
        if (sub.owner == address(0)) revert InvalidSubscription();
        uint96 oldBalance = sub.nativeBalance;
        sub.nativeBalance += uint96(msg.value);
        emit SubscriptionFundedNative(subId, oldBalance, sub.nativeBalance);
    }

    function addConsumer(uint64 subId, address consumer) external onlySubOwner(subId) {
        Subscription storage sub = subscriptions[subId];
        if (sub.consumers.length >= 100) revert TooManyConsumers();
        sub.consumers.push(consumer);
        consumerToSub[consumer] = subId;
        emit ConsumerAdded(subId, consumer);
    }

    function removeConsumer(uint64 subId, address consumer) external onlySubOwner(subId) {
        Subscription storage sub = subscriptions[subId];
        uint256 len = sub.consumers.length;
        for (uint256 i = 0; i < len; i++) {
            if (sub.consumers[i] == consumer) {
                sub.consumers[i] = sub.consumers[len - 1];
                sub.consumers.pop();
                delete consumerToSub[consumer];
                emit ConsumerRemoved(subId, consumer);
                return;
            }
        }
        revert InvalidConsumer();
    }

    function cancelSubscription(uint64 subId, address to) external onlySubOwner(subId) {
        Subscription storage sub = subscriptions[subId];
        if (sub.reqCount > 0) revert PendingRequestExists();
        uint96 linkBalance = sub.balance;
        uint96 nativeBalance = sub.nativeBalance;
        for (uint256 i = 0; i < sub.consumers.length; i++) {
            delete consumerToSub[sub.consumers[i]];
        }
        delete subscriptions[subId];
        if (linkBalance > 0) LINK.transfer(to, linkBalance);
        if (nativeBalance > 0) {
            (bool success, ) = payable(to).call{value: nativeBalance}("");
            if (!success) revert ETHTransferFailed();
        }
        emit SubscriptionCanceled(subId, to, linkBalance, nativeBalance);
    }

    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        bytes calldata extraArgs
    ) external returns (uint256 requestId) {
        if (!provingKeyHashes[keyHash]) revert InvalidKeyHash();
        if (subscriptions[subId].owner == address(0)) revert InvalidSubscription();
        if (consumerToSub[msg.sender] != subId && subscriptions[subId].owner != msg.sender) revert InvalidConsumer();
        if (callbackGasLimit > maxGasLimit) revert InvalidCallbackGasLimit(callbackGasLimit, maxGasLimit);
        if (numWords > maxNumWords) revert InvalidNumWords(numWords, maxNumWords);
        if (requestConfirmations < minimumRequestConfirmations || requestConfirmations > 200) {
            revert InvalidRequestConfirmations(requestConfirmations, minimumRequestConfirmations, 200);
        }

        requestId = ++currentRequestId;
        uint256 preSeed = uint256(keccak256(abi.encodePacked(keyHash, msg.sender, subId, requestId)));
        requestCommitments[requestId] = RequestCommitment({
            blockNum: uint64(block.number),
            subId: subId,
            callbackGasLimit: callbackGasLimit,
            numWords: numWords,
            sender: msg.sender
        });
        subscriptions[subId].reqCount++;
        emit RandomWordsRequested(
            keyHash, requestId, preSeed, subId, requestConfirmations, callbackGasLimit, numWords, extraArgs, msg.sender
        );
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords, address consumer)
        external
        onlyOracle
        nonReentrant
        returns (uint96 payment)
    {
        RequestCommitment memory rc = requestCommitments[requestId];
        if (rc.blockNum == 0) revert NoCorrespondingRequest();
        if (rc.sender != consumer) revert MustBeRequestOwner(rc.sender, consumer);

        delete requestCommitments[requestId];
        subscriptions[rc.subId].reqCount--;
        payment = calculatePaymentAmount(rc.callbackGasLimit, tx.gasprice);

        Subscription storage sub = subscriptions[rc.subId];
        if (sub.nativeBalance >= payment) {
            sub.nativeBalance -= payment;
            (bool transferOk, ) = payable(feeRecipient).call{value: payment}("");
            if (!transferOk) revert ETHTransferFailed();
        } else if (sub.balance >= convertToLink(payment)) {
            uint96 linkPayment = convertToLink(payment);
            sub.balance -= linkPayment;
            LINK.transfer(feeRecipient, linkPayment);
        } else {
            revert InsufficientBalance();
        }

        bytes memory data = abi.encodeWithSignature("rawFulfillRandomWords(uint256,uint256[])", requestId, randomWords);
        uint32 gasLimit = rc.callbackGasLimit;
        bool success;
        assembly {
            success := call(gasLimit, consumer, 0, add(data, 0x20), mload(data), 0, 0)
        }
        emit RandomWordsFulfilled(requestId, randomWords, success, payment);
    }

    function setConfig(uint16 _minimumRequestConfirmations, uint32 _maxGasLimit, FeeConfig calldata _feeConfig)
        external
        onlyGovernance
    {
        minimumRequestConfirmations = _minimumRequestConfirmations;
        maxGasLimit = _maxGasLimit;
        feeConfig = _feeConfig;
        emit ConfigSet(_minimumRequestConfirmations, _maxGasLimit, _feeConfig);
    }

    /// @notice Propose registering a proving key - requires 24-hour delay
    /// @dev SECURITY: Prevents instant oracle manipulation for VRF
    function proposeRegisterProvingKey(bytes32 keyHash, address oracle) public onlyOwner returns (bytes32 changeId) {
        changeId = keccak256(abi.encodePacked(keyHash, oracle, true, block.timestamp));
        pendingOracleChanges[changeId] = PendingOracleChange({
            oracle: oracle,
            keyHash: keyHash,
            isRegister: true,
            executeAfter: block.timestamp + ORACLE_CHANGE_DELAY,
            executed: false
        });
        emit OracleChangeProposed(changeId, oracle, keyHash, true, block.timestamp + ORACLE_CHANGE_DELAY);
    }

    /// @notice Execute pending proving key registration
    function executeRegisterProvingKey(bytes32 changeId) external {
        PendingOracleChange storage change = pendingOracleChanges[changeId];
        if (change.executeAfter == 0) revert OracleChangeNotFound();
        if (change.executed) revert OracleChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert OracleChangeNotReady();
        if (!change.isRegister) revert OracleChangeNotFound();

        change.executed = true;
        provingKeyHashes[change.keyHash] = true;
        oracles[change.oracle] = true;

        emit OracleChangeExecuted(changeId);
        emit ProvingKeyRegistered(change.keyHash, change.oracle);
    }

    /// @notice Legacy registerProvingKey - now requires timelock
    function registerProvingKey(bytes32 keyHash, address oracle) external onlyOwner {
        proposeRegisterProvingKey(keyHash, oracle);
    }

    /// @notice Propose deregistering a proving key - requires 24-hour delay
    function proposeDeregisterProvingKey(bytes32 keyHash, address oracle) public onlyOwner returns (bytes32 changeId) {
        changeId = keccak256(abi.encodePacked(keyHash, oracle, false, block.timestamp));
        pendingOracleChanges[changeId] = PendingOracleChange({
            oracle: oracle,
            keyHash: keyHash,
            isRegister: false,
            executeAfter: block.timestamp + ORACLE_CHANGE_DELAY,
            executed: false
        });
        emit OracleChangeProposed(changeId, oracle, keyHash, false, block.timestamp + ORACLE_CHANGE_DELAY);
    }

    /// @notice Execute pending proving key deregistration
    function executeDeregisterProvingKey(bytes32 changeId) external {
        PendingOracleChange storage change = pendingOracleChanges[changeId];
        if (change.executeAfter == 0) revert OracleChangeNotFound();
        if (change.executed) revert OracleChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert OracleChangeNotReady();
        if (change.isRegister) revert OracleChangeNotFound();

        change.executed = true;
        delete provingKeyHashes[change.keyHash];

        emit OracleChangeExecuted(changeId);
        emit ProvingKeyDeregistered(change.keyHash, change.oracle);
    }

    /// @notice Cancel pending oracle change
    function cancelOracleChange(bytes32 changeId) external onlyOwner {
        PendingOracleChange storage change = pendingOracleChanges[changeId];
        if (change.executeAfter == 0) revert OracleChangeNotFound();
        if (change.executed) revert OracleChangeAlreadyExecuted();

        delete pendingOracleChanges[changeId];
        emit OracleChangeCancelled(changeId);
    }

    /// @notice Legacy deregisterProvingKey - now requires timelock
    function deregisterProvingKey(bytes32 keyHash, address oracle) external onlyOwner {
        proposeDeregisterProvingKey(keyHash, oracle);
    }

    /// @notice Propose setting oracle authorization - requires 24-hour delay
    function proposeSetOracle(address oracle, bool authorized) public onlyOwner returns (bytes32 changeId) {
        changeId = keccak256(abi.encodePacked(oracle, authorized, block.timestamp));
        pendingOracleChanges[changeId] = PendingOracleChange({
            oracle: oracle,
            keyHash: bytes32(0),
            isRegister: authorized,
            executeAfter: block.timestamp + ORACLE_CHANGE_DELAY,
            executed: false
        });
        emit OracleChangeProposed(changeId, oracle, bytes32(0), authorized, block.timestamp + ORACLE_CHANGE_DELAY);
    }

    /// @notice Execute pending oracle authorization
    function executeSetOracle(bytes32 changeId) external {
        PendingOracleChange storage change = pendingOracleChanges[changeId];
        if (change.executeAfter == 0) revert OracleChangeNotFound();
        if (change.executed) revert OracleChangeAlreadyExecuted();
        if (block.timestamp < change.executeAfter) revert OracleChangeNotReady();
        if (change.keyHash != bytes32(0)) revert OracleChangeNotFound();

        change.executed = true;
        oracles[change.oracle] = change.isRegister;

        emit OracleChangeExecuted(changeId);
        emit OracleSet(change.oracle, change.isRegister);
    }

    /// @notice Legacy setOracle - now requires timelock
    function setOracle(address oracle, bool authorized) external onlyOwner {
        proposeSetOracle(oracle, authorized);
    }

    function setFeeRecipient(address recipient) external onlyGovernance {
        feeRecipient = recipient;
        emit FeeRecipientSet(recipient);
    }

    function setGovernance(address _governance) external onlyOwner {
        governance = _governance;
        emit GovernanceSet(_governance);
    }

    function getSubscription(uint64 subId)
        external
        view
        returns (uint96 balance, uint96 nativeBalance, uint64 reqCount, address owner, address[] memory consumers)
    {
        Subscription storage sub = subscriptions[subId];
        return (sub.balance, sub.nativeBalance, sub.reqCount, sub.owner, sub.consumers);
    }

    function calculatePaymentAmount(uint32 callbackGasLimit, uint256 gasPrice) public view returns (uint96) {
        uint256 gasUsed = gasAfterPaymentCalculation + callbackGasLimit;
        uint256 baseCost = gasUsed * gasPrice;
        uint256 premium = baseCost * feeConfig.nativePremiumPercentage / 100;
        uint256 flatFee = uint256(feeConfig.fulfillmentFlatFeeNativePPM) * 1e9;
        return uint96(baseCost + premium + flatFee);
    }

    /// @notice Convert native currency amount to LINK using the price feed
    /// @param nativeAmount Amount in native currency (wei)
    /// @return Amount in LINK (with LINK decimals)
    function convertToLink(uint96 nativeAmount) internal view returns (uint96) {
        if (LINK_NATIVE_FEED == address(0)) {
            // Fallback to 1:200 rate if feed not configured (for testnet compatibility)
            return uint96(uint256(nativeAmount) * 200);
        }

        // Query the Chainlink LINK/Native price feed
        // The feed returns LINK per Native with 18 decimals
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(LINK_NATIVE_FEED).latestRoundData();

        // Verify the price feed is fresh (within 1 hour)
        if (block.timestamp - updatedAt > 3600) {
            // Stale price, use fallback rate
            return uint96(uint256(nativeAmount) * 200);
        }

        if (answer <= 0) {
            // Invalid price, use fallback rate
            return uint96(uint256(nativeAmount) * 200);
        }

        // answer = LINK per 1 Native (18 decimals)
        // nativeAmount is in wei (18 decimals)
        // result should be in LINK (18 decimals)
        uint256 linkAmount = (uint256(nativeAmount) * uint256(answer)) / 1e18;
        return uint96(linkAmount);
    }

    function pendingRequestExists(uint64 subId) external view returns (bool) {
        return subscriptions[subId].reqCount > 0;
    }
}

abstract contract VRFConsumerBaseV2_5 {
    error OnlyCoordinatorCanFulfill(address have, address want);

    address private immutable vrfCoordinator;

    constructor(address _vrfCoordinator) {
        vrfCoordinator = _vrfCoordinator;
    }

    function rawFulfillRandomWords(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != vrfCoordinator) revert OnlyCoordinatorCanFulfill(msg.sender, vrfCoordinator);
        fulfillRandomWords(requestId, randomWords);
    }

    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal virtual;
}
