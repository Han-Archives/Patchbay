import { describe, expect, it } from "vitest";
import { accessRole, sessionToken } from "./access.js";
import { createFlowApp } from "./server.js";

describe("PC·모바일 연결 권한", () => {
  it("로컬 기본값과 토큰·쿠키의 조회/실행 권한을 분리한다", () => {
    const access = { token: "write-secret", readToken: "read-secret" };
    expect(accessRole({})).toBe("write");
    expect(accessRole(access)).toBeNull();
    expect(accessRole(access, "wrong")).toBeNull();
    expect(accessRole(access, "read-secret")).toBe("read");
    expect(accessRole(access, undefined, sessionToken("write-secret"))).toBe("write");
  });
  it("로그인한 조회 연결은 원문을 읽어도 실행·파일 수정을 할 수 없다", async () => {
    const app = createFlowApp({ studioHome: "/tmp/patchbay-access-test", access: { token: "write-secret", readToken: "read-secret" } });
    expect((await app.request("/api/rooms?alias=demo")).status).toBe(401);
    const login = await app.request("/api/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "read-secret" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    expect(login.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await app.request("/api/rooms?alias=demo", { headers: { cookie } })).status).toBe(200);
    for (const route of ["/api/room/execution/start", "/api/source", "/api/consult/send", "/api/room/workflow/install"]) {
      expect((await app.request(route, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: "{}" })).status).toBe(403);
    }
    const crossSite = await app.request("/api/session", { method: "POST", headers: { "content-type": "application/json", origin: "https://other.test", host: "localhost" }, body: JSON.stringify({ token: "read-secret" }) });
    expect(crossSite.status).toBe(403);
    await app.close();
  });
});
