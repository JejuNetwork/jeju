/**
 * Network Extension Fixture
 * 
 * Loads the Wallet extension for E2E testing against external dApps
 */

import { test as base, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'path';
import { execSync } from 'child_process';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../..');
const EXTENSION_PATH = path.join(ROOT_DIR, 'dist-ext-chrome');

// Build extension if needed
function ensureExtensionBuilt(): string {
  const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
  
  if (!fs.existsSync(manifestPath)) {
    console.log('Building Network Wallet extension...');
    execSync('bun run build:ext:chrome', { 
      cwd: ROOT_DIR,
      stdio: 'inherit',
    });
  }
  
  return EXTENSION_PATH;
}

// Extended fixture with extension context
interface ExtensionFixtures {
  extensionContext: BrowserContext;
  extensionPage: Page;
  extensionId: string;
  testDappPage: Page;
}

export const test = base.extend<ExtensionFixtures>({
  // Create context with extension loaded
  extensionContext: async ({}, use) => {
    const extensionPath = ensureExtensionBuilt();
    
    // Launch browser with extension
    const context = await chromium.launchPersistentContext('', {
      headless: false, // Extensions require headed mode
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-sandbox',
      ],
      viewport: { width: 1280, height: 720 },
    });
    
    await use(context);
    await context.close();
  },

  // Get extension ID
  extensionId: async ({ extensionContext }, use) => {
    // Wait for service worker to be ready
    let serviceWorker = extensionContext.serviceWorkers()[0];
    if (!serviceWorker) {
      serviceWorker = await extensionContext.waitForEvent('serviceworker');
    }
    
    // Extract extension ID from service worker URL
    const extensionUrl = serviceWorker.url();
    const extensionId = extensionUrl.split('/')[2];
    
    await use(extensionId);
  },

  // Extension popup page
  extensionPage: async ({ extensionContext, extensionId }, use) => {
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const page = await extensionContext.newPage();
    await page.goto(popupUrl);
    await page.waitForLoadState('networkidle');
    
    await use(page);
  },

  // Test dApp page
  testDappPage: async ({ extensionContext }, use) => {
    const testDappPath = path.join(__dirname, '../fixtures/test-dapp/index.html');
    const page = await extensionContext.newPage();
    await page.goto(`file://${testDappPath}`);
    await page.waitForLoadState('networkidle');
    
    await use(page);
  },
});

export { expect } from '@playwright/test';

