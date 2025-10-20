/**
 * Vendor App Types
 * Type definitions for vendor application manifests and discovery
 */

export interface VendorManifest {
  /** Kebab-case app identifier */
  name: string;
  
  /** Human-readable display name */
  displayName?: string;
  
  /** Semantic version */
  version: string;
  
  /** Brief description */
  description?: string;
  
  /** Available commands */
  commands?: {
    dev?: string;
    build?: string;
    test?: string;
    start?: string;
  };
  
  /** Port mappings */
  ports?: Record<string, number>;
  
  /** Dependencies on monorepo components */
  dependencies?: Array<'contracts' | 'config' | 'shared' | 'scripts'>;
  
  /** Whether this app is optional */
  optional?: boolean;
  
  /** Whether this app is enabled */
  enabled?: boolean;
  
  /** Tags for categorization */
  tags?: string[];
  
  /** Health check configuration */
  healthCheck?: {
    url?: string;
    interval?: number;
  };
}

export interface VendorApp {
  /** App name from manifest */
  name: string;
  
  /** Absolute path to app directory */
  path: string;
  
  /** Parsed and validated manifest */
  manifest: VendorManifest;
  
  /** Whether app files actually exist */
  exists: boolean;
}

export interface VendorDiscoveryResult {
  /** All discovered apps */
  apps: VendorApp[];
  
  /** Apps that are enabled and exist */
  availableApps: VendorApp[];
  
  /** Apps that are enabled but not initialized */
  missingApps: VendorApp[];
  
  /** Apps that are disabled */
  disabledApps: VendorApp[];
}

