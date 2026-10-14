import { useEffect, useState } from "react";

export interface FilePeekProps {
  alias: string;
  path: string;
  onClose: () => void;
}

export function FilePeek({ alias, path, onClose }: FilePeekProps) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    setNotice(null);
    fetch(`/api/source?alias=${encodeURIComponent(alias)}&path=${encodeURIComponent(path)}`)
      .then(async (res) => {
        const body = (await res.json()) as { content?: string; error?: string };
        if (cancelled) return;
        if (!res.ok || typeof body.content !== "string") {
          setError(body.error ?? `HTTP ${res.status}`);
          setContent("");
          setLoaded("");
          return;
        }
        setContent(body.content);
        setLoaded(body.content);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [alias, path]);

  const dirty = content !== loaded;

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/source", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ alias, path, content }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      setLoaded(content);
      setNotice("저장했습니다. 레포 파일입니다.");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="file-peek"
      role="dialog"
      aria-modal="true"
      aria-labelledby="file-peek-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="file-peek-card">
        <header className="file-peek-head">
          <h3 id="file-peek-title">{path}</h3>
          <p>프로젝트 레포의 파일입니다. Cursor와 같은 파일입니다.</p>
        </header>
        {error ? <p className="flow-error">{error}</p> : null}
        {notice ? <p className="board-notice">{notice}</p> : null}
        {busy && !content && !error ? <p>불러오는 중</p> : null}
        <textarea
          className="file-peek-body"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          disabled={Boolean(error) && !loaded}
          aria-label={`${path} 내용`}
        />
        <footer className="file-peek-foot">
          <span className="file-peek-meta">{dirty ? "저장하지 않은 변경" : "저장된 내용"}</span>
          <button type="button" className="flow-btn" onClick={onClose}>
            닫기
          </button>
          <button type="button" className="flow-btn" data-action="save-source" disabled={busy || !dirty} onClick={() => void save()}>
            저장
          </button>
        </footer>
      </div>
    </div>
  );
}

export function isOpenableSourceLabel(label: string): boolean {
  return label === "File" || label === "Skill" || label === "Artifact";
}
