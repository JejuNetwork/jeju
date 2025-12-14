/**
 * Extension Build Helper
 * 
 * Builds the wallet extension for E2E testing.
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

/**
 * Build the Chrome extension for testing
 */
export async function buildNetworkExtension(): Promise<string> {
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
 * Get the extension popup URL
 */
export function getExtensionPopupUrl(extensionId: string): string {
  return `chrome-extension://${extensionId}/popup.html`;
}
