// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

contract MockAggregatorV3 is IAggregatorV3 {
    int256 private _answer;
    uint8 private immutable _decimals;
    uint80 private _roundId;
    uint80 private _answeredInRound;
    uint256 private _startedAt;
    uint256 private _updatedAt;

    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        _answer = initialAnswer;
        _roundId = 1;
        _answeredInRound = 1;
        _startedAt = block.timestamp;
        _updatedAt = block.timestamp;
    }

    function setAnswer(int256 a) external {
        _answer = a;
    }

    function setRoundData(uint80 roundId, uint80 answeredInRound, uint256 startedAt, uint256 updatedAt) external {
        _roundId = roundId;
        _answeredInRound = answeredInRound;
        _startedAt = startedAt;
        _updatedAt = updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _startedAt, _updatedAt, _answeredInRound);
    }

    function decimals() external view returns (uint8) {
        return _decimals;
    }
}
