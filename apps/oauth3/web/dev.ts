const server = Bun.serve({
  port: 4201,
  async fetch(req) {
    const url = new URL(req.url)
    let path = url.pathname

    // Serve index.html for root
    if (path === '/') {
      path = '/index.html'
    }

    // Try to serve static file
    const file = Bun.file(`./web${path}`)
    if (await file.exists()) {
      return new Response(file)
    }

    // SPA fallback
    return new Response(Bun.file('./web/index.html'))
  },
})

console.log(`Auth frontend dev server: http://localhost:${server.port}`)
