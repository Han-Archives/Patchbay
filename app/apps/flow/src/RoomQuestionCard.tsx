import { useState } from "react";
import { answerText, isAnswered, type RoomQuestion, type RoomQuestionAnswer } from "./roomQuestions.js";

/**
 * 모델 답 끝의 「질문」 칸 — 선택지는 단추로 고르고, 직접 적을 말은 칸에 적는다 (사용자 요청 2026-11-01).
 * 방의 마지막 답에서만 보낼 수 있다. 지난 질문은 무엇을 물었는지만 보인다.
 */
export function RoomQuestionCard({ questions, onAnswer }: { questions: RoomQuestion[]; onAnswer?: (text: string) => void }) {
  const [answers, setAnswers] = useState<RoomQuestionAnswer[]>(() => questions.map(() => ({ choice: null, note: "" })));
  const active = !!onAnswer;
  const ready = answers.every(isAnswered);
  const set = (i: number, patch: Partial<RoomQuestionAnswer>) => setAnswers((cur) => cur.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className={`room-ask${active ? "" : " is-past"}`} role="group" aria-label="답할 질문">
      {questions.map((q, i) => (
        <div key={i} className="room-ask-item">
          <div className="room-ask-q">
            {questions.length > 1 ? <span className="room-ask-n">{i + 1}</span> : null}
            {q.question}
          </div>
          <span className="room-ask-how">{q.options.length ? (q.input !== null ? "하나를 고르거나 직접 적기" : "하나를 고르기") : "직접 적기"}</span>
          {q.options.length ? (
            <div className="room-ask-options">
              {q.options.map((o, k) => (
                <button
                  key={k}
                  type="button"
                  className={`room-ask-option${answers[i]!.choice === k ? " is-on" : ""}`}
                  aria-pressed={answers[i]!.choice === k}
                  disabled={!active}
                  onClick={() => set(i, { choice: answers[i]!.choice === k ? null : k })}
                >
                  <span className="room-ask-label">{k + 1}. {o.label}{o.recommended ? <i className="room-ask-rec">추천</i> : null}</span>
                  {o.detail ? <small>{o.detail}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          {q.input !== null && active ? (
            <input
              className="room-ask-input"
              aria-label={`${q.question} — 직접 적기`}
              placeholder={q.input}
              value={answers[i]!.note}
              onChange={(e) => set(i, { note: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && ready) onAnswer(answerText(questions, answers)); }}
            />
          ) : null}
        </div>
      ))}
      {active ? (
        <div className="room-ask-send">
          <button type="button" className="flow-btn" disabled={!ready} onClick={() => onAnswer(answerText(questions, answers))}>답 보내기</button>
          {!ready ? <small>{questions.length > 1 ? "모든 질문에 답하면 보낼 수 있습니다" : "고르거나 적으면 보낼 수 있습니다"}</small> : null}
        </div>
      ) : null}
    </div>
  );
}
