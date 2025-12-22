/**
 * Jeju Email Service
 * 
 * Decentralized email infrastructure for the Jeju Network:
 * - E2E encrypted email with MPC key management
 * - Stake-weighted rate limiting and access control
 * - AI-powered content moderation (spam, scam, CSAM)
 * - Full IMAP/SMTP compliance via Dovecot
 * - Web2 bridge for external email interoperability
 * 
 * Security model:
 * - Free tier: Intra-network only, easily banned
 * - Staked tier: External network access, moderation protection
 * - TEE processing for encrypted content screening
 * - Appeals through ModerationMarketplace
 */

// Types
export * from './types';

// Content screening
export {
  ContentScreeningPipeline,
  createContentScreeningPipeline,
  getContentScreeningPipeline,
  resetContentScreeningPipeline,
} from './content-screening';

// Relay service
export {
  EmailRelayService,
  createEmailRelayService,
  getEmailRelayService,
} from './relay';

// Mailbox storage
export {
  MailboxStorage,
  createMailboxStorage,
  getMailboxStorage,
} from './storage';

// IMAP server (Dovecot integration)
export {
  IMAPServer,
  createIMAPServer,
} from './imap';

// SMTP submission server
export {
  SMTPServer,
  createSMTPServer,
} from './smtp';

// Web2 bridge
export {
  Web2Bridge,
  createWeb2Bridge,
} from './bridge';

// API routes
export { createEmailRouter } from './routes';
