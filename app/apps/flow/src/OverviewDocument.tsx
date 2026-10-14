import { InlineText } from "./InlineText.js";
import type { OverviewBlock, OverviewDoc } from "./overviewContract.js";

function Block({ block }: { block: OverviewBlock }) {
  if (block.type === "h") return <h4>{block.text}</h4>;
  if (block.type === "p") return <p><InlineText text={block.text} /></p>;
  if (block.type === "quote") return <blockquote><InlineText text={block.text} /></blockquote>;
  if (block.type === "code") return <pre>{block.text}</pre>;
  if (block.type === "list") return <ul>{block.items.map((item, index) => <li key={index}><InlineText text={item} /></li>)}</ul>;
  return <div className="overview-table"><table><thead><tr>{block.header.map((cell, index) => <th key={index}><InlineText text={cell} /></th>)}</tr></thead><tbody>{block.rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}><InlineText text={cell} /></td>)}</tr>)}</tbody></table></div>;
}

/** 문서 폴더의 개요.md를 개요 화면 모양(목차 + 번호 절)으로 그린다. */
export function OverviewDocument({ doc, source }: { doc: OverviewDoc; source: string }) {
  return <div className="main-overview">
    <nav className="main-toc" aria-label="개요 목차">{doc.sections.map((section, index) => <button type="button" key={section.title} onClick={() => document.getElementById(`overview-section-${index + 1}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}><span>{index + 1}</span>{section.title}</button>)}</nav>
    <div className="main-document overview-doc">
      {doc.title || doc.intro.length ? <section>{doc.title ? <p className="main-summary">{doc.title}</p> : null}{doc.intro.map((block, index) => <Block key={index} block={block} />)}</section> : null}
      {doc.sections.map((section, index) => <section id={`overview-section-${index + 1}`} key={section.title}><h3><span>{index + 1}</span>{section.title}</h3>{section.blocks.map((block, b) => <Block key={b} block={block} />)}</section>)}
      <p className="main-note">원본 <code>{source}</code></p>
    </div>
  </div>;
}
