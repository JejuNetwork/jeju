import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { drizzle, BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import Database from "bun:sqlite";
import * as schema from "@/lib/data/schema";

export function setupTestDb(): BunSQLiteDatabase<typeof schema> {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: "drizzle" });

  return db;
}
