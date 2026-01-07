/**
 * Minimal Worker for DWS/workerd deployment
 * This is a stripped-down version that works with workerd compatibility
 */

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // Health check
    if (path === '/health') {
      return Response.json({
        status: 'ok',
        service: 'example',
        timestamp: new Date().toISOString(),
      })
    }

    // API info
    if (path === '/api' || path === '/api/') {
      return Response.json({
        name: 'Example API',
        version: '1.0.0',
        endpoints: ['/health', '/api'],
      })
    }

    // Default: return 404
    return Response.json({ error: 'Not found' }, { status: 404 })
  },
}
