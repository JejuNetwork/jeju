/**
 * Storage API Error Types
 *
 * Custom error classes for precise error handling and API responses.
 */

// ============ Base Error ============

export class StorageError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500
  ) {
    super(message);
    this.name = 'StorageError';
  }
}

// ============ Content Errors ============

export class ContentNotFoundError extends StorageError {
  constructor(identifier: string) {
    super(`Content not found: ${identifier}`, 'CONTENT_NOT_FOUND', 404);
    this.name = 'ContentNotFoundError';
  }
}

export class ContentBlockedError extends StorageError {
  constructor(contentHash: string) {
    super(`Content is blocked: ${contentHash}`, 'CONTENT_BLOCKED', 403);
    this.name = 'ContentBlockedError';
  }
}

export class ContentRejectedError extends StorageError {
  constructor(reason: string) {
    super(`Content rejected: ${reason}`, 'CONTENT_REJECTED', 400);
    this.name = 'ContentRejectedError';
  }
}

export class ContentTooLargeError extends StorageError {
  constructor(size: number, maxSize: number) {
    super(
      `Content size ${size} exceeds max ${maxSize}`,
      'CONTENT_TOO_LARGE',
      413
    );
    this.name = 'ContentTooLargeError';
  }
}

// ============ Backend Errors ============

export class BackendUnavailableError extends StorageError {
  constructor(backend: string) {
    super(`Backend unavailable: ${backend}`, 'BACKEND_UNAVAILABLE', 503);
    this.name = 'BackendUnavailableError';
  }
}

export class NoBackendAvailableError extends StorageError {
  constructor() {
    super('No storage backend available', 'NO_BACKEND_AVAILABLE', 503);
    this.name = 'NoBackendAvailableError';
  }
}

export class UploadFailedError extends StorageError {
  constructor(backend: string, reason: string) {
    super(`Upload to ${backend} failed: ${reason}`, 'UPLOAD_FAILED', 500);
    this.name = 'UploadFailedError';
  }
}

export class DownloadFailedError extends StorageError {
  constructor(identifier: string, reason: string) {
    super(`Download ${identifier} failed: ${reason}`, 'DOWNLOAD_FAILED', 500);
    this.name = 'DownloadFailedError';
  }
}

// ============ Torrent Errors ============

export class TorrentNotFoundError extends StorageError {
  constructor(infohash: string) {
    super(`Torrent not found: ${infohash}`, 'TORRENT_NOT_FOUND', 404);
    this.name = 'TorrentNotFoundError';
  }
}

export class TorrentTimeoutError extends StorageError {
  constructor(infohash: string) {
    super(`Torrent download timeout: ${infohash}`, 'TORRENT_TIMEOUT', 408);
    this.name = 'TorrentTimeoutError';
  }
}

export class MaxTorrentsReachedError extends StorageError {
  constructor(max: number) {
    super(`Max torrents (${max}) reached`, 'MAX_TORRENTS_REACHED', 429);
    this.name = 'MaxTorrentsReachedError';
  }
}

// ============ Seeding Errors ============

export class SeederNotStartedError extends StorageError {
  constructor() {
    super('Seeder not started', 'SEEDER_NOT_STARTED', 503);
    this.name = 'SeederNotStartedError';
  }
}

export class NotSeedingError extends StorageError {
  constructor(infohash: string) {
    super(`Not seeding: ${infohash}`, 'NOT_SEEDING', 400);
    this.name = 'NotSeedingError';
  }
}

export class InvalidSignatureError extends StorageError {
  constructor() {
    super('Invalid oracle signature', 'INVALID_SIGNATURE', 401);
    this.name = 'InvalidSignatureError';
  }
}

export class NoRewardsError extends StorageError {
  constructor() {
    super('No rewards to claim', 'NO_REWARDS', 400);
    this.name = 'NoRewardsError';
  }
}

// ============ Moderation Errors ============

export class ModerationViolationError extends StorageError {
  constructor(violationType: string, confidence: number) {
    super(
      `Content violates policy: ${violationType} (${confidence}% confidence)`,
      'MODERATION_VIOLATION',
      403
    );
    this.name = 'ModerationViolationError';
  }
}

// ============ Encryption Errors ============

export class KeyNotFoundError extends StorageError {
  constructor(keyId: string) {
    super(`Encryption key not found: ${keyId}`, 'KEY_NOT_FOUND', 404);
    this.name = 'KeyNotFoundError';
  }
}

export class DecryptionFailedError extends StorageError {
  constructor(reason: string) {
    super(`Decryption failed: ${reason}`, 'DECRYPTION_FAILED', 400);
    this.name = 'DecryptionFailedError';
  }
}

export class AccessDeniedError extends StorageError {
  constructor(reason: string) {
    super(`Access denied: ${reason}`, 'ACCESS_DENIED', 403);
    this.name = 'AccessDeniedError';
  }
}

// ============ Contract Errors ============

export class ContractCallError extends StorageError {
  constructor(method: string, reason: string) {
    super(`Contract call ${method} failed: ${reason}`, 'CONTRACT_ERROR', 500);
    this.name = 'ContractCallError';
  }
}

export class InsufficientRewardPoolError extends StorageError {
  constructor(required: bigint, provided: bigint) {
    super(
      `Insufficient reward pool: ${provided} < ${required}`,
      'INSUFFICIENT_REWARD_POOL',
      400
    );
    this.name = 'InsufficientRewardPoolError';
  }
}

// ============ Validation Errors ============

export class InvalidInputError extends StorageError {
  constructor(field: string, reason: string) {
    super(`Invalid ${field}: ${reason}`, 'INVALID_INPUT', 400);
    this.name = 'InvalidInputError';
  }
}

// ============ Helper ============

export function isStorageError(error: unknown): error is StorageError {
  return error instanceof StorageError;
}

export function toStorageError(error: unknown): StorageError {
  if (isStorageError(error)) return error;
  if (error instanceof Error) {
    return new StorageError(error.message, 'UNKNOWN_ERROR', 500);
  }
  return new StorageError(String(error), 'UNKNOWN_ERROR', 500);
}
