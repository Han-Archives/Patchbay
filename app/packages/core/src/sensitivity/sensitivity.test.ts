import { describe, expect, it } from "vitest";
import { classifyPath, isSecret, PUBLIC_LEVEL, SECRET_LEVEL, WORKING_LEVEL } from "./sensitivity.js";

const level = (path: string) => classifyPath(path).level;

describe("classifyPath: secrets", () => {
  it("grades env files as secret wherever they sit", () => {
    // The real leak this exists for: GET /api/source served .env verbatim.
    expect(level(".env")).toBe(SECRET_LEVEL);
    expect(level(".env.local")).toBe(SECRET_LEVEL);
    expect(level("apps/api/.env.production")).toBe(SECRET_LEVEL);
    expect(level("config/prod.env")).toBe(SECRET_LEVEL);
  });

  it("grades key material by extension", () => {
    for (const path of ["a.pem", "certs/server.key", "deploy/app.p12", "x.keystore", "sig.asc"]) {
      expect(level(path)).toBe(SECRET_LEVEL);
    }
  });

  it("grades known credential filenames", () => {
    for (const path of [".netrc", ".npmrc", "credentials.json", "gcp/service-account-prod.json", "id_rsa"]) {
      expect(level(path)).toBe(SECRET_LEVEL);
    }
  });

  it("grades anything under a secret directory, at any depth", () => {
    expect(level("secrets/notes.md")).toBe(SECRET_LEVEL);
    expect(level("infra/.secrets/deep/thing.txt")).toBe(SECRET_LEVEL);
    expect(level(".ssh/config")).toBe(SECRET_LEVEL);
  });

  it("says which rule matched, so a refusal is explainable", () => {
    expect(classifyPath(".env").reason).toContain("환경변수");
    expect(classifyPath("secrets/a.md").reason).toContain("secrets");
    expect(classifyPath("a.pem").reason).toContain(".pem");
  });

  it("does not over-match names that merely look similar", () => {
    expect(level("docs/environment.md")).toBe(WORKING_LEVEL);
    expect(level("src/keyboard.ts")).toBe(WORKING_LEVEL);
    expect(level("notes/secretary.md")).toBe(WORKING_LEVEL);
    expect(level("lib/monkey.ts")).toBe(WORKING_LEVEL);
  });
});

describe("classifyPath: everything else", () => {
  it("grades the signal files a project publishes as public", () => {
    for (const path of ["README.md", "AGENTS.md", "CLAUDE.md", ".cursor/rules/style.mdc"]) {
      expect(level(path)).toBe(PUBLIC_LEVEL);
    }
  });

  it("defaults to the working level rather than guessing at a middle grade", () => {
    expect(level("docs/기획/방향.md")).toBe(WORKING_LEVEL);
    expect(level("src/agent/graph.ts")).toBe(WORKING_LEVEL);
    expect(classifyPath("src/agent/graph.ts").reason).toContain("작업");
  });

  it("reads the path only -- classifying a secret never needs its contents", () => {
    // Signature takes a string; there is no filesystem access to mock away.
    expect(() => classifyPath("does/not/exist/.env")).not.toThrow();
    expect(level("does/not/exist/.env")).toBe(SECRET_LEVEL);
  });
});

describe("isSecret", () => {
  it("gates on the secret level only", () => {
    expect(isSecret(SECRET_LEVEL)).toBe(true);
    expect(isSecret(WORKING_LEVEL)).toBe(false);
    expect(isSecret(PUBLIC_LEVEL)).toBe(false);
  });
});
