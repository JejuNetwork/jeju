import { test, expect } from '@playwright/test';
import { captureScreenshot, captureUserFlow } from '../../../../tests/shared/helpers/screenshots';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { ethers } from 'ethers';

// Load config if exists, otherwise skip
const configPath = join(__dirname, '../test-config.json');
const hasConfig = existsSync(configPath);

test.describe('eHorse On-Chain Race Creation', () => {
  test.skip(!hasConfig, 'Test config not found - run bun run test:setup first');
  
  test('should deploy EHorseGame contract', async () => {
    if (!hasConfig) return;
    
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    
    const gameAddress = process.env.EHORSE_GAME_ADDRESS || config.addresses?.ehorseGame;
    
    if (!gameAddress) {
      console.log('⚠️  EHorseGame not deployed yet');
      return;
    }
    
    // Check contract exists
    const code = await provider.getCode(gameAddress);
    expect(code).not.toBe('0x');
    expect(code.length).toBeGreaterThan(2);
    
    console.log(`✅ EHorseGame deployed at: ${gameAddress}`);
  });
  
  test('should have correct game metadata', async () => {
    if (!hasConfig) return;
    
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const gameAddress = process.env.EHORSE_GAME_ADDRESS || config.addresses?.ehorseGame;
    
    if (!gameAddress) return;
    
    const gameABI = [
      'function GAME_NAME() view returns (string)',
      'function GAME_VERSION() view returns (string)',
      'function GAME_CATEGORY() view returns (string)',
      'function getHorseNames() view returns (string[])'
    ];
    
    const game = new ethers.Contract(gameAddress, gameABI, provider);
    
    const name = await game.GAME_NAME();
    const version = await game.GAME_VERSION();
    const category = await game.GAME_CATEGORY();
    const horses = await game.getHorseNames();
    
    expect(name).toBe('eHorse Racing');
    expect(version).toBe('1.0.0');
    expect(category).toBe('racing');
    expect(horses.length).toBe(4);
    expect(horses[0]).toBe('Thunder');
    expect(horses[1]).toBe('Lightning');
    expect(horses[2]).toBe('Storm');
    expect(horses[3]).toBe('Blaze');
    
    console.log(`✅ Game metadata verified`);
    console.log(`   Name: ${name}`);
    console.log(`   Version: ${version}`);
    console.log(`   Horses: ${horses.join(', ')}`);
  });
  
  test('should allow keeper to create race', async () => {
    if (!hasConfig) return;
    
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const gameAddress = process.env.EHORSE_GAME_ADDRESS || config.addresses?.ehorseGame;
    
    if (!gameAddress) return;
    
    // Use keeper wallet
    const keeperKey = config.testWallets[0].key; // Deployer is keeper
    const keeper = new ethers.Wallet(keeperKey, provider);
    
    const gameABI = [
      'function createRace(bytes32 commitment, uint256 scheduledStart) external returns (bytes32)',
      'function raceCount() view returns (uint256)',
      'event RaceCreated(bytes32 indexed raceId, uint256 startTime)'
    ];
    
    const game = new ethers.Contract(gameAddress, gameABI, keeper);
    
    const countBefore = await game.raceCount();
    
    // Create commitment
    const winner = 2; // Storm
    const salt = ethers.randomBytes(32);
    const commitment = ethers.keccak256(
      ethers.solidityPacked(['uint256', 'bytes32'], [winner, salt])
    );
    
    const startTime = Math.floor(Date.now() / 1000) + 60;
    
    console.log(`Creating race with start time: ${new Date(startTime * 1000).toLocaleTimeString()}`);
    
    const tx = await game.createRace(commitment, startTime);
    const receipt = await tx.wait();
    
    const countAfter = await game.raceCount();
    
    expect(countAfter).toBe(countBefore + 1n);
    expect(receipt.status).toBe(1);
    
    console.log(`✅ Race created! Tx: ${receipt.hash}`);
    console.log(`   Race count: ${countBefore} → ${countAfter}`);
  });
});


