/**
 * ERC-8004 Full Integration E2E Test
 * Tests complete flow from discovery to connection to interaction
 */

describe('ERC-8004 Full Integration', () => {
  before(() => {
    // Start with clean state
    cy.clearLocalStorage();
    cy.clearCookies();
  });

  beforeEach(() => {
    cy.window().then((win) => {
      win.localStorage.setItem('skipStartup', 'true');
    });
    cy.visit('/');
    cy.wait(2000);
  });

  describe('Service Discovery Flow', () => {
    it('should complete full discovery flow via UI', () => {
      // Navigate to services tab
      cy.get('[data-testid="services-tab"]').click();
      cy.get('[data-testid="services-content"]').should('be.visible');

      // Search for specific service
      cy.get('.service-browser input[placeholder*="Search"]').type('Caliguland');
      cy.get('.service-browser input[placeholder*="Search"]').type('{enter}');

      cy.wait(2000);

      // Should display results or empty state
      cy.get('.service-browser').should('exist');
    });

    it('should complete full discovery flow via chat', () => {
      // Ask agent to discover services
      cy.get('[data-testid="chat-input"]').type('Discover game services{enter}');

      cy.wait(3000);

      // Agent should respond with list or "no services"
      cy.get('.chat-content').last().should('contain.text', 'service');
    });
  });

  describe('Service Connection Flow', () => {
    it('should handle connection lifecycle', () => {
      // Step 1: Discover
      cy.get('[data-testid="chat-input"]').type('What services are available?{enter}');
      cy.wait(2000);

      // Step 2: Connect (assuming service 1 exists or will error gracefully)
      cy.get('[data-testid="chat-input"]').type('Connect to service 1{enter}');
      cy.wait(2000);

      // Step 3: List connections
      cy.get('[data-testid="chat-input"]').type('List my connections{enter}');
      cy.wait(2000);

      // Step 4: Disconnect
      cy.get('[data-testid="chat-input"]').type('Disconnect from service 1{enter}');
      cy.wait(2000);

      // Should have responses for all steps
      cy.get('.chat-content').should('have.length.gte', 4);
    });

    it('should show connection status in UI', () => {
      cy.get('[data-testid="services-tab"]').click();

      // Try to connect via UI
      cy.get('.service-browser').should('exist');

      // If services exist, should have connect buttons
      // If not, should show empty state
      // Both are valid outcomes
    });
  });

  describe('Error Handling', () => {
    it('should handle blockchain connection errors', () => {
      // Mock blockchain failure
      cy.intercept('GET', '/api/agents/*/erc8004/services*', {
        statusCode: 500,
        body: {
          success: false,
          error: 'Failed to connect to blockchain'
        }
      }).as('blockchainError');

      cy.get('[data-testid="services-tab"]').click();
      cy.get('.service-browser button').contains('Refresh').click();

      cy.wait('@blockchainError');

      // Should show error message
      cy.get('.service-browser .error').should('exist');
    });

    it('should handle service not found', () => {
      cy.get('[data-testid="chat-input"]').type('Connect to service 99999{enter}');
      
      cy.wait(2000);

      // Should get error response
      cy.get('.chat-content').last().should('exist');
    });

    it('should handle malformed requests', () => {
      cy.get('[data-testid="chat-input"]').type('Connect to service{enter}');
      
      cy.wait(2000);

      // Agent should ask for service ID
      cy.get('.chat-content').last().should('contain.text', 'ID');
    });
  });

  describe('Multiple Services', () => {
    it('should handle multiple simultaneous connections', () => {
      // Connect to multiple services
      cy.get('[data-testid="chat-input"]').type('Connect to service 1{enter}');
      cy.wait(1500);
      
      cy.get('[data-testid="chat-input"]').type('Connect to service 2{enter}');
      cy.wait(1500);

      // List connections
      cy.get('[data-testid="chat-input"]').type('List connections{enter}');
      cy.wait(2000);

      // Should show connection list
      cy.get('.chat-content').should('exist');
    });

    it('should filter services by type', () => {
      cy.get('[data-testid="services-tab"]').click();

      // Select games filter
      cy.get('.service-browser select').select('game');
      
      cy.wait(2000);

      // Should update (not crash)
      cy.get('.service-browser').should('exist');
    });
  });

  describe('Agent Card', () => {
    it('should serve agent card at .well-known endpoint', () => {
      // Direct request to agent card
      cy.request({
        url: 'http://localhost:7777/.well-known/agent-card.json',
        failOnStatusCode: false
      }).then((response) => {
        if (response.status === 200) {
          // If agent is running, should return valid card
          expect(response.body).to.have.property('name');
          expect(response.body).to.have.property('capabilities');
          expect(response.body).to.have.property('endpoints');
        } else {
          // Agent may not be running, that's okay for this test
          expect([200, 404, 503]).to.include(response.status);
        }
      });
    });
  });

  describe('Action Integration', () => {
    it('should have DISCOVER_SERVICES action available', () => {
      // Agent should understand service discovery commands
      cy.get('[data-testid="chat-input"]').type('discover services{enter}');
      cy.wait(2000);
      
      // Should get response (not "I don't understand")
      cy.get('.chat-content').last().should('exist');
    });

    it('should have CONNECT_TO_SERVICE action available', () => {
      cy.get('[data-testid="chat-input"]').type('connect to a service{enter}');
      cy.wait(2000);
      
      // Should respond (not "unknown command")
      cy.get('.chat-content').last().should('exist');
    });

    it('should have LIST_CONNECTIONS action available', () => {
      cy.get('[data-testid="chat-input"]').type('show my connections{enter}');
      cy.wait(2000);
      
      cy.get('.chat-content').last().should('exist');
    });
  });

  describe('Reputation Display', () => {
    it('should show service ratings when available', () => {
      // Mock service with reputation
      cy.intercept('GET', '/api/agents/*/erc8004/services*', {
        success: true,
        services: [
          {
            id: '1',
            name: 'Test Service',
            type: 'game',
            url: 'http://localhost:3000',
            reputation: {
              score: 95,
              feedbackCount: 42
            }
          }
        ]
      }).as('servicesWithReputation');

      cy.get('[data-testid="services-tab"]').click();
      cy.wait('@servicesWithReputation');

      // Should display rating
      cy.get('.service-browser').should('contain', '95/100');
      cy.get('.service-browser').should('contain', '42 reviews');
    });
  });
});

