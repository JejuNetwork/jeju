/**
 * Shared utilities for Council services
 */

/**
 * Parse JSON from LLM response that may include markdown code fences
 */
export function parseJson<T>(response: string): T | null {
  const cleaned = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '');
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}
