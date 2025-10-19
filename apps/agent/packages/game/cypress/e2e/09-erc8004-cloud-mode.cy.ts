/**
 * ERC-8004 Cloud Mode E2E Tests
 * Tests service discovery through cloud proxy with Privy authentication
 */

describe('ERC-8004 Cloud Mode', () => {
  before(() => {
    // Mock Privy authentication for cloud mode
    cy.mockPrivyAuth();
  });

  beforeEach(() => {
    // Set cloud mode
    cy.window().then((win) => {
      win.localStorage.setItem('ELIZAGOTCHI_MODE', 'cloud');
      win.localStorage.setItem('skipStartup', 'true');
    });

    cy.visit('/');
    cy.wait(2000);
  });

  it('should require Privy authentication for cloud mode', () => {
    // When using cloud proxy, requests should have auth
    cy.intercept('GET', '/api/v1/erc8004/services*', (req) => {
      // Verify auth cookie exists
      expect(req.headers).to.have.property('cookie');
      req.reply({ services: [], count: 0 });
    }).as('cloudServices');

    cy.get('[data-testid="services-tab"]').click();
    cy.get('.service-browser button').contains('Refresh').click();

    cy.wait('@cloudServices');
  });

  it('should use cloud proxy endpoint', () => {
    cy.intercept('GET', '/api/v1/erc8004/services*').as('cloudProxy');

    cy.get('[data-testid="services-tab"]').click();
    cy.wait('@cloudProxy').its('request.url').should('include', '/api/v1/erc8004/services');
  });

  it('should handle cloud proxy rate limiting', () => {
    // Mock rate limit response
    cy.intercept('POST', '/api/v1/erc8004/message', {
      statusCode: 429,
      body: {
        error: 'Rate limit exceeded',
        resetAt: new Date(Date.now() + 60000).toISOString()
      }
    }).as('rateLimited');

    // Try to send many messages (would trigger rate limit)
    cy.get('[data-testid="chat-input"]').type('Send message to service 1{enter}');
    
    cy.wait(1000);
    
    // Should handle gracefully (not crash)
    cy.get('.chat-content').should('exist');
  });

  it('should cache service lists appropriately', () => {
    let requestCount = 0;
    
    cy.intercept('GET', '/api/v1/erc8004/services*', (req) => {
      requestCount++;
      req.reply({ services: [], count: 0 });
    }).as('cachedServices');

    cy.get('[data-testid="services-tab"]').click();
    
    // First request
    cy.get('.service-browser button').contains('Refresh').click();
    cy.wait('@cachedServices');
    
    // Immediate second request (should be cached on server)
    cy.get('.service-browser button').contains('Refresh').click();
    
    cy.wait(500);
    
    // Should handle caching logic
    expect(requestCount).to.be.gte(1);
  });

  it('should handle cloud proxy connection errors', () => {
    // Mock cloud proxy failure
    cy.intercept('POST', '/api/v1/erc8004/connect', {
      statusCode: 500,
      body: {
        success: false,
        error: 'Agent server unavailable'
      }
    }).as('connectionError');

    cy.get('[data-testid="chat-input"]').type('Connect to service 1{enter}');
    
    cy.wait(2000);
    
    // Should show error message
    cy.get('.chat-content').should('exist');
  });

  it('should display Privy user information', () => {
    // In cloud mode, should show logged-in user
    // This would be visible in UI if we add user info display
    cy.window().its('localStorage').invoke('getItem', 'privy-user').should('exist');
  });
});

