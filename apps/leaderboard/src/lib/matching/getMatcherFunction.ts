import { MatchContent, PatternType, TagPattern } from "./types";
import { preprocessContent } from "./preprocessContent";
import { matchString, matchRegex, matchGlob } from "./matching-logic";
import { TagPatternType } from "../data/tags";

// Simple cache implementation using a Map
const matcherCache = new Map<string, MatcherFunction>();

/**
 * Creates a unique cache key for a TagPattern configuration.
 * Includes pattern, type, target, and all options.
 *
 * @param tagPattern The pattern configuration.
 * @returns A unique string key.
 */
function createCacheKey(tagPattern: TagPattern): string {
  // Sort options keys for consistent key generation
  const sortedOptions = Object.keys(tagPattern.options)
    .sort()
    .reduce(
      (obj, key) => {
        obj[key as keyof typeof tagPattern.options] =
          tagPattern.options[key as keyof typeof tagPattern.options];
        return obj;
      },
      {} as Record<string, unknown>,
    );

  return JSON.stringify({
    p: tagPattern.pattern,
    pt: tagPattern.patternType,
    t: tagPattern.target,
    o: sortedOptions,
  });
}

/**
 * Gets a matcher function for the given pattern configuration.
 * Retrieves from cache if available, otherwise creates a new one, caches it, and returns it.
 *
 * @param tagPattern The pattern configuration.
 * @returns A matcher function `(content: MatchContent) => boolean`.
 */
export function getMatcherFunction(tagPattern: TagPattern): MatcherFunction {
  const key = createCacheKey(tagPattern);

  if (!matcherCache.has(key)) {
    try {
      const matcherFn = createMatcher(tagPattern);
      matcherCache.set(key, matcherFn);
    } catch (error) {
      // If matcher creation fails (e.g., invalid pattern/target combo),
      // return a function that always returns false to prevent repeated errors.
      console.error(`Failed to create matcher for key ${key}:`, error);
      const errorFn = () => false;
      matcherCache.set(key, errorFn); // Cache the error function
      return errorFn;
    }
  }

   
  return matcherCache.get(key)!; // Non-null assertion is safe due to the check above
}

/**
 * Clears the cache of matcher functions.
 */
export function clearMatcherCache(): void {
  matcherCache.clear();
}

/**
 * Gets the current number of cached matcher functions.
 *
 * @returns The size of the cache.
 */
export function getMatcherCacheSize(): number {
  return matcherCache.size;
} /**
 * Type alias for a function that tests content against a specific pattern.
 */

export type MatcherFunction = (content: MatchContent) => boolean;
/**
 * Creates a matcher function for a given TagPattern configuration.
 * This function encapsulates the specific matching logic (string, regex, glob),
 * content preprocessing, and option handling (case sensitivity, word boundary, negation).
 *
 * @param tagPattern The pattern configuration.
 * @returns A function that takes MatchContent and returns true if it matches the pattern, false otherwise.
 * @throws Error if the pattern type is incompatible with the target type.
 */

export function createMatcher(tagPattern: TagPattern): MatcherFunction {
  const { pattern, patternType, options, target } = tagPattern;
  const isNegative = options.negative ?? false;

  // Validate compatibility before creating the matcher
  if (!validatePatternForTarget(patternType, target)) {
    // Although validatePatternForTarget logs a warning for GLOB, we throw here
    // to prevent creating an invalid matcher function.
    throw new Error(
      `Pattern type ${patternType} is not compatible with target type ${target} for pattern "${pattern}"`,
    );
  }

  // Return the actual matcher function (closure)
  return (content: MatchContent): boolean => {
    // 1. Check if the content type matches the pattern's target type
    if (content.contentType !== target) {
      return false; // Mismatched content type, cannot match
    }

    // 2. Preprocess the content based on its type
    // We preprocess here instead of in matchX functions to ensure it happens once per content type
    const processedContent = preprocessContent(content);

    // 3. Perform the actual match based on pattern type
    let isMatch: boolean;
    try {
      switch (patternType) {
        case PatternType.STRING:
          isMatch = matchString(pattern, processedContent.content, options);
          break;
        case PatternType.REGEX:
          isMatch = matchRegex(pattern, processedContent.content, options);
          break;
        case PatternType.GLOB:
          // Glob matching inherently works on the preprocessed path string
          isMatch = matchGlob(pattern, processedContent.content, options);
          break;
        default:
          // Should be unreachable if PatternType enum is used correctly
          const exhaustiveCheck: never = patternType;
          console.error(`Unsupported pattern type: ${exhaustiveCheck}`);
          isMatch = false;
      }
    } catch (error) {
      console.error(
        `Error during matching for pattern "${pattern}" (type: ${patternType}):`,
        error,
      );
      isMatch = false; // Treat errors during matching as no match
    }

    // 4. Apply negative option if necessary
    // If it's a negative pattern, the final result is the inverse of the raw match.
    return isNegative ? !isMatch : isMatch;
  };
} /**
 * Validates if a pattern type is compatible with a given target content type.
 *
 * @param patternType The pattern type (STRING, REGEX, GLOB)
 * @param targetType The target content type
 * @returns True if compatible, false otherwise
 */

export function validatePatternForTarget(
  patternType: PatternType,
  targetType: TagPatternType,
): boolean {
  // GLOB patterns should only be used with file paths
  if (
    patternType === PatternType.GLOB &&
    targetType !== TagPatternType.FILE_PATH
  ) {
    console.warn(
      `GLOB pattern type used with incompatible target type: ${targetType}. GLOB is only intended for FILE_PATH.`,
    );
    return false;
  }

  // STRING and REGEX can generally be used with any text-based target type.
  // Add more specific validation rules here if needed.
  // For example, certain targets might only make sense with specific pattern types.
  return true;
}
