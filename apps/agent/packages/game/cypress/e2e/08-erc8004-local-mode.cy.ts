/**
 * ERC-8004 Local Mode E2E Tests
 * Tests service discovery and connection in local mode (no Privy auth)
 */

describe('ERC-8004 Local Mode', () => {
  beforeEach(() => {
    // Skip startup flow for testing
    cy.visit('/', {
      onBeforeLoad: (win) => {
        win.localStorage.setItem('skipStartup', 'true');
      }
    });

    // Wait for agent to be ready
    cy.wait(2000);
  });

  it('should show services tab in navigation', () => {
    cy.get('[data-testid="services-tab"]').should('exist');
    cy.get('[data-testid="services-tab"]').should('contain', 'SERVICES');
  });

  it('should navigate to services tab', () => {
    cy.get('[data-testid="services-tab"]').click();
    cy.get('[data-testid="services-content"]').should('be.visible');
    cy.get('.service-browser').should('exist');
  });

  it('should display service browser UI elements', () => {
    cy.get('[data-testid="services-tab"]').click();
    
    // Check for search input
    cy.get('.service-browser input[placeholder*="Search"]').should('exist');
    
    // Check for type filter
    cy.get('.service-browser select').should('exist');
    
    // Check for refresh button
    cy.get('.service-browser button').contains('Refresh').should('exist');
  });

  it('should handle service discovery via chat', () => {
    // Type command to discover services
    cy.get('[data-testid="chat-input"]').type('What services can I connect to?{enter}');
    
    // Wait for response
    cy.wait(3000);
    
    // Check for agent response (may say "no services" if none registered)
    cy.get('.chat-content').should('contain.text', 'service');
  });

  it('should handle service connection command', () => {
    // Try to connect to a service
    cy.get('[data-testid="chat-input"]').type('Connect to service 1{enter}');
    
    // Wait for response
    cy.wait(2000);
    
    // Should get either success or "service not found" message
    cy.get('.chat-content').should('exist');
  });

  it('should list active connections', () => {
    cy.get('[data-testid="chat-input"]').type('List connections{enter}');
    
    cy.wait(2000);
    
    // Should respond with connection list (or "no active connections")
    cy.get('.chat-content').should('contain.text', 'connection');
  });

  it('should handle ERC-8004 errors gracefully when no blockchain', () => {
    cy.get('[data-testid="services-tab"]').click();
    
    // Click refresh
    cy.get('.service-browser button').contains('Refresh').click();
    
    // Should either show services or show error message gracefully
    cy.wait(2000);
    
    // Component should still be rendered (not crash)
    cy.get('.service-browser').should('exist');
  });

  it('should display service types correctly', () => {
    cy.get('[data-testid="services-tab"]').click();
    
    // Check type options in dropdown
    cy.get('.service-browser select').click();
    cy.get('.service-browser select option').should('contain', 'Games');
    cy.get('.service-browser select option').should('contain', 'Tools');
    cy.get('.service-browser select option').should('contain', 'Social');
  });

  it('should allow filtering by service type', () => {
    cy.get('[data-testid="services-tab"]').click();
    
    // Select "Games" filter
    cy.get('.service-browser select').select('game');
    
    // Component should update (not crash)
    cy.wait(1000);
    cy.get('.service-browser').should('exist');
  });

  it('should handle search functionality', () => {
    cy.get('[data-testid="services-tab"]').click();
    
    // Type in search
    cy.get('.service-browser input[placeholder*="Search"]').type('test');
    
    // Press Enter to search
    cy.get('.service-browser input[placeholder*="Search"]').type('{enter}');
    
    cy.wait(1000);
    
    // Component should handle search (not crash)
    cy.get('.service-browser').should('exist');
  });
});

