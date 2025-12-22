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

// Web2 bridge
export {
  createWeb2Bridge,
  Web2Bridge,
} from './bridge'

// Content screening
export {
  ContentScreeningPipeline,
  createContentScreeningPipeline,
  getContentScreeningPipeline,
  resetContentScreeningPipeline,
} from './content-screening'
// IMAP server (Dovecot integration)
export {
  createIMAPServer,
  IMAPServer,
} from './imap'
// Metrics
export { getMetrics, getMetricsRegistry } from './metrics'
// Relay service
export {
  createEmailRelayService,
  EmailRelayService,
  getEmailRelayService,
} from './relay'
// API routes
export { createEmailRouter } from './routes'
// SMTP submission server
export {
  createSMTPServer,
  SMTPServer,
} from './smtp'
// Mailbox storage
export {
  createMailboxStorage,
  getMailboxStorage,
  MailboxStorage,
} from './storage'
// Types
export * from './types'
