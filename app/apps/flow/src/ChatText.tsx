import { Fragment } from "react";
import { chatTokens, projectFileHref } from "./chatLinks.js";

/**
 * 대화방 · 상담 창의 메시지 글. 웹 주소는 새 탭으로 열고, 산출물 경로는 「열기 · 받기」 둘을 단다.
 * `bold` 는 상담자 답처럼 `**강조**` 를 쓰는 글에만 켠다.
 * 마크다운 표(머리 줄 · `---` 구분 줄 · 본문 줄)는 표로 그린다 (사용자 요청 2026-10-26).
 */
export function ChatText({ text, project, bold = false }: { text: string; project: string; bold?: boolean }) {
  return (
    <>
      {chatBlocks(text).map((block, i) =>
        typeof block === "string" ? (
          <Inline key={i} text={block} project={project} bold={bold} />
        ) : (
          <div key={i} className="chat-table-wrap">
            <table className="chat-table">
              <thead>
                <tr>{block.head.map((cell, j) => <th key={j}><Inline text={cell} project={project} bold /></th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>{block.head.map((_, j) => <td key={j}><Inline text={row[j] ?? ""} project={project} bold /></td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        ),
      )}
    </>
  );
}

type ChatTable = { head: string[]; rows: string[][] };
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const tableCells = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, "|"));

/** 글을 일반 글과 표로 나눈다. 표 앞뒤 줄바꿈 하나는 표가 대신한다. */
export function chatBlocks(text: string): (string | ChatTable)[] {
  const lines = text.split("\n");
  const blocks: (string | ChatTable)[] = [];
  let plain: string[] = [];
  const flush = () => { if (plain.length) blocks.push(plain.join("\n")); plain = []; };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim().startsWith("|") && TABLE_RULE.test(lines[i + 1] ?? "") && lines[i + 1]!.includes("-")) {
      const head = tableCells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim().startsWith("|")) rows.push(tableCells(lines[i++]!));
      i--;
      if (plain.length && plain[plain.length - 1] === "") plain.pop();
      flush();
      blocks.push({ head, rows });
      if (lines[i + 1] === "") i++;
      continue;
    }
    plain.push(line);
  }
  flush();
  return blocks;
}

function Inline({ text, project, bold }: { text: string; project: string; bold: boolean }) {
  const parts = bold ? text.split(/(\*\*[^*\n]+\*\*)/g) : [text];
  return (
    <>
      {parts.map((part, i) =>
        bold && /^\*\*[^*\n]+\*\*$/.test(part) ? (
          <b key={i}>
            <Linked text={part.slice(2, -2)} project={project} />
          </b>
        ) : (
          <Linked key={i} text={part} project={project} />
        ),
      )}
    </>
  );
}

function Linked({ text, project }: { text: string; project: string }) {
  return (
    <>
      {chatTokens(text).map((token, i) => {
        if (token.kind === "url") {
          return (
            <a key={i} className="chat-link" href={token.href} target="_blank" rel="noreferrer">
              {token.text}
            </a>
          );
        }
        if (token.kind === "file") {
          return (
            <span key={i} className="chat-file">
              <a href={projectFileHref(project, token.path)} target="_blank" rel="noreferrer" title="새 탭에서 열기">
                {token.path}
              </a>
              <a className="chat-file-get" href={projectFileHref(project, token.path, true)} download aria-label={`${token.path} 받기`}>
                받기
              </a>
            </span>
          );
        }
        return <Fragment key={i}>{token.text}</Fragment>;
      })}
    </>
  );
}
