/**
 * JejuDA - Native Data Availability Server
 * 
 * Entry point for the DA server
 */

import { DAServer } from './server';

const config = {
  port: parseInt(process.env.PORT || '3100'),
  ipfsApiUrl: process.env.IPFS_API_URL || 'http://localhost:5001',
  ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'http://localhost:8080',
  dataDir: process.env.DATA_DIR || './data',
};

const server = new DAServer(config);

server.start().catch((error) => {
  console.error('Failed to start JejuDA server:', error);
  process.exit(1);
});
