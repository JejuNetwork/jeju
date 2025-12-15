-- Jeju Test Database Initialization
-- Creates all required databases for services

CREATE DATABASE jeju_indexer;
CREATE DATABASE jeju_oracle;
CREATE DATABASE jeju_storage;
CREATE DATABASE jeju_auth;

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE jeju_indexer TO jeju;
GRANT ALL PRIVILEGES ON DATABASE jeju_oracle TO jeju;
GRANT ALL PRIVILEGES ON DATABASE jeju_storage TO jeju;
GRANT ALL PRIVILEGES ON DATABASE jeju_auth TO jeju;

