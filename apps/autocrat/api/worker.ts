/**
 * Autocrat Worker for DWS/workerd deployment
 * Exports a fetch handler compatible with Cloudflare Workers / workerd
 */

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    // CORS headers for all responses
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    // Health check
    if (path === '/health') {
      return Response.json(
        {
          status: 'ok',
          service: 'autocrat',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
        },
        { headers: corsHeaders },
      )
    }

    // API info
    if (path === '/api' || path === '/api/') {
      return Response.json(
        {
          name: 'Autocrat API',
          version: '1.0.0',
          description: 'Futarchic governance platform',
          endpoints: ['/health', '/api/daos', '/api/proposals'],
        },
        { headers: corsHeaders },
      )
    }

    // DAOs list (mock for worker mode)
    if (path === '/api/daos') {
      return Response.json(
        {
          daos: [],
          message: 'Use full API server for DAO operations',
        },
        { headers: corsHeaders },
      )
    }

    // Default: return 404
    return Response.json(
      { error: 'Not found' },
      { status: 404, headers: corsHeaders },
    )
  },
}
