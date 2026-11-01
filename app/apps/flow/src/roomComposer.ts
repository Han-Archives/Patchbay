import { isChatImage } from "./chatLinks.js";

export type StagedAttachment =
  | { id: string; kind: "image"; title: string; href: string; body: string }
  | { id: string; kind: "doc"; title: string; body: string }
  | { id: string; kind: "link"; title: string; url: string; body: string }
  | { id: string; kind: "file"; title: string; path: string; isImage: boolean; body: string }
  | { id: string; kind: "rule" | "skill"; title: string; scope?: "project" | "studio"; body: string };

export interface RuleSkillRow {
  kind: "규칙" | "스킬";
  name: string;
  description: string;
  apply?: "always" | "request";
  scope?: "project" | "studio";
}

export function clipAttach(text: string): string {
  const line = text.trim();
  return line.length > 4000 ? `${line.slice(0, 4000)}\n…` : line;
}

export function makeStagedDoc(name: string, text: string, id = `doc:${name}`): StagedAttachment {
  const trimmed = text.trim();
  return {
    id,
    kind: "doc",
    title: name,
    body: trimmed ? `첨부 · 문서 「${name}」\n${clipAttach(trimmed)}` : `첨부 · 문서 「${name}」\n글이 비어 있다.`,
  };
}

export function makeStagedImage(name: string, href: string, id = `img:${href}`): StagedAttachment {
  const safeTitle = name.replace(/[\[\]\r\n]/g, " ");
  return {
    id,
    kind: "image",
    title: name,
    href,
    body: `![${safeTitle}](${href})`,
  };
}

export function makeStagedLink(rawUrl: string): { ok: true; item: StagedAttachment } | { ok: false; error: string } {
  const url = rawUrl.trim();
  if (!/^https?:\/\/\S+$/i.test(url)) {
    return { ok: false, error: "링크는 http:// 또는 https:// 로 시작하는 주소여야 합니다." };
  }
  let host = url;
  try {
    const parsed = new URL(url);
    host = `${parsed.hostname}${parsed.pathname !== "/" ? parsed.pathname : ""}`;
  } catch {
    return { ok: false, error: "올바른 웹 주소를 입력해주세요." };
  }
  return {
    ok: true,
    item: {
      id: `link:${url}`,
      kind: "link",
      title: host.length > 42 ? `${host.slice(0, 42)}…` : host,
      url,
      body: `첨부 · 링크\n${url}`,
    },
  };
}

export function makeStagedProjectFile(filePath: string, content?: string): Extract<StagedAttachment, { kind: "file" }> {
  const image = isChatImage(filePath);
  const safe = filePath.replace(/[\[\]\r\n]/g, " ");
  return {
    id: `file:${filePath}`,
    kind: "file",
    title: filePath,
    path: filePath,
    isImage: image,
    body: image
      ? `첨부 · 프로젝트 이미지\n![${safe}](<${filePath}>)`
      : `첨부 · 프로젝트 「${filePath}」\n${clipAttach(content ?? "")}`,
  };
}

export function makeStagedRuleOrSkill(row: RuleSkillRow): StagedAttachment {
  const kind = row.kind === "규칙" ? "rule" : "skill";
  return {
    id: `${kind}:${row.name}`,
    kind,
    title: row.name,
    ...(row.scope ? { scope: row.scope } : {}),
    body: `${row.kind} 「${row.name}」대로`,
  };
}

/**
 * 입력창에 담아 둔 첨부 항목들과 사용자의 메시지 본문을 하나의 전송 문자열로 합친다.
 * - 규칙 · 스킬 지시는 문장 앞머리에 자연스럽게 이어 붙이고,
 * - 문서 · 사진 · 링크 · 프로젝트 파일 본문은 그 뒤에 블록으로 붙인다.
 */
export function buildComposedMessage(draft: string, staged: readonly StagedAttachment[]): string {
  const directives = staged.filter((item) => item.kind === "rule" || item.kind === "skill").map((item) => item.body);
  const blocks = staged.filter((item) => item.kind !== "rule" && item.kind !== "skill").map((item) => item.body);
  const trimmed = draft.trim();
  const head = [directives.join(" "), trimmed].filter(Boolean).join(" ").trim();
  return [...blocks, ...(head ? [head] : [])].join("\n\n").trim();
}

export function filterProjectFiles(files: readonly string[], query: string, limit = 80): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return files.slice(0, limit);
  const tokens = q.split(/\s+/).filter(Boolean);
  const matched = files.filter((file) => {
    const lower = file.toLowerCase();
    return tokens.every((t) => lower.includes(t));
  });
  matched.sort((a, b) => {
    const aBase = a.split("/").at(-1)?.toLowerCase() ?? "";
    const bBase = b.split("/").at(-1)?.toLowerCase() ?? "";
    const aStem = aBase.replace(/\.[^.]+$/, "");
    const bStem = bBase.replace(/\.[^.]+$/, "");
    const first = tokens[0]!;
    const aExact = aStem === first || aBase === first ? 0 : 1;
    const bExact = bStem === first || bBase === first ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    const aStarts = aBase.startsWith(first) ? 0 : 1;
    const bStarts = bBase.startsWith(first) ? 0 : 1;
    if (aStarts !== bStarts) return aStarts - bStarts;
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });
  return matched.slice(0, limit);
}

export function filterRulesAndSkills(
  rows: readonly RuleSkillRow[],
  query: string,
  filter: "all" | "규칙" | "스킬" = "all",
): RuleSkillRow[] {
  const q = query.trim().toLowerCase();
  return rows.filter((row) => {
    if (filter !== "all" && row.kind !== filter) return false;
    if (!q) return true;
    return row.name.toLowerCase().includes(q) || row.description.toLowerCase().includes(q);
  });
}
