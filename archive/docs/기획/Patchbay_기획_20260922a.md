# Patchbay 기획서

| 항목 | 값 |
| --- | --- |
| 문서명 | Patchbay_기획 |
| 버전 | 20260922a |
| 이전 버전 | `docs/_archive/기획/Patchbay_기획_20260918a.md` |
| 상태 | P0 계약. 커널은 `dev/`에 있다 |
| 독자 | 구현하는 사람 또는 LLM |
| 구현계획 | `docs/구현계획/Patchbay_구현계획_20260917a.md` |
| 명세 | `docs/명세/Patchbay_명세_20260918a.md` |

채팅 이력 없이 읽을 수 있는 제품 경계다. 기계적 채택값은 명세에 둔다.

---

## 1. 한 줄 정의

**Patchbay는 LLM 프로젝트의 localhost 통합 관리 UI다.** 프로젝트 구조는 자체 커널이 읽고, 흐름 실행은 LangGraph가, 파일 지식 검색은 Neo4j가 맡는다. Patchbay는 그 셋을 한 화면에서 고르고 배치한다.

조작 면은 Cursor · Claude Code · 터미널이다. React는 작업 화면이다. 채팅 IDE를 대체하지 않는다. 프롬프트에서 한 일의 결과는 채팅에만 묻히지 않고 이 화면에 나타난다.

---

## 2. 네 탭

`patchbay flow`가 여는 셸. 왼쪽 약 200px 내비, 오른쪽이 현재 탭.

| 탭 | 하는 일 | 진실의 위치 |
| --- | --- | --- |
| 프로젝트 | 등록된 레포의 Atlas, overlay, progress | `@patchbay/core`가 쓰는 studio 파일 |
| 흐름 | 실행 그래프, 현재 노드, 원문/정리본 | **LangGraph** 런타임. Patchbay는 어댑터 |
| 지식 | 파일 그래프에서 찾고 이웃을 봄 | **Neo4j**. Patchbay는 인제스트·조회 어댑터 |
| 캔버스 | 흐름·지식에서 올린 항목의 자리 | `board.yaml`. 스캔이 덮지 않음 |

실행은 캔버스에서 하지 않는다. 검색 엔진을 캔버스에 다시 만들지 않는다.

---

## 3. 원칙

1. **호스트는 조작, React는 화면.** 호출 결과는 화면에 있어야 완료다.
2. **커널은 결정적이다.** 스캔·집계·파일 I/O는 LLM 없이 재현 가능하다.
3. **제안은 호스트 모델, 확정 파일은 확인 없이 덮지 않는다.** 초안은 `*.proposed.*`.
4. **파일이 소스 오브 트루스다.** 화면은 파일의 렌더다. SQLite/클라우드 DB를 기본값으로 두지 않는다. Neo4j는 지식 인덱스의 복제본이며, 재스캔으로 다시 채울 수 있어야 한다.
5. **CLI, MCP, React는 같은 Core 타입을 본다.** React만의 그래프 모델을 만들지 않는다.
6. **Patchbay는 실행 엔진이 아니다.** 그래프 invoke는 LangGraph다. 파일 검색 실행은 Neo4j다.
7. **이름 없는 잭은 부채다.** PortId와 Atlas는 유지한다.
8. **Patch와 Wire를 구분한다.** 매칭 키는 `(from, to, kind)`.
9. **정보는 레이어다.** L1/L2/L3는 결정적 집계다.
10. **워치는 `patchbay flow`가 떠 있는 동안만.** 부팅 자동 데몬 없음. 커널이 git으로 현재 작업을 추측하지 않는다. `patchbay bot start`도 같은 규칙을 따르는 수동 전경 프로세스다.
11. **삭제 대신 보관한다.**
12. **원문은 정리본에 삼켜지지 않는다.** 흐름의 한 단계는 둘 다 가진다.
13. **기존 산출물은 지식 그래프의 노드다.** 일회성 첨부로 끝나지 않는다.
14. **원격 명령 통로는 화이트리스트 1곳, 로컬 권한 그대로.** 텔레그램은 새 권한을 만들지 않는다 -- 오너가 로컬에서 가진 것과 같은 Cursor/Claude Code 실행 권한을 원격에서도 그대로 쓴다.

---

## 4. v1에서 하지 않는 것

- 자작 워크플로 엔진, n8n식 스케줄러, Patchbay 내부 그래프 DSL
- 벡터 임베딩 · 자작 GraphRAG
- LLM이 React 컴포넌트를 넣으면 런타임 UI가 생기는 플러그인
- 파일 매개 멀티에이전트 배정 (여러 에이전트에 작업을 나눠 맡기는 배정 시스템)
- 부팅 시 자동 워치 데몬
- Tauri · 멀티유저 SaaS · Cursor 채팅 대체
- 커널의 직접 모델 호출
- 채팅 트랜스크립트 자동 수집 (단계는 MCP 또는 LangGraph state로만)

`텔레그램 작업장`은 이 판부터 제외 목록에서 뺐다 -- 8절 어댑터의 원격 명령 통로로 범위를 좁혀 들어왔다. 이전에 있었던 읽기 전용 상태봇(Phase 11)과 달리, 이번 범위는 Cursor/Claude Code에 실제로 명령을 보내고 결과를 돌려받는 쓰기 경로를 포함한다 -- 그만큼 원칙 14의 제약을 반드시 지킨다.

---

## 5. 이미 있는 것 (다시 만들지 않음)

PortId, 결정적 스캐너, inferred/Atlas/overlay, progress, CLI(init, project add/new/triage, scan, atlas, patch, progress), MCP 읽기 5종, `apps/flow` 시드(Hono+Vite+xyflow).

---

## 6. 사용자 루프

1. `patchbay project add`로 레포를 등록하고 `scan`한다.
2. `patchbay flow`로 콘솔을 연다. 프로젝트 탭에서 Atlas를 본다.
3. LangGraph가 켜져 있으면 흐름 탭에서 현재 노드와 원문/정리본을 본다.
4. Neo4j가 채워져 있으면 지식 탭에서 파일을 찾는다.
5. 쓸 것을 캔버스에 올린다. 자리는 `board.yaml`에 남는다.
6. 호스트 프롬프트의 쓰기 MCP가 파일을 바꾸면, 떠 있는 콘솔이 따라간다.
7. 과정이 남길 만하면 스킬 초안이 된다. 확정은 사람이 한다.
8. 콘솔 앞이 아니어도, 화이트리스트된 텔레그램 챗에서 등록된 프로젝트에 명령을 보내고 결과를 받을 수 있다. `patchbay bot start`가 떠 있는 동안만.

---

## 7. 소유권

| 파일 | 소유 | 스캔 |
| --- | --- | --- |
| `studio.yaml` | 커널 (등록 CLI) | 안 덮음 |
| `inferred.json`, `ATLAS.md`, `FLOW.md`, `ATLAS.digest.md` | 커널 | 통째로 덮음 |
| `overlay.yaml` | 사람 | 안 덮음. `patch`만 와이어를 추가 |
| `progress.yaml`, `PROGRESS.md`, 스튜디오 `progress.md` | 커널 (`progress write`) | 안 덮음 |
| `board.yaml` | 사람+에이전트 (콘솔·MCP) | 안 덮음 |
| Neo4j 그래프 | 인제스트가 inferred를 복제 | 재스캔 시 머지 |
| LangGraph 체크포인트 | LangGraph | Patchbay가 쓰지 않음 |

이중 기록은 last-write-wins. 커널이 병합하지 않는다.

---

## 8. 어댑터

- **LangGraph.** 기본 런타임은 로컬 `langgraph dev` HTTP. Patchbay는 목록·스레드·현재 노드·체크포인트를 읽고, 실행을 요청할 때도 LangGraph API로만 위임한다.
- **Neo4j.** 로컬 Bolt. v1 라벨은 File/Folder/Skill/Artifact, 관계는 CONTAINS/REFERENCES. 임베딩 없음.
- **SSE.** 작업장 프로세스 안에서만. 이벤트 이름 `progress` · `inferred` · `overlay` · `board`.
- **쓰기 MCP.** `progress_write`, `place_on_board`. 확정 overlay는 쓰지 않는다.
- **Telegram.** `patchbay bot start`로 수동 실행하는 전경 프로세스 -- 부팅 데몬 아님(원칙 10). 화이트리스트된 오너 챗 1곳에서만 응답한다. 메시지는 Cursor 또는 Claude Code의 헤드리스 호출로 그대로 위임하고, 그 표준출력을 되돌려준다. Patchbay가 별도로 권한을 넓히거나 좁히지 않는다(원칙 14) -- 호스트가 로컬에서 갖는 툴 권한이 원격 호출에도 그대로 적용된다.

채택값은 명세 6절이 이긴다.
