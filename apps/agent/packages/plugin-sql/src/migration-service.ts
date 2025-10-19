import { logger, type Plugin } from '@elizaos/core';
import { runPluginMigrations } from './custom-migrator';
import type { DrizzleDatabase } from './types';

export class DatabaseMigrationService {
  private db: DrizzleDatabase | null = null;
  private registeredSchemas = new Map<string, any>();

  constructor() {
    // No longer extending Service, so no need to call super
  }

  async initializeWithDatabase(db: DrizzleDatabase): Promise<void> {
    this.db = db;
    logger.info('DatabaseMigrationService initialized with database');
  }

  discoverAndRegisterPluginSchemas(plugins: Plugin[]): void {
    console.log(
      `[MIGRATION SERVICE] discoverAndRegisterPluginSchemas called with ${plugins.length} plugins`
    );
    for (const plugin of plugins) {
      console.log(
        `[MIGRATION SERVICE] Checking plugin: ${plugin.name}, has schema: ${!!plugin.schema}`
      );
      if (plugin.schema) {
        console.log(
          `[MIGRATION SERVICE] Schema keys for ${plugin.name}:`,
          Object.keys(plugin.schema)
        );
        this.registeredSchemas.set(plugin.name, plugin.schema);
        logger.info(`Registered schema for plugin: ${plugin.name}`);
      }
    }
    console.log(`[MIGRATION SERVICE] Total registered schemas: ${this.registeredSchemas.size}`);
    logger.info(
      `Discovered ${this.registeredSchemas.size} plugin schemas out of ${plugins.length} plugins`
    );
  }

  async runAllPluginMigrations(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized in DatabaseMigrationService');
    }

    console.log(
      `[MIGRATION SERVICE] Running migrations for ${this.registeredSchemas.size} plugins...`
    );
    logger.info(`Running migrations for ${this.registeredSchemas.size} plugins...`);

    for (const [pluginName, schema] of this.registeredSchemas) {
      console.log(`[MIGRATION SERVICE] Starting migration for plugin: ${pluginName}`);
      logger.info(`Starting migration for plugin: ${pluginName}`);
      // console.log(`[MIGRATION DEBUG] Processing plugin: ${pluginName}`);
      // console.log(`[MIGRATION DEBUG] Schema keys:`, Object.keys(schema));

      await runPluginMigrations(this.db!, pluginName, schema);

      console.log(`[MIGRATION SERVICE] Completed migration for plugin: ${pluginName}`);
      // console.log(`[MIGRATION DEBUG] Completed migration for plugin: ${pluginName}`);
    }

    console.log('[MIGRATION SERVICE] All plugin migrations completed.');
    logger.info('All plugin migrations completed.');
  }
}
