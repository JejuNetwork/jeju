-- Initialize ElizaOS Database with pgvector extension
-- This script runs when the PostgreSQL container starts for the first time

-- Create pgvector extension for embeddings
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Ensure we can create ivfflat indexes (requires sufficient data)
-- Note: ivfflat indexes will be created after data insertion

-- Use the default public schema for ElizaOS
-- No need to create a separate schema

-- Set default search path to public
ALTER DATABASE eliza SET search_path TO public;

-- Create user for application if not exists
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'eliza_app') THEN
        CREATE ROLE eliza_app WITH LOGIN PASSWORD 'eliza_app_pass';
    END IF;
END
$$;

-- Grant permissions
GRANT USAGE ON SCHEMA public TO eliza_app;
GRANT CREATE ON SCHEMA public TO eliza_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO eliza_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO eliza_app;

-- Create core tables that ElizaOS expects
SET search_path TO public;

-- Agents table
CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enabled BOOLEAN DEFAULT true NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    name TEXT NOT NULL,
    username TEXT,
    system TEXT DEFAULT '',
    bio JSONB DEFAULT '[]'::jsonb,
    message_examples JSONB DEFAULT '[]'::jsonb NOT NULL,
    post_examples JSONB DEFAULT '[]'::jsonb NOT NULL,
    topics JSONB DEFAULT '[]'::jsonb NOT NULL,
    adjectives JSONB DEFAULT '[]'::jsonb NOT NULL,
    knowledge JSONB DEFAULT '[]'::jsonb NOT NULL,
    plugins JSONB DEFAULT '[]'::jsonb NOT NULL,
    settings JSONB DEFAULT '{}'::jsonb NOT NULL,
    style JSONB DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT name_unique UNIQUE (name)
);

-- Worlds table
CREATE TABLE IF NOT EXISTS worlds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    metadata JSONB,
    server_id TEXT NOT NULL DEFAULT 'local',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Rooms table
CREATE TABLE IF NOT EXISTS rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    type TEXT NOT NULL,
    server_id TEXT,
    world_id UUID,
    name TEXT,
    metadata JSONB,
    channel_id TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Entities table
CREATE TABLE IF NOT EXISTS entities (
    id UUID PRIMARY KEY NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    names TEXT[] DEFAULT '{}'::text[] NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT id_agentId_unique UNIQUE (id, agent_id)
);

-- Memories table (core ElizaOS table)
CREATE TABLE IF NOT EXISTS memories (
    id UUID PRIMARY KEY NOT NULL,
    type TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    content JSONB NOT NULL,
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    world_id UUID,
    "unique" BOOLEAN DEFAULT true NOT NULL,
    metadata JSONB DEFAULT '{}' NOT NULL,
    embedding vector(768)
);

-- Relationships table
CREATE TABLE IF NOT EXISTS relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    source_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    target_entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    tags TEXT[],
    metadata JSONB,
    CONSTRAINT unique_relationship UNIQUE (source_entity_id, target_entity_id, agent_id)
);

-- Participants table
CREATE TABLE IF NOT EXISTS participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    room_state TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Components table
CREATE TABLE IF NOT EXISTS components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    world_id UUID REFERENCES worlds(id) ON DELETE CASCADE,
    source_entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- Cache table
CREATE TABLE IF NOT EXISTS cache (
    key TEXT NOT NULL,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    value JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE,
    PRIMARY KEY (key, agent_id)
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    room_id UUID,
    world_id UUID,
    entity_id UUID,
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    tags TEXT[] DEFAULT '{}'::text[],
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP NOT NULL,
    entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
    body JSONB NOT NULL,
    type TEXT NOT NULL,
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE
);

-- Goals table (for goals plugin)
CREATE TABLE IF NOT EXISTS goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    owner_type TEXT NOT NULL,
    owner_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_completed BOOLEAN DEFAULT false,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    metadata JSONB DEFAULT '{}'
);

-- Goal tags table (for goals plugin)
CREATE TABLE IF NOT EXISTS goal_tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(goal_id, tag)
);

-- Todos table (for todo plugin)
CREATE TABLE IF NOT EXISTS todos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE CASCADE,
    entity_id UUID REFERENCES entities(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) DEFAULT 'pending',
    priority VARCHAR(20) DEFAULT 'medium',
    due_date TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Knowledge documents table (for knowledge plugin)
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    file_path VARCHAR(500),
    mime_type VARCHAR(100),
    file_size INTEGER,
    embedding vector(768),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Message servers table (for messaging system)
CREATE TABLE IF NOT EXISTS message_servers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Channels table (for messaging system)
CREATE TABLE IF NOT EXISTS channels (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id UUID NOT NULL REFERENCES message_servers(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    source_type TEXT,
    source_id TEXT,
    topic TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Central messages table (for messaging system)
CREATE TABLE IF NOT EXISTS central_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL,
    content TEXT NOT NULL,
    raw_message JSONB,
    in_reply_to_root_message_id UUID REFERENCES central_messages(id) ON DELETE SET NULL,
    source_type TEXT,
    source_id TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Channel participants table (for messaging system)
CREATE TABLE IF NOT EXISTS channel_participants (
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    PRIMARY KEY (channel_id, user_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_memories_entity_id ON memories(entity_id);
CREATE INDEX IF NOT EXISTS idx_memories_room_id ON memories(room_id);
CREATE INDEX IF NOT EXISTS idx_memories_world_id ON memories(world_id);
CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_type_room ON memories(type, room_id);
CREATE INDEX IF NOT EXISTS idx_memories_metadata_type ON memories((metadata->>'type'));
CREATE INDEX IF NOT EXISTS idx_memories_document_id ON memories((metadata->>'documentId'));
CREATE INDEX IF NOT EXISTS idx_fragments_order ON memories((metadata->>'documentId'), (metadata->>'position'));
-- Vector indexes (will be created after sufficient data is inserted)
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_embedding ON knowledge_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_entities_agent_id ON entities(agent_id);
CREATE INDEX IF NOT EXISTS idx_entities_names ON entities USING GIN(names);

CREATE INDEX IF NOT EXISTS idx_participants_entity_id ON participants(entity_id);
CREATE INDEX IF NOT EXISTS idx_participants_room_id ON participants(room_id);
CREATE INDEX IF NOT EXISTS idx_participants_agent_id ON participants(agent_id);

CREATE INDEX IF NOT EXISTS idx_relationships_users ON relationships(source_entity_id, target_entity_id);

CREATE INDEX IF NOT EXISTS idx_goals_agent_id ON goals(agent_id);
CREATE INDEX IF NOT EXISTS idx_goals_owner_type ON goals(owner_type);
CREATE INDEX IF NOT EXISTS idx_goals_owner_id ON goals(owner_id);
CREATE INDEX IF NOT EXISTS idx_goals_completed ON goals(is_completed);
CREATE INDEX IF NOT EXISTS idx_goals_created_at ON goals(created_at);

CREATE INDEX IF NOT EXISTS idx_todos_agent_id ON todos(agent_id);
CREATE INDEX IF NOT EXISTS idx_todos_status ON todos(status);
CREATE INDEX IF NOT EXISTS idx_todos_room_id ON todos(room_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_agent_id ON knowledge_documents(agent_id);

-- Indexes for messaging system tables
CREATE INDEX IF NOT EXISTS idx_message_servers_source_type ON message_servers(source_type);
CREATE INDEX IF NOT EXISTS idx_channels_server_id ON channels(server_id);
CREATE INDEX IF NOT EXISTS idx_channels_type ON channels(type);
CREATE INDEX IF NOT EXISTS idx_central_messages_channel_id ON central_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_central_messages_author_id ON central_messages(author_id);
CREATE INDEX IF NOT EXISTS idx_central_messages_created_at ON central_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_channel_participants_user_id ON channel_participants(user_id);

-- Add check constraints for memories table metadata validation
ALTER TABLE memories ADD CONSTRAINT fragment_metadata_check CHECK (
    CASE 
        WHEN metadata->>'type' = 'fragment' THEN
            metadata ? 'documentId' AND 
            metadata ? 'position'
        ELSE true
    END
);

ALTER TABLE memories ADD CONSTRAINT document_metadata_check CHECK (
    CASE 
        WHEN metadata->>'type' = 'document' THEN
            metadata ? 'timestamp'
        ELSE true
    END
);

-- Create triggers for updatedAt timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_entities_updated_at BEFORE UPDATE ON entities FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_rooms_updated_at BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_memories_updated_at BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_relationships_updated_at BEFORE UPDATE ON relationships FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_goals_updated_at BEFORE UPDATE ON goals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_todos_updated_at BEFORE UPDATE ON todos FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_knowledge_updated_at BEFORE UPDATE ON knowledge_documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_message_servers_updated_at BEFORE UPDATE ON message_servers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_channels_updated_at BEFORE UPDATE ON channels FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_central_messages_updated_at BEFORE UPDATE ON central_messages FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default admin user if not exists
INSERT INTO agents (id, name) 
VALUES ('00000000-0000-0000-0000-000000000001', 'SystemAdmin')
ON CONFLICT (id) DO NOTHING;

-- Insert default server agent if not exists  
INSERT INTO agents (id, name)
VALUES ('00000000-0000-0000-0000-000000000002', 'DefaultServerAgent')
ON CONFLICT (id) DO NOTHING;

COMMENT ON DATABASE eliza IS 'ElizaOS Game Database with pgvector for embeddings';
-- All tables are now in the public schema
COMMENT ON TABLE memories IS 'Core memory storage with vector embeddings for semantic search';
COMMENT ON TABLE entities IS 'Entities (users, agents, concepts) that can participate in conversations';
COMMENT ON TABLE goals IS 'Agent goals and objectives tracking';
COMMENT ON TABLE todos IS 'Task management for agents';
COMMENT ON TABLE knowledge_documents IS 'Document storage and retrieval system';