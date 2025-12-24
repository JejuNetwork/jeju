/**
 * Vendor application manifest types.
 */

import { z } from 'zod'

export const VendorCommandsSchema = z.object({
  dev: z.string().optional(),
  build: z.string().optional(),
  test: z.string().optional(),
  start: z.string().optional(),
})
export type VendorCommands = z.infer<typeof VendorCommandsSchema>
export const VendorHealthCheckSchema = z.object({
  url: z.string().url().optional(),
  interval: z.number().int().positive().optional(),
})
export type VendorHealthCheck = z.infer<typeof VendorHealthCheckSchema>
export const MonorepoDependencySchema = z.enum([
  'contracts',
  'config',
  'shared',
  'scripts',
])
export type MonorepoDependency = z.infer<typeof MonorepoDependencySchema>

export const VendorManifestSchema = z.object({
  name: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Name must be kebab-case'),
  displayName: z.string().optional(),
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/, 'Version must be semver'),
  description: z.string().optional(),
  commands: VendorCommandsSchema.optional(),
  ports: z.record(z.string(), z.number().int().positive()).optional(),
  dependencies: z.array(MonorepoDependencySchema).optional(),
  optional: z.boolean().default(false),
  enabled: z.boolean().default(true),
  tags: z.array(z.string()).default([]),

  /** Health check configuration */
  healthCheck: VendorHealthCheckSchema.optional(),
})
export type VendorManifest = z.infer<typeof VendorManifestSchema>
export const VendorAppSchema = z.object({
  /** App name from manifest */
  name: z.string(),

  /** Absolute path to app directory */
  path: z.string(),

  /** Parsed and validated manifest */
  manifest: VendorManifestSchema,

  /** Whether app files actually exist */
  exists: z.boolean(),
})
export type VendorApp = z.infer<typeof VendorAppSchema>
export const VendorDiscoveryResultSchema = z.object({
  /** All discovered apps */
  apps: z.array(VendorAppSchema),

  /** Apps that are enabled and exist */
  availableApps: z.array(VendorAppSchema),

  /** Apps that are enabled but not initialized */
  missingApps: z.array(VendorAppSchema),

  /** Apps that are disabled */
  disabledApps: z.array(VendorAppSchema),
})
export type VendorDiscoveryResult = z.infer<typeof VendorDiscoveryResultSchema>
/**
 * Validate a vendor manifest
 */
export function validateManifest(manifest: unknown): VendorManifest {
  return VendorManifestSchema.parse(manifest)
}

/**
 * Check if a manifest is valid
 */
export function isValidManifest(manifest: unknown): manifest is VendorManifest {
  return VendorManifestSchema.safeParse(manifest).success
}
