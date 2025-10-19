import type { IAgentRuntime, UUID } from '@elizaos/core';
import { logger } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../server';

interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
}

export function createDatabaseRouter(
  agents: Map<UUID, IAgentRuntime>,
  _serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Get first available agent runtime for database access
  const getRuntime = (): IAgentRuntime => {
    const firstAgent = Array.from(agents.values())[0]!;
    return firstAgent;
  };

  // GET /api/database/tables - List all database tables with metadata
  router.get('/tables', async (req, res) => {
    try {
      const runtime = getRuntime();
      const db = runtime.db;
      const tablesQuery: string = `
        SELECT table_name as name, table_schema as schema 
        FROM information_schema.tables 
        WHERE table_schema NOT IN ('information_schema', 'pg_catalog') 
        ORDER BY table_name
      `;

      const tables = await db.all(tablesQuery);

      // Get row counts for each table
      const tablesWithCounts = await Promise.all(
        tables.map(async (table: any) => {
          const countResult = await db.get(`SELECT COUNT(*) as count FROM "${table.name}"`);
          return {
            name: table.name,
            schema: table.schema || 'main',
            rowCount: countResult!.count,
            createSql: table.create_sql || null,
          };
        })
      );

      res.json({
        success: true,
        data: {
          tables: tablesWithCounts,
          databaseType: 'postgres',
        },
      });
    } catch (error: any) {
      logger.error('Error fetching database tables:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: error.message },
      });
    }
  });

  // GET /api/database/tables/:tableName - Get table data with pagination and search
  router.get('/tables/:tableName', async (req, res) => {
    try {
      const runtime = getRuntime();
      const db = runtime.db;
      const { tableName } = req.params;
      const page = parseInt(req.query.page as string, 10) || 1;
      const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100); // Max 100 rows
      const search = (req.query.search as string) || '';
      const orderBy = (req.query.orderBy as string) || '';
      const orderDir = (req.query.orderDir as string)?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';

      // Validate table name exists
      const tableExists = await db.get(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
        [tableName]
      );

      if (!tableExists) {
        return res.status(404).json({
          success: false,
          error: { code: 'TABLE_NOT_FOUND', message: `Table '${tableName}' not found` },
        });
      }

      // Get table schema
      const isPostgres = db.constructor.name.toLowerCase().includes('postgres');
      let columns: ColumnInfo[];

      if (isPostgres) {
        const columnsResult = await db.all(
          `
          SELECT 
            column_name as name,
            data_type as type,
            is_nullable = 'YES' as nullable,
            column_default as default_value,
            CASE WHEN tc.constraint_type = 'PRIMARY KEY' THEN true ELSE false END as "primaryKey"
          FROM information_schema.columns c
          LEFT JOIN information_schema.table_constraints tc ON tc.table_name = c.table_name 
            AND tc.constraint_type = 'PRIMARY KEY'
          LEFT JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
            AND kcu.column_name = c.column_name
          WHERE c.table_name = $1
          ORDER BY c.ordinal_position
        `,
          [tableName]
        );

        columns = columnsResult.map((col: any) => ({
          name: col.name,
          type: col.type,
          nullable: col.nullable,
          primaryKey: col.primaryKey || false,
          defaultValue: col.default_value,
        }));
      } else {
        // SQLite/PGLite
        const columnsResult = await db.all(`PRAGMA table_info("${tableName}")`);
        columns = columnsResult.map((col: any) => ({
          name: col.name,
          type: col.type,
          nullable: col.notnull === 0,
          primaryKey: col.pk === 1,
          defaultValue: col.dflt_value,
        }));
      }

      // Build data query with search and pagination
      let dataQuery = `SELECT * FROM "${tableName}"`;
      const queryParams: any[] = [];

      // Add search conditions
      if (search && search.trim()) {
        const searchConditions = columns
          .filter(
            (col) =>
              col.type.toLowerCase().includes('text') ||
              col.type.toLowerCase().includes('varchar') ||
              col.type.toLowerCase().includes('char')
          )
          .map((col) => `"${col.name}" LIKE ?`)
          .join(' OR ');

        if (searchConditions) {
          dataQuery += ` WHERE ${searchConditions}`;
          columns
            .filter(
              (col) =>
                col.type.toLowerCase().includes('text') ||
                col.type.toLowerCase().includes('varchar') ||
                col.type.toLowerCase().includes('char')
            )
            .forEach(() => queryParams.push(`%${search}%`));
        }
      }

      // Add sorting
      if (orderBy && columns.some((col) => col.name === orderBy)) {
        dataQuery += ` ORDER BY "${orderBy}" ${orderDir}`;
      }

      // Get total count for pagination
      let countQuery = `SELECT COUNT(*) as total FROM "${tableName}"`;
      if (search && search.trim()) {
        const searchConditions = columns
          .filter(
            (col) =>
              col.type.toLowerCase().includes('text') ||
              col.type.toLowerCase().includes('varchar') ||
              col.type.toLowerCase().includes('char')
          )
          .map((col) => `"${col.name}" LIKE ?`)
          .join(' OR ');

        if (searchConditions) {
          countQuery += ` WHERE ${searchConditions}`;
        }
      }

      const totalResult = await db.get(countQuery, search ? queryParams : []);
      const total = totalResult?.total || 0;

      // Add pagination to data query
      const offset = (page - 1) * limit;
      dataQuery += ` LIMIT ${limit} OFFSET ${offset}`;

      // Execute data query
      const data = await db.all(dataQuery, queryParams);

      res.json({
        success: true,
        data: {
          table: tableName,
          columns,
          data,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNext: page * limit < total,
            hasPrev: page > 1,
          },
          filters: {
            search,
            orderBy,
            orderDir,
          },
        },
      });
    } catch (error: any) {
      logger.error(`Error fetching table data for ${req.params.tableName}:`, error);
      res.status(500).json({
        success: false,
        error: { code: 'DATABASE_ERROR', message: error.message },
      });
    }
  });

  // POST /api/database/tables/:tableName - Create new record
  router.post('/tables/:tableName', async (req, res) => {
    try {
      const runtime = getRuntime();
      const db = runtime.db;
      const { tableName } = req.params;
      const recordData = req.body;

      if (!recordData || typeof recordData !== 'object') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_DATA', message: 'Record data is required' },
        });
      }

      // Get table schema to validate fields
      const columns = await db.all(`PRAGMA table_info("${tableName}")`);
      const columnNames = columns.map((col: any) => col.name);

      // Filter valid fields
      const validFields = Object.keys(recordData).filter((key) => columnNames.includes(key));
      const values = validFields.map((key) => recordData[key]);

      if (validFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_VALID_FIELDS', message: 'No valid fields provided' },
        });
      }

      // Build insert query
      const placeholders = validFields.map(() => '?').join(', ');
      const insertQuery = `INSERT INTO "${tableName}" (${validFields.map((f) => `"${f}"`).join(', ')}) VALUES (${placeholders})`;

      const result = await db.run(insertQuery, values);

      res.json({
        success: true,
        data: {
          message: 'Record created successfully',
          insertedId: result.lastID,
          affectedRows: result.changes,
        },
      });
    } catch (error: any) {
      logger.error(`Error creating record in ${req.params.tableName}:`, error);
      res.status(500).json({
        success: false,
        error: { code: 'CREATE_ERROR', message: error.message },
      });
    }
  });

  // PUT /api/database/tables/:tableName/:recordId - Update existing record
  router.put('/tables/:tableName/:recordId', async (req, res) => {
    try {
      const runtime = getRuntime();
      const db = runtime.db;
      const { tableName, recordId } = req.params;
      const updateData = req.body;

      if (!updateData || typeof updateData !== 'object') {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_DATA', message: 'Update data is required' },
        });
      }

      // Get table schema to find primary key and validate fields
      const columns = await db.all(`PRAGMA table_info("${tableName}")`);
      const primaryKeyColumn = columns.find((col: any) => col.pk === 1);

      if (!primaryKeyColumn) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_PRIMARY_KEY', message: 'Table has no primary key for updates' },
        });
      }

      const columnNames = columns.map((col: any) => col.name);
      const validFields = Object.keys(updateData).filter(
        (key) => columnNames.includes(key) && key !== primaryKeyColumn.name
      );

      if (validFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_VALID_FIELDS', message: 'No valid fields to update' },
        });
      }

      // Build update query
      const setClause = validFields.map((field) => `"${field}" = ?`).join(', ');
      const values = validFields.map((key) => updateData[key]);
      values.push(recordId); // Add WHERE condition value

      const updateQuery = `UPDATE "${tableName}" SET ${setClause} WHERE "${primaryKeyColumn.name}" = ?`;

      const result = await db.run(updateQuery, values);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'RECORD_NOT_FOUND', message: 'Record not found' },
        });
      }

      res.json({
        success: true,
        data: {
          message: 'Record updated successfully',
          affectedRows: result.changes,
        },
      });
    } catch (error: any) {
      logger.error(`Error updating record in ${req.params.tableName}:`, error);
      res.status(500).json({
        success: false,
        error: { code: 'UPDATE_ERROR', message: error.message },
      });
    }
  });

  // DELETE /api/database/tables/:tableName/:recordId - Delete record
  router.delete('/tables/:tableName/:recordId', async (req, res) => {
    try {
      const runtime = getRuntime();
      const db = runtime.db;
      const { tableName, recordId } = req.params;

      // Get table schema to find primary key
      const columns = await db.all(`PRAGMA table_info("${tableName}")`);
      const primaryKeyColumn = columns.find((col: any) => col.pk === 1);

      if (!primaryKeyColumn) {
        return res.status(400).json({
          success: false,
          error: { code: 'NO_PRIMARY_KEY', message: 'Table has no primary key for deletes' },
        });
      }

      const deleteQuery = `DELETE FROM "${tableName}" WHERE "${primaryKeyColumn.name}" = ?`;
      const result = await db.run(deleteQuery, [recordId]);

      if (result.changes === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'RECORD_NOT_FOUND', message: 'Record not found' },
        });
      }

      res.json({
        success: true,
        data: {
          message: 'Record deleted successfully',
          affectedRows: result.changes,
        },
      });
    } catch (error: any) {
      logger.error(`Error deleting record from ${req.params.tableName}:`, error);
      res.status(500).json({
        success: false,
        error: { code: 'DELETE_ERROR', message: error.message },
      });
    }
  });

  return router;
}

/**
 * Database router factory function for the main API router
 */
export function databaseRouter(
  agents: Map<UUID, IAgentRuntime>,
  serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Mount database operations
  router.use('/', createDatabaseRouter(agents, serverInstance));

  return router;
}
