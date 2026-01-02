/**
 * Workerd entry point for Autocrat API
 * Exports a fetch handler compatible with workerd runtime
 */
import { type AutocratEnv, createAutocratApp } from './worker'

interface Env extends AutocratEnv {}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const app = createAutocratApp(env)
    return app.handle(request)
  },
}
