import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { describe, expect, it } from "vitest";
import { overlaySchema } from "./overlay.js";
import { IR_SCHEMA_VERSION, parseIr } from "./ir.js";

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), "../ir/__fixtures__/valid.ir.yaml");
const valid = (): Record<string, unknown> => parseYaml(fs.readFileSync(FIXTURE, "utf8")) as Record<string, unknown>;

describe("parseIr", () => {
  it("고정 자료를 읽는다", () => {
    const parsed = parseIr(valid());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.ir.schemaVersion).toBe(IR_SCHEMA_VERSION);
      expect(parsed.ir.nodes.map((node) => node.id)).toEqual(["intake", "classify", "explain", "pick"]);
      // 기본값이 채워진다 — 안 적은 것과 빈 것은 다르지 않다.
      expect(parsed.ir.models[0]?.timeoutMs).toBe(20_000);
      expect(parsed.ir.tools[0]?.irreversible).toBe(false);
    }
  });

  it("2판 파일은 3판 칸 없이 그대로 읽힌다 — 3판 칸은 모두 선택이다 (명세 20261006a §3.9)", () => {
    const old = valid();
    delete old.environment;
    delete old.interface;
    delete old.credentials;
    const parsed = parseIr({ ...old, schemaVersion: 2 });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.ir.environment).toBeUndefined();
      expect(parsed.ir.credentials).toEqual([]);
    }
  });

  it("3판 칸은 파싱을 지나도 남는다 — 스키마에 없으면 zod가 조용히 버린다", () => {
    const parsed = parseIr(valid());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.ir.environment?.language).toBe("typescript");
      expect(parsed.ir.interface?.entry).toEqual(["console"]);
      expect(parsed.ir.credentials[0]?.storedAt).toBe("env");
    }
  });

  it("골격의 빈 키(null)는 「아직」이라 3판 칸에서도 오류가 아니다", () => {
    const parsed = parseIr({ ...valid(), environment: null, interface: null, credentials: null });
    expect(parsed.ok).toBe(true);
  });

  it("새 형식은 필드 오류 마흔 개가 아니라 버전 한 줄로 거절한다", () => {
    const parsed = parseIr({ ...valid(), schemaVersion: IR_SCHEMA_VERSION + 1 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.error).toContain(`schemaVersion ${IR_SCHEMA_VERSION + 1}`);
      expect(parsed.error).toContain("새 형식");
    }
  });

  it("옛 형식은 자동으로 고치지 않고 마이그레이션을 요구한다", () => {
    const parsed = parseIr({ ...valid(), schemaVersion: 0 });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("마이그레이션");
  });

  it("schemaVersion이 없으면 형식을 모르는 파일로 본다", () => {
    const { schemaVersion, ...rest } = valid();
    void schemaVersion;
    const parsed = parseIr(rest);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("schemaVersion이 없다");
  });

  it("형식 오류는 경로와 함께 최대 열 줄까지 보여 준다", () => {
    const parsed = parseIr({ ...valid(), nodes: [{ label: "id가 없다" }] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain("nodes.0.id");
  });
});

describe("overlay.ir", () => {
  it("ir 절이 없는 overlay는 그대로 읽힌다 — 없음은 1단계 미착수다", () => {
    const overlay = overlaySchema.parse({});
    expect(overlay.ir).toBeUndefined();
  });

  it("ir 절이 있으면 같이 검증한다", () => {
    const overlay = overlaySchema.parse({ ir: valid() });
    expect(overlay.ir?.project).toBe("fixture-agent");
  });

  it("빈 ir 절은 오류다 — 없는 것과 다르다", () => {
    expect(() => overlaySchema.parse({ ir: {} })).toThrow();
  });
});
