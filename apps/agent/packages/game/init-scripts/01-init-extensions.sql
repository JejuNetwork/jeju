-- ELIZA Game Database Initialization
-- This script runs when PostgreSQL container starts for the first time

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create indexes for performance
-- These will be created by the application, but we can prepare the groundwork

\echo 'ELIZA database extensions initialized successfully';