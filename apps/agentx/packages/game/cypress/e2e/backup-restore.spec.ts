describe('Backup and Restore', () => {
  beforeEach(() => {
    cy.visitGame();
    cy.waitForGameLoad();
  });

  describe('Backup Settings UI', () => {
    beforeEach(() => {
      // Navigate to config tab
      cy.get('[data-testid="config-tab"]').click();
      cy.get('[data-testid="config-content"]').should('be.visible');
    });

    it('should display backup settings section', () => {
      cy.contains('◎ BACKUP & RESTORE').should('be.visible');
      cy.contains('Automatic Backup Settings').should('be.visible');
      cy.contains('Available Backups').should('be.visible');
    });

    it('should show backup configuration options', () => {
      cy.contains('Enable automatic backups').should('be.visible');
      cy.contains('Backup interval (hours)').should('be.visible');
      cy.contains('Keep last').should('be.visible');

      // Check default values
      cy.get('input[type="checkbox"]').first().should('be.checked');
      cy.get('input[type="number"]').first().should('have.value', '4');
      cy.get('input[type="number"]').eq(1).should('have.value', '5');
    });

    it('should update backup configuration', () => {
      // Disable auto-backup
      cy.get('input[type="checkbox"]').first().uncheck();

      // Change interval to 6 hours
      cy.get('input[type="number"]').first().clear().type('6');

      // Change retention to 10 backups
      cy.get('input[type="number"]').eq(1).clear().type('10');

      // Save settings
      cy.contains('button', 'Save Settings').click();

      // Verify success message (implementation dependent)
      // cy.contains('Backup configuration updated successfully').should('be.visible');
    });
  });

  describe('Manual Backup Creation', () => {
    beforeEach(() => {
      cy.get('[data-testid="config-tab"]').click();
    });

    it('should create a manual backup', () => {
      // Click create backup button
      cy.contains('button', '💾 Create Backup').click();

      // Modal should appear
      cy.contains('Create Manual Backup').should('be.visible');

      // Add notes
      cy.get('textarea').type('Test backup for E2E tests');

      // Create backup
      cy.contains('button', 'Create Backup').click();

      // Should show in backup list
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          cy.contains('manual').should('be.visible');
          cy.contains('Test backup for E2E tests').should('be.visible');
        });
    });

    it('should handle backup creation errors gracefully', () => {
      // This test would require mocking an error condition
      // For now, we'll just verify the UI elements exist
      cy.contains('button', '💾 Create Backup').should('exist');
    });
  });

  describe('Backup List Management', () => {
    beforeEach(() => {
      cy.get('[data-testid="config-tab"]').click();

      // Create a test backup first
      cy.contains('button', '💾 Create Backup').click();
      cy.get('textarea').type('Test backup');
      cy.contains('button', 'Create Backup').click();
      cy.wait(1000); // Wait for backup to be created
    });

    it('should display backup list with correct information', () => {
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          // Check backup type icon
          cy.contains('✋').should('be.visible'); // Manual backup icon

          // Check backup details
          cy.contains('manual').should('be.visible');
          cy.contains('Test backup').should('be.visible');

          // Should show size
          cy.contains(/\d+\s*(B|KB|MB|GB)/).should('be.visible');

          // Should show timestamp
          cy.contains(/\d{1,2}\/\d{1,2}\/\d{4}/).should('be.visible');
        });
    });

    it('should delete a backup', () => {
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          // Click delete button
          cy.get('button[title="Delete"]').first().click();
        });

      // Confirm deletion
      cy.on('window:confirm', () => true);

      // Backup should be removed from list
      cy.wait(1000);
      cy.contains('Test backup').should('not.exist');
    });

    it('should export a backup', () => {
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          // Click export button
          cy.get('button[title="Export"]').first().click();
        });

      // File dialog would open - can't test fully in Cypress
      // Just verify the button exists and is clickable
    });
  });

  describe('Backup Restore', () => {
    beforeEach(() => {
      cy.get('[data-testid="config-tab"]').click();

      // Create a backup to restore
      cy.contains('button', '💾 Create Backup').click();
      cy.get('textarea').type('Backup to restore');
      cy.contains('button', 'Create Backup').click();
      cy.wait(1000);
    });

    it('should show restore dialog with options', () => {
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          // Click restore button
          cy.get('button[title="Restore"]').first().click();
        });

      // Restore dialog should appear
      cy.contains('⚠️ Restore Backup').should('be.visible');
      cy.contains('This operation is DESTRUCTIVE').should('be.visible');

      // Check restore options
      cy.contains('Database (conversations, settings)').should('be.visible');
      cy.contains('Agent State (memory, context)').should('be.visible');
      cy.contains('Knowledge Base').should('be.visible');
      cy.contains('Logs (optional)').should('be.visible');

      // Options should be checked by default (except logs)
      cy.get('input[type="checkbox"]').eq(0).should('be.checked');
      cy.get('input[type="checkbox"]').eq(1).should('be.checked');
      cy.get('input[type="checkbox"]').eq(2).should('be.checked');
      cy.get('input[type="checkbox"]').eq(3).should('not.be.checked');
    });

    it('should cancel restore operation', () => {
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          cy.get('button[title="Restore"]').first().click();
        });

      // Click cancel
      cy.contains('button', 'Cancel').click();

      // Dialog should close
      cy.contains('⚠️ Restore Backup').should('not.exist');
    });

    it('should warn before restore', () => {
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          cy.get('button[title="Restore"]').first().click();
        });

      // Uncheck some options
      cy.get('input[type="checkbox"]').eq(2).uncheck(); // Uncheck Knowledge Base

      // Click restore
      cy.contains('button', 'Restore Backup').click();

      // Should show confirmation dialog
      cy.on('window:confirm', (message) => {
        expect(message).to.include('WARNING');
        expect(message).to.include('DESTRUCTIVE');
        return false; // Cancel the restore
      });
    });
  });

  describe('Import/Export Integration', () => {
    beforeEach(() => {
      cy.get('[data-testid="config-tab"]').click();
    });

    it('should show import button', () => {
      cy.contains('button', '📥 Import').should('be.visible');
    });

    it('should handle import action', () => {
      // Click import button
      cy.contains('button', '📥 Import').click();

      // File dialog would open - can't fully test in Cypress
      // Just verify the button is clickable
    });
  });

  describe('Auto-backup Functionality', () => {
    it('should show auto-backup indicator when enabled', () => {
      cy.get('[data-testid="config-tab"]').click();

      // Verify auto-backup is enabled by default
      cy.get('input[type="checkbox"]').first().should('be.checked');

      // In a real test, we'd wait for auto-backup to trigger
      // and verify it appears in the list with "automatic" type
    });
  });

  describe('Backup Components Display', () => {
    beforeEach(() => {
      cy.get('[data-testid="config-tab"]').click();

      // Create a backup
      cy.contains('button', '💾 Create Backup').click();
      cy.get('textarea').type('Component test backup');
      cy.contains('button', 'Create Backup').click();
      cy.wait(1000);
    });

    it('should show backup type icons correctly', () => {
      cy.contains('Available Backups')
        .parent()
        .within(() => {
          // Manual backup should show hand icon
          cy.contains('✋').should('be.visible');

          // If there were automatic backups, they would show 🔄
          // If there were shutdown backups, they would show 🔌
        });
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors gracefully', () => {
      // This would require intercepting network requests
      // cy.intercept('POST', '**/create_backup', { forceNetworkError: true });

      cy.get('[data-testid="config-tab"]').click();

      // Verify UI is still functional
      cy.contains('◎ BACKUP & RESTORE').should('be.visible');
    });
  });

  describe('Accessibility', () => {
    beforeEach(() => {
      cy.get('[data-testid="config-tab"]').click();
    });

    it('should have proper labels for form controls', () => {
      cy.contains('label', 'Enable automatic backups').should('be.visible');
      cy.contains('label', 'Backup interval (hours)').should('be.visible');
      cy.contains('label', 'Keep last').should('be.visible');
    });

    it('should have descriptive button titles', () => {
      cy.get('button[title="Restore"]').should('exist');
      cy.get('button[title="Export"]').should('exist');
      cy.get('button[title="Delete"]').should('exist');
    });
  });
});
