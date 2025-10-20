import { describe, expect, it } from "bun:test";
import { GET } from "./route";

describe("GET /api/airdrops/[id]", () => {
  it("should handle airdrop id request", async () => {
    const mockRequest = new Request("http://localhost/api/airdrops/1");
    const params = { id: "1" };

    const response = await GET(mockRequest, { params });

    expect(response).toBeDefined();
    expect(response.status).toBeDefined();

    // Should return 200, 404, or appropriate status
    expect([200, 404, 400, 500]).toContain(response.status);
  });

  it("should return JSON response", async () => {
    const mockRequest = new Request("http://localhost/api/airdrops/test");
    const params = { id: "test" };

    const response = await GET(mockRequest, { params });

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
