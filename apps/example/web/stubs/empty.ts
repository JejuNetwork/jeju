// Empty stub for server-only modules in browser builds

// Pino stubs
export function pino() {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    fatal: () => {},
    child: () => pino(),
  }
}
export default pino

// Contract stubs
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

// DB stubs
export function getSQLit() {
  return null
}
export type SQLitClient = object

// KMS stubs - comprehensive list
export function getKMSClient() { return null }
export function getSecureSigningService() { return null }
export function createKMSClient() { return null }
export function signWithKMS() { return Promise.resolve(null) }
export function createMPCClient() { return null }
export function getKMS() { return null }
export function resetKMS() { return null }
export function createLogger() { return pino() }
export const kmsLogger = pino()
export class KMSService {}
export function getMPCClient() { return null }
export function createSecureSigningService() { return null }
export function deriveKey() { return Promise.resolve(null) }
export function encrypt() { return Promise.resolve(null) }
export function decrypt() { return Promise.resolve(null) }
export function sign() { return Promise.resolve(null) }
export function verify() { return Promise.resolve(false) }

// Default export
export const _ = {}
