// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title MockL1L2Messenger
 * @notice Simulates L1<>L2 cross-domain messaging for local testing
 * @dev For localnet only - uses real OP Stack messenger on testnets/mainnet
 */
contract MockL1L2Messenger {
    address public l1Target;
    address public l2Target;
    address public xDomainMessageSender;

    event MessageSent(address indexed target, bytes message, uint32 gasLimit);
    event MessageRelayed(address indexed sender, address indexed target, bool success);

    function setTargets(address _l1Target, address _l2Target) external {
        l1Target = _l1Target;
        l2Target = _l2Target;
    }

    function sendMessage(address target, bytes calldata message, uint32 gasLimit) external {
        emit MessageSent(target, message, gasLimit);
        
        xDomainMessageSender = msg.sender;
        (bool success,) = target.call(message);
        emit MessageRelayed(msg.sender, target, success);
        
        require(success, "Message relay failed");
        xDomainMessageSender = address(0);
    }

    /// @notice Returns the sender of the current cross-domain message
    function getCrossDomainMessageSender() external view returns (address) {
        return xDomainMessageSender;
    }
}

