// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IOAuth3IdentityRegistry} from "./IOAuth3.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/**
 * @title OAuth3IdentityRegistry
 * @notice On-chain registry for OAuth3 decentralized identities
 * @dev Links multiple authentication providers to a single identity with VC support
 */
contract OAuth3IdentityRegistry is IOAuth3IdentityRegistry, EIP712 {
    using ECDSA for bytes32;

    bytes32 private constant LINK_PROVIDER_TYPEHASH = keccak256(
        "LinkProvider(bytes32 identityId,uint8 provider,bytes32 providerId,string providerHandle,uint256 nonce,uint256 deadline)"
    );

    bytes32 private constant TRANSFER_IDENTITY_TYPEHASH =
        keccak256("TransferIdentity(bytes32 identityId,address newOwner,uint256 nonce,uint256 deadline)");

    address public teeVerifier;
    address public accountFactory;
    uint256 public totalIdentities;

    mapping(bytes32 => Identity) private identities;
    mapping(bytes32 => IdentityMetadata) private metadata;
    mapping(bytes32 => LinkedProvider[]) private linkedProviders;
    mapping(address => bytes32) private ownerToIdentity;
    mapping(address => bytes32) private smartAccountToIdentity;
    mapping(bytes32 => bytes32) private providerToIdentity;

    modifier onlyIdentityOwner(bytes32 identityId) {
        require(identities[identityId].owner == msg.sender, "Not identity owner");
        _;
    }

    modifier identityExists(bytes32 identityId) {
        require(identities[identityId].createdAt > 0, "Identity not found");
        _;
    }

    constructor(address _teeVerifier, address _accountFactory) EIP712("OAuth3IdentityRegistry", "1") {
        teeVerifier = _teeVerifier;
        accountFactory = _accountFactory;
    }

    function createIdentity(address owner, address smartAccount, IdentityMetadata calldata _metadata)
        external
        returns (bytes32 identityId)
    {
        require(owner != address(0), "Invalid owner");
        require(ownerToIdentity[owner] == bytes32(0), "Owner already has identity");

        if (smartAccount != address(0)) {
            require(smartAccountToIdentity[smartAccount] == bytes32(0), "Smart account already linked");
        }

        identityId = keccak256(abi.encodePacked(owner, smartAccount, block.timestamp, block.chainid, totalIdentities));

        identities[identityId] = Identity({
            id: identityId,
            owner: owner,
            smartAccount: smartAccount,
            createdAt: block.timestamp,
            updatedAt: block.timestamp,
            nonce: 0,
            active: true
        });

        metadata[identityId] = _metadata;
        ownerToIdentity[owner] = identityId;

        if (smartAccount != address(0)) {
            smartAccountToIdentity[smartAccount] = identityId;
        }

        totalIdentities++;

        emit IdentityCreated(identityId, owner, smartAccount, block.timestamp);
    }

    function linkProvider(
        bytes32 identityId,
        AuthProvider provider,
        bytes32 providerId,
        string calldata providerHandle,
        bytes calldata proof
    ) external identityExists(identityId) onlyIdentityOwner(identityId) {
        bytes32 providerKey = _getProviderKey(provider, providerId);
        require(providerToIdentity[providerKey] == bytes32(0), "Provider already linked to another identity");

        _verifyProviderProof(identityId, provider, providerId, providerHandle, proof);

        linkedProviders[identityId].push(
            LinkedProvider({
                provider: provider,
                providerId: providerId,
                providerHandle: providerHandle,
                linkedAt: block.timestamp,
                verified: true,
                credentialHash: bytes32(0)
            })
        );

        providerToIdentity[providerKey] = identityId;
        identities[identityId].updatedAt = block.timestamp;
        identities[identityId].nonce++;

        emit ProviderLinked(identityId, provider, providerId, providerHandle, block.timestamp);
    }

    function unlinkProvider(bytes32 identityId, AuthProvider provider, bytes32 providerId)
        external
        identityExists(identityId)
        onlyIdentityOwner(identityId)
    {
        bytes32 providerKey = _getProviderKey(provider, providerId);
        require(providerToIdentity[providerKey] == identityId, "Provider not linked to this identity");

        LinkedProvider[] storage providers = linkedProviders[identityId];
        for (uint256 i = 0; i < providers.length; i++) {
            if (providers[i].provider == provider && providers[i].providerId == providerId) {
                providers[i] = providers[providers.length - 1];
                providers.pop();
                break;
            }
        }

        delete providerToIdentity[providerKey];
        identities[identityId].updatedAt = block.timestamp;
        identities[identityId].nonce++;

        emit ProviderUnlinked(identityId, provider, providerId, block.timestamp);
    }

    function issueCredential(bytes32 identityId, AuthProvider provider, bytes32 credentialHash)
        external
        identityExists(identityId)
    {
        require(msg.sender == teeVerifier, "Only TEE verifier can issue credentials");

        LinkedProvider[] storage providers = linkedProviders[identityId];
        for (uint256 i = 0; i < providers.length; i++) {
            if (providers[i].provider == provider) {
                providers[i].credentialHash = credentialHash;
                providers[i].verified = true;
                break;
            }
        }

        emit CredentialIssued(identityId, provider, credentialHash, block.timestamp);
    }

    function updateMetadata(bytes32 identityId, IdentityMetadata calldata _metadata)
        external
        identityExists(identityId)
        onlyIdentityOwner(identityId)
    {
        metadata[identityId] = _metadata;
        identities[identityId].updatedAt = block.timestamp;
        identities[identityId].nonce++;

        emit MetadataUpdated(identityId, block.timestamp);
    }

    function transferIdentity(bytes32 identityId, address newOwner)
        external
        identityExists(identityId)
        onlyIdentityOwner(identityId)
    {
        require(newOwner != address(0), "Invalid new owner");
        require(ownerToIdentity[newOwner] == bytes32(0), "New owner already has identity");

        address previousOwner = identities[identityId].owner;

        delete ownerToIdentity[previousOwner];
        ownerToIdentity[newOwner] = identityId;
        identities[identityId].owner = newOwner;
        identities[identityId].updatedAt = block.timestamp;
        identities[identityId].nonce++;

        emit IdentityTransferred(identityId, previousOwner, newOwner, block.timestamp);
    }

    function setSmartAccount(bytes32 identityId, address smartAccount) external identityExists(identityId) {
        require(msg.sender == identities[identityId].owner || msg.sender == accountFactory, "Unauthorized");
        require(smartAccountToIdentity[smartAccount] == bytes32(0), "Smart account already linked");

        address previousAccount = identities[identityId].smartAccount;
        if (previousAccount != address(0)) {
            delete smartAccountToIdentity[previousAccount];
        }

        smartAccountToIdentity[smartAccount] = identityId;
        identities[identityId].smartAccount = smartAccount;
        identities[identityId].updatedAt = block.timestamp;
    }

    function getIdentity(bytes32 identityId) external view returns (Identity memory) {
        return identities[identityId];
    }

    function getIdentityByOwner(address owner) external view returns (Identity memory) {
        return identities[ownerToIdentity[owner]];
    }

    function getIdentityBySmartAccount(address smartAccount) external view returns (Identity memory) {
        return identities[smartAccountToIdentity[smartAccount]];
    }

    function getLinkedProviders(bytes32 identityId) external view returns (LinkedProvider[] memory) {
        return linkedProviders[identityId];
    }

    function getMetadata(bytes32 identityId) external view returns (IdentityMetadata memory) {
        return metadata[identityId];
    }

    function isProviderLinked(bytes32 identityId, AuthProvider provider, bytes32 providerId)
        external
        view
        returns (bool)
    {
        bytes32 providerKey = _getProviderKey(provider, providerId);
        return providerToIdentity[providerKey] == identityId;
    }

    function getProviderIdentity(AuthProvider provider, bytes32 providerId) external view returns (bytes32) {
        return providerToIdentity[_getProviderKey(provider, providerId)];
    }

    function _getProviderKey(AuthProvider provider, bytes32 providerId) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(provider, providerId));
    }

    function _verifyProviderProof(
        bytes32 identityId,
        AuthProvider provider,
        bytes32 providerId,
        string calldata providerHandle,
        bytes calldata proof
    ) internal view {
        if (provider == AuthProvider.WALLET) {
            bytes32 messageHash = _hashTypedDataV4(
                keccak256(
                    abi.encode(
                        LINK_PROVIDER_TYPEHASH,
                        identityId,
                        uint8(provider),
                        providerId,
                        keccak256(bytes(providerHandle)),
                        identities[identityId].nonce,
                        block.timestamp + 1 hours
                    )
                )
            );

            address signer = messageHash.recover(proof);
            require(signer == address(uint160(uint256(providerId))), "Invalid wallet signature");
        } else if (provider == AuthProvider.FARCASTER) {
            _verifyFarcasterProof(identityId, providerId, proof);
        } else {
            _verifyTEEProof(identityId, provider, providerId, proof);
        }
    }

    function _verifyFarcasterProof(bytes32 identityId, bytes32 providerId, bytes calldata proof) internal view {
        (bytes memory signature, address custodyAddress, uint256 deadline) =
            abi.decode(proof, (bytes, address, uint256));

        require(block.timestamp <= deadline, "Proof expired");

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                "Link Farcaster FID ",
                uint256(providerId),
                " to OAuth3 identity ",
                identityId,
                " on chain ",
                block.chainid
            )
        );

        address signer = ECDSA.recover(MessageHashUtils.toEthSignedMessageHash(messageHash), signature);
        require(signer == custodyAddress, "Invalid Farcaster custody signature");
    }

    function _verifyTEEProof(bytes32, AuthProvider, bytes32, bytes calldata proof) internal view {
        require(proof.length >= 32, "Invalid TEE proof");

        bytes32 attestationHash = bytes32(proof[:32]);
        require(attestationHash != bytes32(0), "Missing attestation");
    }
}
