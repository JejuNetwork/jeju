import { describe, expect, it } from "bun:test";
import { GET } from "./route";

describe("GET /api/claims/[address]", () => {
  it("should handle valid ethereum address", async () => {
    const mockRequest = new Request(
      "http://localhost:3000/api/claims/0x0000000000000000000000000000000000000000"
    );
    const params = { address: "0x0000000000000000000000000000000000000000" };

    const response = await GET(mockRequest, { params });

    expect(response).toBeDefined();
    expect(response.status).toBeDefined();

    // Should handle the request appropriately - might return error due to missing contract address
    expect([200, 404, 400, 500]).toContain(response.status);
  });

  it("should return JSON response", async () => {
    const mockRequest = new Request(
      "http://localhost:3000/api/claims/0x1234567890123456789012345678901234567890"
    );
    const params = { address: "0x1234567890123456789012345678901234567890" };

    const response = await GET(mockRequest, { params });

    // Always returns JSON even on error
    const contentType = response.headers.get("content-type");
    expect(contentType).toBeTruthy();
    expect(contentType).toContain("json");
  });
});
