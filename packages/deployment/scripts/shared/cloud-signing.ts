/**
 * Cloud Reputation Signing Utilities
 *
 * Creates signed feedback authorizations for CloudReputationProvider.
 * Uses EIP-191 personal sign for EOA wallets and ERC-1271 for smart contract wallets.
 */

import {
  type Address,
  concat,
  decodeAbiParameters,
  encodeAbiParameters,
  type Hex,
  hashMessage,
  keccak256,
  type PrivateKeyAccount,
  recoverAddress,
  toHex,
} from 'viem'

/**
 * Creates properly signed feedback authorizations for CloudReputationProvider.
 * Uses EIP-191 personal sign for EOA wallets and ERC-1271 for smart contract wallets.
 */

export interface FeedbackAuthData {
  agentId: bigint
  clientAddress: string
  indexLimit: bigint
  expiry: bigint
  chainId: bigint
  identityRegistry: string
  signerAddress: string
}

/**
 * Create and sign feedback authorization
 *
 * This creates the authorization that CloudReputationProvider needs to
 * submit feedback to ReputationRegistry on behalf of the cloud agent.
 *
 * @param signer Cloud agent's signer (holds cloud agent's private key)
 * @param agentId Target agent receiving feedback
 * @param clientAddress Cloud service address (will be giving feedback)
 * @param reputationRegistryAddress ReputationRegistry contract address
 * @param chainId Network chain ID
 * @returns Signed authorization bytes for setReputation()
 */
export async function createSignedFeedbackAuth(
  account: PrivateKeyAccount,
  agentId: bigint,
  clientAddress: string,
  reputationRegistryAddress: string,
  chainId: bigint = 31337n,
): Promise<Hex> {
  const signerAddress = account.address

  // Create auth data structure
  const authData: FeedbackAuthData = {
    agentId,
    clientAddress,
    indexLimit: type('uint64').max, // Allow unlimited feedback
    expiry: BigInt(Math.floor(Date.now() / 1000) + 86400), // 24 hours
    chainId,
    identityRegistry: reputationRegistryAddress,
    signerAddress,
  }

  // Encode struct for hashing
  const encoded = encodeAbiParameters(
    [
      { type: 'uint256' },
      { type: 'address' },
      { type: 'uint64' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'address' },
    ],
    [
      authData.agentId,
      authData.clientAddress as Address,
      authData.indexLimit,
      authData.expiry,
      authData.chainId,
      authData.identityRegistry as Address,
      authData.signerAddress as Address,
    ],
  )
  const structHash = keccak256(encoded)

  // Sign the message using the account's signMessage method
  const signature = await account.signMessage({ message: { raw: structHash } })

  // Parse signature components (r, s, v from signature)
  const r = `0x${signature.slice(2, 66)}` as Hex
  const s = `0x${signature.slice(66, 130)}` as Hex
  const v = BigInt(`0x${signature.slice(130, 132)}`)

  // Encode as: struct_data + r + s + v
  const signedAuth = concat([encoded, r, s, toHex(v, { size: 1 })]) as Hex

  return signedAuth
}

/**
 * Batch create signed authorizations for multiple agents
 */
export async function createBatchSignedAuths(
  account: PrivateKeyAccount,
  agentIds: bigint[],
  clientAddress: Address,
  reputationRegistryAddress: Address,
  chainId: bigint = 31337n,
): Promise<Map<bigint, Hex>> {
  const auths = new Map<bigint, Hex>()

  for (const agentId of agentIds) {
    const auth = await createSignedFeedbackAuth(
      account,
      agentId,
      clientAddress,
      reputationRegistryAddress,
      chainId,
    )
    auths.set(agentId, auth)
  }

  return auths
}

/**
 * Verify a signed feedback authorization (for testing)
 */
export async function verifyFeedbackAuth(
  signedAuth: Hex,
  expectedSigner: Address,
): Promise<boolean> {
  try {
    // Extract struct data (first 224 bytes = 448 hex chars)
    const structData = signedAuth.slice(0, 2 + 448) as Hex

    // Extract signature (last 65 bytes = 130 hex chars)
    const r = `0x${signedAuth.slice(-130, -66)}` as Hex
    const s = `0x${signedAuth.slice(-66, -2)}` as Hex
    const v = BigInt(`0x${signedAuth.slice(-2)}`)

    // Decode struct
    const decoded = decodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint64' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
      ],
      structData,
    )

    // Hash struct
    const encoded = encodeAbiParameters(
      [
        { type: 'uint256' },
        { type: 'address' },
        { type: 'uint64' },
        { type: 'uint256' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'address' },
      ],
      decoded,
    )
    const structHash = keccak256(encoded)

    // EIP-191 format
    const messageHash = hashMessage({ raw: structHash })

    // Recover signer
    const recoveredSigner = await recoverAddress({
      hash: messageHash,
      signature: (r + s.slice(2) + toHex(v).slice(2)) as Hex,
    })

    return recoveredSigner.toLowerCase() === expectedSigner.toLowerCase()
  } catch {
    return false
  }
}

function type(t: string): { max: bigint } {
  if (t === 'uint64') {
    return { max: BigInt('18446744073709551615') }
  }
  throw new Error(`Unknown type: ${t}`)
}
