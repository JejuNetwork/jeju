/**
 * Unit tests for Docker build utilities
 *
 * Tests platform string computation for multi-arch builds.
 */

import { describe, it, expect } from "bun:test";

// ============ Functions Under Test ============

interface BuildFlags {
  armOnly: boolean;
  x86Only: boolean;
}

/**
 * Get platform string for Docker buildx based on CLI flags
 */
function getPlatforms(flags: BuildFlags): string {
  if (flags.armOnly) return "linux/arm64";
  if (flags.x86Only) return "linux/amd64";
  return "linux/amd64,linux/arm64";
}

/**
 * Determine if build is multi-platform (affects --load vs --push behavior)
 */
function isMultiPlatform(platforms: string): boolean {
  return platforms.includes(",");
}

/**
 * Parse platform string into array of platforms
 */
function parsePlatforms(platforms: string): string[] {
  return platforms.split(",").map((p) => p.trim());
}

/**
 * Get architecture suffix from platform string
 */
function getArchSuffix(platform: string): string {
  if (platform.includes("arm64")) return "arm64";
  if (platform.includes("amd64") || platform.includes("x86_64")) return "amd64";
  throw new Error(`Unknown architecture in platform: ${platform}`);
}

/**
 * Check if platform string is valid Docker format
 */
function isValidPlatformString(platform: string): boolean {
  const validPlatforms = [
    "linux/amd64",
    "linux/arm64",
    "linux/arm/v7",
    "linux/arm/v6",
    "linux/386",
    "darwin/amd64",
    "darwin/arm64",
    "windows/amd64",
  ];
  
  const platforms = platform.split(",").map((p) => p.trim());
  return platforms.every((p) => validPlatforms.includes(p));
}

// ============ Tests ============

describe("getPlatforms", () => {
  it("should return arm64 only when armOnly flag is set", () => {
    expect(getPlatforms({ armOnly: true, x86Only: false })).toBe("linux/arm64");
  });

  it("should return amd64 only when x86Only flag is set", () => {
    expect(getPlatforms({ armOnly: false, x86Only: true })).toBe("linux/amd64");
  });

  it("should return both platforms when no flags set", () => {
    expect(getPlatforms({ armOnly: false, x86Only: false })).toBe(
      "linux/amd64,linux/arm64"
    );
  });

  it("should prioritize armOnly over x86Only when both set", () => {
    // This tests the current implementation behavior
    expect(getPlatforms({ armOnly: true, x86Only: true })).toBe("linux/arm64");
  });
});

describe("isMultiPlatform", () => {
  it("should return true for multi-platform string", () => {
    expect(isMultiPlatform("linux/amd64,linux/arm64")).toBe(true);
  });

  it("should return false for single platform", () => {
    expect(isMultiPlatform("linux/amd64")).toBe(false);
    expect(isMultiPlatform("linux/arm64")).toBe(false);
  });

  it("should return true for any comma-separated string", () => {
    expect(isMultiPlatform("a,b")).toBe(true);
    expect(isMultiPlatform("linux/amd64,linux/arm64,linux/arm/v7")).toBe(true);
  });
});

describe("parsePlatforms", () => {
  it("should parse single platform", () => {
    expect(parsePlatforms("linux/amd64")).toEqual(["linux/amd64"]);
  });

  it("should parse multiple platforms", () => {
    expect(parsePlatforms("linux/amd64,linux/arm64")).toEqual([
      "linux/amd64",
      "linux/arm64",
    ]);
  });

  it("should handle whitespace", () => {
    expect(parsePlatforms("linux/amd64, linux/arm64")).toEqual([
      "linux/amd64",
      "linux/arm64",
    ]);
    expect(parsePlatforms("linux/amd64 , linux/arm64")).toEqual([
      "linux/amd64",
      "linux/arm64",
    ]);
  });

  it("should handle three or more platforms", () => {
    expect(parsePlatforms("linux/amd64,linux/arm64,linux/arm/v7")).toEqual([
      "linux/amd64",
      "linux/arm64",
      "linux/arm/v7",
    ]);
  });
});

describe("getArchSuffix", () => {
  it("should return arm64 for ARM platforms", () => {
    expect(getArchSuffix("linux/arm64")).toBe("arm64");
    expect(getArchSuffix("darwin/arm64")).toBe("arm64");
  });

  it("should return amd64 for x86_64 platforms", () => {
    expect(getArchSuffix("linux/amd64")).toBe("amd64");
    expect(getArchSuffix("darwin/amd64")).toBe("amd64");
    expect(getArchSuffix("linux/x86_64")).toBe("amd64");
  });

  it("should throw for unknown architectures", () => {
    expect(() => getArchSuffix("linux/386")).toThrow("Unknown architecture");
    expect(() => getArchSuffix("linux/arm/v7")).toThrow("Unknown architecture");
    expect(() => getArchSuffix("unknown")).toThrow("Unknown architecture");
  });
});

describe("isValidPlatformString", () => {
  it("should accept valid single platforms", () => {
    expect(isValidPlatformString("linux/amd64")).toBe(true);
    expect(isValidPlatformString("linux/arm64")).toBe(true);
    expect(isValidPlatformString("darwin/amd64")).toBe(true);
    expect(isValidPlatformString("darwin/arm64")).toBe(true);
  });

  it("should accept valid multi-platform strings", () => {
    expect(isValidPlatformString("linux/amd64,linux/arm64")).toBe(true);
    expect(isValidPlatformString("darwin/amd64,darwin/arm64")).toBe(true);
  });

  it("should reject invalid platforms", () => {
    expect(isValidPlatformString("linux/x86")).toBe(false);
    expect(isValidPlatformString("freebsd/amd64")).toBe(false);
    expect(isValidPlatformString("linux")).toBe(false);
    expect(isValidPlatformString("amd64")).toBe(false);
  });

  it("should reject if any platform is invalid in multi-platform", () => {
    expect(isValidPlatformString("linux/amd64,invalid")).toBe(false);
    expect(isValidPlatformString("invalid,linux/arm64")).toBe(false);
  });
});

describe("Docker tag generation", () => {
  interface TagConfig {
    network: string;
    gitHash: string;
    registry?: string;
    app: string;
  }

  function generateTags(config: TagConfig): { fullTag: string; latestTag: string } {
    const imageName = config.registry
      ? `${config.registry}/jeju/${config.app}`
      : `jeju/${config.app}`;
    return {
      fullTag: `${imageName}:${config.network}-${config.gitHash}`,
      latestTag: `${imageName}:${config.network}-latest`,
    };
  }

  it("should generate correct local tags", () => {
    const tags = generateTags({
      network: "testnet",
      gitHash: "abc1234",
      app: "bazaar",
    });
    expect(tags.fullTag).toBe("jeju/bazaar:testnet-abc1234");
    expect(tags.latestTag).toBe("jeju/bazaar:testnet-latest");
  });

  it("should generate correct ECR tags", () => {
    const tags = generateTags({
      network: "mainnet",
      gitHash: "def5678",
      registry: "123456789.dkr.ecr.us-east-1.amazonaws.com",
      app: "gateway",
    });
    expect(tags.fullTag).toBe(
      "123456789.dkr.ecr.us-east-1.amazonaws.com/jeju/gateway:mainnet-def5678"
    );
    expect(tags.latestTag).toBe(
      "123456789.dkr.ecr.us-east-1.amazonaws.com/jeju/gateway:mainnet-latest"
    );
  });

  it("should handle localnet network", () => {
    const tags = generateTags({
      network: "localnet",
      gitHash: "1234567",
      app: "indexer",
    });
    expect(tags.fullTag).toBe("jeju/indexer:localnet-1234567");
    expect(tags.latestTag).toBe("jeju/indexer:localnet-latest");
  });
});

describe("Buildx builder selection", () => {
  interface BuilderInfo {
    name: string;
    platforms: string[];
    isActive: boolean;
  }

  function selectBuilder(
    builders: BuilderInfo[],
    requiredPlatforms: string[]
  ): BuilderInfo | null {
    const preferredOrder = ["desktop-linux", "default"];
    
    for (const preferredName of preferredOrder) {
      const builder = builders.find((b) => b.name === preferredName);
      if (builder && requiredPlatforms.every((p) => builder.platforms.includes(p))) {
        return builder;
      }
    }
    
    // Look for any builder with all required platforms
    return (
      builders.find((b) =>
        requiredPlatforms.every((p) => b.platforms.includes(p))
      ) ?? null
    );
  }

  it("should prefer desktop-linux builder", () => {
    const builders: BuilderInfo[] = [
      { name: "default", platforms: ["linux/amd64"], isActive: false },
      {
        name: "desktop-linux",
        platforms: ["linux/amd64", "linux/arm64"],
        isActive: true,
      },
    ];
    
    const selected = selectBuilder(builders, ["linux/amd64", "linux/arm64"]);
    expect(selected?.name).toBe("desktop-linux");
  });

  it("should fall back to default if desktop-linux missing platforms", () => {
    const builders: BuilderInfo[] = [
      {
        name: "default",
        platforms: ["linux/amd64", "linux/arm64"],
        isActive: true,
      },
      { name: "desktop-linux", platforms: ["linux/amd64"], isActive: false },
    ];
    
    const selected = selectBuilder(builders, ["linux/amd64", "linux/arm64"]);
    expect(selected?.name).toBe("default");
  });

  it("should return null if no builder has required platforms", () => {
    const builders: BuilderInfo[] = [
      { name: "default", platforms: ["linux/amd64"], isActive: true },
    ];
    
    const selected = selectBuilder(builders, ["linux/amd64", "linux/arm64"]);
    expect(selected).toBeNull();
  });
});

describe("Build argument construction", () => {
  function buildDockerArgs(opts: {
    platforms: string;
    tags: string[];
    dockerfile: string;
    context: string;
    push: boolean;
  }): string[] {
    const args = [
      "docker",
      "buildx",
      "build",
      "--platform",
      opts.platforms,
    ];
    
    for (const tag of opts.tags) {
      args.push("-t", tag);
    }
    
    args.push("-f", opts.dockerfile);
    
    const isMulti = opts.platforms.includes(",");
    
    if (opts.push) {
      args.push("--push");
    } else if (!isMulti) {
      args.push("--load");
    }
    
    args.push(opts.context);
    
    return args;
  }

  it("should construct correct args for single platform build", () => {
    const args = buildDockerArgs({
      platforms: "linux/amd64",
      tags: ["jeju/app:tag"],
      dockerfile: "Dockerfile",
      context: ".",
      push: false,
    });
    
    expect(args).toContain("--load");
    expect(args).not.toContain("--push");
    expect(args).toContain("linux/amd64");
  });

  it("should construct correct args for multi-platform push", () => {
    const args = buildDockerArgs({
      platforms: "linux/amd64,linux/arm64",
      tags: ["jeju/app:tag", "jeju/app:latest"],
      dockerfile: "Dockerfile",
      context: ".",
      push: true,
    });
    
    expect(args).toContain("--push");
    expect(args).not.toContain("--load");
  });

  it("should not include --load for multi-platform without push", () => {
    const args = buildDockerArgs({
      platforms: "linux/amd64,linux/arm64",
      tags: ["jeju/app:tag"],
      dockerfile: "Dockerfile",
      context: ".",
      push: false,
    });
    
    expect(args).not.toContain("--load");
    expect(args).not.toContain("--push");
  });
});
