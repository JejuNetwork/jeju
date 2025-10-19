import { logger } from '@elizaos/core';
import { sql } from 'drizzle-orm';

// Define the minimal database type we need
type DrizzleDatabase = {
  execute: (query: any) => Promise<any>;
};

/**
 * ServerMigrationService handles database migrations for server-specific tables
 * This is separate from plugin migrations to maintain clean separation of concerns
 */
export class ServerMigrationService {
  constructor(private db: DrizzleDatabase) {}

  /**
   * Runs all server-specific migrations
   */
  async runMigrations(): Promise<void> {
    logger.info('[ServerMigrationService] Starting server database migrations...');

    
      // Create messageServers table
      await this.createMessageServersTable();

      // Create channels table
      await this.createChannelsTable();

      // Create messages table
      await this.createMessagesTable();

      // Create channel_participants table
      await this.createChannelParticipantsTable();

      // Create server_agents table
      await this.createServerAgentsTable();

      logger.success('[ServerMigrationService] All server migrations completed successfully');
    
  }

  private async createMessageServersTable(): Promise<void> {
    const tableName = 'message_servers';

    
      logger.info(`[ServerMigrationService] Creating ${tableName} table...`);

      // Use CREATE TABLE IF NOT EXISTS to avoid errors
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(tableName)} (
          id UUID PRIMARY KEY,
          name TEXT NOT NULL,
          source_type TEXT NOT NULL,
          source_id TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);

      logger.success(`[ServerMigrationService] Created/verified ${tableName} table`);
    
  }

  private async createChannelsTable(): Promise<void> {
    const tableName = 'channels';

    
      logger.info(`[ServerMigrationService] Creating ${tableName} table...`);

      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(tableName)} (
          id UUID PRIMARY KEY,
          server_id UUID NOT NULL REFERENCES message_servers(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT NOT NULL,
          source_type TEXT,
          source_id TEXT,
          topic TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);

      // Create index on server_id for better query performance
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_channels_server_id ON ${sql.identifier(tableName)} (server_id)
      `);

      logger.success(`[ServerMigrationService] Created/verified ${tableName} table`);
    
  }

  private async createMessagesTable(): Promise<void> {
    const tableName = 'central_messages';

    
      logger.info(`[ServerMigrationService] Creating ${tableName} table...`);

      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(tableName)} (
          id TEXT PRIMARY KEY,
          channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          author_id TEXT NOT NULL,
          content TEXT NOT NULL,
          raw_message JSONB,
          in_reply_to_root_message_id TEXT REFERENCES ${sql.identifier(tableName)}(id) ON DELETE SET NULL,
          source_type TEXT,
          source_id TEXT,
          metadata JSONB,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
        )
      `);

      // Create indexes for better query performance
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_messages_channel_id ON ${sql.identifier(tableName)} (channel_id)
      `);
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_messages_author_id ON ${sql.identifier(tableName)} (author_id)
      `);
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_messages_created_at ON ${sql.identifier(tableName)} (created_at DESC)
      `);

      logger.success(`[ServerMigrationService] Created/verified ${tableName} table`);
    
  }

  private async createChannelParticipantsTable(): Promise<void> {
    const tableName = 'channel_participants';

    
      logger.info(`[ServerMigrationService] Creating ${tableName} table...`);

      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(tableName)} (
          channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
          user_id TEXT NOT NULL,
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          role TEXT,
          metadata JSONB,
          PRIMARY KEY (channel_id, user_id)
        )
      `);

      // Create indexes for better query performance
      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_channel_participants_user_id ON ${sql.identifier(tableName)} (user_id)
      `);

      logger.success(`[ServerMigrationService] Created/verified ${tableName} table`);
    
  }

  private async createServerAgentsTable(): Promise<void> {
    const tableName = 'server_agents';

    
      logger.info(`[ServerMigrationService] Creating ${tableName} table...`);

      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.identifier(tableName)} (
          server_id UUID NOT NULL REFERENCES message_servers(id) ON DELETE CASCADE,
          agent_id UUID NOT NULL,
          PRIMARY KEY (server_id, agent_id)
        )
      `);

      // Add foreign key constraint to agents table separately
      // This assumes the agents table exists (created by plugin-sql)
      try {
        // First check if the constraint already exists
        const constraintExists = await this.db.execute(sql`
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_name = 'fk_server_agents_agent_id' 
          AND table_name = ${tableName}
          LIMIT 1
        `);

        if (constraintExists.rows.length === 0) {
          await this.db.execute(sql`
            ALTER TABLE ${sql.identifier(tableName)} 
            ADD CONSTRAINT fk_server_agents_agent_id 
            FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
          `);
          logger.debug('[ServerMigrationService] Added foreign key constraint for agent_id');
        } else {
          logger.debug(
            '[ServerMigrationService] Foreign key constraint for agent_id already exists'
          );
        }
      } catch (_fkError) {
        logger.warn(
          '[ServerMigrationService] Could not add foreign key for agent_id (agents table may not exist yet)'
        );
      }

      logger.success(`[ServerMigrationService] Created/verified ${tableName} table`);
    
  }

  private async tableExists(tableName: string): Promise<boolean> {
    try {
      const result = await this.db.execute(sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ${tableName}
        )
      `);
      return result.rows[0]?.exists || false;
    } catch (error) {
      logger.error(`[ServerMigrationService] Error checking if table ${tableName} exists:`, error);
      return false;
    }
  }
}
