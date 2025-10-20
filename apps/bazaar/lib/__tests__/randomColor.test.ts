import { describe, test, expect } from 'bun:test';
import randomColor from '../randomColor';

describe('randomColor', () => {
  test('should return a valid color string', () => {
    const color = randomColor();
    expect(color).toBeDefined();
    expect(typeof color).toBe('string');
  });

  test('should return different colors on subsequent calls', () => {
    const colors = new Set();
    for (let i = 0; i < 100; i++) {
      colors.add(randomColor());
    }
    // Should have multiple different colors
    expect(colors.size).toBeGreaterThan(1);
  });

  test('should return valid hex or hsl color', () => {
    const color = randomColor();
    const isHex = /^#[0-9A-F]{6}$/i.test(color);
    const isHsl = /^hsl\(\d+,\s*\d+%,\s*\d+%\)$/i.test(color);
    const isRgb = /^rgb\(\d+,\s*\d+,\s*\d+\)$/i.test(color);
    
    expect(isHex || isHsl || isRgb).toBe(true);
  });
});

