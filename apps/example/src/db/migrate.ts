import { getCQL } from '@jejunetwork/db'

const DATABASE_ID = process.env.CQL_DATABASE_ID || 'todo-experimental'

const SCHEMA = `
-- Todos table
CREATE TABLE IF NOT EXISTS todos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  completed INTEGER DEFAULT 0,
  priority TEXT DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  due_date INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  owner TEXT NOT NULL,
  encrypted_data TEXT,
  attachment_cid TEXT
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_todos_owner ON todos(owner);
CREATE INDEX IF NOT EXISTS idx_todos_owner_completed ON todos(owner, completed);
CREATE INDEX IF NOT EXISTS idx_todos_owner_priority ON todos(owner, priority);
CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);

-- Reminders table for cron jobs
CREATE TABLE IF NOT EXISTS reminders (
  id TEXT PRIMARY KEY,
  todo_id TEXT NOT NULL,
  owner TEXT NOT NULL,
  reminder_time INTEGER NOT NULL,
  sent INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (todo_id) REFERENCES todos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reminders_time ON reminders(reminder_time, sent);
CREATE INDEX IF NOT EXISTS idx_reminders_owner ON reminders(owner);

-- Activity log for audit trail
CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  todo_id TEXT,
  owner TEXT NOT NULL,
  action TEXT NOT NULL,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_owner ON activity_log(owner);
CREATE INDEX IF NOT EXISTS idx_activity_created ON activity_log(created_at);
`

async function migrate() {
  console.log('Starting database migration...')
  console.log(`Database ID: ${DATABASE_ID}`)

  const db = getCQL({
    blockProducerEndpoint:
      process.env.CQL_BLOCK_PRODUCER_ENDPOINT || 'http://localhost:4300',
    databaseId: DATABASE_ID,
    timeout: 30000,
    debug: true,
  })

  // Check connectivity
  const healthy = await db.isHealthy()
  if (!healthy) {
    console.warn(
      'CQL endpoint not available, migration will be retried on first connection',
    )
    console.log('To run CQL locally: docker run -p 4300:4300 covenantsql/cql')
    return
  }

  console.log('Connected to CQL')

  // Execute schema
  const statements = SCHEMA.split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith('--'))

  for (const statement of statements) {
    console.log(`Executing: ${statement.slice(0, 50)}...`)
    await db.exec(statement)
  }

  console.log('Migration complete')

  // Verify tables
  const result = await db.query<{ name: string }>(`
    SELECT name FROM sqlite_master WHERE type='table' ORDER BY name
  `)

  console.log('Tables created:', result.rows.map((r) => r.name).join(', '))

  await db.close()
}

migrate().catch(console.error)
