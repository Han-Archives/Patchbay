import YAML from "yaml";
import { z } from "zod";
import { CYCLE_ITEM_TAGS } from "../studio/cycleItemStore.js";
import { atomicWrite, logPaths, readText } from "./paths.js";

/**
 * `log/config.yaml` — 사람이 고치는 설정. 없으면 기본값.
 * 태그 낱말(`tags`)은 흐름도와 같은 다섯 개로 시작하고 프로젝트가 더한다.
 * 경로 · 낱말 규칙은 이 낱말만 붙일 수 있다. History 메모의 태그는 사람이 적은 그대로 둔다.
 */
export const logConfigSchema = z.object({
  tz: z.string().default("Asia/Seoul"),
  tags: z.array(z.string().min(1).max(30)).min(1).default([...CYCLE_ITEM_TAGS]),
  paths: z.array(z.object({ glob: z.string().min(1), tag: z.string().min(1) })).default([
    { glob: "**/*.{tsx,jsx,css,scss,html,vue,svelte}", tag: "UI" },
    { glob: "**/{server,api,routes}*.*", tag: "서버" },
    { glob: "**/api/**", tag: "서버" },
    { glob: "**/*{Store,store,schema,Schema}.*", tag: "데이터" },
    { glob: "**/*.sql", tag: "데이터" },
    { glob: "**/{agent,agents,mcp,prompts}/**", tag: "Agent" },
    { glob: "**/*.{md,mdc}", tag: "문서" },
  ]),
  words: z.array(z.object({ word: z.string().min(1), tag: z.string().min(1) })).default([
    ...["화면", "버튼", "레일", "디자인", "레이아웃", "시안"].map((word) => ({ word, tag: "UI" })),
    ...["저장", "스키마", "데이터"].map((word) => ({ word, tag: "데이터" })),
    ...["서버", "API", "엔드포인트"].map((word) => ({ word, tag: "서버" })),
    ...["문서", "기획", "일지", "README"].map((word) => ({ word, tag: "문서" })),
    ...["에이전트", "Agent", "LLM", "MCP", "훅"].map((word) => ({ word, tag: "Agent" })),
  ]),
  summary: z.object({
    /** LM Studio 모델 id. 비우면 요약 버튼이 꺼진다 — 사용자가 고른다 (D3). */
    model: z.string().default(""),
    timeoutMs: z.number().int().min(10_000).max(900_000).default(240_000),
  }).default({ model: "", timeoutMs: 240_000 }),
}).superRefine((config, ctx) => {
  const known = new Set(config.tags);
  for (const rule of [...config.paths, ...config.words]) {
    if (!known.has(rule.tag)) ctx.addIssue({ code: "custom", message: `태그 "${rule.tag}" 는 tags 목록에 없다.` });
  }
  try { new Intl.DateTimeFormat("en-CA", { timeZone: config.tz }); }
  catch { ctx.addIssue({ code: "custom", message: `시간대 "${config.tz}" 를 모른다.` }); }
});
export type LogConfig = z.infer<typeof logConfigSchema>;

export function defaultLogConfig(): LogConfig {
  return logConfigSchema.parse({});
}

export async function readLogConfig(studioHome: string, alias: string): Promise<LogConfig> {
  const text = await readText(logPaths(studioHome, alias).config);
  if (text === null) return defaultLogConfig();
  return logConfigSchema.parse(YAML.parse(text) ?? {});
}

/** 요약 모델만 바꾼다 — 사람이 고친 다른 설정과 주석은 그대로 둔다. */
export async function setLogSummaryModel(studioHome: string, alias: string, model: string): Promise<LogConfig> {
  const file = logPaths(studioHome, alias).config;
  const text = (await readText(file))?.trim();
  const doc = YAML.parseDocument(text ? text : "{}");
  doc.setIn(["summary", "model"], model.trim());
  const config = logConfigSchema.parse(doc.toJS() ?? {});
  await atomicWrite(file, doc.toString());
  return config;
}

/** `**`, `*`, `?`, `{a,b}` 만 아는 작은 glob. 경로는 `/` 로 나눈 상대 경로. */
export function globRegExp(glob: string): RegExp {
  let out = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        const slash = glob[i + 2] === "/";
        out += slash ? "(?:.*/)?" : ".*";
        i += slash ? 2 : 1;
      } else out += "[^/]*";
    } else if (c === "?") out += "[^/]";
    else if (c === "{") {
      const end = glob.indexOf("}", i);
      if (end < 0) { out += "\\{"; continue; }
      out += `(?:${glob.slice(i + 1, end).split(",").map((s) => s.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")).join("|")})`;
      i = end;
    } else out += c.replace(/[.+^$()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

export type TagFrom = "연결" | "경로" | "낱말" | "입력";

export interface Tagger {
  pathTags(file: string): string[];
  wordTags(text: string): string[];
}

export function makeTagger(config: LogConfig): Tagger {
  const paths = config.paths.map((rule) => ({ re: globRegExp(rule.glob), tag: rule.tag }));
  const words = config.words.map((rule) => ({ word: rule.word.toLowerCase(), tag: rule.tag }));
  const order = (tags: Set<string>) => config.tags.filter((t) => tags.has(t));
  return {
    pathTags(file) {
      const hit = new Set<string>();
      for (const rule of paths) if (rule.re.test(file)) hit.add(rule.tag);
      return order(hit);
    },
    wordTags(text) {
      const lower = text.toLowerCase();
      const hit = new Set<string>();
      for (const rule of words) if (lower.includes(rule.word)) hit.add(rule.tag);
      return order(hit);
    },
  };
}
