/**
 * Privy Authentication Mock Helpers for Cypress Testing
 * Provides commands to mock Privy authentication in tests
 */

declare global {
  namespace Cypress {
    interface Chainable {
      /**
       * Mock Privy authentication
       * Sets up fake auth token and user data
       */
      mockPrivyAuth(userData?: {
        id?: string;
        email?: string;
        wallet?: string;
      }): Chainable<void>;

      /**
       * Clear Privy authentication
       */
      clearPrivyAuth(): Chainable<void>;

      /**
       * Get current Privy user
       */
      getPrivyUser(): Chainable<unknown>;
    }
  }
}

/**
 * Mock Privy authentication
 * Creates fake auth session for testing
 */
Cypress.Commands.add('mockPrivyAuth', (userData = {}) => {
  const defaultUser = {
    id: userData.id || 'test-user-123',
    email: userData.email || 'test@elizagotchi.com',
    wallet: userData.wallet || '0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb',
  };

  cy.window().then((win) => {
    // Set Privy auth cookie
    cy.setCookie('privy-token', 'mock-privy-token-for-testing', {
      domain: 'localhost',
      path: '/',
      httpOnly: false,
    });

    // Store user data in localStorage
    win.localStorage.setItem('privy-user', JSON.stringify(defaultUser));
    win.localStorage.setItem('privy-authenticated', 'true');
  });

  // Mock API calls to Privy
  cy.intercept('GET', '**/api/v1/user', {
    statusCode: 200,
    body: defaultUser,
  }).as('privyUser');

  // Mock cloud proxy to accept our test token
  cy.intercept('GET', '/api/v1/erc8004/**', (req) => {
    // Add mock auth header
    req.headers['cookie'] = 'privy-token=mock-privy-token-for-testing';
    req.continue();
  });

  cy.log('Privy auth mocked', defaultUser);
});

/**
 * Clear Privy authentication
 */
Cypress.Commands.add('clearPrivyAuth', () => {
  cy.clearCookie('privy-token');
  cy.window().then((win) => {
    win.localStorage.removeItem('privy-user');
    win.localStorage.removeItem('privy-authenticated');
  });
  cy.log('Privy auth cleared');
});

/**
 * Get current Privy user
 */
Cypress.Commands.add('getPrivyUser', () => {
  return cy.window().then((win) => {
    const userJson = win.localStorage.getItem('privy-user');
    return userJson ? JSON.parse(userJson) : null;
  });
});

export {};

