/**
 * RPC Gateway Server Entrypoint
 * Run with: bun src/rpc-server.ts
 */

import { startRpcServer } from './rpc/index.js'

const PORT = Number(process.env.RPC_GATEWAY_PORT || 4004)
const HOST = process.env.RPC_GATEWAY_HOST || '0.0.0.0'

const server = startRpcServer(PORT, HOST)

console.log(`🌐 RPC Gateway running at http://${HOST}:${PORT}`)

export default server
