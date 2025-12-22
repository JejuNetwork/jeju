import { Counter, Histogram, Gauge, Registry } from 'prom-client';

const register = new Registry();

// Email send metrics
export const emailsSentTotal = new Counter({
  name: 'jeju_email_sent_total',
  help: 'Total emails sent',
  labelNames: ['tier', 'status', 'external'],
  registers: [register],
});

export const emailsReceivedTotal = new Counter({
  name: 'jeju_email_received_total',
  help: 'Total emails received',
  labelNames: ['source', 'status'],
  registers: [register],
});

// Rate limiting
export const rateLimitHitsTotal = new Counter({
  name: 'jeju_email_rate_limit_hits_total',
  help: 'Total rate limit hits',
  labelNames: ['tier', 'limit_type'],
  registers: [register],
});

// Content screening
export const contentScreeningTotal = new Counter({
  name: 'jeju_email_content_screening_total',
  help: 'Total content screening operations',
  labelNames: ['result', 'action'],
  registers: [register],
});

export const contentScreeningDuration = new Histogram({
  name: 'jeju_email_content_screening_duration_seconds',
  help: 'Content screening duration in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10],
  registers: [register],
});

// Storage metrics
export const mailboxOperationsTotal = new Counter({
  name: 'jeju_email_mailbox_operations_total',
  help: 'Total mailbox operations',
  labelNames: ['operation', 'status'],
  registers: [register],
});

export const storageQuotaBytes = new Gauge({
  name: 'jeju_email_storage_quota_bytes',
  help: 'Storage quota usage in bytes',
  labelNames: ['tier'],
  registers: [register],
});

// Delivery metrics
export const deliveryQueueLength = new Gauge({
  name: 'jeju_email_delivery_queue_length',
  help: 'Current delivery queue length',
  registers: [register],
});

export const deliveryDuration = new Histogram({
  name: 'jeju_email_delivery_duration_seconds',
  help: 'Email delivery duration in seconds',
  labelNames: ['type'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

// SMTP/IMAP session metrics
export const activeSessions = new Gauge({
  name: 'jeju_email_active_sessions',
  help: 'Current active sessions',
  labelNames: ['protocol'],
  registers: [register],
});

export const authAttemptsTotal = new Counter({
  name: 'jeju_email_auth_attempts_total',
  help: 'Total authentication attempts',
  labelNames: ['protocol', 'mechanism', 'status'],
  registers: [register],
});

// Bridge metrics
export const bridgeOperationsTotal = new Counter({
  name: 'jeju_email_bridge_operations_total',
  help: 'Total bridge operations',
  labelNames: ['direction', 'status'],
  registers: [register],
});

// Moderation metrics  
export const moderationReviewsTotal = new Counter({
  name: 'jeju_email_moderation_reviews_total',
  help: 'Total moderation reviews',
  labelNames: ['recommendation'],
  registers: [register],
});

export const accountBansTotal = new Counter({
  name: 'jeju_email_account_bans_total',
  help: 'Total account bans',
  labelNames: ['reason'],
  registers: [register],
});

export function getMetricsRegistry(): Registry {
  return register;
}

export async function getMetrics(): Promise<string> {
  return register.metrics();
}
