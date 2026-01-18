/**
 * Monitoring Worker Entry Point
 *
 * This is the workerd-compatible entry point for the monitoring API.
 * It exports a fetch handler that processes incoming requests.
 */

import { createMonitoringServer } from './a2a-mcp-server'

// Create the Elysia app
const app = createMonitoringServer()

// Export the fetch handler for workerd
export default {
  async fetch(request: Request): Promise<Response> {
    return app.handle(request)
  },
}
