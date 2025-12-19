// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title WarpRoute
 * @notice Minimal Hyperlane Token Router for cross-chain transfers
 * @dev Collateral mode: locks tokens when sending, unlocks when receiving
 *      Synthetic mode: burns tokens when sending, mints when receiving
 */
contract WarpRoute is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Hyperlane Mailbox interface
    IMailbox public immutable mailbox;

    // The token this route handles
    IERC20 public immutable token;

    // Whether this is the home chain (collateral) or synthetic chain
    bool public immutable isCollateral;

    // Interchain Security Module (validates incoming messages)
    address public interchainSecurityModule;

    // Remote warp routes by domain
    mapping(uint32 => bytes32) public routers;

    // Interchain Gas Paymaster for paying gas on destination chain
    address public igp;

    // Events
    event SentTransferRemote(
        uint32 indexed destination, bytes32 indexed recipient, uint256 amount, bytes32 messageId
    );
    event ReceivedTransferRemote(uint32 indexed origin, bytes32 indexed sender, address recipient, uint256 amount);
    event RouterEnrolled(uint32 indexed domain, bytes32 router);
    event IsmSet(address indexed ism);
    event IgpSet(address indexed igp);

    error InvalidRouter();
    error InvalidRecipient();
    error UnauthorizedMessage();
    error InsufficientValue();

    constructor(address _mailbox, address _token, bool _isCollateral, address _owner) Ownable(_owner) {
        mailbox = IMailbox(_mailbox);
        token = IERC20(_token);
        isCollateral = _isCollateral;
    }

    /**
     * @notice Enroll a remote router for a domain
     * @param _domain The Hyperlane domain ID
     * @param _router The router address as bytes32 (padded address)
     */
    function enrollRemoteRouter(uint32 _domain, bytes32 _router) external onlyOwner {
        routers[_domain] = _router;
        emit RouterEnrolled(_domain, _router);
    }

    /**
     * @notice Enroll multiple remote routers
     */
    function enrollRemoteRouters(uint32[] calldata _domains, bytes32[] calldata _routers) external onlyOwner {
        require(_domains.length == _routers.length, "Length mismatch");
        for (uint256 i = 0; i < _domains.length; i++) {
            routers[_domains[i]] = _routers[i];
            emit RouterEnrolled(_domains[i], _routers[i]);
        }
    }

    /**
     * @notice Set the Interchain Security Module
     */
    function setInterchainSecurityModule(address _ism) external onlyOwner {
        interchainSecurityModule = _ism;
        emit IsmSet(_ism);
    }

    /**
     * @notice Set the Interchain Gas Paymaster
     */
    function setInterchainGasPaymaster(address _igp) external onlyOwner {
        igp = _igp;
        emit IgpSet(_igp);
    }

    /**
     * @notice Get quote for gas payment to destination
     * @param _destination The destination domain
     * @return The gas payment amount in native token
     */
    function quoteGasPayment(uint32 _destination) public view returns (uint256) {
        if (igp == address(0)) return 0;
        return IInterchainGasPaymaster(igp).quoteGasPayment(_destination, 300_000);
    }

    /**
     * @notice Transfer tokens to a remote chain
     * @param _destination The destination domain ID
     * @param _recipient The recipient address as bytes32
     * @param _amount The amount to transfer
     * @return messageId The Hyperlane message ID
     */
    function transferRemote(uint32 _destination, bytes32 _recipient, uint256 _amount)
        external
        payable
        nonReentrant
        returns (bytes32 messageId)
    {
        if (routers[_destination] == bytes32(0)) revert InvalidRouter();
        if (_recipient == bytes32(0)) revert InvalidRecipient();

        // Handle tokens based on mode
        if (isCollateral) {
            // Lock tokens in this contract
            token.safeTransferFrom(msg.sender, address(this), _amount);
        } else {
            // Burn tokens (requires this contract to be authorized burner)
            IBurnable(address(token)).burnFrom(msg.sender, _amount);
        }

        // Encode the message: recipient (32 bytes) + amount (32 bytes)
        bytes memory message = abi.encode(_recipient, _amount);

        // Get gas quote
        uint256 gasPayment = quoteGasPayment(_destination);
        if (msg.value < gasPayment) revert InsufficientValue();

        // Dispatch to Hyperlane mailbox
        messageId = mailbox.dispatch{value: msg.value}(_destination, routers[_destination], message);

        emit SentTransferRemote(_destination, _recipient, _amount, messageId);
    }

    /**
     * @notice Handle incoming message from Hyperlane mailbox
     * @dev Only callable by the mailbox
     */
    function handle(uint32 _origin, bytes32 _sender, bytes calldata _message) external {
        // Only mailbox can call
        require(msg.sender == address(mailbox), "Only mailbox");

        // Verify the sender is an enrolled router
        if (routers[_origin] != _sender) revert UnauthorizedMessage();

        // Decode message
        (bytes32 recipientBytes32, uint256 amount) = abi.decode(_message, (bytes32, uint256));
        address recipient = address(uint160(uint256(recipientBytes32)));

        // Handle tokens based on mode
        if (isCollateral) {
            // Unlock tokens from this contract
            token.safeTransfer(recipient, amount);
        } else {
            // Mint tokens (requires this contract to be authorized minter)
            IMintable(address(token)).mint(recipient, amount);
        }

        emit ReceivedTransferRemote(_origin, _sender, recipient, amount);
    }

    /**
     * @notice Rescue tokens accidentally sent to this contract
     * @dev Only owner, cannot rescue locked collateral
     */
    function rescueTokens(address _token, address _to, uint256 _amount) external onlyOwner {
        require(!isCollateral || _token != address(token), "Cannot rescue collateral");
        IERC20(_token).safeTransfer(_to, _amount);
    }
}

// Minimal interfaces
interface IMailbox {
    function dispatch(uint32 _destination, bytes32 _recipient, bytes calldata _body)
        external
        payable
        returns (bytes32 messageId);

    function localDomain() external view returns (uint32);
}

interface IInterchainGasPaymaster {
    function quoteGasPayment(uint32 _destination, uint256 _gasAmount) external view returns (uint256);
}

interface IMintable {
    function mint(address to, uint256 amount) external;
}

interface IBurnable {
    function burnFrom(address from, uint256 amount) external;
}






