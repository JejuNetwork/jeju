import { TagPatternType } from "../data/tags";

/**
 * Enum for pattern matching method types
 */
export enum PatternType {
  STRING = "STRING", // Simple string matching
  REGEX = "REGEX", // Regular expression
  GLOB = "GLOB", // Glob pattern (for file paths)
}

/**
 * Interface for pattern matching options
 */
export interface PatternOptions {
  caseSensitive?: boolean; // Whether matching should be case sensitive (default: false)
  wordBoundary?: boolean; // Whether to match whole words only (default: false)
  negative?: boolean; // Whether this is a negative pattern (match means exclusion) (default: false)
}

/**
 * Interface defining a pattern to be matched against content
 */
export interface TagPattern {
  pattern: string; // The pattern string to match
  patternType: PatternType; // Type of pattern (string, regex, glob)
  target: TagPatternType; // Type of content to match against
  options: PatternOptions; // Matching options
}

/**
 * Type for content that can be matched
 */
export type MatchContent = {
  content: string; // The actual content to match against
  contentType: TagPatternType; // The type of content
};
