# AGENTS.md

This document provides a comprehensive guide for an AI agent to effectively write, run, and manage unit and integration tests for a NextJS/TypeScript SDK project using Bun's built-in test runner.

---

## 🚀 Getting Started

Bun comes with a built-in, Jest-compatible test runner that's incredibly fast. To start, you don't need to install any extra packages. The test runner is part of the `bun` CLI.

### File Discovery

Bun's test runner automatically finds and executes tests in files that match the following patterns anywhere in your project:

- `*.test.{js|jsx|ts|tsx}`
- `*_test.{js|jsx|ts|tsx}`
- `*.spec.{js|jsx|ts|tsx}`
- `*_spec.{js|jsx|ts|tsx}`

### Test file locations

This codebase colocates test files with the code files, so dont put tests in separate **test** directories.

### Running Tests

Execute tests using the `bun test` command.

```shell
# Run all tests in the project
bun test

# Run all tests within a specific directory (by path fragment)
bun test <directory_name>

# Run a specific test file (by path fragment)
bun test <filename_fragment>

# Run a specific test file by its exact path
bun test ./tests/specific-file.test.ts
```

---

## ✍️ Writing Tests

Bun's test runner is designed to be a drop-in replacement for Jest. It uses a familiar `describe`, `test`, and `expect` API.

### Basic Test Structure

Tests are defined with the `test()` function (or its alias `it()`) and grouped into suites with `describe()`. Assertions are made using `expect()`.

```typescript
// Import test utilities from bun:test
import { test, expect, describe } from "bun:test";

describe("SDK Math Utilities", () => {
  // A simple synchronous test
  test("should add two numbers correctly", () => {
    expect(2 + 2).toBe(4);
  });

  // An asynchronous test using async/await
  test("should resolve a promise", async () => {
    const result = await Promise.resolve("hello");
    expect(result).toEqual("hello");
  });
});
```

### Assertions with `expect`

Bun implements the full Jest `expect` API. Here are some common matchers:

- `.toBe(value)`: Strict equality (`===`).
- `.toEqual(value)`: Deep equality for objects and arrays.
- `.toThrow(error?)`: Checks if a function throws an error.
- `.toHaveBeenCalled()`: For checking if a mock function was called.
- `.toHaveBeenCalledWith(...args)`: Checks arguments passed to a mock.
- `.toMatchSnapshot()`: Performs snapshot testing.
- `.toMatchInlineSnapshot()`: Performs inline snapshot testing.

You can also verify that a certain number of assertions were called, which is useful in asynchronous code.

```typescript
test("should run a specific number of assertions", () => {
  expect.hasAssertions(); // Ensures at least one assertion is called
  expect.assertions(2); // Ensures exactly two assertions are called

  expect(1).toBe(1);
  expect(true).not.toBe(false);
});
```

### Parametrized Tests with `.each`

Run the same test logic with different data using `test.each` or `describe.each`. This is ideal for data-driven testing.

```typescript
const additionCases = [
  [1, 2, 3],
  [0, 0, 0],
  [-5, 5, 0],
];

test.each(additionCases)("add(%i, %i) should equal %i", (a, b, expected) => {
  expect(a + b).toBe(expected);
});
```

---

## 🧪 Test Database & Mock Data

For integration tests that involve database queries, the project provides helper functions to ensure a consistent and isolated testing environment.

### Test Database Setup

Use the `setupTestDb` function from `src/__testing__/helpers/db.ts` to create a fresh, in-memory SQLite database for your test suites. This function handles schema migrations automatically.

**Pattern:** Instantiate the database at the beginning of your `describe` block.

```typescript
import { describe, test, expect } from "bun:test";
import { setupTestDb } from "@/src/__testing__/helpers/db";

describe("Database-Related Feature", () => {
  const db = setupTestDb();
  // ... tests that use db instance
});
```

### Mock Data Generation

Use the mock data generators from `src/__testing__/helpers/mock-data.ts` (e.g., `generateMockUsers`, `generateMockPullRequests`) to populate your test database. These functions use `@faker-js/faker` to produce realistic data and allow you to override any fields for specific test cases.

### Complete Test Example

Follow this pattern for writing tests that interact with the database. This ensures that tests are self-contained, repeatable, and easy to understand.

```typescript
import { describe, test, expect } from "bun:test";
import { setupTestDb } from "@/src/__testing__/helpers/db";
import {
  generateMockUsers,
  generateMockPullRequests,
} from "@/src/__testing__/helpers/mock-data";
import * as schema from "@/lib/data/schema";
import { getRepositoryContributors } from "./queries"; // The function being tested

describe("Repository Queries", () => {
  const db = setupTestDb();

  test("should return unique contributors for a given repository", async () => {
    // 1. Arrange: Insert mock data
    const users = generateMockUsers([
      { username: "user-a" },
      { username: "user-b" },
    ]);
    await db.insert(schema.users).values(users);

    const pullRequests = generateMockPullRequests([
      { author: "user-a", repository: "test-repo" },
      { author: "user-b", repository: "test-repo" },
      { author: "user-a", repository: "another-repo" }, // Should be filtered out
    ]);
    await db.insert(schema.rawPullRequests).values(pullRequests);

    // 2. Act: Call the function
    const contributors = await getRepositoryContributors(db, "test-repo");

    // 3. Assert: Verify the result
    expect(contributors).toHaveLength(2);
    expect(contributors.map((c) => c.username).sort()).toEqual([
      "user-a",
      "user-b",
    ]);
  });
});
```

---

## 🔬 Advanced Testing Techniques

### Mocking

#### Mocking Functions

Use `mock()` to create a mock function. This allows you to track calls, arguments, and return values.

```typescript
import { test, expect, mock } from "bun:test";

const getAPIData = mock((id: string) => ({ id, data: "some data" }));

test("API data fetching", () => {
  const result = getAPIData("user-123");

  expect(getAPIData).toHaveBeenCalled();
  expect(getAPIData).toHaveBeenCalledTimes(1);
  expect(getAPIData).toHaveBeenCalledWith("user-123");
  expect(result.data).toBe("some data");
});
```

#### Spying on Methods

Use `spyOn()` to track calls to an existing object's method without replacing its original implementation.

```typescript
import { test, expect, spyOn } from "bun:test";

const analyticsService = {
  trackEvent(eventName: string) {
    console.log(`Event tracked: ${eventName}`);
  },
};

test("should track events", () => {
  const spy = spyOn(analyticsService, "trackEvent");

  analyticsService.trackEvent("sdk_initialized");

  expect(spy).toHaveBeenCalledTimes(1);
  expect(spy).toHaveBeenCalledWith("sdk_initialized");
});
```

#### Mocking Modules

To mock an entire module, create a preload script and tell Bun to load it before running tests.

1.  **Create the preload script:**

    ```typescript
    // mocks/my-module-mock.ts
    import { mock } from "bun:test";

    mock.module("./path/to/original-module", () => {
      return {
        default: () => "mocked function result",
        someNamedExport: "mocked value",
      };
    });
    ```

2.  **Run tests with the `--preload` flag:**
    ```shell
    bun test --preload ./mocks/my-module-mock.ts
    ```
3.  **Or configure it in `bunfig.toml`:**
    ```toml
    [test]
    preload = ["./mocks/my-module-mock.ts"]
    ```

### Snapshot Testing

Snapshot tests are useful for ensuring that large objects or UI components don't change unexpectedly.

```typescript
import { test, expect } from "bun:test";

test("SDK configuration object snapshot", () => {
  const config = {
    apiKey: "key-123",
    retries: 3,
    features: {
      featureA: true,
      featureB: false,
    },
  };
  // On the first run, this creates a .snap file.
  // On subsequent runs, it compares the object to the saved snapshot.
  expect(config).toMatchSnapshot();
});

test("inline snapshot", () => {
  // The snapshot is written directly into the test file by Bun.
  expect({ foo: "bar" }).toMatchInlineSnapshot(`
      {
        "foo": "bar",
      }
    `);
});
```

To update snapshots if the change is intentional:

```shell
bun test --update-snapshots
```

### DOM Testing for NextJS Components

For testing NextJS components, you'll need a DOM environment and a testing library.

1.  **Install Dependencies:**

    ```shell
    bun add -D @happy-dom/global-registrator @testing-library/react @testing-library/jest-dom
    ```

2.  **Create a Preload Script for Setup:** Create two files to configure the environment.

    ```typescript
    // tests/setup/happydom.ts
    import { GlobalRegistrator } from "@happy-dom/global-registrator";
    GlobalRegistrator.register();
    ```

    ```typescript
    // tests/setup/testing-library.ts
    import { afterEach, expect } from "bun:test";
    import { cleanup } from "@testing-library/react";
    import * as matchers from "@testing-library/jest-dom/matchers";

    // Extend Bun's expect with Jest-DOM matchers
    expect.extend(matchers);

    // Clean up the DOM after each test
    afterEach(() => {
      cleanup();
    });
    ```

3.  **Configure `bunfig.toml`:**

    ```toml
    [test]
    preload = ["./tests/setup/happydom.ts", "./tests/setup/testing-library.ts"]
    ```

4.  **Write a Component Test:** Now you can write tests for your React components.

    ```tsx
    // components/MyComponent.test.tsx
    import { test, expect } from "bun:test";
    import { render, screen } from "@testing-library/react";
    import MyComponent from "./MyComponent"; // Your React component

    test("MyComponent should render correctly", () => {
      render(<MyComponent />);
      const element = screen.getByText("Hello from Component");
      expect(element).toBeInTheDocument();
    });
    ```

---

## ⚙️ Configuration and CLI

### Controlling Test Execution

- **Run only specific tests:** Use `.only` on `test` or `describe` blocks.

  ```typescript
  test.only("this test will run", () => {});
  test("this test will be skipped", () => {});
  ```

  To run all tests marked with `.only`, use the `--only` flag: `bun test --only`.

- **Skip tests:** Use `.skip` to temporarily disable tests.

  ```typescript
  test.skip("this test is skipped", () => {});
  ```

- **Filter by name:** Run tests whose name matches a pattern.

  ```shell
  bun test -t "should add"
  ```

- **Bail on failure:** Stop the test run after a certain number of failures.

  ```shell
  bun test --bail # Stop after the first failure
  bun test --bail=3 # Stop after 3 failures
  ```

- **Set timeouts:** Change the default 5-second timeout.

  ```shell
  # Set timeout via CLI for all tests
  bun test --timeout 10000 # 10 seconds

  # Set timeout for a specific test
  test("long running task", async () => {
    // ...
  }, 30000); // 30s timeout for this test
  ```

### Watch Mode

For rapid development, run tests in watch mode to automatically re-run them on file changes.

```shell
bun test --watch
```

### Code Coverage

Generate a code coverage report using the `--coverage` flag.

```shell
bun test --coverage
```

You can configure coverage options in `bunfig.toml`.

```toml
[test]
# Always generate coverage
coverage = true

# Set a minimum coverage threshold (e.g., 80%)
# The test run will fail if coverage is below this value.
coverageThreshold = 0.8

# Exclude test files from the coverage report
coverageSkipTestFiles = true
```

---

## 🔄 CI/CD Integration

To integrate Bun tests into a CI pipeline like GitHub Actions, you can use a workflow like this:

```yaml
# .github/workflows/test.yml
jobs:
  test:
    name: Run Tests
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Install Bun
        uses: oven-sh/setup-bun@v2

      - name: Install Dependencies
        run: bun install

      - name: Run Tests
        run: bun test
```

For more detailed reporting in CI systems, you can generate a JUnit XML report.

```shell
bun test --reporter=junit --reporter-outfile=./junit-report.xml
```
