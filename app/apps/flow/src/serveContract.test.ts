import { describe, expect, it } from "vitest";
import { DEFAULT_FLOW_HOST, dialHost, isLoopbackHost, resolveFlowHost } from "./serveContract.js";

describe("console bind address", () => {
  it("defaults to the loopback when nothing is set", () => {
    expect(DEFAULT_FLOW_HOST).toBe("127.0.0.1");
    expect(resolveFlowHost()).toBe(DEFAULT_FLOW_HOST);
    expect(resolveFlowHost("")).toBe(DEFAULT_FLOW_HOST);
    expect(resolveFlowHost("   ")).toBe(DEFAULT_FLOW_HOST);
  });

  it("takes an explicit remote address", () => {
    expect(resolveFlowHost("0.0.0.0")).toBe("0.0.0.0");
    expect(resolveFlowHost(" 100.64.0.5 ")).toBe("100.64.0.5");
  });

  it("knows which addresses reach the console from this machine only", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(isLoopbackHost("100.64.0.5")).toBe(false);
  });

  it("turns a wildcard bind into an address a browser can dial", () => {
    expect(dialHost("0.0.0.0")).toBe("localhost");
    expect(dialHost("::")).toBe("localhost");
    expect(dialHost("::1")).toBe("[::1]");
    expect(dialHost("100.64.0.5")).toBe("100.64.0.5");
  });
});
