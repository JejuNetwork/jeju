// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title OracleNetworkConnector
 * @notice Connects operators to the oracle network and tracks their performance metrics
 */
contract OracleNetworkConnector is Ownable, ReentrancyGuard {
    struct OperatorMetrics {
        uint256 reportsSubmitted;
        uint256 reportsAccepted;
        uint256 disputesLost;
        uint256 lastActiveEpoch;
        bool isRegistered;
    }

    mapping(address => OperatorMetrics) public operators;
    mapping(address => address) public workerKeys;
    mapping(address => bytes32) public stakingOracleIds;
    mapping(address => uint256) public agentIds;

    uint256 public currentEpoch;
    uint256 public epochDuration = 1 hours;
    uint256 public lastEpochUpdate;

    event OperatorRegistered(address indexed operator, address workerKey, bytes32 stakingOracleId, uint256 agentId);
    event ReportSubmitted(address indexed operator, uint256 epoch);
    event ReportAccepted(address indexed operator, uint256 epoch);
    event DisputeLost(address indexed operator, uint256 epoch);
    event EpochAdvanced(uint256 newEpoch);

    constructor(address initialOwner) Ownable(initialOwner) {
        lastEpochUpdate = block.timestamp;
    }

    /**
     * @notice Register as an oracle operator
     * @param workerKey The operator's worker key address
     * @param stakingOracleId The staking oracle identifier
     * @param agentId The agent identifier
     */
    function registerOperator(address workerKey, bytes32 stakingOracleId, uint256 agentId) external nonReentrant {
        require(!operators[msg.sender].isRegistered, "Already registered");
        require(workerKey != address(0), "Invalid worker key");

        operators[msg.sender] = OperatorMetrics({
            reportsSubmitted: 0,
            reportsAccepted: 0,
            disputesLost: 0,
            lastActiveEpoch: currentEpoch,
            isRegistered: true
        });

        workerKeys[msg.sender] = workerKey;
        stakingOracleIds[msg.sender] = stakingOracleId;
        agentIds[msg.sender] = agentId;

        emit OperatorRegistered(msg.sender, workerKey, stakingOracleId, agentId);
    }

    /**
     * @notice Get operator metrics
     * @param operator The operator address
     * @return reportsSubmitted Number of reports submitted
     * @return reportsAccepted Number of reports accepted
     * @return disputesLost Number of disputes lost
     * @return lastActiveEpoch Last active epoch
     */
    function getOperatorMetrics(address operator)
        external
        view
        returns (uint256 reportsSubmitted, uint256 reportsAccepted, uint256 disputesLost, uint256 lastActiveEpoch)
    {
        OperatorMetrics memory m = operators[operator];
        return (m.reportsSubmitted, m.reportsAccepted, m.disputesLost, m.lastActiveEpoch);
    }

    /**
     * @notice Check if an address is a registered operator
     */
    function isOperator(address addr) external view returns (bool) {
        return operators[addr].isRegistered;
    }

    /**
     * @notice Submit a report (only callable by registered operators)
     */
    function submitReport(bytes calldata) external {
        require(operators[msg.sender].isRegistered, "Not registered");
        _advanceEpochIfNeeded();

        operators[msg.sender].reportsSubmitted++;
        operators[msg.sender].lastActiveEpoch = currentEpoch;

        emit ReportSubmitted(msg.sender, currentEpoch);
    }

    /**
     * @notice Accept a report (only owner)
     */
    function acceptReport(address operator) external onlyOwner {
        require(operators[operator].isRegistered, "Not registered");
        operators[operator].reportsAccepted++;
        emit ReportAccepted(operator, currentEpoch);
    }

    /**
     * @notice Record a lost dispute (only owner)
     */
    function recordDisputeLoss(address operator) external onlyOwner {
        require(operators[operator].isRegistered, "Not registered");
        operators[operator].disputesLost++;
        emit DisputeLost(operator, currentEpoch);
    }

    /**
     * @notice Advance epoch if needed
     */
    function advanceEpoch() external {
        _advanceEpochIfNeeded();
    }

    function _advanceEpochIfNeeded() internal {
        if (block.timestamp >= lastEpochUpdate + epochDuration) {
            uint256 epochsToAdvance = (block.timestamp - lastEpochUpdate) / epochDuration;
            currentEpoch += epochsToAdvance;
            lastEpochUpdate += epochsToAdvance * epochDuration;
            emit EpochAdvanced(currentEpoch);
        }
    }

    /**
     * @notice Update epoch duration (only owner)
     */
    function setEpochDuration(uint256 newDuration) external onlyOwner {
        require(newDuration > 0, "Invalid duration");
        epochDuration = newDuration;
    }
}
