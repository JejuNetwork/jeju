-- Create vector indexes after data population
-- This script creates ivfflat indexes for vector similarity search
-- It should be run after some vector data exists in the tables

-- Function to safely create vector indexes
CREATE OR REPLACE FUNCTION create_vector_indexes_if_needed() RETURNS void AS $$
DECLARE
    memory_count INTEGER;
    knowledge_count INTEGER;
    memory_lists INTEGER;
    knowledge_lists INTEGER;
    sql_stmt TEXT;
BEGIN
    -- Check if we have enough data for efficient indexing
    SELECT COUNT(*) INTO memory_count FROM memories WHERE embedding IS NOT NULL;
    SELECT COUNT(*) INTO knowledge_count FROM knowledge_documents WHERE embedding IS NOT NULL;
    
    -- Create memories embedding index if we have data
    IF memory_count > 100 THEN
        BEGIN
            -- Calculate optimal list count for memories
            memory_lists := GREATEST(memory_count / 100, 10);
            
            -- Build and execute dynamic SQL for memories index
            sql_stmt := format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = %s)', memory_lists);
            EXECUTE sql_stmt;
            
            RAISE NOTICE 'Created memories embedding index with % vectors and % lists', memory_count, memory_lists;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Could not create memories embedding index: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'Skipping memories embedding index creation - only % vectors found (need 100+)', memory_count;
    END IF;
    
    -- Create knowledge documents embedding index if we have data
    IF knowledge_count > 100 THEN
        BEGIN
            -- Calculate optimal list count for knowledge
            knowledge_lists := GREATEST(knowledge_count / 100, 10);
            
            -- Build and execute dynamic SQL for knowledge index
            sql_stmt := format('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_knowledge_embedding ON knowledge_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = %s)', knowledge_lists);
            EXECUTE sql_stmt;
            
            RAISE NOTICE 'Created knowledge embedding index with % vectors and % lists', knowledge_count, knowledge_lists;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE NOTICE 'Could not create knowledge embedding index: %', SQLERRM;
        END;
    ELSE
        RAISE NOTICE 'Skipping knowledge embedding index creation - only % vectors found (need 100+)', knowledge_count;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Note: This function can be called later when the agent has inserted vector data
-- SELECT create_vector_indexes_if_needed();