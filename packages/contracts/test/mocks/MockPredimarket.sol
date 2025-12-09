// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title MockPredimarket
 * @notice Shared mock for testing moderation contracts
 * @dev Used across multiple test suites to avoid duplication
 */
contract MockPredimarket {
    mapping(bytes32 => bool) public marketResolved;
    mapping(bytes32 => bool) public marketOutcome;
    mapping(address => bool) public authorizedCreators;
    uint256 public marketCount = 0;

    function addAuthorizedCreator(address creator) external {
        authorizedCreators[creator] = true;
    }

    function createMarket(bytes32, string memory, uint256) external {
        require(authorizedCreators[msg.sender] || msg.sender == address(this), "Not authorized");
        marketCount++;
    }

    function setOutcome(bytes32 sessionId, bool outcome) external {
        marketResolved[sessionId] = true;
        marketOutcome[sessionId] = outcome;
    }

    function getMarket(bytes32 sessionId)
        external
        view
        returns (bytes32, string memory, uint256, uint256, uint256, uint256, uint256, bool, bool)
    {
        return (
            sessionId,
            "Test question",
            0,
            0,
            1000 ether,
            0,
            block.timestamp,
            marketResolved[sessionId],
            marketOutcome[sessionId]
        );
    }

    function getMarketPrices(bytes32) external pure returns (uint256, uint256) {
        return (6000, 4000); // 60% YES, 40% NO
    }
}
