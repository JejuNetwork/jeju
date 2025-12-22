/**
 * Migration Helpers Unit Tests
 * 
 * Tests for SQL generation helpers: createTable, addColumn, createIndex, defineMigration.
 * These are non-trivial functions that generate SQL strings with complex options.
 */

import { describe, it, expect } from 'bun:test';
import { defineMigration, createTable, addColumn, createIndex } from './migration.js';

describe('defineMigration', () => {
  it('should create a migration object with all fields', () => {
    const migration = defineMigration(
      1,
      'create_users_table',
      'CREATE TABLE users (id INT PRIMARY KEY)',
      'DROP TABLE users'
    );

    expect(migration.version).toBe(1);
    expect(migration.name).toBe('create_users_table');
    expect(migration.up).toBe('CREATE TABLE users (id INT PRIMARY KEY)');
    expect(migration.down).toBe('DROP TABLE users');
  });

  it('should handle multi-line SQL', () => {
    const migration = defineMigration(
      2,
      'add_indexes',
      `CREATE INDEX idx_users_email ON users (email);
       CREATE INDEX idx_users_name ON users (name);`,
      `DROP INDEX idx_users_email;
       DROP INDEX idx_users_name;`
    );

    expect(migration.up).toContain('idx_users_email');
    expect(migration.up).toContain('idx_users_name');
    expect(migration.down).toContain('DROP INDEX');
  });

  it('should handle empty SQL for reversible migrations', () => {
    const migration = defineMigration(
      3,
      'no_op_migration',
      '-- No-op',
      '-- No-op'
    );

    expect(migration.up).toBe('-- No-op');
    expect(migration.down).toBe('-- No-op');
  });
});

describe('createTable', () => {
  describe('basic column definitions', () => {
    it('should create table with single column', () => {
      const { up, down } = createTable('users', [
        { name: 'id', type: 'INTEGER' },
      ]);

      expect(up).toBe('CREATE TABLE users (\n  id INTEGER\n)');
      expect(down).toBe('DROP TABLE IF EXISTS users');
    });

    it('should create table with multiple columns', () => {
      const { up, down } = createTable('users', [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'TEXT' },
        { name: 'email', type: 'TEXT' },
      ]);

      expect(up).toContain('id INTEGER');
      expect(up).toContain('name TEXT');
      expect(up).toContain('email TEXT');
      expect(down).toBe('DROP TABLE IF EXISTS users');
    });
  });

  describe('primary key', () => {
    it('should add PRIMARY KEY constraint', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'name', type: 'TEXT' },
      ]);

      expect(up).toContain('id INTEGER PRIMARY KEY');
    });

    it('should handle composite types with primary key', () => {
      const { up } = createTable('orders', [
        { name: 'id', type: 'BIGINT', primaryKey: true },
      ]);

      expect(up).toContain('id BIGINT PRIMARY KEY');
    });
  });

  describe('autoincrement', () => {
    it('should add AUTOINCREMENT constraint', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      ]);

      expect(up).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
    });
  });

  describe('not null', () => {
    it('should add NOT NULL constraint', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'email', type: 'TEXT', notNull: true },
      ]);

      expect(up).toContain('email TEXT NOT NULL');
    });

    it('should handle multiple NOT NULL columns', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'email', type: 'TEXT', notNull: true },
        { name: 'name', type: 'TEXT', notNull: true },
        { name: 'bio', type: 'TEXT' }, // nullable
      ]);

      expect(up).toContain('email TEXT NOT NULL');
      expect(up).toContain('name TEXT NOT NULL');
      expect(up).toMatch(/bio TEXT[^N]/); // bio should not have NOT NULL
    });
  });

  describe('unique', () => {
    it('should add UNIQUE constraint', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'email', type: 'TEXT', unique: true },
      ]);

      expect(up).toContain('email TEXT UNIQUE');
    });

    it('should combine UNIQUE with NOT NULL', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'email', type: 'TEXT', notNull: true, unique: true },
      ]);

      expect(up).toContain('email TEXT NOT NULL UNIQUE');
    });
  });

  describe('default values', () => {
    it('should add DEFAULT with string value', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'status', type: 'TEXT', default: "'active'" },
      ]);

      expect(up).toContain("status TEXT DEFAULT 'active'");
    });

    it('should add DEFAULT with numeric value', () => {
      const { up } = createTable('accounts', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'balance', type: 'REAL', default: '0.0' },
      ]);

      expect(up).toContain('balance REAL DEFAULT 0.0');
    });

    it('should add DEFAULT with CURRENT_TIMESTAMP', () => {
      const { up } = createTable('events', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
      ]);

      expect(up).toContain('created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    });

    it('should add DEFAULT with boolean', () => {
      const { up } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'is_active', type: 'BOOLEAN', default: 'TRUE' },
      ]);

      expect(up).toContain('is_active BOOLEAN DEFAULT TRUE');
    });
  });

  describe('foreign key references', () => {
    it('should add foreign key reference', () => {
      const { up } = createTable('posts', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'user_id', type: 'INTEGER', references: { table: 'users', column: 'id' } },
      ]);

      expect(up).toContain('user_id INTEGER REFERENCES users(id)');
    });

    it('should combine foreign key with NOT NULL', () => {
      const { up } = createTable('posts', [
        { name: 'id', type: 'INTEGER', primaryKey: true },
        { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id' } },
      ]);

      expect(up).toContain('user_id INTEGER NOT NULL REFERENCES users(id)');
    });
  });

  describe('complex table definitions', () => {
    it('should create a complete users table', () => {
      const { up, down } = createTable('users', [
        { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
        { name: 'email', type: 'TEXT', notNull: true, unique: true },
        { name: 'name', type: 'TEXT', notNull: true },
        { name: 'bio', type: 'TEXT' },
        { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
        { name: 'is_active', type: 'BOOLEAN', default: 'TRUE' },
      ]);

      expect(up).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
      expect(up).toContain('email TEXT NOT NULL UNIQUE');
      expect(up).toContain('name TEXT NOT NULL');
      expect(up).toContain('bio TEXT');
      expect(up).toContain('created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      expect(up).toContain('is_active BOOLEAN DEFAULT TRUE');
      expect(down).toBe('DROP TABLE IF EXISTS users');
    });

    it('should create a table with all constraint combinations', () => {
      const { up } = createTable('complex_table', [
        { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
        { name: 'required_unique', type: 'TEXT', notNull: true, unique: true },
        { name: 'required_with_default', type: 'TEXT', notNull: true, default: "'default_value'" },
        { name: 'optional_with_default', type: 'INTEGER', default: '0' },
        { name: 'fk_required', type: 'INTEGER', notNull: true, references: { table: 'other', column: 'id' } },
      ]);

      expect(up).toContain('id INTEGER PRIMARY KEY AUTOINCREMENT');
      expect(up).toContain('required_unique TEXT NOT NULL UNIQUE');
      expect(up).toContain("required_with_default TEXT NOT NULL DEFAULT 'default_value'");
      expect(up).toContain('optional_with_default INTEGER DEFAULT 0');
      expect(up).toContain('fk_required INTEGER NOT NULL REFERENCES other(id)');
    });
  });

  describe('sql data types', () => {
    it('should handle all CQL data types', () => {
      const { up } = createTable('all_types', [
        { name: 'int_col', type: 'INTEGER' },
        { name: 'bigint_col', type: 'BIGINT' },
        { name: 'real_col', type: 'REAL' },
        { name: 'text_col', type: 'TEXT' },
        { name: 'blob_col', type: 'BLOB' },
        { name: 'bool_col', type: 'BOOLEAN' },
        { name: 'ts_col', type: 'TIMESTAMP' },
        { name: 'json_col', type: 'JSON' },
      ]);

      expect(up).toContain('int_col INTEGER');
      expect(up).toContain('bigint_col BIGINT');
      expect(up).toContain('real_col REAL');
      expect(up).toContain('text_col TEXT');
      expect(up).toContain('blob_col BLOB');
      expect(up).toContain('bool_col BOOLEAN');
      expect(up).toContain('ts_col TIMESTAMP');
      expect(up).toContain('json_col JSON');
    });
  });
});

describe('addColumn', () => {
  describe('basic column addition', () => {
    it('should generate ALTER TABLE ADD COLUMN', () => {
      const { up, down } = addColumn('users', 'age', 'INTEGER');

      expect(up).toBe('ALTER TABLE users ADD COLUMN age INTEGER');
      expect(down).toBe('ALTER TABLE users DROP COLUMN age');
    });

    it('should handle different data types', () => {
      expect(addColumn('t', 'c', 'TEXT').up).toBe('ALTER TABLE t ADD COLUMN c TEXT');
      expect(addColumn('t', 'c', 'INTEGER').up).toBe('ALTER TABLE t ADD COLUMN c INTEGER');
      expect(addColumn('t', 'c', 'REAL').up).toBe('ALTER TABLE t ADD COLUMN c REAL');
      expect(addColumn('t', 'c', 'BLOB').up).toBe('ALTER TABLE t ADD COLUMN c BLOB');
    });
  });

  describe('with NOT NULL', () => {
    it('should add NOT NULL constraint', () => {
      const { up } = addColumn('users', 'email', 'TEXT', { notNull: true });

      expect(up).toBe('ALTER TABLE users ADD COLUMN email TEXT NOT NULL');
    });
  });

  describe('with DEFAULT', () => {
    it('should add DEFAULT value', () => {
      const { up } = addColumn('users', 'status', 'TEXT', { default: "'active'" });

      expect(up).toBe("ALTER TABLE users ADD COLUMN status TEXT DEFAULT 'active'");
    });

    it('should add DEFAULT with numeric value', () => {
      const { up } = addColumn('accounts', 'balance', 'REAL', { default: '0.0' });

      expect(up).toBe('ALTER TABLE accounts ADD COLUMN balance REAL DEFAULT 0.0');
    });
  });

  describe('with combined options', () => {
    it('should combine NOT NULL and DEFAULT', () => {
      const { up } = addColumn('users', 'role', 'TEXT', { notNull: true, default: "'user'" });

      expect(up).toBe("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
    });
  });
});

describe('createIndex', () => {
  describe('basic indexes', () => {
    it('should create index on single column', () => {
      const { up, down } = createIndex('idx_users_email', 'users', ['email']);

      expect(up).toBe('CREATE INDEX idx_users_email ON users (email)');
      expect(down).toBe('DROP INDEX IF EXISTS idx_users_email');
    });

    it('should create index on multiple columns', () => {
      const { up, down } = createIndex('idx_posts_user_date', 'posts', ['user_id', 'created_at']);

      expect(up).toBe('CREATE INDEX idx_posts_user_date ON posts (user_id, created_at)');
      expect(down).toBe('DROP INDEX IF EXISTS idx_posts_user_date');
    });
  });

  describe('unique indexes', () => {
    it('should create unique index on single column', () => {
      const { up, down } = createIndex('idx_users_email_unique', 'users', ['email'], true);

      expect(up).toBe('CREATE UNIQUE INDEX idx_users_email_unique ON users (email)');
      expect(down).toBe('DROP INDEX IF EXISTS idx_users_email_unique');
    });

    it('should create unique index on multiple columns', () => {
      const { up } = createIndex('idx_unique_combo', 'table', ['col1', 'col2', 'col3'], true);

      expect(up).toBe('CREATE UNIQUE INDEX idx_unique_combo ON table (col1, col2, col3)');
    });
  });

  describe('non-unique indexes', () => {
    it('should create non-unique index when unique is false', () => {
      const { up } = createIndex('idx_normal', 'table', ['col'], false);

      expect(up).toBe('CREATE INDEX idx_normal ON table (col)');
      expect(up).not.toContain('UNIQUE');
    });

    it('should create non-unique index when unique is undefined', () => {
      const { up } = createIndex('idx_normal', 'table', ['col']);

      expect(up).toBe('CREATE INDEX idx_normal ON table (col)');
      expect(up).not.toContain('UNIQUE');
    });
  });

  describe('edge cases', () => {
    it('should handle column names with underscores', () => {
      const { up } = createIndex('idx_test', 'table', ['first_name', 'last_name']);

      expect(up).toBe('CREATE INDEX idx_test ON table (first_name, last_name)');
    });

    it('should handle table names with underscores', () => {
      const { up } = createIndex('idx_test', 'user_accounts', ['email']);

      expect(up).toBe('CREATE INDEX idx_test ON user_accounts (email)');
    });

    it('should handle many columns', () => {
      const columns = ['a', 'b', 'c', 'd', 'e'];
      const { up } = createIndex('idx_many', 'table', columns);

      expect(up).toBe('CREATE INDEX idx_many ON table (a, b, c, d, e)');
    });
  });
});

describe('integration: full migration workflow', () => {
  it('should generate a complete migration set for a blog schema', () => {
    // Migration 1: Create users table
    const userTable = createTable('users', [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'email', type: 'TEXT', notNull: true, unique: true },
      { name: 'password_hash', type: 'TEXT', notNull: true },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ]);
    const m1 = defineMigration(1, 'create_users', userTable.up, userTable.down);

    // Migration 2: Create posts table
    const postTable = createTable('posts', [
      { name: 'id', type: 'INTEGER', primaryKey: true, autoIncrement: true },
      { name: 'user_id', type: 'INTEGER', notNull: true, references: { table: 'users', column: 'id' } },
      { name: 'title', type: 'TEXT', notNull: true },
      { name: 'content', type: 'TEXT' },
      { name: 'published', type: 'BOOLEAN', default: 'FALSE' },
      { name: 'created_at', type: 'TIMESTAMP', default: 'CURRENT_TIMESTAMP' },
    ]);
    const m2 = defineMigration(2, 'create_posts', postTable.up, postTable.down);

    // Migration 3: Add indexes
    const userEmailIndex = createIndex('idx_users_email', 'users', ['email'], true);
    const postUserIndex = createIndex('idx_posts_user_id', 'posts', ['user_id']);
    const m3 = defineMigration(
      3,
      'add_indexes',
      `${userEmailIndex.up}; ${postUserIndex.up}`,
      `${userEmailIndex.down}; ${postUserIndex.down}`
    );

    // Migration 4: Add column
    const addSlug = addColumn('posts', 'slug', 'TEXT', { notNull: true, default: "''" });
    const m4 = defineMigration(4, 'add_slug_to_posts', addSlug.up, addSlug.down);

    // Verify migrations
    expect(m1.version).toBe(1);
    expect(m1.up).toContain('CREATE TABLE users');
    expect(m1.down).toContain('DROP TABLE IF EXISTS users');

    expect(m2.version).toBe(2);
    expect(m2.up).toContain('CREATE TABLE posts');
    expect(m2.up).toContain('REFERENCES users(id)');

    expect(m3.version).toBe(3);
    expect(m3.up).toContain('CREATE UNIQUE INDEX idx_users_email');
    expect(m3.up).toContain('CREATE INDEX idx_posts_user_id');

    expect(m4.version).toBe(4);
    expect(m4.up).toContain('ALTER TABLE posts ADD COLUMN slug');
    expect(m4.down).toContain('DROP COLUMN slug');
  });
});
