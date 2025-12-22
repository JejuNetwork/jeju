/**
 * Wallet Lock Service
 * Password/PIN protection with auto-lock timeout
 */

import { secureStorage } from '../../platform/secure-storage';
import { LockStateSchema, LockConfigSchema } from '../../plugin/schemas';
import { expectJson } from '../../lib/validation';

export type LockType = 'password' | 'pin' | 'biometric';

interface LockState {
  isLocked: boolean;
  lockType: LockType;
  lastActivity: number;
  autoLockTimeout: number; // minutes
  failedAttempts: number;
  lockedUntil: number | null;
}

interface LockConfig {
  type: LockType;
  autoLockTimeout: number; // minutes, 0 = never
  maxFailedAttempts: number;
  lockoutDuration: number; // minutes
}

const DEFAULT_CONFIG: LockConfig = {
  type: 'password',
  autoLockTimeout: 5,
  maxFailedAttempts: 5,
  lockoutDuration: 15,
};

const STORAGE_KEYS = {
  passwordHash: 'jeju_password_hash',
  lockConfig: 'jeju_lock_config',
  lockState: 'jeju_lock_state',
};

class LockService {
  private state: LockState = {
    isLocked: true,
    lockType: 'password',
    lastActivity: Date.now(),
    autoLockTimeout: 5,
    failedAttempts: 0,
    lockedUntil: null,
  };
  
  private config: LockConfig = DEFAULT_CONFIG;
  private activityTimer: ReturnType<typeof setInterval> | null = null;
  private onLockCallbacks: Set<(locked: boolean) => void> = new Set();
  
  async initialize(): Promise<void> {
    // Load config
    const savedConfig = await this.getStoredConfig();
    if (savedConfig) {
      this.config = savedConfig;
    }
    
    // Load state
    const savedState = await this.getStoredState();
    if (savedState) {
      this.state = savedState;
    }
    
    // Check if password is set
    const hasPassword = await this.hasPassword();
    if (!hasPassword) {
      this.state.isLocked = false;
    }
    
    // Start activity monitoring
    this.startActivityMonitor();
  }
  
  /**
   * Check if password/PIN is set
   */
  async hasPassword(): Promise<boolean> {
    const hash = await secureStorage.get(STORAGE_KEYS.passwordHash);
    return hash !== null;
  }
  
  /**
   * Set initial password
   */
  async setPassword(password: string): Promise<void> {
    if (password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    
    const hash = await this.hashPassword(password);
    await secureStorage.set(STORAGE_KEYS.passwordHash, hash);
    
    this.state.isLocked = false;
    this.state.lockType = 'password';
    await this.saveState();
    this.notifyLockChange();
  }
  
  /**
   * Set PIN (4-6 digits)
   */
  async setPin(pin: string): Promise<void> {
    if (!/^\d{4,6}$/.test(pin)) {
      throw new Error('PIN must be 4-6 digits');
    }
    
    const hash = await this.hashPassword(pin);
    await secureStorage.set(STORAGE_KEYS.passwordHash, hash);
    
    this.state.isLocked = false;
    this.state.lockType = 'pin';
    await this.saveState();
    this.notifyLockChange();
  }
  
  /**
   * Change password/PIN
   */
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const isValid = await this.verifyPassword(currentPassword);
    if (!isValid) {
      throw new Error('Current password is incorrect');
    }
    
    await this.setPassword(newPassword);
  }
  
  /**
   * Unlock wallet
   */
  async unlock(password: string): Promise<boolean> {
    // Check lockout
    if (this.state.lockedUntil && Date.now() < this.state.lockedUntil) {
      const remaining = Math.ceil((this.state.lockedUntil - Date.now()) / 60000);
      throw new Error(`Too many failed attempts. Try again in ${remaining} minutes.`);
    }
    
    const isValid = await this.verifyPassword(password);
    
    if (isValid) {
      this.state.isLocked = false;
      this.state.failedAttempts = 0;
      this.state.lockedUntil = null;
      this.state.lastActivity = Date.now();
      await this.saveState();
      this.notifyLockChange();
      return true;
    }
    
    // Handle failed attempt
    this.state.failedAttempts++;
    
    if (this.state.failedAttempts >= this.config.maxFailedAttempts) {
      this.state.lockedUntil = Date.now() + this.config.lockoutDuration * 60000;
      this.state.failedAttempts = 0;
    }
    
    await this.saveState();
    return false;
  }
  
  /**
   * Lock wallet
   */
  async lock(): Promise<void> {
    this.state.isLocked = true;
    await this.saveState();
    this.notifyLockChange();
  }
  
  /**
   * Check if wallet is locked
   */
  isLocked(): boolean {
    return this.state.isLocked;
  }
  
  /**
   * Get lock type
   */
  getLockType(): LockType {
    return this.state.lockType;
  }
  
  /**
   * Update activity timestamp
   */
  updateActivity(): void {
    this.state.lastActivity = Date.now();
  }
  
  /**
   * Set auto-lock timeout
   */
  async setAutoLockTimeout(minutes: number): Promise<void> {
    this.config.autoLockTimeout = minutes;
    this.state.autoLockTimeout = minutes;
    await this.saveConfig();
    await this.saveState();
  }
  
  /**
   * Get auto-lock timeout
   */
  getAutoLockTimeout(): number {
    return this.config.autoLockTimeout;
  }
  
  /**
   * Subscribe to lock state changes
   */
  onLockChange(callback: (locked: boolean) => void): () => void {
    this.onLockCallbacks.add(callback);
    return () => {
      this.onLockCallbacks.delete(callback);
    };
  }
  
  /**
   * Remove password (disable lock)
   */
  async removePassword(currentPassword: string): Promise<void> {
    const isValid = await this.verifyPassword(currentPassword);
    if (!isValid) {
      throw new Error('Password is incorrect');
    }
    
    await secureStorage.remove(STORAGE_KEYS.passwordHash);
    this.state.isLocked = false;
    await this.saveState();
    this.notifyLockChange();
  }
  
  // Private methods
  
  private async hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + 'jeju_salt_v1');
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  private async verifyPassword(password: string): Promise<boolean> {
    const storedHash = await secureStorage.get(STORAGE_KEYS.passwordHash);
    if (!storedHash) return true; // No password set
    
    const inputHash = await this.hashPassword(password);
    return inputHash === storedHash;
  }
  
  private async saveState(): Promise<void> {
    await secureStorage.set(STORAGE_KEYS.lockState, JSON.stringify(this.state));
  }
  
  private async getStoredState(): Promise<LockState | null> {
    const data = await secureStorage.get(STORAGE_KEYS.lockState);
    if (!data) return null;
    return expectJson(data, LockStateSchema, 'lock state');
  }
  
  private async saveConfig(): Promise<void> {
    await secureStorage.set(STORAGE_KEYS.lockConfig, JSON.stringify(this.config));
  }
  
  private async getStoredConfig(): Promise<LockConfig | null> {
    const data = await secureStorage.get(STORAGE_KEYS.lockConfig);
    if (!data) return null;
    return expectJson(data, LockConfigSchema, 'lock config');
  }
  
  private notifyLockChange(): void {
    for (const callback of this.onLockCallbacks) {
      callback(this.state.isLocked);
    }
  }
  
  private startActivityMonitor(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
    }
    
    this.activityTimer = setInterval(() => {
      if (this.state.isLocked) return;
      if (this.config.autoLockTimeout === 0) return;
      
      const inactiveTime = Date.now() - this.state.lastActivity;
      const timeout = this.config.autoLockTimeout * 60000;
      
      if (inactiveTime >= timeout) {
        this.lock();
      }
    }, 10000); // Check every 10 seconds
  }
  
  /**
   * Clean up
   */
  destroy(): void {
    if (this.activityTimer) {
      clearInterval(this.activityTimer);
      this.activityTimer = null;
    }
    this.onLockCallbacks.clear();
  }
}

export const lockService = new LockService();
export { LockService };

