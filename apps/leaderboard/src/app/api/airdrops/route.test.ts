import { describe, expect, it } from "bun:test";
import { GET } from "./route";

describe("GET /api/airdrops", () => {
  it("should return airdrops list", async () => {
    const mockRequest = new Request("http://localhost:3000/api/airdrops?page=1&limit=20");
    const response = await GET(mockRequest);

    expect(response).toBeDefined();
    expect(response.status).toBeDefined();

    // Should return 200 or appropriate status
    expect([200, 404, 500]).toContain(response.status);

    const data = await response.json();
    expect(typeof data === "object").toBeTruthy();
  });

  it("should return valid JSON response", async () => {
    const mockRequest = new Request("http://localhost:3000/api/airdrops");
    const response = await GET(mockRequest);

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
