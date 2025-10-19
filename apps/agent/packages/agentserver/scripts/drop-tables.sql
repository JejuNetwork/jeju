-- Drop tables in correct order to avoid foreign key constraints
DROP TABLE IF EXISTS server_agents CASCADE;
DROP TABLE IF EXISTS channel_participants CASCADE;
DROP TABLE IF EXISTS central_messages CASCADE;
DROP TABLE IF EXISTS channels CASCADE;
DROP TABLE IF EXISTS message_servers CASCADE;

-- Also drop plugin-sql tables that might conflict
DROP TABLE IF EXISTS world CASCADE;
DROP TABLE IF EXISTS room CASCADE;

-- Optional: List remaining tables to verify
-- \dt 