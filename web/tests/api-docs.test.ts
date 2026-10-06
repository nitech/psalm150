import { describe, expect, it } from "vitest";
import { curlExample, groupOperations, inline, sample, typeLabel, type Schema } from "../src/views/api-docs.ts";

const schemas: Record<string, Schema> = {
  RoomStatus: { type: "string", enum: ["live", "blank", "idle", "offline"] },
  RoomSlide: { type: "object", properties: { label: { type: "string" }, lines: { type: "array", items: { type: "string" } } } },
  RoomNameRequest: { type: "object", properties: { room_name: { type: ["string", "null"] } } },
};

describe("typeLabel", () => {
  it("says what a field holds in plain words", () => {
    expect(typeLabel({ type: ["string", "null"], format: "uuid" }, schemas)).toBe("text (uuid) or null");
    expect(typeLabel({ type: "integer", format: "int32", minimum: 0 }, schemas)).toBe("whole number, at least 0");
    expect(typeLabel({ type: "array", items: { $ref: "#/components/schemas/RoomSlide" } }, schemas)).toBe("list of RoomSlide");
    expect(typeLabel({ $ref: "#/components/schemas/RoomStatus" }, schemas)).toBe("RoomStatus (text)");
    expect(typeLabel({ oneOf: [{ type: "null" }, { $ref: "#/components/schemas/RoomSlide" }] }, schemas)).toBe("null or RoomSlide");
  });
});

describe("sample", () => {
  it("builds a value the schema accepts", () => {
    expect(sample({ $ref: "#/components/schemas/RoomSlide" }, schemas)).toEqual({ label: "…", lines: ["…"] });
    expect(sample({ $ref: "#/components/schemas/RoomStatus" }, schemas)).toBe("live");
    expect(sample({ type: ["string", "null"], format: "date" }, schemas)).toBe("2026-01-01");
  });
});

describe("curlExample", () => {
  it("signs, sends JSON and keeps path parameters to fill in", () => {
    const example = curlExample("put", "/api/v1/device-tokens/{device_id}/room", {
      security: [{ bearer: [] }],
      requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/RoomNameRequest" } } } },
    }, schemas, "https://songs.example.org/api/v1");
    expect(example).toBe([
      `curl -X PUT "https://songs.example.org/api/v1/device-tokens/{device_id}/room" \\`,
      `  -H "Authorization: Bearer $PSA150_TOKEN" \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -d '{"room_name":"…"}'`,
    ].join("\n"));
  });

  it("leaves the token out where none is needed and streams events", () => {
    const example = curlExample("get", "/api/v1/public/rooms/{room_name}/events", {
      responses: { "200": { content: { "text/event-stream": { schema: {} } } } },
    }, schemas, "http://localhost/api/v1");
    expect(example).toBe(`curl "http://localhost/api/v1/public/rooms/{room_name}/events" \\\n  -N`);
  });
});

describe("groupOperations", () => {
  it("follows the document's sections and keeps strays last", () => {
    const groups = groupOperations({
      info: { title: "API", version: "1" },
      tags: [{ name: "Songs" }, { name: "Sets" }, { name: "Empty" }],
      paths: {
        "/api/v1/sets": { get: { tags: ["Sets"] } },
        "/api/v1/songs": { get: { tags: ["Songs"] }, post: { tags: ["Songs"] } },
        "/api/v1/odd": { get: {} },
      },
    });
    expect(groups.map((group) => [group.name, group.operations.map((operation) => operation.method)])).toEqual([
      ["Songs", ["get", "post"]],
      ["Sets", ["get"]],
      ["Other", ["get"]],
    ]);
  });
});

describe("inline", () => {
  it("escapes text and keeps code spans", () => {
    expect(inline("Send `Authorization: Bearer <token>` & go")).toBe("Send <code>Authorization: Bearer &lt;token&gt;</code> &amp; go");
  });
});
