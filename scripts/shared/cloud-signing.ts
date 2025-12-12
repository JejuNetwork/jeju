/**
 * @deprecated This file is deprecated. Import from '@jeju-vendor/cloud' or 'vendor/cloud/src' instead.
 * 
 * This file remains for backwards compatibility but new code should import
 * from the vendor/cloud package directly.
 */

import { ethers } from 'ethers';

/**
 * @deprecated Use from '@jeju-vendor/cloud'
 * Cloud Reputation Signing Utilities
 * 
 * Creates properly signed feedback authorizations for CloudReputationProvider.
 * Uses EIP-191 personal sign for EOA wallets and ERC-1271 for smart contract wallets.
 */

export interface FeedbackAuthData {
  agentId: bigint;
  clientAddress: string;
  indexLimit: bigint;
  expiry: bigint;
  chainId: bigint;
  identityRegistry: string;
  signerAddress: string;
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
  signer: ethers.Signer,
  agentId: bigint,
  clientAddress: string,
  reputationRegistryAddress: string,
  chainId: bigint = 31337n
): Promise<string> {
  const signerAddress = await signer.getAddress();
  
  // Create auth data structure
  const authData: FeedbackAuthData = {
    agentId,
    clientAddress,
    indexLimit: BigInt(type(uint64).max), // Allow unlimited feedback
    expiry: BigInt(Math.floor(Date.now() / 1000) + 86400), // 24 hours
    chainId,
    identityRegistry: reputationRegistryAddress,
    signerAddress
  };
  
  // Encode struct for hashing
  const structHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
      [
        authData.agentId,
        authData.clientAddress,
        authData.indexLimit,
        authData.expiry,
        authData.chainId,
        authData.identityRegistry,
        authData.signerAddress
      ]
    )
  );
  
  // Sign the message
  const signature = await signer.signMessage(ethers.getBytes(structHash));
  
  // Parse signature components
  const sig = ethers.Signature.from(signature);
  
  // Encode as: struct_data + r + s + v
  const signedAuth = ethers.concat([
    ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
      [
        authData.agentId,
        authData.clientAddress,
        authData.indexLimit,
        authData.expiry,
        authData.chainId,
        authData.identityRegistry,
        authData.signerAddress
      ]
    ),
    sig.r,
    sig.s,
    ethers.toBeHex(sig.v, 1)
  ]);
  
  return signedAuth;
}

/**
 * Batch create signed authorizations for multiple agents
 */
export async function createBatchSignedAuths(
  signer: ethers.Signer,
  agentIds: bigint[],
  clientAddress: string,
  reputationRegistryAddress: string,
  chainId: bigint = 31337n
): Promise<Map<bigint, string>> {
  const auths = new Map<bigint, string>();
  
  for (const agentId of agentIds) {
    const auth = await createSignedFeedbackAuth(
      signer,
      agentId,
      clientAddress,
      reputationRegistryAddress,
      chainId
    );
    auths.set(agentId, auth);
  }
  
  return auths;
}

/**
 * Verify a signed feedback authorization (for testing)
 */
export function verifyFeedbackAuth(
  signedAuth: string,
  expectedSigner: string
): boolean {
  try {
    // Extract struct data (first 224 bytes)
    const structData = signedAuth.slice(0, 2 + 224 * 2); // 0x + hex chars
    
    // Extract signature (last 65 bytes = 130 hex chars)
    const r = '0x' + signedAuth.slice(-130, -66);
    const s = '0x' + signedAuth.slice(-66, -2);
    const v = parseInt(signedAuth.slice(-2), 16);
    
    // Decode struct
    const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
      ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
      structData
    );
    
    // Hash struct
    const structHash = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'address', 'uint64', 'uint256', 'uint256', 'address', 'address'],
        decoded
      )
    );
    
    // EIP-191 format
    const messageHash = ethers.hashMessage(ethers.getBytes(structHash));
    
    // Recover signer
    const recoveredSigner = ethers.recoverAddress(
      messageHash,
      { r, s, v }
    );
    
    return recoveredSigner.toLowerCase() === expectedSigner.toLowerCase();
  } catch (error) {
    return false;
  }
}

function type(t: string): { max: bigint } {
  if (t === 'uint64') {
    return { max: BigInt('18446744073709551615') };
  }
  throw new Error(`Unknown type: ${t}`);
}


