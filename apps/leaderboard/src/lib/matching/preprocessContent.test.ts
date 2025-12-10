import { describe, expect, it } from "bun:test";
import { preprocessContent } from "./preprocessContent";
import { validatePatternForTarget } from "./getMatcherFunction"; // validatePatternForTarget moved here
import { TagPatternType } from "../data/tags";
import { PatternType } from "./types";

describe("Content Preprocessing & Validation", () => {
  describe("preprocessContent", () => {
    it("should normalize file paths", () => {
      const content = {
        content: "src\\lib\\matching\\file.ts ",
        contentType: TagPatternType.FILE_PATH,
      };
      const processed = preprocessContent(content);
      // Should normalize backslashes to forward slashes and trim
      expect(processed.content).toBe("src/lib/matching/file.ts");
    });

    it("should trim text content", () => {
      const content = {
        content: "  Some commit message  ",
        contentType: TagPatternType.COMMIT_MESSAGE,
      };
      const processed = preprocessContent(content);
      expect(processed.content).toBe("Some commit message");
    });

    it("should normalize line endings in code content", () => {
      const content = {
        content: "function test() {\r\n  return true;\r\n}",
        contentType: TagPatternType.CODE_CONTENT,
      };
      const processed = preprocessContent(content);
      expect(processed.content).toBe("function test() {\n  return true;\n}");
    });

    it("should trim and lowercase label content", () => {
      const content = {
        content: "  FEATURE  ",
        contentType: TagPatternType.LABEL,
      };
      const processed = preprocessContent(content);
      expect(processed.content).toBe("feature");
    });

    it("should not modify content for types without specific preprocessing", () => {
      const content = {
        content: "  Reaction Content ",
        contentType: TagPatternType.REACTION, // Assuming REACTION has no specific rule
      };
      const processed = preprocessContent(content);
      expect(processed.content).toBe("  Reaction Content ");
    });
  });

  describe("validatePatternForTarget", () => {
    it("should validate GLOB only for FILE_PATH", () => {
      expect(
        validatePatternForTarget(PatternType.GLOB, TagPatternType.FILE_PATH),
      ).toBe(true);
      expect(
        validatePatternForTarget(
          PatternType.GLOB,
          TagPatternType.COMMIT_MESSAGE,
        ),
      ).toBe(false);
      expect(
        validatePatternForTarget(PatternType.GLOB, TagPatternType.CODE_CONTENT),
      ).toBe(false);
    });

    it("should validate STRING for text-based targets", () => {
      expect(
        validatePatternForTarget(
          PatternType.STRING,
          TagPatternType.COMMIT_MESSAGE,
        ),
      ).toBe(true);
      expect(
        validatePatternForTarget(PatternType.STRING, TagPatternType.FILE_PATH),
      ).toBe(true); // String can technically search paths
      expect(
        validatePatternForTarget(PatternType.STRING, TagPatternType.LABEL),
      ).toBe(true);
    });

    it("should validate REGEX for text-based targets", () => {
      expect(
        validatePatternForTarget(PatternType.REGEX, TagPatternType.PR_TITLE),
      ).toBe(true);
      expect(
        validatePatternForTarget(PatternType.REGEX, TagPatternType.FILE_PATH),
      ).toBe(true); // Regex can technically search paths
      expect(
        validatePatternForTarget(
          PatternType.REGEX,
          TagPatternType.CODE_CONTENT,
        ),
      ).toBe(true);
    });
  });
});
