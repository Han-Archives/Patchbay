# Patchbay 구현계획

| 항목 | 값 |
| --- | --- |
| 문서명 | Patchbay_구현계획 |
| 버전 | 20260913a |
| 이전 버전 | `Patchbay_구현계획_20260912b.md` |
| 기반 기획서 | `Patchbay_기획_20260913a.md` |
| 상태 | 초안 (실행 전) |
| 다음 파일명 | 내용이 바뀌면 `Patchbay_구현계획_20260913b.md`처럼 접미사 증가. 날짜가 바뀌면 `Patchbay_구현계획_YYYYMMDDa.md`로 새로 시작 |

기획서(`Patchbay_기획_20260913a.md`)는 "무엇을 만들지"를 고정한다. 이 문서는 "어떤 순서·태스크·완료 조건으로 만들지"를 고정한다. 기획이 바뀌면 이 문서도 다시 검토해야 한다.

20260913a판 변경 요지: `Patchbay_기획_20260913a.md`에서 신설된 **멀티 LLM 역할 분담(파일 매개형)** 기능에 맞춰 **Phase 12**를 추가했다. Phase 지도(2절), 테스트 전략(15절), 마일스톤 요약(16절), 리스크 레지스터(17절)에 반영. 그 외 내용은 b판과 동일.

---

## 0. 이 문서의 범위

- 대상: 기획서 11절(레포 뼈대) + 6절(세 온보딩 시나리오) + 8절(아키텍처) + 9~10절(파일 형식/스킬)을 실행 가능한 태스크로 분해.
- 각 Phase는: 목표 → 작업(파일 단위) → 완료 조건 → 의존성 → 관련 열린 질문 순으로 적는다.
- 완료 조건은 "테스트로 확인 가능한 것"과 "수동 QA로만 확인 가능한 것"을 구분해서 표시한다.

---

## 1. 실행을 위해 채택한 가정

기획서 13절 열린 질문 중 일부는 아직 미확정이지만, 실행 계획이 멈추지 않으려면 기본값이 필요하다. 아래는 **가정**이며 결정이 아니다 — 뒤집기 쉬운 지점(파일 하나, 설정값 하나)만 골랐다.

| 열린 질문 | 채택한 기본값 | 뒤집는 비용 |
| --- | --- | --- |
| Q1 스튜디오 루트 | `~/.patchbay`, `PATCHBAY_HOME` 환경변수로 override | 낮음 — 경로 상수 하나 |
| Q2 studio 홈 git 관리 | Phase 0에서 studio 홈 자체를 별도 git 레포로 init | 낮음 — 나중에 꺼도 됨 |
| Q3 심링크 vs 복사 | 기본 심링크, 실패 시(Windows/크로스볼륨) 복사 폴백 | 중간 — patch 로직 하나 |
| Q9(c) clarity score | v0은 룰 기반 가중합(커밋 메시지 다양성 + README 유무 + 중복 파일명 패턴 수)만. 정교화는 실사용 후 | 낮음 — 휴리스틱 함수 하나 |
| Q11(c) 빠른 시작 기본값 | 한 줄 정의 + 성공 조건만 묻고, 1차 사용자="나 자신", 표면="터미널+Cursor", 스택은 스캔된 것 그대로 | 낮음 — 인터뷰 스크립트 |
| Q16(d) 텔레그램 배포 방식 | v1은 long-polling, 사용자가 개인 머신에서 수동 기동. 웹훅/클라우드 배포는 보류 | 낮음 — 기동 스크립트 하나 |
| Q17(20260913a) `assignments.yaml` 동시 갱신 | progress.yaml과 동일하게 last-write-wins, 문서화만 | 낮음 — 문서 한 줄 |

나머지 열린 질문(Q4~Q8, Q10, Q12, 기획서 13절 질문 14)은 해당 Phase가 실제로 그 결정을 필요로 할 때까지 미룬다.

---

## 2. 전체 Phase 지도

```
Phase 0 (부트스트랩)
  └─ Phase 1 (스키마)
       └─ Phase 2 (스캐너)
            └─ Phase 3 (CLI + Atlas/Flow) ── 첫 게이트, 실사용 정지점
                 ├─ Phase 4 (레이어 L1/L3)
                 └─ Phase 5 (진행모드 + Patch/Wire)
                      ├─ Phase 6 (MCP)
                      │    └─ Phase 7 (Progress 표면)
                      │         ├─ Phase 8 (내장 스킬 3종)
                      │         │    └─ Phase 9 (온보딩 스킬 3종 + CLI)
                      │         │         └─ Phase 10 (XYFlow, 조건부)
                      │         └─ Phase 11 (Telegram 원격 호스트, v1 읽기 전용)
                      └─ Phase 12 (멀티 에이전트 역할 분담, 파일 매개형)
```

Phase 4/5는 Phase 3 이후 병행 가능. Phase 11/12는 각각 Phase 7과 Phase 5+7만 있으면 되므로 Phase 8/9/10과 병행 가능 — 온보딩 스킬 완성을 기다릴 필요 없음. 나머지는 순차 의존.

---

## 3. Phase 0 — 레포·툴체인 부트스트랩

**목표**: 코드를 넣을 수 있는 최소 모노레포.

**작업**
- `git init` (Patchbay 레포 자체 — 현재 git 저장소 아님)
- `pnpm-workspace.yaml`, 루트 `package.json`, 공통 `tsconfig.base.json`
- 빈 패키지 스텁: `packages/core`, `packages/cli`, `packages/mcp`, `packages/skills`, `apps/flow` (각 `package.json` + `src/index.ts`)
- `vitest.config.ts` (루트, 워크스페이스 공유)
- `.gitignore` (`node_modules`, `dist`, `*.tsbuildinfo`, `.patchbay-local/` 등 로컬 테스트 스튜디오 경로)
- studio 홈 초기화 스크립트: `~/.patchbay`가 없으면 만들고 그 안에서 `git init` (가정 Q2)

**완료 조건 (자동)**: `pnpm install` 성공, `pnpm -r build`(빈 빌드) 통과, 첫 커밋 생성.

**의존성**: 없음.

---

## 4. Phase 1 — 코어 스키마 (Zod)

**목표**: 온톨로지 v0(기획서 7절)을 실행 가능한 스키마로 옮긴다.

**작업** (`packages/core/src/types/`)
- `project.ts` — Project, Skill, Agent, Source, Artifact(+ `layer` 속성), Patch, Wire
- `domain.ts` — Concept, Decision, Signal, View
- `studio.ts` — Studio(`studio.yaml` shape)
- `overlay.ts` — overlay.yaml shape (patches[], wires[], decisions[], accepted_guides)
- `inferred.ts` — 스캐너 출력 shape
- `progress.ts` — progress.yaml shape (current, history[])
- `index.ts` — re-export

**완료 조건 (자동)**: 각 스키마당 파싱 성공/실패 유닛 테스트 1개 이상, `pnpm --filter core test` 통과.

**의존성**: Phase 0.

---

## 5. Phase 2 — 결정적 스캐너

**목표**: 로컬 폴더 하나 → `InferredSchema`. LLM 없음, 재현 가능해야 함(원칙 2).

**작업** (`packages/core/src/scan/`)
- `fileWalker.ts` — 재귀 순회, `node_modules`/`.git` 등 무시 규칙
- `gitReader.ts` — simple-git으로 branch/ahead/최근 커밋 메시지 N개
- `signalReader.ts` — README.md / SKILL.md / AGENTS.md / CLAUDE.md / `.cursor/rules` 존재·발췌
- `portDetector.ts` — "라벨 없는 잭" 후보 탐지 v0 (온톨로지에 등록 안 된 소스/스킬 파일 후보 목록)
- `scanner.ts` — 위를 조합해 `InferredSchema` 생성

**완료 조건 (자동)**: 픽스처 레포(테스트용 더미 프로젝트) 스캔 스냅샷 테스트 통과. Patchbay 자기 자신을 스캔해도 에러 없이 끝남.

**의존성**: Phase 1.

**관련 열린 질문**: Q5(git 신호 깊이) — v0은 커밋 메시지+branch까지만, 파일 diff 내용 분석은 범위 밖.

---

## 6. Phase 3 — CLI 최소 + Atlas/Flow 렌더링 (첫 게이트)

**목표**: 여기서 멈추고 며칠 실사용한다. MCP·스킬은 아직 없다.

**작업** (`packages/cli/src/commands/`)
- `init.ts` — studio.yaml 생성
- `projectAdd.ts` — studio.yaml에 프로젝트 등록 + 최초 scan 호출
- `scan.ts` — Phase 2 스캐너 CLI 노출
- `atlas.ts` — 아래 렌더러 호출

**작업** (`packages/core/src/render/`)
- `atlasRenderer.ts` — InferredSchema → `ATLAS.md` (L2)
- `flowRenderer.ts` — InferredSchema → `FLOW.md` (Mermaid, 아키텍처 모드만)

**완료 조건 (수동 QA, 기획서 12절 성공 조건과 동일)**: 등록한 레포 하나를 스캔했을 때, Cursor에서 Atlas/Flow 마크다운만 보고 스킬·규칙·빈 잭을 설명할 수 있다.

**게이트**: 이 지점에서 실제로 며칠 써보고 "포트폴리오 조망이 유용한가"를 확인한 뒤 Phase 4로 진행할지 판단한다.

**의존성**: Phase 2.

---

## 7. Phase 4 — 레이어 렌더링 (L1/L3 확장)

**목표**: 원칙 9(레이어) 구현.

**작업**
- `render/layers.ts` — L1 집계 함수(카운트/상태 필드만 추출하는 별도 함수, 압축이 아님)
- `atlasRenderer.ts` 확장 — `ATLAS.digest.md`(L1) 동시 생성
- CLI `atlas --level 1|2|3` 플래그. L3는 `inferred.json` 그대로 노출.

**완료 조건 (자동)**: `atlas --level 1` 출력이 기본 `atlas` 출력보다 확연히 짧고, 동일한 숫자(카운트)를 공유하는 스냅샷 테스트.

**의존성**: Phase 3.

---

## 8. Phase 5 — 진행 모드 + Patch/Wire

**목표**: `overlay.yaml` 기반 Patch/Wire diff(7.4절), Flow의 진행 모드.

**작업**
- `overlay/overlayStore.ts` — overlay.yaml 읽기/쓰기(스캔이 덮어쓰지 않는 사람 소유 레이어)
- `overlay/patchWireDiff.ts` — `할 일 = Patch − Wire` 계산
- `flowRenderer.ts` — 진행 모드 추가(git 활동 기반 타임라인)
- CLI `patch <skill> <project>` — 스킬 심링크(기본)/복사(폴백) + `overlay.wires` 기록

**완료 조건 (수동 QA)**: 스킬 하나를 실제 프로젝트에 패치하면 Atlas/Flow에서 Patch−Wire 갭이 보이고, `overlay.yaml`에 Wire가 남는다.

**의존성**: Phase 3 (Phase 4와 병행 가능).

**관련 열린 질문**: Q3(심링크 기본값, 채택됨 — 위 1절), Q4(스킬 정본 위치)는 이 Phase에서는 단일 스튜디오 가정으로 미룸.

---

## 9. Phase 6 — MCP 래퍼

**목표**: Cursor/Claude Code 면.

**작업** (`packages/mcp/src/tools/`)
- `listProjects.ts`, `getAtlas.ts`(level), `getGraph.ts`(level), `getProjectBundle.ts`(level, scope)
- `server.ts` — stdio 서버, `packages/core` 재사용

**완료 조건 (수동 QA — stdio 프로토콜 특성상 자동화 어려움)**: Cursor 또는 Claude Code에서 MCP로 Atlas를 조회할 수 있다.

**의존성**: Phase 4, 5.

---

## 10. Phase 7 — Progress 표면

**목표**: 원칙 10(진행 상태도 파일) 구현.

**작업**
- `progress/progressStore.ts` — `progress.yaml` 읽기/쓰기 헬퍼(스킬이 호출할 API). Phase 12에서 `--agent` 필드로 확장될 것을 고려해 필드를 열어둔다.
- `render/progressRenderer.ts` — `progress.yaml` → `PROGRESS.md`, 여러 프로젝트 롤업 → `<studio>/progress.md`
- CLI `progress [--project] [--level]`
- MCP `get_progress`

**완료 조건 (자동 + 수동)**: `progress.yaml`을 수동으로 갱신하면 `PROGRESS.md`/`progress.md`가 재생성됨(자동 테스트). CLI/MCP에서 동일한 상태가 조회됨(수동 QA).

**의존성**: Phase 6.

---

## 11. Phase 8 — 내장 스킬 3종

**목표**: 결정적 코어 위에서 호스트 LLM이 제안을 쓰는 첫 실제 스킬. 원칙 3의 실물화.

**작업** (`packages/skills/`)
- `map-project/SKILL.md` — Atlas/Flow 최신 확인, 필요시 `scan` 호출 안내. `progress.yaml` 시작/종료 규약 포함.
- `propose-ontology/SKILL.md` — `get_project_bundle` 재료로 `ontology/<alias>.yaml` 초안. 기존 파일 있으면 덮어쓰지 않고 diff.
- `propose-dashboard/SKILL.md` — `DASHBOARD.md` 초안(View 4~7개 + 계측 갭).
- 공통 규약: 모든 스킬이 시작/종료 시 `progress.yaml`을 갱신하는 방법을 SKILL.md 템플릿에 고정 문구로 포함.

**완료 조건 (수동 QA)**: 실제 프로젝트에서 `propose-ontology`/`propose-dashboard`를 실행해 git diff로 리뷰 가능한 초안이 나온다.

**의존성**: Phase 6, 7.

---

## 12. Phase 9 — 온보딩 스킬 3종 + CLI 진입점

**목표**: 기획서 6절의 세 시나리오(신규/기존 이식/정리)를 실물화.

**작업**
- CLI: `projectNew.ts`, `projectTriage.ts`
- `scan.ts`에 clarity score 휴리스틱 통합 (`project add`가 낮은 점수를 만나면 triage 전환 제안)
- `core/scan/excavation.ts` — 포렌식 스캔(중복/유사 파일명 클러스터링, 고아 파일 탐지, TODO 밀도)
- `skills/new-project/SKILL.md` — 대화형 설계 인터뷰, 빠른 시작 모드
- `skills/adopt-project/SKILL.md` — 발굴 후 확인, 확인 전 `progress.yaml` 기록 금지
- `skills/triage-project/SKILL.md` — 클러스터 가설 제시, `_archive/`/`_needs-review/` diff 생성, 완료 시 `new-project`/`adopt-project`로 안내

**완료 조건 (수동 QA)**: 세 시나리오 각각 최소 1회 수동 워크스루로 6.1/6.2/6.3 절차가 실제로 끝까지 동작 — 신규는 기획서+로드맵 생성까지, 이식은 진행 상태 확인까지, 정리는 아카이브 diff 승인 후 A 또는 B로 합류하는 지점까지.

**의존성**: Phase 8.

**관련 열린 질문**: Q9(clarity score — v0 휴리스틱으로 시작), Q11(빠른 시작 기본값 — 채택됨), Q12(adopt-project 오추정 반복 마찰)는 실사용 데이터가 쌓인 뒤 재검토.

---

## 13. Phase 10 — XYFlow 캔버스 (조건부, 기본 보류)

**목표**: Mermaid로 안 되는 구체적 사례(팬/줌, 대규모 그래프)가 실사용 중 나올 때만 착수.

**작업**: `apps/flow`(Vite + React + `@xyflow/react`), CLI `flow` 명령이 짧은 로컬 서버(Hono) 기동, 같은 그래프 JSON을 읽기만 함.

**착수 조건**: Phase 3~9를 실사용하며 Mermaid의 한계가 구체적으로 드러날 것 — 착수 전 반드시 그 사례를 기록.

---

## 14. Phase 11 — Telegram 원격 호스트 (v1: 읽기 전용)

**목표**: 휴대폰에서 텔레그램으로 Atlas/Progress 같은 상태를 조회할 수 있는 상시 호스트를 추가한다. 커널은 여전히 LLM을 모른다 — 이 호스트도 Cursor/Claude Code처럼 반드시 MCP를 거쳐 Core에 접근한다(원칙 1/2 유지).

**작업** (`apps/telegram-bot/`)
- `bot.ts` — Telegram long-polling 클라이언트. 기동 시 `TELEGRAM_BOT_TOKEN`/`TELEGRAM_OWNER_CHAT_ID` 환경변수 검증(없으면 즉시 종료), 화이트리스트 chat id 필터
- `agent.ts` — Anthropic API 클라이언트 + `packages/mcp`의 stdio 서버를 자식 프로세스로 스폰하는 MCP client. 노출 가능한 툴은 Phase 6/7에서 이미 정의된 읽기 전용 5종뿐
- `history.ts` — 프로세스 메모리 내 최근 N턴 대화 버퍼. 파일/DB 영속화 없음
- CLI 진입점: `patchbay bot start` — **자동 기동 스크립트(launchd/systemd 등)는 만들지 않는다.** 항상 사용자가 수동으로 켠다

**완료 조건 (수동 QA — Telegram 프로토콜 특성상 자동화 어려움)**:
- 실제 텔레그램 봇에 휴대폰에서 "지금 프로젝트 상태 보여줘" 같은 메시지를 보내면 Atlas/Progress 요약이 돌아온다.
- 화이트리스트 밖 chat id로 보낸 메시지는 무시되고 로그만 남는다.
- 쓰기를 요구하는 메시지를 보내면, 그런 툴이 애초에 없으므로 LLM이 실행 불가를 답한다.

**의존성**: Phase 7. Phase 8/9/10/12와 병행 가능.

**관련 열린 질문**: Q16(텔레그램 배포 방식 — long-polling 수동 기동으로 채택됨).

---

## 15. Phase 12 — 멀티 에이전트 역할 분담 (20260913a판 신설, 파일 매개형)

**목표**: 하나의 프로젝트를 여러 LLM(서로 다른 호스트 세션)이 나눠 진행할 수 있게, 역할 배정과 산출물 추적을 **파일로만** 지원한다. Patchbay는 오케스트레이션 엔진이 아니다(원칙 6) — 리더도 워커도 사람이 여는 별도 세션이고, Core는 여전히 아무것도 실행하지 않는다.

**작업** (`packages/core/src/assignments/`)
- `assignmentStore.ts` — `assignments.yaml`/`assignments.proposed.yaml` 읽기/쓰기(overlay.yaml과 동일한 소유권 규칙 — 스캔이 덮어쓰지 않음)
- `assignmentSchema.ts` — Phase 1의 `Agent` 스키마를 확장해 `role`/`host`/`status`/`deliverable` 필드 추가 (새 온톨로지 클래스 아님)

**작업** (`packages/cli/src/commands/`)
- `assign.ts` — `patchbay assign <agent-slug> --role "<설명>"`. 확정 파일이 있으면 `.proposed.yaml`에 초안, 사용자가 승인해야 `assignments.yaml`로 확정
- `progress write --agent <agent-slug> --deliverable <path>` — Phase 7의 `progressStore`를 재사용해 워커의 산출물 기록을 확장

**작업** (`packages/skills/`)
- `lead-project/SKILL.md` — `get_project_bundle`/`get_atlas`/`get_progress`로 현황 파악 → 역할 단위 작업 분해 → `assignments.proposed.yaml` 작성. 재실행 시 `delivered` 항목을 Atlas/Wire로 검증해 accept/reject하고 다음 라운드 배정. `progress.yaml` 시작/종료 기록.
- `pickup-role/SKILL.md` — 워커 세션에서 자신의 agent-slug에 배정된 role/task를 조회해 보여줌. 완료 시 `progress write --agent --deliverable` 절차 안내. `assignments.yaml`을 직접 쓰지 않는다.

**완료 조건 (수동 QA — 멀티 세션 특성상 자동화 어려움)**:
- 리더 세션에서 `lead-project` 실행 → `assignments.proposed.yaml` 생성 → 사용자 승인 → `assignments.yaml` 확정까지 동작.
- 워커 세션에서 `pickup-role`로 배정을 확인하고, 작업 후 `progress write --agent --deliverable`로 상태가 `delivered`로 바뀐다.
- 리더 세션 재실행 시 `delivered` 항목이 실제 Artifact로 확인되고, 다음 라운드 배정이 생성된다.
- 이 과정 어디에도 리더/워커 세션 사이를 잇는 자동 호출(API, 셸, 알림) 코드가 없다 — 코드 리뷰로 확인.

**의존성**: Phase 5(overlay 소유권 패턴), Phase 7(progress 확장). Phase 8/9/10/11과 병행 가능.

**관련 열린 질문**: Q17(20260913a, `assignments.yaml` 동시 갱신 — last-write-wins 채택), 기획서 13절 질문 14(무응답/이탈 감지 — v1은 사람이 직접 확인).

---

## 16. 테스트 전략

| 대상 | 방법 |
| --- | --- |
| `packages/core` 스키마·스캐너·렌더러 | vitest 유닛 테스트 + 스냅샷 테스트 |
| `packages/cli` | 빌드된 CLI를 픽스처 레포에 대해 실행하는 통합 테스트(execa) |
| `packages/mcp` | 자동화 보류 — stdio 프로토콜 특성상 수동 QA 체크리스트로 대체 |
| 스킬(`packages/skills`) | 자동화 대상 아님 — 실제 Claude Code/Cursor 세션에서 수동 실행 후 git diff 리뷰 |
| `apps/telegram-bot` | 자동화 보류 — Telegram 프로토콜 특성상 수동 QA 체크리스트로 대체. 화이트리스트 필터 함수는 유닛 테스트 가능 |
| `packages/core/src/assignments` (20260913a판 신설) | assignmentStore 읽기/쓰기는 유닛 테스트 가능(overlayStore와 동일 패턴). 리더↔워커 왕복 전체는 자동화 보류 — 멀티 세션 수동 워크스루로 대체 |

---

## 17. 마일스톤 요약

| Phase | 산출물 | 완료 조건 유형 |
| --- | --- | --- |
| 0 | 빈 모노레포 | 자동 |
| 1 | Zod 스키마 | 자동 |
| 2 | 스캐너 | 자동 |
| 3 | CLI + Atlas/Flow | **수동 게이트** |
| 4 | 레이어(L1/L3) | 자동 |
| 5 | Patch/Wire, 진행모드 | 수동 |
| 6 | MCP | 수동 |
| 7 | Progress 표면 | 자동+수동 |
| 8 | 내장 스킬 3종 | 수동 |
| 9 | 온보딩 스킬 3종 | 수동 |
| 10 | XYFlow | 조건부 |
| 11 | Telegram 원격 호스트(읽기전용) | 수동 |
| 12 | 멀티 에이전트 역할 분담(파일 매개형) | 수동 |

---

## 18. 리스크 레지스터

| 리스크 | 영향 Phase | 완화 |
| --- | --- | --- |
| Phase 3 게이트에서 "포트폴리오 조망이 안 유용하다"는 결론이 나옴 | 4 이후 전체 | Phase 4 착수 전 실사용 기간을 반드시 둔다 |
| clarity score 휴리스틱이 부정확해 triage 오탐/누락 | 9 | v0은 보수적으로(애매하면 triage 제안 안 함) 설계, 실사용 데이터로 조정 |
| 심링크가 Windows/크로스볼륨에서 실패 | 5 | 복사 폴백을 Phase 5에서 함께 구현 |
| MCP 수동 QA만 가능해 회귀를 놓침 | 6 이후 | 스킬/사용 시나리오별 수동 체크리스트를 별도로 유지 |
| `adopt-project` 진행 상태 추정이 반복적으로 틀림 | 9 | 확인 전 기록 금지 원칙을 엄격히 지키고, 틀린 빈도를 Progress 표면에 기록해 스스로 관측 |
| 텔레그램 봇 토큰 유출 시 제3자가 읽기 전용이라도 프로젝트 현황을 조회 가능 | 11 | 화이트리스트 단일 chat id + 토큰은 환경변수로만 관리, 저장소에 커밋 금지 |
| 구현 실수로 쓰기 MCP 툴이 텔레그램 host에 흘러들어감 | 11 | 구조적 방지 — Phase 6/7 MCP 서버 자체가 읽기 전용 5종만 노출 |
| (20260913a판 신설) `lead-project`가 점점 "편의상" 워커를 자동 호출하는 코드로 변질 — 전형적인 스코프 크립 | 12 | 원칙 6/자가점검 15번을 코드 리뷰 체크리스트에 명시, `lead-project`/`pickup-role` SKILL.md에 "파일만 읽고 쓴다"를 고정 문구로 못박음 |
| (20260913a판 신설) 워커가 배정과 다른 산출물을 내거나 응답이 없어도 리더가 감지할 방법이 v1엔 없음 | 12 | 사람이 직접 눈으로 확인하는 것을 v1 설계로 명시(자동 타임아웃 없음) — Phase 12 실사용 데이터가 쌓이면 재검토 |
