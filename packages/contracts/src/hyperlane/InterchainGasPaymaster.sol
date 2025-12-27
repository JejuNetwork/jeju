// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title InterchainGasPaymaster
 * @notice Minimal Hyperlane IGP implementation
 * @dev Simplified version - production should use Hyperlane's official contracts
 */
contract InterchainGasPaymaster is Ownable2Step {
    // Gas oracles per domain
    mapping(uint32 => GasOracle) public gasOracles;

    // Beneficiary for collected fees
    address public beneficiary;

    // Gas overhead per message
    uint256 public constant GAS_OVERHEAD = 50_000;

    struct GasOracle {
        uint128 tokenExchangeRate; // Remote token / local token (in 1e10)
        uint128 gasPrice; // Gas price on remote chain (in wei)
    }

    event GasPayment(bytes32 indexed messageId, uint32 indexed destination, uint256 gasAmount, uint256 payment);

    event GasOracleSet(uint32 indexed domain, uint128 tokenExchangeRate, uint128 gasPrice);
    event BeneficiarySet(address indexed beneficiary);

    constructor(address _owner) Ownable(_owner) {
        beneficiary = _owner;
    }

    /**
     * @notice Set gas oracle for a domain
     */
    function setGasOracle(uint32 _domain, uint128 _tokenExchangeRate, uint128 _gasPrice) external onlyOwner {
        gasOracles[_domain] = GasOracle(_tokenExchangeRate, _gasPrice);
        emit GasOracleSet(_domain, _tokenExchangeRate, _gasPrice);
    }

    /**
     * @notice Set multiple gas oracles
     */
    function setGasOracles(
        uint32[] calldata _domains,
        uint128[] calldata _tokenExchangeRates,
        uint128[] calldata _gasPrices
    ) external onlyOwner {
        require(
            _domains.length == _tokenExchangeRates.length && _domains.length == _gasPrices.length, "Length mismatch"
        );
        for (uint256 i = 0; i < _domains.length; i++) {
            gasOracles[_domains[i]] = GasOracle(_tokenExchangeRates[i], _gasPrices[i]);
            emit GasOracleSet(_domains[i], _tokenExchangeRates[i], _gasPrices[i]);
        }
    }

    /**
     * @notice Set beneficiary
     */
    function setBeneficiary(address _beneficiary) external onlyOwner {
        beneficiary = _beneficiary;
        emit BeneficiarySet(_beneficiary);
    }

    /**
     * @notice Pay for gas on destination chain
     * @param _messageId The message ID
     * @param _destination Destination domain
     * @param _gasAmount Amount of gas to pay for
     * @param _refundAddress Address to refund excess payment
     */
    function payForGas(bytes32 _messageId, uint32 _destination, uint256 _gasAmount, address _refundAddress)
        external
        payable
    {
        uint256 requiredPayment = quoteGasPayment(_destination, _gasAmount);
        require(msg.value >= requiredPayment, "Insufficient payment");

        emit GasPayment(_messageId, _destination, _gasAmount, requiredPayment);

        // Refund excess
        if (msg.value > requiredPayment) {
            (bool success,) = _refundAddress.call{value: msg.value - requiredPayment}("");
            require(success, "Refund failed");
        }
    }

    /**
     * @notice Quote gas payment for destination
     * @param _destination Destination domain
     * @param _gasAmount Amount of gas
     * @return Payment amount in local token
     */
    function quoteGasPayment(uint32 _destination, uint256 _gasAmount) public view returns (uint256) {
        GasOracle memory oracle = gasOracles[_destination];

        // If no oracle configured, return a default amount (0.001 ETH for testnet)
        if (oracle.tokenExchangeRate == 0 || oracle.gasPrice == 0) {
            return 1e15; // 0.001 ETH default
        }

        uint256 totalGas = _gasAmount + GAS_OVERHEAD;
        uint256 remoteCost = totalGas * oracle.gasPrice;

        // Convert to local token
        // remoteCost * tokenExchangeRate / 1e10
        return (remoteCost * oracle.tokenExchangeRate) / 1e10;
    }

    /**
     * @notice Withdraw collected fees
     */
    function withdraw() external {
        require(msg.sender == beneficiary, "Only beneficiary");
        (bool success,) = beneficiary.call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }

    /**
     * @notice Post-dispatch hook interface (for Mailbox integration)
     */
    function postDispatch(bytes calldata, bytes calldata _message) external payable {
        // Parse destination from message
        uint32 destination = uint32(bytes4(_message[41:45]));
        bytes32 messageId = keccak256(_message);

        // Default gas amount for automatic payment
        uint256 gasAmount = 300_000;

        emit GasPayment(messageId, destination, gasAmount, msg.value);
    }

    /**
     * @notice Quote for post-dispatch
     */
    function quoteDispatch(bytes calldata, bytes calldata _message) external view returns (uint256) {
        uint32 destination = uint32(bytes4(_message[41:45]));
        return quoteGasPayment(destination, 300_000);
    }

    receive() external payable {}
}
