/**
 * Database Test Helpers
 *
 * Utilities for testing database viewer functionality
 */

export interface AuthTokenResponse {
  success: boolean;
  data: {
    token: string;
    user: {
      id: string;
      username: string;
      roles: string[];
      permissions: string[];
    };
  };
}

export interface DatabaseTable {
  name: string;
  schema: string;
  rowCount: number;
  createSql?: string;
}

export interface TableColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  primaryKey?: boolean;
}

export interface TableData {
  table: string;
  columns: TableColumn[];
  data: any[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
  filters: {
    search: string;
    orderBy: string;
    orderDir: 'ASC' | 'DESC';
  };
}

export class DatabaseTestHelper {
  private backendUrl: string;
  private authToken: string | null = null;

  constructor(backendUrl: string = 'http://localhost:7777') {
    this.backendUrl = backendUrl;
  }

  /**
   * Authenticate and get auth token
   */
  authenticate(
    username: string = 'admin',
    password: string = 'password123'
  ): Cypress.Chainable<string> {
    return cy
      .request({
        method: 'POST',
        url: `${this.backendUrl}/api/auth/login`,
        body: { username, password },
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        this.authToken = response.body.data.token;
        return this.authToken;
      });
  }

  /**
   * Get list of database tables
   */
  getTables(): Cypress.Chainable<DatabaseTable[]> {
    return cy
      .request({
        method: 'GET',
        url: `${this.backendUrl}/api/database/tables`,
        headers: this.getAuthHeaders(),
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data.tables;
      });
  }

  /**
   * Get table data with optional parameters
   */
  getTableData(
    tableName: string,
    options: {
      page?: number;
      limit?: number;
      search?: string;
      orderBy?: string;
      orderDir?: 'ASC' | 'DESC';
    } = {}
  ): Cypress.Chainable<TableData> {
    const params = new URLSearchParams();
    if (options.page) {
      params.append('page', options.page.toString());
    }
    if (options.limit) {
      params.append('limit', options.limit.toString());
    }
    if (options.search) {
      params.append('search', options.search);
    }
    if (options.orderBy) {
      params.append('orderBy', options.orderBy);
    }
    if (options.orderDir) {
      params.append('orderDir', options.orderDir);
    }

    const url = `${this.backendUrl}/api/database/tables/${tableName}${params.toString() ? `?${params.toString()}` : ''}`;

    return cy
      .request({
        method: 'GET',
        url,
        headers: this.getAuthHeaders(),
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data;
      });
  }

  /**
   * Get specific record by ID
   */
  getRecord(tableName: string, recordId: string): Cypress.Chainable<any> {
    return cy
      .request({
        method: 'GET',
        url: `${this.backendUrl}/api/database/tables/${tableName}/${recordId}`,
        headers: this.getAuthHeaders(),
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data.record;
      });
  }

  /**
   * Create a new record
   */
  createRecord(tableName: string, recordData: Record<string, any>): Cypress.Chainable<any> {
    return cy
      .request({
        method: 'POST',
        url: `${this.backendUrl}/api/database/tables/${tableName}`,
        headers: this.getAuthHeaders(),
        body: recordData,
      })
      .then((response) => {
        expect(response.status).to.eq(201);
        expect(response.body.success).to.be.true;
        return response.body.data.record;
      });
  }

  /**
   * Update an existing record
   */
  updateRecord(
    tableName: string,
    recordId: string,
    updateData: Record<string, any>
  ): Cypress.Chainable<any> {
    return cy
      .request({
        method: 'PUT',
        url: `${this.backendUrl}/api/database/tables/${tableName}/${recordId}`,
        headers: this.getAuthHeaders(),
        body: updateData,
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data.record;
      });
  }

  /**
   * Delete a record
   */
  deleteRecord(tableName: string, recordId: string): Cypress.Chainable<any> {
    return cy
      .request({
        method: 'DELETE',
        url: `${this.backendUrl}/api/database/tables/${tableName}/${recordId}`,
        headers: this.getAuthHeaders(),
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data.deletedRecord;
      });
  }

  /**
   * Create a test memory record
   */
  createTestMemory(customData: Partial<any> = {}): Cypress.Chainable<any> {
    const defaultMemory = {
      entityId: `test-entity-${Date.now()}`,
      roomId: `test-room-${Date.now()}`,
      content: JSON.stringify({ text: `Test memory content ${Date.now()}` }),
      createdAt: Date.now(),
      ...customData,
    };

    return this.createRecord('memories', defaultMemory);
  }

  /**
   * Create a test agent record
   */
  createTestAgent(customData: Partial<any> = {}): Cypress.Chainable<any> {
    const defaultAgent = {
      name: `Test Agent ${Date.now()}`,
      agentId: `test-agent-${Date.now()}`,
      ...customData,
    };

    return this.createRecord('agents', defaultAgent);
  }

  /**
   * Cleanup test records by pattern
   */
  cleanupTestRecords(tableName: string, searchPattern: string = 'test-'): Cypress.Chainable<void> {
    return this.getTableData(tableName, { search: searchPattern, limit: 100 }).then((tableData) => {
      const deletePromises = tableData.data
        .filter((record) => {
          // Check if any field contains the search pattern
          return Object.values(record).some(
            (value) => typeof value === 'string' && value.includes(searchPattern)
          );
        })
        .map((record) => {
          const primaryKey = tableData.columns.find((col) => col.primaryKey)?.name || 'id';
          return this.deleteRecord(tableName, record[primaryKey]);
        });

      return cy.wrap(Promise.all(deletePromises));
    });
  }

  /**
   * Wait for table to have specific row count
   */
  waitForTableRowCount(
    tableName: string,
    expectedCount: number,
    timeout: number = 10000
  ): Cypress.Chainable<void> {
    const startTime = Date.now();

    const checkRowCount = (): Cypress.Chainable<void> => {
      return this.getTables().then((tables) => {
        const table = tables.find((t) => t.name === tableName);
        if (table && table.rowCount === expectedCount) {
          return;
        }

        if (Date.now() - startTime > timeout) {
          throw new Error(`Timeout waiting for table ${tableName} to have ${expectedCount} rows`);
        }

        cy.wait(500);
        return checkRowCount();
      });
    };

    return checkRowCount();
  }

  /**
   * Verify record exists in table
   */
  verifyRecordExists(
    tableName: string,
    searchCriteria: Record<string, any>
  ): Cypress.Chainable<boolean> {
    return this.getTableData(tableName, { limit: 100 }).then((tableData) => {
      const recordExists = tableData.data.some((record) => {
        return Object.entries(searchCriteria).every(([key, value]) => {
          return record[key] === value;
        });
      });

      return recordExists;
    });
  }

  /**
   * Get auth headers for requests
   */
  private getAuthHeaders(): Record<string, string> {
    if (!this.authToken) {
      throw new Error('Not authenticated. Call authenticate() first.');
    }

    return {
      Authorization: `Bearer ${this.authToken}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Generate test data for different table types
   */
  generateTestData(tableName: string): Record<string, any> {
    switch (tableName) {
      case 'memories':
        return {
          entityId: `test-entity-${Date.now()}`,
          roomId: `test-room-${Date.now()}`,
          content: JSON.stringify({
            text: `Test memory content ${Date.now()}`,
            metadata: { test: true },
          }),
          createdAt: Date.now(),
        };

      case 'agents':
        return {
          name: `Test Agent ${Date.now()}`,
          agentId: `test-agent-${Date.now()}`,
        };

      case 'entities':
        return {
          names: JSON.stringify([`Test Entity ${Date.now()}`]),
          agentId: `test-agent-${Date.now()}`,
        };

      case 'rooms':
        return {
          name: `Test Room ${Date.now()}`,
          source: 'test',
          type: 'GROUP',
        };

      case 'goals':
        return {
          name: `Test Goal ${Date.now()}`,
          description: `Test goal description ${Date.now()}`,
          status: 'PENDING',
          agentId: `test-agent-${Date.now()}`,
        };

      case 'todos':
        return {
          title: `Test Todo ${Date.now()}`,
          description: `Test todo description ${Date.now()}`,
          completed: false,
          agentId: `test-agent-${Date.now()}`,
        };

      default:
        return {
          name: `Test Record ${Date.now()}`,
          value: `test-value-${Date.now()}`,
        };
    }
  }
}

// Cypress commands for database testing
declare global {
  namespace Cypress {
    interface Chainable {
      authenticateDb(username?: string, password?: string): Chainable<string>;
      getDbTables(): Chainable<DatabaseTable[]>;
      getDbTableData(tableName: string, options?: any): Chainable<TableData>;
      createDbRecord(tableName: string, recordData: Record<string, any>): Chainable<any>;
      updateDbRecord(
        tableName: string,
        recordId: string,
        updateData: Record<string, any>
      ): Chainable<any>;
      deleteDbRecord(tableName: string, recordId: string): Chainable<any>;
      cleanupDbTestRecords(tableName: string, searchPattern?: string): Chainable<void>;
      verifyDbRecordExists(
        tableName: string,
        searchCriteria: Record<string, any>
      ): Chainable<boolean>;
    }
  }
}

// Register Cypress commands
Cypress.Commands.add('authenticateDb', (username = 'admin', password = 'password123') => {
  const helper = new DatabaseTestHelper();
  return helper.authenticate(username, password);
});

Cypress.Commands.add('getDbTables', () => {
  const helper = new DatabaseTestHelper();
  return helper.authenticate().then(() => helper.getTables());
});

Cypress.Commands.add('getDbTableData', (tableName: string, options = {}) => {
  const helper = new DatabaseTestHelper();
  return helper.authenticate().then(() => helper.getTableData(tableName, options));
});

Cypress.Commands.add('createDbRecord', (tableName: string, recordData: Record<string, any>) => {
  const helper = new DatabaseTestHelper();
  return helper.authenticate().then(() => helper.createRecord(tableName, recordData));
});

Cypress.Commands.add(
  'updateDbRecord',
  (tableName: string, recordId: string, updateData: Record<string, any>) => {
    const helper = new DatabaseTestHelper();
    return helper.authenticate().then(() => helper.updateRecord(tableName, recordId, updateData));
  }
);

Cypress.Commands.add('deleteDbRecord', (tableName: string, recordId: string) => {
  const helper = new DatabaseTestHelper();
  return helper.authenticate().then(() => helper.deleteRecord(tableName, recordId));
});

Cypress.Commands.add('cleanupDbTestRecords', (tableName: string, searchPattern = 'test-') => {
  const helper = new DatabaseTestHelper();
  return helper.authenticate().then(() => helper.cleanupTestRecords(tableName, searchPattern));
});

Cypress.Commands.add(
  'verifyDbRecordExists',
  (tableName: string, searchCriteria: Record<string, any>) => {
    const helper = new DatabaseTestHelper();
    return helper.authenticate().then(() => helper.verifyRecordExists(tableName, searchCriteria));
  }
);
