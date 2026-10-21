import { createHash } from "node:crypto";

/** 객체의 키 순서는 의미가 아니다. YAML과 스키마 파서가 순서를 바꿔도 같은 지문이다. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined).map(k => [k, canonical((value as Record<string, unknown>)[k])]));
  return value;
}
export function irValueDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value)) ?? "null").digest("hex");
}
