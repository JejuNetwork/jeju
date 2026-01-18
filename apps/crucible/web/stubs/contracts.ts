/**
 * Browser-safe stub for `@jejunetwork/contracts`.
 *
 * The main package entrypoint re-exports deployment helpers that use Node-only
 * modules (`node:fs`, `node:path`, `fileURLToPath`). For Crucible's browser
 * bundle we only need typed ABIs + viem helpers.
 */

export * from '../../../../packages/contracts/ts/generated'
export * from '../../../../packages/contracts/ts/viem'
