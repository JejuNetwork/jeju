/**
 * Cypress helper to wait for ElizaOS AgentServer to be ready
 * Containers need time to start up, so this provides robust waiting logic
 */

export const waitForElizaServer = (maxRetries = 36) => {
  cy.log('🔄 Waiting for ElizaOS AgentServer to be ready...');

  const waitForServer = (retries = maxRetries) => {
    if (retries <= 0) {
      cy.log('❌ Server failed to respond after maximum retries');
      throw new Error(`Server failed to respond after ${maxRetries * 5} seconds`);
    }

    return cy
      .request({
        method: 'GET',
        url: 'http://localhost:7777/api/server/health',
        failOnStatusCode: false,
        timeout: 10000,
      })
      .then((response) => {
        if (response.status === 200) {
          cy.log('✅ AgentServer is ready!');
          return response;
        } else {
          cy.log(
            `⏳ Server not ready yet (status: ${response.status}), retrying... (${maxRetries - retries + 1}/${maxRetries})`
          );
          cy.wait(5000);
          return waitForServer(retries - 1);
        }
      })
      .catch(() => {
        cy.log(
          `⏳ Server connection failed, retrying... (${maxRetries - retries + 1}/${maxRetries})`
        );
        cy.wait(5000);
        return waitForServer(retries - 1);
      });
  };

  return waitForServer();
};

export const waitForElizaServerOptional = (maxRetries = 36) => {
  cy.log('🔄 Waiting for ElizaOS AgentServer (optional)...');

  const waitForServer = (retries = maxRetries) => {
    if (retries <= 0) {
      cy.log('⚠️ Server not available after maximum retries, continuing with frontend-only test');
      return Promise.resolve({ status: 503 });
    }

    return cy
      .request({
        method: 'GET',
        url: 'http://localhost:7777/api/server/health',
        failOnStatusCode: false,
        timeout: 10000,
      })
      .then((response) => {
        if (response.status === 200) {
          cy.log('✅ AgentServer is ready!');
          return response;
        } else {
          cy.log(
            `⏳ Server not ready yet (status: ${response.status}), retrying... (${maxRetries - retries + 1}/${maxRetries})`
          );
          cy.wait(5000);
          return waitForServer(retries - 1);
        }
      })
      .catch(() => {
        cy.log(
          `⏳ Server connection failed, retrying... (${maxRetries - retries + 1}/${maxRetries})`
        );
        cy.wait(5000);
        return waitForServer(retries - 1);
      });
  };

  return waitForServer();
};
