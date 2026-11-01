/**
 * 대화방 모델이 사람에게 묻는 「질문」 칸 (사용자 요청 2026-11-01 — 대화만 봐서는 무엇을 적어야 할지 모르겠다).
 * 쓰는 쪽 규약은 core `rooms/store.ts` 의 `QUESTION_INSTRUCTIONS` 다. 형식을 바꾸면 둘을 같이 고친다.
 *
 * ```질문
 * 무엇을 정해야 하는지 한 줄
 * 1. 선택지 — 고르면 무엇이 되는지
 * 기타: 직접 적을 때 무엇을 적을지      (선택지 + 직접 입력)
 * 입력: 무엇을 어떤 꼴로 적을지         (선택지 없이 직접 입력만)
 * ```
 */
export interface RoomQuestionOption {
  label: string;
  detail: string;
  recommended: boolean;
}

export interface RoomQuestion {
  question: string;
  options: RoomQuestionOption[];
  /** 직접 적는 칸의 안내. null 이면 직접 적는 칸이 없다 (선택지만). */
  input: string | null;
}

const FENCE_OPEN = /^\s*```\s*질문\s*$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const OPTION = /^\s*(?:\d+[.)]|[-*])\s+(.+)$/;
const INPUT = /^\s*(기타|입력)\s*[:：]\s*(.*)$/;

/** 글에서 「질문」 칸을 떼어 낸다. 닫히지 않은 칸은 글로 둔다. */
export function splitQuestions(text: string): { text: string; questions: RoomQuestion[] } {
  const lines = text.split("\n");
  const kept: string[] = [];
  const questions: RoomQuestion[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE_OPEN.test(lines[i]!)) { kept.push(lines[i]!); continue; }
    const end = lines.findIndex((line, j) => j > i && FENCE_CLOSE.test(line));
    if (end < 0) { kept.push(...lines.slice(i)); break; }
    const parsed = parseQuestion(lines.slice(i + 1, end));
    if (parsed) questions.push(parsed);
    else kept.push(...lines.slice(i, end + 1));
    i = end;
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), questions };
}

function parseQuestion(body: string[]): RoomQuestion | null {
  let question = "";
  const options: RoomQuestionOption[] = [];
  let input: string | null = null;
  for (const raw of body) {
    const line = raw.trim();
    if (!line) continue;
    const field = INPUT.exec(line);
    if (field) { input = field[2]!.trim() || (field[1] === "기타" ? "직접 적기" : "답을 적어 주세요"); continue; }
    const option = OPTION.exec(line);
    if (option && question) { options.push(readOption(option[1]!)); continue; }
    question = question ? `${question} ${line}` : line;
  }
  if (!question) return null;
  // 선택지도 입력 줄도 없으면 직접 적게 한다 — 사람이 답할 칸은 언제나 있어야 한다.
  if (!options.length && input === null) input = "답을 적어 주세요";
  return { question, options, input };
}

function readOption(text: string): RoomQuestionOption {
  const recommended = /\(추천\)/.test(text);
  const clean = text.replace(/\s*\(추천\)\s*/g, " ").trim();
  const cut = clean.search(/\s[—–-]\s/);
  return cut < 0
    ? { label: clean, detail: "", recommended }
    : { label: clean.slice(0, cut).trim(), detail: clean.slice(cut).replace(/^\s*[—–-]\s*/, "").trim(), recommended };
}

/** 사람이 고른 답 — 질문마다 고른 선택지(번호)와 직접 적은 말. */
export interface RoomQuestionAnswer {
  choice: number | null;
  note: string;
}

export function isAnswered(answer: RoomQuestionAnswer | undefined): boolean {
  return !!answer && (answer.choice !== null || answer.note.trim() !== "");
}

/** 대화방에 보낼 답 글. 모델이 어느 질문에 무엇을 골랐는지 바로 읽게 질문을 같이 적는다. */
export function answerText(questions: readonly RoomQuestion[], answers: readonly (RoomQuestionAnswer | undefined)[]): string {
  return questions
    .flatMap((q, i) => {
      const a = answers[i];
      if (!isAnswered(a)) return [];
      const picked = a!.choice !== null && q.options[a!.choice] ? `${a!.choice + 1}. ${q.options[a!.choice]!.label}` : "";
      const note = a!.note.trim();
      const reply = picked && note ? `${picked} · ${note}` : picked || note;
      return [`질문: ${q.question}\n답: ${reply}`];
    })
    .join("\n\n");
}
