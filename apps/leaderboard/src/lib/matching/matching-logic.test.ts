import { describe, test, expect } from "bun:test";
import { matchString, matchGlob, matchRegex } from "./matching-logic";

describe("matchString", () => {
  const content = "this is a test string";

  // Basic matching
  test("should match when string is contained in content", () => {
    expect(matchString("test", content, {})).toBe(true);
  });

  test("should not match when string is not in content", () => {
    expect(matchString("missing", content, {})).toBe(false);
  });

  // Case sensitivity
  test("should be case insensitive by default", () => {
    expect(matchString("TEST", content, {})).toBe(true);
    expect(matchString("STRING", content, {})).toBe(true);
  });

  test("should respect case sensitivity option", () => {
    expect(matchString("TEST", content, { caseSensitive: true })).toBe(false);
    expect(matchString("string", content, { caseSensitive: true })).toBe(true);
  });

  // Word boundary
  test("should match word parts by default (wordBoundary: false)", () => {
    expect(matchString("tes", content, {})).toBe(true);
    expect(matchString("str", content, {})).toBe(true);
  });

  test("should respect word boundary option (positive cases)", () => {
    expect(matchString("test", content, { wordBoundary: true })).toBe(true);
    expect(matchString("string", content, { wordBoundary: true })).toBe(true);
    expect(matchString("a", content, { wordBoundary: true })).toBe(true);
    expect(matchString("is", content, { wordBoundary: true })).toBe(true);
  });

  test("should respect word boundary option (negative cases)", () => {
    expect(matchString("tes", content, { wordBoundary: true })).toBe(false);
    expect(matchString("str", content, { wordBoundary: true })).toBe(false);
    expect(matchString("testing", content, { wordBoundary: true })).toBe(false); // Pattern longer than word
  });

  test("should handle word boundary with case insensitivity", () => {
    expect(
      matchString("TEST", content, {
        wordBoundary: true,
        caseSensitive: false,
      }),
    ).toBe(true);
    expect(
      matchString("TES", content, { wordBoundary: true, caseSensitive: false }),
    ).toBe(false);
  });

  test("should handle word boundary with case sensitivity", () => {
    expect(
      matchString("test", content, { wordBoundary: true, caseSensitive: true }),
    ).toBe(true);
    expect(
      matchString("TEST", content, { wordBoundary: true, caseSensitive: true }),
    ).toBe(false);
  });

  // Note: The 'negative' option is handled by the createMatcher function, not directly by matchString.
});

describe("matchGlob", () => {
  // Basic glob matching
  test("should match simple glob patterns against full paths", () => {
    expect(matchGlob("*.ts", "file.ts", {})).toBe(true);
    expect(matchGlob("file.ts", "file.ts", {})).toBe(true);
    expect(matchGlob("*.ts", "path/to/file.ts", {})).toBe(false); // Doesn't match full path by default
    expect(matchGlob("file.js", "file.ts", {})).toBe(false);
  });

  test("should handle wildcard ** matching", () => {
    expect(matchGlob("src/**/*.ts", "src/lib/file.ts", {})).toBe(true);
    expect(matchGlob("src/**/*.ts", "src/components/ui/button.ts", {})).toBe(
      true,
    );
    expect(matchGlob("src/**/*.ts", "src/file.js", {})).toBe(false);
    expect(matchGlob("src/**/*.ts", "test/file.ts", {})).toBe(false);
    expect(matchGlob("**/*.ts", "path/to/file.ts", {})).toBe(true); // Matches any path ending in .ts
  });

  test("should handle wildcard * matching within paths", () => {
    expect(matchGlob("src/*/file.ts", "src/lib/file.ts", {})).toBe(true);
    expect(matchGlob("src/*/file.ts", "src/lib/nested/file.ts", {})).toBe(
      false,
    ); // * doesn't cross /
    expect(matchGlob("src/lib/*.ts", "src/lib/file.ts", {})).toBe(true);
  });

  test("should handle wildcard ? matching", () => {
    expect(matchGlob("file?.js", "file1.js", {})).toBe(true);
    expect(matchGlob("file?.js", "fileA.js", {})).toBe(true);
    expect(matchGlob("file?.js", "file.js", {})).toBe(false);
    expect(matchGlob("file?.js", "file12.js", {})).toBe(false);
  });

  test("should match dotfiles", () => {
    expect(matchGlob(".*", ".gitignore", {})).toBe(true);
    expect(matchGlob(".github/*", ".github/workflows", {})).toBe(true);
    expect(matchGlob("*.yml", ".github/workflows/ci.yml", {})).toBe(false); // Doesn't match full path
    expect(matchGlob("**/*.yml", ".github/workflows/ci.yml", {})).toBe(true);
  });

  // Case sensitivity
  test("should be case insensitive by default", () => {
    expect(matchGlob("*.TS", "file.ts", {})).toBe(true);
    expect(matchGlob("SRC/**/*.ts", "src/lib/file.ts", {})).toBe(true);
  });

  test("should respect case sensitivity option", () => {
    expect(matchGlob("*.TS", "file.ts", { caseSensitive: true })).toBe(false);
    expect(matchGlob("*.TS", "file.TS", { caseSensitive: true })).toBe(true);
    expect(
      matchGlob("SRC/**/*.ts", "src/lib/file.ts", { caseSensitive: true }),
    ).toBe(false);
    expect(
      matchGlob("src/**/*.ts", "src/lib/file.ts", { caseSensitive: true }),
    ).toBe(true);
  });

  test("should ignore word boundary option", () => {
    // Suppress console.warn for this test
    const originalWarn = console.warn;
    console.warn = () => {};
    // wordBoundary should have no effect
    expect(matchGlob("*.ts", "file.ts", { wordBoundary: true })).toBe(true);
    expect(
      matchGlob("file.ts", "file.ts", {
        wordBoundary: true,
        caseSensitive: true,
      }),
    ).toBe(true);
    console.warn = originalWarn; // Restore console.warn
  });

  // Note: The 'negative' option is handled by the createMatcher function, not directly by matchGlob.
  // Note: Path normalization (e.g., `\` to `/`) is handled by preprocessContent, not matchGlob.
});

describe("matchRegex", () => {
  const content = "this is a test string 123";

  // Basic regex matching
  test("should match when regex pattern matches content", () => {
    expect(matchRegex("t[aeiou]st", content, {})).toBe(true);
    expect(matchRegex("\\d+", content, {})).toBe(true); // Match digits
  });

  test("should not match when regex pattern doesn't match content", () => {
    expect(matchRegex("t[0-9]st", content, {})).toBe(false);
    expect(matchRegex("^test", content, {})).toBe(false); // Doesn't start with test
  });

  // Case sensitivity
  test("should be case insensitive by default", () => {
    expect(matchRegex("TEST", content, {})).toBe(true);
    expect(matchRegex("STRING", content, {})).toBe(true);
  });

  test("should respect case sensitivity option", () => {
    expect(matchRegex("TEST", content, { caseSensitive: true })).toBe(false);
    expect(matchRegex("string", content, { caseSensitive: true })).toBe(true);
    expect(matchRegex("this is a test", content, { caseSensitive: true })).toBe(
      true,
    );
  });

  // Word boundary
  test("should handle word boundary option when pattern is simple word", () => {
    // Word boundary added automatically
    expect(matchRegex("test", content, { wordBoundary: true })).toBe(true);
    expect(matchRegex("tes", content, { wordBoundary: true })).toBe(false);
    expect(matchRegex("string", content, { wordBoundary: true })).toBe(true);
    expect(matchRegex("str", content, { wordBoundary: true })).toBe(false);
  });

  test("should not add word boundary if pattern already has anchors or boundaries", () => {
    // Pattern already has \b, option should not add another one
    expect(matchRegex("\\btest\\b", content, { wordBoundary: true })).toBe(
      true,
    );
    expect(matchRegex("\\btest", content, { wordBoundary: true })).toBe(true); // Matches start of word
    expect(matchRegex("test\\b", content, { wordBoundary: true })).toBe(true); // Matches end of word

    // Pattern has ^ or $, option should not add \b
    expect(matchRegex("^this", content, { wordBoundary: true })).toBe(true);
    expect(matchRegex("123$", content, { wordBoundary: true })).toBe(true);
  });

  test("should handle word boundary with case insensitivity", () => {
    expect(
      matchRegex("TEST", content, { wordBoundary: true, caseSensitive: false }),
    ).toBe(true);
    expect(
      matchRegex("TES", content, { wordBoundary: true, caseSensitive: false }),
    ).toBe(false);
  });

  test("should handle word boundary with case sensitivity", () => {
    expect(
      matchRegex("test", content, { wordBoundary: true, caseSensitive: true }),
    ).toBe(true);
    expect(
      matchRegex("TEST", content, { wordBoundary: true, caseSensitive: true }),
    ).toBe(false);
  });

  // Complex regex patterns
  test("should handle complex regex patterns", () => {
    expect(matchRegex("^this.*\\d+$", content, {})).toBe(true);
    expect(matchRegex("is\\s+a", content, {})).toBe(true); // Matches 'is' followed by whitespace and 'a'
  });

  test("should return false for invalid regex patterns", () => {
    // Suppress console.error for this test
    const originalError = console.error;
    console.error = () => {};
    expect(matchRegex("[", content, {})).toBe(false); // Invalid regex
    expect(matchRegex("(", content, {})).toBe(false); // Invalid regex
    console.error = originalError; // Restore console.error
  });

  // Note: The 'negative' option is handled by the createMatcher function, not directly by matchRegex.
});
