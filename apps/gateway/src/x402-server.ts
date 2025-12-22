/**
 * x402 Facilitator Server Entry Point
 * Run with: bun src/x402-server.ts
 *
 * Provides HTTP-based payment verification and settlement for x402 protocol.
 * Port: 3402 (default) - configured via FACILITATOR_PORT env var
 */

import { startServer } from './x402/server.js'

startServer()
