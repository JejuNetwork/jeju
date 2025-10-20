/**
 * Event Signature Constants
 * 
 * Pre-computed keccak256 hashes of event signatures for efficient matching.
 * Add new events here as needed for decoding.
 */

// ============ Token Standards (ERC20/721/1155) ============

/**
 * Transfer(address indexed from, address indexed to, uint256 value)
 * Used by: ERC20, ERC721
 */
export const TRANSFER_EVENT = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

/**
 * TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)
 * Used by: ERC1155
 */
export const ERC1155_TRANSFER_SINGLE = '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62'

/**
 * TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)
 * Used by: ERC1155
 */
export const ERC1155_TRANSFER_BATCH = '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb'

/**
 * Approval(address indexed owner, address indexed spender, uint256 value)
 * Used by: ERC20
 */
export const ERC20_APPROVAL = '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925'

/**
 * ApprovalForAll(address indexed owner, address indexed operator, bool approved)  
 * Used by: ERC721, ERC1155
 */
export const APPROVAL_FOR_ALL = '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31'

// ============ ERC-8004 Agent Registry Events ============

/**
 * Registered(uint256 indexed agentId, string tokenURI, address indexed owner)
 * Emitted by: IdentityRegistry
 * When: New AI agent is registered (including game servers)
 */
export const AGENT_REGISTERED = '0x5ac27cb49ca3a3a81894ba2a19043e9db7e6f2e2a64cc4fef9f7f45772c0f2b3'

/**
 * GameServerRegistered - Custom event for tracking game server registrations
 * Note: This is tracked via metadata on the AGENT_REGISTERED event
 */

/**
 * MetadataSet(uint256 indexed agentId, string indexed indexedKey, string key, bytes value)
 * Emitted by: IdentityRegistry  
 * When: Agent metadata is updated
 */
export const METADATA_SET = '0xbe801459d6f80018e95b17fe1dd4130fcde9f7f880559fcc798346f8eec9b981'

/**
 * NewFeedback(uint256 indexed agentId, address indexed clientAddress, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash)
 * Emitted by: ReputationRegistry
 * When: Client gives feedback to an agent
 */
export const NEW_FEEDBACK = '0x48b5596c17b92ee0f19bcc7972bfc9ae48e9562562ba4e539e7407dd4f44765a'

/**
 * ValidationRequest(address indexed validatorAddress, uint256 indexed agentId, string requestUri, bytes32 requestHash)
 * Emitted by: ValidationRegistry
 * When: Agent requests validation
 */
export const VALIDATION_REQUEST = '0x530436c3634a98e1e626b0898be2f1e9980cc1bd2a78c07a0aba52d0a48a5059'

// ============ Paymaster Events ============

/**
 * TransactionSponsored(address indexed user, address indexed app, uint256 gasCost, uint256 elizaOSCharged)
 * Emitted by: LiquidityPaymaster
 * When: Transaction is sponsored
 */
export const TRANSACTION_SPONSORED = '0xcde7e91a718e2439d8ff2a679ad52713e82a37b72622fb530c8c41039fdd5bf0'

/**
 * PricesUpdated(uint256 ethPrice, uint256 elizaPrice, uint256 timestamp)
 * Emitted by: ManualPriceOracle
 * When: Price oracle is updated
 */
export const PRICES_UPDATED = '0xa6b830b74e52d7d1140e76252f225dc7bed28782519845600bbd3182341dc115'

// ============ ERC-4337 Account Abstraction Events ============

/**
 * UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)
 * Emitted by: EntryPoint
 * When: UserOperation is executed
 */
export const USER_OPERATION_EVENT = '0x49628fd1471006c1482da88028e9ce4dbb080b815c9b0344d39e5a8e6ec1419f'

/**
 * AccountDeployed(bytes32 indexed userOpHash, address indexed sender, address factory, address paymaster)
 * Emitted by: EntryPoint
 * When: Smart account is deployed
 */
export const ACCOUNT_DEPLOYED = '0xd51a9c61267aa6196961883ecf5ff2da6619c37dac0fa92122513fb32c032d2d'

// ============ Helper Function ============

/**
 * Calculate event signature hash
 * @param signature Full event signature (e.g., "Transfer(address,address,uint256)")
 * @returns keccak256 hash as hex string
 */
export function calculateEventSig(signature: string): string {
    const crypto = require('crypto')
    return '0x' + crypto.createHash('sha256').update(signature).digest('hex')
}

