import { describe, expect, it } from "vitest";
import { foreignWriteReason } from "./writeGuard.js";

const json = "application/json";

describe("foreignWriteReason", () => {
  it("읽기는 늘 통과한다", () => {
    expect(foreignWriteReason({ method: "GET", contentType: undefined, origin: "https://evil.example", host: "127.0.0.1:4317" })).toBeNull();
  });

  it("같은 화면의 JSON 쓰기는 통과한다 — tailnet 주소로 연 화면도", () => {
    expect(foreignWriteReason({ method: "POST", contentType: json, origin: "http://127.0.0.1:4317", host: "127.0.0.1:4317" })).toBeNull();
    expect(foreignWriteReason({ method: "PUT", contentType: "application/json; charset=utf-8", origin: "http://100.64.0.2:4317", host: "100.64.0.2:4317" })).toBeNull();
  });

  it("Origin 이 없는 호출(curl · CLI)은 JSON 이면 통과한다", () => {
    expect(foreignWriteReason({ method: "POST", contentType: json, origin: undefined, host: "127.0.0.1:4317" })).toBeNull();
  });

  it("다른 사이트가 사전 확인 없이 보낼 수 있는 형식은 막는다", () => {
    for (const contentType of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", undefined]) {
      expect(foreignWriteReason({ method: "POST", contentType, origin: undefined, host: "127.0.0.1:4317" })).not.toBeNull();
    }
  });

  it("다른 출처는 JSON 이어도 막는다 — 포트가 달라도", () => {
    expect(foreignWriteReason({ method: "POST", contentType: json, origin: "https://evil.example", host: "127.0.0.1:4317" })).not.toBeNull();
    expect(foreignWriteReason({ method: "POST", contentType: json, origin: "http://127.0.0.1:5173", host: "127.0.0.1:4317" })).not.toBeNull();
    expect(foreignWriteReason({ method: "POST", contentType: json, origin: "null", host: "127.0.0.1:4317" })).not.toBeNull();
  });
});
