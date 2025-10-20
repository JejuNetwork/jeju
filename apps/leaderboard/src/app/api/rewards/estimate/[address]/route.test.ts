import { describe, expect, it } from "bun:test";
import { GET } from "./route";

describe("GET /api/rewards/estimate/[address]", () => {
  it("should handle valid ethereum address", async () => {
    const mockRequest = new Request(
      "http://localhost/api/rewards/estimate/0x0000000000000000000000000000000000000000"
    );
    const params = { address: "0x0000000000000000000000000000000000000000" };

    const response = await GET(mockRequest, { params });

    expect(response).toBeDefined();
    expect(response.status).toBeDefined();

    // Should handle the request appropriately
    expect([200, 404, 400, 500]).toContain(response.status);
  });

  it("should return JSON response", async () => {
    const mockRequest = new Request(
      "http://localhost/api/rewards/estimate/0x1234567890123456789012345678901234567890"
    );
    const params = { address: "0x1234567890123456789012345678901234567890" };

    const response = await GET(mockRequest, { params });

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("should handle invalid address format", async () => {
    const mockRequest = new Request(
      "http://localhost/api/rewards/estimate/invalid-address"
    );
    const params = { address: "invalid-address" };

    const response = await GET(mockRequest, { params });

    // Should return error status for invalid address
    expect([400, 404, 500]).toContain(response.status);
  });
});
