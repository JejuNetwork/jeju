/// <reference types="cypress" />

/**
 * UI Navigation Tests
 * Tests tab navigation, chat interface, capability buttons, and visual verification
 */

describe('UI Navigation', () => {
  const _BACKEND_URL = Cypress.env('BACKEND_URL') || 'http://localhost:7777';

  before(() => {
    // Ensure backend is ready
    cy.waitForBackend();
  });

  beforeEach(() => {
    // Skip boot sequence and WebSocket for UI testing
    cy.window().then((win) => {
      win.localStorage.setItem('skipBoot', 'true');
      win.localStorage.setItem('disableWebSocket', 'true');
    });

    // Visit the application
    cy.visit('/', {
      timeout: 30000,
      failOnStatusCode: false,
    });

    // Wait for initial loading
    cy.wait(3000);
  });

  describe('Main Interface', () => {
    it('should display the game interface', () => {
      // Check for main UI elements
      cy.get('[data-testid="game-interface"], .game-interface, body').should('be.visible');

      // Check for ELIZA branding
      cy.contains('ELIZA').should('be.visible');

      cy.screenshot('main-interface');
    });

    it('should display terminal header', () => {
      // Look for terminal/header elements
      cy.get('.terminal-header, [data-testid="terminal-header"], header').should('exist');

      // Should have title
      cy.contains(/ELIZA|Terminal/i).should('be.visible');

      cy.log('✅ Terminal header displayed');
    });

    it('should have responsive layout', () => {
      // Test different viewport sizes
      const viewports = [
        { width: 1920, height: 1080, name: 'desktop' },
        { width: 1280, height: 720, name: 'laptop' },
        { width: 768, height: 1024, name: 'tablet' },
        { width: 375, height: 667, name: 'mobile' },
      ];

      viewports.forEach((viewport) => {
        cy.viewport(viewport.width, viewport.height);
        cy.wait(500);

        // UI should still be functional
        cy.get('body').should('be.visible');

        cy.screenshot(`responsive-${viewport.name}`);
      });
    });
  });

  describe('Tab Navigation', () => {
    const tabs = [
      { name: 'CHAT', selector: 'chat', testId: 'chat-tab' },
      { name: 'GOALS', selector: 'goals', testId: 'goals-tab' },
      { name: 'TODOS', selector: 'todos', testId: 'todos-tab' },
      { name: 'MONOLOGUE', selector: 'monologue', testId: 'monologue-tab' },
      { name: 'FILES', selector: 'files', testId: 'files-tab' },
      { name: 'CONFIG', selector: 'config', testId: 'config-tab' },
    ];

    tabs.forEach((tab) => {
      it(`should navigate to ${tab.name} tab`, () => {
        // Click tab
        cy.get(`[data-testid="${tab.testId}"]`).click();
        cy.wait(1000);

        // Verify tab content is displayed
        cy.get(`[data-testid="${tab.selector}-content"]`).should('be.visible');

        // Take screenshot
        cy.screenshot(`tab-${tab.selector}`);

        cy.log(`✅ ${tab.name} tab displayed`);
      });
    });

    it('should maintain tab state when switching', () => {
      // Click through all tabs
      cy.get('[data-testid="goals-tab"]').click();
      cy.wait(500);

      cy.get('[data-testid="todos-tab"]').click();
      cy.wait(500);

      // Go back to goals
      cy.get('[data-testid="goals-tab"]').click();

      // Goals content should still be visible
      cy.get('[data-testid="goals-content"]').should('be.visible');
    });

    it('should highlight active tab', () => {
      // Click a tab
      cy.get('[data-testid="todos-tab"]').click();

      // Should have active class or styling
      cy.get('[data-testid="todos-tab"]')
        .should('have.class', 'active')
        .or('have.css', 'background-color')
        .or('have.css', 'color');
    });
  });

  describe('Chat Interface', () => {
    beforeEach(() => {
      // Navigate to chat tab
      cy.get('[data-testid="chat-tab"]').click();
      cy.wait(1000);
    });

    it('should display chat input and messages area', () => {
      // Chat input should be visible
      cy.get('[data-testid="message-input"]').should('be.visible');

      // Send button should be visible
      cy.get('[data-testid="send-button"]').should('be.visible');

      // Messages area should exist
      cy.get('[data-testid="chat-messages"]').should('exist');

      cy.screenshot('chat-interface');
    });

    it('should allow typing in chat input', () => {
      const testMessage = 'Test message from Cypress';

      cy.get('[data-testid="message-input"]')
        .clear()
        .type(testMessage)
        .should('have.value', testMessage);
    });

    it('should send message on button click', () => {
      const testMessage = `UI test message ${Date.now()}`;

      // Type message
      cy.get('[data-testid="message-input"]').clear().type(testMessage);

      // Click send
      cy.get('[data-testid="send-button"]').click();

      // Input should be cleared
      cy.get('[data-testid="message-input"]').should('have.value', '');

      // Message should appear
      cy.get('[data-testid="chat-messages"]').should('contain', testMessage);
    });

    it('should send message on Enter key', () => {
      const testMessage = `Enter key test ${Date.now()}`;

      cy.get('[data-testid="message-input"]').clear().type(`${testMessage}{enter}`);

      // Message should appear
      cy.get('[data-testid="chat-messages"]').should('contain', testMessage);
    });

    it('should display user and agent messages differently', () => {
      // Send a message
      cy.get('[data-testid="message-input"]').type('Test message{enter}');
      cy.wait(2000);

      // Check for different message styles
      cy.get('[data-testid="user-message"]').should('exist');
      cy.get('[data-testid="agent-message"]').should('exist');

      // They should have different styling
      cy.get('[data-testid="user-message"]').then(($userMsg) => {
        cy.get('[data-testid="agent-message"]').then(($agentMsg) => {
          const userBg = $userMsg.css('background-color');
          const agentBg = $agentMsg.css('background-color');
          expect(userBg).to.not.equal(agentBg);
        });
      });
    });
  });

  describe('Capability Buttons', () => {
    const capabilities = [
      { name: 'AUTO', testId: 'autonomy-toggle', setting: 'autonomy' },
      { name: 'CAM', testId: 'camera-toggle', setting: 'camera' },
      { name: 'SCR', testId: 'screen-toggle', setting: 'screen' },
      { name: 'MIC', testId: 'microphone-toggle', setting: 'microphone' },
      { name: 'SH', testId: 'shell-toggle', setting: 'shell' },
      { name: 'WWW', testId: 'browser-toggle', setting: 'browser' },
    ];

    it('should display all capability buttons', () => {
      capabilities.forEach((cap) => {
        cy.get(`[data-testid="${cap.testId}"]`).should('be.visible');
        cy.get(`[data-testid="${cap.testId}"]`).should('contain', cap.name);
      });

      cy.screenshot('capability-buttons');
    });

    capabilities.forEach((cap) => {
      it(`should toggle ${cap.name} capability`, () => {
        // Get initial state
        cy.get(`[data-testid="${cap.testId}"]`).then(($btn) => {
          const initialClass = $btn.attr('class');

          // Click to toggle
          cy.get(`[data-testid="${cap.testId}"]`).click();
          cy.wait(1000);

          // Check state changed visually
          cy.get(`[data-testid="${cap.testId}"]`).then(($newBtn) => {
            const newClass = $newBtn.attr('class');
            expect(newClass).to.not.equal(initialClass);
          });

          // Should show status
          cy.get(`[data-testid="${cap.testId}-status"]`).should('exist');
        });
      });
    });

    it('should show capability status indicators', () => {
      // Each button should have a status indicator
      capabilities.forEach((cap) => {
        cy.get(`[data-testid="${cap.testId}"]`).within(() => {
          cy.get('[data-testid*="status"], .status-indicator, .toggle-status').should('exist');
        });
      });
    });
  });

  describe('Tab Content', () => {
    it('should display goals content', () => {
      cy.get('[data-testid="goals-tab"]').click();
      cy.wait(1000);

      cy.get('[data-testid="goals-content"]').within(() => {
        // Should show goals or empty state
        cy.get('body').then(($body) => {
          if ($body.find('.goal-item, [data-testid="goal-item"]').length > 0) {
            cy.log('✅ Goals displayed');
            cy.get('.goal-item, [data-testid="goal-item"]').should('have.length.at.least', 1);
          } else {
            cy.log('✅ Goals empty state displayed');
            cy.contains(/no.*goals|empty/i).should('be.visible');
          }
        });
      });
    });

    it('should display todos content', () => {
      cy.get('[data-testid="todos-tab"]').click();
      cy.wait(1000);

      cy.get('[data-testid="todos-content"]').within(() => {
        cy.get('body').then(($body) => {
          if ($body.find('.todo-item, [data-testid="todo-item"]').length > 0) {
            cy.log('✅ Todos displayed');
            cy.get('.todo-item, [data-testid="todo-item"]').should('have.length.at.least', 1);
          } else {
            cy.log('✅ Todos empty state displayed');
            cy.contains(/no.*todos|no.*tasks|empty/i).should('be.visible');
          }
        });
      });
    });

    it('should display monologue content', () => {
      cy.get('[data-testid="monologue-tab"]').click();
      cy.wait(1000);

      cy.get('[data-testid="monologue-content"]').within(() => {
        cy.get('body').then(($body) => {
          if ($body.find('.thought-item, [data-testid="thought-item"]').length > 0) {
            cy.log('✅ Thoughts displayed');
          } else {
            cy.log('✅ Monologue empty state displayed');
            cy.contains(/no.*thoughts|quiet|empty/i).should('be.visible');
          }
        });
      });
    });

    it('should display files content with upload capability', () => {
      cy.get('[data-testid="files-tab"]').click();
      cy.wait(1000);

      cy.get('[data-testid="files-content"]').within(() => {
        // Should have upload area
        cy.get('input[type="file"]').should('exist');

        // Should have knowledge base section
        cy.contains('KNOWLEDGE').should('be.visible');

        // Should show files or empty state
        cy.get('body').then(($body) => {
          if ($body.find('.file-item, [data-testid="file-item"]').length > 0) {
            cy.log('✅ Files displayed');
            // Should have delete buttons
            cy.get('.delete-button, [data-testid="delete-file"]').should('have.length.at.least', 1);
          } else {
            cy.log('✅ Files empty state displayed');
            cy.contains(/no.*files|empty/i).should('be.visible');
          }
        });
      });
    });

    it('should display config content with settings', () => {
      cy.get('[data-testid="config-tab"]').click();
      cy.wait(1000);

      cy.get('[data-testid="config-content"]').within(() => {
        // Should have configuration sections
        cy.contains('CONFIGURATION').should('be.visible');

        // Should have model provider selection
        cy.get('[data-testid="model-provider-select"]').should('be.visible');

        // Should have API key inputs
        cy.get('[data-testid="openai-api-key-input"]').should('exist');

        // Should have test buttons
        cy.get('[data-testid="validate-config-button"]').should('be.visible');
        cy.get('[data-testid="test-config-button"]').should('be.visible');

        // Should have danger zone
        cy.contains('Danger Zone').should('be.visible');
        cy.contains('RESET').should('be.visible');
      });
    });
  });

  describe('Visual Consistency', () => {
    it('should maintain consistent styling across tabs', () => {
      const tabs = ['chat', 'goals', 'todos', 'monologue', 'files', 'config'];

      tabs.forEach((tab) => {
        cy.get(`[data-testid="${tab}-tab"]`).click();
        cy.wait(500);

        // Check consistent padding/margins
        cy.get(`[data-testid="${tab}-content"]`).should('have.css', 'padding');

        // Check consistent background
        cy.get(`[data-testid="${tab}-content"]`).then(($el) => {
          const bg = $el.css('background-color');
          cy.log(`${tab} background: ${bg}`);
        });
      });
    });

    it('should have consistent button styling', () => {
      // Check all buttons have consistent styling
      cy.get('button').each(($btn) => {
        // Should have some styling
        expect($btn.css('padding')).to.not.equal('0px');
        expect($btn.css('cursor')).to.equal('pointer');
      });
    });

    it('should handle long content with scrolling', () => {
      // Navigate to a tab that might have long content
      cy.get('[data-testid="chat-tab"]').click();

      // Send multiple messages to create scrollable content
      for (let i = 0; i < 20; i++) {
        cy.get('[data-testid="message-input"]').type(`Test message ${i}{enter}`);
        cy.wait(100);
      }

      // Messages area should be scrollable
      cy.get('[data-testid="chat-messages"]').then(($el) => {
        const scrollHeight = $el[0].scrollHeight;
        const clientHeight = $el[0].clientHeight;

        if (scrollHeight > clientHeight) {
          cy.log('✅ Content is scrollable');
          // Should be able to scroll
          cy.get('[data-testid="chat-messages"]').scrollTo('bottom');
        }
      });
    });
  });

  describe('Error States', () => {
    it('should handle backend connection errors gracefully', () => {
      // UI should still be functional even if backend calls fail
      cy.get('[data-testid="goals-tab"]').click();

      // Should show some content or error state
      cy.get('[data-testid="goals-content"]').should('be.visible');
    });

    it('should show loading states', () => {
      // Click through tabs quickly to catch loading states
      const tabs = ['goals', 'todos', 'monologue'];

      tabs.forEach((tab) => {
        cy.get(`[data-testid="${tab}-tab"]`).click();

        // Look for any loading indicators
        cy.get(`[data-testid="${tab}-content"]`).within(() => {
          cy.get('.loading, [data-testid="loading"], .spinner').then(($loading) => {
            if ($loading.length > 0) {
              cy.log(`✅ ${tab} shows loading state`);
            }
          });
        });
      });
    });
  });
});

// UI Summary Test
describe('UI Navigation Summary', () => {
  it('should verify complete UI functionality', () => {
    // Verify tabs navigation
    const tabs = ['goals', 'todos', 'monologue', 'files', 'config', 'logs', 'agent-screen'];
    tabs.forEach((tab) => {
      cy.get(`[data-testid="${tab}-tab"]`).should('be.visible');
    });

    // Navigate through tabs
    tabs.forEach((tab) => {
      cy.get(`[data-testid="${tab}-tab"]`).click();
      cy.wait(300);
      cy.get(`[data-testid="${tab}-content"]`).should('be.visible');
    });

    // Verify chat interface (part of main interface, not a tab)
    cy.get('[data-testid="message-input"]').should('be.visible');
    cy.get('[data-testid="send-button"]').should('be.visible');
    cy.get('[data-testid="output-container"]').should('be.visible');

    // Verify capability buttons
    cy.get('[data-testid="autonomy-toggle"]').should('be.visible');
    cy.get('[data-testid="camera-toggle"]').should('be.visible');
    cy.get('[data-testid="screen-toggle"]').should('be.visible');
    cy.get('[data-testid="microphone-toggle"]').should('be.visible');
    cy.get('[data-testid="shell-toggle"]').should('be.visible');
    cy.get('[data-testid="browser-toggle"]').should('be.visible');

    // Verify overall layout
    cy.get('[data-testid="game-interface"]').should('be.visible');
    cy.get('[data-testid="connection-status"]').should('be.visible');

    cy.log('✅ UI navigation verification complete');
  });
});
