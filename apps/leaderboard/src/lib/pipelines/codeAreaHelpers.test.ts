import { describe, expect, test } from "bun:test";
import {
  categorizeWorkItem,
  buildAreaMap,
  WorkItemType,
} from "./codeAreaHelpers";

describe("categorizeWorkItem", () => {
  const testCases: { text: string; expected: WorkItemType }[] = [
    { text: "feat: add new button", expected: "feature" },
    { text: "feature: user authentication", expected: "feature" },
    { text: "Add cool new thing", expected: "other" },
    { text: "fix: solve bug in login", expected: "bugfix" },
    { text: "Bugfix: something is broken", expected: "bugfix" },
    { text: "resolve issue with auth", expected: "other" },
    { text: "docs: update README", expected: "docs" },
    { text: "documentation: improve examples", expected: "docs" },
    { text: "refactor: improve performance", expected: "refactor" },
    { text: "cleanup: remove old code", expected: "refactor" },
    { text: "test: add unit tests for login", expected: "tests" },
    { text: "chore: bump version", expected: "other" },
    { text: "style: format code", expected: "other" },
  ];

  test.each(testCases)(
    "should categorize '$text' as '$expected'",
    ({ text, expected }) => {
      expect(categorizeWorkItem(text)).toBe(expected);
    },
  );
});

describe("buildAreaMap", () => {
  test("should correctly build an area map from a list of files", () => {
    const files = [
      { path: "src/components/ui/button.tsx" },
      { path: "src/components/ui/card.tsx" },
      { path: "src/lib/utils.ts" },
      { path: "src/lib/data/db.ts" },
      { path: "package.json" },
      { path: "src/app/page.tsx" },
      { path: "src/app/layout.tsx" },
      { path: "README.md" },
      { filename: "drizzle/0001_schema.sql" },
      { filename: "drizzle/0002_schema.sql" },
      { path: "auth-worker/src/index.ts" },
    ];

    const areaMap = buildAreaMap(files);
    expect(areaMap.get("src/components")).toBe(2);
    expect(areaMap.get("src/lib")).toBe(2);
    expect(areaMap.get("src/app")).toBe(2);
    expect(areaMap.has("drizzle/0001_schema.sql")).toBe(false);
    expect(areaMap.has("drizzle/0002_schema.sql")).toBe(false);
    expect(areaMap.get("auth-worker/src")).toBe(1);
    expect(areaMap.has("package.json")).toBe(false);
    expect(areaMap.has("README.md")).toBe(false);
  });

  test("should handle empty file list", () => {
    const areaMap = buildAreaMap([]);
    expect(areaMap.size).toBe(0);
  });

  test("should handle files with only filename", () => {
    const files = [{ filename: "src/components/button.tsx" }];
    const areaMap = buildAreaMap(files);
    expect(areaMap.get("src/components")).toBe(1);
  });

  test("should ignore files in root directory", () => {
    const files = [{ path: "file.txt" }];
    const areaMap = buildAreaMap(files);
    expect(areaMap.size).toBe(0);
  });

  test("should handle files with missing path and filename", () => {
    const files = [{}];
    const areaMap = buildAreaMap(files);
    expect(areaMap.size).toBe(0);
  });

  test("should correctly handle special 'packages' directory", () => {
    const files = [
      { path: "packages/ui/src/button.tsx" },
      { path: "packages/ui/src/card.tsx" },
      { path: "packages/utils/src/index.ts" },
    ];
    const areaMap = buildAreaMap(files);
    expect(areaMap.get("ui")).toBe(2);
    expect(areaMap.get("utils")).toBe(1);
  });
});
