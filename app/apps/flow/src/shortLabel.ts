/** 이름은 7글자까지, 넘으면 앞 7글자 + 「...」 — 전체는 마우스를 올리면 (흐름도 항목명 · 대화 칸 제목이 같이 쓴다). */
export function shortLabel(text: string, max = 7): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max).join("").trimEnd()}...` : text;
}
