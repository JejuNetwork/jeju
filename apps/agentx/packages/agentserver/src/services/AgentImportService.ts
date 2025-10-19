import { logger, type UUID } from '@elizaos/core';
import { schema } from '@elizaos/plugin-sql';
import AdmZip from 'adm-zip';
import { eq, sql } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { serverAgentsTable } from '../schema';
import type { AgentServer } from '../server';
import type { ExportManifest } from './AgentExportService';
const {
  agentTable,
  memoryTable,
  entityTable,
  relationshipTable,
  worldTable,
  roomTable,
  participantTable,
  taskTable,
} = schema;

export interface ImportOptions {
  overwrite?: boolean;
  validateManifest?: boolean;
  maxFileSize?: number; // in bytes
}

export interface ImportResult {
  success: boolean;
  agentId: string;
  agentName: string;
  tablesImported: string[];
  filesImported: number;
  errors?: string[];
}

export class AgentImportService {
  private db: any; // Type as any to avoid drizzle version conflicts
  private pool: Pool;
  private readonly MAX_ZIP_SIZE = 500 * 1024 * 1024; // 500MB default

  constructor(
    private targetAgentId: UUID,
    private serverInstance: AgentServer
  ) {
    // Get database connection from server instance
    // The server has a 'db' property that contains the raw database connection
    this.db = (this.serverInstance as any).db;

    // Create a new pool for cleanup purposes
    // Extract connection details from environment or use defaults
    const postgresUrl =
      process.env.POSTGRES_URL ||
      process.env.DATABASE_URL ||
      'postgresql://eliza:eliza_secure_pass@localhost:5432/eliza';

    this.pool = new Pool({
      connectionString: postgresUrl,
    });
  }

  /**
   * Import agent data from a ZIP archive
   */
  async importFromZip(zipBuffer: Buffer, options: ImportOptions = {}): Promise<ImportResult> {
    const { overwrite = false, validateManifest = true, maxFileSize = this.MAX_ZIP_SIZE } = options;

    logger.info(`[AgentImportService] Starting import for agent ${this.targetAgentId}`);

    // Validate ZIP size
    if (zipBuffer.length > maxFileSize) {
      throw new Error(
        `ZIP file too large: ${zipBuffer.length} bytes exceeds maximum ${maxFileSize} bytes`
      );
    }

    const result: ImportResult = {
      success: false,
      agentId: this.targetAgentId,
      agentName: '',
      tablesImported: [],
      filesImported: 0,
      errors: [],
    };

    try {
      // Parse ZIP file
      const zip = new AdmZip(zipBuffer);

      // Validate and read manifest
      const manifest = await this.validateAndReadManifest(zip, validateManifest);
      result.agentName = manifest.agentName;

      // Begin database transaction
      await this.db.transaction(async (tx: unknown) => {
        // Delete existing agent data if overwrite is enabled
        if (overwrite) {
          await this.deleteExistingAgentData(tx);
        }

        // Import database data in dependency order
        await this.importAgent(tx, zip);
        result.tablesImported.push('agent');

        await this.importEntities(tx, zip);
        result.tablesImported.push('entities');

        await this.importWorlds(tx, zip);
        result.tablesImported.push('worlds');

        await this.importRooms(tx, zip);
        result.tablesImported.push('rooms');

        await this.importParticipants(tx, zip);
        result.tablesImported.push('participants');

        await this.importMemories(tx, zip);
        result.tablesImported.push('memories');

        await this.importRelationships(tx, zip);
        result.tablesImported.push('relationships');

        await this.importTasks(tx, zip);
        result.tablesImported.push('tasks');

        await this.importServerAgents(tx, zip);
        result.tablesImported.push('server_agents');
      });

      // Import uploaded files (outside transaction)
      const fileCount = await this.importUploadedFiles(zip);
      result.filesImported = fileCount;

      result.success = true;
      logger.info(
        `[AgentImportService] Import completed successfully for agent ${this.targetAgentId}`
      );
    } catch (error) {
      logger.error('[AgentImportService] Import failed:', error);
      result.errors?.push(error instanceof Error ? error.message : String(error));
      throw error;
    }

    return result;
  }

  /**
   * Validate ZIP structure and read manifest
   */
  private async validateAndReadManifest(zip: AdmZip, validate: boolean): Promise<ExportManifest> {
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry) {
      throw new Error('Invalid export: manifest.json not found');
    }

    const manifestData = zip.readAsText(manifestEntry);
    const manifest: ExportManifest = JSON.parse(manifestData);

    if (validate) {
      // Validate manifest version
      if (!manifest.version || manifest.version !== '1.0.0') {
        throw new Error(`Unsupported export version: ${manifest.version}`);
      }

      // Validate required fields
      if (!manifest.agentId || !manifest.agentName || !manifest.tables) {
        throw new Error('Invalid manifest: missing required fields');
      }

      // Validate all expected tables are present
      const expectedTables = [
        'agent',
        'entities',
        'worlds',
        'rooms',
        'participants',
        'memories',
        'relationships',
        'tasks',
        'server_agents',
      ];

      for (const table of expectedTables) {
        if (!manifest.tables.includes(table)) {
          throw new Error(`Missing expected table in export: ${table}`);
        }

        // Check if corresponding file exists
        const tableFile = `database/${table}.json`;
        if (!zip.getEntry(tableFile)) {
          throw new Error(`Missing data file: ${tableFile}`);
        }
      }
    }

    return manifest;
  }

  /**
   * Delete existing agent data (cascade will handle related tables)
   */
  private async deleteExistingAgentData(tx: unknown): Promise<void> {
    logger.info(`[AgentImportService] Deleting existing data for agent ${this.targetAgentId}`);

    // Delete from server_agents first (no cascade from agents table)
    await tx.delete(serverAgentsTable).where(eq(serverAgentsTable.agentId, this.targetAgentId));

    // Delete agent (cascade will handle all other tables)
    await tx.delete(agentTable).where(eq(agentTable.id as any, this.targetAgentId));
  }

  /**
   * Import agent data
   */
  private async importAgent(tx: unknown, zip: AdmZip): Promise<void> {
    const agentEntry = zip.getEntry('database/agent.json');
    if (!agentEntry) throw new Error('agent.json not found');

    const agents = JSON.parse(zip.readAsText(agentEntry));
    if (!agents || agents.length === 0) throw new Error('No agent data found');

    const agent = agents[0];
    // Replace the agent ID with our target ID
    agent.id = this.targetAgentId;

    await tx.insert(agentTable).values(agent);
  }

  /**
   * Import entities
   */
  private async importEntities(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/entities.json');
    if (!entry) return; // Entities are optional

    const entities = JSON.parse(zip.readAsText(entry));
    if (entities.length === 0) return;

    // Update agent IDs
    const updatedEntities = entities.map((entity: Record<string, unknown>) => ({
      ...entity,
      agentId: this.targetAgentId,
    }));

    await tx.insert(entityTable).values(updatedEntities);
  }

  /**
   * Import worlds
   */
  private async importWorlds(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/worlds.json');
    if (!entry) return;

    const worlds = JSON.parse(zip.readAsText(entry));
    if (worlds.length === 0) return;

    const updatedWorlds = worlds.map((world: Record<string, unknown>) => ({
      ...world,
      agentId: this.targetAgentId,
    }));

    await tx.insert(worldTable).values(updatedWorlds);
  }

  /**
   * Import rooms
   */
  private async importRooms(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/rooms.json');
    if (!entry) return;

    const rooms = JSON.parse(zip.readAsText(entry));
    if (rooms.length === 0) return;

    const updatedRooms = rooms.map((room: Record<string, unknown>) => ({
      ...room,
      agentId: this.targetAgentId,
    }));

    await tx.insert(roomTable).values(updatedRooms);
  }

  /**
   * Import participants
   */
  private async importParticipants(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/participants.json');
    if (!entry) return;

    const participants = JSON.parse(zip.readAsText(entry));
    if (participants.length === 0) return;

    const updatedParticipants = participants.map((participant: Record<string, unknown>) => ({
      ...participant,
      agentId: this.targetAgentId,
    }));

    await tx.insert(participantTable).values(updatedParticipants);
  }

  /**
   * Import memories (convert array embeddings back to vectors)
   */
  private async importMemories(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/memories.json');
    if (!entry) return;

    const memories = JSON.parse(zip.readAsText(entry));
    if (memories.length === 0) return;

    // Process memories in batches to avoid overwhelming the database
    const BATCH_SIZE = 100;
    for (let i = 0; i < memories.length; i += BATCH_SIZE) {
      const batch = memories.slice(i, i + BATCH_SIZE);

      const updatedMemories = batch.map((memory: Record<string, unknown>) => ({
        ...memory,
        agentId: this.targetAgentId,
        // Convert array embeddings back to pgvector format
        embedding: memory.embedding
          ? sql`'[${sql.raw(memory.embedding.join(','))}]'::vector`
          : null,
      }));

      await tx.insert(memoryTable).values(updatedMemories);
    }
  }

  /**
   * Import relationships
   */
  private async importRelationships(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/relationships.json');
    if (!entry) return;

    const relationships = JSON.parse(zip.readAsText(entry));
    if (relationships.length === 0) return;

    const updatedRelationships = relationships.map((relationship: Record<string, unknown>) => ({
      ...relationship,
      agentId: this.targetAgentId,
    }));

    await tx.insert(relationshipTable).values(updatedRelationships);
  }

  /**
   * Import tasks
   */
  private async importTasks(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/tasks.json');
    if (!entry) return;

    const tasks = JSON.parse(zip.readAsText(entry));
    if (tasks.length === 0) return;

    const updatedTasks = tasks.map((task: Record<string, unknown>) => ({
      ...task,
      agentId: this.targetAgentId,
    }));

    await tx.insert(taskTable).values(updatedTasks);
  }

  /**
   * Import server_agents associations
   */
  private async importServerAgents(tx: unknown, zip: AdmZip): Promise<void> {
    const entry = zip.getEntry('database/server_agents.json');
    if (!entry) return;

    const serverAgents = JSON.parse(zip.readAsText(entry));
    if (serverAgents.length === 0) return;

    const updatedServerAgents = serverAgents.map((sa: Record<string, unknown>) => ({
      ...sa,
      agentId: this.targetAgentId,
    }));

    await tx.insert(serverAgentsTable).values(updatedServerAgents);
  }

  /**
   * Import uploaded files
   */
  private async importUploadedFiles(zip: AdmZip): Promise<number> {
    const uploadDir = path.join(process.cwd(), '.eliza/data/uploads/agents', this.targetAgentId);
    let fileCount = 0;

    // Clear existing upload directory
    if (fs.existsSync(uploadDir)) {
      fs.rmSync(uploadDir, { recursive: true, force: true });
    }

    // Extract files
    const entries = zip.getEntries();
    for (const entry of entries) {
      if (entry.entryName.startsWith('uploads/') && !entry.isDirectory) {
        const relativePath = entry.entryName.substring('uploads/'.length);
        const fullPath = path.join(uploadDir, relativePath);

        // Ensure directory exists
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        // Extract file
        fs.writeFileSync(fullPath, entry.getData());
        fileCount++;
      }
    }

    if (fileCount > 0) {
      logger.info(
        `[AgentImportService] Imported ${fileCount} files for agent ${this.targetAgentId}`
      );
    }

    return fileCount;
  }

  /**
   * Clean up resources
   */
  async cleanup(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }
  }
}
