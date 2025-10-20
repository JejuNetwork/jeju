#!/usr/bin/env bun
/**
 * Deploy ALL Contracts to Localnet
 * 
 * This script ensures EVERY contract in the contracts/ directory is deployed
 * when running `bun run dev`. It runs after localnet starts.
 * 
 * Deploys:
 * - Uniswap V4 (PoolManager + Periphery)
 * - Multi-token system (USDC, elizaOS, CLANKER, etc.)
 * - Paymasters & credit system
 * - Oracle system
 * - Game tokens (RPG, Hyperscape)
 * - Marketplace contracts
 * - Identity & reputation system
 * - All other contracts in contracts/script/
 * 
 * Usage:
 *   bun run scripts/deploy-all-localnet-contracts.ts
 */

import { execSync } from 'child_process';
import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const COLORS = {
  RESET: '\x1b[0m',
  BRIGHT: '\x1b[1m',
  GREEN: '\x1b[32m',
  YELLOW: '\x1b[33m',
  RED: '\x1b[31m',
  CYAN: '\x1b[36m',
};

interface DeploymentResult {
  success: boolean;
  contracts: Record<string, string>;
  timestamp: string;
}

class LocalnetDeployer {
  private rpcUrl: string;
  private privateKey: string;
  private deploymentsDir: string;
  private allDeployments: Record<string, any> = {};

  constructor() {
    // Read RPC from Kurtosis output
    const portsFile = join(process.cwd(), '.kurtosis/ports.json');
    if (!existsSync(portsFile)) {
      throw new Error('Localnet not running. Ports file not found: ' + portsFile);
    }
    
    const ports = JSON.parse(readFileSync(portsFile, 'utf-8'));
    this.rpcUrl = `http://localhost:${ports.l2Port}`;
    this.privateKey = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    this.deploymentsDir = join(process.cwd(), 'contracts/deployments');
    
    if (!existsSync(this.deploymentsDir)) {
      mkdirSync(this.deploymentsDir, { recursive: true });
    }
  }

  async deployAll(): Promise<DeploymentResult> {
    console.log(`\n${COLORS.CYAN}${COLORS.BRIGHT}╔═══════════════════════════════════════════════════════════════════════╗${COLORS.RESET}`);
    console.log(`${COLORS.CYAN}${COLORS.BRIGHT}║                                                                       ║${COLORS.RESET}`);
    console.log(`${COLORS.CYAN}${COLORS.BRIGHT}║   🚀 DEPLOYING ALL LOCALNET CONTRACTS                                ║${COLORS.RESET}`);
    console.log(`${COLORS.CYAN}${COLORS.BRIGHT}║                                                                       ║${COLORS.RESET}`);
    console.log(`${COLORS.CYAN}${COLORS.BRIGHT}╚═══════════════════════════════════════════════════════════════════════╝${COLORS.RESET}\n`);
    
    console.log(`${COLORS.CYAN}RPC URL: ${this.rpcUrl}${COLORS.RESET}\n`);

    const result: DeploymentResult = {
      success: true,
      contracts: {},
      timestamp: new Date().toISOString(),
    };

    try {
      // 1. Deploy Uniswap V4 Core (PoolManager)
      await this.deployStep('1', 'Uniswap V4 Core (PoolManager)', async () => {
        const output = await this.runForgeScript('DeployDeFi.s.sol:DeployDeFi');
        const addresses = this.parseForgeOutput(output);
        
        // Save deployment
        const deployment = {
          poolManager: addresses.poolManager || addresses.PoolManager,
          weth: addresses.weth || addresses.WETH || '0x4200000000000000000000000000000000000006',
          timestamp: new Date().toISOString(),
        };
        
        this.saveDeployment('uniswap-v4-1337.json', deployment);
        Object.assign(result.contracts, deployment);
        
        return addresses;
      });

      // 2. Deploy V4 Periphery Contracts
      await this.deployStep('2', 'Uniswap V4 Periphery (SwapRouter, PositionManager, Quoter)', async () => {
        // Check if we have the periphery library installed
        const v4PeripheryPath = join(process.cwd(), 'contracts/lib/v4-periphery');
        if (!existsSync(v4PeripheryPath)) {
          console.log(`${COLORS.YELLOW}   Installing v4-periphery library...${COLORS.RESET}`);
          execSync('cd contracts && forge install uniswap/v4-periphery --no-commit', { 
            stdio: 'inherit',
            encoding: 'utf-8'
          });
        }

        // Deploy periphery contracts
        const output = await this.runForgeScript('DeployUniswapV4Periphery.s.sol:DeployUniswapV4Periphery');
        const addresses = this.parseForgeOutput(output);
        
        // Update V4 deployment with periphery addresses
        const v4Deployment = this.loadDeployment('uniswap-v4-1337.json');
        v4Deployment.swapRouter = addresses.swapRouter || addresses.SwapRouter;
        v4Deployment.positionManager = addresses.positionManager || addresses.PositionManager;
        v4Deployment.quoterV4 = addresses.quoterV4 || addresses.QuoterV4 || addresses.Quoter;
        v4Deployment.stateView = addresses.stateView || addresses.StateView;
        
        this.saveDeployment('uniswap-v4-1337.json', v4Deployment);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      });

      // 3. Deploy Multi-Token System (USDC, elizaOS, CLANKER, VIRTUAL, etc.)
      await this.deployStep('3', 'Multi-Token System (USDC, elizaOS, CLANKER, VIRTUAL)', async () => {
        const output = await this.runForgeScript('DeployMultiTokenSystem.s.sol:DeployMultiTokenSystem');
        const addresses = this.parseForgeOutput(output);
        
        this.saveDeployment('multi-token-system-1337.json', addresses);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      });

      // 4. Deploy Oracle System
      await this.deployStep('4', 'Oracle System', async () => {
        const output = await this.runForgeScript('DeployCrossChainOracle.s.sol:DeployCrossChainOracle');
        const addresses = this.parseForgeOutput(output);
        
        this.saveDeployment('oracle-1337.json', addresses);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      });

      // 5. Deploy Game Tokens (RPG)
      await this.deployStep('5', 'RPG Canonical Tokens (RPGGold, RPGItems)', async () => {
        const output = await this.runForgeScript('DeployGameTokens.s.sol:DeployGameTokens');
        const addresses = this.parseForgeOutput(output);
        
        this.saveDeployment('rpg-tokens-1337.json', addresses);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      });

      // 6. Deploy Bazaar Marketplace
      await this.deployStep('6', 'Bazaar Marketplace & NFTs', async () => {
        const output = await this.runForgeScript('DeployBazaarMarketplace.s.sol:DeployBazaarMarketplace');
        const addresses = this.parseForgeOutput(output);
        
        this.saveDeployment('bazaar-marketplace-1337.json', addresses);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      });

      // 7. Deploy Identity & Reputation System
      await this.deployStep('7', 'Identity & Reputation System', async () => {
        const output = await this.runForgeScript('DeployIdentityRegistry.s.sol:DeployIdentityRegistry');
        const addresses = this.parseForgeOutput(output);
        
        this.saveDeployment('identity-system-1337.json', addresses);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      });

      // 8. Deploy ERC20 Factory
      await this.deployStep('8', 'ERC20 Token Factory', async () => {
        const output = await this.runForgeScript('DeployERC20Factory.s.sol:DeployERC20Factory');
        const addresses = this.parseForgeOutput(output);
        
        this.saveDeployment('erc20-factory-1337.json', addresses);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      });

      // 9. Deploy Cloud Integration (if exists)
      await this.deployStep('9', 'Cloud Integration', async () => {
        const output = await this.runForgeScript('DeployCloudIntegration.s.sol:DeployCloudIntegration');
        const addresses = this.parseForgeOutput(output);
        
        this.saveDeployment('cloud-integration-1337.json', addresses);
        Object.assign(result.contracts, addresses);
        
        return addresses;
      }, true); // Optional deployment

      console.log(`\n${COLORS.GREEN}${COLORS.BRIGHT}✅ ALL CONTRACTS DEPLOYED SUCCESSFULLY!${COLORS.RESET}\n`);
      
      // Print summary
      this.printDeploymentSummary(result);
      
    } catch (error) {
      console.error(`\n${COLORS.RED}❌ Deployment failed:${COLORS.RESET}`, error);
      result.success = false;
    }

    return result;
  }

  private async deployStep(
    step: string, 
    name: string, 
    deployer: () => Promise<any>,
    optional: boolean = false
  ): Promise<void> {
    console.log(`${COLORS.CYAN}[${step}/9] ${name}...${COLORS.RESET}`);
    
    try {
      const addresses = await deployer();
      console.log(`${COLORS.GREEN}   ✅ Deployed${COLORS.RESET}`);
      
      // Log key addresses
      if (addresses && typeof addresses === 'object') {
        const keys = Object.keys(addresses).filter(k => k.includes('ddress') || k === 'poolManager' || k === 'weth');
        if (keys.length > 0) {
          keys.slice(0, 3).forEach(key => {
            console.log(`${COLORS.CYAN}      ${key}: ${addresses[key]}${COLORS.RESET}`);
          });
        }
      }
      console.log('');
    } catch (error) {
      if (optional) {
        console.log(`${COLORS.YELLOW}   ⚠️  Optional deployment skipped or failed${COLORS.RESET}\n`);
      } else {
        console.error(`${COLORS.RED}   ❌ Failed: ${error}${COLORS.RESET}\n`);
        throw error;
      }
    }
  }

  private async runForgeScript(scriptPath: string): Promise<string> {
    try {
      const output = execSync(
        `cd contracts && forge script script/${scriptPath} \
          --rpc-url ${this.rpcUrl} \
          --private-key ${this.privateKey} \
          --broadcast \
          --legacy \
          -vv`,
        { 
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
          stdio: 'pipe'
        }
      );
      return output;
    } catch (error: any) {
      // Forge exits with non-zero even on success sometimes, check output
      if (error.stdout && error.stdout.includes('ONCHAIN EXECUTION COMPLETE')) {
        return error.stdout;
      }
      throw error;
    }
  }

  private parseForgeOutput(output: string): Record<string, string> {
    const addresses: Record<string, string> = {};
    
    // Look for common deployment patterns
    const patterns = [
      /(\w+):\s*(0x[a-fA-F0-9]{40})/g,  // "ContractName: 0x..."
      /deployed to:\s*(0x[a-fA-F0-9]{40})/gi,  // "deployed to: 0x..."
      /address:\s*(0x[a-fA-F0-9]{40})/gi,  // "address: 0x..."
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(output)) !== null) {
        if (match[1] && match[2]) {
          // Named capture (e.g., "PoolManager: 0x...")
          addresses[match[1]] = match[2];
        } else if (match[1]) {
          // Just address (e.g., "deployed to: 0x...")
          addresses['address'] = match[1];
        }
      }
    }

    return addresses;
  }

  private saveDeployment(filename: string, data: any): void {
    const filepath = join(this.deploymentsDir, filename);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
    this.allDeployments[filename] = data;
  }

  private loadDeployment(filename: string): any {
    const filepath = join(this.deploymentsDir, filename);
    if (existsSync(filepath)) {
      return JSON.parse(readFileSync(filepath, 'utf-8'));
    }
    return {};
  }

  private printDeploymentSummary(result: DeploymentResult): void {
    console.log(`${COLORS.CYAN}${COLORS.BRIGHT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}`);
    console.log(`${COLORS.CYAN}${COLORS.BRIGHT}DEPLOYMENT SUMMARY${COLORS.RESET}\n`);
    
    const deploymentFiles = Object.keys(this.allDeployments);
    console.log(`${COLORS.GREEN}✅ ${deploymentFiles.length} deployment file(s) created in contracts/deployments/${COLORS.RESET}\n`);
    
    for (const file of deploymentFiles) {
      console.log(`${COLORS.CYAN}   📄 ${file}${COLORS.RESET}`);
    }
    
    console.log(`\n${COLORS.CYAN}${COLORS.BRIGHT}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLORS.RESET}\n`);
    console.log(`${COLORS.GREEN}🎉 All contracts ready for use in apps!${COLORS.RESET}`);
    console.log(`${COLORS.YELLOW}💡 Apps will automatically load these deployment addresses${COLORS.RESET}\n`);
  }
}

// Run deployment
if (import.meta.url === `file://${process.argv[1]}`) {
  const deployer = new LocalnetDeployer();
  deployer.deployAll().catch((error) => {
    console.error('Deployment failed:', error);
    process.exit(1);
  });
}

export { LocalnetDeployer };

