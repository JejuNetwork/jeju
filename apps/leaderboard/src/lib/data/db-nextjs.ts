import path from "path";
import * as schema from "./schema";

// Type for the drizzle database instance
type DrizzleDB = ReturnType<typeof import("drizzle-orm/better-sqlite3").drizzle<typeof schema>>;

interface DatabaseInstance {
  db: DrizzleDB;
  close: () => void;
}

// Initialize SQLite database lazily to avoid issues during Next.js build
let instance: DatabaseInstance | null = null;
let initializationError: Error | null = null;

function initializeDatabase(): DrizzleDB {
  if (instance) {
    return instance.db;
  }

  if (initializationError) {
    throw initializationError;
  }

  try {
    // Dynamic import to avoid loading native modules at build time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require("better-sqlite3");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { drizzle } = require("drizzle-orm/better-sqlite3");

    const sqlite = new Database(path.join(process.cwd(), "data/db.sqlite"), {
      fileMustExist: false,
    });

    // Enable WAL mode for better performance
    sqlite.pragma("journal_mode = WAL");

    const db = drizzle(sqlite, { schema });
    instance = { db, close: () => sqlite.close() };
    return db;
  } catch (error) {
    initializationError = error instanceof Error ? error : new Error(String(error));
    throw initializationError;
  }
}

// Lazy getter for the database
export const db = new Proxy({} as DrizzleDB, {
  get(_, prop) {
    const dbInstance = initializeDatabase();
    const value = dbInstance[prop as keyof typeof dbInstance];
    if (typeof value === "function") {
      return value.bind(dbInstance);
    }
    return value;
  },
});

// Ensure database is closed when the process exits
if (typeof process !== "undefined") {
  process.on("exit", () => {
    if (instance) {
      instance.close();
    }
  });
}
