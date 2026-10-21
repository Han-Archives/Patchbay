import { Fragment } from "react";
import { chatTokens, projectFileHref } from "./chatLinks.js";

/**
 * 대화방 · 상담 창의 메시지 글. 웹 주소는 새 탭으로 열고, 산출물 경로는 「열기 · 받기」 둘을 단다.
 * `bold` 는 상담자 답처럼 `**강조**` 를 쓰는 글에만 켠다.
 */
export function ChatText({ text, project, bold = false }: { text: string; project: string; bold?: boolean }) {
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
