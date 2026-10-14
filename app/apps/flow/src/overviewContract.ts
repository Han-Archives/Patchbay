/**
 * 프로젝트 개요 문서 — 문서 폴더의 `개요.md`(등록부 `docs` 칸, 저장구조.md). 있으면 콘솔 메인의 「개요」가
 * PRD 대신 이 문서를 그린다 (사용자 요청 2026-10-14: 개요 내용은 GitHub README가 아니라 Patchbay 안에).
 *
 * 화면용으로 쪼개기만 한다 — 마크다운 라이브러리를 들이지 않으려고 `##` 절 · 문단 · 목록 · 표 · 코드 블록 ·
 * 인용 · `###` 소제목만 알아본다. 글 안의 굵게 · 코드는 InlineText가 맡는다.
 */
export const OVERVIEW_FILE = "개요.md";

export type OverviewBlock =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "list"; items: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "code"; text: string }
  | { type: "quote"; text: string };

export interface OverviewDoc {
  title: string;
  intro: OverviewBlock[];
  sections: { title: string; blocks: OverviewBlock[] }[];
}

const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

function blocksOf(lines: string[]): OverviewBlock[] {
  const out: OverviewBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim() || /^-{3,}$/.test(line.trim())) { i += 1; continue; }
    if (line.startsWith("```")) {
      const body: string[] = [];
      for (i += 1; i < lines.length && !lines[i]!.startsWith("```"); i += 1) body.push(lines[i]!);
      i += 1;
      out.push({ type: "code", text: body.join("\n") });
      continue;
    }
    if (line.startsWith("### ")) { out.push({ type: "h", text: line.slice(4).trim() }); i += 1; continue; }
    if (line.trim().startsWith("|")) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i]!.trim().startsWith("|"); i += 1) {
        if (!/^\|?\s*:?-{2,}/.test(lines[i]!.trim())) rows.push(cells(lines[i]!));
      }
      out.push({ type: "table", header: rows[0] ?? [], rows: rows.slice(1) });
      continue;
    }
    if (/^\s*[-*] /.test(line)) {
      const items: string[] = [];
      for (; i < lines.length && /^\s*[-*] /.test(lines[i]!); i += 1) items.push(lines[i]!.replace(/^\s*[-*] /, "").trim());
      out.push({ type: "list", items });
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i += 1) body.push(lines[i]!.replace(/^>\s?/, ""));
      out.push({ type: "quote", text: body.join(" ") });
      continue;
    }
    const body: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(```|### |\||\s*[-*] |>)/.test(lines[i]!); i += 1) body.push(lines[i]!.trim());
    out.push({ type: "p", text: body.join(" ") });
  }
  return out;
}

export function parseOverview(markdown: string): OverviewDoc {
  const text = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = text.split("\n");
  let title = "";
  const intro: string[] = [];
  const sections: { title: string; lines: string[] }[] = [];
  let inCode = false;
  for (const line of lines) {
    if (line.startsWith("```")) inCode = !inCode;
    if (!inCode && line.startsWith("# ") && !title) { title = line.slice(2).trim(); continue; }
    if (!inCode && line.startsWith("## ")) { sections.push({ title: line.slice(3).trim(), lines: [] }); continue; }
    (sections.at(-1)?.lines ?? intro).push(line);
  }
  return { title, intro: blocksOf(intro), sections: sections.map((section) => ({ title: section.title, blocks: blocksOf(section.lines) })) };
}
