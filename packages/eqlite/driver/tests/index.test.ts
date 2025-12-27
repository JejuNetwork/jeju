import { describe, expect, it, mock, beforeEach, afterEach } from "bun:test"
import { createConnection, Connection } from "../src/index"
import type { ConnectionConfig } from "../src/ConnectionConfig"

const mockConfig: ConnectionConfig = {
  endpoint: "http://testnet-proxy.eqlite.io",
  dbid: "16c421128eeb8bb6c35eb633a16d206edbd653ce52c52dcda0abb767d2bb9ed0",
}

const originalFetch = global.fetch

/**
 * Create a mock fetch that handles API detection and returns EQLite responses
 */
function mockEqliteFetch(dataRows: Record<string, unknown>[] | null = [{ result: 1 }]) {
  const fetchMock = mock(async (url: string) => {
    // API detection calls - return 404 to fall back to EQLite
    if (url.includes("/status") || url.includes("/api/v1/status")) {
      return new Response("Not found", { status: 404 })
    }
    // EQLite query/exec calls
    if (url.includes("/v1/query") || url.includes("/v1/exec")) {
      return new Response(
        JSON.stringify({
          data: { rows: dataRows },
          status: "ok",
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    }
    return new Response("Not found", { status: 404 })
  })
  globalThis.fetch = fetchMock as unknown as typeof fetch
  return fetchMock
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("Connection", () => {
  it("creates a connection instance", () => {
    const connection = new Connection(mockConfig)
    expect(connection.config).toEqual(mockConfig)
    expect(connection.state).toBe("disconnected")
    expect(connection.isConnected).toBe(false)
  })
})

describe("createConnection", () => {
  beforeEach(() => {
    mockEqliteFetch([{ result: 1 }])
  })

  it("establishes connection with SELECT 1", async () => {
    const connection = await createConnection(mockConfig)
    expect(connection.isConnected).toBe(true)
    expect(connection.state).toBe("connected")
  })
})

describe("query", () => {
  beforeEach(() => {
    mockEqliteFetch([{ sum: 5 }])
  })

  it("executes a query and returns rows", async () => {
    const connection = await createConnection(mockConfig)
    const result = await connection.query("SELECT ? + ?", [2, 3])
    expect(result).toEqual([{ sum: 5 }])
  })
})

describe("exec", () => {
  let currentFetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    currentFetchMock = mockEqliteFetch([])
  })

  it("executes an insert and returns result", async () => {
    const connection = await createConnection(mockConfig)
    const result = await connection.exec("INSERT INTO test VALUES (?)", ["value1"])
    expect(result).toEqual([])
  })

  it("calls the exec endpoint", async () => {
    const connection = await createConnection(mockConfig)
    await connection.exec("INSERT INTO test VALUES (?)", ["value1"])

    // Find the exec call
    const calls = currentFetchMock.mock.calls
    const execCall = calls.find(
      (call) => (call[0] as string).includes("/exec")
    )
    expect(execCall).toBeTruthy()
  })
})

describe("error handling", () => {
  it("throws on HTTP error", async () => {
    const fetchMock = mock(async (url: string) => {
      if (url.includes("/status") || url.includes("/api/v1/status")) {
        return new Response("Not found", { status: 404 })
      }
      return new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" })
    })
    globalThis.fetch = fetchMock as unknown as typeof fetch

    const connection = new Connection(mockConfig)
    await expect(connection.query("SELECT 1")).rejects.toThrow(
      "EQLite request failed: 500 Internal Server Error"
    )
  })
})

