import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle } from "drizzle-orm/bun-sqlite";
import Database from "bun:sqlite";
import * as schema from "@/lib/data/schema";
import { db as productionDb } from "@/lib/data/db";

// Use the same type as the production db for test compatibility
type DbType = typeof productionDb;

export function setupTestDb(): DbType {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });

  return db as DbType;
}
