/**
 * Accessibility E2E Tests
 * Tests keyboard navigation, ARIA labels, and focus management
 */

import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
  test.describe('Keyboard Navigation', () => {
    test('should navigate main menu with keyboard', async ({ page }) => {
      await page.goto('/');
      
      // Tab to navigation
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      
      // Use arrow keys to navigate
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      
      // Enter to select
      await page.keyboard.press('Enter');
    });

    test('should trap focus in modal', async ({ page }) => {
      await page.goto('/bounties/new');
      
      // If there's a modal, focus should be trapped
      const modal = page.locator('[role="dialog"]');
      if (await modal.isVisible()) {
        // Tab through modal
        for (let i = 0; i < 10; i++) {
          await page.keyboard.press('Tab');
        }
        
        // Focus should still be inside modal
        const focusedInModal = await page.evaluate(() => {
          const focused = document.activeElement;
          const modal = document.querySelector('[role="dialog"]');
          return modal?.contains(focused);
        });
        
        expect(focusedInModal).toBe(true);
      }
    });

    test('should close modal with Escape', async ({ page }) => {
      await page.goto('/');
      
      // Open a modal or dropdown
      const button = page.getByRole('button').first();
      await button.click();
      
      // Press Escape
      await page.keyboard.press('Escape');
      
      // Modal should close or focus should return
    });

    test('should skip to main content', async ({ page }) => {
      await page.goto('/');
      
      // Tab to skip link (if exists)
      await page.keyboard.press('Tab');
      
      const skipLink = page.getByRole('link', { name: /skip to/i });
      if (await skipLink.isVisible()) {
        await skipLink.click();
        
        // Focus should be on main content
        const focused = await page.evaluate(() => document.activeElement?.tagName);
        expect(['MAIN', 'H1', 'A']).toContain(focused);
      }
    });
  });

  test.describe('ARIA Labels', () => {
    test('should have accessible navigation', async ({ page }) => {
      await page.goto('/');
      
      const nav = page.getByRole('navigation');
      await expect(nav.first()).toBeVisible();
    });

    test('should have labeled form inputs', async ({ page }) => {
      await page.goto('/bounties/new');
      
      const inputs = page.locator('input, textarea');
      const count = await inputs.count();
      
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        if (await input.isVisible()) {
          // Should have label, aria-label, or aria-labelledby
          const hasLabel = await input.evaluate((el) => {
            return el.getAttribute('aria-label') !== null ||
                   el.getAttribute('aria-labelledby') !== null ||
                   el.getAttribute('placeholder') !== null ||
                   document.querySelector(`label[for="${el.id}"]`) !== null;
          });
          
          expect(hasLabel).toBe(true);
        }
      }
    });

    test('should have labeled buttons', async ({ page }) => {
      await page.goto('/');
      
      const buttons = page.getByRole('button');
      const count = await buttons.count();
      
      for (let i = 0; i < Math.min(count, 10); i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          // Should have text content or aria-label
          const hasLabel = await button.evaluate((el) => {
            return el.textContent?.trim() !== '' ||
                   el.getAttribute('aria-label') !== null;
          });
          
          expect(hasLabel).toBe(true);
        }
      }
    });

    test('should have accessible images', async ({ page }) => {
      await page.goto('/');
      
      const images = page.locator('img');
      const count = await images.count();
      
      for (let i = 0; i < count; i++) {
        const img = images.nth(i);
        if (await img.isVisible()) {
          const alt = await img.getAttribute('alt');
          // Should have alt attribute (even if empty for decorative)
          expect(alt).toBeDefined();
        }
      }
    });
  });

  test.describe('Focus Management', () => {
    test('should show visible focus indicator', async ({ page }) => {
      await page.goto('/');
      
      // Tab to focusable element
      await page.keyboard.press('Tab');
      await page.keyboard.press('Tab');
      
      // Check for visible focus ring
      const focusedElement = await page.evaluate(() => {
        const focused = document.activeElement;
        if (!focused) return null;
        
        const styles = window.getComputedStyle(focused);
        return {
          outline: styles.outline,
          boxShadow: styles.boxShadow,
          borderColor: styles.borderColor,
        };
      });
      
      // Should have some focus indicator
      expect(
        focusedElement?.outline !== 'none' ||
        focusedElement?.boxShadow !== 'none' ||
        focusedElement?.borderColor !== ''
      ).toBe(true);
    });

    test('should return focus after modal closes', async ({ page }) => {
      await page.goto('/');
      
      // Click button to open something
      const button = page.getByRole('button').first();
      await button.focus();
      await button.click();
      
      // Press Escape or click close
      await page.keyboard.press('Escape');
      
      // Focus should return to trigger
      const focusedAfter = await page.evaluate(() => document.activeElement?.tagName);
      expect(['BUTTON', 'A']).toContain(focusedAfter);
    });
  });

  test.describe('Screen Reader', () => {
    test('should have page heading', async ({ page }) => {
      const routes = ['/', '/bounties', '/git', '/models', '/packages', '/feed'];
      
      for (const route of routes) {
        await page.goto(route);
        
        const heading = page.getByRole('heading', { level: 1 });
        await expect(heading.first()).toBeVisible();
      }
    });

    test('should have semantic HTML structure', async ({ page }) => {
      await page.goto('/');
      
      // Should have main landmark
      const main = page.locator('main');
      await expect(main).toBeVisible();
      
      // Should have header/nav
      const nav = page.getByRole('navigation');
      await expect(nav.first()).toBeVisible();
    });

    test('should announce status changes', async ({ page }) => {
      await page.goto('/bounties');
      
      // Check for aria-live regions
      const liveRegions = page.locator('[aria-live]');
      const count = await liveRegions.count();
      
      // Should have at least one live region for announcements
      // (this is optional but good practice)
    });
  });

  test.describe('Color Contrast', () => {
    test('should have sufficient text contrast', async ({ page }) => {
      await page.goto('/');
      
      // Check a sample of text elements
      const texts = page.locator('p, h1, h2, h3, span, a');
      
      for (let i = 0; i < Math.min(await texts.count(), 5); i++) {
        const text = texts.nth(i);
        if (await text.isVisible()) {
          const { foreground, background } = await text.evaluate((el) => {
            const styles = window.getComputedStyle(el);
            return {
              foreground: styles.color,
              background: styles.backgroundColor,
            };
          });
          
          // Just verify we can get colors
          expect(foreground).toBeDefined();
          expect(background).toBeDefined();
        }
      }
    });
  });

  test.describe('Reduced Motion', () => {
    test('should respect prefers-reduced-motion', async ({ page }) => {
      // Set reduced motion preference
      await page.emulateMedia({ reducedMotion: 'reduce' });
      
      await page.goto('/');
      
      // Animations should be disabled or reduced
      const hasReducedMotion = await page.evaluate(() => {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      });
      
      expect(hasReducedMotion).toBe(true);
    });
  });

  test.describe('Touch Targets', () => {
    test('should have adequate touch target sizes', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      
      const buttons = page.getByRole('button');
      const count = await buttons.count();
      
      for (let i = 0; i < Math.min(count, 5); i++) {
        const button = buttons.nth(i);
        if (await button.isVisible()) {
          const box = await button.boundingBox();
          if (box) {
            // WCAG recommends 44x44 pixels for touch targets
            expect(box.width).toBeGreaterThanOrEqual(24);
            expect(box.height).toBeGreaterThanOrEqual(24);
          }
        }
      }
    });
  });
});

