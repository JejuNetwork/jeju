/// <reference types="cypress" />

import { KnowledgeTestHelper } from './knowledge-helpers';
import { DatabaseTestHelper } from './database-helpers';

/**
 * Custom Cypress Commands
 * Provides reusable commands for common test operations
 */

// Add custom command types
declare global {
  namespace Cypress {
    interface Chainable {
      // Setup and Environment
      setupTestEnvironment(): Chainable<void>;
      waitForBackend(timeout?: number): Chainable<void>;
      clearTestData(): Chainable<void>;
      seedTestData(): Chainable<void>;
      bypassBoot(): Chainable<void>;
      setupApiKey(provider: 'openai' | 'anthropic', key: string): Chainable<void>;

      // UI Helpers
      elementExists(selector: string): Chainable<boolean>;
      safeClick(selector: string): Chainable<void>;

      // Knowledge Management
      uploadKnowledgeFile(fileName: string, content: string, fileType?: string): Chainable<any>;
      searchKnowledge(query: string, count?: number): Chainable<any[]>;
      deleteKnowledgeDocument(documentId: string): Chainable<void>;
      cleanupKnowledgeTests(): Chainable<void>;
      waitForDocumentProcessing(documentId: string, timeout?: number): Chainable<void>;

      // Capability Management
      toggleCapability(capability: string): Chainable<void>;
      getCapabilityStatus(capability: string): Chainable<boolean>;

      // Message Helpers
      sendMessage(message: {
        text: string;
        userId: string;
        roomId: string;
        messageId?: string;
      }): Chainable<Cypress.Response<any>>;

      // Database Helpers
      authenticateDb(username?: string, password?: string): Chainable<string>;
      getDbTables(): Chainable<any[]>;
      cleanupDbTestRecords(tableName: string, searchPattern?: string): Chainable<void>;

      /**
       * Custom command to wait for backend to be ready
       * @example cy.waitForBackend()
       */
      waitForBackend(): Chainable<void>;

      /**
       * Custom command to wait for elizaClient to be initialized
       * @example cy.waitForElizaClient()
       */
      waitForElizaClient(): Chainable<void>;

      /**
       * Custom command to send a message via API
       * @example cy.sendMessage('Hello, agent!')
       * @example cy.sendMessage({ text: 'Hello', userId: 'user123', roomId: 'room456' })
       */
      sendMessage(content: string, roomId?: string): Chainable<any>;
      sendMessage(message: {
        text: string;
        userId?: string;
        roomId?: string;
        messageId?: string;
      }): Chainable<any>;

      /**
       * Custom command to search knowledge base
       * @example cy.searchKnowledge('search query')
       */
      searchKnowledge(query: string, count?: number): Chainable<any[]>;

      /**
       * Custom command to delete a knowledge document
       * @example cy.deleteKnowledgeDocument('doc-id')
       */
      deleteKnowledgeDocument(documentId: string): Chainable<void>;

      /**
       * Custom command to cleanup knowledge test data
       * @example cy.cleanupKnowledgeTests()
       */
      cleanupKnowledgeTests(): Chainable<void>;

      /**
       * Custom command to wait for document processing
       * @example cy.waitForDocumentProcessing('doc-id')
       */
      waitForDocumentProcessing(documentId: string, timeout?: number): Chainable<void>;
    }
  }
}

// Initialize helpers
const knowledgeHelper = new KnowledgeTestHelper();
const dbHelper = new DatabaseTestHelper();

// Setup and Environment Commands
Cypress.Commands.add('setupTestEnvironment', () => {
  cy.log('Setting up test environment');
  cy.task('setupTestEnvironment');
});

// Custom command to wait for backend to be ready
Cypress.Commands.add('waitForBackend', () => {
  cy.request({
    method: 'GET',
    url: `${Cypress.env('BACKEND_URL') || 'http://localhost:7777'}/api/server/health`,
    retryOnStatusCodeFailure: true,
    retryOnNetworkFailure: true,
    timeout: 30000,
  }).then(() => {
    cy.log('✅ Backend is ready!');
  });
});

// Custom command to wait for elizaClient to be initialized
Cypress.Commands.add('waitForElizaClient', () => {
  cy.window().should((win: any) => {
    expect(win.elizaClient).to.exist;
    expect(win.elizaClient.socket).to.exist;
  });
});

// Custom command to send message via API
Cypress.Commands.add(
  'sendMessage',
  (
    contentOrMessage:
      | string
      | { text: string; userId?: string; roomId?: string; messageId?: string },
    roomId?: string
  ) => {
    const BACKEND_URL = Cypress.env('BACKEND_URL') || 'http://localhost:7777';

    let message: { text: string; userId: string; roomId: string; messageId?: string };

    // Handle both string and object formats
    if (typeof contentOrMessage === 'string') {
      message = {
        text: contentOrMessage,
        userId: `test-user-${Date.now()}`,
        roomId: roomId || '00000000-0000-0000-0000-000000000001',
        messageId: Date.now().toString(),
      };
    } else {
      message = {
        text: contentOrMessage.text,
        userId: contentOrMessage.userId || `test-user-${Date.now()}`,
        roomId: contentOrMessage.roomId || '00000000-0000-0000-0000-000000000001',
        messageId: contentOrMessage.messageId || Date.now().toString(),
      };
    }

    const headers: any = {
      'Content-Type': 'application/json',
    };

    // Add API key if configured
    const apiKey = Cypress.env('ELIZA_SERVER_AUTH_TOKEN');
    if (apiKey) {
      headers['X-API-KEY'] = apiKey;
    }

    return cy.request({
      method: 'POST',
      url: `${BACKEND_URL}/api/messaging/ingest-external`,
      body: {
        channel_id: message.roomId,
        server_id: '00000000-0000-0000-0000-000000000000',
        author_id: message.userId,
        author_display_name: message.userId,
        content: message.text,
        source_type: 'test',
        raw_message: { text: message.text, messageId: message.messageId },
        metadata: {
          test: true,
          originalMessageId: message.messageId,
        },
      },
      headers,
      failOnStatusCode: false,
    });
  }
);

// UI Helper Commands
Cypress.Commands.add('elementExists', (selector: string) => {
  cy.get('body').then(($body) => {
    return cy.wrap($body.find(selector).length > 0);
  });
});

Cypress.Commands.add('safeClick', (selector: string) => {
  cy.get(selector).should('be.visible').click({ force: true });
});

// Knowledge Management Commands
Cypress.Commands.add(
  'uploadKnowledgeFile',
  (fileName: string, content: string, fileType?: string) => {
    return cy.wrap(knowledgeHelper.uploadFile(fileName, content, fileType || 'text/plain'));
  }
);

Cypress.Commands.add('searchKnowledge', (query: string, count?: number) => {
  return knowledgeHelper.search(query, count);
});

Cypress.Commands.add('deleteKnowledgeDocument', (documentId: string) => {
  return knowledgeHelper.deleteDocument(documentId);
});

Cypress.Commands.add('cleanupKnowledgeTests', () => {
  return knowledgeHelper.cleanupTestDocuments();
});

Cypress.Commands.add('waitForDocumentProcessing', (documentId: string, timeout?: number) => {
  return knowledgeHelper.waitForDocumentProcessing(documentId, timeout);
});

// Capability Management Commands
Cypress.Commands.add('toggleCapability', (capability: string) => {
  const capabilityMap: Record<string, string> = {
    autonomy: 'autonomy-toggle',
    camera: 'camera-toggle',
    screen: 'screen-toggle',
    microphone: 'microphone-toggle',
    speaker: 'speakers-toggle',
    shell: 'shell-toggle',
    browser: 'browser-toggle',
  };

  const testId = capabilityMap[capability.toLowerCase()];
  if (testId) {
    cy.get(`[data-testid="${testId}"]`).click();
    cy.wait(1000); // Allow for API call
  } else {
    throw new Error(`Unknown capability: ${capability}`);
  }
});

Cypress.Commands.add('getCapabilityStatus', (capability: string) => {
  const BACKEND_URL = Cypress.env('BACKEND_URL') || 'http://localhost:7777';

  if (capability === 'autonomy') {
    return cy
      .request('GET', `${BACKEND_URL}/autonomy/status`)
      .then((response) => response.body.data.enabled);
  } else {
    return cy
      .request('GET', `${BACKEND_URL}/api/agents/default/capabilities/${capability}`)
      .then((response) => response.body.data.enabled);
  }
});

// Database Helper Commands
Cypress.Commands.add('authenticateDb', (username?: string, password?: string) => {
  return dbHelper.authenticate(username, password);
});

Cypress.Commands.add('getDbTables', () => {
  return dbHelper.getTables();
});

Cypress.Commands.add('cleanupDbTestRecords', (tableName: string, searchPattern?: string) => {
  return dbHelper.cleanupTestRecords(tableName, searchPattern);
});

// Export for use in tests
export {};
