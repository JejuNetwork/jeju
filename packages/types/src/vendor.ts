/**
 * @fileoverview Vendor App Types
 *
 * Type definitions for vendor application manifests and discovery.
 * Includes Zod schemas for runtime validation.
 */

import { z } from 'zod';

// ============ Commands Schema ============

export const VendorCommandsSchema = z.object({
  dev: z.string().optional(),
  build: z.string().optional(),
  test: z.string().optional(),
  start: z.string().optional(),
});
export type VendorCommands = z.infer<typeof VendorCommandsSchema>;

// ============ Health Check Schema ============

export const VendorHealthCheckSchema = z.object({
  url: z.string().url().optional(),
  interval: z.number().int().positive().optional(),
});
export type VendorHealthCheck = z.infer<typeof VendorHealthCheckSchema>;

// ============ Dependency Types ============

export const MonorepoDependencySchema = z.enum(['contracts', 'config', 'shared', 'scripts']);
export type MonorepoDependency = z.infer<typeof MonorepoDependencySchema>;

// ============ Manifest Schema ============

export const VendorManifestSchema = z.object({
  /** Kebab-case app identifier */
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Name must be kebab-case'),

  /** Human-readable display name */
  displayName: z.string().optional(),

  /** Semantic version */
  version: z.string().regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, 'Version must be semver'),

  /** Brief description */
  description: z.string().optional(),

  /** Available commands */
  commands: VendorCommandsSchema.optional(),

  /** Port mappings */
  ports: z.record(z.string(), z.number().int().positive()).optional(),

  /** Dependencies on monorepo components */
  dependencies: z.array(MonorepoDependencySchema).optional(),

  /** Whether this app is optional */
  optional: z.boolean().optional(),

  /** Whether this app is enabled */
  enabled: z.boolean().optional(),

  /** Tags for categorization */
  tags: z.array(z.string()).optional(),

  /** Health check configuration */
  healthCheck: VendorHealthCheckSchema.optional(),
});
export type VendorManifest = z.infer<typeof VendorManifestSchema>;

// ============ App Schema ============

export const VendorAppSchema = z.object({
  /** App name from manifest */
  name: z.string(),

  /** Absolute path to app directory */
  path: z.string(),

  /** Parsed and validated manifest */
  manifest: VendorManifestSchema,

  /** Whether app files actually exist */
  exists: z.boolean(),
});
export type VendorApp = z.infer<typeof VendorAppSchema>;

// ============ Discovery Result Schema ============

export const VendorDiscoveryResultSchema = z.object({
  /** All discovered apps */
  apps: z.array(VendorAppSchema),

  /** Apps that are enabled and exist */
  availableApps: z.array(VendorAppSchema),

  /** Apps that are enabled but not initialized */
  missingApps: z.array(VendorAppSchema),

  /** Apps that are disabled */
  disabledApps: z.array(VendorAppSchema),
});
export type VendorDiscoveryResult = z.infer<typeof VendorDiscoveryResultSchema>;

// ============ Helper Functions ============

/**
 * Validate a vendor manifest
 */
export function validateManifest(manifest: unknown): VendorManifest {
  return VendorManifestSchema.parse(manifest);
}

/**
 * Check if a manifest is valid
 */
export function isValidManifest(manifest: unknown): manifest is VendorManifest {
  return VendorManifestSchema.safeParse(manifest).success;
}
