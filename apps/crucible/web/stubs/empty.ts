// Empty stub for server-only modules in browser builds
// Provides minimal exports to satisfy imports

// Elysia stubs
export class Elysia {
  use() {
    return this
  }
  get() {
    return this
  }
  post() {
    return this
  }
  put() {
    return this
  }
  delete() {
    return this
  }
  listen() {
    return this
  }
  onError() {
    return this
  }
}

// @elysiajs/cors stub
export function cors() {
  return {}
}

// @jejunetwork/db stubs
export function getSQLit() {
  return null
}

export type SQLitClient = object

// Generic stubs for any other imports
export function createHealthMiddleware() {
  return {}
}

export const healthMiddleware = {}

// @jejunetwork/contracts stubs
export async function readContract() {
  return null
}

export async function writeContract() {
  return null
}

export function getContractAddress() {
  return '0x0000000000000000000000000000000000000000'
}

export const deployments = {}
export const banManagerAbi = []
export const identityRegistryAbi = []
export const reputationRegistryAbi = []
export const serviceRegistryAbi = []
export const priceOracleAbi = []

// Default export for module compatibility
export default {}
