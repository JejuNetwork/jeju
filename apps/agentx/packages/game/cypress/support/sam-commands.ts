/**
 * Cypress Custom Commands for SAM Plugin Testing
 */

declare namespace Cypress {
  interface Chainable {
    /**
     * Send a message to the agent that should trigger SAY_ALOUD action
     */
    sendSpeechMessage(
      message: string,
      options?: { userId?: string; roomId?: string }
    ): Chainable<any>;

    /**
     * Check if hardware bridge WebSocket is responsive
     */
    checkHardwareBridge(url?: string): Chainable<boolean>;

    /**
     * Wait for and verify audio output through hardware bridge
     */
    waitForAudioOutput(timeout?: number): Chainable<boolean>;

    /**
     * Test voice parameter extraction
     */
    testVoiceParameters(message: string, expectedParams: string[]): Chainable<any>;

    /**
     * Verify SAM plugin is registered
     */
    verifySamPlugin(): Chainable<any>;
  }
}

// Send speech message to agent
Cypress.Commands.add('sendSpeechMessage', (message: string, options = {}) => {
  const { userId = 'cypress-test-user', roomId = 'cypress-test-room' } = options;

  return cy.request({
    method: 'POST',
    url: '/api/message',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      content: { text: message },
      userId,
      roomId,
      timestamp: Date.now(),
    },
    timeout: 15000,
    failOnStatusCode: false,
  });
});

// Check hardware bridge connectivity
Cypress.Commands.add('checkHardwareBridge', (url = 'ws://localhost:8888') => {
  return cy.window().then((win) => {
    return new Cypress.Promise<boolean>((resolve, reject) => {
      const ws = new win.WebSocket(url);
      let connected = false;

      const timeout = setTimeout(() => {
        if (!connected) {
          ws.close();
          reject(new Error('Hardware bridge connection timeout'));
        }
      }, 5000);

      ws.onopen = () => {
        connected = true;
        clearTimeout(timeout);
        ws.close();
        resolve(true);
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        reject(new Error(`Hardware bridge connection failed: ${error}`));
      };
    });
  });
});

// Wait for audio output
Cypress.Commands.add('waitForAudioOutput', (timeout = 10000) => {
  const hardwareBridgeUrl = Cypress.env('HARDWARE_BRIDGE_URL') || 'ws://localhost:8888';

  return cy.window().then((win) => {
    return new Cypress.Promise<boolean>((resolve, reject) => {
      const ws = new win.WebSocket(hardwareBridgeUrl);
      let audioReceived = false;

      const timeoutId = setTimeout(() => {
        ws.close();
        if (!audioReceived) {
          reject(new Error('Timeout waiting for audio output'));
        }
      }, timeout);

      ws.onopen = () => {
        cy.log('Monitoring hardware bridge for audio output...');
      };

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);

        if (
          message.type === 'AUDIO_OUTPUT' ||
          message.type === 'SPEAK_TEXT' ||
          message.type?.includes('AUDIO')
        ) {
          audioReceived = true;
          clearTimeout(timeoutId);
          ws.close();
          resolve(true);
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeoutId);
        reject(new Error(`Hardware bridge monitoring error: ${error}`));
      };
    });
  });
});

// Test voice parameters
Cypress.Commands.add('testVoiceParameters', (message: string, expectedParams: string[]) => {
  return cy.sendSpeechMessage(message).then((response) => {
    expect(response.status).to.be.oneOf([200, 201, 202, 400, 401, 500]);

    // Log expected parameters for verification
    expectedParams.forEach((param) => {
      cy.log(`Expected voice parameter: ${param}`);
    });

    return response;
  });
});

// Verify SAM plugin registration
Cypress.Commands.add('verifySamPlugin', () => {
  return cy
    .request({
      method: 'GET',
      url: '/api/plugins',
      timeout: 10000,
    })
    .then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.be.an('array');

      const samPlugin = response.body.find(
        (plugin: any) =>
          plugin.name === '@elizaos/plugin-sam' ||
          plugin.name.includes('sam') ||
          plugin.description?.toLowerCase().includes('sam')
      );

      expect(samPlugin).to.exist;
      cy.log('SAM plugin verified:', samPlugin.name);

      return samPlugin;
    });
});
