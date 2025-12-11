import { describe, expect, test } from 'bun:test';
import { TOKENOMICS } from '../src/config/tokenomics';

describe('Tokenomics Configuration', () => {
  test('allocations sum to 100%', () => {
    const total = Object.values(TOKENOMICS.allocation).reduce(
      (sum, alloc) => sum + alloc.percent,
      0
    );
    expect(total).toBe(100);
  });

  test('presale allocation is 10%', () => {
    expect(TOKENOMICS.allocation.presale.percent).toBe(10);
  });

  test('all vesting schedules have valid TGE percentages', () => {
    for (const [key, alloc] of Object.entries(TOKENOMICS.allocation)) {
      expect(alloc.vesting.tgePercent).toBeGreaterThanOrEqual(0);
      expect(alloc.vesting.tgePercent).toBeLessThanOrEqual(100);
    }
  });

  test('presale config has valid bounds', () => {
    expect(TOKENOMICS.presale.softCap).toBeLessThan(TOKENOMICS.presale.hardCap);
    expect(TOKENOMICS.presale.minContribution).toBeLessThan(TOKENOMICS.presale.maxContribution);
    expect(TOKENOMICS.presale.tokenPrice).toBeGreaterThan(0n);
  });

  test('token has correct max supply', () => {
    expect(TOKENOMICS.maxSupply).toBe(10_000_000_000n * 10n ** 18n);
  });

  test('initial supply is 10% of max', () => {
    expect(TOKENOMICS.initialSupply).toBe(TOKENOMICS.maxSupply / 10n);
  });

  test('whitelist bonus is 10%', () => {
    expect(TOKENOMICS.presale.whitelistBonus).toBe(10);
  });

  test('volume bonuses are properly ordered', () => {
    const bonuses = TOKENOMICS.presale.volumeBonuses;
    for (let i = 0; i < bonuses.length - 1; i++) {
      expect(bonuses[i].minEth).toBeGreaterThan(bonuses[i + 1].minEth);
      expect(bonuses[i].bonus).toBeGreaterThan(bonuses[i + 1].bonus);
    }
  });

  test('utility descriptions exist', () => {
    expect(TOKENOMICS.utility.length).toBeGreaterThan(0);
    for (const util of TOKENOMICS.utility) {
      expect(util.name).toBeTruthy();
      expect(util.description).toBeTruthy();
    }
  });
});

describe('Token Math', () => {
  test('calculate tokens from ETH contribution', () => {
    const ethAmount = 1n * 10n ** 18n; // 1 ETH
    const tokenPrice = TOKENOMICS.presale.tokenPrice;
    const tokens = (ethAmount * 10n ** 18n) / tokenPrice;
    
    // At ~$0.009 per token and $3k ETH, 1 ETH = $3000 / $0.009 = ~333k tokens
    expect(tokens).toBeGreaterThan(10000n * 10n ** 18n);
  });

  test('calculate whitelist bonus', () => {
    const baseTokens = 20000n * 10n ** 18n;
    const bonus = (baseTokens * BigInt(TOKENOMICS.presale.whitelistBonus)) / 100n;
    const total = baseTokens + bonus;
    
    expect(bonus).toBe(2000n * 10n ** 18n); // 10% of 20000
    expect(total).toBe(22000n * 10n ** 18n);
  });

  test('TGE unlock calculation', () => {
    const allocation = 100000n * 10n ** 18n;
    const tgePercent = TOKENOMICS.allocation.presale.vesting.tgePercent;
    const tgeUnlock = (allocation * BigInt(tgePercent)) / 100n;
    
    expect(tgeUnlock).toBe(20000n * 10n ** 18n); // 20% of 100000
  });

  test('vesting schedule calculation', () => {
    const allocation = 100000n * 10n ** 18n;
    const vestingConfig = TOKENOMICS.allocation.presale.vesting;
    
    // TGE unlock
    const tgeUnlock = (allocation * BigInt(vestingConfig.tgePercent)) / 100n;
    const remainingToVest = allocation - tgeUnlock;
    
    // At 50% through vesting
    const vestingElapsed = vestingConfig.duration / 2;
    const vestedAmount = (remainingToVest * BigInt(vestingElapsed)) / BigInt(vestingConfig.duration);
    
    expect(vestedAmount).toBe(remainingToVest / 2n);
  });
});
