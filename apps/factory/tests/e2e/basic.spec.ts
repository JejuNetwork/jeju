import { test, expect } from '@playwright/test';

test.describe('Factory App', () => {
  test('should load home page', async ({ page }) => {
    await page.goto('/');
    
    // Check for main heading in the main content area
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
    
    // Check for navigation
    await expect(page.getByRole('navigation')).toBeVisible();
  });

  test('should navigate to bounties page', async ({ page }) => {
    await page.goto('/bounties');
    
    // Check for bounties page content
    await expect(page.getByRole('main').getByRole('heading', { name: /bounties/i })).toBeVisible();
  });

  test('should navigate to git page', async ({ page }) => {
    await page.goto('/git');
    
    // Check for repositories heading
    await expect(page.getByRole('main').getByRole('heading', { name: /repositories/i })).toBeVisible();
  });

  test('should navigate to packages page', async ({ page }) => {
    await page.goto('/packages');
    
    // Check for packages heading
    await expect(page.getByRole('main').getByRole('heading', { name: /packages/i })).toBeVisible();
  });

  test('should navigate to containers page', async ({ page }) => {
    await page.goto('/containers');
    
    // Check for container registry heading
    await expect(page.getByRole('main').getByRole('heading', { name: /container/i })).toBeVisible();
  });

  test('should navigate to models page', async ({ page }) => {
    await page.goto('/models');
    
    // Check for model hub heading
    await expect(page.getByRole('main').getByRole('heading', { name: /model/i })).toBeVisible();
  });

  test('should navigate to jobs page', async ({ page }) => {
    await page.goto('/jobs');
    
    // Check for jobs heading
    await expect(page.getByRole('main').getByRole('heading', { name: /jobs/i })).toBeVisible();
  });

  test('should navigate to projects page', async ({ page }) => {
    await page.goto('/projects');
    
    // Check for projects heading - should show the project name
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toBeVisible();
  });

  test('should navigate to feed page', async ({ page }) => {
    await page.goto('/feed');
    
    // Check for feed heading
    await expect(page.getByRole('main').getByRole('heading', { name: /feed/i })).toBeVisible();
  });

  test('should show model upload page', async ({ page }) => {
    await page.goto('/models/upload');
    
    // Check for upload heading
    await expect(page.getByRole('main').getByRole('heading', { name: /upload/i })).toBeVisible();
  });

  test('should have working navigation links', async ({ page }) => {
    await page.goto('/');
    
    // Click on bounties link in nav
    await page.getByRole('navigation').getByRole('link', { name: /bounties/i }).click();
    await expect(page).toHaveURL('/bounties');
    
    // Click on repositories/git link
    await page.getByRole('navigation').getByRole('link', { name: /repositories|git/i }).click();
    await expect(page).toHaveURL('/git');
    
    // Click on packages link
    await page.getByRole('navigation').getByRole('link', { name: /packages/i }).click();
    await expect(page).toHaveURL('/packages');
  });

  test('should navigate to agents page', async ({ page }) => {
    await page.goto('/agents');
    
    // Check for agents marketplace heading
    await expect(page.getByRole('main').getByRole('heading', { name: /agent/i })).toBeVisible();
  });
});
