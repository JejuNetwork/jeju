/**
 * Shared utilities for deployment scripts
 *
 * Centralizes common patterns: network validation, AWS operations, command parsing
 */

import { z } from "zod";
import { $ } from "bun";

// ============ Network Types ============

export const NetworkSchema = z.enum(["localnet", "testnet", "mainnet"]);
export type NetworkType = z.infer<typeof NetworkSchema>;

const VALID_NETWORKS = ["localnet", "testnet", "mainnet"] as const;

// ============ Environment Validation ============

/**
 * Get and validate NETWORK environment variable
 */
export function getRequiredNetwork(): NetworkType {
  const network = process.env.NETWORK;
  const result = NetworkSchema.safeParse(network);
  if (!result.success) {
    throw new Error(
      `NETWORK environment variable is required. Set to: ${VALID_NETWORKS.join(", ")}` +
        (network ? ` (got: ${network})` : "")
    );
  }
  return result.data;
}

/**
 * Get and validate AWS_REGION environment variable
 */
export function getRequiredAwsRegion(): string {
  const region = process.env.AWS_REGION;
  if (!region) {
    throw new Error("AWS_REGION environment variable is required for ECR operations");
  }
  return region;
}

// ============ Command Validation ============

/**
 * Create a command validator for CLI scripts
 */
export function createCommandValidator<T extends readonly string[]>(
  validCommands: T,
  scriptName: string
): () => T[number] {
  const CommandSchema = z.enum(validCommands as unknown as [string, ...string[]]);
  return (): T[number] => {
    const command = process.argv[2];
    const result = CommandSchema.safeParse(command);
    if (!result.success) {
      throw new Error(
        `Command required. Usage: bun run ${scriptName} <command>\n` +
          `Valid commands: ${validCommands.join(", ")}` +
          (command ? `\n(got: ${command})` : "")
      );
    }
    return result.data;
  };
}

// ============ AWS/ECR Operations ============

/**
 * Get ECR registry URL for the current AWS account
 */
export async function getEcrRegistry(): Promise<string> {
  const region = getRequiredAwsRegion();
  const accountId = await $`aws sts get-caller-identity --query Account --output text`
    .text()
    .then((s) => s.trim());
  return `${accountId}.dkr.ecr.${region}.amazonaws.com`;
}

/**
 * Login to ECR registry
 */
export async function loginToEcr(registry: string): Promise<void> {
  const region = getRequiredAwsRegion();
  await $`aws ecr get-login-password --region ${region} | docker login --username AWS --password-stdin ${registry}`;
}

// ============ Git Utilities ============

/**
 * Get short git commit hash
 * @throws Error if not in a git repository
 */
export async function getGitShortHash(): Promise<string> {
  const result = await $`git rev-parse --short HEAD`.quiet().nothrow();
  if (result.exitCode !== 0) {
    throw new Error("Failed to get git hash - not in a git repository or git not available");
  }
  return result.text().trim();
}

// ============ Zod Schemas for External Data ============

export const GitHubReleaseSchema = z.object({
  tag_name: z.string(),
});

export const DeployConfigSchema = z.object({
  p2pSequencerAddress: z.string(),
}).passthrough();

export const L1DeploymentSchema = z
  .object({
    contracts: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();

// ============ Network Configuration ============

export interface NetworkRpcConfig {
  rpcUrlEnvVar: string;
  chainId: number;
  name: string;
  defaultLocalnet?: string;
}

export const NETWORK_RPC_CONFIGS: Record<NetworkType, NetworkRpcConfig> = {
  testnet: {
    rpcUrlEnvVar: "JEJU_TESTNET_RPC_URL",
    chainId: 11235813,
    name: "Testnet",
  },
  mainnet: {
    rpcUrlEnvVar: "JEJU_MAINNET_RPC_URL",
    chainId: 11235814,
    name: "Mainnet",
  },
  localnet: {
    rpcUrlEnvVar: "JEJU_LOCALNET_RPC_URL",
    chainId: 31337,
    name: "Localnet",
    defaultLocalnet: "http://localhost:6546",
  },
};

/**
 * Get RPC URL for a network
 */
export function getNetworkRpcUrl(network: NetworkType): string {
  const config = NETWORK_RPC_CONFIGS[network];
  const rpcUrl = process.env[config.rpcUrlEnvVar];

  if (rpcUrl) {
    return rpcUrl;
  }

  if (config.defaultLocalnet) {
    return config.defaultLocalnet;
  }

  throw new Error(`${config.rpcUrlEnvVar} environment variable is required for ${network}`);
}
