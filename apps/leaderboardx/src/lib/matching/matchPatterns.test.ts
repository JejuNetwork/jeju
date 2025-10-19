import { describe, expect, it, beforeEach } from "bun:test";
import { matchPatterns, matchAnyPattern } from "./matchPatterns";
import { clearMatcherCache, getMatcherFunction } from "./getMatcherFunction";
import { TagPatternType } from "../data/tags";
import { PatternType, TagPattern } from "./types";

describe("Pattern Matching Functions", () => {
  beforeEach(() => {
    clearMatcherCache(); // Ensure clean cache for each test
  });

  const patterns: TagPattern[] = [
    {
      // 0: Match 'typescript' in commit message (case insensitive)
      pattern: "typescript",
      patternType: PatternType.STRING,
      target: TagPatternType.COMMIT_MESSAGE,
      options: {},
    },
    {
      // 1: Match 'feature' in commit message (case insensitive)
      pattern: "feature",
      patternType: PatternType.STRING,
      target: TagPatternType.COMMIT_MESSAGE,
      options: {},
    },
    {
      // 2: Match 'bug' in commit message (case insensitive)
      pattern: "bug",
      patternType: PatternType.STRING,
      target: TagPatternType.COMMIT_MESSAGE,
      options: {},
    },
    {
      // 3: Match '.ts' files (glob)
      pattern: "*.ts",
      patternType: PatternType.GLOB,
      target: TagPatternType.FILE_PATH,
      options: {},
    },
    {
      // 4: Match 'experimental' negatively in commit message
      pattern: "experimental",
      patternType: PatternType.STRING,
      target: TagPatternType.COMMIT_MESSAGE,
      options: { negative: true },
    },
    {
      // 5: Match 'TODO' in code content (case sensitive)
      pattern: "TODO",
      patternType: PatternType.STRING,
      target: TagPatternType.CODE_CONTENT,
      options: { caseSensitive: true },
    },
    {
      // 6: Match word 'refactor' in commit message
      pattern: "refactor",
      patternType: PatternType.STRING,
      target: TagPatternType.COMMIT_MESSAGE,
      options: { wordBoundary: true },
    },
  ];

  describe("matchPatterns", () => {
    it("should return patterns matching the content", () => {
      const content = {
        content: "feat: Add amazing new typescript feature",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const matches = matchPatterns(patterns, content);
      // Should match patterns 0 ('typescript') and 1 ('feature')
      expect(matches).toEqual([patterns[0], patterns[1]]);
    });

    it("should return patterns matching the content respecting word boundary", () => {
      const content = {
        content: "refactor: improve logic", // matches 'refactor' as whole word
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const content2 = {
        content: "refactoring: improve logic", // does not match 'refactor' as whole word
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const matches = matchPatterns(patterns, content);
      const matches2 = matchPatterns(patterns, content2);
      // Should match pattern 6 ('refactor' with word boundary)
      expect(matches).toEqual([patterns[6]]);
      expect(matches2).toEqual([]); // No match
    });

    it("should return empty array if no patterns match", () => {
      const content = {
        content: "fix: resolve minor issue",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const matches = matchPatterns(patterns, content);
      expect(matches).toEqual([]);
    });

    it("should only match patterns for the correct content type", () => {
      const contentCommit = {
        content: "feat: Add amazing new typescript feature",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const contentFile = {
        content: "component.ts",
        contentType: TagPatternType.FILE_PATH,
      };
      const contentCode = {
        content: "// TODO: fix this later",
        contentType: TagPatternType.CODE_CONTENT,
      };

      // Matches patterns 0 and 1
      expect(matchPatterns(patterns, contentCommit)).toEqual([
        patterns[0],
        patterns[1],
      ]);
      // Matches pattern 3
      expect(matchPatterns(patterns, contentFile)).toEqual([patterns[3]]);
      // Matches pattern 5
      expect(matchPatterns(patterns, contentCode)).toEqual([patterns[5]]);
    });

    it("should handle case sensitivity correctly", () => {
      const contentCodeLower = {
        content: "// todo: fix this later",
        contentType: TagPatternType.CODE_CONTENT,
      };
      const contentCodeUpper = {
        content: "// TODO: fix this later",
        contentType: TagPatternType.CODE_CONTENT,
      };
      // Pattern 5 requires 'TODO' case sensitive
      expect(matchPatterns(patterns, contentCodeLower)).toEqual([]);
      expect(matchPatterns(patterns, contentCodeUpper)).toEqual([patterns[5]]);
    });

    it("should handle negative patterns correctly", () => {
      const contentWithoutNegative = {
        content: "feat: Add typescript feature",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const contentWithNegative = {
        content: "feat: Add experimental typescript feature",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };

      // Pattern 4 ('experimental' negative) is NOT active here
      expect(matchPatterns(patterns, contentWithoutNegative)).toEqual([
        patterns[0],
        patterns[1],
      ]);

      // Pattern 4 IS active here, negating the match
      // The negative pattern itself (pattern 4) should not be in the results.
      // The logic is: if a negative pattern matches, *no* patterns are returned for that content.
      // Let's refine this: A negative pattern *filters* the content. If it matches, the content is rejected entirely.
      // The current implementation of `matchPatterns` returns patterns that individually match.
      // A negative pattern matching means `createMatcher` returns `false` for that pattern.
      // Let's rethink the test based on how `createMatcher` handles negative.

      // Rerun with understanding: getMatcherFunction(negativePattern)(content) returns false if 'experimental' is present.
      // matchPatterns iterates through patterns.
      // Pattern 0 matches 'typescript' -> true
      // Pattern 1 matches 'feature' -> true
      // Pattern 4 matches 'experimental', but is negative, so matcherFn returns false.

      // Test case 1: Content doesn't contain 'experimental'
      const matcherFn0 = getMatcherFunction(patterns[0]);
      const matcherFn1 = getMatcherFunction(patterns[1]);
      const matcherFn4 = getMatcherFunction(patterns[4]); // Negative pattern

      expect(matcherFn0(contentWithoutNegative)).toBe(true);
      expect(matcherFn1(contentWithoutNegative)).toBe(true);
      expect(matcherFn4(contentWithoutNegative)).toBe(true); // Doesn't contain 'experimental', so negative match is true

      // Test case 2: Content contains 'experimental'
      expect(matcherFn0(contentWithNegative)).toBe(true);
      expect(matcherFn1(contentWithNegative)).toBe(true);
      expect(matcherFn4(contentWithNegative)).toBe(false); // Contains 'experimental', so negative match is false

      expect(matchPatterns(patterns, contentWithoutNegative)).toEqual([
        patterns[0],
        patterns[1],
      ]);

      expect(matchPatterns(patterns, contentWithNegative)).toEqual([]);
    });

    it("should return empty array for empty patterns list", () => {
      const content = {
        content: "feat: Add amazing new typescript feature",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      expect(matchPatterns([], content)).toEqual([]);
    });

    it("should return empty array for empty content string", () => {
      const content = {
        content: "",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      expect(matchPatterns(patterns, content)).toEqual([]);
    });
  });

  describe("matchAnyPattern", () => {
    it("should return true if any pattern matches", () => {
      const contentCommit = {
        content: "feat: Add amazing new typescript feature", // Matches 0, 1
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const contentFile = {
        content: "src/component.ts", // shouldn't match since it's in subdirectory
        contentType: TagPatternType.FILE_PATH,
      };
      const rootContentFile = {
        content: "component.ts", // Matches 3
        contentType: TagPatternType.FILE_PATH,
      };
      const contentCode = {
        content: "// TODO: fix this later", // Matches 5
        contentType: TagPatternType.CODE_CONTENT,
      };

      expect(matchAnyPattern(patterns, contentCommit)).toBe(true);
      expect(matchAnyPattern(patterns, contentFile)).toBe(false);
      expect(matchAnyPattern(patterns, rootContentFile)).toBe(true);
      expect(matchAnyPattern(patterns, contentCode)).toBe(true);
    });

    it("should return false if no pattern matches", () => {
      const content = {
        content: "docs: experimental update README",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      expect(matchAnyPattern(patterns, content)).toBe(false);
    });

    it("should return false if patterns list is empty", () => {
      const content = {
        content: "feat: Add amazing new typescript feature",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      expect(matchAnyPattern([], content)).toBe(false);
    });

    it("should return false if content string is empty", () => {
      const content = {
        content: "",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      expect(matchAnyPattern(patterns, content)).toBe(false);
    });

    it("should respect negative patterns", () => {
      const contentWithoutNegative = {
        content: "feat: Add typescript feature", // Matches 0, 1, 4(neg) -> true
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const contentWithNegative = {
        content: "feat: Add experimental typescript feature", // Matches 0, 1. 4(neg) returns false. Still true because 0 and 1 match.
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const contentOnlyNegative = {
        content: "experimental feature", // Matches 1. 4(neg) returns false. Still true because 1 matches.
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const contentNoMatches = {
        content: "just experimental", // No positive matches. 4(neg) returns false. Overall false.
        contentType: TagPatternType.COMMIT_MESSAGE,
      };

      expect(matchAnyPattern(patterns, contentWithoutNegative)).toBe(true);
      expect(matchAnyPattern(patterns, contentWithNegative)).toBe(true);
      expect(matchAnyPattern(patterns, contentOnlyNegative)).toBe(true);
      expect(matchAnyPattern(patterns, contentNoMatches)).toBe(false);
    });
  });
});
