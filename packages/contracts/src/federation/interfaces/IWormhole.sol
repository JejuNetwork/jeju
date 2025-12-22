// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/**
 * @title IWormhole
 * @notice Interface for Wormhole Core Bridge Contract
 * @dev Used for cross-chain message verification between EVM and non-EVM chains
 *
 * Wormhole Addresses by Network:
 * - Ethereum Mainnet: 0x98f3c9e6E3fAce36bAAd05FE09d375Ef1464288B
 * - Base: 0xbebdb6C8ddC678FfA9f8748f85C815C556Dd8ac6
 * - Base Sepolia: 0x79A1027a6A159502049F10906D333EC57E95F083
 * - Solana (chain ID 1): 3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5
 */
interface IWormhole {
    /// @notice Parsed VAA structure
    struct VM {
        uint8 version;
        uint32 timestamp;
        uint32 nonce;
        uint16 emitterChainId;
        bytes32 emitterAddress;
        uint64 sequence;
        uint8 consistencyLevel;
        bytes payload;
        uint32 guardianSetIndex;
        Signature[] signatures;
        bytes32 hash;
    }

    /// @notice Guardian signature
    struct Signature {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint8 guardianIndex;
    }

    /// @notice Guardian set information
    struct GuardianSet {
        address[] keys;
        uint32 expirationTime;
    }

    /**
     * @notice Parse and verify a VAA
     * @param encodedVM The encoded VAA bytes
     * @return vm The parsed VAA structure
     * @return valid Whether the VAA is valid
     * @return reason Error message if invalid
     */
    function parseAndVerifyVM(bytes calldata encodedVM)
        external
        view
        returns (VM memory vm, bool valid, string memory reason);

    /**
     * @notice Parse a VAA without verification (for testing/read-only)
     * @param encodedVM The encoded VAA bytes
     * @return vm The parsed VAA structure
     */
    function parseVM(bytes calldata encodedVM) external pure returns (VM memory vm);

    /**
     * @notice Get the current guardian set
     * @param index The guardian set index
     * @return guardianSet The guardian set
     */
    function getGuardianSet(uint32 index) external view returns (GuardianSet memory guardianSet);

    /**
     * @notice Get the current guardian set index
     * @return index The current guardian set index
     */
    function getCurrentGuardianSetIndex() external view returns (uint32 index);

    /**
     * @notice Get the message fee for publishing
     * @return fee The message fee in wei
     */
    function messageFee() external view returns (uint256 fee);

    /**
     * @notice Publish a message to be picked up by guardians
     * @param nonce Unique nonce for this message
     * @param payload The message payload
     * @param consistencyLevel Finality requirements
     * @return sequence The sequence number of this message
     */
    function publishMessage(uint32 nonce, bytes calldata payload, uint8 consistencyLevel)
        external
        payable
        returns (uint64 sequence);

    /**
     * @notice Verify a batch of signatures
     * @param hash The message hash
     * @param signatures The signatures to verify
     * @param guardianSet The guardian set to verify against
     */
    function verifySignatures(bytes32 hash, Signature[] calldata signatures, GuardianSet memory guardianSet)
        external
        pure;

    /**
     * @notice Chain ID assigned by Wormhole
     * @return chainId The Wormhole chain ID
     */
    function chainId() external view returns (uint16 chainId);

    /**
     * @notice Governance chain ID
     * @return governanceChainId The governance chain ID (usually Solana = 1)
     */
    function governanceChainId() external view returns (uint16 governanceChainId);

    /**
     * @notice Governance contract address
     * @return governanceContract The governance contract address
     */
    function governanceContract() external view returns (bytes32 governanceContract);

    /**
     * @notice Check if a VAA has been consumed (for replay protection)
     * @param hash The VAA hash
     * @return consumed Whether the VAA has been consumed
     */
    function isVAAConsumed(bytes32 hash) external view returns (bool consumed);
}

/**
 * @title IWormholeRelayer
 * @notice Interface for Wormhole Automatic Relayer
 * @dev Used for automatic cross-chain message delivery
 */
interface IWormholeRelayer {
    /**
     * @notice Send a cross-chain message
     * @param targetChain The target chain ID
     * @param targetAddress The target contract address
     * @param payload The message payload
     * @param receiverValue Amount of native currency to send to receiver
     * @param gasLimit Gas limit for the target chain execution
     * @return sequence The sequence number of the send
     */
    function sendPayloadToEvm(
        uint16 targetChain,
        address targetAddress,
        bytes calldata payload,
        uint256 receiverValue,
        uint256 gasLimit
    ) external payable returns (uint64 sequence);

    /**
     * @notice Quote the cost of sending a message
     * @param targetChain The target chain ID
     * @param receiverValue Amount of native currency to send to receiver
     * @param gasLimit Gas limit for the target chain execution
     * @return nativePriceQuote The cost in native currency
     * @return targetChainRefundPerGasUnused Refund per unused gas unit
     */
    function quoteEVMDeliveryPrice(uint16 targetChain, uint256 receiverValue, uint256 gasLimit)
        external
        view
        returns (uint256 nativePriceQuote, uint256 targetChainRefundPerGasUnused);
}

/**
 * @title IWormholeReceiver
 * @notice Interface that contracts receiving Wormhole messages must implement
 */
interface IWormholeReceiver {
    /**
     * @notice Receive a cross-chain message
     * @param payload The message payload
     * @param additionalVaas Additional VAAs (if any)
     * @param sourceAddress The source contract address (bytes32 for non-EVM)
     * @param sourceChain The source chain ID
     * @param deliveryHash Unique identifier for this delivery
     */
    function receiveWormholeMessages(
        bytes memory payload,
        bytes[] memory additionalVaas,
        bytes32 sourceAddress,
        uint16 sourceChain,
        bytes32 deliveryHash
    ) external payable;
}
