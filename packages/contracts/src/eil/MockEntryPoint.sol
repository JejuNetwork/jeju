// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IStakeManager} from "@account-abstraction/contracts/interfaces/IStakeManager.sol";

/**
 * @title MockEntryPoint
 * @notice Mock EntryPoint for testing EIL on localnet
 * @dev Implements minimal IEntryPoint interface for CrossChainPaymaster deployment
 */
contract MockEntryPoint {
    mapping(address => IStakeManager.DepositInfo) internal _depositInfo;

    // ============ IEntryPoint ============

    function handleOps(PackedUserOperation[] calldata, address payable) external {}

    function handleAggregatedOps(IEntryPoint.UserOpsPerAggregator[] calldata, address payable) external {}

    function getUserOpHash(PackedUserOperation calldata) external pure returns (bytes32) {
        return bytes32(0);
    }

    function senderCreator() external view returns (address) {
        return address(this);
    }

    // ============ IStakeManager ============

    function depositTo(address account) external payable {
        _depositInfo[account].deposit += msg.value;
    }

    function addStake(uint32 unstakeDelaySec) external payable {
        IStakeManager.DepositInfo storage info = _depositInfo[msg.sender];
        info.stake += uint112(msg.value);
        info.unstakeDelaySec = unstakeDelaySec;
        info.staked = true;
    }

    function unlockStake() external {
        IStakeManager.DepositInfo storage info = _depositInfo[msg.sender];
        info.withdrawTime = uint48(block.timestamp + info.unstakeDelaySec);
    }

    function withdrawStake(address payable withdrawAddress) external {
        IStakeManager.DepositInfo storage info = _depositInfo[msg.sender];
        uint256 stake = info.stake;
        info.stake = 0;
        info.staked = false;
        withdrawAddress.transfer(stake);
    }

    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        require(_depositInfo[msg.sender].deposit >= withdrawAmount, "insufficient deposit");
        _depositInfo[msg.sender].deposit -= withdrawAmount;
        withdrawAddress.transfer(withdrawAmount);
    }

    function balanceOf(address account) external view returns (uint256) {
        return _depositInfo[account].deposit;
    }

    function getDepositInfo(address account) external view returns (IStakeManager.DepositInfo memory info) {
        return _depositInfo[account];
    }

    // ============ INonceManager ============

    function getNonce(address, uint192) external pure returns (uint256) {
        return 0;
    }

    function incrementNonce(uint192) external {}

    // ============ IERC165 ============

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IEntryPoint).interfaceId;
    }

    // ============ Simulation Functions ============

    function getSenderAddress(bytes calldata) external pure {
        revert("AA13 initCode failed or OOG");
    }

    function delegateAndRevert(address, bytes calldata) external {}
}
