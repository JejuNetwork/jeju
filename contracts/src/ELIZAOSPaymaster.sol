// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./interfaces/IEntryPoint.sol";
import "./interfaces/IERC20.sol";

/**
 * @title ELIZAOSPaymaster
 * @notice ERC-4337 Paymaster that accepts ELIZAOS tokens for gas payment
 * @dev Agents pay ELIZAOS tokens to this Paymaster, which pays ETH for gas
 *
 * Flow:
 * 1. Agent creates a UserOperation (transaction request)
 * 2. Agent includes this Paymaster's address in the UserOperation
 * 3. Bundler submits the UserOperation to the EntryPoint
 * 4. EntryPoint calls validatePaymasterUserOp to verify the agent has enough ELIZAOS
 * 5. Transaction executes
 * 6. EntryPoint calls postOp to deduct ELIZAOS from the agent
 * 7. ETH is taken from this Paymaster's deposit at the EntryPoint
 */
contract ELIZAOSPaymaster {
    IEntryPoint public immutable entryPoint;
    IERC20 public immutable elizaosToken;

    address public owner;

    // Exchange rate: how many ELIZAOS tokens per 1 ETH worth of gas
    // Default: 1000 ELIZAOS = 1 ETH (adjustable by owner)
    uint256 public elizaosPerEth = 1000 * 10**18;

    // Minimum ELIZAOS deposit required for a transaction
    uint256 public minDeposit = 100 * 10**18; // 100 ELIZAOS

    event GasSponsored(
        address indexed sender,
        uint256 elizaosPaid,
        uint256 actualGasCost
    );
    event RateUpdated(uint256 newRate);
    event Withdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    constructor(address _entryPoint, address _elizaosToken) {
        entryPoint = IEntryPoint(_entryPoint);
        elizaosToken = IERC20(_elizaosToken);
        owner = msg.sender;
    }

    /**
     * @notice Deposit ETH to the EntryPoint on behalf of this Paymaster
     * @dev The Paymaster needs ETH at the EntryPoint to pay for gas
     */
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    /**
     * @notice Get the current deposit at the EntryPoint
     */
    function getDeposit() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    /**
     * @notice Withdraw ETH from the EntryPoint
     * @param withdrawAddress Address to withdraw to
     * @param amount Amount to withdraw
     */
    function withdrawTo(address payable withdrawAddress, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(withdrawAddress, amount);
        emit Withdrawn(withdrawAddress, amount);
    }

    /**
     * @notice Update the ELIZAOS/ETH exchange rate
     * @param newRate New rate (ELIZAOS per 1 ETH)
     */
    function setRate(uint256 newRate) external onlyOwner {
        elizaosPerEth = newRate;
        emit RateUpdated(newRate);
    }

    /**
     * @notice Validate a UserOperation for payment
     * @dev Called by EntryPoint during validation phase
     * @param userOp The UserOperation to validate
     * @param userOpHash Hash of the UserOperation
     * @param maxCost Maximum cost in ETH
     * @return context Context to pass to postOp
     * @return validationData Validation result
     */
    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        require(msg.sender == address(entryPoint), "Only EntryPoint");

        // Calculate required ELIZAOS tokens
        uint256 requiredElizaos = (maxCost * elizaosPerEth) / 1 ether;
        require(requiredElizaos >= minDeposit, "Below minimum");

        address sender = userOp.sender;

        // Check user has enough ELIZAOS and has approved this Paymaster
        require(
            elizaosToken.balanceOf(sender) >= requiredElizaos,
            "Insufficient ELIZAOS balance"
        );
        require(
            elizaosToken.allowance(sender, address(this)) >= requiredElizaos,
            "Insufficient ELIZAOS allowance"
        );

        // Return context for postOp (sender address and max ELIZAOS)
        context = abi.encode(sender, requiredElizaos);

        // validationData = 0 means valid, non-zero would indicate failure
        validationData = 0;
    }

    /**
     * @notice Post-operation handler to collect ELIZAOS tokens
     * @dev Called by EntryPoint after the UserOperation executes
     * @param mode PostOp mode (opSucceeded, opReverted, postOpReverted)
     * @param context Context from validatePaymasterUserOp
     * @param actualGasCost Actual gas cost in ETH
     */
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external {
        require(msg.sender == address(entryPoint), "Only EntryPoint");

        (address sender, uint256 maxElizaos) = abi.decode(context, (address, uint256));

        // Calculate actual ELIZAOS cost based on actual gas used
        uint256 actualElizaos = (actualGasCost * elizaosPerEth) / 1 ether;

        // Use the lesser of max and actual
        uint256 elizaosToPay = actualElizaos < maxElizaos ? actualElizaos : maxElizaos;

        // Transfer ELIZAOS from sender to this Paymaster
        // Note: This assumes the user pre-approved the Paymaster
        bool success = elizaosToken.transferFrom(sender, address(this), elizaosToPay);
        require(success, "ELIZAOS transfer failed");

        emit GasSponsored(sender, elizaosToPay, actualGasCost);
    }

    /**
     * @notice Withdraw accumulated ELIZAOS tokens
     * @param to Address to withdraw to
     * @param amount Amount to withdraw
     */
    function withdrawElizaos(address to, uint256 amount) external onlyOwner {
        elizaosToken.transfer(to, amount);
    }

    /**
     * @notice Transfer ownership
     * @param newOwner New owner address
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }

    receive() external payable {
        // Accept ETH deposits
    }
}

// Structs and enums required by ERC-4337
struct UserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    uint256 callGasLimit;
    uint256 verificationGasLimit;
    uint256 preVerificationGas;
    uint256 maxFeePerGas;
    uint256 maxPriorityFeePerGas;
    bytes paymasterAndData;
    bytes signature;
}

enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}
