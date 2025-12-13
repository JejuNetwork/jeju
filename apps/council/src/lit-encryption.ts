/**
 * Lit Protocol Integration for CEO Decision Encryption
 *
 * Uses Lit Protocol's distributed key management and threshold cryptography
 * to encrypt CEO reasoning. Decryption requires:
 * 1. Proposal status is COMPLETED, or
 * 2. 30 days have passed since decision
 *
 * This ensures CEO reasoning remains private during deliberation
 * but becomes transparent after execution or timeout.
 */

import { keccak256, toUtf8Bytes } from 'ethers';

// Types for Lit Protocol
interface AccessControlCondition {
  contractAddress: string;
  standardContractType: string;
  chain: string;
  method: string;
  parameters: string[];
  returnValueTest: {
    comparator: string;
    value: string;
  };
}

interface LitEncryptedData {
  ciphertext: string;
  dataToEncryptHash: string;
  accessControlConditions: AccessControlCondition[];
  chain: string;
  encryptedAt: number;
}

interface LitDecryptionResult {
  decryptedString: string;
  verified: boolean;
}

interface DecisionData {
  proposalId: string;
  approved: boolean;
  reasoning: string;
  confidenceScore: number;
  alignmentScore: number;
  councilVotes: Array<{ role: string; vote: string; reasoning: string }>;
  researchSummary?: string;
  model: string;
  timestamp: number;
}

// Environment configuration
const LIT_NETWORK = process.env.LIT_NETWORK ?? 'cayenne';
const COUNCIL_ADDRESS = process.env.COUNCIL_ADDRESS ?? '0x0000000000000000000000000000000000000000';
const CHAIN_ID = process.env.CHAIN_ID ?? 'base-sepolia';
const DA_URL = process.env.DA_URL ?? 'http://localhost:3001';

// Fallback encryption key for environments without Lit
const FALLBACK_KEY = process.env.LIT_FALLBACK_KEY ?? process.env.TEE_ENCRYPTION_SECRET ?? 'council-local-dev';

let litClient: LitNodeClient | null = null;

// Lit SDK types (imported dynamically)
interface LitNodeClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ready: boolean;
}

interface LitSDK {
  LitNodeClient: new (config: { litNetwork: string; debug?: boolean }) => LitNodeClient;
  encryptString: (
    params: {
      accessControlConditions: AccessControlCondition[];
      chain: string;
      dataToEncrypt: string;
    },
    client: LitNodeClient
  ) => Promise<{ ciphertext: string; dataToEncryptHash: string }>;
  decryptString: (
    params: {
      ciphertext: string;
      dataToEncryptHash: string;
      accessControlConditions: AccessControlCondition[];
      chain: string;
    },
    client: LitNodeClient,
    authSig: AuthSig
  ) => Promise<string>;
}

interface AuthSig {
  sig: string;
  derivedVia: string;
  signedMessage: string;
  address: string;
}

let LitJsSdk: LitSDK | null = null;

/**
 * Initialize Lit Protocol client
 */
async function initLitClient(): Promise<LitNodeClient | null> {
  if (litClient?.ready) return litClient;

  try {
    // Dynamic import to avoid breaking when Lit is not installed
    const sdk = await import('@lit-protocol/lit-node-client');
    LitJsSdk = sdk as unknown as LitSDK;

    litClient = new LitJsSdk.LitNodeClient({
      litNetwork: LIT_NETWORK,
      debug: process.env.LIT_DEBUG === 'true',
    });

    await litClient.connect();
    console.log('[Lit] Connected to network:', LIT_NETWORK);
    return litClient;
  } catch (error) {
    console.warn('[Lit] Failed to initialize, using fallback encryption:', (error as Error).message);
    return null;
  }
}

/**
 * Create access control conditions for CEO decision
 * Decision can be decrypted if:
 * 1. Proposal status is COMPLETED (status = 7), or
 * 2. 30 days have passed since encryption
 */
function createAccessConditions(proposalId: string, encryptedAt: number): AccessControlCondition[] {
  const thirtyDaysLater = encryptedAt + 30 * 24 * 60 * 60;

  return [
    // Condition 1: Proposal is completed
    {
      contractAddress: COUNCIL_ADDRESS,
      standardContractType: 'Custom',
      chain: CHAIN_ID,
      method: 'proposals',
      parameters: [proposalId],
      returnValueTest: {
        comparator: '=',
        value: '7', // ProposalStatus.COMPLETED
      },
    },
    // OR
    // Condition 2: 30 days have passed
    {
      contractAddress: '',
      standardContractType: 'timestamp',
      chain: CHAIN_ID,
      method: 'eth_getBlockByNumber',
      parameters: ['latest'],
      returnValueTest: {
        comparator: '>=',
        value: thirtyDaysLater.toString(),
      },
    },
  ];
}

/**
 * Fallback encryption using AES-256-GCM (for dev/test without Lit)
 */
async function fallbackEncrypt(data: string): Promise<{ ciphertext: string; iv: string; tag: string }> {
  const crypto = await import('crypto');
  const key = Buffer.from(keccak256(toUtf8Bytes(FALLBACK_KEY)).slice(2, 66), 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return {
    ciphertext: encrypted,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
  };
}

/**
 * Fallback decryption
 */
async function fallbackDecrypt(ciphertext: string, iv: string, tag: string): Promise<string> {
  const crypto = await import('crypto');
  const key = Buffer.from(keccak256(toUtf8Bytes(FALLBACK_KEY)).slice(2, 66), 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(tag, 'hex'));
  let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

/**
 * Encrypt CEO decision data using Lit Protocol
 * Falls back to AES-256-GCM if Lit is not available
 */
export async function encryptDecision(decision: DecisionData): Promise<LitEncryptedData> {
  const dataToEncrypt = JSON.stringify(decision);
  const encryptedAt = Math.floor(Date.now() / 1000);

  const client = await initLitClient();

  if (client && LitJsSdk) {
    const accessControlConditions = createAccessConditions(decision.proposalId, encryptedAt);

    const { ciphertext, dataToEncryptHash } = await LitJsSdk.encryptString(
      {
        accessControlConditions,
        chain: CHAIN_ID,
        dataToEncrypt,
      },
      client
    );

    return {
      ciphertext,
      dataToEncryptHash,
      accessControlConditions,
      chain: CHAIN_ID,
      encryptedAt,
    };
  }

  // Fallback to local encryption
  const { ciphertext, iv, tag } = await fallbackEncrypt(dataToEncrypt);
  const dataToEncryptHash = keccak256(toUtf8Bytes(dataToEncrypt));

  return {
    ciphertext: JSON.stringify({ ciphertext, iv, tag }),
    dataToEncryptHash,
    accessControlConditions: createAccessConditions(decision.proposalId, encryptedAt),
    chain: CHAIN_ID,
    encryptedAt,
  };
}

/**
 * Decrypt CEO decision data
 * Requires valid auth signature if using Lit
 */
export async function decryptDecision(
  encryptedData: LitEncryptedData,
  authSig?: AuthSig
): Promise<LitDecryptionResult> {
  const client = await initLitClient();

  if (client && LitJsSdk && authSig) {
    const decryptedString = await LitJsSdk.decryptString(
      {
        ciphertext: encryptedData.ciphertext,
        dataToEncryptHash: encryptedData.dataToEncryptHash,
        accessControlConditions: encryptedData.accessControlConditions,
        chain: encryptedData.chain,
      },
      client,
      authSig
    );

    return {
      decryptedString,
      verified: true,
    };
  }

  // Fallback decryption
  try {
    const { ciphertext, iv, tag } = JSON.parse(encryptedData.ciphertext) as {
      ciphertext: string;
      iv: string;
      tag: string;
    };
    const decryptedString = await fallbackDecrypt(ciphertext, iv, tag);

    return {
      decryptedString,
      verified: false, // Fallback doesn't verify access conditions
    };
  } catch {
    throw new Error('Failed to decrypt: invalid ciphertext format');
  }
}

/**
 * Parse decrypted decision data
 */
export function parseDecisionData(decryptedString: string): DecisionData {
  return JSON.parse(decryptedString) as DecisionData;
}

/**
 * Backup encrypted decision to DA layer
 */
export async function backupToDA(
  proposalId: string,
  encryptedData: LitEncryptedData
): Promise<{ hash: string; success: boolean }> {
  try {
    const response = await fetch(`${DA_URL}/api/store`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'ceo_decision',
        proposalId,
        encryptedData,
        timestamp: Date.now(),
      }),
    });

    if (!response.ok) {
      console.error('[DA] Backup failed:', response.status);
      return { hash: '', success: false };
    }

    const result = (await response.json()) as { hash: string };
    console.log('[DA] Decision backed up:', result.hash);
    return { hash: result.hash, success: true };
  } catch (error) {
    console.error('[DA] Backup error:', (error as Error).message);
    return { hash: '', success: false };
  }
}

/**
 * Retrieve encrypted decision from DA layer
 */
export async function retrieveFromDA(proposalId: string): Promise<LitEncryptedData | null> {
  try {
    const response = await fetch(`${DA_URL}/api/retrieve?type=ceo_decision&proposalId=${proposalId}`);

    if (!response.ok) {
      return null;
    }

    const result = (await response.json()) as { encryptedData: LitEncryptedData };
    return result.encryptedData;
  } catch {
    return null;
  }
}

/**
 * Check if decision can be decrypted (access conditions met)
 */
export async function canDecrypt(encryptedData: LitEncryptedData): Promise<boolean> {
  // For Lit Protocol, we'd check conditions on-chain
  // For fallback, we check the timestamp condition
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAfter = encryptedData.encryptedAt + 30 * 24 * 60 * 60;

  if (now >= thirtyDaysAfter) {
    return true;
  }

  // Would need to check on-chain proposal status
  // For now, return false if we can't verify
  return false;
}

/**
 * Get Lit Protocol status
 */
export function getLitStatus(): { network: string; connected: boolean; fallbackMode: boolean } {
  return {
    network: LIT_NETWORK,
    connected: litClient?.ready ?? false,
    fallbackMode: !litClient?.ready,
  };
}

/**
 * Disconnect from Lit network
 */
export async function disconnectLit(): Promise<void> {
  if (litClient) {
    await litClient.disconnect();
    litClient = null;
  }
}

export type { LitEncryptedData, DecisionData, LitDecryptionResult, AuthSig };

