# Patchbay 명세서

| 항목 | 값 |
| --- | --- |
| 문서명 | Patchbay_명세 |
| 버전 | 20260918a |
| 기반 | `docs/기획/Patchbay_기획_20260918a.md` |
| 용도 | 구현 중 대조. **6절이 기획과 충돌하면 구현 전까지 6절이 이긴다** |
| 커널 PortId 등 | 기존 `dev/` 채택값을 유지한다. 스캐너·kind 집합을 이 판에서 바꾸지 않는다 |

P0에서 닫는 것: 4탭, 파일 소유, `board.yaml`, SSE, 어댑터 URL, 쓰기 MCP 이름.

---

## 1. 셸

- 진입: `patchbay flow [--project <alias>] [--port <n>]`. 기본 포트 **4317**.
- 패키지 이름 `@patchbay/flow` / `apps/flow` 유지.
- 레이아웃: 왼쪽 **200px** 내비, 오른쪽 현재 탭. 최소 높이 뷰포트 전체.
- 내비 위→아래: 제목 `Patchbay`, 프로젝트 `<select>`, 탭 4개, 맨 아래 어댑터 두 줄.
- 탭 id (URL·상태·테스트에 이 문자열만 쓴다):

| id | 라벨 |
| --- | --- |
| `project` | 프로젝트 |
| `flow` | 흐름 |
| `knowledge` | 지식 |
| `board` | 캔버스 |

- 활성 탭은 왼쪽 3px 액센트 보더. 그림자·그라데이션 없음.
- 프로젝트 목록이 비면 select는 비활성, 오른쪽은 “등록된 프로젝트가 없습니다” + `patchbay project add` 안내. 탭은 눌러도 같은 빈 상태를 우선한다.
- `--project`가 있으면 그 alias를 초기 선택. 없거나 목록에 없으면 목록의 첫 항목. 목록이 비면 선택 없음.

---

## 2. 파일 트리 (프로젝트)

`<studioHome>/` 기본은 `PATCHBAY_HOME` 또는 `~/.patchbay`.

```
studio.yaml
progress.md                          # 스튜디오 롤업, progress write가 재생성
projects/<alias>/
  overlay.yaml                       # 사람
  inferred.json                      # 스캔이 통째로 덮음
  ATLAS.md
  ATLAS.digest.md
  FLOW.md
  progress.yaml                      # progress write만
  PROGRESS.md
  board.yaml                         # 콘솔·place_on_board. 스캔 금지
skills/<slug>/SKILL.md               # 확정 Skill Bay. 스캔 안 덮음
skills/<slug>.proposed/SKILL.md      # P8 초안. 확정은 skill accept
```

### 2.1 `board.yaml`

스키마는 P0에서 고정. Core 스토어는 P4 `placeOnBoard`, P7 `moveOnBoard` / `linkOnBoard` / `unlinkOnBoard` / `removeFromBoard`. 보드 UI는 P7.

```yaml
items:
  - id: langgraph:research_flow:draft   # 보드 안에서 유일
    kind: langgraph                     # langgraph | neo4j | port
    ref: research_flow:draft            # 소스 쪽 주소. PortId가 아니면 문자열
    title: "LangGraph · draft"
    x: 120
    y: 80
links:
  - from: langgraph:research_flow:draft
    to: neo4j:file:README.md
```

- `kind: port`는 스캔 포트(`source:…` 등)를 올릴 때.
- 없는 파일은 `{ items: [], links: [] }`.
- 좌표 단위는 CSS 픽셀. 정수. `place_on_board`에서 생략하면 `0`.
- 같은 `id`는 no-op이고 파일을 다시 쓰지 않는다. 같은 좌표 이동·같은 `(from, to)` 링크도 파일을 다시 쓰지 않는다.
- 스캔·Atlas 렌더러는 이 파일을 읽지도 덮지도 않는다.
- Core `readBoard` / `placeOnBoard`는 P4. 이동·연결·제거는 P7. 보드 위 선은 실행이 아니다.
- item `id` freeze: `langgraph:{assistantId}:{nodeId}`, `neo4j:{label.lower}:{path}`, `port:{portId}`. `ref`는 langgraph `{assistantId}:{nodeId}`, neo4j는 경로, port는 PortId.

### 2.2 소유권 (반복)

| 파일 | 덮는 주체 |
| --- | --- |
| inferred.json, ATLAS*, FLOW.md | scan만 |
| overlay.yaml | 사람, 그리고 `patch`의 wire append |
| progress.yaml / PROGRESS.md / progress.md | `progress write`만 |
| board.yaml | 콘솔 드래그 종료, `place_on_board` |
| `skills/<slug>/` | `skill accept`, 번들 seed. 있는 패키지는 안 덮음 |
| `skills/<slug>.proposed/` | `skill distill`. 확정본을 안 덮음 |
| studio.yaml | init / project add·new |

동시 쓰기: last-write-wins. 병합 없음.

---

## 3. HTTP (작업장 프로세스)

베이스 `http://127.0.0.1:<port>`.

| 방법 | 경로 | 언제 | 본문 |
| --- | --- | --- | --- |
| GET | `/api/shell` | P1 | 아래 |
| GET | `/api/project?alias=` | P2 | Core `computeAtlasSections` + `progress`. 아래 3.1a |
| GET | `/api/graph` | 기존 | `{ alias, graph }` Core `computeFlowGraph`. 콘솔 흐름 탭의 LangGraph가 아님 |
| GET | `/api/events` | P3 | SSE |
| GET | `/api/flow` | P5 | LangGraph 뷰. 아래 3.1b |
| POST | `/api/flow/runs` | P5 | Run을 LangGraph URL로 위임. 아래 3.1b |
| GET | `/api/knowledge` | P6 | Neo4j 복제 검색. 아래 3.1c |
| GET | `/api/board` | P7 | `board.yaml` 뷰. 아래 3.1d |
| POST | `/api/board/place` | P7 | 항목 추가. 아래 3.1d |
| POST | `/api/board/move` | P7 | 좌표. 아래 3.1d |
| POST | `/api/board/link` | P7 | 배치 연결 표시. 실행 아님 |
| POST | `/api/board/unlink` | P7 | 연결 제거 |
| POST | `/api/board/remove` | P7 | 항목과 걸린 링크 제거 |
| POST | `/api/skill/drafts` | P8 | 보드 → SKILL.md 초안. 아래 3.1e |
| POST | `/api/skill/accept` | P8 | 초안 확정. 실행 아님 |

### 3.1 `GET /api/shell`

```json
{
  "studioName": "string",
  "projects": [{ "alias": "demo" }],
  "selected": "demo",
  "adapters": {
    "langgraph": "disconnected",
    "neo4j": "disconnected"
  }
}
```

- `selected`는 쿼리/환경으로 고른 alias. 목록에 없거나 목록이 비면 `null`.
- P1에서 `adapters.*`는 항상 `"disconnected"`. P5부터 `langgraph`를 프로브한다. P6부터 `neo4j`를 프로브한다.
- 상태 값 집합: `"connected" | "disconnected"`만.
- 프로브는 각각 800ms. 실패·타임아웃은 `"disconnected"`. `/api/shell`이 예외로 죽지 않는다.

### 3.1a `GET /api/project?alias=<alias>` (P2)

- `alias` 없음 → 400. 미등록 → 404.
- 등록됐으나 `inferred.json` 없음 → `{ "status": "unscanned", "alias", "path" }`.
- 그 외 `{ "status": "ok", sections, counts, progress, currentLine, clarity, git }`.
- `sections`/`counts`는 Core `computeAtlasSections` / `computeAtlasCounts`와 같다. React가 포트를 다시 분류하지 않는다.
- `clarity`는 등록 경로가 있으면 `computeClarityScore`로 다시 계산한다. 경로가 없으면 `null`. 등록 당시 점수를 저장하지 않는다.
- `currentLine`은 Core `renderProgressLevel1`과 같다.

### 3.1b `GET /api/flow` · `POST /api/flow/runs` (P5)

- `GET /api/flow?assistant=&thread=` — LangGraph 런타임 뷰. 스캔 그래프 `/api/graph`가 아님.
- 미연결: `{ "status": "disconnected", "url": "<PATCHBAY_LANGGRAPH_URL 또는 기본>" }`. HTTP 200. 셸을 막지 않음.
- 연결: `{ "status": "connected", assistants, selectedAssistantId, graph, threads, selectedThreadId, currentNodes, checkpoint, original, summary, run, empty, warning }`.
- `empty`: `none` | `no_assistants` | `no_nodes`.
- `POST /api/flow/runs` 본문 `{ assistantId, threadId?, input? }`. `threadId` 없으면 LangGraph에 스레드를 만든 뒤 `POST /threads/{id}/runs/wait`로 위임.
- 미연결 POST → 503 `{ "error": "LangGraph 연결 안 됨" }`. `assistantId` 없음 → 400.
- 테스트에서 `createFlowApp`에 `langgraph`를 안 넘기면 프로브하지 않고 항상 disconnected. `serve.ts`는 URL을 넘긴다.

### 3.1c `GET /api/knowledge?alias=&q=&path=` (P6)

- `alias` 없음 → 400. 미등록 → 404.
- 미연결: `{ "status": "disconnected", "uri", "alias" }`. HTTP 200. 셸을 막지 않음.
- 등록됐으나 `inferred.json` 없음 → `{ "status": "unscanned", "uri", "alias", "path" }`.
- 연결: inferred+overlay를 alias 단위로 스냅샷 교체한 뒤 `{ status, uri, alias, query, selected, hits, neighbors, edges, counts, warning }`.
- 검색은 경로·이름·port의 부분 문자열(대소문자 무시). 임베딩 없음. hits 상한 40.
- `path`가 있으면 그 노드와 CONTAINS/REFERENCES 이웃.
- 테스트에서 `createFlowApp`에 `neo4j`를 안 넘기면 프로브하지 않음. `serve.ts`는 URI/user/password를 넘긴다. 떠 있는 콘솔은 `inferred`/`overlay` SSE 때 같은 alias를 다시 인제스트한다.

### 3.1d `GET /api/board` · `POST /api/board/*` (P7)

- `GET /api/board?alias=` — `alias` 없음 → 400. 미등록 → 404. 없는 파일은 `{ alias, items: [], links: [] }`.
- `POST /api/board/place` `{ alias, id, kind, ref, title, x?, y? }`. 같은 id → 200 `{ placed: false, reason: "already_on_board" }`, 파일 미갱신.
- 콘솔이 `x`/`y`를 생략하면 기존 항목 수 격자 `(n % 4) * 220`, `floor(n / 4) * 100`. Core/`place_on_board` MCP 생략은 0.
- `POST /api/board/move` `{ alias, id, x, y }`. 좌표는 반올림 정수. 없는 id → 404. 같은 좌표 → 200, 파일 미갱신.
- `POST /api/board/link` `{ alias, from, to }`. 양쪽이 보드에 있어야 함. self·없는 끝 → 400. 같은 `(from, to)` → 200 no-op.
- `POST /api/board/unlink` `{ alias, from, to }`. 없으면 200 `{ unlinked: false }`.
- `POST /api/board/remove` `{ alias, id }`. 그 id를 끝으로 하는 링크도 지운다. 없으면 200 `{ removed: false }`.
- 보드에서 LangGraph invoke·Neo4j 검색을 하지 않는다. 쓰기 MCP는 여전히 `place_on_board`만.

### 3.1e `POST /api/skill/drafts` · `POST /api/skill/accept` (P8)

- `POST /api/skill/drafts` `{ alias, slug?, itemIds? }`. 보드 항목이 없으면 400. 미등록 alias 404.
- 초안 경로 `<studioHome>/skills/<slug>.proposed/SKILL.md`. 확정본 `skills/<slug>/`를 덮지 않는다. 같은 초안은 last-write-wins.
- `slug` 생략이면 `from-<alias>` (Bay slug `[a-z0-9][a-z0-9-]*`).
- 내용은 보드 항목·연결의 결정적 템플릿. 커널이 LLM을 호출하지 않고 스킬을 실행하지 않는다.
- `POST /api/skill/accept` `{ slug }`. `skills/<slug>.proposed`를 `skills/<slug>`로 옮긴다. 초안 없음 404. 확정본이 있으면 400, 덮지 않음.
- `patchbay patch <slug> <project>`는 확정본만 설치한다. 쓰기 MCP에 distill을 넣지 않는다.

### 3.2 SSE `/api/events` (P3)

- `Content-Type: text/event-stream`
- 이벤트 이름 네 개만: `progress`, `inferred`, `overlay`, `board`
- `data`: `{"alias":"<project alias>"}` 한 줄 JSON. 화면은 이 페이로드로 채우지 않고, 고른 alias와 같으면 `GET /api/project`를 다시 부른다
- 감시 경로: `projects/<alias>/` 바로 아래의 `progress.yaml`, `inferred.json`, `overlay.yaml`, `board.yaml`만. add/change/unlink 모두 같은 이벤트 이름
- `PROGRESS.md`와 스튜디오 롤업 `progress.md`는 밀지 않는다
- keep-alive는 SSE 주석 `: keepalive` (15초). 다섯 번째 이벤트 이름이 아니다
- `patchbay flow` 프로세스 안에서만 (`createFlowApp({ watch: true })`). 테스트 기본은 `watch: false`. `close()`와 프로세스 종료와 함께 워치 종료
- 구현 라이브러리: **chokidar** (`ignoreInitial`, `awaitWriteFinish`). 푸시: **SSE** (WebSocket 아님). 클라이언트는 `EventSource`
- 재전송 버퍼 없음. 구독 전에 바뀐 파일은 초기 `GET /api/project`가 담당

---

## 4. 어댑터

### 4.1 LangGraph (P5)

| 키 | 값 |
| --- | --- |
| 런타임 | 로컬 `langgraph dev` HTTP |
| 환경변수 | `PATCHBAY_LANGGRAPH_URL` |
| 기본 URL | `http://127.0.0.1:2024` |
| 프로브 | `POST /assistants/search` `{limit:1}`, 800ms. 2xx만 `connected` |
| 그래프 | `GET /assistants/{id}/graph` |
| 스레드 | `POST /threads/search`. 현재 노드 `state.next`. 체크포인트 `state.checkpoint` |
| Run | `POST /threads/{id}/runs/wait` (없으면 `POST .../runs`). 타임아웃 20s |
| Patchbay가 하는 일 | 그래프/스레드/현재 노드/체크포인트 조회. Run 요청은 이 URL로 위임 |
| Patchbay가 안 하는 일 | 노드 함수 실행, 자체 DSL, 스케줄러, Vite에 SDK를 넣기 |
| 원문 필드 | `original` → `source_text` → `raw`. 없으면 패널 비움 |
| 정리본 필드 | `summary` → `digest` → `compressed`. 없으면 패널 비움 |
| 미연결 | 흐름 탭에 “LangGraph 연결 안 됨”. 셸을 막지 않음 |

채팅 트랜스크립트 자동 수집 없음. SDK HTTP 경로만 쓰고 `@langchain/langgraph-sdk`는 서버에도 넣지 않는다.

### 4.2 Neo4j (P6)

| 키 | 값 |
| --- | --- |
| 환경변수 | `PATCHBAY_NEO4J_URI`, `PATCHBAY_NEO4J_USER`, `PATCHBAY_NEO4J_PASSWORD` |
| 기본 URI | `bolt://127.0.0.1:7687` |
| 기본 user | `neo4j` |
| 기본 password | `patchbay` (compose `NEO4J_AUTH`와 같음) |
| 기동 | `dev/docker-compose.yml` |
| 프로브 | Bolt `verifyConnectivity`, 800ms |
| 노드 라벨 | `Knowledge` + `File`/`Folder`/`Skill`/`Artifact` |
| 관계 | `CONTAINS`, `REFERENCES` |
| 식별 | `(alias, path)` POSIX. PortId가 있으면 `port` |
| 슬러그 경로 | 파일 ref가 아닌 skill/artifact는 `.<kind>/<slug>` |
| 검색 | 경로·이름·port CONTAINS. 상한 40. 임베딩 없음 |
| 재스캔 | alias 스냅샷 교체(DETACH DELETE 후 재작성). 삭제된 경로 제거 |
| 미연결 | 지식 탭에 “Neo4j 연결 안 됨”. 셸을 막지 않음 |

Vite 번들에 `neo4j-driver`를 넣지 않는다. 인제스트 입력은 inferred+overlay뿐이며 전체 워크스페이스 walk가 아니다.

---

## 5. MCP

읽기 (유지): `list_projects`, `get_atlas`, `get_graph`, `get_project_bundle`, `get_progress`.

쓰기 (P4):

| 이름 | 하는 일 | 파일 |
| --- | --- | --- |
| `progress_write` | Core `recordProgressWrite`. CLI `progress write`와 동일 | progress.yaml, PROGRESS.md, 스튜디오 progress.md |
| `place_on_board` | Core `placeOnBoard`. 이미 같은 id면 no-op, 파일 미갱신 | board.yaml |

확정 `overlay.yaml`을 MCP가 덮지 않는다. overlay 제안이 필요하면 이후 `overlay_propose` → `*.proposed.yaml`. P4 완료 조건에 넣지 않는다.

쓰기 후 화면 갱신은 파일이 바뀌고 SSE가 구독하는 경로만. MCP가 소켓을 직접 밀지 않는다.

---

## 6. 채택값 (이 절이 이긴다)

1. 탭 id: `project` `flow` `knowledge` `board`
2. 기본 포트 4317
3. SSE 이벤트: `progress` `inferred` `overlay` `board`
4. 워치: chokidar, 작업장 프로세스 한정
5. LangGraph URL 기본 `http://127.0.0.1:2024`
6. Neo4j URI 기본 `bolt://127.0.0.1:7687`
7. `board.yaml` kind: `langgraph` `neo4j` `port`
8. 어댑터 상태: `connected` `disconnected`
9. 쓰기 MCP v1: `progress_write`, `place_on_board`
10. last-write-wins
11. 벡터 DB 없음
13. Neo4j 기본 password `patchbay`. 지식 검색 상한 40
14. 보드 item id: `langgraph:{assistantId}:{nodeId}`, `neo4j:{label.lower}:{path}`, `port:{portId}`
15. 콘솔 place 생략 좌표 격자 220×100, 4열. Core/MCP 생략은 0
16. 보드 링크는 배치 표시. invoke/검색 아님
17. 스킬 초안 `skills/<slug>.proposed/SKILL.md`. 확정은 `skill accept`
18. 수확은 보드의 결정적 템플릿. 커널이 스킬을 실행하지 않음
19. 번들 스킬은 init/patch 때 Bay에 복사. 있는 패키지는 안 덮음

---

## 7. 자가 점검

- [ ] 프롬프트 쓰기의 결과가 떠 있는 화면에 없으면 미완
- [ ] 커널이 LLM을 호출하지 않음
- [ ] 확정 overlay/board를 확인 없이 스캔이 덮지 않음
- [ ] React가 Core와 다른 포트 그래프를 계산하지 않음
- [ ] 흐름 탭이 LangGraph 없이 자작 런타임으로 노드를 돌리지 않음
- [ ] 지식 탭이 임베딩을 요구하지 않음
- [ ] `patchbay flow`가 꺼진 뒤 워치가 남지 않음
- [ ] `/api/graph`(스캔 그래프)를 흐름 탭의 LangGraph인 척하지 않음

---

## 8. P1 완료 (이번 코드)

- [ ] 왼쪽 200px, 탭 4개, 어댑터 두 줄이 항상 `disconnected`로 보임
- [ ] 탭을 누르면 오른쪽이 바뀜
- [ ] 프로젝트 0개면 빈 상태
- [ ] `GET /api/shell`이 명세 3.1을 만족
- [ ] `patchbay flow`가 이 셸을 기동

---

## 9. P3 완료 (이번 코드)

- [ ] `GET /api/events`가 `text/event-stream`이고 이벤트 이름은 네 개뿐
- [ ] `progress write`가 `progress` SSE를 민다 (`{"alias"}`만)
- [ ] 떠 있는 콘솔 프로젝트 탭이 새로고침 없이 `currentLine`을 다시 읽는다
- [ ] `app.close()` / 프로세스 종료 후 워치가 남지 않는다

---

## 10. P4 완료 (이번 코드)

- [ ] `progress_write`가 CLI `progress write`와 같은 Core 함수를 쓴다
- [ ] `place_on_board`가 `board.yaml`에 item을 넣고, 같은 id는 파일을 건드리지 않는다
- [ ] MCP가 소켓을 직접 밀지 않는다. 떠 있는 콘솔은 파일 SSE로만 갱신된다

---

## 11. P5 완료 (이번 코드)

- [ ] `GET /api/shell`의 `adapters.langgraph`가 프로브 결과에 따라 `connected`/`disconnected`
- [ ] 흐름 탭이 LangGraph 없이 자작 런타임으로 노드를 돌리지 않음
- [ ] `/api/graph`(스캔 그래프)를 흐름 탭의 LangGraph인 척하지 않음
- [ ] 미연결이면 “LangGraph 연결 안 됨”이고 셸은 살아 있음
- [ ] 연결 시 xyflow에 그래프, `state.next`가 현재 노드, 원문/정리본은 매핑 키만
- [ ] `POST /api/flow/runs`가 LangGraph `runs/wait`로만 위임됨

---

## 12. P6 완료 (이번 코드)

- [ ] `GET /api/shell`의 `adapters.neo4j`가 프로브 결과에 따라 `connected`/`disconnected`
- [ ] 지식 탭이 임베딩을 요구하지 않음. 검색은 경로·이름 CONTAINS
- [ ] 미연결이면 “Neo4j 연결 안 됨”이고 셸은 살아 있음
- [ ] inferred 스냅샷이 alias로 가리고, 재인제스트 때 사라진 경로가 없다
- [ ] `dev/docker-compose.yml`이 `neo4j/patchbay`로 Bolt 7687을 연다
- [ ] Vite 번들에 `neo4j-driver`가 없다

---

## 13. P7 완료 (이번 코드)

- [ ] 흐름에서 고른 노드와 지식에서 고른 파일이 같은 캔버스에 공존한다
- [ ] 드래그 종료 좌표가 `board.yaml`에 정수로 남고, 다시 열어도 자리가 같다
- [ ] 보드 위 선은 실행이 아니다. Run 버튼이 없다
- [ ] 같은 id로 다시 올리면 파일을 쓰지 않는다
- [ ] 항목 제거 시 걸린 링크도 사라진다
- [ ] 쓰기 MCP는 `place_on_board`만. 보드에서 그래프 invoke를 하지 않는다

---

## 14. P8 완료 (이번 코드)

- [x] 보드 구간이 `skills/<slug>.proposed/SKILL.md` 초안이 된다. 커널이 스킬을 실행하지 않는다
- [x] `skill accept`가 확정본을 만들고, 이미 있는 확정본은 덮지 않는다
- [x] `patchbay patch`가 확정본을 프로젝트에 설치한다
- [x] map-project / adopt-project / triage-project SKILL.md 규약이 회귀한다
- [x] 워커 세션을 원격으로 켜는 문구·코드가 없다
