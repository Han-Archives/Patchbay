/**
 * 콘솔의 쓰기 요청을 다른 웹페이지가 대신 보내지 못하게 한다.
 *
 * 콘솔에는 로그인이 없다. 브라우저는 다른 사이트의 페이지가 `text/plain` 으로
 * `localhost` 에 POST 하는 것을 사전 확인 없이 보내고, 응답만 숨긴다 — 응답은 못 읽어도
 * 채택 · 뼈대 생성 · 폴더 등록 같은 **쓰기는 일어난다.** 그래서 두 겹으로 막는다.
 *
 * 1. 쓰기는 `application/json` 만 받는다. 다른 출처에서 이 형식을 보내려면 브라우저가
 *    사전 확인(preflight)을 먼저 하고, 콘솔은 CORS 허용을 내주지 않으므로 거기서 멈춘다.
 * 2. `Origin` 이 붙어 왔으면 요청한 호스트와 같아야 한다. 같은 화면(또는 `--host` 로 연
 *    tailnet 주소의 같은 화면)은 통과하고, curl · CLI 처럼 `Origin` 이 없는 호출도 통과한다.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export interface WriteRequestFacts {
  method: string;
  contentType: string | undefined;
  origin: string | undefined;
  host: string | undefined;
}

/** 막을 이유. 통과면 `null`. */
export function foreignWriteReason(facts: WriteRequestFacts): string | null {
  if (SAFE_METHODS.has(facts.method.toUpperCase())) return null;

  const type = (facts.contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "application/json") {
    return "쓰기 요청은 content-type: application/json 이어야 한다.";
  }

  if (facts.origin !== undefined) {
    let originHost: string;
    try {
      originHost = new URL(facts.origin).host;
    } catch {
      return `요청 출처를 읽지 못했다: ${facts.origin}`;
    }
    if (!facts.host || originHost.toLowerCase() !== facts.host.toLowerCase()) {
      return `다른 출처의 쓰기 요청은 받지 않는다: ${facts.origin}`;
    }
  }
  return null;
}
