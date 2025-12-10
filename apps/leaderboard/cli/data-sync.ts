#!/usr/bin/env bun
/**
 * Data Sync Utility - Synchronizes data from remote data branch to local dev environment
 */

import { Command } from "node_modules/@commander-js/extra-typings";
import { createLogger, LogLevel } from "@/lib/logger";
import chalk from "chalk";
import { execSync } from "child_process";
import { existsSync, mkdirSync, statSync, readFileSync, unlinkSync, rmSync, cpSync, copyFileSync } from "fs";
import { join } from "path";
import { createInterface } from "readline/promises";
import { glob } from "glob";

function isUvInstalled(): boolean {
  try {
    execSync("uv --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }
  return `${size.toFixed(1)} ${units[unit]}`;
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function getLatestMigrationNumber(worktreeDir: string): number | undefined {
  const journalPath = join(worktreeDir, "data", "dump", "meta", "_journal.json");
  if (!existsSync(journalPath)) return undefined;

  try {
    const journal = JSON.parse(readFileSync(journalPath, "utf-8"));
    const lastEntry = journal.entries?.[journal.entries.length - 1];
    return lastEntry?.idx;
  } catch {
    return undefined;
  }
}

function deleteDataFiles(directory: string): number {
  if (!existsSync(directory)) return 0;

  try {
    const files = execSync(`find "${directory}" -type f ! -name ".gitkeep"`, { encoding: "utf-8" })
      .split("\n")
      .filter(Boolean);
    files.forEach((file) => unlinkSync(file));
    return files.length;
  } catch {
    return 0;
  }
}

const program = new Command();

program
  .name("data-sync")
  .description("Synchronize data from remote data branch")
  .version("1.0.0")
  .option("-b, --branch <n>", "Data branch name", "leaderboard-data")
  .option("-r, --remote <n>", "Remote name", "origin")
  .option("-v, --verbose", "Verbose logging", false)
  .option("-d, --data-dir <path>", "Local data directory", "data")
  .option("--db-file <path>", "SQLite database path", "data/db.sqlite")
  .option("--worktree-dir <path>", "Temp worktree directory", "./.data-worktree")
  .option("--skip-db", "Skip database restore", false)
  .option("--depth <number>", "Git fetch depth", "1")
  .option("-y, --yes", "Skip confirmation", false)
  .option("-f, --force", "Force delete existing data", false)
  .action(async (options) => {
    const logLevel: LogLevel = options.verbose ? "debug" : "info";
    const logger = createLogger({ minLevel: logLevel, context: { command: "data-sync" } });

    // Check uv installation
    if (!options.skipDb && !isUvInstalled()) {
      console.log(chalk.red("\nError: 'uv' is required for database operations."));
      console.log("Install with: brew install uv");
      process.exit(1);
    }

    logger.info(`Syncing from ${options.remote}/${options.branch}`);

    // Cleanup existing worktree
    if (existsSync(options.worktreeDir)) {
      logger.info(`Removing existing worktree`);
      try {
        execSync(`git worktree remove ${options.worktreeDir} --force`);
      } catch {
        rmSync(options.worktreeDir, { recursive: true, force: true });
      }
    }

    // Check remote branch exists
    const remoteBranchCheck = execSync(
      `git ls-remote --heads ${options.remote} ${options.branch}`,
      { encoding: "utf-8" }
    );
    if (!remoteBranchCheck.trim()) {
      logger.error(`Branch '${options.branch}' not found on '${options.remote}'`);
      process.exit(1);
    }

    // Fetch and create worktree
    logger.info(`Fetching ${options.branch} with depth=${options.depth}`);
    execSync(`git fetch ${options.remote} ${options.branch} --depth=${options.depth}`);
    execSync(`git worktree add ${options.worktreeDir} ${options.remote}/${options.branch}`);

    const latestMigration = !options.skipDb ? getLatestMigrationNumber(options.worktreeDir) : undefined;
    const worktreeDbFile = join(options.worktreeDir, options.dbFile);
    const worktreeDumpDir = join(options.worktreeDir, "data/dump");
    const dumpExists = existsSync(worktreeDumpDir);

    // Pre-restore database for comparison
    if (!options.skipDb && dumpExists) {
      logger.info("Restoring remote database for comparison...");
      if (existsSync(worktreeDbFile)) unlinkSync(worktreeDbFile);

      // Remove migration tables from dump
      glob.sync(`${worktreeDumpDir}/__drizzle_migrations*`).forEach((f) => unlinkSync(f));

      // Run migrations
      const migrateCmd = latestMigration !== undefined
        ? `bun run db:migrate ${latestMigration}`
        : "bun run db:migrate";
      execSync(migrateCmd, { stdio: "inherit", env: { ...process.env, DB_PATH: worktreeDbFile } });

      // Load dump
      execSync(`uv run uvx sqlite-diffable load ${worktreeDbFile} ${worktreeDumpDir} --replace`, { stdio: "inherit" });
      logger.info("✅ Remote database restored");
    }

    // Confirmation prompt
    const hasExistingData = existsSync(options.dataDir);
    const hasExistingDb = existsSync(options.dbFile);

    if ((hasExistingData || hasExistingDb) && !options.yes) {
      const currentDbSize = getFileSize(options.dbFile);
      const remoteDbSize = getFileSize(worktreeDbFile);

      console.log(chalk.yellow("\nWarning: Local data will be overwritten!"));
      console.log(`\nDatabase: ${formatBytes(currentDbSize)} → ${formatBytes(remoteDbSize)}`);

      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const answer = await rl.question("\nProceed? [y/N] ");
      rl.close();

      if (!answer.toLowerCase().startsWith("y")) {
        logger.info("Cancelled");
        execSync(`git worktree remove ${options.worktreeDir} --force`);
        process.exit(0);
      }
    }

    // Create data directory
    if (!existsSync(options.dataDir)) {
      mkdirSync(options.dataDir, { recursive: true });
    }

    // Force delete if requested
    if (options.force) {
      const deleted = deleteDataFiles(options.dataDir);
      logger.info(`Removed ${deleted} files`);
      if (existsSync(options.dbFile)) {
        unlinkSync(options.dbFile);
        logger.info("Removed existing database");
      }
    }

    // Copy data files (excluding db and dump)
    logger.info(`Copying data files`);
    if (existsSync(join(options.worktreeDir, "data"))) {
      cpSync(join(options.worktreeDir, "data"), options.dataDir, {
        recursive: true,
        filter: (src) => !src.endsWith(".sqlite") && !src.includes("/dump/"),
      });
    }

    // Copy database and run final migrations
    if (!options.skipDb && existsSync(worktreeDbFile)) {
      logger.info(`Copying database`);
      if (existsSync(options.dbFile)) unlinkSync(options.dbFile);
      copyFileSync(worktreeDbFile, options.dbFile);
      execSync("bun run db:migrate", { stdio: "inherit" });
      logger.info("✅ Database synced");
    }

    // Cleanup
    try {
      execSync(`git worktree remove ${options.worktreeDir} --force`);
    } catch {
      rmSync(options.worktreeDir, { recursive: true, force: true });
    }

    logger.info(`✅ Sync complete!\n  Data: ${options.dataDir}\n  DB: ${options.dbFile}`);
  });

program.parse(process.argv);
