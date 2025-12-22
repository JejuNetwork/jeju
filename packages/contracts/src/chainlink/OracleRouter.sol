// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IOracleConsumer {
    function oracleCallback(bytes32 requestId, bytes calldata response) external;
}

/// @title OracleRouter
/// @notice Generic data request router for off-chain data
contract OracleRouter is Ownable2Step, ReentrancyGuard {
    enum RequestStatus { PENDING, FULFILLED, CANCELLED, EXPIRED }

    struct OracleRequest {
        bytes32 jobId;
        address requester;
        address callbackAddress;
        bytes4 callbackSelector;
        bytes data;
        uint96 payment;
        uint64 expiration;
        RequestStatus status;
    }

    struct Job {
        bytes32 jobId;
        string name;
        string description;
        address oracle;
        uint96 minPayment;
        bool active;
    }

    struct OracleInfo {
        address oracle;
        uint96 stake;
        uint32 fulfillmentCount;
        uint32 successCount;
        uint32 lastActive;
        bool approved;
    }

    struct RouterConfig {
        uint96 minPayment;
        uint32 requestTimeout;
        uint16 oracleFeeBps;
        uint16 protocolFeeBps;
        uint32 maxDataSize;
    }

    mapping(bytes32 => OracleRequest) public requests;
    mapping(bytes32 => Job) public jobs;
    mapping(address => OracleInfo) public oracles;
    bytes32[] public jobIds;
    address[] public oracleList;

    uint256 public requestNonce;
    RouterConfig public config;
    address public feeRecipient;
    address public governance;

    uint256 public totalRequests;
    uint256 public totalFulfilled;
    uint256 public totalFeesCollected;

    event OracleRequested(bytes32 indexed requestId, bytes32 indexed jobId, address indexed requester, bytes data, uint96 payment);
    event OracleFulfilled(bytes32 indexed requestId, bytes response, bool success, uint96 payment);
    event OracleCancelled(bytes32 indexed requestId, address requester);
    event JobRegistered(bytes32 indexed jobId, string name, address oracle, uint96 minPayment);
    event JobUpdated(bytes32 indexed jobId, uint96 minPayment, bool active);
    event JobRemoved(bytes32 indexed jobId);
    event OracleRegistered(address indexed oracle, uint96 stake);
    event OracleApproved(address indexed oracle);
    event OracleRemoved(address indexed oracle);
    event ConfigUpdated(RouterConfig config);

    error InvalidJob();
    error InvalidRequest();
    error RequestNotPending();
    error RequestExpired();
    error InsufficientPayment();
    error NotOracle();
    error NotRequester();
    error NotGovernance();
    error OracleNotApproved();
    error DataTooLarge();
    error JobAlreadyExists();

    modifier onlyGovernance() {
        if (msg.sender != governance && msg.sender != owner()) revert NotGovernance();
        _;
    }

    modifier onlyApprovedOracle() {
        if (!oracles[msg.sender].approved) revert OracleNotApproved();
        _;
    }

    constructor(address _governance) Ownable(msg.sender) {
        governance = _governance;
        feeRecipient = msg.sender;
        config = RouterConfig({
            minPayment: 0.001 ether,
            requestTimeout: 300,
            oracleFeeBps: 9000,
            protocolFeeBps: 1000,
            maxDataSize: 32768
        });
    }

    function requestData(
        bytes32 jobId,
        bytes calldata data,
        address callbackAddress,
        bytes4 callbackSelector
    ) external payable returns (bytes32 requestId) {
        Job storage job = jobs[jobId];
        if (!job.active) revert InvalidJob();
        if (msg.value < job.minPayment) revert InsufficientPayment();
        if (data.length > config.maxDataSize) revert DataTooLarge();

        requestId = keccak256(abi.encodePacked(msg.sender, ++requestNonce, block.timestamp, jobId));
        requests[requestId] = OracleRequest({
            jobId: jobId,
            requester: msg.sender,
            callbackAddress: callbackAddress,
            callbackSelector: callbackSelector,
            data: data,
            payment: uint96(msg.value),
            expiration: uint64(block.timestamp + config.requestTimeout),
            status: RequestStatus.PENDING
        });
        totalRequests++;
        emit OracleRequested(requestId, jobId, msg.sender, data, uint96(msg.value));
    }

    function fulfillRequest(bytes32 requestId, bytes calldata response) external nonReentrant onlyApprovedOracle {
        OracleRequest storage request = requests[requestId];
        if (request.status != RequestStatus.PENDING) revert RequestNotPending();
        if (block.timestamp > request.expiration) revert RequestExpired();

        Job storage job = jobs[request.jobId];
        if (job.oracle != msg.sender && job.oracle != address(0)) revert NotOracle();

        request.status = RequestStatus.FULFILLED;

        bool success;
        if (request.callbackAddress != address(0)) {
            (success,) = request.callbackAddress.call(
                abi.encodeWithSelector(request.callbackSelector, requestId, response)
            );
        } else {
            success = true;
        }

        uint96 payment = request.payment;
        uint96 oraclePayment = payment * config.oracleFeeBps / 10000;
        payable(msg.sender).transfer(oraclePayment);
        payable(feeRecipient).transfer(payment - oraclePayment);

        OracleInfo storage oracleInfo = oracles[msg.sender];
        oracleInfo.fulfillmentCount++;
        if (success) oracleInfo.successCount++;
        oracleInfo.lastActive = uint32(block.timestamp);

        totalFulfilled++;
        totalFeesCollected += payment;
        emit OracleFulfilled(requestId, response, success, payment);
    }

    function cancelRequest(bytes32 requestId) external {
        OracleRequest storage request = requests[requestId];
        if (request.requester != msg.sender) revert NotRequester();
        if (request.status != RequestStatus.PENDING) revert RequestNotPending();
        if (block.timestamp <= request.expiration && msg.sender != governance) revert RequestNotPending();

        request.status = RequestStatus.CANCELLED;
        payable(msg.sender).transfer(request.payment);
        emit OracleCancelled(requestId, msg.sender);
    }

    function registerJob(bytes32 jobId, string calldata name, string calldata description, address oracle, uint96 minPayment) external onlyGovernance {
        if (jobs[jobId].active) revert JobAlreadyExists();
        jobs[jobId] = Job({ jobId: jobId, name: name, description: description, oracle: oracle, minPayment: minPayment, active: true });
        jobIds.push(jobId);
        emit JobRegistered(jobId, name, oracle, minPayment);
    }

    function updateJob(bytes32 jobId, uint96 minPayment, bool active) external onlyGovernance {
        if (jobs[jobId].jobId == bytes32(0)) revert InvalidJob();
        jobs[jobId].minPayment = minPayment;
        jobs[jobId].active = active;
        emit JobUpdated(jobId, minPayment, active);
    }

    function removeJob(bytes32 jobId) external onlyGovernance {
        if (jobs[jobId].jobId == bytes32(0)) revert InvalidJob();
        delete jobs[jobId];
        for (uint256 i = 0; i < jobIds.length; i++) {
            if (jobIds[i] == jobId) {
                jobIds[i] = jobIds[jobIds.length - 1];
                jobIds.pop();
                break;
            }
        }
        emit JobRemoved(jobId);
    }

    function registerOracle() external payable {
        if (msg.value < config.minPayment * 10) revert InsufficientPayment();
        oracles[msg.sender] = OracleInfo({
            oracle: msg.sender,
            stake: uint96(msg.value),
            fulfillmentCount: 0,
            successCount: 0,
            lastActive: uint32(block.timestamp),
            approved: false
        });
        oracleList.push(msg.sender);
        emit OracleRegistered(msg.sender, uint96(msg.value));
    }

    function approveOracle(address oracle) external onlyGovernance {
        if (oracles[oracle].oracle == address(0)) revert NotOracle();
        oracles[oracle].approved = true;
        emit OracleApproved(oracle);
    }

    function removeOracle(address oracle) external onlyGovernance {
        OracleInfo storage info = oracles[oracle];
        if (info.oracle == address(0)) revert NotOracle();
        uint96 stake = info.stake;

        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracleList[i] == oracle) {
                oracleList[i] = oracleList[oracleList.length - 1];
                oracleList.pop();
                break;
            }
        }
        delete oracles[oracle];
        if (stake > 0) payable(oracle).transfer(stake);
        emit OracleRemoved(oracle);
    }

    function setConfig(RouterConfig calldata _config) external onlyGovernance {
        config = _config;
        emit ConfigUpdated(_config);
    }

    function setFeeRecipient(address recipient) external onlyGovernance {
        feeRecipient = recipient;
    }

    function setGovernance(address _governance) external onlyOwner {
        governance = _governance;
    }

    function getJob(bytes32 jobId) external view returns (Job memory) {
        return jobs[jobId];
    }

    function getOracleInfo(address oracle) external view returns (OracleInfo memory) {
        return oracles[oracle];
    }

    function getAllJobs() external view returns (bytes32[] memory) {
        return jobIds;
    }

    function getActiveOracles() external view returns (address[] memory) {
        uint256 count;
        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracles[oracleList[i]].approved) count++;
        }
        address[] memory active = new address[](count);
        uint256 j;
        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracles[oracleList[i]].approved) active[j++] = oracleList[i];
        }
        return active;
    }

    function getStats() external view returns (uint256, uint256, uint256, uint256, uint256) {
        uint256 activeJobs;
        for (uint256 i = 0; i < jobIds.length; i++) {
            if (jobs[jobIds[i]].active) activeJobs++;
        }
        uint256 activeOracles;
        for (uint256 i = 0; i < oracleList.length; i++) {
            if (oracles[oracleList[i]].approved) activeOracles++;
        }
        return (totalRequests, totalFulfilled, totalFeesCollected, activeJobs, activeOracles);
    }
}

library OracleJobs {
    bytes32 constant HTTP_GET = keccak256("http-get");
    bytes32 constant HTTP_POST = keccak256("http-post");
    bytes32 constant PRICE_FEED = keccak256("price-feed");
    bytes32 constant AI_INFERENCE = keccak256("ai-inference");
}
