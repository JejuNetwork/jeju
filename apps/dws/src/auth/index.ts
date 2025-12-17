/**
 * DWS Auth Service
 * 
 * Integrated authentication for DWS that supports:
 * - Wallet-based authentication (SIWE)
 * - Session management
 * - KMS vault integration for user secrets
 */

import { verifyMessage, type Address, type Hex } from 'viem';
import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface Session {
  sessionId: string;
  address: Address;
  createdAt: number;
  expiresAt: number;
  lastActivityAt: number;
  metadata: Record<string, string>;
}

export interface AuthChallenge {
  challenge: string;
  expiresAt: number;
  address: Address;
}

export interface UserVault {
  address: Address;
  secrets: Map<string, EncryptedSecret>;
  createdAt: number;
  updatedAt: number;
}

export interface EncryptedSecret {
  id: string;
  name: string;
  encryptedValue: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================================================
// Auth Service
// ============================================================================

export class AuthService {
  private db: Database;
  private sessions = new Map<string, Session>();
  private challenges = new Map<string, AuthChallenge>();
  private userVaults = new Map<string, UserVault>();
  private sessionDuration = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    this.db = new Database(':memory:');
    this.initDatabase();
    this.loadFromDatabase();
  }

  private initDatabase() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_activity_at INTEGER NOT NULL,
        metadata TEXT DEFAULT '{}'
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS user_vaults (
        address TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS vault_secrets (
        id TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        name TEXT NOT NULL,
        encrypted_value TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (address) REFERENCES user_vaults(address)
      )
    `);

    this.db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_address ON sessions(address)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_vault_secrets_address ON vault_secrets(address)`);
  }

  private loadFromDatabase() {
    // Load sessions
    const sessions = this.db.query('SELECT * FROM sessions WHERE expires_at > ?').all(Date.now()) as Array<{
      session_id: string;
      address: string;
      created_at: number;
      expires_at: number;
      last_activity_at: number;
      metadata: string;
    }>;
    
    for (const row of sessions) {
      this.sessions.set(row.session_id, {
        sessionId: row.session_id,
        address: row.address as Address,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        lastActivityAt: row.last_activity_at,
        metadata: JSON.parse(row.metadata || '{}'),
      });
    }

    // Load user vaults
    const vaults = this.db.query('SELECT * FROM user_vaults').all() as Array<{
      address: string;
      created_at: number;
      updated_at: number;
    }>;

    for (const vault of vaults) {
      const secrets = this.db.query('SELECT * FROM vault_secrets WHERE address = ?').all(vault.address) as Array<{
        id: string;
        name: string;
        encrypted_value: string;
        created_at: number;
        updated_at: number;
      }>;

      const secretsMap = new Map<string, EncryptedSecret>();
      for (const secret of secrets) {
        secretsMap.set(secret.name, {
          id: secret.id,
          name: secret.name,
          encryptedValue: secret.encrypted_value,
          createdAt: secret.created_at,
          updatedAt: secret.updated_at,
        });
      }

      this.userVaults.set(vault.address, {
        address: vault.address as Address,
        secrets: secretsMap,
        createdAt: vault.created_at,
        updatedAt: vault.updated_at,
      });
    }
  }

  // ============================================================================
  // Challenge/Response Authentication
  // ============================================================================

  generateChallenge(address: Address): { challenge: string; expiresAt: number } {
    const challenge = `Sign this message to authenticate with DWS:\n\nAddress: ${address}\nNonce: ${randomBytes(16).toString('hex')}\nTimestamp: ${Date.now()}`;
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    this.challenges.set(address.toLowerCase(), {
      challenge,
      expiresAt,
      address,
    });

    return { challenge, expiresAt };
  }

  async verifySignature(address: Address, signature: Hex, message: string): Promise<boolean> {
    const challenge = this.challenges.get(address.toLowerCase());
    
    if (!challenge) {
      return false;
    }

    if (Date.now() > challenge.expiresAt) {
      this.challenges.delete(address.toLowerCase());
      return false;
    }

    if (message !== challenge.challenge) {
      return false;
    }

    const valid = await verifyMessage({
      address,
      message,
      signature,
    });

    if (valid) {
      this.challenges.delete(address.toLowerCase());
    }

    return valid;
  }

  // ============================================================================
  // Session Management
  // ============================================================================

  createSession(address: Address, metadata: Record<string, string> = {}): Session {
    const sessionId = randomBytes(32).toString('hex');
    const now = Date.now();
    
    const session: Session = {
      sessionId,
      address,
      createdAt: now,
      expiresAt: now + this.sessionDuration,
      lastActivityAt: now,
      metadata,
    };

    this.sessions.set(sessionId, session);
    
    this.db.run(
      `INSERT INTO sessions (session_id, address, created_at, expires_at, last_activity_at, metadata) VALUES (?, ?, ?, ?, ?, ?)`,
      [sessionId, address, now, session.expiresAt, now, JSON.stringify(metadata)]
    );

    // Ensure user vault exists
    this.getOrCreateVault(address);

    return session;
  }

  getSession(sessionId: string): Session | null {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.deleteSession(sessionId);
      return null;
    }

    // Update last activity
    session.lastActivityAt = Date.now();
    this.db.run(
      'UPDATE sessions SET last_activity_at = ? WHERE session_id = ?',
      [session.lastActivityAt, sessionId]
    );

    return session;
  }

  refreshSession(sessionId: string): Session | null {
    const session = this.getSession(sessionId);
    if (!session) return null;

    session.expiresAt = Date.now() + this.sessionDuration;
    session.lastActivityAt = Date.now();

    this.db.run(
      'UPDATE sessions SET expires_at = ?, last_activity_at = ? WHERE session_id = ?',
      [session.expiresAt, session.lastActivityAt, sessionId]
    );

    return session;
  }

  deleteSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    this.db.run('DELETE FROM sessions WHERE session_id = ?', [sessionId]);
    return existed;
  }

  getSessionsByAddress(address: Address): Session[] {
    return Array.from(this.sessions.values())
      .filter(s => s.address.toLowerCase() === address.toLowerCase() && Date.now() < s.expiresAt);
  }

  // ============================================================================
  // User Vault Management
  // ============================================================================

  private getOrCreateVault(address: Address): UserVault {
    const existing = this.userVaults.get(address.toLowerCase());
    if (existing) return existing;

    const now = Date.now();
    const vault: UserVault = {
      address,
      secrets: new Map(),
      createdAt: now,
      updatedAt: now,
    };

    this.userVaults.set(address.toLowerCase(), vault);
    this.db.run(
      'INSERT OR IGNORE INTO user_vaults (address, created_at, updated_at) VALUES (?, ?, ?)',
      [address.toLowerCase(), now, now]
    );

    return vault;
  }

  storeSecret(address: Address, name: string, value: string): EncryptedSecret {
    const vault = this.getOrCreateVault(address);
    const now = Date.now();
    
    // Simple encryption using address as key (in production, use proper KMS)
    const key = createHash('sha256').update(address.toLowerCase()).digest();
    const encrypted = this.encrypt(value, key);

    const existing = vault.secrets.get(name);
    const id = existing?.id || randomBytes(16).toString('hex');

    const secret: EncryptedSecret = {
      id,
      name,
      encryptedValue: encrypted,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    vault.secrets.set(name, secret);
    vault.updatedAt = now;

    if (existing) {
      this.db.run(
        'UPDATE vault_secrets SET encrypted_value = ?, updated_at = ? WHERE id = ?',
        [encrypted, now, id]
      );
    } else {
      this.db.run(
        'INSERT INTO vault_secrets (id, address, name, encrypted_value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [id, address.toLowerCase(), name, encrypted, now, now]
      );
    }

    this.db.run('UPDATE user_vaults SET updated_at = ? WHERE address = ?', [now, address.toLowerCase()]);

    return secret;
  }

  getSecret(address: Address, name: string): string | null {
    const vault = this.userVaults.get(address.toLowerCase());
    if (!vault) return null;

    const secret = vault.secrets.get(name);
    if (!secret) return null;

    const key = createHash('sha256').update(address.toLowerCase()).digest();
    return this.decrypt(secret.encryptedValue, key);
  }

  listSecrets(address: Address): Array<{ id: string; name: string; createdAt: number; updatedAt: number }> {
    const vault = this.userVaults.get(address.toLowerCase());
    if (!vault) return [];

    return Array.from(vault.secrets.values()).map(s => ({
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));
  }

  deleteSecret(address: Address, name: string): boolean {
    const vault = this.userVaults.get(address.toLowerCase());
    if (!vault) return false;

    const secret = vault.secrets.get(name);
    if (!secret) return false;

    vault.secrets.delete(name);
    vault.updatedAt = Date.now();

    this.db.run('DELETE FROM vault_secrets WHERE id = ?', [secret.id]);
    this.db.run('UPDATE user_vaults SET updated_at = ? WHERE address = ?', [vault.updatedAt, address.toLowerCase()]);

    return true;
  }

  // ============================================================================
  // Encryption Helpers (simple XOR for demo, use proper crypto in production)
  // ============================================================================

  private encrypt(plaintext: string, key: Buffer): string {
    const input = Buffer.from(plaintext, 'utf8');
    const output = Buffer.alloc(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] ^ key[i % key.length];
    }
    return output.toString('base64');
  }

  private decrypt(ciphertext: string, key: Buffer): string {
    const input = Buffer.from(ciphertext, 'base64');
    const output = Buffer.alloc(input.length);
    for (let i = 0; i < input.length; i++) {
      output[i] = input[i] ^ key[i % key.length];
    }
    return output.toString('utf8');
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getStats() {
    const now = Date.now();
    const activeSessions = Array.from(this.sessions.values()).filter(s => s.expiresAt > now);
    
    return {
      totalSessions: activeSessions.length,
      totalUsers: new Set(activeSessions.map(s => s.address.toLowerCase())).size,
      totalVaults: this.userVaults.size,
      totalSecrets: Array.from(this.userVaults.values()).reduce((sum, v) => sum + v.secrets.size, 0),
    };
  }
}

// Singleton instance
let authService: AuthService | null = null;

export function getAuthService(): AuthService {
  if (!authService) {
    authService = new AuthService();
  }
  return authService;
}

export function resetAuthService(): void {
  authService = null;
}

