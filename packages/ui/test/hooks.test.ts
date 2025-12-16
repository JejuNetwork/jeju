/**
 * UI Hooks Tests
 * 
 * Tests for React hooks provided by @jejunetwork/ui
 */

import { describe, expect, test } from "bun:test";

// Test that all hooks are exported
describe("UI Package Exports", () => {
  test("exports NetworkProvider", async () => {
    const { NetworkProvider } = await import("../src/index");
    expect(NetworkProvider).toBeDefined();
    expect(typeof NetworkProvider).toBe("function");
  });

  test("exports useJeju hook", async () => {
    const { useJeju } = await import("../src/index");
    expect(useJeju).toBeDefined();
    expect(typeof useJeju).toBe("function");
  });

  test("exports useBalance hook", async () => {
    const { useBalance } = await import("../src/index");
    expect(useBalance).toBeDefined();
    expect(typeof useBalance).toBe("function");
  });

  test("exports useCompute hook", async () => {
    const { useCompute } = await import("../src/index");
    expect(useCompute).toBeDefined();
    expect(typeof useCompute).toBe("function");
  });

  test("exports useStorage hook", async () => {
    const { useStorage } = await import("../src/index");
    expect(useStorage).toBeDefined();
    expect(typeof useStorage).toBe("function");
  });

  test("exports useDefi hook", async () => {
    const { useDefi } = await import("../src/index");
    expect(useDefi).toBeDefined();
    expect(typeof useDefi).toBe("function");
  });

  test("exports useGovernance hook", async () => {
    const { useGovernance } = await import("../src/index");
    expect(useGovernance).toBeDefined();
    expect(typeof useGovernance).toBe("function");
  });

  test("exports useNames hook", async () => {
    const { useNames } = await import("../src/index");
    expect(useNames).toBeDefined();
    expect(typeof useNames).toBe("function");
  });

  test("exports useIdentity hook", async () => {
    const { useIdentity } = await import("../src/index");
    expect(useIdentity).toBeDefined();
    expect(typeof useIdentity).toBe("function");
  });

  test("exports useCrossChain hook", async () => {
    const { useCrossChain } = await import("../src/index");
    expect(useCrossChain).toBeDefined();
    expect(typeof useCrossChain).toBe("function");
  });

  test("exports usePayments hook", async () => {
    const { usePayments } = await import("../src/index");
    expect(usePayments).toBeDefined();
    expect(typeof usePayments).toBe("function");
  });
});

describe("Hook Return Types", () => {
  test("hooks throw when used outside provider", async () => {
    const { useJeju } = await import("../src/index");
    
    // Hooks should throw when used outside JejuProvider
    expect(() => {
      // This would throw in React context
      try {
        useJeju();
      } catch (e) {
        throw e;
      }
    }).toThrow();
  });
});

