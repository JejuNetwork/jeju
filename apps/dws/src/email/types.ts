/**
 * Email Service Types
 * 
 * Type definitions for the decentralized email system
 */

import type { Address, Hex } from 'viem';

// ============ Email Address & Identity ============

export interface JejuEmailAddress {
  localPart: string;          // e.g., "alice"
  domain: string;             // e.g., "jeju.mail"
  full: string;               // e.g., "alice@jeju.mail"
  jnsNode?: Hex;              // JNS name hash
  owner?: Address;            // Wallet address
}

export interface EmailIdentity {
  address: JejuEmailAddress;
  publicKey: Hex;             // Encryption public key (from MPC or wallet)
  preferredRelays: string[];  // Preferred relay endpoints
  tier: EmailTier;
  isVerified: boolean;
}

export type EmailTier = 'free' | 'staked' | 'premium';

// ============ Email Content ============

export interface EmailEnvelope {
  id: Hex;                    // Message ID (keccak256)
  from: JejuEmailAddress;
  to: JejuEmailAddress[];
  cc?: JejuEmailAddress[];
  bcc?: JejuEmailAddress[];
  replyTo?: JejuEmailAddress;
  timestamp: number;
  
  // Encrypted payload
  encryptedContent: EncryptedEmailContent;
  
  // Routing metadata (cleartext)
  isExternal: boolean;        // External recipient (Web2)
  priority: EmailPriority;
  
  // Integrity
  signature: Hex;             // Sender's signature
  proofOfWork?: Hex;          // PoW for spam prevention (free tier)
}

export interface EncryptedEmailContent {
  ciphertext: Hex;            // AES-256-GCM encrypted
  nonce: Hex;                 // GCM nonce
  ephemeralKey: Hex;          // Sender's ephemeral ECDH key
  recipients: RecipientKeyCapsule[];
}

export interface RecipientKeyCapsule {
  address: string;            // Recipient email address
  encryptedKey: Hex;          // Symmetric key encrypted to recipient pubkey
}

export interface EmailContent {
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  headers: Record<string, string>;
  attachments: EmailAttachment[];
  inReplyTo?: Hex;            // Parent message ID
  threadId?: Hex;             // Thread grouping
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  cid: string;                // IPFS CID for encrypted content
  checksum: Hex;              // SHA-256 of plaintext
}

export type EmailPriority = 'low' | 'normal' | 'high';

// ============ Mailbox Storage ============

export interface Mailbox {
  owner: Address;
  encryptedIndexCid: string;  // IPFS CID of encrypted mailbox index
  quotaUsedBytes: bigint;
  quotaLimitBytes: bigint;
  lastUpdated: number;
  folders: string[];
}

export interface MailboxIndex {
  inbox: EmailReference[];
  sent: EmailReference[];
  drafts: EmailReference[];
  trash: EmailReference[];
  spam: EmailReference[];
  archive: EmailReference[];
  folders: Record<string, EmailReference[]>;
  rules: FilterRule[];
}

export interface EmailReference {
  messageId: Hex;
  contentCid: string;         // IPFS CID of encrypted email
  from: string;               // Email address
  to: string[];               // Email addresses
  subject: string;            // Encrypted, decrypted client-side
  preview: string;            // First ~100 chars of body (encrypted)
  timestamp: number;
  size: number;
  flags: EmailFlags;
  labels: string[];
  threadId?: Hex;
}

export interface EmailFlags {
  read: boolean;
  starred: boolean;
  important: boolean;
  answered: boolean;
  forwarded: boolean;
  deleted: boolean;
  spam: boolean;
}

export interface FilterRule {
  id: string;
  name: string;
  conditions: FilterCondition[];
  actions: FilterAction[];
  enabled: boolean;
}

export interface FilterCondition {
  field: 'from' | 'to' | 'subject' | 'body' | 'header';
  operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' | 'regex';
  value: string;
}

export interface FilterAction {
  type: 'move' | 'label' | 'star' | 'markRead' | 'forward' | 'delete';
  value?: string;
}

// ============ Content Screening ============

export interface ScreeningResult {
  messageId: Hex;
  passed: boolean;
  scores: ContentScores;
  flags: ContentFlag[];
  action: ScreeningAction;
  reviewRequired: boolean;
  timestamp: number;
}

export interface ContentScores {
  spam: number;               // 0-1, spam probability
  scam: number;               // 0-1, scam/phishing probability
  csam: number;               // 0-1, CSAM probability
  malware: number;            // 0-1, malware probability
  harassment: number;         // 0-1, harassment probability
}

export interface ContentFlag {
  type: ContentFlagType;
  confidence: number;
  details: string;
  evidenceHash?: Hex;
}

export type ContentFlagType = 
  | 'spam'
  | 'phishing'
  | 'scam'
  | 'malware'
  | 'csam'
  | 'illegal'
  | 'harassment'
  | 'adult';

export type ScreeningAction = 
  | 'allow'
  | 'quarantine'
  | 'reject'
  | 'review'
  | 'block_and_ban';

export interface AccountReview {
  account: Address;
  emailAddress: string;
  reviewReason: string;
  contentAnalysis: AccountContentAnalysis;
  recommendation: 'allow' | 'warn' | 'suspend' | 'ban';
  confidence: number;
  timestamp: number;
}

export interface AccountContentAnalysis {
  totalEmails: number;
  flaggedEmails: number;
  flaggedPercentage: number;
  violations: ViolationSummary[];
  overallAssessment: string;
  llmReasoning: string;
}

export interface ViolationSummary {
  type: ContentFlagType;
  count: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
}

// ============ Provider & Relay ============

export interface EmailRelayNode {
  operator: Address;
  endpoint: string;
  region: string;
  status: RelayStatus;
  teeAttestation?: Hex;
  metrics: RelayMetrics;
}

export type RelayStatus = 'active' | 'suspended' | 'banned' | 'maintenance';

export interface RelayMetrics {
  emailsProcessed: number;
  spamBlocked: number;
  deliveryFailures: number;
  averageLatencyMs: number;
  uptime: number;             // Basis points (10000 = 100%)
  lastReportTimestamp: number;
}

export interface ExternalProvider {
  operator: Address;
  domain: string;
  endpoint: string;
  status: RelayStatus;
  stakedAmount: bigint;
}

// ============ IMAP/SMTP Protocol ============

export interface IMAPSession {
  id: string;
  user: Address;
  email: string;
  authenticated: boolean;
  selectedMailbox?: string;
  capabilities: string[];
  createdAt: number;
  lastActivityAt: number;
}

export interface SMTPSession {
  id: string;
  clientIp: string;
  authenticated: boolean;
  user?: Address;
  email?: string;
  mailFrom?: string;
  rcptTo: string[];
  dataBuffer: string;
  state: SMTPState;
}

export type SMTPState = 
  | 'connected'
  | 'greeted'
  | 'mail_from'
  | 'rcpt_to'
  | 'data'
  | 'quit';

// ============ Web2 Bridge ============

export interface InboundEmailEvent {
  messageId: string;
  s3Bucket: string;
  s3Key: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: number;
  spamVerdict?: string;
  virusVerdict?: string;
}

export interface OutboundEmailRequest {
  envelope: EmailEnvelope;
  decryptedContent: EmailContent;
  dkimSignature: string;
  sesMessageId?: string;
}

// ============ Rate Limiting ============

export interface RateLimitState {
  emailsSent: number;
  emailsReceived: number;
  bytesUsed: number;
  resetAt: number;
}

export interface RateLimitConfig {
  emailsPerDay: number;
  emailsPerHour: number;
  maxRecipients: number;
  maxAttachmentSizeMb: number;
  maxEmailSizeMb: number;
}

// ============ Configuration ============

export interface EmailServiceConfig {
  // Network
  rpcUrl: string;
  chainId: number;
  
  // Contracts
  emailRegistryAddress: Address;
  emailStakingAddress: Address;
  jnsRegistryAddress: Address;
  moderationMarketplaceAddress: Address;
  banManagerAddress: Address;
  
  // Infrastructure
  dwsEndpoint: string;
  storageBackend: 'ipfs' | 'arweave' | 'multi';
  
  // Email
  emailDomain: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  
  // Bridge
  sesRegion: string;
  inboundBucket: string;
  
  // TEE
  teeEndpoint?: string;
  teeEnabled: boolean;
  
  // Moderation
  contentScreeningEnabled: boolean;
  aiModelEndpoint: string;
  csamHashListUrl?: string;
  
  // Rate limiting
  rateLimits: Record<EmailTier, RateLimitConfig>;
}

// ============ API Types ============

export interface SendEmailRequest {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  attachments?: {
    filename: string;
    content: string;  // Base64
    mimeType: string;
  }[];
  priority?: EmailPriority;
  replyTo?: string;
  inReplyTo?: Hex;
}

export interface SendEmailResponse {
  success: boolean;
  messageId: Hex;
  queued: boolean;
  deliveryStatus?: Record<string, DeliveryStatus>;
  error?: string;
}

export type DeliveryStatus = 
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'bounced'
  | 'rejected'
  | 'failed';

export interface GetMailboxResponse {
  mailbox: Mailbox;
  index: MailboxIndex;
  unreadCount: number;
}

export interface GetEmailResponse {
  envelope: EmailEnvelope;
  content: EmailContent;
  flags: EmailFlags;
}

export interface SearchEmailsRequest {
  query: string;
  folder?: string;
  from?: string;
  to?: string;
  dateFrom?: number;
  dateTo?: number;
  hasAttachment?: boolean;
  limit?: number;
  offset?: number;
}

export interface SearchEmailsResponse {
  results: EmailReference[];
  total: number;
  hasMore: boolean;
}
