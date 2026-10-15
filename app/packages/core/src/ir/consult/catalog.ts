/**
 * 상담의 하위 칸 — 명세 20261006a §12.2.
 *
 * Phase 1~9 + 0.0을 **사람이 채울 수 있는 단위**로 나눈 59개다. 칸마다 「빠지면 생기는 일」(`why`)과
 * 누가 채우나(`fill`)를 든다. 이 목록 하나를 호스트 안내(§13.2) · 진행(§12.3) · 요약 패널 · PRD가 같이 읽는다
 * (원칙 8 — 하나의 정의). 화면이나 안내문에 칸을 다시 적지 않는다.
 *
 * - `ask`     사람만 안다 — 상담이 묻는다
 * - `infer`   답에서 해석한다 — 호스트가 채우고 PRD에서 확인받는다
 * - `default` 기본값을 넣고 PRD에서 확인한다 — 주제 진행을 막지 않는다
 */

export const CONSULT_TOPICS = [
  "목표와 요구사항",
  "사용 시나리오",
  "환경 설정",
  "제약과 규칙",
  "UI와 인터페이스",
  "보안성 검토",
  "미비사항",
] as const;
export type ConsultTopic = (typeof CONSULT_TOPICS)[number];

export const CONSULT_FILLS = ["ask", "infer", "default"] as const;
export type ConsultFill = (typeof CONSULT_FILLS)[number];

export interface ConsultItem {
  id: string;
  topic: ConsultTopic;
  /** 명세의 칸 번호 (0.0 · 1.0~1.8). 무효 전파와 PRD 절이 이 번호로 붙는다. */
  gate: string;
  label: string;
  /**
   * IR 자리 — 이 중 하나라도 차면 칸이 찬 것이다. 문법은 `selectPath` 를 본다.
   * 비어 있으면 IR 자리가 없는 칸이다(검사가 보는 것) — 늘 기본값으로 센다.
   */
  paths: string[];
  fill: ConsultFill;
  /** 빠지면 생기는 일. 이것이 이 칸이 있는 이유다. */
  why: string;
}

const item = (
  id: string,
  topic: ConsultTopic,
  gate: string,
  label: string,
  paths: string[],
  fill: ConsultFill,
  why: string,
): ConsultItem => ({ id, topic, gate, label, paths, fill, why });

const G = "목표와 요구사항";
const S = "사용 시나리오";
const E = "환경 설정";
const R = "제약과 규칙";
const U = "UI와 인터페이스";
const X = "보안성 검토";
const M = "미비사항";

export const CONSULT_ITEMS: readonly ConsultItem[] = [
  item("2-i", G, "1.1", "목적 한 문장", ["goal"], "ask", "목적이 없으면 뒤의 모든 칸이 무엇을 위한 것인지 정할 수 없다"),
  item("0-a", G, "0.0", "받는 것의 이름", ["concepts[kind=input]"], "ask", "모든 질문과 규칙이 이 낱말을 쓴다. 없으면 「입력」「메모」「글」이 섞인다"),
  item("1-a", G, "1.0", "지금은 어떻게 하나", ["why.alternative"], "ask", "출발점이 없으면 성공을 잴 수 없고 대안과 비교할 수 없다"),
  item("1-b", G, "1.0", "규칙으로 되는 부분", ["why.modelNeed"], "infer", "가려 두지 않으면 모델을 안 부르는 「AI」가 나온다"),
  item("1-c", G, "1.0", "검토한 대안", ["alternatives"], "infer", "왜 스크립트나 기존 도구로 안 되는지가 없으면 나중에 다시 따진다"),
  item("1-d", G, "1.0", "결론 한 문장", ["why.verdict"], "infer", "모델이 맡는 일이 한 문장이 아니면 범위가 서지 않는다"),
  item("2-e", G, "1.1", "성공 지표와 목표치", ["metrics"], "ask", "목표치가 없으면 나아졌는지 모른다"),
  item("2-f", G, "1.1", "하지 않는 것", ["nonGoals"], "ask", "적지 않으면 에이전트가 범위를 짐작으로 넓힌다"),
  item("2-h", G, "1.1", "가정", ["assumptions"], "infer", "가정이 드러나 있지 않으면 틀렸을 때 확인할 수 없다"),
  item("7-a", G, "0.0", "참고 자료", ["references"], "ask", "기존 문서 · 시안 · 예시 데이터가 설계의 근거가 된다"),

  item("2-a", S, "1.1", "누가 쓰나", ["stakeholders"], "ask", "쓰는 사람마다 필요한 결과 모양이 다르다"),
  item("2-b", S, "1.1", "언제 쓰나", ["jobStory"], "ask", "부르는 때가 정해져야 입력 모양과 속도 기준이 선다"),
  item("2-c", S, "1.1", "받고 나서 무엇을 하나", ["jobStory"], "ask", "결과가 다음 일에 쓰이지 않으면 만든 이유가 없다"),
  item("0-f", S, "0.0", "답해야 하는 질문", ["competencyQuestions"], "infer", "이 개념으로 답할 수 없는 질문이 있으면 개념이 모자란 것이다"),
  item("5-c", S, "1.4", "이전 것을 기억하나", ["memory"], "ask", "오래 기억하면 개인정보를 다시 보게 된다"),
  item("9-a", S, "1.8", "예시 세 개 (입력 → 받고 싶은 결과)", ["evals"], "ask", "사람이 준 예시가 가장 좋은 시험이다. 상상한 시험은 실제 실패를 못 잡는다"),
  item("0-b", S, "0.0", "내놓는 것", ["concepts[kind=output]"], "infer", "내놓는 것이 없으면 단계 뼈대를 그릴 수 없다"),
  item("0-c", S, "0.0", "갈래와 값", ["concepts[kind=enum].values"], "infer", "정해진 값이 없으면 맞다 · 틀리다로 시험할 수 없다"),
  item("0-d", S, "0.0", "몇 개씩 이어지나", ["relations"], "infer", "「하나만 / 여럿」이 그대로 규칙과 시험이 된다"),
  item("0-e", S, "0.0", "늘 지킬 규칙", ["rules"], "infer", "규칙이 문장으로 있어야 검사가 잡는다"),
  item("2-d", S, "1.1", "완료 조건", ["done"], "infer", "판정할 수 있는 문장이 아니면 「됐다」를 아무도 말 못 한다"),
  item("5-a", S, "1.4", "들고 다닐 값", ["state"], "infer", "값이 정해지지 않으면 단계를 만들다가 칸이 계속 늘어난다"),
  item("5-b", S, "1.4", "덧붙이나·덮어쓰나 · 처음 값", ["state[].reducer"], "default", "빠지면 두 번째 실행부터 값이 섞인다"),
  item("6-a", S, "1.5", "단계", ["nodes"], "infer", "내놓는 것마다 그것을 만드는 단계가 있어야 한다"),
  item("6-b", S, "1.5", "순서와 갈림길", ["edges"], "infer", "시작에서 끝까지 빠짐없이 닿아야 한다"),
  item("6-c", S, "1.5", "실패하면 가는 길", ["edges[when]"], "default", "모델 거절 · 시간 초과 · 빈 입력에 길이 없으면 막다른 단계가 생긴다"),
  item("3-b", S, "1.2", "틀리면 피해 크기", ["riskLevel"], "ask", "피해가 크면 사람 확인이 꼭 들어가야 한다"),
  item("9-b", S, "1.8", "헷갈리는 입력", ["evals"], "ask", "헷갈리는 입력이 시험에 없으면 테스트에서 처음 만난다"),
  item("3-f", S, "1.7", "사람에게 넘기는 때", ["requirements[pattern=unwanted]"], "ask", "넘길 조건이 없으면 에이전트가 모르는 것도 그냥 한다"),
  item("N1", S, "1.2", "외부 MCP · 도구", ["tools[via=mcp]", "tools"], "ask", "밖의 도구를 모르면 권한과 자격 증명을 정할 수 없다"),
  item("N2", S, "1.3", "DB에 쌓는 것", ["emits[to=db]", "emits"], "ask", "무엇을 어디에 쌓는지 모르면 쓰기 권한과 되돌리기를 정할 수 없다"),
  item("7-b", S, "1.6", "갈래마다 주는 문서", ["documents"], "infer", "손으로 맞춘 표는 문서가 늘면 뒤처진다"),

  item("N3", E, "1.2", "작업 폴더", ["environment.workdir"], "default", "등록 경로와 다른 곳에서 돌면 2 구현 뼈대가 엉뚱한 곳에 생긴다"),
  item("N4", E, "1.2", "도는 곳 · SSH", ["environment.location"], "ask", "원격이면 콘솔이 터널로만 닿는다. 모르면 2 · 5단계가 붙지 않는다"),
  item("N5", E, "1.2", "하드웨어", ["environment.hardware"], "ask", "GPU · 메모리 한계는 모델과 단계 설계를 바꾼다"),
  item("N6", E, "1.2", "언어 · 라이브러리", ["environment.language", "environment.libraries"], "infer", "2 구현 생성기는 TypeScript만 낸다. 다르면 설계와 뼈대가 어긋난다"),
  item("3-g", E, "1.2", "모델과 기다리는 시간", ["models"], "default", "모델이 없거나 무한정 기다리면 실행이 멈춘다"),

  item("2-g", R, "1.1", "제약", ["constraints"], "ask", "시간 · 비용 · 도구 제한을 나중에 알면 뜯는다"),
  item("8-a", R, "1.7", "약속 문장", ["requirements"], "infer", "약속이 문장으로 있어야 시험할 수 있다"),
  item("8-b", R, "1.7", "잘못되면 약속", ["requirements[pattern=unwanted]"], "infer", "빈 입력 · 거절을 안 적으면 에이전트가 알아서 이상하게 처리한다"),
  item("8-c", R, "1.7", "우선순위", ["requirements[].priority"], "default", "꼭 · 나중에가 없으면 2 구현에서 다 같은 무게가 된다"),
  item("8-d", R, "1.7", "속도 · 정확도 기준", ["requirements[kind=quality].fit"], "ask", "「빠르게」는 잴 수 없다. 숫자가 붙어야 약속이다"),

  item("N7", U, "1.7", "어디서 부르나", ["interface.entry"], "ask", "부르는 곳을 모르면 입력 모양과 사람 확인 자리를 정할 수 없다"),
  item("N8", U, "1.7", "결과를 보이는 모양", ["interface.output"], "ask", "결과 모양이 정해지지 않으면 완료 조건이 흔들린다"),
  item("N9", U, "1.7", "사람이 확인하는 화면", ["interface.review"], "infer", "확인할 자리가 없으면 사람 확인이 문서에만 있다"),
  item("8-e", U, "1.7", "고칠 수 있나 · 확신 표시", ["requirements"], "ask", "사람이 고친 것이 다음 판의 시험이 된다"),

  item("3-a", X, "1.2", "하는 행동", ["caps"], "ask", "읽기 · 초안 · 고치기 · 보내기 중 무엇인지가 권한 계단이다"),
  item("3-c", X, "1.2", "스스로 하는 정도", ["autonomy"], "infer", "제안만 할지 끝까지 할지가 피해 크기와 맞아야 한다"),
  item("3-d", X, "1.2", "사람 확인", ["caps[].humanApproval"], "infer", "되돌릴 수 없는 일에 확인이 없으면 검사가 막는다"),
  item("3-e", X, "1.2", "되돌리는 방법", ["caps[].undo"], "default", "되돌릴 길이 없으면 고치기 권한을 줄 수 없다"),
  item("4-a", X, "1.3", "읽는 폴더", ["reads"], "ask", "읽는 범위가 없으면 민감도를 매길 수 없다"),
  item("4-b", X, "1.3", "개인정보 · 비밀", ["reads[].level"], "ask", "섞이면 밖으로 내보내지 않는 약속과 시험이 생긴다"),
  item("4-c", X, "1.3", "남이 쓴 글", ["requirements"], "ask", "웹 · 메일 속 숨은 지시가 에이전트를 움직인다(프롬프트 인젝션)"),
  item("4-d", X, "1.3", "밖으로 나가는 것", ["emits"], "infer", "무엇이 어디로 나가는지 모르면 막을 수 없다"),
  item("4-e", X, "1.3", "민감도 등급", ["reads[].level"], "default", "등급이 없으면 비밀 파일이 섞여도 모른다"),
  item("N10", X, "1.3", "자격 증명 보관", ["credentials"], "ask", "키가 어디 있는지 모르면 밖으로 나가는 도구를 막을 수도 열 수도 없다"),

  item("9-c", M, "1.8", "추적 표", ["requirementLinks"], "infer", "빈칸이 곧 빠진 약속이다"),
  item("9-d", M, "1.8", "시험 예 개수", ["evals"], "default", "처음엔 적어도 되고, 테스트 실패가 쌓이며 는다"),
  item("7-c", M, "1.6", "문서 쓰는 비율", [], "default", "후보 중 절반도 안 쓰면 고르는 기준이 빠진 것이다 — 검사 1.6/doc-coverage가 본다"),
];

/**
 * IR 자리 하나를 고른다. 초안은 미완성이 정상이라 `unknown` 위에서 돈다.
 *
 * - `a.b`         객체 안으로
 * - `a[k=v]`      배열에서 `k` 가 `v` 인 것만
 * - `a[f]`        배열에서 `f` 가 있는 것만
 * - `a[]`         배열의 모든 원소 (뒤의 `.f` 는 원소마다)
 *
 * 돌려주는 값: `undefined` 는 「아직」, 그 밖은 찾은 값들의 배열.
 */
export function selectPath(root: unknown, selector: string): unknown[] | undefined {
  let current: unknown[] = [root];
  for (const segment of selector.split(".")) {
    const match = /^([A-Za-z0-9_]+)(?:\[([^\]]*)\])?$/.exec(segment);
    if (!match) return undefined;
    const [, key, filter] = match;
    const next: unknown[] = [];
    let sawKey = false;
    for (const node of current) {
      if (node === null || typeof node !== "object" || Array.isArray(node)) continue;
      const value = (node as Record<string, unknown>)[key!];
      if (value === undefined || value === null) continue;
      sawKey = true;
      if (filter === undefined) {
        next.push(value);
        continue;
      }
      if (!Array.isArray(value)) continue;
      for (const element of value) {
        if (filter === "") next.push(element);
        else if (filter.includes("=")) {
          const [field, expected] = filter.split("=");
          if (element && typeof element === "object" && String((element as Record<string, unknown>)[field!]) === expected) {
            next.push(element);
          }
        } else if (element && typeof element === "object") {
          const field = (element as Record<string, unknown>)[filter];
          if (field !== undefined && field !== null && field !== "") next.push(element);
        }
      }
    }
    if (!sawKey) return undefined;
    current = next;
  }
  return current;
}

/** 찾은 값이 「찼나」. `[]` 는 「없음이 답」이라 찬 것이다 — 빈 키와 다르다 (인터페이스 걷기 2026-10-01). */
function isFilled(values: unknown[] | undefined, selector: string): boolean {
  if (values === undefined) return false;
  const filtered = /\[[^\]]+\]/.test(selector);
  if (values.length === 0) return !filtered;
  return values.some((value) => {
    if (value === undefined || value === null) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return !filtered || value.length > 0;
    return true;
  });
}

export function consultItemFilled(draft: unknown, entry: ConsultItem): boolean {
  if (entry.paths.length === 0) return true;
  return entry.paths.some((selector) => isFilled(selectPath(draft, selector), selector));
}

export interface ConsultTopicProgress {
  name: ConsultTopic;
  /** 묻기 · 해석 칸 중 찬 수. 기본값 칸은 진행을 막지 않는다. */
  filled: number;
  total: number;
  missing: string[];
  done: boolean;
}

export interface ConsultProgress {
  topics: ConsultTopicProgress[];
  /** 순서대로 첫 번째로 안 찬 주제. 다 찼으면 `null` — PRD 검토로 간다. */
  next: ConsultTopic | null;
  /** 아직 안 찬 기본값 칸 — PRD에서 「기본값으로 둔다」를 확인받는다. */
  defaults: string[];
}

/** 명세 §12.3 — 결정적. 같은 초안이면 늘 같은 진행이다. */
export function consultProgress(draft: unknown): ConsultProgress {
  const topics = CONSULT_TOPICS.map((name): ConsultTopicProgress => {
    const counted = CONSULT_ITEMS.filter((entry) => entry.topic === name && entry.fill !== "default");
    const missing = counted.filter((entry) => !consultItemFilled(draft, entry)).map((entry) => entry.id);
    return { name, filled: counted.length - missing.length, total: counted.length, missing, done: missing.length === 0 };
  });
  const defaults = CONSULT_ITEMS.filter((entry) => entry.fill === "default" && !consultItemFilled(draft, entry)).map(
    (entry) => entry.id,
  );
  return { topics, next: topics.find((topic) => !topic.done)?.name ?? null, defaults };
}

export function consultItem(id: string): ConsultItem | undefined {
  return CONSULT_ITEMS.find((entry) => entry.id === id);
}
