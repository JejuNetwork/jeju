/**
 * TypeORM Driver for CovenantSQL
 * 
 * Provides TypeORM compatibility for the indexer and other apps
 * that use TypeORM for ORM operations.
 */

import type { CovenantSQLClient, ConsistencyLevel, QueryResult } from './covenant-sql';

// ============================================================================
// Types
// ============================================================================

export interface TypeORMDriverConfig {
  client: CovenantSQLClient;
  defaultConsistency: ConsistencyLevel;
  logging: boolean;
}

export interface EntityMetadata {
  tableName: string;
  columns: Map<string, ColumnMetadata>;
  primaryKeys: string[];
  relations: Map<string, RelationMetadata>;
}

export interface ColumnMetadata {
  name: string;
  propertyName: string;
  type: string;
  nullable: boolean;
  primary: boolean;
  unique: boolean;
  default?: unknown;
}

export interface RelationMetadata {
  propertyName: string;
  target: string;
  type: 'one-to-one' | 'one-to-many' | 'many-to-one' | 'many-to-many';
  joinColumn?: string;
}

// ============================================================================
// Query Builder (TypeORM-compatible API)
// ============================================================================

export class CovenantQueryBuilder<T = Record<string, unknown>> {
  private client: CovenantSQLClient;
  private tableName: string;
  private selectCols: string[] = ['*'];
  private whereClauses: string[] = [];
  private whereParams: unknown[] = [];
  private orderByClauses: string[] = [];
  private limitValue?: number;
  private offsetValue?: number;
  private joinClauses: string[] = [];
  private groupByClauses: string[] = [];
  private havingClauses: string[] = [];
  private consistency: ConsistencyLevel = 'eventual';

  constructor(client: CovenantSQLClient, tableName: string) {
    this.client = client;
    this.tableName = tableName;
  }

  select(columns: string | string[]): this {
    this.selectCols = Array.isArray(columns) ? columns : [columns];
    return this;
  }

  where(condition: string, params?: unknown[]): this {
    this.whereClauses.push(condition);
    if (params) {
      this.whereParams.push(...params);
    }
    return this;
  }

  andWhere(condition: string, params?: unknown[]): this {
    return this.where(condition, params);
  }

  orWhere(condition: string, params?: unknown[]): this {
    if (this.whereClauses.length > 0) {
      const lastClause = this.whereClauses.pop();
      this.whereClauses.push(`(${lastClause}) OR (${condition})`);
    } else {
      this.whereClauses.push(condition);
    }
    if (params) {
      this.whereParams.push(...params);
    }
    return this;
  }

  orderBy(column: string, order: 'ASC' | 'DESC' = 'ASC'): this {
    this.orderByClauses.push(`${column} ${order}`);
    return this;
  }

  addOrderBy(column: string, order: 'ASC' | 'DESC' = 'ASC'): this {
    return this.orderBy(column, order);
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  offset(count: number): this {
    this.offsetValue = count;
    return this;
  }

  skip(count: number): this {
    return this.offset(count);
  }

  take(count: number): this {
    return this.limit(count);
  }

  leftJoin(table: string, alias: string, condition: string): this {
    this.joinClauses.push(`LEFT JOIN ${table} ${alias} ON ${condition}`);
    return this;
  }

  innerJoin(table: string, alias: string, condition: string): this {
    this.joinClauses.push(`INNER JOIN ${table} ${alias} ON ${condition}`);
    return this;
  }

  groupBy(column: string): this {
    this.groupByClauses.push(column);
    return this;
  }

  having(condition: string, params?: unknown[]): this {
    this.havingClauses.push(condition);
    if (params) {
      this.whereParams.push(...params);
    }
    return this;
  }

  withConsistency(level: ConsistencyLevel): this {
    this.consistency = level;
    return this;
  }

  private buildQuery(): { sql: string; params: unknown[] } {
    let sql = `SELECT ${this.selectCols.join(', ')} FROM ${this.tableName}`;

    if (this.joinClauses.length > 0) {
      sql += ' ' + this.joinClauses.join(' ');
    }

    if (this.whereClauses.length > 0) {
      sql += ` WHERE ${this.whereClauses.join(' AND ')}`;
    }

    if (this.groupByClauses.length > 0) {
      sql += ` GROUP BY ${this.groupByClauses.join(', ')}`;
    }

    if (this.havingClauses.length > 0) {
      sql += ` HAVING ${this.havingClauses.join(' AND ')}`;
    }

    if (this.orderByClauses.length > 0) {
      sql += ` ORDER BY ${this.orderByClauses.join(', ')}`;
    }

    if (this.limitValue !== undefined) {
      sql += ` LIMIT ${this.limitValue}`;
    }

    if (this.offsetValue !== undefined) {
      sql += ` OFFSET ${this.offsetValue}`;
    }

    return { sql, params: this.whereParams };
  }

  async getMany(): Promise<T[]> {
    const { sql, params } = this.buildQuery();
    const result = await this.client.query<T>(sql, params, { consistency: this.consistency });
    return result.rows;
  }

  async getOne(): Promise<T | null> {
    this.limitValue = 1;
    const results = await this.getMany();
    return results[0] ?? null;
  }

  async getCount(): Promise<number> {
    const originalSelect = this.selectCols;
    this.selectCols = ['COUNT(*) as count'];
    const { sql, params } = this.buildQuery();
    this.selectCols = originalSelect;

    const result = await this.client.query<{ count: number }>(sql, params, { consistency: this.consistency });
    return result.rows[0]?.count ?? 0;
  }

  async getRawMany<R = Record<string, unknown>>(): Promise<R[]> {
    const { sql, params } = this.buildQuery();
    const result = await this.client.query<R>(sql, params, { consistency: this.consistency });
    return result.rows;
  }

  async getRawOne<R = Record<string, unknown>>(): Promise<R | null> {
    this.limitValue = 1;
    const results = await this.getRawMany<R>();
    return results[0] ?? null;
  }

  getSql(): string {
    return this.buildQuery().sql;
  }
}

// ============================================================================
// Repository (TypeORM-compatible API)
// ============================================================================

export class CovenantRepository<T extends Record<string, unknown>> {
  private client: CovenantSQLClient;
  private tableName: string;
  private metadata: EntityMetadata;

  constructor(client: CovenantSQLClient, tableName: string, metadata?: EntityMetadata) {
    this.client = client;
    this.tableName = tableName;
    this.metadata = metadata ?? {
      tableName,
      columns: new Map(),
      primaryKeys: ['id'],
      relations: new Map(),
    };
  }

  createQueryBuilder(alias?: string): CovenantQueryBuilder<T> {
    const qb = new CovenantQueryBuilder<T>(this.client, this.tableName);
    if (alias) {
      // Alias is handled in the builder
    }
    return qb;
  }

  async find(options: {
    where?: Partial<T>;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
    skip?: number;
  } = {}): Promise<T[]> {
    const qb = this.createQueryBuilder();

    if (options.where) {
      const entries = Object.entries(options.where);
      entries.forEach(([key, value], i) => {
        qb.where(`${key} = $${i + 1}`, [value]);
      });
    }

    if (options.order) {
      Object.entries(options.order).forEach(([key, dir]) => {
        qb.orderBy(key, dir);
      });
    }

    if (options.take) qb.take(options.take);
    if (options.skip) qb.skip(options.skip);

    return qb.getMany();
  }

  async findOne(options: { where: Partial<T> }): Promise<T | null> {
    const results = await this.find({ ...options, take: 1 });
    return results[0] ?? null;
  }

  async findOneBy(where: Partial<T>): Promise<T | null> {
    return this.findOne({ where });
  }

  async findBy(where: Partial<T>): Promise<T[]> {
    return this.find({ where });
  }

  async findById(id: string | number): Promise<T | null> {
    const pk = this.metadata.primaryKeys[0] ?? 'id';
    return this.findOne({ where: { [pk]: id } as Partial<T> });
  }

  async count(where?: Partial<T>): Promise<number> {
    const qb = this.createQueryBuilder();
    
    if (where) {
      const entries = Object.entries(where);
      entries.forEach(([key, value], i) => {
        qb.where(`${key} = $${i + 1}`, [value]);
      });
    }

    return qb.getCount();
  }

  async save(entity: T | T[]): Promise<T | T[]> {
    const entities = Array.isArray(entity) ? entity : [entity];
    
    for (const e of entities) {
      const pk = this.metadata.primaryKeys[0] ?? 'id';
      const id = e[pk];

      if (id && await this.findById(id as string | number)) {
        // Update existing
        const { [pk]: _, ...data } = e;
        await this.client.update(
          this.tableName,
          data,
          `${pk} = $${Object.keys(data).length + 1}`,
          [id]
        );
      } else {
        // Insert new
        await this.client.insert(this.tableName, e);
      }
    }

    return entity;
  }

  async insert(entity: T | T[]): Promise<QueryResult<T>> {
    return this.client.insert(this.tableName, entity as Record<string, unknown> | Record<string, unknown>[]);
  }

  async update(
    criteria: Partial<T>,
    partialEntity: Partial<T>
  ): Promise<QueryResult<T>> {
    const whereEntries = Object.entries(criteria);
    const whereCondition = whereEntries
      .map(([key], i) => `${key} = $${Object.keys(partialEntity).length + i + 1}`)
      .join(' AND ');
    const whereParams = whereEntries.map(([, value]) => value);

    return this.client.update(
      this.tableName,
      partialEntity,
      whereCondition,
      whereParams
    );
  }

  async delete(criteria: Partial<T>): Promise<QueryResult> {
    const entries = Object.entries(criteria);
    const whereCondition = entries.map(([key], i) => `${key} = $${i + 1}`).join(' AND ');
    const whereParams = entries.map(([, value]) => value);

    return this.client.delete(this.tableName, whereCondition, whereParams);
  }

  async softDelete(criteria: Partial<T>): Promise<QueryResult<T>> {
    return this.update(criteria, { deleted_at: new Date().toISOString() } as Partial<T>);
  }

  async restore(criteria: Partial<T>): Promise<QueryResult<T>> {
    return this.update(criteria, { deleted_at: null } as Partial<T>);
  }

  async exists(where: Partial<T>): Promise<boolean> {
    const count = await this.count(where);
    return count > 0;
  }

  async clear(): Promise<void> {
    await this.client.query(`DELETE FROM ${this.tableName}`);
  }

  async query(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.client.query<T>(sql, params);
    return result.rows;
  }
}

// ============================================================================
// Entity Manager (TypeORM-compatible API)
// ============================================================================

export class CovenantEntityManager {
  private client: CovenantSQLClient;
  private repositories: Map<string, CovenantRepository<Record<string, unknown>>> = new Map();

  constructor(client: CovenantSQLClient) {
    this.client = client;
  }

  getRepository<T extends Record<string, unknown>>(
    entityOrTableName: string | { name: string }
  ): CovenantRepository<T> {
    const tableName = typeof entityOrTableName === 'string' 
      ? entityOrTableName 
      : entityOrTableName.name;

    if (!this.repositories.has(tableName)) {
      this.repositories.set(tableName, new CovenantRepository(this.client, tableName));
    }

    return this.repositories.get(tableName) as CovenantRepository<T>;
  }

  async transaction<R>(
    runInTransaction: (manager: CovenantEntityManager) => Promise<R>
  ): Promise<R> {
    const tx = await this.client.beginTransaction('strong');
    
    try {
      const result = await runInTransaction(this);
      await tx.commit();
      return result;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.client.query<T>(sql, params);
    return result.rows;
  }

  createQueryBuilder<T = Record<string, unknown>>(tableName: string): CovenantQueryBuilder<T> {
    return new CovenantQueryBuilder<T>(this.client, tableName);
  }
}

// ============================================================================
// DataSource (TypeORM-compatible API)
// ============================================================================

export interface CovenantDataSourceOptions {
  client: CovenantSQLClient;
  entities?: Array<{ name: string }>;
  synchronize?: boolean;
  logging?: boolean;
}

export class CovenantDataSource {
  private client: CovenantSQLClient;
  private manager: CovenantEntityManager;
  private options: CovenantDataSourceOptions;
  private _isInitialized = false;

  constructor(options: CovenantDataSourceOptions) {
    this.options = options;
    this.client = options.client;
    this.manager = new CovenantEntityManager(this.client);
  }

  get isInitialized(): boolean {
    return this._isInitialized;
  }

  async initialize(): Promise<this> {
    if (this._isInitialized) return this;

    await this.client.initialize();
    this._isInitialized = true;

    return this;
  }

  async destroy(): Promise<void> {
    await this.client.close();
    this._isInitialized = false;
  }

  getRepository<T extends Record<string, unknown>>(
    entityOrTableName: string | { name: string }
  ): CovenantRepository<T> {
    return this.manager.getRepository<T>(entityOrTableName);
  }

  createQueryRunner(): CovenantQueryRunner {
    return new CovenantQueryRunner(this.client);
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.manager.query<T>(sql, params);
  }

  async transaction<R>(
    runInTransaction: (manager: CovenantEntityManager) => Promise<R>
  ): Promise<R> {
    return this.manager.transaction(runInTransaction);
  }
}

// ============================================================================
// Query Runner (TypeORM-compatible API)
// ============================================================================

export class CovenantQueryRunner {
  private client: CovenantSQLClient;
  private inTransaction = false;

  constructor(client: CovenantSQLClient) {
    this.client = client;
  }

  async connect(): Promise<void> {
    await this.client.initialize();
  }

  async release(): Promise<void> {
    // Connection pooling handles this
  }

  async startTransaction(): Promise<void> {
    await this.client.query('BEGIN TRANSACTION');
    this.inTransaction = true;
  }

  async commitTransaction(): Promise<void> {
    await this.client.query('COMMIT');
    this.inTransaction = false;
  }

  async rollbackTransaction(): Promise<void> {
    await this.client.query('ROLLBACK');
    this.inTransaction = false;
  }

  async query(sql: string, params?: unknown[]): Promise<unknown> {
    const result = await this.client.query(sql, params);
    return result.rows;
  }

  get isTransactionActive(): boolean {
    return this.inTransaction;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a TypeORM-compatible data source backed by CovenantSQL
 */
export function createCovenantDataSource(
  client: CovenantSQLClient,
  options: Partial<CovenantDataSourceOptions> = {}
): CovenantDataSource {
  return new CovenantDataSource({
    client,
    ...options,
  });
}

