// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/oauth3/IOAuth3.sol";
import "../src/oauth3/OAuth3IdentityRegistry.sol";
import "../src/oauth3/OAuth3AppRegistry.sol";
import "../src/oauth3/AccountFactory.sol";
import "../src/oauth3/OAuth3TEEVerifier.sol";

contract OAuth3Test is Test {
    OAuth3IdentityRegistry public identityRegistry;
    OAuth3AppRegistry public appRegistry;
    AccountFactory public accountFactory;
    OAuth3TEEVerifier public teeVerifier;

    address public owner;
    address public user1;
    address public user2;
    address public council;

    uint256 public user1PrivateKey;
    uint256 public user2PrivateKey;

    address public constant ENTRY_POINT = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;

    function setUp() public {
        owner = address(this);
        user1PrivateKey = 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef;
        user2PrivateKey = 0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890;
        user1 = vm.addr(user1PrivateKey);
        user2 = vm.addr(user2PrivateKey);
        council = makeAddr("council");

        // Deploy TEE Verifier first (placeholder address for identity registry)
        teeVerifier = new OAuth3TEEVerifier(address(0));

        // Deploy Account Factory
        accountFactory = new AccountFactory(ENTRY_POINT, address(0), address(0));

        // Deploy Identity Registry
        identityRegistry = new OAuth3IdentityRegistry(address(teeVerifier), address(accountFactory));

        // Deploy App Registry
        appRegistry = new OAuth3AppRegistry(address(identityRegistry), address(teeVerifier));

        // Update TEE Verifier with identity registry address
        teeVerifier.setIdentityRegistry(address(identityRegistry));

        // Add trusted measurement for testing
        bytes32 testMeasurement = keccak256("test-measurement");
        teeVerifier.addTrustedMeasurement(testMeasurement);
    }

    // ============ Identity Registry Tests ============

    function test_createIdentity() public {
        IOAuth3IdentityRegistry.IdentityMetadata memory metadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Test User",
            avatar: "https://example.com/avatar.png",
            bio: "Test bio",
            url: "https://example.com",
            jnsName: "test.jeju"
        });

        bytes32 identityId = identityRegistry.createIdentity(user1, address(0), metadata);

        assertNotEq(identityId, bytes32(0));

        IOAuth3IdentityRegistry.Identity memory identity = identityRegistry.getIdentity(identityId);
        assertEq(identity.owner, user1);
        assertEq(identity.nonce, 0);
        assertTrue(identity.createdAt > 0);
    }

    function test_createIdentityWithSmartAccount() public {
        address smartAccount = makeAddr("smartAccount");

        IOAuth3IdentityRegistry.IdentityMetadata memory metadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Smart Account User",
            avatar: "",
            bio: "",
            url: "",
            jnsName: ""
        });

        bytes32 identityId = identityRegistry.createIdentity(user1, smartAccount, metadata);

        IOAuth3IdentityRegistry.Identity memory identity = identityRegistry.getIdentity(identityId);
        assertEq(identity.smartAccount, smartAccount);
    }

    function test_RevertWhen_createDuplicateIdentity() public {
        IOAuth3IdentityRegistry.IdentityMetadata memory metadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Test",
            avatar: "",
            bio: "",
            url: "",
            jnsName: ""
        });

        identityRegistry.createIdentity(user1, address(0), metadata);
        
        vm.expectRevert("Owner already has identity");
        identityRegistry.createIdentity(user1, address(0), metadata);
    }

    function test_transferIdentity() public {
        IOAuth3IdentityRegistry.IdentityMetadata memory metadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Test",
            avatar: "",
            bio: "",
            url: "",
            jnsName: ""
        });

        bytes32 identityId = identityRegistry.createIdentity(user1, address(0), metadata);

        vm.prank(user1);
        identityRegistry.transferIdentity(identityId, user2);

        IOAuth3IdentityRegistry.Identity memory identity = identityRegistry.getIdentity(identityId);
        assertEq(identity.owner, user2);
    }

    function test_updateMetadata() public {
        IOAuth3IdentityRegistry.IdentityMetadata memory metadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Original",
            avatar: "",
            bio: "",
            url: "",
            jnsName: ""
        });

        bytes32 identityId = identityRegistry.createIdentity(user1, address(0), metadata);

        IOAuth3IdentityRegistry.IdentityMetadata memory newMetadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Updated",
            avatar: "new-avatar",
            bio: "new-bio",
            url: "new-url",
            jnsName: "new.jeju"
        });

        vm.prank(user1);
        identityRegistry.updateMetadata(identityId, newMetadata);

        IOAuth3IdentityRegistry.IdentityMetadata memory stored = identityRegistry.getMetadata(identityId);
        assertEq(stored.name, "Updated");
        assertEq(stored.jnsName, "new.jeju");
    }

    // ============ App Registry Tests ============

    function test_registerApp() public {
        string[] memory redirectUris = new string[](2);
        redirectUris[0] = "https://app.example.com/callback";
        redirectUris[1] = "http://localhost:3000/callback";

        IOAuth3IdentityRegistry.AuthProvider[] memory providers = new IOAuth3IdentityRegistry.AuthProvider[](3);
        providers[0] = IOAuth3IdentityRegistry.AuthProvider.WALLET;
        providers[1] = IOAuth3IdentityRegistry.AuthProvider.FARCASTER;
        providers[2] = IOAuth3IdentityRegistry.AuthProvider.GOOGLE;

        IOAuth3AppRegistry.AppConfig memory config = IOAuth3AppRegistry.AppConfig({
            redirectUris: redirectUris,
            allowedProviders: providers,
            jnsName: "testapp.jeju",
            logoUri: "https://example.com/logo.png",
            policyUri: "https://example.com/privacy",
            termsUri: "https://example.com/terms",
            webhookUrl: "https://example.com/webhook"
        });

        bytes32 appId = appRegistry.registerApp("Test App", "A test OAuth3 app", council, config);

        assertNotEq(appId, bytes32(0));

        IOAuth3AppRegistry.App memory app = appRegistry.getApp(appId);
        assertEq(app.name, "Test App");
        assertEq(app.owner, address(this));
        assertEq(app.council, council);
        assertTrue(app.active);
    }

    function test_validateRedirectUri() public {
        string[] memory redirectUris = new string[](1);
        redirectUris[0] = "https://app.example.com/callback";

        IOAuth3IdentityRegistry.AuthProvider[] memory providers = new IOAuth3IdentityRegistry.AuthProvider[](0);

        IOAuth3AppRegistry.AppConfig memory config = IOAuth3AppRegistry.AppConfig({
            redirectUris: redirectUris,
            allowedProviders: providers,
            jnsName: "",
            logoUri: "",
            policyUri: "",
            termsUri: "",
            webhookUrl: ""
        });

        bytes32 appId = appRegistry.registerApp("Redirect Test", "Testing redirect validation", address(0), config);

        assertTrue(appRegistry.validateRedirectUri(appId, "https://app.example.com/callback"));
        assertFalse(appRegistry.validateRedirectUri(appId, "https://evil.com/callback"));
    }

    function test_rotateCredentials() public {
        string[] memory redirectUris = new string[](1);
        redirectUris[0] = "https://app.example.com/callback";

        IOAuth3IdentityRegistry.AuthProvider[] memory providers = new IOAuth3IdentityRegistry.AuthProvider[](0);

        IOAuth3AppRegistry.AppConfig memory config = IOAuth3AppRegistry.AppConfig({
            redirectUris: redirectUris,
            allowedProviders: providers,
            jnsName: "",
            logoUri: "",
            policyUri: "",
            termsUri: "",
            webhookUrl: ""
        });

        bytes32 appId = appRegistry.registerApp("Rotate Test", "Testing credential rotation", address(0), config);

        IOAuth3AppRegistry.AppCredentials memory oldCreds = appRegistry.getAppCredentials(appId);

        // Advance time to ensure different clientId generation
        vm.warp(block.timestamp + 1);
        vm.roll(block.number + 1);


        bytes32 newClientId = appRegistry.rotateCredentials(appId);

        IOAuth3AppRegistry.AppCredentials memory newCreds = appRegistry.getAppCredentials(appId);

        assertNotEq(oldCreds.clientId, newCreds.clientId);
        assertEq(newClientId, newCreds.clientId);
    }

    function test_deactivateApp() public {
        string[] memory redirectUris = new string[](1);
        redirectUris[0] = "https://app.example.com/callback";

        IOAuth3IdentityRegistry.AuthProvider[] memory providers = new IOAuth3IdentityRegistry.AuthProvider[](0);

        IOAuth3AppRegistry.AppConfig memory config = IOAuth3AppRegistry.AppConfig({
            redirectUris: redirectUris,
            allowedProviders: providers,
            jnsName: "",
            logoUri: "",
            policyUri: "",
            termsUri: "",
            webhookUrl: ""
        });

        bytes32 appId = appRegistry.registerApp("Deactivate Test", "Testing deactivation", address(0), config);

        appRegistry.deactivateApp(appId);

        IOAuth3AppRegistry.App memory app = appRegistry.getApp(appId);
        assertFalse(app.active);
    }

    // ============ Account Factory Tests ============

    function test_createAccount() public {
        IOAuth3IdentityRegistry.IdentityMetadata memory metadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Account User",
            avatar: "",
            bio: "",
            url: "",
            jnsName: ""
        });

        bytes32 identityId = identityRegistry.createIdentity(user1, address(0), metadata);

        address account = accountFactory.createAccount(identityId, user1, 0);

        assertNotEq(account, address(0));
        assertTrue(account.code.length > 0);

        (bytes32 storedIdentityId, address storedOwner, uint256 nonce, bool deployed) =
            accountFactory.getAccountInfo(account);

        assertEq(storedIdentityId, identityId);
        assertEq(storedOwner, user1);
        assertEq(nonce, 0);
        assertTrue(deployed);
    }

    function test_getAccountAddress() public {
        bytes32 identityId = keccak256("test-identity");

        address predictedAddress = accountFactory.getAccountAddress(identityId, user1, 0);

        assertNotEq(predictedAddress, address(0));

        // Same inputs should give same address
        address predictedAddress2 = accountFactory.getAccountAddress(identityId, user1, 0);
        assertEq(predictedAddress, predictedAddress2);

        // Different salt should give different address
        address predictedAddress3 = accountFactory.getAccountAddress(identityId, user1, 1);
        assertNotEq(predictedAddress, predictedAddress3);
    }

    function test_addSessionKey() public {
        bytes32 identityId = keccak256("session-test");
        address account = accountFactory.createAccount(identityId, user1, 0);

        IOAuth3AccountFactory.SessionKey memory sessionKey = IOAuth3AccountFactory.SessionKey({
            publicKeyHash: keccak256("session-key-1"),
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 86400),
            target: address(0),
            selector: bytes4(0),
            maxValue: 1 ether,
            active: true
        });

        vm.prank(user1);
        accountFactory.addSessionKey(account, sessionKey);

        IOAuth3AccountFactory.SessionKey[] memory keys = accountFactory.getSessionKeys(account);
        assertEq(keys.length, 1);
        assertEq(keys[0].publicKeyHash, sessionKey.publicKeyHash);
        assertTrue(keys[0].active);
    }

    function test_revokeSessionKey() public {
        bytes32 identityId = keccak256("revoke-test");
        address account = accountFactory.createAccount(identityId, user1, 0);

        bytes32 keyHash = keccak256("session-key-to-revoke");

        IOAuth3AccountFactory.SessionKey memory sessionKey = IOAuth3AccountFactory.SessionKey({
            publicKeyHash: keyHash,
            validAfter: uint48(block.timestamp),
            validUntil: uint48(block.timestamp + 86400),
            target: address(0),
            selector: bytes4(0),
            maxValue: 1 ether,
            active: true
        });

        vm.prank(user1);
        accountFactory.addSessionKey(account, sessionKey);

        vm.prank(user1);
        accountFactory.revokeSessionKey(account, keyHash);

        IOAuth3AccountFactory.SessionKey[] memory keys = accountFactory.getSessionKeys(account);
        assertFalse(keys[0].active);
    }

    // ============ TEE Verifier Tests ============

    function test_registerNode() public {
        bytes32 nodeId = keccak256("test-node");
        bytes32 publicKeyHash = keccak256("node-public-key");

        bytes memory attestation = _createMockAttestation();

        vm.deal(address(this), 2 ether);
        teeVerifier.registerNode{value: 1 ether}(nodeId, attestation, publicKeyHash);

        (address operator, bytes32 storedKeyHash,, bool active) = teeVerifier.getNode(nodeId);

        assertEq(operator, address(this));
        assertEq(storedKeyHash, publicKeyHash);
        assertTrue(active);
    }

    function test_getActiveNodes() public {
        bytes32 node1 = keccak256("node-1");
        bytes32 node2 = keccak256("node-2");

        bytes memory attestation = _createMockAttestation();

        vm.deal(address(this), 3 ether);
        teeVerifier.registerNode{value: 1 ether}(node1, attestation, keccak256("key-1"));
        teeVerifier.registerNode{value: 1 ether}(node2, attestation, keccak256("key-2"));

        bytes32[] memory activeNodes = teeVerifier.getActiveNodes();

        assertEq(activeNodes.length, 2);
    }

    function test_RevertWhen_registerNodeInsufficientStake() public {
        bytes32 nodeId = keccak256("low-stake-node");
        bytes memory attestation = _createMockAttestation();

        vm.deal(address(this), 0.5 ether);
        
        vm.expectRevert("Insufficient stake");
        teeVerifier.registerNode{value: 0.5 ether}(nodeId, attestation, keccak256("key"));
    }

    // ============ Integration Tests ============

    function test_fullOAuth3Flow() public {
        // 1. Register OAuth3 app
        string[] memory redirectUris = new string[](1);
        redirectUris[0] = "https://app.jeju.network/callback";

        IOAuth3IdentityRegistry.AuthProvider[] memory providers = new IOAuth3IdentityRegistry.AuthProvider[](2);
        providers[0] = IOAuth3IdentityRegistry.AuthProvider.WALLET;
        providers[1] = IOAuth3IdentityRegistry.AuthProvider.FARCASTER;

        IOAuth3AppRegistry.AppConfig memory config = IOAuth3AppRegistry.AppConfig({
            redirectUris: redirectUris,
            allowedProviders: providers,
            jnsName: "cloud.jeju",
            logoUri: "https://jeju.network/logo.png",
            policyUri: "https://jeju.network/privacy",
            termsUri: "https://jeju.network/terms",
            webhookUrl: "https://api.jeju.network/webhooks"
        });

        bytes32 appId = appRegistry.registerApp("Jeju Cloud", "Official Jeju Cloud app", council, config);

        // 2. Create identity for user
        IOAuth3IdentityRegistry.IdentityMetadata memory metadata = IOAuth3IdentityRegistry.IdentityMetadata({
            name: "Jeju User",
            avatar: "https://jeju.network/avatar.png",
            bio: "A Jeju Network user",
            url: "https://jeju.network",
            jnsName: "user.jeju"
        });

        bytes32 identityId = identityRegistry.createIdentity(user1, address(0), metadata);

        // 3. Create smart account
        address smartAccount = accountFactory.createAccount(identityId, user1, 0);

        // 4. Link smart account to identity
        vm.prank(user1);
        identityRegistry.setSmartAccount(identityId, smartAccount);

        // 5. Verify the full setup
        IOAuth3IdentityRegistry.Identity memory identity = identityRegistry.getIdentity(identityId);
        assertEq(identity.owner, user1);
        assertEq(identity.smartAccount, smartAccount);

        IOAuth3AppRegistry.App memory app = appRegistry.getApp(appId);
        assertTrue(app.active);

        assertTrue(appRegistry.isProviderAllowed(appId, IOAuth3IdentityRegistry.AuthProvider.WALLET));
        assertTrue(appRegistry.isProviderAllowed(appId, IOAuth3IdentityRegistry.AuthProvider.FARCASTER));
    }

    // ============ Helper Functions ============

    function _createMockAttestation() internal view returns (bytes memory) {
        bytes32 measurement = keccak256("test-measurement");
        bytes32 reportData = keccak256("test-report");
        uint8 provider = 0; // DSTACK

        // Create mock signature (64 bytes minimum)
        bytes memory signature = new bytes(64);
        for (uint i = 0; i < 64; i++) {
            signature[i] = bytes1(uint8(i));
        }

        uint16 sigLength = 64;

        return abi.encodePacked(
            measurement, // 32 bytes
            reportData, // 32 bytes
            provider, // 1 byte
            sigLength, // 2 bytes (big-endian)
            signature // 64 bytes
        );
    }
}
