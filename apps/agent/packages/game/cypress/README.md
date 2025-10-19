# ElizaOS E2E Test Suite

## Overview

This is the consolidated E2E test suite for ElizaOS game interface. It tests all major functionality through 7 comprehensive test files.

## Test Structure

1. **01-setup-and-configuration.cy.ts** - Initial setup wizard, API key configuration, and persistence
2. **02-backend-api.cy.ts** - All backend API endpoints, health checks, and error handling
3. **03-capabilities.cy.ts** - Autonomy, vision, shell, browser toggles and settings
4. **04-knowledge-management.cy.ts** - Document upload, search, deletion, and chunk processing
5. **05-messaging-and-websocket.cy.ts** - WebSocket connection, real-time messaging, and broadcasts
6. **06-ui-navigation.cy.ts** - Tab navigation, chat interface, capability buttons, and UI consistency
7. **07-full-integration.cy.ts** - Complete user journey and all features working together

## Running Tests

```bash
# Run all tests
npm run test:e2e

# Run specific test file
npm run test:e2e -- --spec "cypress/e2e/01-setup-and-configuration.cy.ts"

# Run in headed mode (see browser)
npm run test:e2e:headed

# Open Cypress UI
npm run cypress:open
```

## Prerequisites

1. Backend server running on http://localhost:7777
2. Frontend running on http://localhost:5173
3. Database configured and running
4. Valid API keys (OpenAI or Anthropic) available

## Test Data Cleanup

Tests automatically clean up after themselves:

- Uploaded knowledge documents are deleted
- Test messages use unique room IDs
- Configuration changes are reset
- Temporary files are removed

## Common Issues

1. **WebSocket connection failures** - Ensure backend is running and healthy
2. **API key validation errors** - Check that valid keys are configured
3. **Timeout errors** - Increase timeout values for slower systems
4. **Database errors** - Ensure database is running and migrations are applied
