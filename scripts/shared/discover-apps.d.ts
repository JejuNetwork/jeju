/**
 * App Discovery Utility
 * Discovers both core apps (apps/) and vendor apps (vendor/)
 * based on jeju-manifest.json files
 */
import { z } from 'zod';
declare const AppManifestSchema: z.ZodObject<{
    name: z.ZodString;
    displayName: z.ZodOptional<z.ZodString>;
    version: z.ZodString;
    type: z.ZodEnum<["core", "vendor"]>;
    description: z.ZodOptional<z.ZodString>;
    commands: z.ZodOptional<z.ZodObject<{
        dev: z.ZodOptional<z.ZodString>;
        build: z.ZodOptional<z.ZodString>;
        test: z.ZodOptional<z.ZodString>;
        start: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        start?: string | undefined;
        dev?: string | undefined;
        build?: string | undefined;
        test?: string | undefined;
    }, {
        start?: string | undefined;
        dev?: string | undefined;
        build?: string | undefined;
        test?: string | undefined;
    }>>;
    ports: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    dependencies: z.ZodOptional<z.ZodArray<z.ZodEnum<["contracts", "config", "shared", "scripts", "indexer", "localnet", "compute", "bazaar"]>, "many">>;
    optional: z.ZodDefault<z.ZodBoolean>;
    enabled: z.ZodDefault<z.ZodBoolean>;
    autoStart: z.ZodDefault<z.ZodBoolean>;
    tags: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    healthCheck: z.ZodOptional<z.ZodObject<{
        url: z.ZodOptional<z.ZodString>;
        interval: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        url?: string | undefined;
        interval?: number | undefined;
    }, {
        url?: string | undefined;
        interval?: number | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    type: "core" | "vendor";
    name: string;
    version: string;
    enabled: boolean;
    optional: boolean;
    autoStart: boolean;
    description?: string | undefined;
    displayName?: string | undefined;
    commands?: {
        start?: string | undefined;
        dev?: string | undefined;
        build?: string | undefined;
        test?: string | undefined;
    } | undefined;
    ports?: Record<string, number> | undefined;
    dependencies?: ("localnet" | "contracts" | "config" | "compute" | "indexer" | "bazaar" | "shared" | "scripts")[] | undefined;
    tags?: string[] | undefined;
    healthCheck?: {
        url?: string | undefined;
        interval?: number | undefined;
    } | undefined;
}, {
    type: "core" | "vendor";
    name: string;
    version: string;
    enabled?: boolean | undefined;
    description?: string | undefined;
    displayName?: string | undefined;
    commands?: {
        start?: string | undefined;
        dev?: string | undefined;
        build?: string | undefined;
        test?: string | undefined;
    } | undefined;
    ports?: Record<string, number> | undefined;
    dependencies?: ("localnet" | "contracts" | "config" | "compute" | "indexer" | "bazaar" | "shared" | "scripts")[] | undefined;
    optional?: boolean | undefined;
    autoStart?: boolean | undefined;
    tags?: string[] | undefined;
    healthCheck?: {
        url?: string | undefined;
        interval?: number | undefined;
    } | undefined;
}>;
export type AppManifest = z.infer<typeof AppManifestSchema>;
export interface NetworkApp {
    name: string;
    path: string;
    manifest: AppManifest;
    exists: boolean;
    type: 'core' | 'vendor';
}
/**
 * Discover all network apps (core + vendor)
 */
export declare function discoverAllApps(rootDir?: string): NetworkApp[];
/**
 * Discover only core apps
 */
export declare function discoverCoreApps(rootDir?: string): NetworkApp[];
/**
 * Discover only vendor apps
 */
export declare function discoverVendorApps(rootDir?: string): NetworkApp[];
/**
 * Get a specific app by name
 */
export declare function getApp(name: string, rootDir?: string): NetworkApp | null;
/**
 * Check if an app exists and is enabled
 */
export declare function hasApp(name: string, rootDir?: string): boolean;
/**
 * Get all enabled apps that should auto-start
 */
export declare function getAutoStartApps(rootDir?: string): NetworkApp[];
/**
 * Display apps summary
 */
export declare function displayAppsSummary(rootDir?: string): void;
/**
 * Get app command
 */
export declare function getAppCommand(appName: string, command: 'dev' | 'build' | 'test' | 'start', rootDir?: string): string | null;
export { AppManifestSchema };
//# sourceMappingURL=discover-apps.d.ts.map