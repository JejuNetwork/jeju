/**
 * Test utilities for compute SDK tests
 */

import { createServer, type Server } from 'net';

/** Get an available port by letting the OS assign one */
export function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server: Server = createServer();
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close();
        reject(new Error('Failed to get port'));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
    server.on('error', reject);
  });
}
