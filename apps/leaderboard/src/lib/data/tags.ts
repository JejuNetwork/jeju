import { z } from "zod";

/**
 * TagPatternType defines the different types of pattern matching
 */
export enum TagPatternType {
  FILE_PATH = "FILE_PATH", // Match against file paths
  COMMIT_MESSAGE = "COMMIT_MESSAGE", // Match against commit messages
  CODE_CONTENT = "CODE_CONTENT", // Match actual code content
  PR_TITLE = "PR_TITLE", // Match PR titles
  PR_DESCRIPTION = "PR_DESCRIPTION", // Match PR descriptions
  PR_CLOSES_ISSUE = "PR_CLOSES_ISSUE", // Match PRs that close issues
  ISSUE_TITLE = "ISSUE_TITLE", // Match issue titles
  ISSUE_BODY = "ISSUE_BODY", // Match issue content
  COMMENT = "COMMENT", // Match comment content
  LABEL = "LABEL", // Match labels
  REACTION = "REACTION", // Match reactions (content, user, and count)
}

/**
 * TagCategory defines the main categories for tag classification
 */
export enum TagCategory {
  AREA = "AREA", // Domain/feature area: frontend, backend, etc.
  ROLE = "ROLE", // Role-based: developer, designer, reviewer, etc.
  TECH = "TECH", // Technology: React, Python, AWS, etc.
}

// Zod schemas for validation

/**
 * Schema for tag pattern scoring mechanics
 */
export const TagScoringSchema = z.object({
  points: z.number(), // Base points awarded for matching this pattern
  multiplier: z.number().optional(), // Optional multiplier for specific patterns
  decay: z.number().min(0).max(1).optional(), // Optional decay rate for recurring matches (0-1)
  maxDaily: z.number().optional(), // Optional cap on daily points from this pattern
});

/**
 * Schema for a tag pattern that defines how to match activities to tags
 */
export const TagPatternSchema = z.object({
  target: z.nativeEnum(TagPatternType), // What type of content to match against
  pattern: z.string(), // The regex pattern or exact value to match
  caseSensitive: z.boolean().optional().default(false), // Whether the match is case sensitive
  scoring: TagScoringSchema, // Scoring mechanics for this pattern
  description: z.string().optional(), // Optional human-readable description
  enabled: z.boolean().optional().default(true), // Whether this pattern is active (default true)
});

/**
 * Schema for a tag rule that groups patterns for a specific skill/area
 */
export const TagRuleSchema = z.object({
  name: z.string(), // Unique identifier for the tag
  category: z.nativeEnum(TagCategory), // The tag category
  description: z.string(), // Human-readable description
  patterns: z.array(TagPatternSchema), // Array of pattern matching rules
  weight: z.number().optional().default(1.0), // Optional global weight multiplier
  dependencies: z.array(z.string()).optional(), // Optional dependencies on other tags
  createdAt: z.string().optional(), // Creation timestamp
  updatedAt: z.string().optional(), // Last update timestamp
});

// Type exports from zod schemas
export type TagScoring = z.infer<typeof TagScoringSchema>;
export type TagPattern = z.infer<typeof TagPatternSchema>;
export type TagRule = z.infer<typeof TagRuleSchema>;
