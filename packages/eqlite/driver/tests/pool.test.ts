/**
 * Connection Pool Tests
 */

import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { ConnectionPool, createPool } from "../src/ConnectionPool"

const originalFetch = global.fetch

describe("ConnectionPool", () => {
  beforeEach(() => {
    // Mock successful rqlite responses
    global.fetch = mock(async (url: string) => {
      if (url.includes("/status")) {
        return new Response(
          JSON.stringify({
            store: { raft: { state: "Leader" } },
          }),
          { status: 200 }
        )
      }
      if (url.includes("/db/query")) {
        return new Response(
          JSON.stringify({
            results: [{ columns: ["1"], values: [[1]] }],
          }),
          { status: 200 }
        )
      }
      if (url.includes("/db/execute")) {
        return new Response(
          JSON.stringify({
            results: [{ rows_affected: 1 }],
          }),
          { status: 200 }
        )
      }
      // EQLite API endpoints
      if (url.includes("/v1/query") || url.includes("/v1/exec")) {
        return new Response(
          JSON.stringify({
            data: { rows: [{ "1": 1 }] },
            status: "ok",
          }),
          { status: 200 }
        )
      }
      if (url.includes("/health")) {
        return new Response("OK", { status: 200 })
      }
      return new Response("Not found", { status: 404 })
    }) as typeof fetch
  })

  afterEach(async () => {
    global.fetch = originalFetch
  })

  test("should create pool with minimum connections", async () => {
    const pool = await createPool({
      endpoint: "http://localhost:4001",
      dbid: "test",
      minConnections: 3,
      maxConnections: 10,
    })

    const stats = pool.stats()
    expect(stats.total).toBe(3)
    expect(stats.idle).toBe(3)
    expect(stats.active).toBe(0)

    await pool.close()
  })

  test("should acquire and release connections", async () => {
    const pool = await createPool({
      endpoint: "http://localhost:4001",
      dbid: "test",
      minConnections: 2,
      maxConnections: 5,
    })

    // Acquire a connection
    const conn = await pool.acquire()
    expect(conn.isConnected).toBe(true)

    let stats = pool.stats()
    expect(stats.active).toBe(1)
    expect(stats.idle).toBe(1)

    // Release the connection
    pool.release(conn)

    stats = pool.stats()
    expect(stats.active).toBe(0)
    expect(stats.idle).toBe(2)

    await pool.close()
  })

  test("should create new connections when needed", async () => {
    const pool = await createPool({
      endpoint: "http://localhost:4001",
      dbid: "test",
      minConnections: 1,
      maxConnections: 5,
    })

    // Acquire multiple connections
    const conn1 = await pool.acquire()
    const conn2 = await pool.acquire()
    const conn3 = await pool.acquire()

    const stats = pool.stats()
    expect(stats.total).toBe(3)
    expect(stats.active).toBe(3)

    // Release all
    pool.release(conn1)
    pool.release(conn2)
    pool.release(conn3)

    await pool.close()
  })

  test("should execute query via pool", async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes("/v1/query")) {
        return new Response(
          JSON.stringify({
            data: {
              rows: [{ id: 1, name: "Test" }],
            },
            status: "ok",
          }),
          { status: 200 }
        )
      }
      return new Response("Not found", { status: 404 })
    }) as typeof fetch

    const pool = await createPool({
      endpoint: "http://localhost:4661",
      dbid: "test",
      minConnections: 2,
    })

    const rows = await pool.query("SELECT * FROM users WHERE id = ?", [1])
    expect(rows).toEqual([{ id: 1, name: "Test" }])

    await pool.close()
  })

  test("should execute write via pool", async () => {
    global.fetch = mock(async (url: string) => {
      if (url.includes("/v1/query")) {
        return new Response(
          JSON.stringify({
            data: { rows: [{ "1": 1 }] },
            status: "ok",
          }),
          { status: 200 }
        )
      }
      if (url.includes("/v1/exec")) {
        return new Response(
          JSON.stringify({
            data: { rows: [] },
            status: "ok",
          }),
          { status: 200 }
        )
      }
      return new Response("Not found", { status: 404 })
    }) as typeof fetch

    const pool = await createPool({
      endpoint: "http://localhost:4661",
      dbid: "test",
      minConnections: 2,
    })

    const result = await pool.exec("INSERT INTO users (name) VALUES (?)", ["Alice"])
    expect(result).toEqual([])

    await pool.close()
  })

  test("should get pool stats", async () => {
    const pool = await createPool({
      endpoint: "http://localhost:4001",
      dbid: "test",
      minConnections: 2,
      maxConnections: 10,
    })

    const stats = pool.stats()
    expect(stats).toHaveProperty("total")
    expect(stats).toHaveProperty("active")
    expect(stats).toHaveProperty("idle")
    expect(stats).toHaveProperty("waiting")

    expect(stats.total).toBe(2)
    expect(stats.active).toBe(0)
    expect(stats.idle).toBe(2)
    expect(stats.waiting).toBe(0)

    await pool.close()
  })

  test("should close all connections on pool close", async () => {
    const pool = await createPool({
      endpoint: "http://localhost:4001",
      dbid: "test",
      minConnections: 3,
    })

    expect(pool.stats().total).toBe(3)

    await pool.close()

    expect(pool.stats().total).toBe(0)
  })
})

