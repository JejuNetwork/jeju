import { Dappwright } from '@tenkeylabs/dappwright';
import { Page, expect } from '@playwright/test';

/**
 * Shared contract interaction helpers for Jeju dApp testing
 *
 * These helpers abstract common wallet interactions and transactions,
 * reducing boilerplate and ensuring consistent patterns across tests.
 */

/**
 * Approve ERC20 token spending
 */
export async function approveToken(
  page: Page,
  wallet: Dappwright,
  options: {
    tokenSymbol: string;
    spenderName?: string;
    amount?: string;
  }
) {
  console.log(`Approving ${options.tokenSymbol} for ${options.spenderName || 'contract'}`);

  // Click approve button (assuming it exists in UI)
  const approveButton = page.locator(`button:has-text("Approve")`).first();
  await approveButton.click();

  // Wait for MetaMask popup
  await page.waitForTimeout(1000);

  // Confirm in MetaMask
  await wallet.confirmTransaction();

  // Wait for approval confirmation
  await expect(page.locator('text=/approved|success/i')).toBeVisible({
    timeout: 30000
  });

  console.log(`✅ Token approved`);
}

/**
 * Execute swap transaction
 */
export async function executeSwap(
  page: Page,
  wallet: Dappwright,
  options: {
    inputToken: string;
    outputToken: string;
    amount: string;
  }
) {
  console.log(`Swapping ${options.amount} ${options.inputToken} for ${options.outputToken}`);

  // Fill amount
  const amountInput = page.locator('input[placeholder*="0.0"]').first();
  await amountInput.fill(options.amount);

  // Select tokens if dropdowns exist
  const inputTokenSelect = page.locator('select[name*="input"], select[name*="from"]').first();
  if (await inputTokenSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    await inputTokenSelect.selectOption(options.inputToken);
  }

  const outputTokenSelect = page.locator('select[name*="output"], select[name*="to"]').first();
  if (await outputTokenSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    await outputTokenSelect.selectOption(options.outputToken);
  }

  // Click swap button
  const swapButton = page.locator('button:has-text("Swap")').first();
  await swapButton.click();

  // Confirm transaction in MetaMask
  await wallet.confirmTransaction();

  // Wait for success
  await expect(page.locator('text=/success|completed/i')).toBeVisible({
    timeout: 60000
  });

  console.log(`✅ Swap executed successfully`);
}

/**
 * Place bet on prediction market
 */
export async function placeBet(
  page: Page,
  wallet: Dappwright,
  options: {
    outcome: 'YES' | 'NO';
    amount: string;
  }
) {
  console.log(`Placing ${options.outcome} bet with ${options.amount}`);

  // Select outcome
  const outcomeButton = page.locator(`button:has-text("${options.outcome}")`).first();
  await outcomeButton.click();

  // Enter amount
  const amountInput = page.locator('input[placeholder*="100"], input[name*="amount"]').first();
  await amountInput.fill(options.amount);

  // Click buy button
  const buyButton = page.locator(`button:has-text("Buy ${options.outcome}"), button:has-text("Place Bet")`).first();
  await buyButton.click();

  // Confirm transaction in MetaMask
  await wallet.confirmTransaction();

  // Wait for success
  await expect(page.locator('text=/success|confirmed|placed/i')).toBeVisible({
    timeout: 60000
  });

  console.log(`✅ Bet placed successfully`);
}

/**
 * Add liquidity to pool
 */
export async function addLiquidity(
  page: Page,
  wallet: Dappwright,
  options: {
    token0: string;
    token1: string;
    amount0: string;
    amount1: string;
  }
) {
  console.log(`Adding liquidity: ${options.amount0} ${options.token0} + ${options.amount1} ${options.token1}`);

  // Select tokens if selectors exist
  const token0Select = page.locator('select[name*="token0"], select[name*="tokenA"]').first();
  if (await token0Select.isVisible({ timeout: 1000 }).catch(() => false)) {
    await token0Select.selectOption(options.token0);
  }

  const token1Select = page.locator('select[name*="token1"], select[name*="tokenB"]').first();
  if (await token1Select.isVisible({ timeout: 1000 }).catch(() => false)) {
    await token1Select.selectOption(options.token1);
  }

  // Enter amounts
  const amount0Input = page.locator('input[name*="amount0"], input[name*="amountA"]').first();
  await amount0Input.fill(options.amount0);

  const amount1Input = page.locator('input[name*="amount1"], input[name*="amountB"]').first();
  await amount1Input.fill(options.amount1);

  // Approve tokens if needed (may be 2 separate transactions)
  const approveButtons = page.locator('button:has-text("Approve")');
  const approveCount = await approveButtons.count();

  for (let i = 0; i < approveCount; i++) {
    const approveButton = approveButtons.nth(i);
    if (await approveButton.isEnabled()) {
      await approveButton.click();
      await wallet.confirmTransaction();
      await page.waitForTimeout(2000);
    }
  }

  // Add liquidity
  const addButton = page.locator('button:has-text("Add Liquidity")').first();
  await addButton.click();
  await wallet.confirmTransaction();

  // Wait for success
  await expect(page.locator('text=/liquidity added|success/i')).toBeVisible({
    timeout: 60000
  });

  console.log(`✅ Liquidity added successfully`);
}

/**
 * Bridge tokens from L1 to L2
 */
export async function bridgeToken(
  page: Page,
  wallet: Dappwright,
  options: {
    token: string;
    amount: string;
    from: string;
    to: string;
  }
) {
  console.log(`Bridging ${options.amount} ${options.token} from ${options.from} to ${options.to}`);

  // Select token
  const tokenSelect = page.locator('select[name*="token"]').first();
  if (await tokenSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tokenSelect.selectOption(options.token);
  }

  // Enter amount
  const amountInput = page.locator('input[name*="amount"]').first();
  await amountInput.fill(options.amount);

  // Click bridge button
  const bridgeButton = page.locator('button:has-text("Bridge")').first();
  await bridgeButton.click();

  // Confirm transaction on source chain
  await wallet.confirmTransaction();

  // Wait for bridge confirmation (may take longer)
  await expect(page.locator('text=/bridged|success|completed/i')).toBeVisible({
    timeout: 120000
  });

  console.log(`✅ Bridge transaction completed`);
}

/**
 * Deploy paymaster contract
 */
export async function deployPaymaster(
  page: Page,
  wallet: Dappwright,
  options: {
    token: string;
  }
) {
  console.log(`Deploying paymaster for ${options.token}`);

  // Select token for paymaster
  const tokenSelect = page.locator('select[name*="token"]').first();
  if (await tokenSelect.isVisible({ timeout: 1000 }).catch(() => false)) {
    await tokenSelect.selectOption(options.token);
  }

  // Click deploy button
  const deployButton = page.locator('button:has-text("Deploy")').first();
  await deployButton.click();

  // Confirm transaction
  await wallet.confirmTransaction();

  // Wait for deployment (may take a while)
  await expect(page.locator('text=/deployed|success/i')).toBeVisible({
    timeout: 90000
  });

  console.log(`✅ Paymaster deployed successfully`);
}

/**
 * Connect wallet to dApp
 * This is a more flexible version that handles different wallet UI patterns
 */
export async function connectWallet(
  page: Page,
  wallet: Dappwright,
  options?: {
    walletName?: string;
    timeout?: number;
  }
) {
  const walletName = options?.walletName || 'MetaMask';
  const timeout = options?.timeout || 10000;

  console.log(`Connecting ${walletName} wallet...`);

  try {
    // Click connect button (various patterns)
    const connectButton = page.locator(
      'button:has-text("Connect"), button:has-text("Connect Wallet")'
    ).first();

    await connectButton.click({ timeout: 5000 });

    // Wait for wallet selection modal
    await page.waitForTimeout(1000);

    // Click wallet option (MetaMask, Rainbow, etc.)
    const walletOption = page.locator(`text="${walletName}", button:has-text("${walletName}")`).first();
    await walletOption.click({ timeout: 3000 });

    // Approve connection in MetaMask
    await wallet.approve();

    // Wait for connection success
    await expect(
      page.locator('[data-connected="true"], button:has-text(/0x/)')
    ).toBeVisible({ timeout });

    console.log(`✅ Wallet connected successfully`);
  } catch (error) {
    console.warn(`Wallet connection failed or already connected:`, error);
    throw error;
  }
}

/**
 * Check balance of a token
 */
export async function getBalance(
  page: Page,
  options: {
    token: string;
  }
): Promise<string> {
  console.log(`Checking balance for ${options.token}`);

  // Look for balance display
  const balanceElement = page.locator(
    `[data-token="${options.token}"] [data-balance], text=/Balance:.*${options.token}/i`
  ).first();

  const balanceText = await balanceElement.textContent();
  const balance = balanceText?.match(/[\d.]+/)?.[0] || '0';

  console.log(`${options.token} balance: ${balance}`);
  return balance;
}

/**
 * Wait for transaction confirmation
 */
export async function waitForTransaction(
  page: Page,
  options?: {
    timeout?: number;
    successText?: string;
  }
) {
  const timeout = options?.timeout || 60000;
  const successText = options?.successText || 'success|confirmed|completed';

  console.log(`Waiting for transaction confirmation...`);

  await expect(
    page.locator(`text=/${successText}/i`)
  ).toBeVisible({ timeout });

  console.log(`✅ Transaction confirmed`);
}
