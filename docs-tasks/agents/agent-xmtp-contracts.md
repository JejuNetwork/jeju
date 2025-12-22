# Agent Task: XMTP Integration with Existing KeyRegistry Contract

## Priority: P0
## Estimated Time: 1-2 days
## Dependencies: agent-xmtp-identity

## Objective

Extend the existing KeyRegistry contract to support XMTP identity keys alongside the current X25519 messaging keys, enabling unified key discovery for both Jeju native messaging and XMTP messaging.

## Source Files to Analyze

- `packages/messaging/contracts/KeyRegistry.sol` - Current key registry
- `packages/contracts/src/oauth3/OAuth3IdentityRegistry.sol` - Identity registry
- `packages/sdk/src/messaging/index.ts` - SDK messaging module

## Implementation Tasks

### 1. Update KeyRegistry Contract

File: `packages/messaging/contracts/KeyRegistry.sol` (update)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IIdentityRegistry {
    function ownerOf(uint256 agentId) external view returns (address);
    function exists(uint256 agentId) external view returns (bool);
}

/**
 * @title KeyRegistry
 * @notice On-chain registry for public encryption keys (Jeju + XMTP)
 * @dev Updated to support both Jeju native X25519 keys and XMTP identity keys
 */
contract KeyRegistry is ReentrancyGuard {
    
    // ============ Structs ============
    
    struct PublicKeyBundle {
        bytes32 identityKey;
        bytes32 signedPreKey;
        bytes32 preKeySignature;
        uint256 preKeyTimestamp;
        uint256 registeredAt;
        uint256 lastUpdated;
        bool isActive;
    }
    
    // NEW: XMTP-specific key structure
    struct XMTPKeyBundle {
        bytes identityPublicKey;    // Variable length for different key types
        bytes installationPublicKey;
        bytes32 installationId;
        string keyBundleVersion;    // e.g., "mls-1.0"
        uint256 registeredAt;
        uint256 lastUpdated;
        bool isActive;
    }
    
    // NEW: TEE attestation for key operations
    struct TEEAttestation {
        bytes32 enclaveId;
        bytes32 measurementHash;
        bytes signature;
        uint256 timestamp;
        bool verified;
    }
    
    // ============ State Variables ============
    
    // Existing mappings
    mapping(address => PublicKeyBundle) public keyBundles;
    mapping(address => OneTimePreKey[]) public oneTimePreKeys;
    mapping(address => uint256) public oneTimePreKeyIndex;
    mapping(address => bytes32[]) public keyHistory;
    mapping(uint256 => PublicKeyBundle) public agentKeyBundles;
    
    // NEW: XMTP key mappings
    mapping(address => XMTPKeyBundle) public xmtpKeys;
    mapping(bytes32 => address) public installationToAddress;
    mapping(address => TEEAttestation) public keyAttestations;
    
    IIdentityRegistry public immutable identityRegistry;
    
    // ============ Events ============
    
    // Existing events...
    
    // NEW: XMTP events
    event XMTPKeyRegistered(
        address indexed user,
        bytes32 indexed installationId,
        string keyBundleVersion,
        uint256 timestamp
    );
    event XMTPKeyRevoked(address indexed user, bytes32 installationId);
    event TEEAttestationVerified(address indexed user, bytes32 enclaveId);
    
    // ============ XMTP Key Functions ============
    
    /**
     * @notice Register an XMTP key bundle
     * @param identityPublicKey XMTP identity public key
     * @param installationPublicKey XMTP installation public key
     * @param installationId Unique installation identifier
     * @param keyBundleVersion Version of the key bundle format
     */
    function registerXMTPKey(
        bytes calldata identityPublicKey,
        bytes calldata installationPublicKey,
        bytes32 installationId,
        string calldata keyBundleVersion
    ) external nonReentrant {
        require(identityPublicKey.length > 0, "Invalid identity key");
        require(installationPublicKey.length > 0, "Invalid installation key");
        require(installationId != bytes32(0), "Invalid installation ID");
        
        // Check if installation ID is already used
        require(
            installationToAddress[installationId] == address(0) ||
            installationToAddress[installationId] == msg.sender,
            "Installation ID already registered"
        );
        
        xmtpKeys[msg.sender] = XMTPKeyBundle({
            identityPublicKey: identityPublicKey,
            installationPublicKey: installationPublicKey,
            installationId: installationId,
            keyBundleVersion: keyBundleVersion,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });
        
        installationToAddress[installationId] = msg.sender;
        
        emit XMTPKeyRegistered(
            msg.sender,
            installationId,
            keyBundleVersion,
            block.timestamp
        );
    }
    
    /**
     * @notice Register XMTP key with TEE attestation
     */
    function registerXMTPKeyWithAttestation(
        bytes calldata identityPublicKey,
        bytes calldata installationPublicKey,
        bytes32 installationId,
        string calldata keyBundleVersion,
        TEEAttestation calldata attestation
    ) external nonReentrant {
        // Verify attestation signature
        require(_verifyAttestation(attestation), "Invalid attestation");
        
        // Register key
        xmtpKeys[msg.sender] = XMTPKeyBundle({
            identityPublicKey: identityPublicKey,
            installationPublicKey: installationPublicKey,
            installationId: installationId,
            keyBundleVersion: keyBundleVersion,
            registeredAt: block.timestamp,
            lastUpdated: block.timestamp,
            isActive: true
        });
        
        installationToAddress[installationId] = msg.sender;
        
        // Store attestation
        keyAttestations[msg.sender] = attestation;
        keyAttestations[msg.sender].verified = true;
        
        emit XMTPKeyRegistered(
            msg.sender,
            installationId,
            keyBundleVersion,
            block.timestamp
        );
        emit TEEAttestationVerified(msg.sender, attestation.enclaveId);
    }
    
    /**
     * @notice Revoke XMTP key
     */
    function revokeXMTPKey() external {
        XMTPKeyBundle storage bundle = xmtpKeys[msg.sender];
        require(bundle.isActive, "No active XMTP key");
        
        bundle.isActive = false;
        bundle.lastUpdated = block.timestamp;
        
        // Clear installation mapping
        delete installationToAddress[bundle.installationId];
        
        emit XMTPKeyRevoked(msg.sender, bundle.installationId);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get XMTP key for address
     */
    function getXMTPKey(address user) external view returns (XMTPKeyBundle memory) {
        return xmtpKeys[user];
    }
    
    /**
     * @notice Check if address has active XMTP key
     */
    function hasActiveXMTPKey(address user) external view returns (bool) {
        return xmtpKeys[user].isActive;
    }
    
    /**
     * @notice Get address by XMTP installation ID
     */
    function getAddressByInstallation(bytes32 installationId) 
        external view returns (address) 
    {
        return installationToAddress[installationId];
    }
    
    /**
     * @notice Get all messaging capabilities for address
     */
    function getMessagingCapabilities(address user) external view returns (
        bool hasJejuKey,
        bool hasXMTPKey,
        bool hasTEEAttestation
    ) {
        hasJejuKey = keyBundles[user].isActive;
        hasXMTPKey = xmtpKeys[user].isActive;
        hasTEEAttestation = keyAttestations[user].verified;
    }
    
    /**
     * @notice Batch get XMTP keys
     */
    function getXMTPKeys(address[] calldata users) 
        external view returns (XMTPKeyBundle[] memory bundles)
    {
        bundles = new XMTPKeyBundle[](users.length);
        for (uint256 i = 0; i < users.length; i++) {
            bundles[i] = xmtpKeys[users[i]];
        }
    }
    
    // ============ Internal Functions ============
    
    function _verifyAttestation(TEEAttestation calldata attestation) 
        internal view returns (bool) 
    {
        // Verify attestation is recent (within 24 hours)
        if (block.timestamp - attestation.timestamp > 24 hours) {
            return false;
        }
        
        // Verify signature (simplified - in production use proper ECDSA)
        bytes32 hash = keccak256(abi.encode(
            attestation.enclaveId,
            attestation.measurementHash,
            attestation.timestamp
        ));
        
        // TODO: Implement proper signature verification
        return attestation.signature.length > 0;
    }
}
```

### 2. Update SDK MessagingModule

File: `packages/sdk/src/messaging/index.ts` (update)

```typescript
// Add XMTP key types
export interface XMTPKey {
  owner: Address;
  identityPublicKey: Hex;
  installationPublicKey: Hex;
  installationId: Hex;
  keyBundleVersion: string;
  registeredAt: bigint;
  lastUpdated: bigint;
  isActive: boolean;
}

export interface MessagingCapabilities {
  hasJejuKey: boolean;
  hasXMTPKey: boolean;
  hasTEEAttestation: boolean;
}

// Add to MessagingModule interface
export interface MessagingModule {
  // ... existing methods ...
  
  // XMTP Key Registry
  registerXMTPKey(params: RegisterXMTPKeyParams): Promise<Hex>;
  getXMTPKey(owner: Address): Promise<XMTPKey | null>;
  getMyXMTPKey(): Promise<XMTPKey | null>;
  revokeXMTPKey(): Promise<Hex>;
  
  // Capabilities
  getMessagingCapabilities(owner: Address): Promise<MessagingCapabilities>;
  
  // Lookup
  lookupByInstallation(installationId: Hex): Promise<Address | null>;
}

// Add implementation
export function createMessagingModule(
  wallet: JejuWallet,
  network: NetworkType,
): MessagingModule {
  // ... existing code ...
  
  return {
    // ... existing methods ...
    
    async registerXMTPKey(params) {
      const data = encodeFunctionData({
        abi: KEY_REGISTRY_ABI,
        functionName: 'registerXMTPKey',
        args: [
          params.identityPublicKey,
          params.installationPublicKey,
          params.installationId,
          params.keyBundleVersion ?? 'mls-1.0',
        ],
      });
      return wallet.sendTransaction({ to: keyRegistryAddress, data });
    },
    
    async getXMTPKey(owner) {
      const result = await wallet.publicClient.readContract({
        address: keyRegistryAddress,
        abi: KEY_REGISTRY_ABI,
        functionName: 'getXMTPKey',
        args: [owner],
      });
      
      if (!result.isActive) return null;
      
      return {
        owner,
        identityPublicKey: result.identityPublicKey,
        installationPublicKey: result.installationPublicKey,
        installationId: result.installationId,
        keyBundleVersion: result.keyBundleVersion,
        registeredAt: result.registeredAt,
        lastUpdated: result.lastUpdated,
        isActive: result.isActive,
      };
    },
    
    async getMyXMTPKey() {
      return this.getXMTPKey(wallet.address);
    },
    
    async revokeXMTPKey() {
      const data = encodeFunctionData({
        abi: KEY_REGISTRY_ABI,
        functionName: 'revokeXMTPKey',
        args: [],
      });
      return wallet.sendTransaction({ to: keyRegistryAddress, data });
    },
    
    async getMessagingCapabilities(owner) {
      const result = await wallet.publicClient.readContract({
        address: keyRegistryAddress,
        abi: KEY_REGISTRY_ABI,
        functionName: 'getMessagingCapabilities',
        args: [owner],
      });
      
      return {
        hasJejuKey: result.hasJejuKey,
        hasXMTPKey: result.hasXMTPKey,
        hasTEEAttestation: result.hasTEEAttestation,
      };
    },
    
    async lookupByInstallation(installationId) {
      const result = await wallet.publicClient.readContract({
        address: keyRegistryAddress,
        abi: KEY_REGISTRY_ABI,
        functionName: 'getAddressByInstallation',
        args: [installationId],
      });
      
      return result === zeroAddress ? null : result;
    },
  };
}
```

### 3. Contract Tests

File: `packages/messaging/contracts/test/KeyRegistry.t.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../KeyRegistry.sol";

contract KeyRegistryTest is Test {
    KeyRegistry registry;
    address user = address(0x1);
    
    function setUp() public {
        // Deploy mock identity registry
        MockIdentityRegistry mockRegistry = new MockIdentityRegistry();
        registry = new KeyRegistry(address(mockRegistry));
    }
    
    function testRegisterXMTPKey() public {
        vm.prank(user);
        registry.registerXMTPKey(
            hex"1234",
            hex"5678",
            bytes32(uint256(1)),
            "mls-1.0"
        );
        
        KeyRegistry.XMTPKeyBundle memory bundle = registry.getXMTPKey(user);
        assertTrue(bundle.isActive);
        assertEq(bundle.keyBundleVersion, "mls-1.0");
    }
    
    function testRevokeXMTPKey() public {
        vm.startPrank(user);
        registry.registerXMTPKey(
            hex"1234",
            hex"5678",
            bytes32(uint256(1)),
            "mls-1.0"
        );
        
        registry.revokeXMTPKey();
        vm.stopPrank();
        
        KeyRegistry.XMTPKeyBundle memory bundle = registry.getXMTPKey(user);
        assertFalse(bundle.isActive);
    }
    
    function testInstallationLookup() public {
        bytes32 installationId = bytes32(uint256(1));
        
        vm.prank(user);
        registry.registerXMTPKey(
            hex"1234",
            hex"5678",
            installationId,
            "mls-1.0"
        );
        
        assertEq(registry.getAddressByInstallation(installationId), user);
    }
    
    function testMessagingCapabilities() public {
        vm.prank(user);
        registry.registerXMTPKey(
            hex"1234",
            hex"5678",
            bytes32(uint256(1)),
            "mls-1.0"
        );
        
        (bool hasJeju, bool hasXMTP, bool hasTEE) = registry.getMessagingCapabilities(user);
        assertFalse(hasJeju);
        assertTrue(hasXMTP);
        assertFalse(hasTEE);
    }
}
```

## Acceptance Criteria

- [ ] XMTP keys can be registered on-chain
- [ ] XMTP keys with TEE attestation are supported
- [ ] Installation ID lookup works
- [ ] Messaging capabilities query returns all types
- [ ] SDK updated with XMTP key methods
- [ ] Contract tests pass
- [ ] Existing Jeju key functionality unchanged

## Output Files

1. `packages/messaging/contracts/KeyRegistry.sol` (update)
2. `packages/messaging/contracts/test/KeyRegistry.t.sol`
3. `packages/sdk/src/messaging/index.ts` (update)

## Commands

```bash
# Run contract tests
cd packages/messaging
forge test -vvv

# Deploy to localnet
cd ../contracts
forge script script/DeployKeyRegistry.s.sol --rpc-url http://localhost:9545 --broadcast

# Run SDK tests
cd ../sdk
bun test src/messaging/*.test.ts
```

