import { useEffect, useRef, useState } from "react";
import { ChatText } from "./ChatText.js";
import { outputDocumentText, outputUrl, type HomeProject } from "./homeContract.js";

/** Read-only preview. Existing project-file serving applies containment, secret filtering and sandbox headers. */
export function HomeOutputViewer({ project, initialPath, onClose }: { project: HomeProject; initialPath?: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState(initialPath ?? project.outputs[0]?.path ?? "");
  const output = project.outputs.find(o => o.path === selected);
  const [text, setText] = useState<string | null>(null), [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController(); setText(null); setError("");
    if (output?.kind === "문서") void fetch(`/api/source?${new URLSearchParams({ alias: project.alias, path: output.path })}`, { signal: controller.signal }).then(async res => {
      const body = await res.json() as { content?: string; error?: string };
      if (!res.ok || typeof body.content !== "string") throw new Error(body.error ?? "문서를 읽지 못했습니다.");
      if (!controller.signal.aborted) setText(outputDocumentText(body.content, output.path));
    }).catch(reason => { if (!controller.signal.aborted) setError(String(reason instanceof Error ? reason.message : reason)); });
    return () => controller.abort();
  }, [output?.path, output?.kind, project.alias]);
  return <dialog ref={dialog} className="wh-viewer" aria-labelledby="wh-viewer-title" onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === dialog.current) { const r = dialog.current.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) onClose(); } }}>
    <header><div><small>프로젝트 결과물 · {project.outputCount}개</small><h2 id="wh-viewer-title">{project.name ?? project.alias}</h2></div><button type="button" aria-label="결과물 닫기" onClick={onClose}>×</button></header>
    <div className="wh-viewer-body"><nav aria-label="결과물 목록">{project.outputs.map(o => <button type="button" key={o.path} aria-pressed={selected === o.path} onClick={() => setSelected(o.path)}><small>{o.kind}</small><b>{o.title}</b><span>{o.path}</span></button>)}</nav><section className="wh-viewer-preview" aria-label="결과물 미리보기">{output ? <><header><div><b>{output.title}</b><small>{output.path}</small></div><a href={outputUrl(output)} target="_blank" rel="noopener noreferrer">원본 열기 ↗</a></header>{error ? <p role="alert">{error}</p> : output.kind === "문서" ? text === null ? <p role="status">문서를 불러오는 중…</p> : <article className="wh-document"><ChatText text={text} project={project.alias} bold /></article> : output.kind === "이미지" ? <img src={outputUrl(output)} alt={output.title} onError={() => setError("이미지를 읽지 못했습니다. 원본 열기로 확인해 주세요.")} /> : <iframe key={output.path} title={output.title} src={outputUrl(output)} sandbox="allow-scripts" />}</> : <p>이 결과물이 더 이상 목록에 없습니다.</p>}</section></div>
  </dialog>;
}
