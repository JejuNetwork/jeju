// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IOAuth3
 * @notice Interface definitions for the OAuth3 decentralized authentication system
 * @dev Provides multi-provider authentication with TEE-backed key management
 */

interface IOAuth3IdentityRegistry {
    enum AuthProvider {
        WALLET,
        FARCASTER,
        GOOGLE,
        APPLE,
        TWITTER,
        GITHUB,
        DISCORD
    }

    struct Identity {
        bytes32 id;
        address owner;
        address smartAccount;
        uint256 createdAt;
        uint256 updatedAt;
        uint256 nonce;
        bool active;
    }

    struct LinkedProvider {
        AuthProvider provider;
        bytes32 providerId;
        string providerHandle;
        uint256 linkedAt;
        bool verified;
        bytes32 credentialHash;
    }

    struct IdentityMetadata {
        string name;
        string avatar;
        string bio;
        string url;
        string jnsName;
    }

    event IdentityCreated(
        bytes32 indexed identityId,
        address indexed owner,
        address smartAccount,
        uint256 timestamp
    );

    event ProviderLinked(
        bytes32 indexed identityId,
        AuthProvider indexed provider,
        bytes32 providerId,
        string providerHandle,
        uint256 timestamp
    );

    event ProviderUnlinked(
        bytes32 indexed identityId,
        AuthProvider indexed provider,
        bytes32 providerId,
        uint256 timestamp
    );

    event CredentialIssued(
        bytes32 indexed identityId,
        AuthProvider indexed provider,
        bytes32 credentialHash,
        uint256 timestamp
    );

    event MetadataUpdated(
        bytes32 indexed identityId,
        uint256 timestamp
    );

    event IdentityTransferred(
        bytes32 indexed identityId,
        address indexed previousOwner,
        address indexed newOwner,
        uint256 timestamp
    );

    function createIdentity(
        address owner,
        address smartAccount,
        IdentityMetadata calldata metadata
    ) external returns (bytes32 identityId);

    function linkProvider(
        bytes32 identityId,
        AuthProvider provider,
        bytes32 providerId,
        string calldata providerHandle,
        bytes calldata proof
    ) external;

    function unlinkProvider(
        bytes32 identityId,
        AuthProvider provider,
        bytes32 providerId
    ) external;

    function issueCredential(
        bytes32 identityId,
        AuthProvider provider,
        bytes32 credentialHash
    ) external;

    function updateMetadata(
        bytes32 identityId,
        IdentityMetadata calldata metadata
    ) external;

    function transferIdentity(
        bytes32 identityId,
        address newOwner
    ) external;

    function getIdentity(bytes32 identityId) external view returns (Identity memory);
    function getIdentityByOwner(address owner) external view returns (Identity memory);
    function getIdentityBySmartAccount(address smartAccount) external view returns (Identity memory);
    function getLinkedProviders(bytes32 identityId) external view returns (LinkedProvider[] memory);
    function getMetadata(bytes32 identityId) external view returns (IdentityMetadata memory);
    function isProviderLinked(bytes32 identityId, AuthProvider provider, bytes32 providerId) external view returns (bool);
    function getProviderIdentity(AuthProvider provider, bytes32 providerId) external view returns (bytes32);
}

interface IOAuth3AppRegistry {
    struct App {
        bytes32 appId;
        string name;
        string description;
        address owner;
        address council;
        uint256 createdAt;
        bool active;
    }

    struct AppCredentials {
        bytes32 clientId;
        bytes32 clientSecretHash;
    }

    struct AppConfig {
        string[] redirectUris;
        IOAuth3IdentityRegistry.AuthProvider[] allowedProviders;
        string jnsName;
        string logoUri;
        string policyUri;
        string termsUri;
        string webhookUrl;
    }

    event AppRegistered(
        bytes32 indexed appId,
        address indexed owner,
        address indexed council,
        string name,
        uint256 timestamp
    );

    event AppUpdated(
        bytes32 indexed appId,
        uint256 timestamp
    );

    event AppCredentialsRotated(
        bytes32 indexed appId,
        bytes32 newClientId,
        uint256 timestamp
    );

    event AppDeactivated(
        bytes32 indexed appId,
        uint256 timestamp
    );

    function registerApp(
        string calldata name,
        string calldata description,
        address council,
        AppConfig calldata config
    ) external returns (bytes32 appId);

    function updateApp(
        bytes32 appId,
        string calldata name,
        string calldata description,
        AppConfig calldata config
    ) external;

    function rotateCredentials(bytes32 appId) external returns (bytes32 newClientId);

    function deactivateApp(bytes32 appId) external;

    function reactivateApp(bytes32 appId) external;

    function transferApp(bytes32 appId, address newOwner) external;

    function getApp(bytes32 appId) external view returns (App memory);
    function getAppConfig(bytes32 appId) external view returns (AppConfig memory);
    function getAppByClientId(bytes32 clientId) external view returns (App memory);
    function getAppsByOwner(address owner) external view returns (bytes32[] memory);
    function getAppsByCouncil(address council) external view returns (bytes32[] memory);
    function validateRedirectUri(bytes32 appId, string calldata uri) external view returns (bool);
    function isProviderAllowed(bytes32 appId, IOAuth3IdentityRegistry.AuthProvider provider) external view returns (bool);
}

interface IOAuth3AccountFactory {
    struct AccountConfig {
        address entryPoint;
        address defaultValidator;
        address recoveryModule;
        address sessionKeyModule;
    }

    struct SessionKey {
        bytes32 publicKeyHash;
        address target;
        bytes4 selector;
        uint256 maxValue;
        uint48 validAfter;
        uint48 validUntil;
        bool active;
    }

    event AccountCreated(
        address indexed account,
        bytes32 indexed identityId,
        address indexed owner,
        uint256 timestamp
    );

    event SessionKeyAdded(
        address indexed account,
        bytes32 indexed keyHash,
        uint48 validUntil,
        uint256 timestamp
    );

    event SessionKeyRevoked(
        address indexed account,
        bytes32 indexed keyHash,
        uint256 timestamp
    );

    event RecoveryInitiated(
        address indexed account,
        address indexed newOwner,
        uint256 executeAfter,
        uint256 timestamp
    );

    function createAccount(
        bytes32 identityId,
        address owner,
        uint256 salt
    ) external returns (address account);

    function getAccountAddress(
        bytes32 identityId,
        address owner,
        uint256 salt
    ) external view returns (address);

    function addSessionKey(
        address account,
        SessionKey calldata sessionKey
    ) external;

    function revokeSessionKey(
        address account,
        bytes32 keyHash
    ) external;

    function initiateRecovery(
        address account,
        address newOwner,
        bytes calldata recoveryProof
    ) external;

    function executeRecovery(address account) external;

    function cancelRecovery(address account) external;

    function getAccountInfo(address account) external view returns (
        bytes32 identityId,
        address owner,
        uint256 nonce,
        bool deployed
    );

    function getSessionKeys(address account) external view returns (SessionKey[] memory);
}

interface IOAuth3TEEVerifier {
    struct Attestation {
        bytes quote;
        bytes32 measurement;
        bytes32 reportData;
        uint256 timestamp;
        uint8 provider;
        bool verified;
    }

    event AttestationVerified(
        bytes32 indexed nodeId,
        bytes32 measurement,
        uint256 timestamp
    );

    event NodeRegistered(
        bytes32 indexed nodeId,
        address indexed operator,
        bytes32 publicKeyHash,
        uint256 timestamp
    );

    function verifyAttestation(
        bytes calldata quote,
        bytes32 expectedMeasurement
    ) external returns (bool valid, Attestation memory attestation);

    function registerNode(
        bytes32 nodeId,
        bytes calldata attestation,
        bytes32 publicKeyHash
    ) external;

    function deregisterNode(bytes32 nodeId) external;

    function getNode(bytes32 nodeId) external view returns (
        address operator,
        bytes32 publicKeyHash,
        Attestation memory attestation,
        bool active
    );

    function isNodeActive(bytes32 nodeId) external view returns (bool);
    function getActiveNodes() external view returns (bytes32[] memory);
}
