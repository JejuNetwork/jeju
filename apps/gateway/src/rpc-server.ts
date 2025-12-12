/**
 * RPC Gateway Server Entrypoint
 * Run with: bun src/rpc-server.ts
 */

import { startRpcServer, rpcApp } from './rpc/index.js';

const PORT = Number(process.env.RPC_GATEWAY_PORT || 4004);
const HOST = process.env.RPC_GATEWAY_HOST || '0.0.0.0';

startRpcServer(PORT, HOST);

export default {
  port: PORT,
  hostname: HOST,
  fetch: rpcApp.fetch,
};
