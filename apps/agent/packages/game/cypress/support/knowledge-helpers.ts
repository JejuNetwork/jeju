/**
 * Knowledge Base Test Helpers
 * Utility functions for testing knowledge base CRUD operations
 */

export interface KnowledgeDocument {
  id: string;
  title: string;
  description?: string;
  createdAt: string;
  metadata?: Record<string, any>;
}

export interface KnowledgeChunk {
  id: string;
  content: {
    text: string;
    metadata?: Record<string, any>;
  };
  embedding?: number[];
}

export interface KnowledgeSearchResult {
  content: {
    text: string;
    metadata?: Record<string, any>;
  };
  similarity?: number;
}

export interface UploadResponse {
  success: boolean;
  data: {
    id: string;
    message?: string;
  };
  error?: {
    message: string;
    code?: string;
  };
}

export class KnowledgeTestHelper {
  private baseUrl = 'http://localhost:7777/knowledge';
  private agentId: string;

  constructor(agentId: string = '00000000-0000-0000-0000-000000000001') {
    this.agentId = agentId;
  }

  /**
   * Upload a file to the knowledge base
   */
  uploadFile(
    fileName: string,
    content: string,
    fileType: string = 'text/plain'
  ): Cypress.Chainable<UploadResponse> {
    const file = new File([content], fileName, { type: fileType });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('agentId', this.agentId);

    return cy
      .request({
        method: 'POST',
        url: `${this.baseUrl}/documents`,
        body: formData,
        headers: {
          Accept: 'application/json',
        },
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        return response.body as UploadResponse;
      });
  }

  /**
   * Upload a document from URL
   */
  uploadFromUrl(url: string): Cypress.Chainable<UploadResponse> {
    return cy
      .request({
        method: 'POST',
        url: `${this.baseUrl}/import`,
        body: {
          url,
          agentId: this.agentId,
        },
        headers: {
          'Content-Type': 'application/json',
        },
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        return response.body as UploadResponse;
      });
  }

  /**
   * Get all knowledge documents
   */
  getDocuments(): Cypress.Chainable<KnowledgeDocument[]> {
    return cy
      .request({
        method: 'GET',
        url: `${this.baseUrl}/documents?agentId=${this.agentId}`,
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data as KnowledgeDocument[];
      });
  }

  /**
   * Get chunks for a specific document
   */
  getDocumentChunks(documentId: string): Cypress.Chainable<KnowledgeChunk[]> {
    return cy
      .request({
        method: 'GET',
        url: `${this.baseUrl}/chunks/${documentId}?agentId=${this.agentId}`,
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data as KnowledgeChunk[];
      });
  }

  /**
   * Search the knowledge base
   */
  search(query: string, count: number = 10): Cypress.Chainable<KnowledgeSearchResult[]> {
    return cy
      .request({
        method: 'GET',
        url: `${this.baseUrl}/search?query=${encodeURIComponent(query)}&agentId=${this.agentId}&count=${count}`,
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        return response.body.data as KnowledgeSearchResult[];
      });
  }

  /**
   * Delete a knowledge document
   */
  deleteDocument(documentId: string): Cypress.Chainable<void> {
    return cy
      .request({
        method: 'DELETE',
        url: `${this.baseUrl}/documents/${documentId}?agentId=${this.agentId}`,
      })
      .then((response) => {
        expect(response.status).to.eq(204);
      });
  }

  /**
   * Wait for document to be processed (embedded and chunked)
   */
  waitForDocumentProcessing(
    documentId: string,
    maxWaitTime: number = 30000
  ): Cypress.Chainable<void> {
    const startTime = Date.now();

    const checkProcessing = (): Cypress.Chainable<void> => {
      return this.getDocumentChunks(documentId)
        .then((chunks) => {
          if (chunks.length > 0) {
            cy.log(`Document ${documentId} processed with ${chunks.length} chunks`);
            return;
          }

          if (Date.now() - startTime > maxWaitTime) {
            throw new Error(`Document ${documentId} processing timeout after ${maxWaitTime}ms`);
          }

          cy.wait(1000);
          return checkProcessing();
        })
        .catch((error) => {
          if (Date.now() - startTime > maxWaitTime) {
            throw new Error(`Document ${documentId} processing timeout: ${error.message}`);
          }
          cy.wait(1000);
          return checkProcessing();
        });
    };

    return checkProcessing();
  }

  /**
   * Verify document exists and has content
   */
  verifyDocumentExists(documentId: string): Cypress.Chainable<boolean> {
    return this.getDocumentChunks(documentId)
      .then((chunks) => {
        return chunks.length > 0;
      })
      .catch(() => {
        return false;
      });
  }

  /**
   * Clean up - delete all test documents
   */
  cleanupTestDocuments(testFileNames: string[] = []): Cypress.Chainable<void> {
    return cy.wrap(null).then(() => {
      // Try to get documents, but continue if it fails
      return this.getDocuments()
        .then((documents) => {
          const testDocs = documents.filter(
            (doc) =>
              testFileNames.some((name) => doc.title?.includes(name)) ||
              doc.title?.includes('test-') ||
              doc.title?.includes('cypress-')
          );

          const deletePromises = testDocs.map(
            (doc) =>
              // Convert to promise for proper error handling
              new Cypress.Promise((resolve) => {
                this.deleteDocument(doc.id)
                  .then(() => resolve())
                  .catch(() => {
                    cy.log(`Failed to delete document ${doc.id}, continuing...`);
                    resolve();
                  });
              })
          );

          return cy.wrap(Promise.all(deletePromises)).then(() => {
            cy.log(`Cleaned up ${testDocs.length} test documents`);
          });
        })
        .then(
          () => {}, // Success handler
          () => {
            // Error handler for getDocuments
            cy.log('Failed to retrieve documents for cleanup, continuing...');
          }
        );
    });
  }

  /**
   * Create test documents with specific content for testing
   */
  createTestDocuments(): Cypress.Chainable<{ textDocId: string; urlDocId: string }> {
    const testTextContent =
      'This is a comprehensive test document for knowledge base testing. It contains information about artificial intelligence, machine learning, and natural language processing.';
    const testUrl = 'https://raw.githubusercontent.com/ai16z/eliza/main/README.md';

    return this.uploadFile('cypress-test-document.txt', testTextContent).then((textResponse) => {
      return this.uploadFromUrl(testUrl).then((urlResponse) => {
        return {
          textDocId: textResponse.data.id,
          urlDocId: urlResponse.data.id,
        };
      });
    });
  }

  /**
   * Validate API response structure
   */
  validateApiResponse(response: any, expectedSuccessStatus: boolean = true): void {
    expect(response).to.have.property('success', expectedSuccessStatus);

    if (expectedSuccessStatus) {
      expect(response).to.have.property('data');
    } else {
      expect(response).to.have.property('error');
      expect(response.error).to.have.property('message');
    }
  }

  /**
   * Test file upload with various file types
   */
  testFileTypes(): Cypress.Chainable<string[]> {
    const testFiles = [
      { name: 'test.txt', content: 'Plain text content', type: 'text/plain' },
      {
        name: 'test.md',
        content: '# Markdown Content\n\nThis is a test markdown file.',
        type: 'text/markdown',
      },
      { name: 'test.json', content: '{"key": "value", "test": true}', type: 'application/json' },
    ];

    const uploadPromises = testFiles.map((file) =>
      this.uploadFile(file.name, file.content, file.type).then((response) => response.data.id)
    );

    return cy.wrap(Promise.all(uploadPromises));
  }
}

// Cypress commands for easier usage in tests
declare global {
  namespace Cypress {
    interface Chainable {
      knowledgeHelper(agentId?: string): Cypress.Chainable<KnowledgeTestHelper>;
      uploadKnowledgeFile(
        fileName: string,
        content: string,
        fileType?: string
      ): Cypress.Chainable<UploadResponse>;
      searchKnowledge(query: string, count?: number): Cypress.Chainable<KnowledgeSearchResult[]>;
      deleteKnowledgeDocument(documentId: string): Cypress.Chainable<void>;
      cleanupKnowledgeTests(): Cypress.Chainable<void>;
    }
  }
}

// Register custom commands
Cypress.Commands.add('knowledgeHelper', (agentId?: string) => {
  return cy.wrap(new KnowledgeTestHelper(agentId));
});

Cypress.Commands.add(
  'uploadKnowledgeFile',
  (fileName: string, content: string, fileType?: string) => {
    const helper = new KnowledgeTestHelper();
    return helper.uploadFile(fileName, content, fileType);
  }
);

Cypress.Commands.add('searchKnowledge', (query: string, count?: number) => {
  const helper = new KnowledgeTestHelper();
  return helper.search(query, count);
});

Cypress.Commands.add('deleteKnowledgeDocument', (documentId: string) => {
  const helper = new KnowledgeTestHelper();
  return helper.deleteDocument(documentId);
});

Cypress.Commands.add('cleanupKnowledgeTests', () => {
  const helper = new KnowledgeTestHelper();
  return helper.cleanupTestDocuments(['test-', 'cypress-']);
});

export { KnowledgeTestHelper };
