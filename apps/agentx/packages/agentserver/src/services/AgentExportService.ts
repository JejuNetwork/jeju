import { logger, type IAgentRuntime, type UUID } from '@elizaos/core';
import { schema } from '@elizaos/plugin-sql';
import archiver from 'archiver';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import { serverAgentsTable } from '../schema';
import type { AgentServer } from '../server';
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

export interface ExportManifest {
  version: string;
  exportedAt: string;
  agentId: string;
  agentName: string;
  tables: string[];
  fileCount: number;
  elizaVersion: string;
}

export interface ExportOptions {
  includeFiles?: boolean;
  compress?: boolean;
}

export class AgentExportService {
  private db: any; // Type as any to avoid drizzle version conflicts
  private pool: Pool;

  constructor(
    private agentId: UUID,
    private runtime: IAgentRuntime,
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
   * Export agent data to a ZIP archive
   */
  async exportToZip(options: ExportOptions = {}): Promise<NodeJS.ReadableStream> {
    const { includeFiles = true, compress = true } = options;

    logger.info(`[AgentExportService] Starting export for agent ${this.agentId}`);

    
      // Create ZIP archive
      const archive = archiver('zip', {
        zlib: compress ? { level: 9 } : { level: 0 },
      });

      // Handle archive errors
      archive.on('error', (err) => {
        logger.error('[AgentExportService] Archive error:', err);
        throw err;
      });

      // Export database data
      const manifest = await this.exportDatabaseData(archive);

      // Export uploaded files if requested
      if (includeFiles) {
        const fileCount = await this.exportUploadedFiles(archive);
        manifest.fileCount = fileCount;
      }

      // Add manifest to archive
      archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

      // Finalize archive
      await archive.finalize();

      logger.info(`[AgentExportService] Export completed for agent ${this.agentId}`);

      return archive;
    
  }

  /**
   * Export all database data for the agent
   */
  private async exportDatabaseData(archive: archiver.Archiver): Promise<ExportManifest> {
    const tables: string[] = [];

    // Export agent data
    const agents = await this.db
      .select()
      .from(agentTable)
      .where(eq(agentTable.id as any, this.agentId));
    if (!agents || agents.length === 0) {
      throw new Error(`Agent ${this.agentId} not found`);
    }
    const agent = agents[0];
    archive.append(JSON.stringify([agent], null, 2), { name: 'database/agent.json' });
    tables.push('agent');

    // Export entities
    const entities = await this.db
      .select()
      .from(entityTable)
      .where(eq(entityTable.agentId as any, this.agentId));
    archive.append(JSON.stringify(entities, null, 2), { name: 'database/entities.json' });
    tables.push('entities');

    // Export worlds
    const worlds = await this.db
      .select()
      .from(worldTable)
      .where(eq(worldTable.agentId as any, this.agentId));
    archive.append(JSON.stringify(worlds, null, 2), { name: 'database/worlds.json' });
    tables.push('worlds');

    // Export rooms
    const rooms = await this.db
      .select()
      .from(roomTable)
      .where(eq(roomTable.agentId as any, this.agentId));
    archive.append(JSON.stringify(rooms, null, 2), { name: 'database/rooms.json' });
    tables.push('rooms');

    // Export participants
    const participants = await this.db
      .select()
      .from(participantTable)
      .where(eq(participantTable.agentId as any, this.agentId));
    archive.append(JSON.stringify(participants, null, 2), { name: 'database/participants.json' });
    tables.push('participants');

    // Export memories (handle vector embeddings)
    const memories = await this.db
      .select()
      .from(memoryTable)
      .where(eq(memoryTable.agentId as any, this.agentId));

    // Convert vector embeddings to arrays for JSON serialization
    const memoriesWithArrayEmbeddings = memories.map((memory: Record<string, unknown>) => ({
      ...memory,
      embedding: memory.embedding ? Array.from(memory.embedding as ArrayLike<number>) : null,
    }));

    archive.append(JSON.stringify(memoriesWithArrayEmbeddings, null, 2), {
      name: 'database/memories.json',
    });
    tables.push('memories');

    // Export relationships
    const relationships = await this.db
      .select()
      .from(relationshipTable)
      .where(eq(relationshipTable.agentId as any, this.agentId));
    archive.append(JSON.stringify(relationships, null, 2), {
      name: 'database/relationships.json',
    });
    tables.push('relationships');

    // Export tasks
    const tasks = await this.db
      .select()
      .from(taskTable)
      .where(eq(taskTable.agentId as any, this.agentId));
    archive.append(JSON.stringify(tasks, null, 2), { name: 'database/tasks.json' });
    tables.push('tasks');

    // Export server_agents associations
    const serverAgents = await this.db
      .select()
      .from(serverAgentsTable)
      .where(eq(serverAgentsTable.agentId, this.agentId));
    archive.append(JSON.stringify(serverAgents, null, 2), {
      name: 'database/server_agents.json',
    });
    tables.push('server_agents');

    // Create manifest
    const manifest: ExportManifest = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      agentId: this.agentId,
      agentName: agent.name || 'Unknown',
      tables,
      fileCount: 0,
      elizaVersion: '1.0.0', // TODO: Get from package.json or environment
    };

    return manifest;
  }

  /**
   * Export uploaded files for the agent
   */
  private async exportUploadedFiles(archive: archiver.Archiver): Promise<number> {
    const uploadDir = path.join(process.cwd(), '.eliza/data/uploads/agents', this.agentId);
    let fileCount = 0;

    if (fs.existsSync(uploadDir)) {
      // Add the entire upload directory to the archive
      archive.directory(uploadDir, 'uploads');

      // Count files
      const countFiles = (dir: string): number => {
        let count = 0;
        const items = fs.readdirSync(dir);
        for (const item of items) {
          const fullPath = path.join(dir, item);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            count += countFiles(fullPath);
          } else {
            count++;
          }
        }
        return count;
      };

      fileCount = countFiles(uploadDir);
      logger.info(`[AgentExportService] Exporting ${fileCount} files for agent ${this.agentId}`);
    } else {
      logger.info(`[AgentExportService] No upload directory found for agent ${this.agentId}`);
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
