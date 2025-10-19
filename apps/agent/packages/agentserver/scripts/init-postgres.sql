-- Grant superuser privileges to the eliza user
ALTER USER eliza WITH SUPERUSER;

-- Create the vector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create the eliza database if it doesn't exist
SELECT 'CREATE DATABASE eliza' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'eliza')\gexec

-- Switch to eliza database
\c eliza;

-- Ensure vector extension is available in eliza database
CREATE EXTENSION IF NOT EXISTS vector; 