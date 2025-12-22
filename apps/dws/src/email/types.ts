import type { Address, Hex } from 'viem';

export interface JejuEmailAddress {
  localPart: string;
  domain: string;
  full: string;
  jnsNode?: Hex;
  owner?: Address;
}

export interface EmailIdentity {
  address: JejuEmailAddress;
  publicKey: Hex;
  preferredRelays: string[];
  tier: EmailTier;
  isVerified: boolean;
}

export type EmailTier = 'free' | 'staked' | 'premium';

export interface EmailEnvelope {
  id: Hex;
  from: JejuEmailAddress;
  to: JejuEmailAddress[];
  cc?: JejuEmailAddress[];
  bcc?: JejuEmailAddress[];
  replyTo?: JejuEmailAddress;
  timestamp: number;
  encryptedContent: EncryptedEmailContent;
  isExternal: boolean;
  priority: EmailPriority;
  signature: Hex;
  proofOfWork?: Hex;
}

export interface EncryptedEmailContent {
  ciphertext: Hex;
  nonce: Hex;
  ephemeralKey: Hex;
  recipients: RecipientKeyCapsule[];
}

export interface RecipientKeyCapsule {
  address: string;
  encryptedKey: Hex;
}

export interface EmailContent {
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  headers: Record<string, string>;
  attachments: EmailAttachment[];
  inReplyTo?: Hex;
  threadId?: Hex;
}

export interface EmailAttachment {
  filename: string;
  mimeType: string;
  size: number;
  cid: string;
  checksum: Hex;
}

export type EmailPriority = 'low' | 'normal' | 'high';

export interface Mailbox {
  owner: Address;
  encryptedIndexCid: string;
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
  contentCid: string;
  from: string;
  to: string[];
  subject: string;
  preview: string;
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
  spam: number;
  scam: number;
  csam: number;
  malware: number;
  harassment: number;
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
  uptime: number;
  lastReportTimestamp: number;
}

export interface ExternalProvider {
  operator: Address;
  domain: string;
  endpoint: string;
  status: RelayStatus;
  stakedAmount: bigint;
}

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

export interface EmailServiceConfig {
  rpcUrl: string;
  chainId: number;
  emailRegistryAddress: Address;
  emailStakingAddress: Address;
  jnsRegistryAddress: Address;
  moderationMarketplaceAddress: Address;
  banManagerAddress: Address;
  dwsEndpoint: string;
  storageBackend: 'ipfs' | 'arweave' | 'multi';
  emailDomain: string;
  smtpHost: string;
  smtpPort: number;
  imapHost: string;
  imapPort: number;
  sesRegion: string;
  inboundBucket: string;
  teeEndpoint?: string;
  teeEnabled: boolean;
  contentScreeningEnabled: boolean;
  aiModelEndpoint: string;
  csamHashListUrl?: string;
  rateLimits: Record<EmailTier, RateLimitConfig>;
}

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
    content: string;
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
