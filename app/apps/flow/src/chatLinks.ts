/**
 * 대화방 · 상담 창 글에서 열 수 있는 것을 찾는다 (사용자 요청 2026-10-16: 시안 · 산출물을 링크로 보고 받기).
 * 웹 주소와, 에이전트가 답에 적는 산출물 경로(`시안/home.html`, 절대 경로 포함). 경로는 `/` 가 하나는
 * 있어야 하고 산출물 확장자로 끝나야 한다 — 코드 파일 이름이나 `a.b` 같은 말까지 링크가 되지 않게.
 */
export type ChatToken =
  | { kind: "text"; text: string }
  | { kind: "url"; text: string; href: string }
  | { kind: "file"; text: string; path: string; label?: string }
  | { kind: "image"; text: string; target: string; alt: string };

const EXT = "html?|png|jpe?g|gif|webp|svg|pdf|md|txt|json|csv|ya?ml|pptx|docx|xlsx|zip|mp4|webm|mov";
const SEG = "[\\p{L}\\p{N}_.@+~-]+";
const PATH = `(?:\\.{0,2}\\/)?(?:${SEG}\\/)+${SEG}\\.(?:${EXT})(?![A-Za-z0-9_])`;
const WEB = "https?:\\/\\/[^\\s<>\"'`]+";
const MARKDOWN = String.raw`!?\[[^\]\n]*\]\(\s*(?:<[^>\n]+>|[^\s)\n]+)(?:\s+["'][^"'\n]*["'])?\s*\)`;
const MARKDOWN_PARTS = /^(!?)\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)\n]+?))(?:\s+["'][^"'\n]*["'])?\s*\)$/u;
const TOKEN = new RegExp(`(\`{3}[\\s\\S]*?(?:\`{3}|$))|(${MARKDOWN})|\`([^\`\\n]+)\`|(${WEB})|(${PATH})`, "giu");
/** 백틱 안에서는 공백 든 경로(`시안/홈 화면.html`)도 경로로 본다. */
const QUOTED_PATH = new RegExp(`^(?:\\.{0,2}\\/)?(?:[^\\/\`\\n]+\\/)+[^\\/\`\\n]+\\.(?:${EXT})$`, "iu");
/** 문장 끝 구두점과 닫는 괄호는 주소에 넣지 않는다. */
const URL_TAIL = /[.,;:!?)\]}」』>'"]+$/u;

export function chatTokens(text: string): ChatToken[] {
  const tokens: ChatToken[] = [];
  const push = (token: ChatToken) => {
    const last = tokens.at(-1);
    if (token.kind === "text" && last?.kind === "text") last.text += token.text;
    else if (token.text) tokens.push(token);
  };
  let at = 0;
  for (const match of text.matchAll(TOKEN)) {
    const [whole, fenced, markdown, quoted, url, file] = match;
    push({ kind: "text", text: text.slice(at, match.index) });
    at = match.index + whole.length;
    if (fenced !== undefined) {
      push({ kind: "text", text: whole });
    } else if (markdown !== undefined) {
      const parts = MARKDOWN_PARTS.exec(markdown)!;
      const target = (parts[3] ?? parts[4] ?? "").trim();
      const label = parts[2] ?? "";
      if (parts[1] && imageHref("", target)) {
        push({ kind: "image", text: whole, target, alt: label });
      } else if (/^https?:\/\//i.test(target)) {
        push({ kind: "url", text: label || target, href: target });
      } else if (!parts[1] && (QUOTED_PATH.test(target) || isChatImage(target))) {
        push({ kind: "file", text: whole, path: target, ...(label ? { label } : {}) });
      } else {
        push({ kind: "text", text: whole });
      }
    } else if (quoted !== undefined && new RegExp(`^${WEB}$`, "u").test(quoted)) {
      push({ kind: "url", text: quoted, href: quoted });
    } else if (quoted !== undefined) {
      push(QUOTED_PATH.test(quoted.trim()) ? { kind: "file", text: whole, path: quoted.trim() } : { kind: "text", text: whole });
    } else if (url) {
      const href = url.replace(URL_TAIL, "");
      push({ kind: "url", text: href, href });
      push({ kind: "text", text: url.slice(href.length) });
    } else {
      push({ kind: "file", text: file, path: file });
    }
  }
  push({ kind: "text", text: text.slice(at) });
  return tokens;
}

/** 사진·문서 이미지 확장자. 쿼리가 붙은 주소도 같은 기준으로 확인한다. */
export function isChatImage(target: string): boolean {
  return /\.(?:png|jpe?g|gif|webp|svg)$/i.test(target.split(/[?#]/, 1)[0] ?? "");
}

/** 본문 이미지는 HTTP(S), 기존 첨부 API 또는 프로젝트 안 파일로 연다. */
export function imageHref(project: string, target: string): string | null {
  if (/^https?:\/\//i.test(target)) {
    try { return new URL(target).href; } catch { return null; }
  }
  if (!target || /[\u0000\r\n]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target) || target.startsWith("//")) return null;
  if (target.startsWith("/api/refs/raw?")) {
    const url = new URL(target, "http://patchbay.local");
    return (!project || url.searchParams.get("alias") === project) && !!url.searchParams.get("id") ? target : null;
  }
  if (target.startsWith("/api/project-file/")) {
    return !project || target.startsWith(`/api/project-file/${encodeURIComponent(project)}/`) ? target : null;
  }
  return projectFileHref(project, target);
}

export function refImageHref(project: string, id: string): string {
  return `/api/refs/raw?alias=${encodeURIComponent(project)}&id=${encodeURIComponent(id)}`;
}

/** 서버 `/api/project-file/:alias/*` 의 주소. 절대 경로는 한 칸으로 보내고 서버가 상대 주소로 옮긴다. */
export function projectFileHref(project: string, filePath: string, download = false): string {
  const rest = filePath.startsWith("/")
    ? encodeURIComponent(filePath)
    : filePath.replace(/^(\.\/)+/, "").split("/").map(encodeURIComponent).join("/");
  return `/api/project-file/${encodeURIComponent(project)}/${rest}${download ? "?download=1" : ""}`;
}
