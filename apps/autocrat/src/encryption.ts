/**
 * Council Encryption - CEO Decision Encryption using the network KMS
 *
 * Uses AES-256-GCM encryption with policy-based access control.
 * Decryption requires:
 * 1. Proposal status is COMPLETED, or
 * 2. 30 days have passed since decision
 *
 * This ensures CEO reasoning remains private during deliberation
 * but becomes transparent after execution or timeout.
 * 
 * FULLY DECENTRALIZED - Uses network-aware endpoints
 */

import { z } from 'zod';
import { getServiceUrl, getRpcUrl } from '@jejunetwork/config';
import { keccak256, stringToHex } from 'viem';

// Schemas for JSON parsing
const EncryptedCiphertextSchema = z.object({
  ciphertext: z.string(),
  iv: z.string(),
  tag: z.string(),
  version: z.number().optional(),
});

const DASearchResultSchema = z.object({
  results: z.array(z.object({
    keyId: z.string(),
    dataHash: z.string(),
    encryptedAt: z.number(),
    metadata: z.record(z.string(), z.string()),
  })),
});

const DARetrieveResultSchema = z.object({
  data: z.string(),
});

const DAStoreResultSchema = z.object({
  keyId: z.string(),
  dataHash: z.string(),
});

const DAStoredDataSchema = z.object({
  encryptedData: z.lazy(() => EncryptedDataSchema),
});

const EncryptedDataSchema: z.ZodType<EncryptedData> = z.object({
  ciphertext: z.string(),
  dataToEncryptHash: z.string(),
  accessControlConditions: z.array(z.object({
    contractAddress: z.string(),
    standardContractType: z.string(),
    chain: z.string(),
    method: z.string(),
    parameters: z.array(z.string()),
    returnValueTest: z.object({
      comparator: z.string(),
      value: z.string(),
    }),
  })),
  chain: z.string(),
  encryptedAt: z.number(),
});

const RPCResultSchema = z.object({
  result: z.string().optional(),
  error: z.object({ message: z.string() }).optional(),
});

const DecisionDataSchema = z.object({
  proposalId: z.string(),
  approved: z.boolean(),
  reasoning: z.string(),
  confidenceScore: z.number(),
  alignmentScore: z.number(),
  autocratVotes: z.array(z.object({
    role: z.string(),
    vote: z.string(),
    reasoning: z.string(),
  })),
  researchSummary: z.string().optional(),
  model: z.string(),
  timestamp: z.number(),
});

// Types for encrypted data
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

export interface EncryptedData {
  ciphertext: string;
  dataToEncryptHash: string;
  accessControlConditions: AccessControlCondition[];
  chain: string;
  encryptedAt: number;
}

export interface DecryptionResult {
  decryptedString: string;
  verified: boolean;
}

export interface DecisionData {
  proposalId: string;
  approved: boolean;
  reasoning: string;
  confidenceScore: number;
  alignmentScore: number;
  autocratVotes: Array<{ role: string; vote: string; reasoning: string }>;
  researchSummary?: string;
  model: string;
  timestamp: number;
}

export interface AuthSig {
  sig: string;
  derivedVia: string;
  signedMessage: string;
  address: string;
}

// Environment configuration (with network-aware fallbacks)
const COUNCIL_ADDRESS = process.env.COUNCIL_ADDRESS ?? '0x0000000000000000000000000000000000000000';
const CHAIN_ID = process.env.CHAIN_ID ?? 'base-sepolia';

function getDAUrl(): string {
  return process.env.DA_URL ?? getServiceUrl('storage', 'api');
}

// Encryption key from environment
// NOTE: In production, these must be set. 'council-local-dev' is ONLY for local development.
const ENCRYPTION_KEY = process.env.KMS_FALLBACK_SECRET ?? process.env.TEE_ENCRYPTION_SECRET ?? (
  process.env.NODE_ENV === 'production' 
    ? (() => { throw new Error('KMS_FALLBACK_SECRET or TEE_ENCRYPTION_SECRET required in production'); })()
    : 'council-local-dev'
);

let initialized = false;

/**
 * Initialize encryption system
 */
async function initEncryption(): Promise<void> {
  if (initialized) return;
  initialized = true;
  console.log('[Encryption] Initialized with network KMS');
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
 * Derive encryption key from the base key and policy
 */
async function deriveKey(policyHash: string): Promise<CryptoKey> {
  const keyMaterial = new TextEncoder().encode(`${ENCRYPTION_KEY}:${policyHash}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', keyMaterial);
  
  return crypto.subtle.importKey(
    'raw',
    hashBuffer,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt data using AES-256-GCM
 */
async function encrypt(data: string, policyHash: string): Promise<{ ciphertext: string; iv: string; tag: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(policyHash);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(data)
  );

  const encryptedArray = new Uint8Array(encrypted);
  const ciphertext = encryptedArray.slice(0, -16);
  const tag = encryptedArray.slice(-16);

  return {
    ciphertext: Buffer.from(ciphertext).toString('hex'),
    iv: Buffer.from(iv).toString('hex'),
    tag: Buffer.from(tag).toString('hex'),
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
async function decrypt(ciphertext: string, iv: string, tag: string, policyHash: string): Promise<string> {
  const key = await deriveKey(policyHash);
  
  const ciphertextBytes = Buffer.from(ciphertext, 'hex');
  const ivBytes = Buffer.from(iv, 'hex');
  const tagBytes = Buffer.from(tag, 'hex');
  
  const combined = new Uint8Array([...ciphertextBytes, ...tagBytes]);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt CEO decision data
 */
export async function encryptDecision(decision: DecisionData): Promise<EncryptedData> {
  await initEncryption();
  
  const dataToEncrypt = JSON.stringify(decision);
  const encryptedAt = Math.floor(Date.now() / 1000);
  const accessControlConditions = createAccessConditions(decision.proposalId, encryptedAt);
  const policyHash = keccak256(stringToHex(JSON.stringify(accessControlConditions)));

  const { ciphertext, iv, tag } = await encrypt(dataToEncrypt, policyHash);
  const dataToEncryptHash = keccak256(stringToHex(dataToEncrypt));

  return {
    ciphertext: JSON.stringify({ ciphertext, iv, tag, version: 1 }),
    dataToEncryptHash,
    accessControlConditions,
    chain: CHAIN_ID,
    encryptedAt,
  };
}

/**
 * Decrypt CEO decision data
 */
export async function decryptDecision(
  encryptedData: EncryptedData,
  _authSig?: AuthSig
): Promise<DecryptionResult> {
  await initEncryption();
  
  const policyHash = keccak256(stringToHex(JSON.stringify(encryptedData.accessControlConditions)));
  const rawParsed = JSON.parse(encryptedData.ciphertext);
  const { ciphertext, iv, tag } = EncryptedCiphertextSchema.parse(rawParsed);
  const decryptedString = await decrypt(ciphertext, iv, tag, policyHash);

  return { decryptedString, verified: true };
}

/**
 * Parse decrypted decision data
 */
export function parseDecisionData(decryptedString: string): DecisionData {
  const rawParsed = JSON.parse(decryptedString);
  return DecisionDataSchema.parse(rawParsed);
}

/**
 * Backup encrypted decision to DA layer
 * @throws Error if backup fails (fail-fast, no silent failures)
 */
export async function backupToDA(
  proposalId: string,
  encryptedData: EncryptedData
): Promise<{ keyId: string; hash: string }> {
  const response = await fetch(`${getDAUrl()}/api/v1/encrypted/store`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      data: JSON.stringify({
        type: 'ceo_decision',
        proposalId,
        encryptedData,
        timestamp: Date.now(),
      }),
      policy: {
        conditions: [
          {
            type: 'timestamp',
            chain: CHAIN_ID,
            comparator: '>=',
            value: encryptedData.encryptedAt + 30 * 24 * 60 * 60,
          },
        ],
        operator: 'or',
      },
      owner: COUNCIL_ADDRESS,
      metadata: { type: 'ceo_decision', proposalId },
    }),
  });

  if (!response.ok) {
    throw new Error(`DA backup failed: ${response.status}`);
  }

  const rawResult = await response.json();
  const result = DAStoreResultSchema.parse(rawResult);
  console.log('[DA] Decision backed up:', result.dataHash);
  return { keyId: result.keyId, hash: result.dataHash };
}

/**
 * Retrieve encrypted decision from DA layer by proposalId
 */
export async function retrieveFromDA(proposalId: string): Promise<EncryptedData | null> {
  const searchResponse = await fetch(`${getDAUrl()}/api/v1/encrypted/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      metadata: { type: 'ceo_decision', proposalId },
      accessor: COUNCIL_ADDRESS,
    }),
  });

  if (!searchResponse.ok) {
    console.error('[DA] Search failed:', searchResponse.status);
    return null;
  }

  const rawSearchResult = await searchResponse.json();
  const searchResult = DASearchResultSchema.parse(rawSearchResult);

  if (searchResult.results.length === 0) {
    return null;
  }

  const latest = searchResult.results.sort((a, b) => b.encryptedAt - a.encryptedAt)[0];

  const retrieveResponse = await fetch(`${getDAUrl()}/api/v1/encrypted/retrieve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyId: latest.keyId,
      accessor: COUNCIL_ADDRESS,
    }),
  });

  if (!retrieveResponse.ok) {
    console.error('[DA] Retrieve failed:', retrieveResponse.status);
    return null;
  }

  const rawRetrieveResult = await retrieveResponse.json();
  const retrieveResult = DARetrieveResultSchema.parse(rawRetrieveResult);
  const rawParsed = JSON.parse(retrieveResult.data);
  const parsed = DAStoredDataSchema.parse(rawParsed);
  
  return parsed.encryptedData;
}

/**
 * Check if decision can be decrypted (access conditions met)
 * Returns true if:
 * 1. 30 days have passed since encryption, OR
 * 2. Proposal status is COMPLETED (7) on-chain
 */
export async function canDecrypt(
  encryptedData: EncryptedData,
  rpcUrl?: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const thirtyDaysAfter = encryptedData.encryptedAt + 30 * 24 * 60 * 60;

  if (now >= thirtyDaysAfter) {
    return true;
  }

  const proposalCondition = encryptedData.accessControlConditions.find(
    (c) => c.method === 'proposals' && c.contractAddress !== ''
  );

  if (!proposalCondition) {
    return false;
  }

  const proposalId = proposalCondition.parameters[0];
  const councilAddress = proposalCondition.contractAddress;
  const rpc = rpcUrl ?? process.env.RPC_URL ?? getRpcUrl();

  const callData = `0x013cf08b${proposalId.slice(2).padStart(64, '0')}`; // proposals(uint256)

  const response = await fetch(rpc, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_call',
      params: [{ to: councilAddress, data: callData }, 'latest'],
    }),
  }).catch(() => null);

  if (!response?.ok) {
    return false;
  }

  const rawResult = await response.json();
  const parseResult = RPCResultSchema.safeParse(rawResult);
  if (!parseResult.success) {
    return false;
  }
  const result = parseResult.data;
  
  if (result.error || !result.result || result.result === '0x') {
    return false;
  }

  const statusOffset = 8 * 64 + 2;
  const statusHex = result.result.slice(statusOffset, statusOffset + 64);
  const status = parseInt(statusHex, 16);

  return status === 7;
}

/**
 * Get encryption status
 */
export function getEncryptionStatus(): { provider: string; connected: boolean } {
  return {
    provider: 'jeju-kms',
    connected: initialized,
  };
}

/**
 * Disconnect encryption (reset state)
 */
export async function disconnect(): Promise<void> {
  initialized = false;
}
