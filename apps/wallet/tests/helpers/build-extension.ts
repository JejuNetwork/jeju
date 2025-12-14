/**
 * Extension Build Helper
 * 
 * Builds the Jeju wallet extension for E2E testing.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

const ROOT_DIR = path.resolve(__dirname, '../..');

/**
 * Build the Chrome extension for testing
 */
export async function buildJejuExtension(): Promise<string> {
  const extensionPath = path.join(ROOT_DIR, 'dist-ext-chrome');
  
  // Check if already built
  if (existsSync(path.join(extensionPath, 'manifest.json'))) {
    console.log('Using existing extension build');
    return extensionPath;
  }
  
  console.log('Building Chrome extension...');
  execSync('bun run build:ext:chrome', { 
    cwd: ROOT_DIR,
    stdio: 'inherit',
  });
  
  return extensionPath;
}

/**
 * Get the extension ID after loading
 * Chrome assigns a deterministic ID based on the extension's key
 */
export function getExtensionId(): string {
  // The ID is deterministic based on the extension's public key
  // For development, Chrome generates this from the extension path
  // You can find it in chrome://extensions after loading
  return process.env.JEJU_EXTENSION_ID || 'placeholder-extension-id';
}

/**
 * Get the extension popup URL
 */
export function getExtensionPopupUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/popup.html`;
}

/**
 * Get the extension background page URL
 */
export function getExtensionBackgroundUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/background.html`;
}

