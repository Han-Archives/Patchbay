/**
 * Client-safe 0단계 재스캔 응답. `POST /api/project/scan` 이 돌려준다.
 * 커널 값을 가져오지 않는다 — 브라우저 묶음에 `node:fs` 가 들어오지 않게.
 */

export interface ScanOk {
  alias: string;
  path: string;
  /** 이번 스캔이 찾은 항목 수 (`discoveredPorts`). */
  ports: number;
  /** 앞 스캔의 항목 수. 앞 스캔이 없었으면 `null` — 「0개였다」와 다르다. */
  portsBefore: number | null;
  /** 앞 스캔 결과 파일이 깨져 있었다 — 이번 스캔이 새로 썼다. */
  previousBroken: boolean;
  head: string;
}

export type ScanResponse = ScanOk | { error: string };

export function scanNote(body: ScanResponse): string {
  if ("error" in body) return body.error;
  if (body.previousBroken) return `깨진 스캔 결과를 새로 썼다 — 항목 ${body.ports}`;
  if (body.portsBefore === null) return `처음 스캔했다 — 항목 ${body.ports}`;
  if (body.portsBefore === body.ports) return `다시 스캔했다 — 항목 ${body.ports}, 수는 그대로`;
  const delta = body.ports - body.portsBefore;
  return `다시 스캔했다 — 항목 ${body.portsBefore} → ${body.ports} (${delta > 0 ? "+" : ""}${delta})`;
}
