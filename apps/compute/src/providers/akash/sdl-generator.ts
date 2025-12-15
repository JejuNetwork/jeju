/**
 * Akash SDL Generator
 *
 * Generates Akash Stack Definition Language (SDL) manifests
 * from the network deployment configurations.
 */

import type { DeploymentConfig, HardwareRequirements } from '@jejunetwork/types';
import type { SDL, SDLService, SDLResource, SDLProfile, SDLDeployment } from './types';
import { AKASH_GPU_ATTRIBUTES, type AkashNetworkType } from './types';

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PLACEMENT_NAME = 'jeju';
const DEFAULT_PROFILE_NAME = 'compute';
const DEFAULT_SERVICE_NAME = 'app';

/** Minimum bid price per block in uakt (Akash minimum is ~0.001 AKT/block for basic) */
const MIN_PRICE_PER_BLOCK_UAKT = 1000;

/** Blocks per hour on Akash (approximately 600 blocks/hour) */
const BLOCKS_PER_HOUR = 600;

// ============================================================================
// SDL Generator
// ============================================================================

export interface SDLGeneratorOptions {
  network: AkashNetworkType;
  placementRegion?: string;
  maxPricePerHourUakt?: number;
  signedByProviders?: string[];
  persistentStorage?: boolean;
}

/**
 * Generate an Akash SDL from a Network deployment configuration
 */
export function generateSDL(
  config: DeploymentConfig,
  options: SDLGeneratorOptions
): SDL {
  const serviceName = DEFAULT_SERVICE_NAME;
  const profileName = DEFAULT_PROFILE_NAME;
  const placementName = DEFAULT_PLACEMENT_NAME;

  const service = generateService(config, serviceName);
  const resources = generateResources(config.container.resources);
  const profile = generateProfile(
    profileName,
    placementName,
    resources,
    options
  );
  const deployment = generateDeployment(serviceName, profileName, placementName);

  return {
    version: '2.0',
    services: { [serviceName]: service },
    profiles: profile,
    deployment,
  };
}

/**
 * Generate SDL service configuration
 */
function generateService(config: DeploymentConfig, serviceName: string): SDLService {
  const container = config.container;

  const service: SDLService = {
    image: container.image,
    expose: [],
  };

  if (container.command && container.command.length > 0) {
    service.command = container.command;
  }

  if (container.args && container.args.length > 0) {
    service.args = container.args;
  }

  // Environment variables
  if (container.env && Object.keys(container.env).length > 0) {
    service.env = Object.entries(container.env).map(([name, value]) => ({
      name,
      value,
    }));
  }

  // Exposed ports
  if (container.ports && container.ports.length > 0) {
    service.expose = container.ports.map((port) => ({
      port: port.containerPort,
      as: port.containerPort,
      proto: port.protocol,
      to: port.expose ? [{ global: true }] : [],
    }));
  } else {
    // Default: expose port 80 globally for HTTP services
    service.expose = [{
      port: 80,
      as: 80,
      proto: 'tcp',
      to: [{ global: true }],
    }];
  }

  // SSH port if SSH key provided
  if (config.sshPublicKey) {
    service.expose.push({
      port: 22,
      as: 22,
      proto: 'tcp',
      to: [{ global: true }],
    });

    // Add SSH public key as env var
    service.env = service.env ?? [];
    service.env.push({
      name: 'SSH_AUTHORIZED_KEYS',
      value: config.sshPublicKey,
    });
  }

  // Health check
  if (config.healthCheck) {
    service.env = service.env ?? [];
    service.env.push(
      { name: 'HEALTHCHECK_PATH', value: config.healthCheck.path },
      { name: 'HEALTHCHECK_PORT', value: String(config.healthCheck.port) },
      { name: 'HEALTHCHECK_INTERVAL', value: String(config.healthCheck.intervalSeconds) },
    );
  }

  return service;
}

/**
 * Generate SDL resource configuration from hardware requirements
 */
function generateResources(hardware: HardwareRequirements): SDLResource {
  const resource: SDLResource = {
    cpu: {
      units: hardware.cpuCores * 1000, // Convert cores to millicpu
    },
    memory: {
      size: `${hardware.memoryGb}Gi`,
    },
    storage: [
      {
        size: `${hardware.storageGb}Gi`,
        class: 'default',
      },
    ],
  };

  // Add GPU if required
  if (hardware.gpuCount > 0) {
    const gpuTypeKey = getGPUTypeKey(hardware.gpuType);
    const gpuAttributes = AKASH_GPU_ATTRIBUTES[gpuTypeKey] ?? [];

    resource.gpu = {
      units: hardware.gpuCount,
      attributes: gpuAttributes.length > 0 ? gpuAttributes : undefined,
    };
  }

  return resource;
}

/**
 * Generate SDL profile configuration
 */
function generateProfile(
  profileName: string,
  placementName: string,
  resources: SDLResource,
  options: SDLGeneratorOptions
): SDLProfile {
  // Calculate price per block
  const pricePerHour = options.maxPricePerHourUakt ?? calculateDefaultPrice(resources);
  const pricePerBlock = Math.ceil(pricePerHour / BLOCKS_PER_HOUR);
  const finalPrice = Math.max(pricePerBlock, MIN_PRICE_PER_BLOCK_UAKT);

  const profile: SDLProfile = {
    compute: {
      [profileName]: {
        resources,
      },
    },
    placement: {
      [placementName]: {
        pricing: {
          [profileName]: {
            denom: 'uakt',
            amount: finalPrice,
          },
        },
      },
    },
  };

  // Add region attribute if specified
  if (options.placementRegion) {
    profile.placement[placementName].attributes = {
      region: options.placementRegion,
    };
  }

  // Add signed-by constraint if specified
  if (options.signedByProviders && options.signedByProviders.length > 0) {
    profile.placement[placementName].signedBy = {
      anyOf: options.signedByProviders,
    };
  }

  return profile;
}

/**
 * Generate SDL deployment configuration
 */
function generateDeployment(
  serviceName: string,
  profileName: string,
  placementName: string
): SDLDeployment {
  return {
    [serviceName]: [
      {
        profile: profileName,
        count: 1,
      },
    ],
  };
}

/**
 * Calculate default price based on resources
 * Returns price per hour in uakt
 */
function calculateDefaultPrice(resources: SDLResource): number {
  // Base pricing (approximate market rates as of 2024)
  const cpuPricePerCoreHour = 10000; // 0.01 AKT per core per hour
  const memoryPricePerGbHour = 5000; // 0.005 AKT per GB per hour
  const storagePricePerGbHour = 1000; // 0.001 AKT per GB per hour
  const gpuPricePerUnitHour = 500000; // 0.5 AKT per GPU per hour

  const cpuCores = resources.cpu.units / 1000;
  const memoryGb = parseSize(resources.memory.size);
  const storageGb = resources.storage.reduce((acc, s) => acc + parseSize(s.size), 0);
  const gpuUnits = resources.gpu?.units ?? 0;

  const totalPricePerHour =
    cpuCores * cpuPricePerCoreHour +
    memoryGb * memoryPricePerGbHour +
    storageGb * storagePricePerGbHour +
    gpuUnits * gpuPricePerUnitHour;

  // Add 20% buffer for bid acceptance
  return Math.ceil(totalPricePerHour * 1.2);
}

/**
 * Parse size string to GB
 */
function parseSize(size: string): number {
  const match = size.match(/^(\d+(?:\.\d+)?)(Mi|Gi|Ti|Ki)?$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const unit = match[2] ?? 'Gi';

  switch (unit) {
    case 'Ki': return value / (1024 * 1024);
    case 'Mi': return value / 1024;
    case 'Gi': return value;
    case 'Ti': return value * 1024;
    default: return value;
  }
}

/**
 * Map GPU type number to Akash GPU key
 */
function getGPUTypeKey(gpuType: number): string {
  const mapping: Record<number, string> = {
    1: 'nvidia-rtx-4090',
    2: 'nvidia-a100-40gb',
    3: 'nvidia-a100-80gb',
    4: 'nvidia-h100',
    5: 'nvidia-h200',
  };
  return mapping[gpuType] ?? '';
}

/**
 * Serialize SDL to YAML format
 */
export function sdlToYaml(sdl: SDL): string {
  return serializeToYaml(sdl, 0);
}

/**
 * Simple YAML serializer (no external dependencies)
 */
function serializeToYaml(obj: unknown, indent: number): string {
  const spaces = '  '.repeat(indent);

  if (obj === null || obj === undefined) {
    return 'null';
  }

  if (typeof obj === 'string') {
    // Quote strings that need it
    if (obj.includes(':') || obj.includes('#') || obj.includes("'") || obj.includes('"') || obj.includes('\n')) {
      return `"${obj.replace(/"/g, '\\"')}"`;
    }
    return obj;
  }

  if (typeof obj === 'number' || typeof obj === 'boolean') {
    return String(obj);
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj
      .map((item) => {
        const serialized = serializeToYaml(item, indent + 1);
        if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
          const lines = serialized.split('\n');
          return `${spaces}- ${lines[0]}\n${lines.slice(1).map((l) => `${spaces}  ${l}`).join('\n')}`;
        }
        return `${spaces}- ${serialized}`;
      })
      .join('\n');
  }

  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          const serialized = serializeToYaml(value, indent + 1);
          return `${spaces}${key}:\n${serialized}`;
        }
        return `${spaces}${key}: ${serializeToYaml(value, indent)}`;
      })
      .join('\n');
  }

  return String(obj);
}

/**
 * Validate SDL structure
 */
export function validateSDL(sdl: SDL): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (sdl.version !== '2.0') {
    errors.push('SDL version must be 2.0');
  }

  if (!sdl.services || Object.keys(sdl.services).length === 0) {
    errors.push('At least one service is required');
  }

  for (const [name, service] of Object.entries(sdl.services)) {
    if (!service.image) {
      errors.push(`Service "${name}" must have an image`);
    }
    if (!service.expose || service.expose.length === 0) {
      errors.push(`Service "${name}" must expose at least one port`);
    }
  }

  if (!sdl.profiles?.compute || Object.keys(sdl.profiles.compute).length === 0) {
    errors.push('At least one compute profile is required');
  }

  if (!sdl.profiles?.placement || Object.keys(sdl.profiles.placement).length === 0) {
    errors.push('At least one placement is required');
  }

  if (!sdl.deployment || Object.keys(sdl.deployment).length === 0) {
    errors.push('Deployment configuration is required');
  }

  return { valid: errors.length === 0, errors };
}

