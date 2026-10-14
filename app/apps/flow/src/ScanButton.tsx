import { useState } from "react";
import { scanNote, type ScanResponse } from "./scanContract.js";

/**
 * 「스캔」 — `patchbay scan --project <alias>` 를 화면에서. 쓰기는 서버가 Core
 * `writeScanOutputs` 로 한다. 끝나면 `onScanned` 로 부른 쪽이 구조를 다시 읽는다.
 *
 * 결과 줄은 부른 쪽이 들고 있을 수 있다(`note` · `onNote`). 첫 스캔은 빈 안내 칸의 버튼에서
 * 눌리고 결과는 구조 머리의 버튼 옆에 떠야 해서 — 버튼이 바뀌어도 줄이 남게.
 */
export function ScanButton({
  project,
  first,
  onScanned,
  note: heldNote,
  onNote,
}: {
  project: string;
  /** 앞 스캔이 없다 — 글자를 「스캔」으로. */
  first: boolean;
  onScanned: () => void;
  note?: string | null;
  onNote?: (note: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [ownNote, setOwnNote] = useState<string | null>(null);
  const note = onNote ? (heldNote ?? null) : ownNote;
  const setNote = onNote ?? setOwnNote;

  async function run() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/project/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias: project }),
      });
      const body = (await res.json()) as ScanResponse;
      setNote(scanNote(body));
      if (res.ok) onScanned();
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="scan-act">
      <button type="button" className={first ? "flow-btn primary" : "flow-btn"} onClick={() => void run()} disabled={busy}>
        {busy ? "스캔하는 중" : first ? "스캔" : "다시 스캔"}
      </button>
      {note ? <small className="ir-note">{note}</small> : null}
    </span>
  );
}
