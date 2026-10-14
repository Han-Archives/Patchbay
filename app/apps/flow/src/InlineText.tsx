import { Fragment } from "react";

/**
 * Beat text comes straight out of markdown, so `**강조**` and `` `경로` ``
 * arrive as literal asterisks and backticks. Rendering them raw is what makes
 * a pane look like a dumped file instead of a screen.
 *
 * Deliberately only bold and code -- these documents are label/value and
 * step notes, not prose with links and headings, and a general markdown
 * renderer would be a dependency for two syntaxes.
 */
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`)/g;

export function InlineText({ text }: { text: string }) {
  return (
    <>
      {text.split(TOKEN).map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
