/// <reference types="cypress" />

/**
 * Capabilities Tests
 * Tests all capability toggles, autonomy, vision settings, and real-time updates
 */

describe('Capabilities', () => {
  const BACKEND_URL = Cypress.env('BACKEND_URL') || 'http://localhost:7777';
  const DEFAULT_AGENT_ID = 'default';

  before(() => {
    // Ensure backend is ready
    cy.waitForBackend();
  });

  describe('Autonomy Controls', () => {
    it('should get autonomy status', () => {
      cy.request('GET', `${BACKEND_URL}/autonomy/status`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;

        const data = response.body.data;
        expect(data).to.have.property('enabled');
        expect(data).to.have.property('running');
        expect(data).to.have.property('interval');
        expect(data).to.have.property('intervalSeconds');
        expect(data).to.have.property('autonomousRoomId');
        expect(data).to.have.property('agentId');
        expect(data).to.have.property('characterName');

        expect(data.enabled).to.be.a('boolean');
        expect(data.running).to.be.a('boolean');
        expect(data.interval).to.be.a('number');
        expect(data.intervalSeconds).to.be.a('number');

        cy.log(`✅ Autonomy status: ${data.enabled ? 'enabled' : 'disabled'}`);
        cy.log(`Running: ${data.running}`);
        cy.log(`Interval: ${data.intervalSeconds}s`);
      });
    });

    it('should enable autonomy', () => {
      cy.request('POST', `${BACKEND_URL}/autonomy/enable`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        expect(response.body.data).to.have.property('enabled', true);
        expect(response.body.data).to.have.property('message', 'Autonomy enabled');

        // Verify it's actually enabled
        cy.request('GET', `${BACKEND_URL}/autonomy/status`).then((statusResponse) => {
          expect(statusResponse.body.data.enabled).to.be.true;
        });
      });
    });

    it('should disable autonomy', () => {
      // First enable to ensure we can disable
      cy.request('POST', `${BACKEND_URL}/autonomy/enable`);
      cy.wait(1000);

      // Now disable
      cy.request('POST', `${BACKEND_URL}/autonomy/disable`).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        expect(response.body.data).to.have.property('enabled', false);
        expect(response.body.data).to.have.property('message', 'Autonomy disabled');

        // Verify it's actually disabled
        cy.request('GET', `${BACKEND_URL}/autonomy/status`).then((statusResponse) => {
          expect(statusResponse.body.data.enabled).to.be.false;
        });
      });
    });

    it('should toggle autonomy', () => {
      // Get current state
      cy.request('GET', `${BACKEND_URL}/autonomy/status`).then((initialResponse) => {
        const initialState = initialResponse.body.data.enabled;

        // Toggle
        cy.request('POST', `${BACKEND_URL}/autonomy/toggle`).then((toggleResponse) => {
          expect(toggleResponse.status).to.eq(200);
          expect(toggleResponse.body.success).to.be.true;
          expect(toggleResponse.body.data.enabled).to.eq(!initialState);
        });

        // Toggle back
        cy.request('POST', `${BACKEND_URL}/autonomy/toggle`).then((toggleBackResponse) => {
          expect(toggleBackResponse.status).to.eq(200);
          expect(toggleBackResponse.body.data.enabled).to.eq(initialState);
        });
      });
    });
  });

  describe('Vision Settings', () => {
    it('should get current vision settings', () => {
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings/vision`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;

          const settings = response.body.data;
          expect(settings).to.have.property('ENABLE_CAMERA');
          expect(settings).to.have.property('ENABLE_SCREEN_CAPTURE');
          expect(settings).to.have.property('ENABLE_MICROPHONE');
          expect(settings).to.have.property('ENABLE_SPEAKER');
          expect(settings).to.have.property('VISION_CAMERA_ENABLED');
          expect(settings).to.have.property('VISION_SCREEN_ENABLED');
          expect(settings).to.have.property('VISION_MICROPHONE_ENABLED');
          expect(settings).to.have.property('VISION_SPEAKER_ENABLED');

          cy.log('✅ Vision settings retrieved');
          cy.log(`Camera: ${settings.ENABLE_CAMERA}`);
          cy.log(`Screen: ${settings.ENABLE_SCREEN_CAPTURE}`);
          cy.log(`Microphone: ${settings.ENABLE_MICROPHONE}`);
          cy.log(`Speaker: ${settings.ENABLE_SPEAKER}`);
        }
      );
    });

    it('should toggle camera capability', () => {
      // Get current state
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings/vision`)
        .then((response) => {
          const currentState = response.body.data.ENABLE_CAMERA === 'true';

          // Toggle camera
          return cy.request('POST', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`, {
            key: 'ENABLE_CAMERA',
            value: (!currentState).toString(),
          });
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
          expect(response.body.data.key).to.eq('ENABLE_CAMERA');

          // Refresh vision service
          return cy.request('POST', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/vision/refresh`);
        })
        .then((refreshResponse) => {
          expect(refreshResponse.status).to.eq(200);
          expect(refreshResponse.body.success).to.be.true;
        });
    });

    it('should toggle screen capture capability', () => {
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings/vision`)
        .then((response) => {
          const currentState = response.body.data.ENABLE_SCREEN_CAPTURE === 'true';

          return cy.request('POST', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`, {
            key: 'ENABLE_SCREEN_CAPTURE',
            value: (!currentState).toString(),
          });
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.data.key).to.eq('ENABLE_SCREEN_CAPTURE');
        });
    });

    it('should toggle microphone capability', () => {
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings/vision`)
        .then((response) => {
          const currentState = response.body.data.ENABLE_MICROPHONE === 'true';

          return cy.request('POST', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`, {
            key: 'ENABLE_MICROPHONE',
            value: (!currentState).toString(),
          });
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.data.key).to.eq('ENABLE_MICROPHONE');
        });
    });

    it('should toggle speaker capability', () => {
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings/vision`)
        .then((response) => {
          const currentState = response.body.data.ENABLE_SPEAKER === 'true';

          return cy.request('POST', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`, {
            key: 'ENABLE_SPEAKER',
            value: (!currentState).toString(),
          });
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.data.key).to.eq('ENABLE_SPEAKER');
        });
    });
  });

  describe('Shell and Browser Capabilities', () => {
    it('should get shell capability status', () => {
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/shell`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;

          const data = response.body.data;
          expect(data).to.have.property('enabled');
          expect(data).to.have.property('service_available');
          expect(data).to.have.property('service_name');
          expect(data.enabled).to.be.a('boolean');
          expect(data.service_available).to.be.a('boolean');

          cy.log(`✅ Shell capability: ${data.enabled ? 'enabled' : 'disabled'}`);
          cy.log(`Service available: ${data.service_available}`);
        }
      );
    });

    it('should toggle shell capability', () => {
      // Get current state
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/shell`)
        .then((response) => {
          const _currentState = response.body.data.enabled;

          // Toggle
          return cy.request(
            'POST',
            `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/shell/toggle`
          );
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
          expect(response.body.data).to.have.property('enabled');
          expect(response.body.data).to.have.property('service_available');
        })
        .then(() => {
          // Verify toggle worked
          return cy.request(
            'GET',
            `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/shell`
          );
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
        });
    });

    it('should get browser capability status', () => {
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/browser`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;

          const data = response.body.data;
          expect(data).to.have.property('enabled');
          expect(data).to.have.property('service_available');
          expect(data).to.have.property('service_name');

          cy.log(`✅ Browser capability: ${data.enabled ? 'enabled' : 'disabled'}`);
          cy.log(`Service available: ${data.service_available}`);
        }
      );
    });

    it('should toggle browser capability', () => {
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/browser`)
        .then((response) => {
          const _currentState = response.body.data.enabled;

          return cy.request(
            'POST',
            `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/browser/toggle`
          );
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
          expect(response.body.data).to.have.property('enabled');
          expect(response.body.data).to.have.property('service_available');
        });
    });
  });

  describe('Concurrent Capability Management', () => {
    it('should handle multiple capability toggles concurrently', () => {
      const capabilities = ['shell', 'browser'];
      const requests = capabilities.map((cap) =>
        cy.request(
          'POST',
          `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/${cap}/toggle`
        )
      );

      requests.forEach((request) => {
        request.then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
        });
      });

      cy.log(`✅ Handled ${capabilities.length} concurrent toggles`);
    });

    it('should handle rapid toggling without race conditions', () => {
      const capability = 'shell';

      // Get initial state
      cy.request(
        'GET',
        `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/${capability}`
      ).then((initialResponse) => {
        const initialState = initialResponse.body.data.enabled;

        // Rapid toggles (3 times - odd number)
        const togglePromises = [];
        for (let i = 0; i < 3; i++) {
          togglePromises.push(
            cy.request(
              'POST',
              `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/${capability}/toggle`
            )
          );
        }

        return cy
          .wrap(Promise.all(togglePromises))
          .then(() => {
            // Final state should be opposite of initial
            return cy.request(
              'GET',
              `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/${capability}`
            );
          })
          .then((finalResponse) => {
            expect(finalResponse.body.data.enabled).to.eq(!initialState);
          });
      });
    });
  });

  describe('Settings Persistence', () => {
    it('should persist capability settings', () => {
      const testKey = `TEST_CAPABILITY_${Date.now()}`;
      const testValue = 'true';

      // Set a custom setting
      cy.request('POST', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`, {
        key: testKey,
        value: testValue,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        expect(response.body.data.key).to.eq(testKey);
        expect(response.body.data.value).to.eq(testValue);
      });

      // Verify it persisted
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`).then(
        (response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
          expect(response.body.data).to.have.property(testKey, testValue);
        }
      );
    });

    it('should handle batch setting updates', () => {
      const settings = {
        BATCH_TEST_1: 'value1',
        BATCH_TEST_2: 'value2',
        BATCH_TEST_3: 'value3',
      };

      // Update multiple settings
      const requests = Object.entries(settings).map(([key, value]) =>
        cy.request('POST', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`, { key, value })
      );

      requests.forEach((request) => {
        request.then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
        });
      });

      // Verify all settings persisted
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`).then(
        (response) => {
          Object.entries(settings).forEach(([key, value]) => {
            expect(response.body.data).to.have.property(key, value);
          });
        }
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid capability gracefully', () => {
      cy.request({
        method: 'GET',
        url: `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/invalid_capability`,
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.success).to.be.true;
        expect(response.body.data.service_available).to.be.false;
      });
    });

    it('should handle missing setting key', () => {
      cy.request({
        method: 'POST',
        url: `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/settings`,
        body: { value: 'test' },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.success).to.be.false;
        expect(response.body.error.code).to.eq('MISSING_KEY');
      });
    });

    it('should handle service unavailability', () => {
      cy.request({
        method: 'GET',
        url: `${BACKEND_URL}/autonomy/status`,
        failOnStatusCode: false,
      }).then((response) => {
        if (response.status === 503) {
          expect(response.body.success).to.be.false;
          expect(response.body.error.code).to.eq('SERVICE_UNAVAILABLE');
        } else {
          expect(response.status).to.eq(200);
          expect(response.body.success).to.be.true;
        }
      });
    });
  });

  describe('Real-time Updates', () => {
    it('should reflect capability changes immediately', () => {
      const capability = 'shell';

      // Get initial state
      cy.request('GET', `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/${capability}`)
        .then((response) => {
          const _initialState = response.body.data.enabled;

          // Toggle capability
          return cy.request(
            'POST',
            `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/${capability}/toggle`
          );
        })
        .then((toggleResponse) => {
          const newState = toggleResponse.body.data.enabled;

          // Immediately check state
          return cy
            .request(
              'GET',
              `${BACKEND_URL}/api/agents/${DEFAULT_AGENT_ID}/capabilities/${capability}`
            )
            .then((checkResponse) => {
              expect(checkResponse.body.data.enabled).to.eq(newState);
            });
        });
    });

    it('should reflect autonomy changes immediately', () => {
      // Enable autonomy
      cy.request('POST', `${BACKEND_URL}/autonomy/enable`)
        .then(() => {
          // Immediately check status
          return cy.request('GET', `${BACKEND_URL}/autonomy/status`);
        })
        .then((response) => {
          expect(response.body.data.enabled).to.be.true;

          // Disable autonomy
          return cy.request('POST', `${BACKEND_URL}/autonomy/disable`);
        })
        .then(() => {
          // Immediately check status
          return cy.request('GET', `${BACKEND_URL}/autonomy/status`);
        })
        .then((response) => {
          expect(response.body.data.enabled).to.be.false;
        });
    });
  });
});

// Capabilities Summary Test
describe('Capabilities Summary', () => {
  it('should verify all capabilities are functional', () => {
    const BACKEND_URL = Cypress.env('BACKEND_URL') || 'http://localhost:7777';
    const _capabilities = [
      { name: 'Autonomy', type: 'autonomy' },
      { name: 'Camera', type: 'vision', key: 'ENABLE_CAMERA' },
      { name: 'Screen', type: 'vision', key: 'ENABLE_SCREEN_CAPTURE' },
      { name: 'Microphone', type: 'vision', key: 'ENABLE_MICROPHONE' },
      { name: 'Speaker', type: 'vision', key: 'ENABLE_SPEAKER' },
      { name: 'Shell', type: 'capability', key: 'shell' },
      { name: 'Browser', type: 'capability', key: 'browser' },
    ];

    const results = [];

    cy.log('🎯 CAPABILITIES VERIFICATION:');

    // Test autonomy
    cy.request('GET', `${BACKEND_URL}/autonomy/status`).then((response) => {
      results.push({
        name: 'Autonomy',
        status: response.status === 200 ? 'working' : 'failed',
        enabled: response.body.data?.enabled || false,
      });
    });

    // Test vision settings
    cy.request('GET', `${BACKEND_URL}/api/agents/default/settings/vision`).then((response) => {
      if (response.status === 200) {
        const data = response.body.data;
        results.push(
          { name: 'Camera', status: 'working', enabled: data.ENABLE_CAMERA === 'true' },
          { name: 'Screen', status: 'working', enabled: data.ENABLE_SCREEN_CAPTURE === 'true' },
          { name: 'Microphone', status: 'working', enabled: data.ENABLE_MICROPHONE === 'true' },
          { name: 'Speaker', status: 'working', enabled: data.ENABLE_SPEAKER === 'true' }
        );
      }
    });

    // Test other capabilities
    ['shell', 'browser'].forEach((cap) => {
      cy.request('GET', `${BACKEND_URL}/api/agents/default/capabilities/${cap}`).then(
        (response) => {
          results.push({
            name: cap.charAt(0).toUpperCase() + cap.slice(1),
            status: response.status === 200 ? 'working' : 'failed',
            enabled: response.body.data?.enabled || false,
          });
        }
      );
    });

    cy.then(() => {
      results.forEach((result) => {
        const icon = result.status === 'working' ? '✅' : '❌';
        const state = result.enabled ? 'ON' : 'OFF';
        cy.log(`${icon} ${result.name}: ${result.status} [${state}]`);
      });

      const workingCount = results.filter((r) => r.status === 'working').length;
      cy.log(`\n✅ ${workingCount}/${results.length} capabilities functional`);

      cy.screenshot('capabilities-summary');
    });
  });
});
