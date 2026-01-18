/**
 * Workerd Entry Point
 *
 * This file is the entry point for workerd/Cloudflare Workers deployment.
 * It re-exports the worker handler as the default export.
 *
 * For local development with Bun, use api/worker.ts directly which
 * starts its own server via Elysia.listen().
 */

import { workerHandler } from './worker'

export default workerHandler
