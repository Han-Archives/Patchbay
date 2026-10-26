import fs from "node:fs/promises";
import { registerSemanticRoutes } from "./semanticHost.js";
import { registerRagRoutes } from "./ragHost.js";
import { registerRequirementRoutes } from "./requirementView.js";
import { HISTORY_DOMAINS, historyDomainTags } from "./historyContract.js";
import { createTodoPreparationHost, PreparationError } from "./todoPreparation.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import {
  appendThreadMessage,
  listPendingRequests,
  listThreads,
  addFileRef,
  addLinkRef,
  archiveRef,
  listRefs,
  refFilePath,
  readStudio,
  listWorkspaceDir,
  loadWorkspaceFile,
  saveWorkspaceFile,
  readTodos,
  readProgress,
  readDashboardHistory,
  appendDashboardHistory,
  dashboardHistoryInputSchema,
  todoItemSchema,
  TrashError,
  writeTodos,
  updateTodos,
  readTodoHistory,
  todoHistoryDir,
  readThread,
  setProjectHidden,
  renameProject,
  ProjectRenameError,
  threadStatus,
  consultStatus,
  currentConsultMeta,
  listArchivedConsults,
  listConsults,
  loadPrd,
  markPrdSection,
  readConsult,
  formatFixRequest,
  checkFixRequest,
  checkProblems,
  parseIr,
  readProposedIr,
  runIrChecks,
  writeOverlayApp,
  readKnowledgeReplica,
  runEvidence,
  roomMemberSchema,
  roomModeSchema,
  LLM_QUOTA_PRESETS,
  LLM_QUOTA_PROVIDERS,
  PRESET_CAPS,
  loadLlmQuotaSnapshot,
  providerCapSchema,
  updateLlmQuotaConfig,
  type LlmQuotaPreset,
} from "@patchbay/core";
import {
  SSE_KEEPALIVE_COMMENT,
  SSE_KEEPALIVE_MS,
  THREAD_EVENT_NAME,
  type StudioEvent,
} from "./eventsContract.js";
import { expireOverdue, resumeReady, resumeThread, sendThreadMessage } from "./threadView.js";
import { answerSurvey, loadSurveyView } from "./surveyView.js";
import { loadGraph } from "./graph.js";
import { createLangGraphHttpPort, type LangGraphHttpOptions } from "./langgraphAdapter.js";
import { resolveLangGraphUrl } from "./langgraphContract.js";
import { delegateFlowRun, loadFlowView } from "./flowView.js";
import { loadImpactView } from "./impactView.js";
import { adoptIrView, loadIrView, saveCellView, startDraftView } from "./irView.js";
import { existingBuildAction, generateScaffoldView, loadBuildView } from "./buildView.js";
import { loadWorkspace } from "./workspaceView.js";
import { addProjectView, rescanProjectView } from "./projectAddView.js";
import { addDecisionView } from "./decisionView.js";
import { loadPortSummaries } from "./portSummary.js";
import {
  createIngestTracker,
  ingestKnowledgeAlias,
  loadDocumentCallView,
  loadKnowledgeView,
} from "./knowledgeView.js";
import { collectLangGraphRuns } from "./langgraphRuns.js";
import { loadDashboard, runProjectTests } from "./dashboardView.js";
import { registerLogRoutes } from "./logHost.js";
import { applyTodoAction, TodoActionError } from "./todoActions.js";
import { listTrash, restoreTrash } from "./trashActions.js";
import { alertOverdueTasks, loadTaskTiming, TASK_CHECK_MS } from "./taskTiming.js";
import { loadStructureModel } from "./structureFile.js";
import { applyCycleItemAction, CycleItemActionError, listCycleItems } from "./cycleItemActions.js";
import { readTestActivity } from "./testActivity.js";
import { loadRunsView, writeDraftEvalsView } from "./runsView.js";
import { foreignWriteReason } from "./writeGuard.js";
import { createNeo4jDriverPort, type Neo4jAppOptions } from "./neo4jAdapter.js";
import { resolveNeo4jUri } from "./neo4jContract.js";
import { loadProcessStep, talkProcessStep } from "./processTalk.js";
import { defaultHostSpawner, launchPlanHost, type HostSpawner } from "./processHost.js";
import { loadProjectView } from "./projectView.js";
import { addProcessStep, saveProjectProcess } from "./processView.js";
import { loadArchitectureMap, placeArchitectureMap } from "./boardArchitecture.js";
import { readOverviewDoc } from "./overviewView.js";
import {
  linkBoardItems,
  loadBoardView,
  moveBoardItem,
  placeBoardItem,
  removeBoardItem,
  unlinkBoardItems,
} from "./boardView.js";
import { acceptSkillDraftView, distillSkillDraft, patchSkillView } from "./skillView.js";
import { loadProjectFile, loadSourceFile, projectRelFromAbsolute, saveSourceFile } from "./sourceFileView.js";
import { loadShell } from "./shell.js";
import { startStudioWatch, type StudioWatch } from "./studioWatch.js";
import {
  closeConsultConversation,
  consultAgentInput,
  consultRunInfo,
  detectConsultHosts,
  isConsultRunning,
  runningConsultAliases,
  sendConsultTurn,
  type HostRunner,
} from "./consultHost.js";
import {
  attachRoomMemory,
  roomHostAvailability,
  listRoomProjectFiles,
  removeRoom,
  listRoomSkills,
  readRoomSkill,
  roomListView,
  roomReadView,
  isRoomRunning,
  runningRoomAliases,
  saveRoomCast,
  loadAgents,
  saveAgents,
  loadModes,
  saveModes,
  saveRoomMode,
  saveRoomKept,
  saveRoomTitle,
  sendRoomTurn,
  stopRoomTurn,
  type RoomRunner,
} from "./roomHost.js";
import { createRoomExecutionHost, type CommandRunner } from "./roomExecution.js";
import { accessRole, sessionToken, FLOW_SESSION_COOKIE, type FlowAccess } from "./access.js";
import { notifyRoom, roomNotificationChannels, type RoomNotificationOptions } from "./roomNotifications.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** `vite build`'s output (`vite.config.ts`'s `build.outDir`), sibling to this compiled file's own `dist-server/`. */
const CLIENT_DIST = path.resolve(__dirname, "..", "dist-client");

/** 한도가 지난 대화 요청을 찾는 주기. */
const THREAD_OVERDUE_CHECK_MS = 15_000;

/** JSON 본문을 객체로 읽는다. 없거나 깨졌으면 null. */
/** 한글 파일 이름도 그대로 받게 — `filename` 은 옛 브라우저용 ASCII, `filename*` 이 실제 이름. */
function downloadDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * 프로젝트 파일은 에이전트가 만든 것이라 믿지 않는다. `sandbox`(allow-same-origin 없음)로 열면 시안 HTML 의
 * 스크립트는 돌지만 콘솔 출처가 아니라서, 콘솔 API 를 쿠키 달고 부르거나 콘솔 화면을 건드리지 못한다.
 */
function fileHeaders(contentType: string, rel: string, download: boolean): Record<string, string> {
  return {
    "content-type": contentType,
    "content-security-policy": "sandbox allow-scripts allow-popups allow-forms allow-modals",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
    ...(download ? { "content-disposition": downloadDisposition(path.posix.basename(rel)) } : {}),
  };
}

async function jsonRecord(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const payload: unknown = await c.req.json();
    return payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface FlowAppOptions {
  studioHome: string;
  /** serve.ts만 실제 CLI 조회를 연결한다. 테스트·임시 앱은 명시적으로 주입하지 않으면 호출하지 않는다. */
  claudeQuotaRefresh?: () => Promise<void>;
  /** Registered alias to prefer in the console. Omitted -> first registered project. */
  project?: string;
  /**
   * Watch studio files and push `/api/events`. Default false so unit tests
   * do not leak chokidar watchers. `serve.ts` sets true.
   */
  watch?: boolean;
  /**
   * LangGraph sidecar (P5). Omitted → never probe (tests stay disconnected).
   * `serve.ts` passes `{ url }` from PATCHBAY_LANGGRAPH_URL.
   */
  langgraph?: LangGraphHttpOptions;
  /**
   * Neo4j sidecar (P6). Omitted → never probe. `serve.ts` passes URI/user/password.
   * Tests inject `{ port }` (memory replica) so Bolt is not required.
   */
  neo4j?: Neo4jAppOptions;
  /** Tests inject a no-op so Cursor/Claude are not actually opened. */
  hostSpawner?: HostSpawner;
  /** 상담 호스트 실행기 · 실행 파일 (명세 20261006a §13). 시험은 가짜를 넣는다 — CI는 실제 호스트를 부르지 않는다. */
  consultRunner?: HostRunner;
  consultBin?: string | null;
  /** 오른쪽 대화방. 시험은 가짜 실행기를 넣는다 — CI는 실제 모델을 부르지 않는다. */
  roomRunner?: RoomRunner;
  roomBin?: string | null;
  roomCommandRunner?: CommandRunner;
  access?: FlowAccess;
  roomNotifications?: RoomNotificationOptions;
  /** 화면의 「서버 다시 켜기」. serve.ts만 연결한다 — 없으면 이 실행 방식에서는 다시 켤 수 없다. */
  serverRestart?: ServerRestart;
}

export interface ServerRestart {
  /** 앱 전체 빌드. 실패하면 서버를 끄지 않는다. */
  build(): Promise<{ ok: boolean; output: string }>;
  /** 같은 설정으로 새 서버를 띄우고 이 서버를 끈다. */
  restart(): void;
}

export interface FlowApp extends Hono {
  close(): Promise<void>;
  readonly watchReady: Promise<void>;
}

/**
 * Hono app for the Patchbay console (`patchbay flow`).
 * `/api/shell` is the P1 contract. `/api/graph` remains the scan-graph JSON
 * (not the LangGraph tab). `/api/flow` is LangGraph. `/api/knowledge` is Neo4j.
 * `/api/board` is board.yaml placement (not execution). `/api/skill` is Skill Bay drafts.
 * `/api/build` is the 2단계 scaffold (`ir generate` from the screen).
 * `POST /api/runs/draft-evals` writes failure-drafted evals into `ir.proposed.yaml` (5.4).
 * `/api/project/decision` appends a decision (`patchbay decision add` from the screen).
 * `/api/project/scan` rescans a registered project (`patchbay scan` from the screen).
 * `/api/source` is a registered project's text file (peek/edit). `/api/project/archive` reads `보관` day cards.
 * `/api/events` is the P3 SSE stream.
 */
export function createFlowApp(options: FlowAppOptions): FlowApp {
  const app = new Hono();
  let projectRenaming = false;
  let activeWrites = 0;

  const role = (c: Context) => accessRole(options.access ?? {}, c.req.header("authorization")?.replace(/^Bearer /, ""), getCookie(c, FLOW_SESSION_COOKIE));
  app.use("/api/*", async (c, next) => {
    if (c.req.path === "/api/session") return next();
    const access = role(c);
    if (!access) return c.json({ error: "연결 토큰으로 로그인한다." }, 401);
    if (access === "read" && !["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return c.json({ error: "이 연결은 조회만 허용한다." }, 403);
    return next();
  });

  // 쓰기 요청을 다른 웹페이지가 대신 보내지 못하게 — 모든 라우트보다 먼저 (writeGuard.ts).
  app.use("/api/*", async (c, next) => {
    const reason = foreignWriteReason({
      method: c.req.method,
      contentType: c.req.header("content-type"),
      origin: c.req.header("origin"),
      host: c.req.header("host"),
    });
    if (reason) return c.json({ error: reason }, 403);
    return next();
  });
  app.get("/api/session", c => c.json({ role: role(c), required: !!(options.access?.token || options.access?.readToken) }));
  app.post("/api/session", async c => {
    const rec = await jsonRecord(c); const token = typeof rec?.token === "string" ? rec.token : "";
    const access = accessRole(options.access ?? {}, token);
    if (!access || !token) return c.json({ error: "연결 토큰이 올바르지 않다." }, 401);
    setCookie(c, FLOW_SESSION_COOKIE, sessionToken(token), { httpOnly: true, sameSite: "Strict", path: "/", maxAge: 86400, secure: new URL(c.req.url).protocol === "https:" });
    return c.json({ role: access });
  });
  app.delete("/api/session", c => { deleteCookie(c, FLOW_SESSION_COOKIE, { path: "/" }); return c.json({ ok: true }); });
  const listeners = new Set<(event: StudioEvent) => void>();
  // 폴더를 옮기는 동안 새 작업이 이전 경로에서 시작되지 않게 한다.
  app.use("/api/*", async (c, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) || c.req.path === "/api/session") return next();
    if (projectRenaming) return c.json({ error: "프로젝트 이름을 변경하고 있습니다. 잠시 후 다시 시도해 주세요." }, 409);
    activeWrites++;
    try { return await next(); } finally { activeWrites--; }
  });
  const emit = (event: StudioEvent) => {
    for (const listener of listeners) listener(event);
  };

  const langgraphUrl = resolveLangGraphUrl(options.langgraph?.url);
  const langgraphPort = options.langgraph ? createLangGraphHttpPort(options.langgraph) : undefined;
  const roomExecution = createRoomExecutionHost(options.studioHome, {
    port: langgraphPort, runner: options.roomRunner, bin: options.roomBin, command: options.roomCommandRunner,
    ...(options.roomNotifications ? { notify: (alias: string, roomId: string, execution: Parameters<typeof notifyRoom>[3]) => notifyRoom(options.roomNotifications!, alias, roomId, execution) } : {}),
  });
  const todoPreparation = createTodoPreparationHost(options.studioHome, {
    runner: options.roomRunner, bin: options.roomBin,
    isBusy: (alias, roomId) => roomId ? isRoomRunning(alias, roomId) || roomExecution.isBusy(alias, roomId) : runningRoomAliases().includes(alias) || roomExecution.busyAliases().includes(alias),
  });
  const neo4jUri = resolveNeo4jUri(options.neo4j?.uri);
  const neo4jPort = options.neo4j ? createNeo4jDriverPort(options.neo4j) : undefined;
  const semanticHost = registerSemanticRoutes(app, options.studioHome, { neo4j: neo4jPort, runner: options.roomRunner, bin: options.roomBin });
  const ragHost = registerRagRoutes(app, options.studioHome, { runner: options.roomRunner, bin: options.roomBin, reflect: semanticHost.reflect });
  const ingestTracker = createIngestTracker();

  let studioWatch: StudioWatch | undefined;
  let overdueTimer: ReturnType<typeof setInterval> | undefined;
  let taskTimer: ReturnType<typeof setInterval> | undefined;
  if (options.watch) {
    studioWatch = startStudioWatch(options.studioHome, (event) => {
      emit(event);
      if (neo4jPort && (event.event === "inferred" || event.event === "overlay")) {
        void ingestKnowledgeAlias(options.studioHome, event.alias, neo4jPort, ingestTracker);
      }
      // 호스트가 MCP로 답을 붙이면 대화 파일이 바뀐다 — 같은 thread_id로 그래프를 재개한다.
      if (event.event === THREAD_EVENT_NAME && event.threadId) {
        void resumeThread(options.studioHome, langgraphPort, event.alias, event.threadId).catch(() => undefined);
      }
    });
    // 한도가 지난 요청은 콘솔이 떠 있는 동안만 닫는다 (원칙 15 — 부팅 데몬 없음).
    // 콘솔이 꺼진 사이 호스트가 붙인 답은 켜질 때 한 번 재개한다.
    const sweep = (alsoResume: boolean) =>
      void readStudio(options.studioHome)
        .then(async (studio) => {
          for (const project of studio.projects) {
            if (alsoResume) await resumeReady(options.studioHome, langgraphPort, project.alias);
            await expireOverdue(options.studioHome, langgraphPort, project.alias);
          }
        })
        .catch(() => undefined);
    sweep(true);
    overdueTimer = setInterval(() => sweep(false), THREAD_OVERDUE_CHECK_MS);
    overdueTimer.unref?.();
    // 맡긴 일이 1시간을 넘기면 폰 알림 채널로 한 번 알린다 (R7.7). 채널이 없으면 돌지 않는다.
    const channels = roomNotificationChannels(options.roomNotifications ?? {});
    if (channels.discord || channels.telegram) {
      const sent = new Set<string>();
      taskTimer = setInterval(() => void alertOverdueTasks(options.studioHome, options.roomNotifications!, sent).catch(() => undefined), TASK_CHECK_MS);
      taskTimer.unref?.();
    }
  }

  app.get("/api/shell", async (c) => {
    const body = await loadShell(options.studioHome, options.project, {
      langgraph: langgraphPort,
      neo4j: neo4jPort,
    });
    return c.json(body);
  });

  app.get("/api/workspace", async (c) => c.json(await loadWorkspace(options.studioHome)));

  // 레일 불빛 — 대화방 · 상담 · 테스트 실행 어디서든 LLM이 일하는 중인 프로젝트.
  app.get("/api/running", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ aliases: [...new Set([...runningRoomAliases(), ...runningConsultAliases(), ...roomExecution.busyAliases(), ...semanticHost.busyAliases(), ...ragHost.busyAliases()])] });
  });

  // 서버 다시 켜기 (사용자 결정 2026-10-26, A안 — 서버가 교대). LLM이 일하는 중이면 거절하고, 빌드가 실패하면 끄지 않는다.
  const startedAt = new Date().toISOString();
  let restarting = false;
  const busyAliases = async () => {
    const projects = (await readStudio(options.studioHome)).projects.map(p => p.alias);
    return [...new Set([...runningRoomAliases(), ...runningConsultAliases(), ...roomExecution.busyAliases(), ...semanticHost.busyAliases(), ...ragHost.busyAliases(), ...projects.filter(alias => todoPreparation.isBusy(alias))])];
  };
  app.get("/api/server", (c) => {
    c.header("Cache-Control", "no-store");
    return c.json({ pid: process.pid, startedAt, canRestart: !!options.serverRestart });
  });
  app.post("/api/server/restart", async (c) => {
    if (!options.serverRestart) return c.json({ error: "이 실행 방식에서는 화면에서 다시 켤 수 없습니다. 터미널에서 다시 켜 주세요." }, 501);
    if (restarting) return c.json({ error: "이미 다시 켜는 중입니다." }, 409);
    const rec = await jsonRecord(c);
    const busyError = (aliases: string[]) => c.json({ error: `LLM이 일하는 중입니다(${aliases.join(", ")}). 끝난 뒤 다시 켜 주세요.`, aliases }, 409);
    const busy = await busyAliases();
    if (busy.length) return busyError(busy);
    restarting = true;
    try {
      if (rec?.build === true) {
        const built = await options.serverRestart.build();
        if (!built.ok) { restarting = false; return c.json({ error: "빌드가 실패해서 서버를 끄지 않았습니다.", output: built.output.slice(-2000) }, 500); }
        const after = await busyAliases();
        if (after.length) { restarting = false; return busyError(after); }
      }
    } catch (error) {
      restarting = false;
      throw error;
    }
    setTimeout(() => options.serverRestart!.restart(), 100);
    return c.json({ ok: true, pid: process.pid }, 202);
  });

  app.post("/api/project/name", async (c) => {
    const rec = await jsonRecord(c);
    if (typeof rec?.alias !== "string" || typeof rec?.name !== "string") return c.json({ error: "프로젝트와 새 이름을 입력해 주세요." }, 400);
    if (activeWrites > 1) return c.json({ error: "다른 변경 작업이 끝난 뒤 이름을 변경해 주세요." }, 409);
    projectRenaming = true;
    try {
      const result = await renameProject(options.studioHome, rec.alias, rec.name, {
        protectedPaths: [__dirname],
        isBusy: alias => runningRoomAliases().includes(alias) || runningConsultAliases().includes(alias) || roomExecution.busyAliases().includes(alias) || todoPreparation.isBusy(alias) || semanticHost.busyAliases().includes(alias) || ragHost.busyAliases().includes(alias),
      });
      for (const alias of result.affectedAliases) emit({ event: "board", alias });
      return c.json({ ok: true, alias: result.project.alias, name: result.project.name!, path: result.project.path });
    } catch (error) {
      if (error instanceof ProjectRenameError) return c.json({ error: error.message }, error.status);
      return c.json({ error: "프로젝트 이름을 변경하지 못했습니다." }, 500);
    } finally { projectRenaming = false; }
  });

  /** 레일에서 숨기기 · 다시 보이기. 등록과 파일은 그대로 둔다. */
  app.post("/api/project/hidden", async (c) => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    if (!alias || typeof rec?.hidden !== "boolean") return c.json({ error: "alias and hidden(boolean) are required." }, 400);
    try {
      await setProjectHidden(options.studioHome, alias, rec.hidden);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 404);
    }
    return c.json({ ok: true, alias, hidden: rec.hidden });
  });

  app.post("/api/project", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await addProjectView(options.studioHome, {
      path: typeof rec.path === "string" ? rec.path : undefined,
      alias: typeof rec.alias === "string" ? rec.alias : undefined,
      forceAdd: rec.forceAdd === true,
    });
    if (!result.ok) {
      return c.json(
        { error: result.error, ...(result.score !== undefined ? { score: result.score, threshold: result.threshold } : {}) },
        result.status,
      );
    }
    return c.json(result.body);
  });

  app.post("/api/project/scan", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await rescanProjectView(options.studioHome, typeof rec.alias === "string" ? rec.alias : undefined);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.body);
  });

  app.get("/api/project", async (c) => {
    const result = await loadProjectView(options.studioHome, c.req.query("alias"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /** 결정 한 줄을 직접 기록에 남긴다 — `patchbay decision add` 와 같은 Core 길. */
  app.post("/api/project/decision", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const text = (key: string) => (typeof rec[key] === "string" ? (rec[key] as string) : undefined);
    const result = await addDecisionView(options.studioHome, {
      alias: text("alias"),
      summary: text("summary"),
      rationale: text("rationale"),
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.body);
  });

  app.put("/api/project/process", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await saveProjectProcess(options.studioHome, rec);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result);
  });

  app.post("/api/project/process/steps", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await addProcessStep(options.studioHome, rec);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result);
  });

  app.get("/api/project/process/step", async (c) => {
    const result = await loadProcessStep(options.studioHome, c.req.query("alias"), c.req.query("id"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result);
  });

  app.post("/api/project/process/talk", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await talkProcessStep(options.studioHome, langgraphPort, rec);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result);
  });

  app.post("/api/project/process/host", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await launchPlanHost(options.studioHome, rec, options.hostSpawner ?? defaultHostSpawner);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result);
  });

  app.get("/api/graph", async (c) => {
    try {
      const { alias, graph } = await loadGraph(options.studioHome, options.project);
      return c.json({ alias, graph });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/api/flow", async (c) => {
    const body = await loadFlowView(
      langgraphPort,
      {
        assistantId: c.req.query("assistant") || undefined,
        threadId: c.req.query("thread") || undefined,
      },
      langgraphUrl,
    );
    return c.json(body);
  });

  app.post("/api/flow/runs", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await delegateFlowRun(
      langgraphPort,
      {
        assistantId: rec.assistantId,
        threadId: rec.threadId,
        checkpointId: rec.checkpointId,
        input: rec.input,
        node: rec.node,
      },
      langgraphUrl,
    );
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  app.get("/api/knowledge", async (c) => {
    const result = await loadKnowledgeView(
      options.studioHome,
      c.req.query("alias"),
      c.req.query("q") ?? "",
      c.req.query("path") || undefined,
      neo4jPort,
      neo4jUri,
      ingestTracker,
    );
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  app.get("/api/project/ports", async (c) => {
    const result = await loadPortSummaries(options.studioHome, c.req.query("alias"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  registerRequirementRoutes(app, options.studioHome);

  app.get("/api/ir", async (c) => {
    const result = await loadIrView(options.studioHome, c.req.query("alias"), c.req.query("source"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /**
   * 1단계 시작 버튼. 빈 골격 `ir.proposed.yaml` 을 만든다.
   *
   * 초안에 쓰는 것이라 `overlay.ir` 의 단일 쓰기 경로(명세 §2.3)를 건드리지 않는다.
   * 있는 초안은 덮지 않는다 — 그 판단은 Core에 있다.
   */
  app.post("/api/ir/draft", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await startDraftView(options.studioHome, rec);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /**
   * 칸 하나를 초안에 쓴다. 판정하지 않는다 — 1단계 중에는 불완전한 것이 정상이고,
   * 여기서 막으면 사람이 초안을 쓰다 말고 거절당한다. 판정은 1.9가 한다.
   */
  app.post("/api/ir/cell", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await saveCellView(options.studioHome, rec);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /**
   * The 채택 button. A write, and the only one that touches `overlay.ir` --
   * it delegates straight to Core's `adoptIr`, so the console cannot skip the
   * DRC gate or the version archive that the CLI path goes through.
   */
  app.post("/api/ir/adopt", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await adoptIrView(options.studioHome, rec);
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /** 「이미 구현됨」 길 — 고르기 · 잇기 · 확인 · 버리기 · 이은 테스트 실행 (사용자 결정 2026-10-20). */
  app.post("/api/build/existing", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await existingBuildAction(options.studioHome, rec);
    return c.json(result.body, result.status);
  });

  /**
   * 2단계 화면이 읽는 한 장: 승인본 버전 · 세 뼈대 파일 · IR 노드와 코드 노드 (2.6).
   * 승인본이 없으면 `locked` 을 돌려준다 — 오류가 아니라 1단계를 아직 지나지 않은 것이다.
   */
  app.get("/api/build", async (c) => {
    const result = await loadBuildView(options.studioHome, c.req.query("alias"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /**
   * 「뼈대 생성」 버튼 — `patchbay ir generate` 와 같은 일. Core `writeScaffold` 를 그대로
   * 부르므로 1.9 검사와 「있는 파일을 덮지 않는다」가 화면에서 다시 구현되지 않는다.
   */
  app.post("/api/build/generate", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ ok: false, error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await generateScaffoldView(options.studioHome, rec);
    if (!result.ok) {
      return c.json(
        {
          ok: false,
          error: result.error,
          ...(result.failedGates?.length ? { failedGates: result.failedGates } : {}),
          ...(result.nodes ? { nodes: result.nodes } : {}),
        },
        result.status,
      );
    }
    return c.json(result.body);
  });

  /**
   * 4단계 문서 호출. Core computes it from the project's files, so this answers
   * with Neo4j down -- the replica is an index (원칙 7), not the original.
   */
  /** 4 지식 그래프 — 실행에서 이은 근거 경로 (기획 20261008a). 파일에서 계산한다 — Neo4j가 꺼져도 답한다. */
  app.get("/api/knowledge/runs", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    try {
      const replica = await readKnowledgeReplica(options.studioHome, alias);
      return c.json({ runs: runEvidence(replica.snapshot), runEdges: replica.audit.runEdges });
    } catch (error) {
      return c.json({ runs: [], runEdges: 0, note: (error as Error).message });
    }
  });

  app.get("/api/knowledge/documents", async (c) => {
    const result = await loadDocumentCallView(
      options.studioHome,
      c.req.query("alias"),
      c.req.query("anchor") ?? "",
      c.req.query("q") ?? "",
      Number.parseInt(c.req.query("hops") ?? "", 10) || undefined,
    );
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /**
   * 5단계 테스트 — 상태별 수집 · 설계와 어긋난 것 · 한도를 넘긴 실행 · 버전 비교.
   * Core가 파일에서 계산하므로 LangGraph가 꺼져 있어도 답한다.
   */
  app.get("/api/runs", async (c) => {
    const result = await loadRunsView(options.studioHome, c.req.query("alias"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  /**
   * 첫 공급자에서 실행 기록을 받아 `test-runs/<runId>.json` 에 적는다 (명세 §5.5).
   * A write, and it goes through Core's `writeRunRecord` -- the console has no
   * ingest path of its own (원칙 8).
   */
  /**
   * 5.4 — 실패 기록을 평가 초안으로. `runs draft-evals --write` 와 같은 Core 길이고
   * `ir.proposed.yaml` 에만 쓴다. 채택은 1 설계에서.
   */
  app.post("/api/runs/draft-evals", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await writeDraftEvalsView(options.studioHome, typeof rec.alias === "string" ? rec.alias : undefined);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.body);
  });

  app.post("/api/runs/collect", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await collectLangGraphRuns(
      options.studioHome,
      typeof rec.alias === "string" ? rec.alias : undefined,
      typeof rec.thread === "string" ? rec.thread : undefined,
      langgraphPort,
    );
    if (!result.ok) {
      return c.json({ ok: false, error: result.error }, result.status);
    }
    return c.json({ ok: true, ...result.body });
  });

  app.get("/api/knowledge/impact", async (c) => {
    const result = await loadImpactView(
      options.studioHome,
      c.req.query("alias"),
      c.req.query("port") || undefined,
      Number.parseInt(c.req.query("hops") ?? "", 10) || undefined,
    );
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  app.get("/api/board", async (c) => {
    const result = await loadBoardView(options.studioHome, c.req.query("alias"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  app.post("/api/board/place", async (c) => {
    return boardMutation(c, (payload) => placeBoardItem(options.studioHome, payload));
  });

  // 화면이 아키텍처 원본을 읽는 길 — 문서 폴더는 프로젝트마다 다르므로(등록부 `docs`) 서버가 경로를 정한다.
  app.get("/api/board/architecture", async (c) => {
    const result = await loadArchitectureMap(options.studioHome, c.req.query("alias"));
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ map: result.raw });
  });

  // 아키텍처 드릴다운의 구조 · 흐름 장 (R3.4). 실행 장은 /api/ir · /api/flow 를 그대로 쓴다.
  app.get("/api/structure", async (c) => {
    const result = await loadStructureModel(options.studioHome, c.req.query("alias") ?? "");
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.body);
  });

  app.post("/api/board/architecture", async (c) => {
    return boardMutation(c, (payload) => placeArchitectureMap(options.studioHome, payload));
  });

  app.post("/api/board/move", async (c) => {
    return boardMutation(c, (payload) => moveBoardItem(options.studioHome, payload));
  });

  app.post("/api/board/link", async (c) => {
    return boardMutation(c, (payload) => linkBoardItems(options.studioHome, payload));
  });

  app.post("/api/board/unlink", async (c) => {
    return boardMutation(c, (payload) => unlinkBoardItems(options.studioHome, payload));
  });

  app.post("/api/board/remove", async (c) => {
    return boardMutation(c, (payload) => removeBoardItem(options.studioHome, payload));
  });

  app.post("/api/skill/drafts", async (c) => {
    return boardMutation(c, (payload) => distillSkillDraft(options.studioHome, payload));
  });

  app.post("/api/skill/accept", async (c) => {
    return boardMutation(c, (payload) => acceptSkillDraftView(options.studioHome, payload));
  });

  /** 확정된 스킬을 프로젝트에 설치하고 실제 연결을 기록한다 — `patchbay patch` 와 같은 Core 길. */
  app.post("/api/skill/patch", async (c) => {
    return boardMutation(c, (payload) => patchSkillView(options.studioHome, payload));
  });

  app.get("/api/source", async (c) => {
    const result = await loadSourceFile(options.studioHome, c.req.query("alias"), c.req.query("path"));
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  // 대화방 · 상담 창의 링크 — 파일을 그대로 연다(`?download=1` 이면 받는다). 경로를 URL 길에 두어
  // 시안 HTML 의 옆 파일 참조(`style.css`, `img/a.png`)가 같은 길로 풀린다.
  app.get("/api/project-file/:alias/*", async (c) => {
    const alias = c.req.param("alias");
    const prefix = `/api/project-file/${encodeURIComponent(alias)}/`;
    const raw = c.req.path.startsWith(prefix) ? c.req.path.slice(prefix.length) : "";
    let rel: string;
    try {
      rel = raw.split("/").map(decodeURIComponent).join("/");
    } catch {
      return c.json({ error: "경로를 읽지 못했다." }, 400);
    }
    const query = new URL(c.req.url).search;
    if (rel.startsWith("/")) {
      const inside = await projectRelFromAbsolute(options.studioHome, alias, rel);
      if (!inside) return c.json({ error: "프로젝트 밖의 파일이다." }, 403);
      return c.redirect(`${prefix}${inside.split("/").map(encodeURIComponent).join("/")}${query}`);
    }
    const result = await loadProjectFile(options.studioHome, alias, rel);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return new Response(new Uint8Array(result.data), { headers: fileHeaders(result.contentType, result.rel, c.req.query("download") === "1") });
  });

  app.put("/api/source", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return c.json({ error: "JSON body is required." }, 400);
    }
    const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const result = await saveSourceFile(options.studioHome, rec);
    if (!result.ok) {
      return c.json({ error: result.error }, result.status);
    }
    return c.json(result.body);
  });

  // 「폴더 · 문서」 편집기 — 그 프로젝트의 기록 폴더(`projects/<alias>/`)만. 쓰기는 커널 `saveWorkspaceFile`.
  app.get("/api/workspace-files", async (c) => {
    const result = await listWorkspaceDir(options.studioHome, c.req.query("alias"), c.req.query("dir"));
    return result.ok ? c.json(result.body) : c.json({ error: result.error }, result.status);
  });
  app.get("/api/workspace-file", async (c) => {
    const result = await loadWorkspaceFile(options.studioHome, c.req.query("alias"), c.req.query("path"));
    return result.ok ? c.json(result.body) : c.json({ error: result.error }, result.status);
  });
  app.put("/api/workspace-file", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const result = await saveWorkspaceFile(options.studioHome, rec);
    return result.ok ? c.json(result.body) : c.json({ error: result.error, ...(result.hash ? { hash: result.hash } : {}) }, result.status);
  });

  // 1 설계 설문 — 묻고 고르는 설계 (사용자 결정 2026-10-05). 답 → 초안은 커널이 만든다.
  app.get("/api/survey", async (c) => {
    const result = await loadSurveyView(options.studioHome, c.req.query("alias"));
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result.body);
  });

  app.post("/api/survey/answer", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const result = await answerSurvey(options.studioHome, rec);
    if (!result.ok) return c.json({ error: result.error, ...(result.conflict ? { conflict: true } : {}) }, result.status);
    return c.json(result.body);
  });

  // 참고 자료 — 설계가 기대는 링크 · 파일 · 이미지 (사용자 요청 2026-10-05). 파일은 JSON 안의 base64 로 받는다 —
  // 쓰기는 같은 출처의 JSON만 받는다는 규칙(writeGuard)을 지키기 위해서다.
  const knownAlias = async (alias: unknown): Promise<string | null> => {
    if (typeof alias !== "string" || !alias) return null;
    const studio = await readStudio(options.studioHome);
    return studio.projects.some((p) => p.alias === alias) ? alias : null;
  };
  app.get("/api/refs", async (c) => {
    const alias = await knownAlias(c.req.query("alias"));
    if (!alias) return c.json({ error: "등록된 프로젝트의 alias 가 필요하다." }, 400);
    return c.json({ refs: await listRefs(options.studioHome, alias) });
  });
  app.get("/api/refs/raw", async (c) => {
    const alias = await knownAlias(c.req.query("alias"));
    const id = c.req.query("id") ?? "";
    const file = alias ? await refFilePath(options.studioHome, alias, id) : null;
    if (!file) return c.json({ error: "그런 자료가 없다." }, 404);
    const ext = path.extname(file).toLowerCase();
    const type: Record<string, string> = {
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
      ".svg": "image/svg+xml", ".pdf": "application/pdf", ".md": "text/plain; charset=utf-8", ".txt": "text/plain; charset=utf-8",
    };
    try {
      const data = await fs.readFile(file);
      return new Response(data, {
        headers: {
          "content-type": type[ext] ?? "application/octet-stream",
          // SVG 안의 스크립트가 콘솔 출처로 돌지 않게.
          "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
          "x-content-type-options": "nosniff",
          ...(c.req.query("download") === "1" ? { "content-disposition": downloadDisposition(path.basename(file)) } : {}),
        },
      });
    } catch {
      return c.json({ error: "파일을 읽지 못했다." }, 404);
    }
  });
  app.post("/api/refs/link", async (c) => {
    const rec = await jsonRecord(c);
    const alias = await knownAlias(rec?.alias);
    if (!alias || typeof rec?.url !== "string") return c.json({ error: "alias and url are required." }, 400);
    const result = await addLinkRef(options.studioHome, alias, {
      url: rec.url,
      ...(typeof rec.title === "string" ? { title: rec.title } : {}),
      ...(typeof rec.note === "string" ? { note: rec.note } : {}),
    });
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });
  app.post("/api/refs/file", async (c) => {
    const rec = await jsonRecord(c);
    const alias = await knownAlias(rec?.alias);
    if (!alias || typeof rec?.name !== "string" || typeof rec?.dataBase64 !== "string") {
      return c.json({ error: "alias, name, dataBase64 are required." }, 400);
    }
    const result = await addFileRef(options.studioHome, alias, {
      name: rec.name,
      data: Buffer.from(rec.dataBase64, "base64"),
      ...(typeof rec.title === "string" ? { title: rec.title } : {}),
    });
    return result.ok ? c.json(result) : c.json({ error: result.error }, 400);
  });
  app.post("/api/refs/archive", async (c) => {
    const rec = await jsonRecord(c);
    const alias = await knownAlias(rec?.alias);
    if (!alias || typeof rec?.id !== "string") return c.json({ error: "alias and id are required." }, 400);
    return (await archiveRef(options.studioHome, alias, rec.id)) ? c.json({ ok: true }) : c.json({ error: "그런 자료가 없다." }, 404);
  });

  // 대화 — LangGraph thread_id 로 관리한다 (사용자 결정 2026-10-05). 원본은 threads/<id>.jsonl.
  app.get("/api/threads", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    const [threads, pending] = await Promise.all([
      listThreads(options.studioHome, alias),
      listPendingRequests(options.studioHome, alias),
    ]);
    return c.json({ threads, pending: pending.length });
  });

  app.get("/api/thread", async (c) => {
    const alias = c.req.query("alias");
    const id = c.req.query("id");
    if (!alias || !id) return c.json({ error: "alias and id are required." }, 400);
    let read;
    try {
      read = await readThread(options.studioHome, alias, id);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
    if (!read) return c.json({ error: `대화 ${id} 가 없다.` }, 404);
    return c.json({ ...read, status: threadStatus(read.messages) });
  });

  app.post("/api/thread/send", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const alias = typeof rec.alias === "string" ? rec.alias : "";
    if (!alias) return c.json({ error: "alias is required." }, 400);
    const result = await sendThreadMessage(options.studioHome, langgraphPort, {
      alias,
      ...(typeof rec.threadId === "string" && rec.threadId ? { threadId: rec.threadId } : {}),
      assistantId: typeof rec.assistantId === "string" ? rec.assistantId : "",
      text: typeof rec.text === "string" ? rec.text : "",
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });

  app.post("/api/thread/resume", async (c) => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    const threadId = typeof rec?.threadId === "string" ? rec.threadId : "";
    if (!alias || !threadId) return c.json({ error: "alias and threadId are required." }, 400);
    const result = await resumeThread(options.studioHome, langgraphPort, alias, threadId);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });

  app.post("/api/thread/feedback", async (c) => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    const threadId = typeof rec?.threadId === "string" ? rec.threadId : "";
    const target = typeof rec?.target === "number" ? rec.target : -1;
    const value = rec?.value === "up" || rec?.value === "down" ? rec.value : null;
    if (!alias || !threadId || target < 0 || !value) {
      return c.json({ error: "alias, threadId, target, value(up|down) are required." }, 400);
    }
    const read = await readThread(options.studioHome, alias, threadId);
    if (!read) return c.json({ error: `대화 ${threadId} 가 없다.` }, 404);
    if (!read.messages.some((m) => m.seq === target && (m.role === "graph" || m.role === "host"))) {
      return c.json({ error: `${target}번은 평가할 수 있는 메시지(그래프 · 호스트)가 아니다.` }, 400);
    }
    const note = typeof rec?.note === "string" && rec.note.trim() ? rec.note.trim() : undefined;
    const message = await appendThreadMessage(options.studioHome, alias, threadId, {
      role: "feedback",
      target,
      value,
      ...(note ? { note } : {}),
    });
    return c.json({ ok: true, message });
  });

  // 1 설계 상담 — 명세 20261006a §12~§14. 원본은 consult/<id>.jsonl · ir.provenance.yaml · ir.review.yaml.
  app.get("/api/consult/hosts", async (c) => c.json({ hosts: await detectConsultHosts() }));

  app.get("/api/consult/list", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    return c.json({
      consults: await listConsults(options.studioHome, alias),
      archived: await listArchivedConsults(options.studioHome, alias),
    });
  });

  /** 대화를 끝낸다 — 보관으로 옮긴다. 다음 말은 새 상담(빈 호스트 세션)으로 간다 (사용자 요청 2026-10-08). */
  /** 0 대시보드 — 진행 · 에이전트 지표 · 먼저 볼 것 · 요구사항 지도 · 그래프 (사용자 결정 2026-10-08). */
  app.get("/api/dashboard", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    return c.json(await loadDashboard(options.studioHome, alias, langgraphUrl));
  });

  /** 생성된 시험을 돌려 요구사항 지도를 칠한다 — 사람이 누를 때만. */
  app.get("/api/dashboard/history", async c => {
    const alias = c.req.query("alias") ?? "";
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try {
      const [manual, progress] = await Promise.all([readDashboardHistory(options.studioHome, alias), readProgress(options.studioHome, alias)]);
      const rows = [...(progress.current ? [progress.current] : []), ...progress.history];
      return c.json({ entries: [
        ...manual.map(entry => ({ ...entry, tags: historyDomainTags(entry), source: "manual" })),
        ...rows.map((entry, index) => ({ id: `progress:${entry.timestamp}:${index}`, timestamp: entry.timestamp,
          tags: historyDomainTags(entry), content: entry.summary, asked: entry.asked, did: entry.did, source: "progress" })),
      ] });
    } catch (e) { return c.json({ error: (e as Error).message }, 500); }
  });
  app.post("/api/dashboard/history", async c => {
    const rec = await jsonRecord(c);
    if (!rec || typeof rec.alias !== "string") return c.json({ error: "프로젝트를 선택해주세요." }, 400);
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === rec.alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    const parsed = dashboardHistoryInputSchema.safeParse(rec);
    if (!parsed.success) return c.json({ error: "날짜, 태그(1~6개·각 30자 이하), 내용(1~5,000자)을 확인해주세요." }, 400);
    if (!parsed.data.tags.every(tag => (HISTORY_DOMAINS as readonly string[]).includes(tag))) return c.json({ error: "UI·LLM·대화창 등 기능 영역 태그를 선택해주세요." }, 400);
    try { return c.json({ entry: await appendDashboardHistory(options.studioHome, rec.alias, parsed.data) }, 201); }
    catch (e) { return c.json({ error: (e as Error).message }, 500); }
  });

  /** 프로젝트 도구 줄 「Log」 — 일일 기록 · 색인 · 확정 · 로컬 요약 · 보고서 바탕 (사용자 결정 2026-10-15). */
  registerLogRoutes(app, options.studioHome, {
    ...(options.roomRunner ? { runner: options.roomRunner } : {}),
    ...(options.roomBin !== undefined ? { lmsBin: options.roomBin } : {}),
  });

  app.post("/api/dashboard/tests", async (c) => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    if (!alias) return c.json({ error: "alias is required." }, 400);
    const result = await runProjectTests(options.studioHome, alias);
    if (!result.ok) return c.json({ error: result.error }, 502);
    return c.json({ ok: true, tests: result.tests });
  });

  /** 3 테스트의 실행 로그 — 아래 버튼을 누르면 보인다. 읽으면서 일한 노드를 쌓는다(4 · 5 를 여는 사실). */
  app.get("/api/test/activity", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    return c.json(await readTestActivity(options.studioHome, alias, langgraphUrl));
  });

  /** 3 테스트의 사용 창 주소 — 프로젝트가 만든 화면. */
  app.post("/api/test/app", async (c) => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    const url = typeof rec?.url === "string" ? rec.url.trim() : "";
    if (!alias) return c.json({ error: "alias is required." }, 400);
    if (url && !/^https?:\/\/[^\s]+$/.test(url)) return c.json({ error: "http:// 또는 https:// 로 시작하는 주소여야 한다." }, 400);
    const overlay = await writeOverlayApp(options.studioHome, alias, url || null);
    return c.json({ ok: true, app: overlay.app ?? null });
  });

  app.post("/api/consult/close", async (c) => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    const id = typeof rec?.consultId === "string" ? rec.consultId : "";
    if (!alias || !id) return c.json({ error: "alias and consultId are required." }, 400);
    const closed = await closeConsultConversation(options.studioHome, alias, id);
    if (!closed.ok) return c.json({ error: closed.error }, closed.status);
    return c.json({ ok: true, archived: closed.entry });
  });

  app.get("/api/consult", async (c) => {
    const alias = c.req.query("alias");
    const id = c.req.query("id");
    if (!alias || !id) return c.json({ error: "alias and id are required." }, 400);
    let read;
    try {
      read = await readConsult(options.studioHome, alias, id);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
    if (!read) return c.json({ error: `상담 ${id} 가 없다.` }, 404);
    const status = consultStatus(read.messages);
    // 파일만 보면 「답을 기다림」이 지금 도는 것인지, 콘솔이 꺼져 끊긴 것인지 모른다.
    return c.json({
      ...read,
      status,
      running: isConsultRunning(alias, id),
      archived: read.archived,
      run: consultRunInfo(alias, id),
      meta: currentConsultMeta(read.messages),
    });
  });

  app.post("/api/consult/send", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const alias = typeof rec.alias === "string" ? rec.alias : "";
    // 등록 LLM을 골랐으면 그 Agent의 공급자 · 모델 · 강도로 부른다. 아니면 예전처럼 호스트 · 모델을 그대로 받는다.
    let caller: Pick<Parameters<typeof sendConsultTurn>[1], "host" | "model" | "effort" | "agent"> = {
      host: (typeof rec.host === "string" ? rec.host : "claude-code") as "claude-code",
      model: typeof rec.model === "string" ? rec.model : "",
    };
    if (typeof rec.agentId === "string" && rec.agentId) {
      const loaded = await loadAgents(options.studioHome, alias);
      if (!loaded.ok) return c.json({ error: loaded.error }, loaded.status);
      const agent = loaded.agents.find((a) => a.id === rec.agentId);
      if (!agent) return c.json({ error: "등록된 LLM 목록에 그 LLM이 없다 — LLM 호출에서 다시 고른다." }, 404);
      const picked = consultAgentInput(agent);
      if (!picked.ok) return c.json({ error: picked.error }, 400);
      caller = { host: picked.host, model: picked.model, agent: picked.agent, ...(picked.effort ? { effort: picked.effort } : {}) };
    }
    const result = await sendConsultTurn(
      options.studioHome,
      {
        alias,
        ...(typeof rec.consultId === "string" && rec.consultId ? { consultId: rec.consultId } : {}),
        text: typeof rec.text === "string" ? rec.text : "",
        ...caller,
        ...(typeof rec.prdSection === "number" ? { prdSection: rec.prdSection } : {}),
        ...(Array.isArray(rec.attachments) ? { attachments: rec.attachments.filter((a): a is string => typeof a === "string") } : {}),
      },
      {
        ...(options.consultRunner ? { runner: options.consultRunner } : {}),
        ...(options.consultBin !== undefined ? { bin: options.consultBin } : {}),
      },
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    void result.done;
    return c.json({ ok: true, consultId: result.consultId, status: "waiting" }, 202);
  });

  app.get("/api/room/skills", async (c) => {
    const slug = c.req.query("slug");
    if (slug) {
      const result = await readRoomSkill(options.studioHome, slug);
      if (!result.ok) return c.json({ error: result.error }, result.status);
      return c.json({ slug, text: result.text });
    }
    return c.json({ skills: await listRoomSkills(options.studioHome) });
  });

  app.get("/api/room/files", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    const result = await listRoomProjectFiles(options.studioHome, alias);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ files: result.files });
  });

  app.get("/api/rooms/hosts", async (c) => {
    const auth = await detectConsultHosts();
    return c.json({ hosts: roomHostAvailability().map(host => {
      const status = auth.find(row => row.host === host.speaker);
      return { ...host, loggedIn: status?.loggedIn ?? null,
        hint: status?.loggedIn === false ? status.hint : "" };
    }) });
  });

  app.get("/api/rooms", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    const rooms = await roomListView(options.studioHome, alias);
    // 준비 상태는 덧붙이는 정보다 — 등록되지 않은 프로젝트면 없이 목록만 준다.
    const prepared = await todoPreparation.list(alias).then(result => ({ items: result.items, warning: undefined as string | undefined })).catch(() => ({ items: [], warning: "할일 준비 상태를 불러오지 못했습니다. 할일 목록을 확인해주세요." }));
    return c.json({ rooms: rooms.map((row) => ({ ...row, preparationStatus: prepared.items.find(v => v.roomId === row.id)?.status, running: row.running || roomExecution.isBusy(alias, row.id) })), ...(prepared.warning ? { preparationWarning: prepared.warning } : {}) });
  });

  app.get("/api/room", async (c) => {
    const alias = c.req.query("alias");
    const id = c.req.query("id");
    if (!alias || !id) return c.json({ error: "alias and id are required." }, 400);
    let read;
    try {
      read = await roomReadView(options.studioHome, alias, id);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
    if (!read) return c.json({ error: `대화방 ${id} 가 없다.` }, 404);
    const prepared = await todoPreparation.list(alias).then(result => ({ items: result.items, warning: undefined as string | undefined })).catch(() => ({ items: [], warning: "할일 준비 상태를 불러오지 못했습니다. 할일 목록을 확인해주세요." }));
    const preparation = prepared.items.find(v => v.roomId === id);
    return c.json({ ...read, preparationStatus: preparation?.status, running: read.running || roomExecution.isBusy(alias, id), ...(prepared.warning ? { preparationWarning: prepared.warning } : {}) });
  });

  app.get("/api/room/approved", async (c) => {
    try { return c.json({ plan: await roomExecution.approved(c.req.query("alias") ?? "") }); }
    catch (error) { return c.json({ error: (error as Error).message }, 409); }
  });
  app.get("/api/room/channels", c => c.json(roomNotificationChannels(options.roomNotifications ?? {})));
  app.post("/api/room/workflow/install", async (c) => {
    const rec = await jsonRecord(c);
    try { return c.json({ ok: true, ...await roomExecution.install(typeof rec?.alias === "string" ? rec.alias : "") }); }
    catch (error) { return c.json({ error: (error as Error).message }, 409); }
  });
  app.post("/api/room/execution/start", async (c) => {
    const rec = await jsonRecord(c);
    if (typeof rec?.alias === "string" && todoPreparation.isBusy(rec.alias)) return c.json({ error: "할일 사전 준비가 끝난 뒤 실행해주세요." }, 409);
    const result = await roomExecution.start(rec);
    if (!result.ok) return c.json({ error: result.error }, result.status);
    void result.done;
    return c.json({ ok: true, roomId: result.roomId }, 202);
  });
  app.post("/api/room/execution/action", async (c) => {
    const rec = await jsonRecord(c);
    if (typeof rec?.alias === "string" && todoPreparation.isBusy(rec.alias)) return c.json({ error: "할일 사전 준비가 끝난 뒤 실행해주세요." }, 409);
    const result = await roomExecution.action({
      alias: typeof rec?.alias === "string" ? rec.alias : "", roomId: typeof rec?.roomId === "string" ? rec.roomId : "",
      executionId: typeof rec?.executionId === "string" ? rec.executionId : "",
      action: typeof rec?.action === "string" ? rec.action : "",
      ...(typeof rec?.target === "string" ? { target: rec.target } : {}),
      ...(typeof rec?.note === "string" ? { note: rec.note } : {}),
      useRecommendedEffort: rec?.useRecommendedEffort === true,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    void result.done;
    return c.json({ ok: true, roomId: result.roomId }, result.done ? 202 : 200);
  });

  app.post("/api/room/send", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    if (typeof rec.alias === "string" && todoPreparation.isBusy(rec.alias)) return c.json({ error: "사전 준비가 진행 중입니다. 준비를 마치거나 중지한 뒤 대화해주세요." }, 409);
    if (rec.round !== undefined && rec.round !== "talk" && rec.round !== "discuss") return c.json({ error: "round는 talk 또는 discuss여야 한다." }, 400);
    if (typeof rec.alias === "string" && typeof rec.roomId === "string" && roomExecution.isBusy(rec.alias, rec.roomId)) return c.json({ error: "테스트 실행을 처리하고 있다." }, 409);
    const result = await sendRoomTurn(
      options.studioHome,
      {
        alias: typeof rec.alias === "string" ? rec.alias : "",
        ...(typeof rec.roomId === "string" && rec.roomId ? { roomId: rec.roomId } : {}),
        text: typeof rec.text === "string" ? rec.text : "",
        ...(rec.round === "talk" || rec.round === "discuss" ? { round: rec.round } : {}),
      },
      {
        ...(options.roomRunner ? { runner: options.roomRunner } : {}),
        ...(options.roomBin !== undefined ? { bin: options.roomBin } : {}),
      },
    );
    if (!result.ok) return c.json({ error: result.error }, result.status);
    void result.done;
    return c.json({ ok: true, roomId: result.roomId, status: "waiting" }, 202);
  });

  app.post("/api/room/stop", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const result = stopRoomTurn({ alias: typeof rec.alias === "string" ? rec.alias : "", roomId: typeof rec.roomId === "string" ? rec.roomId : "" });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  app.post("/api/room/memory", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const result = await attachRoomMemory(options.studioHome, {
      alias: typeof rec.alias === "string" ? rec.alias : "",
      ...(typeof rec.roomId === "string" && rec.roomId ? { roomId: rec.roomId } : {}),
      text: typeof rec.text === "string" ? rec.text : "",
      sourceId: typeof rec.sourceId === "string" ? rec.sourceId : "",
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, roomId: result.roomId });
  });

  app.post("/api/room/cast", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    if (typeof rec.alias === "string" && typeof rec.roomId === "string" && roomExecution.isBusy(rec.alias, rec.roomId)) return c.json({ error: "실행 중에는 담당을 바꾸지 않는다." }, 409);
    const members = Array.isArray(rec.members) ? rec.members : null;
    if (!members) return c.json({ error: "members is required." }, 400);
    const parsed = members.flatMap((row) => {
      const result = roomMemberSchema.safeParse(row);
      return result.success ? [result.data] : [];
    });
    if (parsed.length !== members.length) return c.json({ error: "사람마다 speaker, model, role 이 필요하다." }, 400);
    const result = await saveRoomCast(options.studioHome, {
      alias: typeof rec.alias === "string" ? rec.alias : "",
      ...(typeof rec.roomId === "string" && rec.roomId ? { roomId: rec.roomId } : {}),
      members: parsed,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, roomId: result.roomId });
  });

  app.get("/api/agents", async (c) => {
    const result = await loadAgents(options.studioHome, c.req.query("alias") ?? "");
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ agents: result.agents });
  });

  app.post("/api/agents", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const agents = Array.isArray(rec.agents) ? rec.agents : null;
    if (!agents) return c.json({ error: "agents is required." }, 400);
    const parsed = agents.flatMap((row) => {
      const result = roomMemberSchema.safeParse(row);
      return result.success ? [result.data] : [];
    });
    if (parsed.length !== agents.length) return c.json({ error: "Agent마다 speaker, model, role 이 필요하다." }, 400);
    const result = await saveAgents(options.studioHome, { alias: typeof rec.alias === "string" ? rec.alias : "", agents: parsed });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, agents: result.agents });
  });

  app.get("/api/modes", async (c) => {
    const result = await loadModes(options.studioHome, c.req.query("alias") ?? "");
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ modes: result.modes });
  });

  app.post("/api/modes", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const modes = Array.isArray(rec.modes) ? rec.modes : null;
    if (!modes) return c.json({ error: "modes is required." }, 400);
    const parsed = modes.flatMap((row) => {
      const result = roomModeSchema.safeParse(row);
      return result.success ? [result.data] : [];
    });
    if (parsed.length !== modes.length) return c.json({ error: "모드마다 id, 이름, 권한, 규약이 필요하다." }, 400);
    const result = await saveModes(options.studioHome, { alias: typeof rec.alias === "string" ? rec.alias : "", modes: parsed });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, modes: result.modes });
  });

  app.post("/api/room/mode", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    if (typeof rec.alias === "string" && typeof rec.roomId === "string" && roomExecution.isBusy(rec.alias, rec.roomId)) {
      return c.json({ error: "실행 중에는 모드를 바꾸지 않는다." }, 409);
    }
    const modeId = typeof rec.modeId === "string" && rec.modeId.trim() ? rec.modeId.trim() : null;
    const result = await saveRoomMode(options.studioHome, {
      alias: typeof rec.alias === "string" ? rec.alias : "",
      ...(typeof rec.roomId === "string" && rec.roomId ? { roomId: rec.roomId } : {}),
      modeId,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true, roomId: result.roomId, modeId: result.modeId, members: result.members });
  });

  app.get("/api/todo-preparations", async c => {
    try {
      const { items, running } = await todoPreparation.list(c.req.query("alias") ?? "");
      const roomId = c.req.query("roomId");
      return c.json({ items: items.map(v => c.req.query("summary") === "1" || (roomId && v.roomId !== roomId) ? { ...v, artifacts: [] } : v), running });
    }
    catch (e) { return c.json({ error: (e as Error).message }, e instanceof PreparationError ? e.status : 500); }
  });
  app.post("/api/todo-preparations/start", async c => {
    const rec = await jsonRecord(c);
    if (!rec || typeof rec.alias !== "string" || typeof rec.memberId !== "string" || !Array.isArray(rec.ids) || !rec.ids.every(id => typeof id === "string")) return c.json({ error: "대상 할일과 주 담당을 선택해주세요." }, 400);
    try { return c.json(await todoPreparation.start(rec.alias, rec.ids, rec.memberId)); }
    catch (e) { return c.json({ error: (e as Error).message }, e instanceof PreparationError ? e.status : 500); }
  });
  app.post("/api/todo-preparations/action", async c => {
    const rec = await jsonRecord(c);
    if (!rec || typeof rec.alias !== "string" || typeof rec.action !== "string" || (rec.action !== "stop" && typeof rec.id !== "string") || (rec.note !== undefined && typeof rec.note !== "string")) return c.json({ error: "준비 작업 요청 형식이 올바르지 않습니다." }, 400);
    try { return c.json({ ok: true, result: await todoPreparation.action(rec.alias, String(rec.id ?? ""), rec.action, rec.note as string | undefined) }); }
    catch (e) { return c.json({ error: (e as Error).message }, e instanceof PreparationError ? e.status : 500); }
  });

  // 사용자·Agent의 할일. 실제 대화 실행 상태와 완료 기록을 함께 조회한다.
  app.get("/api/todos", async (c) => {
    const alias = c.req.query("alias") ?? "";
    if (!(await readStudio(options.studioHome)).projects.some((p) => p.alias === alias)) return c.json({ error: `"${alias}" 는 등록된 프로젝트가 아니다.` }, 404);
    try {
      const todos = await updateTodos(options.studioHome, alias, fresh => fresh);
      return c.json({ todos: todos.map(row => row.roomId && (isRoomRunning(alias, row.roomId) || roomExecution.isBusy(alias, row.roomId)) ? { ...row, running: true } : row) });
    } catch (error) { return c.json({ error: `할일 기록 저장 실패: ${(error as Error).message}` }, 500); }
  });

  app.post("/api/todos", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const alias = typeof rec.alias === "string" ? rec.alias : "";
    if (!(await readStudio(options.studioHome)).projects.some((p) => p.alias === alias)) return c.json({ error: `"${alias}" 는 등록된 프로젝트가 아니다.` }, 404);
    const rows = Array.isArray(rec.todos) ? rec.todos : null;
    if (!rows) return c.json({ error: "todos is required." }, 400);
    const parsed = rows.flatMap((row) => {
      const result = todoItemSchema.safeParse(row);
      return result.success ? [result.data] : [];
    });
    if (parsed.length !== rows.length) return c.json({ error: "할 일마다 id, 제목(200자 이하), done, at 이 필요하다." }, 400);
    await writeTodos(options.studioHome, alias, parsed);
    return c.json({ ok: true, todos: await readTodos(options.studioHome, alias) });
  });

  app.post("/api/todos/action", async c => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const alias = typeof rec.alias === "string" ? rec.alias : "";
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try {
      const result = await applyTodoAction(options.studioHome, alias, rec, id => isRoomRunning(alias, id) || roomExecution.isBusy(alias, id));
      return c.json(result);
    } catch (error) { return c.json({ error: (error as Error).message }, error instanceof TodoActionError ? error.status : 500); }
  });

  // 맡긴 일 1시간 — 최근 7일 구간과 넘긴 구간 (R7.7).
  app.get("/api/task-timing", async c => {
    const alias = c.req.query("alias") ?? "";
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json(await loadTaskTiming(options.studioHome, alias)); }
    catch (error) { return c.json({ error: `시간 조회 실패: ${(error as Error).message}` }, 500); }
  });

  // 프로젝트 휴지통 — 지운 할일 · 대화를 4일 동안 보고 되살린다 (R9.6a · R9.6b).
  app.get("/api/trash", async c => {
    const alias = c.req.query("alias") ?? "";
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json({ entries: await listTrash(options.studioHome, alias) }); }
    catch (error) { return c.json({ error: `휴지통 조회 실패: ${(error as Error).message}` }, 500); }
  });

  app.post("/api/trash/restore", async c => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    const id = typeof rec?.id === "string" ? rec.id : "";
    if (!id) return c.json({ error: "되살릴 기록 id가 필요합니다." }, 400);
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json({ restored: await restoreTrash(options.studioHome, alias, id) }); }
    catch (error) { return c.json({ error: (error as Error).message }, error instanceof TrashError ? error.status : 500); }
  });

  // 흐름도 작업 아래 세부 항목. 상태는 연결된 할일과 실제 대화 실행에서 계산한다.
  app.get("/api/cycle-items", async c => {
    const alias = c.req.query("alias") ?? "";
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json({ items: await listCycleItems(options.studioHome, alias, id => isRoomRunning(alias, id) || roomExecution.isBusy(alias, id)) }); }
    catch (error) { return c.json({ error: `세부 항목 조회 실패: ${(error as Error).message}` }, 500); }
  });

  app.post("/api/cycle-items/action", async c => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const alias = typeof rec.alias === "string" ? rec.alias : "";
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try { return c.json(await applyCycleItemAction(options.studioHome, alias, rec, id => isRoomRunning(alias, id) || roomExecution.isBusy(alias, id))); }
    catch (error) { return c.json({ error: (error as Error).message }, error instanceof CycleItemActionError ? error.status : 500); }
  });

  app.get("/api/todos/history", async c => {
    const alias = c.req.query("alias") ?? "";
    if (!(await readStudio(options.studioHome)).projects.some(p => p.alias === alias)) return c.json({ error: "등록된 프로젝트가 아닙니다." }, 404);
    try {
      await updateTodos(options.studioHome, alias, fresh => fresh);
      const entries = await readTodoHistory(options.studioHome, alias);
      const id = c.req.query("id");
      if (!id) return c.json({ entries });
      const row = entries.find(entry => entry.id === id);
      if (!row) return c.json({ error: "기록을 찾을 수 없습니다." }, 404);
      // 저장소에서 생성한 해시 폴더만 허용한다.
      const folder = row.folder.split("/").at(-1) ?? "";
      if (!/^[a-f0-9]{24}$/.test(folder)) return c.json({ error: "기록 경로가 올바르지 않습니다." }, 400);
      const dir = path.join(todoHistoryDir(options.studioHome, alias), folder);
      let conversation = "";
      try {
        const files = await fs.readdir(path.join(dir, "conversations"));
        conversation = (await Promise.all(files.filter(file => /^[a-f0-9]{24}\.md$/.test(file)).map(file => fs.readFile(path.join(dir, "conversations", file), "utf8")))).join("\n\n");
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      return c.json({ entry: row, summary: await fs.readFile(path.join(dir, "summary.md"), "utf8"), conversation });
    } catch (error) { return c.json({ error: (error as Error).message }, 500); }
  });

  app.post("/api/room/title", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    const result = await saveRoomTitle(options.studioHome, {
      alias: typeof rec.alias === "string" ? rec.alias : "",
      roomId: typeof rec.roomId === "string" ? rec.roomId : "",
      title: typeof rec.title === "string" ? rec.title : "",
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  app.post("/api/room/keep", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    if (typeof rec.alias === "string" && typeof rec.roomId === "string" && roomExecution.isBusy(rec.alias, rec.roomId)) return c.json({ error: "실행 처리 중에는 읽기 전용 상태를 바꾸지 않는다." }, 409);
    const result = await saveRoomKept(options.studioHome, {
      alias: typeof rec.alias === "string" ? rec.alias : "",
      roomId: typeof rec.roomId === "string" ? rec.roomId : "",
      kept: rec.kept === true,
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  app.post("/api/room/delete", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    if (typeof rec.alias === "string" && typeof rec.roomId === "string" && roomExecution.isBusy(rec.alias, rec.roomId)) return c.json({ error: "실행 처리 중인 대화방은 지우지 않는다." }, 409);
    const result = await removeRoom(options.studioHome, {
      alias: typeof rec.alias === "string" ? rec.alias : "",
      roomId: typeof rec.roomId === "string" ? rec.roomId : "",
    });
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ ok: true });
  });

  // 개요 화면 — 문서 폴더의 개요.md (없으면 화면이 PRD로 그린다).
  app.get("/api/overview", async (c) => {
    const result = await readOverviewDoc(options.studioHome, c.req.query("alias"));
    if (!result.ok) return c.json({ error: result.error }, result.status);
    return c.json({ rel: result.rel, content: result.content });
  });

  app.get("/api/prd", async (c) => {
    const alias = c.req.query("alias");
    if (!alias) return c.json({ error: "alias is required." }, 400);
    const result = await loadPrd(options.studioHome, alias);
    if (!result.ok) return c.json({ status: "none", error: result.error });
    // 형식이 맞으면 설계 규칙 검사까지 — 「검사 맞추기」가 쓸 목록 (사용자 요청 2026-10-07).
    let checks: ReturnType<typeof checkProblems> = [];
    if (!result.format.length) {
      const draft = await readProposedIr(options.studioHome, alias);
      const parsed = draft.ok ? parseIr(draft.raw) : null;
      const project = (await readStudio(options.studioHome)).projects.find((p) => p.alias === alias);
      if (parsed?.ok) checks = checkProblems(runIrChecks(parsed.ir, project ? { docRoot: project.path } : {}));
    }
    return c.json({
      status: "ready",
      checks,
      checkRequest: checks.length ? checkFixRequest(checks) : null,
      sections: result.sections,
      review: result.review,
      progress: result.progress,
      architecture: result.architecture,
      format: result.format,
      formatRequest: result.format.length ? formatFixRequest(result.format) : null,
    });
  });

  /** 절 하나를 「맞아요 / 고쳐 주세요」로. 고쳐 주세요의 말은 화면이 상담으로 이어 보낸다. */
  app.post("/api/prd/mark", async (c) => {
    const rec = await jsonRecord(c);
    const alias = typeof rec?.alias === "string" ? rec.alias : "";
    const n = typeof rec?.n === "number" ? rec.n : 0;
    const state = rec?.state === "ok" || rec?.state === "fix" ? rec.state : null;
    if (!alias || !n || !state) return c.json({ error: "alias, n, state(ok|fix) are required." }, 400);
    const prd = await loadPrd(options.studioHome, alias);
    if (!prd.ok) return c.json({ error: prd.error }, 404);
    const note = typeof rec?.note === "string" ? rec.note : undefined;
    const marked = await markPrdSection(options.studioHome, alias, prd.sections, { n, state, ...(note ? { note } : {}) });
    if (!marked.ok) return c.json({ error: marked.error }, 400);
    const after = await loadPrd(options.studioHome, alias);
    return c.json({ ok: true, review: after.ok ? after.review : null });
  });

  // LLM 구독제 토큰 체력바 (왼쪽 하단 레일 + 상세 창).
  app.get("/api/llm-quota", async (c) => {
    try {
      await options.claudeQuotaRefresh?.().catch(() => undefined);
      return c.json(await loadLlmQuotaSnapshot(options.studioHome));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.post("/api/llm-quota", async (c) => {
    const rec = await jsonRecord(c);
    if (!rec) return c.json({ error: "JSON body is required." }, 400);
    try {
      const preset = typeof rec.preset === "string" && (LLM_QUOTA_PRESETS as readonly string[]).includes(rec.preset)
        ? (rec.preset as LlmQuotaPreset)
        : undefined;
      if (!preset) return c.json({ error: "preset 값이 필요합니다." }, 400);
      await updateLlmQuotaConfig(options.studioHome, (current) => {
        if (preset !== "custom") {
          return {
            ...current,
            preset,
            caps: {
              "claude-code": { ...PRESET_CAPS[preset]["claude-code"] },
              codex: { ...PRESET_CAPS[preset].codex },
            },
          };
        }
        const rawCaps = rec.caps && typeof rec.caps === "object" ? (rec.caps as Record<string, unknown>) : {};
        const nextCaps = { ...current.caps };
        for (const p of LLM_QUOTA_PROVIDERS) {
          const parsed = providerCapSchema.safeParse(rawCaps[p]);
          if (parsed.success) nextCaps[p] = parsed.data;
        }
        return { ...current, preset: "custom", caps: nextCaps };
      });
      return c.json(await loadLlmQuotaSnapshot(options.studioHome));
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get("/api/events", (c) => {
    return streamSSE(c, async (stream) => {
      let writes = Promise.resolve();
      const enqueue = (op: () => Promise<unknown>) => {
        writes = writes.then(op).then(() => undefined, () => undefined);
        return writes;
      };

      const send = (event: StudioEvent) => {
        if (stream.closed || stream.aborted) return;
        void enqueue(() =>
          stream.writeSSE({
            event: event.event,
            data: JSON.stringify({
              alias: event.alias,
              ...(event.threadId ? { threadId: event.threadId } : {}),
              ...(event.consultId ? { consultId: event.consultId } : {}),
              ...(event.roomId ? { roomId: event.roomId } : {}),
            }),
          }),
        );
      };

      listeners.add(send);
      stream.onAbort(() => {
        listeners.delete(send);
      });

      try {
        while (!stream.closed && !stream.aborted) {
          await enqueue(() => stream.write(SSE_KEEPALIVE_COMMENT));
          await stream.sleep(SSE_KEEPALIVE_MS);
        }
      } finally {
        listeners.delete(send);
      }
    });
  });

  // `serveStatic`'s `root` works fine as an absolute path (it's just
  // `path.join(root, filename)` + `fs` underneath) -- passed directly so
  // this never depends on the CLI's cwd when this process is spawned.
  app.use("/*", serveStatic({ root: CLIENT_DIST }));

  return Object.assign(app, {
    watchReady: studioWatch?.ready ?? Promise.resolve(),
    close: async () => {
      if (overdueTimer) clearInterval(overdueTimer);
      if (taskTimer) clearInterval(taskTimer);
      todoPreparation.stopAll();
      await studioWatch?.close();
      studioWatch = undefined;
      semanticHost.close();
      ragHost.close();
      await neo4jPort?.close();
    },
  });
}

async function boardMutation(
  c: Context,
  run: (payload: Record<string, unknown>) => Promise<
    | { ok: true; status: 200; body: Record<string, unknown> }
    | { ok: false; status: 400 | 404; error: string }
  >,
) {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: "JSON body is required." }, 400);
  }
  const rec = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const result = await run(rec);
  if (!result.ok) {
    return c.json({ error: result.error }, result.status);
  }
  return c.json(result.body);
}
