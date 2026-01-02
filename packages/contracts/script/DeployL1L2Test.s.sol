// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Script.sol";
import "../src/bridge/WithdrawalPortal.sol";
import "../src/bridge/L2ToL1MessagePasser.sol";
import "../src/bridge/interfaces/IL2OutputOracle.sol";

/**
 * @title DeployL1L2Test
 * @notice Deployment script for L1/L2 messaging test contracts
 * @dev Deploys MockL2OutputOracle, WithdrawalPortal on L1
 *      and L2ToL1MessagePasser on L2
 *
 * Usage:
 *   # Deploy on L1 (port 8545)
 *   forge script script/DeployL1L2Test.s.sol:DeployL1L2Test \
 *     --rpc-url http://127.0.0.1:8545 --broadcast --legacy
 *
 *   # Deploy on L2 (port 9545)
 *   L2=true forge script script/DeployL1L2Test.s.sol:DeployL1L2Test \
 *     --rpc-url http://127.0.0.1:9545 --broadcast --legacy
 */
contract DeployL1L2Test is Script {
    function run() public {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80)
        );
        
        bool isL2 = vm.envOr("L2", false);
        
        vm.startBroadcast(deployerPrivateKey);
        
        if (isL2) {
            // Deploy L2 contracts
            L2ToL1MessagePasser messagePasser = new L2ToL1MessagePasser();
            console.log("L2ToL1MessagePasser deployed:", address(messagePasser));
        } else {
            // Deploy L1 contracts
            MockL2OutputOracleForDeploy oracle = new MockL2OutputOracleForDeploy();
            console.log("MockL2OutputOracle deployed:", address(oracle));
            
            WithdrawalPortal portal = new WithdrawalPortal(address(oracle));
            console.log("WithdrawalPortal deployed:", address(portal));
        }
        
        vm.stopBroadcast();
    }
}

/**
 * @title MockL2OutputOracleForDeploy
 * @notice Mock L2 Output Oracle for testing
 */
contract MockL2OutputOracleForDeploy is IL2OutputOracle {
    mapping(uint256 => OutputProposal) public outputs;
    uint256 public latestIndex;

    function proposeL2Output(
        bytes32 _outputRoot,
        uint256 _l2BlockNumber,
        bytes32,
        uint256
    ) external payable override {
        outputs[latestIndex] = OutputProposal({
            outputRoot: _outputRoot,
            timestamp: uint128(block.timestamp),
            l2BlockNumber: uint128(_l2BlockNumber)
        });
        latestIndex++;
    }

    function setOutput(
        uint256 index,
        bytes32 outputRoot,
        uint128 timestamp,
        uint128 l2BlockNumber
    ) external {
        outputs[index] = OutputProposal({
            outputRoot: outputRoot,
            timestamp: timestamp,
            l2BlockNumber: l2BlockNumber
        });
        if (index >= latestIndex) latestIndex = index + 1;
    }

    function getL2Output(uint256 _l2OutputIndex)
        external
        view
        override
        returns (OutputProposal memory)
    {
        return outputs[_l2OutputIndex];
    }

    function latestOutputIndex() external view override returns (uint256) {
        return latestIndex > 0 ? latestIndex - 1 : 0;
    }

    function latestBlockNumber() external view override returns (uint256) {
        if (latestIndex == 0) return 0;
        return outputs[latestIndex - 1].l2BlockNumber;
    }

    function finalizationPeriodSeconds() external pure override returns (uint256) {
        return 7 days;
    }

    function sequencerRegistry() external pure override returns (address) {
        return address(0);
    }
}


