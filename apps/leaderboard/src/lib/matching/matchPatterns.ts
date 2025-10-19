import { MatchContent, TagPattern } from "./types";
import { getMatcherFunction } from "./getMatcherFunction";

/**
 * Matches a piece of content against a list of patterns and returns the patterns that matched.
 * Uses a cache for matcher functions for efficiency.
 * Handles different pattern types, content types, options, and negation implicitly
 * through the cached matcher functions.
 *
 * @param patterns An array of TagPattern configurations.
 * @param content The MatchContent object to test against the patterns.
 * @returns An array containing the TagPattern objects that matched the content.
 */
export function matchPatterns(
  patterns: TagPattern[],
  content: MatchContent,
): TagPattern[] {
  // Return early if no patterns or empty content string
  // Note: Some content types might be valid even with empty string content,
  // but patterns usually require some text to match. Adjust if needed.
  if (patterns.length === 0 || !content.content) {
    return [];
  }

  // Filter patterns that are applicable to this content type
  const applicablePatterns = patterns.filter(
    (pattern) => pattern.target === content.contentType,
  );

  // If no patterns match this content type, return empty
  if (applicablePatterns.length === 0) {
    return [];
  }

  // Check negative patterns first (only those applicable to this content type)
  const negativePatterns = applicablePatterns.filter((p) => p.options.negative);
  for (const pattern of negativePatterns) {
    try {
      const matcherFn = getMatcherFunction(pattern);
      // For a negative pattern, matcherFn will return false if the pattern is found
      if (!matcherFn(content)) {
        // Found a negative match, so no patterns should match
        return [];
      }
    } catch (error) {
      console.error(
        `Error executing negative matcher for pattern "${pattern.pattern}" (type: ${pattern.patternType}, target: ${pattern.target}):`,
        error,
      );
    }
  }

  // If no negative patterns excluded the content, collect all matching non-negative patterns
  const matchingPatterns: TagPattern[] = [];
  const positivePatterns = applicablePatterns.filter(
    (p) => !p.options.negative,
  );
  for (const pattern of positivePatterns) {
    try {
      const matcherFn = getMatcherFunction(pattern);
      if (matcherFn(content)) {
        matchingPatterns.push(pattern);
      }
    } catch (error) {
      console.error(
        `Error executing matcher for pattern "${pattern.pattern}" (type: ${pattern.patternType}, target: ${pattern.target}):`,
        error,
      );
    }
  }

  return matchingPatterns;
}

/**
 * Checks if *any* pattern in the list matches the given content.
 * More efficient than calling matchPatterns and checking the length if only existence is needed.
 *
 * @param patterns An array of TagPattern configurations.
 * @param content The MatchContent object to test against the patterns.
 * @returns True if at least one pattern matches the content, false otherwise.
 */
export function matchAnyPattern(
  patterns: TagPattern[],
  content: MatchContent,
): boolean {
  if (patterns.length === 0 || !content.content) {
    return false;
  }
  // Filter patterns that are applicable to this content type
  const applicablePatterns = patterns.filter(
    (pattern) => pattern.target === content.contentType,
  );

  // If no patterns match this content type, return empty
  if (applicablePatterns.length === 0) {
    return false;
  }

  for (const pattern of patterns) {
    try {
      const matcherFn = getMatcherFunction(pattern);
      if (matcherFn(content)) {
        // console.log("found match for pattern", { pattern, matcherFn });
        return true; // Found a match, no need to check further
      }
    } catch (error) {
      console.error(
        `Error executing matcher for pattern "${pattern.pattern}" during matchAnyPattern:`,
        error,
      );
      // Continue checking other patterns
    }
  }

  return false; // No patterns matched
}
