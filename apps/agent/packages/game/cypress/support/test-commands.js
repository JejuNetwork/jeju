// Custom Cypress commands for ELIZA game testing

// Command to wait for agent to be ready
Cypress.Commands.add('waitForAgentReady', () => {
  cy.get('[data-testid="agent-status"]', { timeout: 30000 }).should('contain', 'Ready');
  cy.get('[data-testid="chat-interface"]').should('be.visible');
});

// Command to send message and wait for response
Cypress.Commands.add('sendMessageAndWait', (message) => {
  cy.get('[data-testid="chat-input"]').type(`${message}{enter}`);
  cy.get('[data-testid="agent-message"]', { timeout: 20000 }).should('be.visible');
});

// Command to toggle capability and verify state
Cypress.Commands.add('toggleCapability', (capability, expectedState) => {
  cy.get(`[data-testid="${capability}-toggle"]`).click();
  cy.get(`[data-testid="${capability}-toggle"]`).should(
    'have.attr',
    'aria-checked',
    expectedState.toString()
  );
});

// Command to verify error handling
Cypress.Commands.add('verifyErrorHandling', (errorType) => {
  cy.get(`[data-testid="${errorType}-error"]`).should('be.visible');
  cy.get('[data-testid="error-message"]').should('not.be.empty');
});

// Command to reset application state
Cypress.Commands.add('resetAppState', () => {
  cy.window().then((win) => {
    win.localStorage.clear();
    win.sessionStorage.clear();
  });
  cy.clearCookies();
  cy.reload();
});

// Command to enable testing mode
Cypress.Commands.add('enableTestingMode', () => {
  cy.window().then((win) => {
    win.localStorage.setItem('testingMode', 'true');
    win.localStorage.setItem('skipBoot', 'true');
  });
});

// Command to simulate network conditions
Cypress.Commands.add('simulateNetworkCondition', (condition) => {
  switch (condition) {
    case 'offline':
      cy.intercept('**/*', { forceNetworkError: true });
      break;
    case 'slow':
      cy.intercept('**/*', { delay: 5000 });
      break;
    case 'unstable':
      let requestCount = 0;
      cy.intercept('**/*', (req) => {
        requestCount++;
        if (requestCount % 3 === 0) {
          req.reply({ forceNetworkError: true });
        } else {
          req.continue();
        }
      });
      break;
    default:
      // Normal network conditions
      break;
  }
});

// Command to verify accessibility
Cypress.Commands.add('checkA11y', () => {
  // Check for basic accessibility requirements
  cy.get('[data-testid]').each(($el) => {
    if ($el.is('button, input, select, textarea')) {
      cy.wrap($el)
        .should('have.attr', 'aria-label')
        .or('have.attr', 'aria-labelledby')
        .or('have.attr', 'title');
    }
  });

  // Check for proper heading hierarchy
  cy.get('h1, h2, h3, h4, h5, h6').then(($headings) => {
    // Verify headings are in logical order
    let lastLevel = 0;
    $headings.each((index, heading) => {
      const currentLevel = parseInt(heading.tagName.charAt(1), 10);
      expect(currentLevel).to.be.at.most(lastLevel + 1);
      lastLevel = currentLevel;
    });
  });
});

// Command to capture performance metrics
Cypress.Commands.add('measurePerformance', (testName) => {
  cy.window().then((win) => {
    const performance = win.performance;
    const navigation = performance.getEntriesByType('navigation')[0];
    const timing = {
      domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
      loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
      totalTime: navigation.loadEventEnd - navigation.fetchStart,
    };

    cy.log(`Performance metrics for ${testName}:`, timing);

    // Assert reasonable performance thresholds
    expect(timing.domContentLoaded).to.be.lessThan(5000); // 5 seconds
    expect(timing.totalTime).to.be.lessThan(10000); // 10 seconds
  });
});

// Command to verify responsive design
Cypress.Commands.add('testResponsive', () => {
  const viewports = [
    { width: 320, height: 568 }, // iPhone SE
    { width: 768, height: 1024 }, // iPad
    { width: 1024, height: 768 }, // iPad Landscape
    { width: 1920, height: 1080 }, // Desktop
  ];

  viewports.forEach((viewport, _index) => {
    cy.viewport(viewport.width, viewport.height);
    cy.get('[data-testid="chat-interface"]').should('be.visible');
    cy.get('[data-testid="chat-input"]').should('be.visible');
    cy.screenshot(`responsive-${viewport.width}x${viewport.height}`);
  });
});

// Command to test keyboard navigation
Cypress.Commands.add('testKeyboardNavigation', () => {
  // Test tab navigation through interactive elements
  cy.get('body').tab();
  cy.focused().should('be.visible');

  // Test arrow key navigation for tabs
  cy.get('[data-testid="goals-tab"]').focus().type('{rightarrow}');
  cy.get('[data-testid="todos-tab"]').should('have.focus');

  // Test Enter key activation
  cy.focused().type('{enter}');
  cy.get('[data-testid="todos-content"]').should('be.visible');
});

// Command to validate OCR text recognition
Cypress.Commands.add('verifyTextOnScreen', (expectedText) => {
  // Take screenshot and verify text appears
  cy.screenshot('text-verification');
  cy.get('body').should('contain', expectedText);

  // Additional visual verification
  cy.get('*').contains(expectedText).should('be.visible');
});

// Command to cleanup test data
Cypress.Commands.add('cleanupTestData', () => {
  // Clear any test-generated data
  cy.get('[data-testid="reset-button"]').then(($button) => {
    if ($button.length) {
      cy.wrap($button).click();
      cy.get('[data-testid="confirm-reset-button"]').click();
    }
  });

  // Clear test files
  cy.get('[data-testid="files-tab"]').click();
  cy.get('[data-testid="file-delete-button"]').each(($button) => {
    cy.wrap($button).click();
    cy.get('[data-testid="confirm-delete-button"]').click();
  });
});

// Add tab command for keyboard navigation testing
Cypress.Commands.add('tab', { prevSubject: 'optional' }, (subject, options) => {
  return cy.wrap(subject).trigger('keydown', {
    keyCode: 9,
    which: 9,
    shiftKey: options && options.shift,
  });
});
