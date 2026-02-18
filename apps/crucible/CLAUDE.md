# Crucible CLAUDE.md

Project-specific instructions for Claude Code when working in the Crucible app.

## Server Architecture (TEMPORARY - validate on merge with main)

Crucible has **two server entry points** that serve different purposes:

### server.ts vs worker.ts

| Aspect | `api/server.ts` | `api/worker.ts` |
|--------|-----------------|-----------------|
| **Purpose** | Local dev & traditional deployment | DWS/workerd serverless deployment |
| **Lines** | ~2000 (full-featured) | ~140 (minimal stub) |
| **Runtime** | Bun native | workerd/Cloudflare compatible |
| **Dev command** | `bun --watch api/server.ts` | Not used for dev |
| **State** | Global variables | Module-level getters |

### What's in server.ts but NOT in worker.ts

- `/api/v1/chat/*` - Chat API
- `/api/v1/agents` - Agent CRUD
- `/api/v1/rooms` - Room CRUD
- `/api/v1/execute` - Execution endpoint
- `/api/v1/search/*` - Search endpoints
- Rate limiting, API key auth, ban check middleware
- Bot initialization (`BotInitializer`)
- Metrics (Prometheus), activity feed
- `seedDefaultAgents()` on startup

### Cron Router

Single cron router at `api/cron/index.ts` (mounted by server.ts for local dev).

Worker deployments (DWS) use external cron triggers - no cron routes needed in worker.ts.

### Key Endpoints

```bash
# One-shot agent tick (no interval loops)
curl -X POST http://localhost:4021/api/cron/agent-tick-once

# Register an agent
curl -X POST http://localhost:4021/api/v1/autonomous/agents \
  -H "Content-Type: application/json" \
  -d '{"characterId": "daily-digest"}'

# Check autonomous status
curl http://localhost:4021/api/v1/autonomous/status
```

### Future Refactoring Needed

1. Extract server.ts routes into composable routers
2. Unify state management (getter/setter pattern)
3. Make worker.ts feature-complete for DWS deployment

## Autonomous Agent Scheduling

### Schedule Check Debug Logs

Added in `api/autonomous/index.ts` (around line 435):
- `log.debug('Schedule check', ...)` - Every schedule evaluation
- `log.debug('Schedule skip: already ran for this window', ...)` - Skip reason
- `log.debug('Schedule skip: missed window', ...)` - Skip reason

Set `LOG_LEVEL=debug` to see these.

### Cron Schedule Behavior

Agents with cron schedules (e.g., `'0 9 * * *'`) have a 2-minute window:
- If current time is within `tickIntervalMs * 2` of scheduled time → runs
- Otherwise → skipped with "missed window" log
