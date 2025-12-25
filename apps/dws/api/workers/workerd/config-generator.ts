/**
 * Workerd Configuration Generator
 * Generates Cap'n Proto configuration files for workerd
 */

import type { WorkerdConfig, WorkerdWorkerDefinition } from './types'

/**
 * Generate a workerd Cap'n Proto configuration for a single worker
 */
export function generateWorkerConfig(
  worker: WorkerdWorkerDefinition,
  port: number,
): string {
  const workerName = sanitizeName(worker.name)

  // Generate modules section
  const modules = worker.modules
    .map((mod) => {
      const moduleType =
        mod.type === 'esModule'
          ? 'esModule'
          : mod.type === 'commonJs'
            ? 'commonJs'
            : mod.type === 'text'
              ? 'text'
              : mod.type === 'json'
                ? 'json'
                : mod.type === 'wasm'
                  ? 'wasm'
                  : 'data'

      // For embedded content, we use embed directive
      return `      (name = "${mod.name}", ${moduleType} = embed "${mod.name}")`
    })
    .join(',\n')

  // Generate bindings section
  const bindings = worker.bindings
    .map((binding) => {
      switch (binding.type) {
        case 'text':
          return `      (name = "${binding.name}", text = "${escapeString(String(binding.value))}")`
        case 'json':
          return `      (name = "${binding.name}", json = "${escapeString(JSON.stringify(binding.value))}")`
        case 'data':
          return `      (name = "${binding.name}", data = embed "${binding.name}.bin")`
        case 'service':
          return `      (name = "${binding.name}", service = "${binding.service}")`
        default:
          return `      (name = "${binding.name}", text = "")`
      }
    })
    .join(',\n')

  // Generate compatibility flags
  const compatFlags = worker.compatibilityFlags?.length
    ? `\n    compatibilityFlags = [${worker.compatibilityFlags.map((f) => `"${f}"`).join(', ')}],`
    : ''

  // Use camelCase for the worker name to comply with Cap'n Proto conventions
  const camelCaseName = workerName.replace(/_([a-z])/g, (_, c) =>
    c.toUpperCase(),
  )

  const capnpConfig = `# Auto-generated workerd configuration for ${worker.name}
# Worker ID: ${worker.id}
# Version: ${worker.version}
# Generated: ${new Date().toISOString()}

using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "main", worker = .${camelCaseName}Worker),
  ],
  sockets = [
    (
      name = "http",
      address = "127.0.0.1:${port}",
      http = (),
      service = "main"
    ),
  ],
);

const ${camelCaseName}Worker :Workerd.Worker = (
  modules = [
${modules}
  ],
  bindings = [
${bindings}
  ],
  compatibilityDate = "${worker.compatibilityDate}",${compatFlags}
);
`

  return capnpConfig
}

/**
 * Generate a multi-worker configuration for pool mode
 */
export function generatePoolConfig(
  workers: WorkerdWorkerDefinition[],
  port: number,
  config: WorkerdConfig,
): string {
  const services = workers
    .map((w) => {
      const name = toCamelCase(sanitizeName(w.name))
      return `    (name = "${name}", worker = .${name}Worker)`
    })
    .join(',\n')

  const workerDefs = workers
    .map((w) => generateInlineWorkerDef(w, config))
    .join('\n\n')

  return `# Auto-generated workerd pool configuration
# Workers: ${workers.length}
# Generated: ${new Date().toISOString()}

using Workerd = import "/workerd/workerd.capnp";

const config :Workerd.Config = (
  services = [
    (name = "router", worker = .routerWorker),
${services}
  ],
  sockets = [
    (
      name = "http",
      address = "127.0.0.1:${port}",
      http = (),
      service = "router"
    ),
  ],
);

# Router worker that dispatches to appropriate worker
const routerWorker :Workerd.Worker = (
  modules = [
    (name = "router.js", esModule = embed "router.js")
  ],
  bindings = [
${workers.map((w) => `    (name = "${toCamelCase(sanitizeName(w.name))}", service = "${toCamelCase(sanitizeName(w.name))}")`).join(',\n')}
  ],
  compatibilityDate = "2024-01-01",
);

${workerDefs}
`
}

/**
 * Generate inline worker definition for pool config
 */
function generateInlineWorkerDef(
  worker: WorkerdWorkerDefinition,
  _config: WorkerdConfig,
): string {
  const name = toCamelCase(sanitizeName(worker.name))

  const modules = worker.modules
    .map((mod) => {
      const moduleType =
        mod.type === 'esModule'
          ? 'esModule'
          : mod.type === 'commonJs'
            ? 'commonJs'
            : mod.type === 'text'
              ? 'text'
              : mod.type === 'json'
                ? 'json'
                : mod.type === 'wasm'
                  ? 'wasm'
                  : 'data'
      return `    (name = "${mod.name}", ${moduleType} = embed "${worker.id}/${mod.name}")`
    })
    .join(',\n')

  const bindings = worker.bindings
    .map((binding) => {
      switch (binding.type) {
        case 'text':
          return `    (name = "${binding.name}", text = "${escapeString(String(binding.value))}")`
        case 'json':
          return `    (name = "${binding.name}", json = "${escapeString(JSON.stringify(binding.value))}")`
        default:
          return `    (name = "${binding.name}", text = "")`
      }
    })
    .join(',\n')

  return `const ${name}Worker :Workerd.Worker = (
  modules = [
${modules}
  ],
  bindings = [
${bindings}
  ],
  compatibilityDate = "${worker.compatibilityDate}",
);`
}

/**
 * Generate router worker code that dispatches to appropriate service
 */
export function generateRouterCode(workers: WorkerdWorkerDefinition[]): string {
  const routes = workers
    .map((w) => {
      const name = sanitizeName(w.name)
      return `  '${w.id}': env.${name}`
    })
    .join(',\n')

  return `// Auto-generated router worker
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const workerId = pathParts[0];

    const services = {
${routes}
    };

    const service = services[workerId];
    if (!service) {
      return new Response(JSON.stringify({ error: 'Worker not found', workerId }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Rewrite URL to strip worker ID prefix
    const newPath = '/' + pathParts.slice(1).join('/');
    const newUrl = new URL(newPath, url.origin);
    newUrl.search = url.search;

    const newRequest = new Request(newUrl.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.body,
    });

    return service.fetch(newRequest);
  }
};
`
}

/**
 * Sanitize name for use in Cap'n Proto identifiers
 */
function sanitizeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9]/g, '_')
    .replace(/^[0-9]/, '_$&')
    .replace(/__+/g, '_')
}

/**
 * Convert snake_case to camelCase for Cap'n Proto compliance
 */
function toCamelCase(name: string): string {
  return name.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

/**
 * Escape string for Cap'n Proto
 */
function escapeString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

/**
 * Create a minimal worker wrapper for functions that export a handler
 */
export function wrapHandlerAsWorker(
  code: string,
  handlerName: string = 'handler',
): string {
  // Check if code already exports a fetch handler
  if (code.includes('export default') && code.includes('fetch')) {
    return code
  }

  // Wrap traditional handler function as Cloudflare Workers format
  return `${code}

// Auto-generated fetch wrapper
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Parse body if present
    let body = null;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const contentType = request.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        body = await request.json();
      } else {
        body = await request.text();
      }
    }

    // Build event object similar to Lambda
    const event = {
      httpMethod: request.method,
      path: url.pathname,
      headers: Object.fromEntries(request.headers),
      queryStringParameters: Object.fromEntries(url.searchParams),
      body: body,
      requestContext: {
        requestId: crypto.randomUUID(),
      }
    };

    // Call the handler
    const result = await ${handlerName}(event, env);

    // Convert response
    const statusCode = result.statusCode ?? 200;
    const headers = result.headers ?? { 'Content-Type': 'application/json' };
    const responseBody = typeof result.body === 'string'
      ? result.body
      : JSON.stringify(result.body ?? result);

    return new Response(responseBody, { status: statusCode, headers });
  }
};
`
}
