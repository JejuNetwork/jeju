/**
 * Utility to categorize a work item (PR title or commit message)
 *
 * @param text - The PR title or commit message to categorize
 * @returns The category of the work item
 */
export function categorizeWorkItem(text: string): WorkItemType {
  const lowercaseText = text.toLowerCase();

  // Feature detection
  if (lowercaseText.startsWith("feat") || lowercaseText.includes("feature")) {
    return "feature";
  }

  // Bug fix detection
  if (
    lowercaseText.startsWith("fix") ||
    lowercaseText.includes("fix") ||
    lowercaseText.includes("bug")
  ) {
    return "bugfix";
  }

  // Documentation detection
  if (lowercaseText.startsWith("docs") || lowercaseText.includes("document")) {
    return "docs";
  }

  // Refactoring detection
  if (
    lowercaseText.startsWith("refactor") ||
    lowercaseText.includes("refactor") ||
    lowercaseText.includes("clean") ||
    lowercaseText.includes("cleanup")
  ) {
    return "refactor";
  }

  // Test related detection
  if (lowercaseText.startsWith("test") || lowercaseText.includes("test")) {
    return "tests";
  }

  // Default category
  return "other";
}

/**
 * Utility to extract area from a file path
 */
function extractAreaFromPath(path: string): string | null {
  const parts = path.split("/");

  // Skip files in the root directory or common root config files
  if (parts.length <= 1 || isRootConfigFile(path)) {
    return null;
  }

  let area = parts[0];

  if (area === "packages") {
    area = `${parts[1]}`;
  } else if (parts.length > 2) {
    area = `${area}/${parts[1]}`;
  } else {
    area = parts[0];
  }

  return area;
}

/**
 * Check if a file is a common root configuration file that should be ignored
 */
function isRootConfigFile(path: string): boolean {
  const rootConfigPatterns = [
    /^package\.json$/,
    /^bun\.lock$/,
    /^\.gitignore$/,
    /^\.env(\.\w+)?$/,
    /^tsconfig\.json$/,
    /^README\.md$/,
    /^LICENSE$/,
    /^yarn\.lock$/,
    /^pnpm-lock\.yaml$/,
    /^\.eslintrc(\.\w+)?$/,
    /^\.prettierrc(\.\w+)?$/,
    /^vite\.config\.\w+$/,
    /^next\.config\.\w+$/,
    /^tailwind\.config\.\w+$/,
  ];

  const filename = path.split("/").pop() || "";
  return rootConfigPatterns.some((pattern) => pattern.test(filename));
}

export type WorkItemType =
  | "feature"
  | "bugfix"
  | "refactor"
  | "docs"
  | "tests"
  | "other";

/**
 * Utility to build a map of focus areas from files
 */
export function buildAreaMap(
  files: { path?: string; filename?: string }[],
): Map<string, number> {
  const areaMap = new Map<string, number>();

  files.forEach((file) => {
    // Use path or filename depending on which is available
    const filePath = file.path || file.filename || "";
    if (!filePath) return;

    const area = extractAreaFromPath(filePath);
    // Skip null areas (root files or ignored config files)
    if (!area) return;

    const currentCount = areaMap.get(area) || 0;
    areaMap.set(area, currentCount + 1);
  });

  return areaMap;
}
