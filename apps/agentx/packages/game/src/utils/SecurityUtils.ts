/**
 * Security utilities for the ELIZA game application
 */

export class SecurityUtils {
  /**
   * Get or create an instance ID
   */
  static getInstanceId(): string {
    const existingId = localStorage.getItem('eliza-instance-id');
    if (existingId) {
      return existingId;
    }

    const newId = this.generateSecureId();
    localStorage.setItem('eliza-instance-id', newId);
    return newId;
  }

  /**
   * Get or create a session ID
   */
  static getSessionId(): string {
    const existingId = sessionStorage.getItem('eliza-session-id');
    if (existingId) {
      return existingId;
    }

    const newId = this.generateSecureId();
    sessionStorage.setItem('eliza-session-id', newId);
    return newId;
  }

  /**
   * Generate a cryptographically secure random ID
   */
  static generateSecureId(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Encrypt sensitive data (placeholder - implement with actual encryption)
   */
  static async encryptData(data: string, _key: string): Promise<string> {
    // TODO: Implement actual encryption using Web Crypto API
    return btoa(data);
  }

  /**
   * Decrypt sensitive data (placeholder - implement with actual decryption)
   */
  static async decryptData(encryptedData: string, _key: string): Promise<string> {
    // TODO: Implement actual decryption using Web Crypto API
    return atob(encryptedData);
  }

  /**
   * Sanitize HTML to prevent XSS
   */
  static sanitizeHtml(html: string): string {
    const div = document.createElement('div');
    div.textContent = html;
    return div.innerHTML;
  }

  /**
   * Validate API response structure
   */
  static validateApiResponse(response: unknown): boolean {
    return Boolean(response && typeof response === 'object' && !Array.isArray(response));
  }

  /**
   * Hash a string using SHA-256
   */
  static async hashString(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Check if running in a secure context
   */
  static isSecureContext(): boolean {
    return window.isSecureContext;
  }

  /**
   * Store API key securely (uses session storage for temporary storage)
   */
  static storeApiKey(provider: string, key: string): void {
    // In production, this should use more secure storage
    sessionStorage.setItem(`api-key-${provider}`, key);
  }

  /**
   * Retrieve API key
   */
  static getApiKey(provider: string): string | null {
    return sessionStorage.getItem(`api-key-${provider}`);
  }

  /**
   * Clear all stored API keys
   */
  static clearApiKeys(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith('api-key-')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  }

  /**
   * Verify if we're running in Tauri
   */
  static isRunningInTauri(): boolean {
    return !!(window as any).__TAURI_INTERNALS__;
  }

  /**
   * Get safe environment information
   */
  static getEnvironmentInfo(): {
    isTauri: boolean;
    isSecure: boolean;
    instanceId: string;
    sessionId: string;
  } {
    return {
      isTauri: this.isRunningInTauri(),
      isSecure: this.isSecureContext(),
      instanceId: this.getInstanceId(),
      sessionId: this.getSessionId(),
    };
  }
}

/**
 * Input validation utilities
 */
export class InputValidator {
  /**
   * Validate that input is safe text (no script tags, etc.)
   */
  static validateSafeText(input: string): boolean {
    if (!input || typeof input !== 'string') {
      return false;
    }

    // Check for dangerous patterns
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i,
      /<iframe/i,
      /<object/i,
      /<embed/i,
    ];

    return !dangerousPatterns.some((pattern) => pattern.test(input));
  }

  /**
   * Validate API key format
   */
  static validateApiKey(key: string): boolean {
    if (!key || typeof key !== 'string') {
      return false;
    }

    // Basic API key validation - should be alphanumeric with some special chars
    const apiKeyPattern = /^[a-zA-Z0-9\-_\.]+$/;
    return apiKeyPattern.test(key) && key.length >= 10 && key.length <= 200;
  }

  /**
   * Validate UUID format
   */
  static validateUuid(uuid: string): boolean {
    if (!uuid || typeof uuid !== 'string') {
      return false;
    }

    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidPattern.test(uuid);
  }

  /**
   * Sanitize user input for display
   */
  static sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') {
      return '';
    }

    return input
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  /**
   * Validate user input for chat messages
   */
  static validateUserInput(input: string): {
    valid: boolean;
    error?: string;
    sanitizedInput?: string;
  } {
    if (!input || typeof input !== 'string') {
      return { valid: false, error: 'Input must be a non-empty string' };
    }

    if (input.length > 2000) {
      return { valid: false, error: 'Input too long (max 2000 characters)' };
    }

    // Check for dangerous patterns
    if (!this.validateSafeText(input)) {
      return { valid: false, error: 'Input contains potentially dangerous content' };
    }

    return {
      valid: true,
      sanitizedInput: this.sanitizeInput(input),
    };
  }

  /**
   * Validate configuration values
   */
  static validateConfigValue(
    key: string,
    value: unknown
  ): { valid: boolean; error?: string; sanitizedValue?: unknown } {
    if (!key || typeof key !== 'string') {
      return { valid: false, error: 'Configuration key must be a string' };
    }

    // Handle different types of configuration values
    if (key.includes('API_KEY') || key.includes('_KEY')) {
      if (!value || typeof value !== 'string') {
        return { valid: true, sanitizedValue: '' }; // Allow empty API keys
      }
      if (!this.validateApiKey(value)) {
        return { valid: false, error: 'Invalid API key format' };
      }
      return { valid: true, sanitizedValue: value };
    }

    if (key.includes('URL') || key.includes('_URL')) {
      if (!value || typeof value !== 'string') {
        return { valid: false, error: 'URL must be a string' };
      }
      try {
        new URL(value);
        return { valid: true, sanitizedValue: value };
      } catch {
        return { valid: false, error: 'Invalid URL format' };
      }
    }

    // Default validation for other config values
    if (typeof value === 'string') {
      if (value.length > 500) {
        return { valid: false, error: 'Configuration value too long (max 500 characters)' };
      }
      return { valid: true, sanitizedValue: this.sanitizeInput(value) };
    }

    return { valid: true, sanitizedValue: value };
  }

  /**
   * Validate file uploads
   */
  static validateFileUpload(file: File): { valid: boolean; error?: string } {
    if (!file) {
      return { valid: false, error: 'No file provided' };
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      return { valid: false, error: 'File too large (max 10MB)' };
    }

    // Check file type
    const allowedTypes = [
      'text/plain',
      'text/markdown',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/html',
      'application/json',
      'text/csv',
    ];

    const allowedExtensions = ['.txt', '.md', '.pdf', '.doc', '.docx', '.html', '.json', '.csv'];

    const hasValidType = allowedTypes.includes(file.type);
    const hasValidExtension = allowedExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!hasValidType && !hasValidExtension) {
      return {
        valid: false,
        error: 'File type not allowed. Supported: txt, md, pdf, doc, docx, html, json, csv',
      };
    }

    // Check filename for dangerous patterns
    if (file.name.includes('..') || file.name.includes('/') || file.name.includes('\\')) {
      return { valid: false, error: 'Invalid filename' };
    }

    return { valid: true };
  }
}

/**
 * Security logging utilities
 */
export class SecurityLogger {
  private static logs: Array<{
    timestamp: number;
    level: 'info' | 'warn' | 'error';
    message: string;
    details?: unknown;
  }> = [];

  /**
   * Log security-related information
   */
  static info(message: string, details?: unknown) {
    this.addLog('info', message, details);
    console.info(`[SECURITY] ${message}`, details);
  }

  /**
   * Log security warnings
   */
  static warn(message: string, details?: unknown) {
    this.addLog('warn', message, details);
    console.warn(`[SECURITY] ${message}`, details);
  }

  /**
   * Log security errors
   */
  static error(message: string, details?: unknown) {
    this.addLog('error', message, details);
    console.error(`[SECURITY] ${message}`, details);
  }

  /**
   * Get recent security logs
   */
  static getLogs(limit: number = 100): Array<{
    timestamp: number;
    level: string;
    message: string;
    details?: unknown;
  }> {
    return this.logs.slice(-limit);
  }

  /**
   * Clear security logs
   */
  static clearLogs() {
    this.logs = [];
  }

  /**
   * Log security events with different types
   */
  static logSecurityEvent(
    eventType:
      | 'access_granted'
      | 'access_revoked'
      | 'invalid_input'
      | 'security_warning'
      | 'capability_change',
    message: string,
    severity: 'low' | 'medium' | 'high' = 'medium'
  ) {
    const logLevel = severity === 'high' ? 'error' : severity === 'medium' ? 'warn' : 'info';
    this.addLog(logLevel, `[${eventType.toUpperCase()}] ${message}`);

    // Also log to console with appropriate level
    switch (logLevel) {
      case 'error':
        console.error(`[SECURITY EVENT] ${message}`);
        break;
      case 'warn':
        console.warn(`[SECURITY EVENT] ${message}`);
        break;
      default:
        console.info(`[SECURITY EVENT] ${message}`);
        break;
    }
  }

  private static addLog(level: 'info' | 'warn' | 'error', message: string, details?: unknown) {
    this.logs.push({
      timestamp: Date.now(),
      level,
      message,
      details,
    });

    // Keep only last 500 logs to prevent memory issues
    if (this.logs.length > 500) {
      this.logs = this.logs.slice(-500);
    }
  }
}
