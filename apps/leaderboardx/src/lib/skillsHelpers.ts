/**
 * Helper functions for calculating levels and experience points
 * Based on the Runescape skill level calculation system
 */

/**
 * Calculate level based on experience points using the Runescape formula
 *
 * @param xp - Current experience points
 * @returns Level based on the XP (1-99)
 */
export function calculateLevelStats(xp: number): {
  level: number;
  xpToNextLevel: number;
  progress: number;
} {
  // Ensure XP is not negative
  if (xp < 0) {
    return {
      level: 1,
      xpToNextLevel: Math.floor((1 / 4) * xpSum(1)),
      progress: 0,
    };
  }

  let level = 1;

  // Maximum standard level in Runescape is 99
  const maxLevel = 99;

  // Iterate through levels until we find the right one
  while (level < maxLevel) {
    // Calculate XP needed for next level using the Runescape formula
    const nextLevelXP = Math.floor((1 / 4) * xpSum(level));

    // If user doesn't have enough XP for the next level, return current level
    if (xp < nextLevelXP) {
      const xpToNextLevel = nextLevelXP - xp;
      const currentLevelXP = Math.floor((1 / 4) * xpSum(level - 1));
      const progress = (xp - currentLevelXP) / (nextLevelXP - currentLevelXP);
      return { level, xpToNextLevel, progress };
    }

    level++;
  }

  return { level: maxLevel, xpToNextLevel: 0, progress: 0 };
}

/**
 * Helper function that implements the sum part of the Runescape XP formula
 */
function xpSum(level: number): number {
  let total = 0;
  for (let i = 1; i <= level; i++) {
    total += Math.floor(i + 150 * Math.pow(2, i / 10));
  }
  return total;
}

/**
 * Calculate XP required for a specific level using the Runescape formula
 *
 * @param level - Target level (1-99)
 * @returns XP required to reach this level
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level > 99) level = 99;

  return Math.floor((1 / 4) * xpSum(level - 1));
}
