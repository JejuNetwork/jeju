// SPDX-License-Identifier: MIT
pragma solidity ^0.8.12;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "openzeppelin-contracts/contracts/utils/cryptography/MessageHashUtils.sol";
import {Initializable} from "openzeppelin-contracts/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "openzeppelin-contracts/contracts/proxy/utils/UUPSUpgradeable.sol";
import {Create2} from "openzeppelin-contracts/contracts/utils/Create2.sol";
import {ERC1967Proxy} from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Proxy.sol";

interface IEntryPointV06 {
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;
    function getNonce(address sender, uint192 key) external view returns (uint256);
}

struct UserOperationV06 {
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

/**
 * @title SimpleAccountV06
 * @notice Minimal v0.6 compatible account
 */
contract SimpleAccountV06 is UUPSUpgradeable, Initializable {
    using ECDSA for bytes32;

    address public owner;
    IEntryPointV06 public immutable entryPoint;

    uint256 internal constant SIG_VALIDATION_FAILED = 1;

    event SimpleAccountInitialized(address indexed entryPoint, address indexed owner);

    modifier onlyOwner() {
        require(msg.sender == owner || msg.sender == address(this), "only owner");
        _;
    }

    modifier onlyEntryPointOrOwner() {
        require(msg.sender == address(entryPoint) || msg.sender == owner, "only entrypoint or owner");
        _;
    }

    modifier onlyEntryPoint() {
        require(msg.sender == address(entryPoint), "only entrypoint");
        _;
    }

    constructor(IEntryPointV06 _entryPoint) {
        entryPoint = _entryPoint;
        _disableInitializers();
    }

    function initialize(address _owner) public initializer {
        owner = _owner;
        emit SimpleAccountInitialized(address(entryPoint), owner);
    }

    function validateUserOp(
        UserOperationV06 calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external onlyEntryPoint returns (uint256 validationData) {
        validationData = _validateSignature(userOp, userOpHash);
        if (missingAccountFunds > 0) {
            (bool success,) = payable(msg.sender).call{value: missingAccountFunds}("");
            (success); // ignore failure
        }
    }

    function _validateSignature(UserOperationV06 calldata userOp, bytes32 userOpHash)
        internal
        view
        returns (uint256 validationData)
    {
        bytes32 hash = MessageHashUtils.toEthSignedMessageHash(userOpHash);
        if (owner != ECDSA.recover(hash, userOp.signature)) {
            return SIG_VALIDATION_FAILED;
        }
        return 0;
    }

    function execute(address dest, uint256 value, bytes calldata func) external onlyEntryPointOrOwner {
        (bool success, bytes memory result) = dest.call{value: value}(func);
        if (!success) {
            assembly {
                revert(add(result, 32), mload(result))
            }
        }
    }

    function _authorizeUpgrade(address) internal view override onlyOwner {}

    receive() external payable {}
}

/**
 * @title SimpleAccountFactoryV06
 * @notice Factory for v0.6 SimpleAccount
 */
contract SimpleAccountFactoryV06 {
    SimpleAccountV06 public immutable accountImplementation;

    constructor(IEntryPointV06 _entryPoint) {
        accountImplementation = new SimpleAccountV06(_entryPoint);
    }

    function createAccount(address owner, uint256 salt) public returns (SimpleAccountV06) {
        address addr = getAddress(owner, salt);
        uint256 codeSize;
        assembly {
            codeSize := extcodesize(addr)
        }
        if (codeSize > 0) {
            return SimpleAccountV06(payable(addr));
        }
        return SimpleAccountV06(payable(
            address(new ERC1967Proxy{salt: bytes32(salt)}(
                address(accountImplementation),
                abi.encodeCall(SimpleAccountV06.initialize, (owner))
            ))
        ));
    }

    function getAddress(address owner, uint256 salt) public view returns (address) {
        return Create2.computeAddress(
            bytes32(salt),
            keccak256(abi.encodePacked(
                type(ERC1967Proxy).creationCode,
                abi.encode(
                    address(accountImplementation),
                    abi.encodeCall(SimpleAccountV06.initialize, (owner))
                )
            ))
        );
    }
}

