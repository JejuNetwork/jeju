import { drizzle } from "drizzle-orm/bun-sqlite";
import Database from "bun:sqlite";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

interface MigrationMeta {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
}

/**
 * Custom migration function that allows running migrations up to a specific number.
 * @param db The Drizzle database instance.
 * @param config Configuration object, must include `migrationsFolder`.
 * @param maxMigrationNumber Optional. If provided, only migrations up to this number (inclusive) will be run.
 */
const customMigrate = (db, config, maxMigrationNumber) => {
  const journalPath = path.join(config.migrationsFolder, "meta/_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file at ${journalPath}`);
  }

  const journalAsString = fs.readFileSync(journalPath).toString();
  const journal = JSON.parse(journalAsString);

  let journalEntries = journal.entries;

  if (maxMigrationNumber !== undefined) {
    console.log(`Filtering migrations up to number: ${maxMigrationNumber}`);
    journalEntries = journal.entries.filter((entry) => {
      return entry.idx <= maxMigrationNumber;
    });
  }

  console.log(`Found ${journalEntries.length} migrations to apply.`);

  if (journalEntries.length === 0) {
    console.log("No migrations to apply.");
    return;
  }

  const migrationQueries: MigrationMeta[] = [];
  for (const journalEntry of journalEntries) {
    const migrationPath = path.join(
      config.migrationsFolder,
      `${journalEntry.tag}.sql`,
    );
    try {
      const query = fs.readFileSync(migrationPath).toString();
      const result = query
        .split("--> statement-breakpoint")
        .map((it) => it.trim())
        .filter((it) => it.length > 0);

      migrationQueries.push({
        sql: result,
        bps: journalEntry.breakpoints,
        folderMillis: journalEntry.when,
        hash: crypto.createHash("sha256").update(query).digest("hex"),
      });
    } catch (e) {
      throw new Error(
        `Error reading migration file ${migrationPath}: ${e.message}`,
      );
    }
  }

  db.dialect.migrate(migrationQueries, db.session, config);
};

const dbPath = process.env.DB_PATH || "./data/db.sqlite";
console.log(`Using database at: ${dbPath}`);

// Ensure the directory for the database exists
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const sqlite = new Database(dbPath, { create: true });
const db = drizzle(sqlite);

const maxMigrationArg = process.argv[2];
let maxMigration: number | undefined;

if (maxMigrationArg) {
  const parsed = parseInt(maxMigrationArg, 10);
  if (isNaN(parsed)) {
    console.error(
      `Error: Invalid migration number provided: "${maxMigrationArg}". Must be an integer.`,
    );
    process.exit(1);
  }
  maxMigration = parsed;
}

try {
  customMigrate(db, { migrationsFolder: "./drizzle" }, maxMigration);
  console.log("Migration complete");
} catch (error) {
  console.error("Migration failed:", error);
  process.exit(1);
}
