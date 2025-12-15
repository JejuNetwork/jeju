# Jeju Trigger Service - Standalone
# Cron, webhook, and event triggers

FROM oven/bun:1.1-alpine AS builder

WORKDIR /app

# Create minimal package.json with only required deps
RUN echo '{"name":"trigger-service","dependencies":{"hono":"^4.0.0"}}' > package.json

# Install dependencies
RUN bun install

# Create the trigger service source inline using heredoc
RUN mkdir -p src && cat > src/trigger-server.ts << 'ENDOFFILE'
import { Hono } from "hono";
import { cors } from "hono/cors";

const PORT = parseInt(process.env.TRIGGER_PORT ?? "4016");

type TriggerType = "cron" | "webhook" | "event";

interface Trigger {
  id: string;
  name: string;
  appName: string;
  type: TriggerType;
  cronExpression?: string;
  webhookPath?: string;
  eventTypes?: string[];
  endpoint: string;
  active: boolean;
  lastRun?: string;
  nextRun?: string;
  createdAt: string;
}

interface ExecutionLog {
  triggerId: string;
  timestamp: string;
  success: boolean;
  duration: number;
  error?: string;
}

const triggers = new Map<string, Trigger>();
const executionLogs: ExecutionLog[] = [];
let activeExecutions = 0;
const cronIntervals = new Map<string, ReturnType<typeof setInterval>>();

function parseCron(expression: string): number {
  const parts = expression.split(" ");
  if (parts[0] === "0" && parts[1] === "*") return 60 * 60 * 1000;
  if (parts[0] === "*/5") return 5 * 60 * 1000;
  if (parts[0] === "*/15") return 15 * 60 * 1000;
  if (parts[0] === "30" && parts[1] === "*") return 60 * 60 * 1000;
  return 60 * 60 * 1000;
}

async function executeTrigger(trigger: Trigger): Promise<void> {
  if (!trigger.active) return;
  const start = Date.now();
  activeExecutions++;
  try {
    const response = await fetch(trigger.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ triggerId: trigger.id, triggerName: trigger.name, timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(30000)
    });
    trigger.lastRun = new Date().toISOString();
    executionLogs.push({ triggerId: trigger.id, timestamp: trigger.lastRun, success: response.ok, duration: Date.now() - start });
    if (executionLogs.length > 100) executionLogs.shift();
  } catch (error) {
    executionLogs.push({ triggerId: trigger.id, timestamp: new Date().toISOString(), success: false, duration: Date.now() - start, error: error instanceof Error ? error.message : "Unknown error" });
  } finally {
    activeExecutions--;
  }
}

function scheduleCron(trigger: Trigger): void {
  if (trigger.type !== "cron" || !trigger.cronExpression) return;
  const existing = cronIntervals.get(trigger.id);
  if (existing) clearInterval(existing);
  const interval = parseCron(trigger.cronExpression);
  const timer = setInterval(() => executeTrigger(trigger), interval);
  cronIntervals.set(trigger.id, timer);
  trigger.nextRun = new Date(Date.now() + interval).toISOString();
}

const app = new Hono();
app.use("*", cors());

app.get("/health", (c) => c.json({ status: "healthy", service: "trigger-service" }));
app.get("/api/stats", (c) => c.json({ triggerCount: triggers.size, activeExecutions, lastExecution: executionLogs.length > 0 ? executionLogs[executionLogs.length - 1] : null, uptime: process.uptime() }));
app.get("/api/triggers", (c) => c.json(Array.from(triggers.values())));
app.get("/api/triggers/:id", (c) => { const t = triggers.get(c.req.param("id")); return t ? c.json(t) : c.json({ error: "Not found" }, 404); });

app.post("/api/triggers", async (c) => {
  const body = await c.req.json() as Partial<Trigger>;
  const id = crypto.randomUUID();
  const trigger: Trigger = { id, name: body.name || "unnamed", appName: body.appName || "unknown", type: body.type || "webhook", cronExpression: body.cronExpression, webhookPath: body.webhookPath, eventTypes: body.eventTypes, endpoint: body.endpoint || "", active: true, createdAt: new Date().toISOString() };
  triggers.set(id, trigger);
  if (trigger.type === "cron") scheduleCron(trigger);
  return c.json(trigger, 201);
});

app.patch("/api/triggers/:id/active", async (c) => {
  const trigger = triggers.get(c.req.param("id"));
  if (!trigger) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json() as { active: boolean };
  trigger.active = body.active;
  if (trigger.type === "cron") { if (trigger.active) scheduleCron(trigger); else { const t = cronIntervals.get(trigger.id); if (t) clearInterval(t); cronIntervals.delete(trigger.id); } }
  return c.json(trigger);
});

app.delete("/api/triggers/:id", (c) => {
  const id = c.req.param("id");
  if (!triggers.has(id)) return c.json({ error: "Not found" }, 404);
  const t = cronIntervals.get(id); if (t) clearInterval(t);
  cronIntervals.delete(id);
  triggers.delete(id);
  return c.json({ success: true });
});

app.post("/api/webhooks/:path{.*}", async (c) => {
  const path = "/" + c.req.param("path");
  const trigger = Array.from(triggers.values()).find(t => t.type === "webhook" && t.webhookPath === path);
  if (!trigger) return c.json({ error: "Webhook not found" }, 404);
  await executeTrigger(trigger);
  return c.json({ success: true, triggerId: trigger.id });
});

app.get("/api/executions", (c) => c.json(executionLogs.slice(-50)));
app.post("/api/triggers/:id/execute", async (c) => { const t = triggers.get(c.req.param("id")); if (!t) return c.json({ error: "Not found" }, 404); await executeTrigger(t); return c.json({ success: true }); });

console.log("Trigger service listening on port " + PORT);
Bun.serve({ port: PORT, fetch: app.fetch });
ENDOFFILE

# Build
RUN bun build ./src/trigger-server.ts --outdir=./dist --target=bun --minify

# Runtime stage
FROM oven/bun:1.1-alpine

WORKDIR /app

# Install curl for health checks
RUN apk add --no-cache curl

# Copy built files
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY --from=builder /app/package.json ./

USER bun

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -sf http://localhost:${TRIGGER_PORT:-4016}/health || exit 1

EXPOSE 4016

CMD ["bun", "run", "dist/trigger-server.js"]
