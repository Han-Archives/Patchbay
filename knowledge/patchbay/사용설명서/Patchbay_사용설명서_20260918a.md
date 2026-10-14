# Patchbay 사용 설명서

| 항목 | 값 |
| --- | --- |
| 문서명 | Patchbay_사용설명서 |
| 버전 | 20260918a |
| 상태 | P0–P8 기준 실사용 안내. P9(단절·빈 상태·왕복 마감)는 아직 제품 단계로 끝나지 않음 |
| 독자 | Patchbay를 자기 머신에서 쓰는 사람 |
| 기획 | `archive/docs/기획/Patchbay_기획_20260918a.md` |
| 명세 | `knowledge/patchbay/명세/Patchbay_명세_20260918a.md` |

이 문서는 **지금 코드가 하는 일**을 기준으로 쓴다. 구현자용 계약은 기획·명세를 본다. 터미널이 처음이면 명령 치트시트보다 `knowledge/patchbay/사용설명서/Patchbay_세부매뉴얼_20260918a.md` 를 먼저 본다.

---

## 목차

1. [Patchbay가 뭔가](#1-patchbay가-뭔가)
2. [세 면과 한 화면](#2-세-면과-한-화면)
3. [준비](#3-준비)
4. [실행 명령어](#4-실행-명령어)
5. [처음 한 시간](#5-처음-한-시간)
6. [스튜디오 홈과 파일](#6-스튜디오-홈과-파일)
7. [프로젝트를 들이는 세 길](#7-프로젝트를-들이는-세-길)
8. [콘솔 네 탭](#8-콘솔-네-탭)
9. [CLI](#9-cli)
10. [MCP](#10-mcp)
11. [스킬과 Skill Bay](#11-스킬과-skill-bay)
12. [LangGraph · Neo4j](#12-langgraph--neo4j)
13. [환경변수](#13-환경변수)
14. [PortId · Atlas · overlay](#14-portid--atlas--overlay)
15. [문제 해결](#15-문제-해결)
16. [하지 않는 것](#16-하지-않는-것)

---

## 1. Patchbay가 뭔가

**Patchbay는 LLM 프로젝트의 localhost 통합 관리 UI다.**

프로젝트 구조는 Patchbay 커널이 읽고, 흐름 실행은 LangGraph가, 파일 지식 검색은 Neo4j가 맡는다. Patchbay는 그 셋을 **한 화면에서 고르고 배치**한다.

조작은 Cursor · Claude Code · 터미널에서 한다. React 콘솔은 작업 화면이다. 채팅 IDE를 대체하지 않는다. 프롬프트에서 한 일의 결과는 채팅에만 묻히지 않고, 떠 있는 콘솔에 나타나야 완료다.

한 문장으로 경계를 고정하면:

| 역할 | 누가 |
| --- | --- |
| 등록 · 스캔 · Atlas · progress · 보드 자리 · 스킬 초안 | Patchbay 커널 |
| 그래프 노드 실행, 스레드, 체크포인트 | 로컬 LangGraph |
| 파일 그래프 검색 | 로컬 Neo4j |
| 스킬을 **읽고 따르는 것** | 호스트 모델 (Cursor/Claude Code). 커널은 스킬을 실행하지 않는다 |

---

## 2. 세 면과 한 화면

같은 스튜디오 파일(`~/.patchbay` 또는 `PATCHBAY_HOME`)을 세 면이 본다.

| 면 | 진입 | 하는 일 |
| --- | --- | --- |
| CLI | `patchbay …` | 등록, 스캔, 조회, progress 기록, 스킬 설치·수확 |
| 콘솔 | `patchbay flow` → 브라우저 | 프로젝트 / 흐름 / 지식 / 캔버스 |
| MCP | Cursor 등에서 stdio 서버 | 읽기 5종 + 쓰기 2종. 화면을 직접 밀지 않는다 |

콘솔이 떠 있는 동안만 파일이 바뀌면 화면이 따라간다. 부팅 자동 데몬은 없다. `Ctrl+C`로 콘솔을 끄면 감시(워치)도 같이 끝난다.

쓰기 MCP는 `progress_write`와 `place_on_board`뿐이다. 확정 `overlay.yaml`을 MCP가 덮지 않는다. 스킬 수확 MCP도 없다.

---

## 3. 준비

### 3.1 필요 환경

- **Node.js 22 이상**, **pnpm 9 이상**
- 코드는 저장소의 `app/`에 있다. npm으로 배포된 전역 `patchbay` 패키지는 없다
- 지식 탭을 쓰려면 **Docker** (로컬 Neo4j)
- 흐름 탭을 쓰려면 대상 그래프 레포에서 **`langgraph dev`** (기본 `http://127.0.0.1:2024`)

Neo4j와 LangGraph 없이 콘솔은 열린다. 해당 탭만 “연결 안 됨”이고 셸은 막히지 않는다.

### 3.2 빌드

저장소 루트가 아니라 **`app/`**에서 한다.

```bash
cd /path/to/Patchbay/app
pnpm install
pnpm build
pnpm --filter @patchbay/flow build
```

- `pnpm build` — Core · CLI · MCP
- `pnpm --filter @patchbay/flow build` — 콘솔 서버와 브라우저 번들. 이 단계가 없으면 `patchbay flow`가 실패한다

복붙 치트시트는 [4절](#4-실행-명령어).

이후 설명의 `patchbay`는 다음을 가리킨다.

```bash
node /path/to/Patchbay/app/packages/cli/dist/index.js
```

셸에 올려 두면 편하다.

```bash
alias patchbay='node /path/to/Patchbay/app/packages/cli/dist/index.js'
```

도움말:

```bash
patchbay --help
patchbay project --help
patchbay skill --help
patchbay progress --help
```

CLI는 **프롬프트를 열지 않는다.** 빠진 인자는 바로 exit 1이다. `--json`을 주면 기계가 읽기 쉬운 한 줄이다.

### 3.3 스튜디오 위치

| 조건 | 경로 |
| --- | --- |
| `PATCHBAY_HOME`이 비어 있지 않음 | 그 값 |
| 그 외 | `~/.patchbay` |

**CLI · MCP · 콘솔이 같은 `PATCHBAY_HOME`을 봐야 같은 스튜디오다.** 한쪽만 다른 경로를 쓰면 “등록된 프로젝트가 없습니다”처럼 보인다.

개발 검증용으로 임시 홈을 쓸 수 있다.

```bash
export PATCHBAY_HOME=/tmp/my-studio
```

실제 작업은 기본 `~/.patchbay`를 권한다.

---

## 4. 실행 명령어

복사해서 쓰는 치트시트다. 작업 디렉터리는 저장소 루트가 아니라 **`app/`**다. Node 22, pnpm 9.

이 머신 기준 예:

```bash
ROOT=/path/to/Patchbay/dev
PB="node $ROOT/packages/cli/dist/index.js"
```

다른 클론이면 `ROOT`만 그 `app/` 경로로 바꾼다. 이후 `$PB`가 `patchbay`다.

### 4.1 처음 한 번 (빌드)

```bash
cd "$ROOT"
pnpm install
pnpm build
pnpm --filter @patchbay/flow build
```

- `pnpm build` — Core · CLI · MCP
- `pnpm --filter @patchbay/flow build` — 콘솔 서버와 브라우저 번들. 없으면 `$PB flow`가 실패한다

### 4.2 콘솔 (메인)

스튜디오가 아직 없으면:

```bash
cd "$ROOT"
$PB init --name "내 스튜디오"
$PB project add --path /절대경로/레포 --alias demo
$PB flow --project demo
```

기본 주소 `http://127.0.0.1:4317`. 종료는 `Ctrl+C`.

이미 빌드·등록이 끝났으면 콘솔만 다시 켠다.

```bash
cd "$ROOT"
$PB flow --project demo --port 4317
```

포트가 쓰이면 `--port 4318`처럼 다른 값을 준다.

### 4.3 선택 사이드카

없어도 콘솔은 열린다. 해당 탭만 “연결 안 됨”이다.

지식 탭 (Neo4j):

```bash
cd "$ROOT"
docker compose up -d
```

흐름 탭 (LangGraph): 그래프가 있는 레포에서 `langgraph dev`. 기본 `http://127.0.0.1:2024`.

끄기:

```bash
cd "$ROOT"
docker compose down
```

### 4.4 자주 쓰는 CLI

```bash
$PB scan --project demo
$PB atlas --project demo
$PB progress write --project demo --summary "지금 하는 일"
$PB skill distill --project demo
$PB skill accept from-demo
$PB patch map-project demo
```

도움말: `$PB --help`, `$PB project --help`, `$PB skill --help`, `$PB progress --help`.

### 4.5 MCP

Cursor 등에서 stdio로 붙인다. CLI·콘솔과 **같은** `PATCHBAY_HOME`을 넣는다.

```text
node /path/to/Patchbay/app/packages/mcp/dist/index.js
```

`~/.cursor/mcp.json` 예는 [10.1절](#101-cursor에-붙이기).

스튜디오 위치는 `PATCHBAY_HOME`이 있으면 그 경로, 없으면 `~/.patchbay`. CLI·콘솔·MCP가 같은 값을 봐야 한다.

---

## 5. 처음 한 시간

명령 복붙은 [4절](#4-실행-명령어). 이미 문서와 git이 있는 레포를 들이는 경로(가장 흔함).

```bash
# 1. 스튜디오 만들기. 이름 생략이면 머신 호스트명.
patchbay init --name "내 스튜디오"

# 2. 레포 등록 + 첫 스캔. alias 생략이면 폴더 이름.
patchbay project add --path /absolute/path/to/repo --alias demo

# 3. 지도 확인 (기본은 ATLAS.md 전문)
patchbay atlas --project demo

# 4. 지금 하는 일 기록
patchbay progress write --project demo --summary "첫 등록 직후, Atlas 확인"

# 5. 콘솔. 기본 포트 4317. 브라우저가 열린다.
patchbay flow --project demo
```

브라우저에서 **프로젝트** 탭이 먼저 열린다. 경로, 현재 작업, Atlas(라벨 없는 잭 / 패치된 스킬 / 패치 없는 와이어 / clarity)가 보인다.

파일이 바뀌면 새로고침 없이 따라가게 하려면 **콘솔을 켠 채로** 다른 터미널에서 `progress write`를 다시 실행해 보면 된다.

---

## 6. 스튜디오 홈과 파일

기본 트리 (`PATCHBAY_HOME` 또는 `~/.patchbay`):

```
studio.yaml                          # 스튜디오 이름, 등록된 프로젝트 목록
progress.md                          # 전 프로젝트 롤업. progress write가 재생성
projects/<alias>/
  overlay.yaml                       # 사람. 스캔이 안 덮음. patch만 wire를 추가
  inferred.json                      # 스캔이 통째로 덮음
  ATLAS.md
  ATLAS.digest.md
  FLOW.md                            # 스캔 그래프(Mermaid 등). 흐름 탭의 LangGraph가 아님
  progress.yaml                      # progress write만
  PROGRESS.md
  board.yaml                         # 캔버스 자리. 스캔 금지
skills/<slug>/SKILL.md               # 확정 Skill Bay
skills/<slug>.proposed/SKILL.md      # 수확 초안. 확정은 skill accept
```

대상 프로젝트 레포 안에는 Atlas를 쓰지 않는다. 워크스페이스가 프로젝트만 열려 있으면 스튜디오 파일은 파일 트리에 없다. `~/.patchbay`(또는 `PATCHBAY_HOME`)를 열어야 보인다.

### 6.1 누가 덮는가

| 파일 | 덮는 주체 | 스캔 |
| --- | --- | --- |
| `inferred.json`, `ATLAS*`, `FLOW.md` | `scan` / `project add`의 첫 스캔 | 통째로 덮음 |
| `overlay.yaml` | 사람, 그리고 `patch`의 wire 추가 | 안 덮음 |
| `progress.yaml`, `PROGRESS.md`, 스튜디오 `progress.md` | `progress write` / MCP `progress_write` | 안 덮음 |
| `board.yaml` | 콘솔 드래그·연결·제거, MCP `place_on_board` | 안 덮음 |
| `skills/<slug>/` | `skill accept`, 번들 seed | 있는 패키지는 안 덮음 |
| `skills/<slug>.proposed/` | `skill distill` / 캔버스 「스킬 초안으로」 | 확정본을 안 덮음 |
| `studio.yaml` | `init`, `project add`, `project new` | — |

동시에 쓰면 **last-write-wins**. 커널이 병합하지 않는다.

### 6.2 스캔이 보는 것 / 건너뛰는 것

스캔은 결정적이다. LLM을 부르지 않는다.

**발견하는 포트**

- 신호 파일 → `source:<상대경로>`  
  `README.*`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`(파일) 또는 `.cursor/rules/*.md` · `*.mdc`(한 단계만)
- `SKILL.md` → `skill:<상대경로>`  
  부모 폴더 이름이 Skill Bay slug와 같으면 `skill:<slug>`

**디렉터리 이름만 보고 통째로 건너뜀** (어느 깊이나):  
`node_modules`, `.git`, `dist`, `build`, `out`, `.next`, `coverage`, `.turbo`, `.cache`, `venv`, `.venv`, `__pycache__`, `target`, `vendor`, `.pnpm-store`, `Pods`, `.output`, `__fixtures__`, `__mocks__`, `__snapshots__`

git 최근 커밋 제목은 **20개**로 자른다. 스캔 결과는 POSIX 상대경로 정렬이라 같은 트리는 같은 `inferred.json`이 된다.

---

## 7. 프로젝트를 들이는 세 길

### 7.1 이미 있는 레포 — `project add`

```bash
patchbay project add --path /abs/path [--alias <alias>] [--force-add]
```

등록과 동시에 스캔한다. overlay가 없으면 빈 파일을 만든다.

**clarity 게이트 (40).** 공식이 40 미만이면 등록하지 않고 **exit 2**다.

| 항 | 값 |
| --- | --- |
| README가 있으면 | +50 |
| 최근 커밋 제목의 고유 비율 | × 50 (커밋 0이면 0) |
| 파일명에 `_v2` / `_final` / `_backup` / ` copy` / `복사본` | 건당 −5, 합은 −30까지 |
| 결과 | 0–100으로 자름 |

거절되면 `project triage`로 폴더를 정리하거나, 사람이 내용을 이미 봤다면 `--force-add`로 등록한다.

alias가 이미 있으면 exit 1. 경로가 없거나 디렉터리가 아니면 exit 1.

### 7.2 빈 프로젝트 — `project new`

```bash
patchbay project new <alias> --path /abs/path
```

- 경로가 없으면 디렉터리를 만든다
- 이미 있고 **비어 있지 않으면** exit 1, 아무것도 안 씀
- 스튜디오에만 등록한다. **스캔하지 않는다** (아직 파일이 없다)
- 커널 쪽 설계 인터뷰는 없다. 인터뷰는 호스트가 `new-project` 스킬을 읽고 진행한다

등록 직후 프로젝트 탭은 “아직 스캔되지 않았습니다”이다. 문서가 생긴 뒤 `patchbay scan --project <alias>`를 돈다.

### 7.3 섞인 폴더 — `project triage`

```bash
patchbay project triage --path /abs/path
```

스튜디오에 **등록하지 않는다.** 대상 폴더 안에 `excavation.json`만 쓴다.

보고하는 신호 예: 파일 수, `_v2`류 중복명, 고아 후보, TODO/FIXME, git 유무와 커밋 반복도, 수정 시점 분포.

다음은 호스트가 `triage-project` 스킬을 읽고 사람과 정리한다. **삭제하지 않고** `_archive/YYYYMMDD/`로 옮긴다. 정리가 끝나면 반드시 `new-project` 또는 `adopt-project`로 이어간다. triage 혼자 끝나지 않는다.

---

## 8. 콘솔 네 탭

```bash
patchbay flow [--project <alias>] [--port 4317]
```

- 기본 주소 `http://127.0.0.1:4317`
- 포트가 쓰이면 다른 `--port`를 준다
- `--project`가 목록에 있으면 그 alias로 시작한다. 없거나 생략이면 목록의 첫 항목
- 프로세스는 포그라운드다. 데몬이 아니다
- 기동 시 번들 스킬을 Skill Bay에 **없는 slug만** 복사한다

레이아웃: 왼쪽 약 200px. 위부터 제목 `Patchbay`, 워크스페이스 `<select>`, 탭 네 개, 맨 아래 LangGraph / Neo4j 연결 두 줄 (`연결됨` 또는 `연결 안 됨`만).

등록된 프로젝트가 없으면 select는 비활성이고, 탭을 눌러도 “등록된 프로젝트가 없습니다”와 `patchbay project add --path <경로>` 안내가 우선한다.

### 8.1 프로젝트

커널이 쓰는 파일의 화면이다.

- 등록 경로, git 브랜치
- 숫자: 라벨 없는 잭, 패치된 스킬, 패치 없는 와이어, clarity (경로가 없으면 —)
- **현재 작업** — `progress.yaml`의 current. 히스토리는 최근 5줄
- Atlas 표 — 라벨 없음 / 패치됨 / 소스(신호 파일). 소스 행은 40개까지, 나머지는 `ATLAS.md`로 안내
- 갭 — overlay에 와이어는 있는데 짝 패치가 없는 연결. `patch`만 해도 여기에 자주 나타난다. 오류가 아니라 정상이다

스캔 전이면 `patchbay scan --project <alias>`를 안내한다.

다른 터미널의 `progress write`는 콘솔이 떠 있으면 **새로고침 없이** 현재 작업을 다시 읽는다.

### 8.2 흐름

**LangGraph 런타임의 화면이다.** 스캔이 만든 `FLOW.md` / `/api/graph`가 아니다.

연결 안 됨:

1. 그래프가 있는 레포에서 `langgraph dev`를 켠다 (기본 `http://127.0.0.1:2024`)
2. URL을 바꾸려면 콘솔을 끄고 `PATCHBAY_LANGGRAPH_URL`을 넣은 뒤 다시 `patchbay flow`
3. 「다시 연결」

연결되면:

- **그래프** select (assistant), **스레드** select
- **실행** — 아래 JSON 입력을 LangGraph `runs/wait`로 위임한다. Patchbay가 노드 함수를 돌리지 않는다. 타임아웃 약 20초. 입력이 JSON이 아니면 실행하지 않는다
- 캔버스는 조회용. 노드를 끌어 실행 그래프를 고치지 않는다
- 고른 노드의 「캔버스에 올리기」 — 작업 캔버스(`board.yaml`)로 복사. 실행이 아니다
- **원문 / 정리본** — 스레드 state. 키는 `original`→`source_text`→`raw`, `summary`→`digest`→`compressed`. 없으면 패널이 비어 있다. 채팅 트랜스크립트를 자동 수집하지 않는다
- 현재 노드 = LangGraph `state.next`. 체크포인트 id가 있으면 같이 표시

### 8.3 지식

**Neo4j에 복제한 파일 그래프 검색이다.** 임베딩·벡터 검색은 없다.

처음 한 번:

```bash
cd /path/to/Patchbay/app
docker compose up -d
```

- Bolt `bolt://127.0.0.1:7687`
- 계정 `neo4j` / 비밀번호 `patchbay` (`NEO4J_AUTH`와 같음)
- 브라우저 UI는 7474. Patchbay 지식 탭은 Bolt만 쓴다

콘솔을 켠 뒤 지식 탭에서 「다시 연결」. 연결되면 선택된 alias의 `inferred.json`+`overlay.yaml`을 Neo4j에 스냅샷으로 넣는다. 재스캔·overlay 변경 SSE가 오면 **같은 alias**를 다시 인제스트한다.

사용:

1. 경로·이름·port 일부로 「찾기」 (대소문자 무시, 최대 40건)
2. 행을 누르면 그 노드와 `CONTAINS` / `REFERENCES` 이웃
3. 「캔버스에 올리기」

라벨: File / Folder / Skill / Artifact. 식별은 `(alias, POSIX 경로)`.

스캔 전이면 지식 탭도 스캔을 안내한다. Docker가 꺼져 있으면 “Neo4j 연결 안 됨”이고 셸은 산다.

### 8.4 캔버스

흐름에서 올린 노드와 지식에서 올린 파일이 **같은 판**에 공존한다. 진실은 `projects/<alias>/board.yaml`.

- 항목을 끌어 놓으면 좌표가 정수 픽셀로 저장된다. 다시 열어도 자리다
- 핸들로 이으면 **표시용 선**이다. LangGraph 엣지도 Neo4j 관계도 아니다. 여기서 Run하지 않는다
- 「보드에서 제거」는 그 항목을 끝으로 하는 선도 지운다
- Backspace / Delete도 같다
- 같은 id를 다시 올리면 파일을 쓰지 않는다 (“이미 캔버스에 있습니다”)
- 콘솔이 좌표를 생략하고 올리면 격자 `(n % 4) * 220`, `floor(n / 4) * 100`

**스킬 수확** (보드에 항목이 하나라도 있을 때만 버튼이 보인다)

1. slug (기본 `from-<alias>`. 규칙 `[a-z0-9][a-z0-9-]*`)
2. 「스킬 초안으로」 → `skills/<slug>.proposed/SKILL.md`  
   커널이 LLM을 부르지 않는다. 보드 항목·연결의 템플릿이다. **실행하지 않는다**
3. 사람이 파일을 읽고 「초안 확정」 또는 `patchbay skill accept <slug>`
4. 확정본이 이미 있으면 덮지 않는다
5. 설치는 `patchbay patch <slug> <alias>`

빈 보드에서는 수확하지 않는다. notes처럼 올린 항목이 없으면 안내문만 있다.

화면 갱신: `board.yaml` · `progress.yaml` · `inferred.json` · `overlay.yaml`이 바뀔 때. `PROGRESS.md`와 스튜디오 `progress.md`는 밀지 않는다.

---

## 9. CLI

공통:

- 프로젝트 **여러 개**인데 `--project`를 빼면, `scan` / `atlas` / `flow`의 일부 도구는 실패한다 (`Multiple projects are registered`). 하나뿐이면 그 alias로 간다
- **예외:** `patchbay progress`에서 `--project`를 빼면 “유일한 프로젝트”가 아니라 **스튜디오 전체 롤업**이다
- 쓰는 명령(`patch`, `progress write`, `skill distill`/`accept`, `project add`/`new`)은 alias를 생략하지 않는 편이 안전하다. `patch`는 항상 `<project>` 인자가 필요하다

### 9.1 `init`

```bash
patchbay init [--name <이름>] [--json]
```

스튜디오 홈을 만들고(없으면 `git init`), `studio.yaml`에 이름을 쓴다. 두 번째 호출은 등록된 프로젝트를 지우지 않는다. 번들 스킬을 Bay에 없는 slug만 복사한다.

### 9.2 `project add` · `new` · `triage`

[7절](#7-프로젝트를-들이는-세-길).

### 9.3 `scan`

```bash
patchbay scan [--project <alias>] [--json]
```

등록된 경로를 다시 걸어 `inferred.json` / `ATLAS.md` / `ATLAS.digest.md` / `FLOW.md`를 다시 쓴다. **`overlay.yaml`은 건드리지 않는다.**

파일이 늘거나 줄면 이 명령을 다시 돈다. 떠 있는 콘솔의 프로젝트 탭·지식 탭(Neo4j가 붙어 있으면)이 따라간다.

### 9.4 `atlas`

```bash
patchbay atlas [--project <alias>] [--level 1|2|3]
```

표준출력으로만 찍는다. 기본 **레벨 2**.

| 레벨 | 내용 |
| --- | --- |
| 1 | `ATLAS.digest.md` (개수·상태) |
| 2 | `ATLAS.md` 전문 |
| 3 | `inferred.json` 원문 |

스캔 전이면 해당 파일이 없다고 하고 exit 1. `--level`이 1·2·3이 아니면 exit 1.

섹션 의미:

- **Skills** — 이미 패치된(설치된) 스킬
- **Rules** — 발견된 신호 파일
- **Unlabeled ports** — 발견됐지만 아직 사람이 안 붙인 잭. 부채
- **Gaps** — 패치는 있는데 와이어가 없거나, 와이어는 있는데 패치가 없는 것

### 9.5 `flow`

[8절](#8-콘솔-네-탭). `--port` 기본 4317.

### 9.6 `progress` · `progress write`

읽기:

```bash
patchbay progress                          # 스튜디오 progress.md 롤업
patchbay progress --project demo           # 그 프로젝트 L1 (한 줄)
patchbay progress --project demo --level 2 # PROGRESS.md
patchbay progress --project demo --level 3 # progress.yaml 원문
```

기록이 한 번도 없으면 exit 1.

쓰기:

```bash
patchbay progress write --project demo --summary "지금 하는 일" \
  [--skill <slug>] [--step <이름>] [--json]
```

한 호출이 `progress.yaml` + `PROGRESS.md` + 스튜디오 `progress.md`를 같이 다시 쓴다. `current`는 **인자 그대로**다. git 메시지로 추측하지 않는다. 이전 current는 history로 밀린다.

`--project` / `--summary` 없음, 또는 미등록 alias → exit 1.

### 9.7 `patch`

```bash
patchbay patch <slug> <project> [--json]
```

- `<slug>`는 Bay 이름만. `skill:` 접두사를 붙이지 않는다
- 확정본 `skills/<slug>/SKILL.md`만 설치한다. `.proposed`는 거절된다
- 대상 레포에 `skills/<slug>`를 **심볼릭 링크**한다. 링크가 실패하면 복사
- `overlay.yaml`에 wire `skill:<slug> --[uses]--> skill:skills/<slug>/SKILL.md`를 추가한다
- 짝이 되는 Patch 문서가 없어도 된다. Atlas Gaps의 “패치 없는 와이어”로 보이는 것이 정상이다

없는 slug, 잘못된 slug, 미등록 프로젝트면 **파일을 쓰기 전에** exit 1.

`patch`를 부르면 번들 스킬을 먼저 seed하므로, 빈 Bay에서도 `patch map-project demo`가 통한다.

### 9.8 `skill distill` · `skill accept`

```bash
patchbay skill distill --project demo [--slug harvested] [--json]
patchbay skill accept harvested [--json]
```

distill은 `board.yaml`이 비어 있으면 실패한다. slug 생략이면 `from-<alias>`. 같은 초안을 다시 쓰면 last-write-wins. 확정본은 건드리지 않는다.

accept는 `skills/<slug>.proposed`를 `skills/<slug>`로 **이름만 바꾼다.** 초안이 없으면 실패. 확정본이 이미 있으면 실패하고 덮지 않는다. 스킬을 실행하지 않는다.

그다음 `patchbay patch harvested demo`.

---

## 10. MCP

빌드된 진입점:

```text
node /path/to/Patchbay/app/packages/mcp/dist/index.js
```

stdio 서버다. HTTP가 아니다.

### 10.1 Cursor에 붙이기

`~/.cursor/mcp.json`(또는 프로젝트 MCP 설정) 예:

```json
{
  "mcpServers": {
    "patchbay": {
      "command": "node",
      "args": ["/path/to/Patchbay/app/packages/mcp/dist/index.js"],
      "env": {
        "PATCHBAY_HOME": "/Users/you/.patchbay"
      }
    }
  }
}
```

`PATCHBAY_HOME`을 CLI·콘솔과 맞춘다. MCP를 켠 뒤 Cursor를 다시 로드한다.

### 10.2 읽기

| 도구 | 하는 일 | 기본 |
| --- | --- | --- |
| `list_projects` | 등록된 프로젝트 목록. 인자 없음 | — |
| `get_atlas` | Atlas | `alias` 생략 → 유일한 프로젝트. **level 기본 1** (CLI atlas 기본 2와 다름) |
| `get_graph` | 스캔 Flow 그래프 JSON (Mermaid 아님, LangGraph 아님) | level 기본 1 |
| `get_project_bundle` | 제안용 재료. atlas + graph. `scope=full`(기본)이면 신호 파일 발췌(파일당 최대 2000자) | — |
| `get_progress` | `alias` 생략 = 스튜디오 롤업. 있으면 한 프로젝트 | level 기본 1 |

level: 1 요약, 2 본문, 3 원문.

### 10.3 쓰기

| 도구 | CLI 대응 | 파일 |
| --- | --- | --- |
| `progress_write` | `progress write` | progress.yaml, PROGRESS.md, 스튜디오 progress.md |
| `place_on_board` | (콘솔 올리기와 같은 Core) | board.yaml |

`place_on_board` 입력: `alias`, `id`, `kind` (`langgraph` \| `neo4j` \| `port`), `ref`, `title`, 선택 `x`/`y`(정수. 생략이면 **0**). 같은 `id`는 no-op.

MCP는 콘솔 소켓을 직접 밀지 않는다. 파일이 바뀌고, 떠 있는 `patchbay flow`가 SSE로 다시 읽는다. 콘솔이 꺼져 있으면 파일만 바뀌고 화면은 없다.

없는 도구: overlay 확정 쓰기, 스킬 distill/accept, LangGraph invoke, Neo4j 검색.

---

## 11. 스킬과 Skill Bay

스킬은 `SKILL.md`다. **호스트 모델이 읽고 사람이 확정한 절차를 따른다.** Patchbay 프로세스가 워커 세션을 원격으로 켜지 않는다.

### 11.1 번들 (init / patch / 콘솔 기동 시, 없을 때만 복사)

| slug | 언제 | 핵심 금지 |
| --- | --- | --- |
| `map-project` | “이 프로젝트에 뭐가 있어” | 파일을 쓰지 않는다. 재스캔은 안내만 |
| `adopt-project` | `project add` 직후, 있는 서사를 발굴 | 확인 전에 `progress.yaml.current`에 추정 작업을 쓰지 않는다. 기존 CLAUDE.md/rules를 덮지 않는다 |
| `new-project` | `project new` 직후 빈 캔버스 | 대상 **레포 안**에 기획서를 쓴다. 사람 승인 전 `scan` 금지 |
| `triage-project` | `excavation.json` 이후 | 삭제 금지. 혼자 끝내지 않음 |
| `propose-ontology` | 공통 루프 | `ontology/<alias>.proposed.yaml`만. 확정 yaml을 직접 덮지 않음 |
| `propose-dashboard` | 공통 루프 | `DASHBOARD.proposed.md`만 |

설치:

```bash
patchbay patch map-project demo
```

대상 레포에 `skills/map-project`가 생기고, 호스트에게 그 `SKILL.md`를 읽히면 된다.

### 11.2 보드에서 새로 만들기

1. 콘솔 캔버스 또는 `skill distill`
2. 초안을 사람이 고친다 (원하면)
3. `skill accept`
4. `patch`

수확 초안에는 보드 항목 표, 연결, `progress write` 시작/종료 예시, “워커를 켜지 않는다”가 들어 있다. 그 파일이 그래프를 돌리거나 Neo4j를 검색하지 않는다.

---

## 12. LangGraph · Neo4j

둘 다 **사용자가 따로 켠다.** Patchbay가 대신 기동하지 않는다.

### 12.1 LangGraph

계정 가입부터 로컬 서버, 흐름 탭 「다시 연결」까지 한 단계씩은 `knowledge/patchbay/사용설명서/Patchbay_LangGraph_세부매뉴얼_20260919a.md`.

Patchbay는 LangSmith/LangGraph 계정을 만들지 않는다. 사용자가 `langgraph dev`(JS면 `npx @langchain/langgraph-cli dev`)를 `:2024`에 켠다.

| 항목 | 값 |
| --- | --- |
| 계정 | [smith.langchain.com](https://smith.langchain.com) 무료 가입 (Google / GitHub / 이메일). 카드 없음 |
| API 키 | Settings → API Keys → Create. `.env`의 `LANGSMITH_API_KEY` (`lsv2_…`) |
| 기본 URL | `http://127.0.0.1:2024` |
| 환경변수 | `PATCHBAY_LANGGRAPH_URL` |
| 연결 확인 | `POST /assistants/search`, 800ms. 2xx만 연결됨 |
| 실행 | Patchbay → LangGraph `runs/wait` 위임 |

그래프 레포에서 `langgraph.json`에 graph가 있어야 흐름 탭에 assistant가 뜬다. 공식 JS 최소 템플릿은 LLM 키 없이 서버가 뜨고, 모델 호출은 나중에 붙인다.

### 12.2 Neo4j

| 항목 | 값 |
| --- | --- |
| compose | `app/docker-compose.yml` |
| Bolt | `bolt://127.0.0.1:7687` |
| 계정 | `neo4j` / `patchbay` |
| 환경변수 | `PATCHBAY_NEO4J_URI`, `PATCHBAY_NEO4J_USER`, `PATCHBAY_NEO4J_PASSWORD` |
| 검색 | 경로·이름·port 부분 문자열, 상한 40. 임베딩 없음 |
| 재스캔 | 그 alias 스냅샷을 지우고 다시 넣음. 사라진 경로가 남지 않음 |

비밀번호를 바꾸면 compose의 `NEO4J_AUTH`와 `PATCHBAY_NEO4J_PASSWORD`를 같이 맞춘다.

끄기:

```bash
cd /path/to/Patchbay/app
docker compose down
```

데이터 볼륨은 `neo4j_data`다. 볼륨까지 지우려면 `docker compose down -v`.

---

## 13. 환경변수

| 이름 | 기본 | 누가 |
| --- | --- | --- |
| `PATCHBAY_HOME` | `~/.patchbay` | CLI, MCP, 콘솔 |
| `PATCHBAY_FLOW_PORT` | `4317` | 콘솔 (`--port`가 이걸 설정) |
| `PATCHBAY_FLOW_PROJECT` | (없음) | 콘솔 초기 선택 (`--project`) |
| `PATCHBAY_LANGGRAPH_URL` | `http://127.0.0.1:2024` | 콘솔 |
| `PATCHBAY_NEO4J_URI` | `bolt://127.0.0.1:7687` | 콘솔 |
| `PATCHBAY_NEO4J_USER` | `neo4j` | 콘솔 |
| `PATCHBAY_NEO4J_PASSWORD` | `patchbay` | 콘솔 |

CLI `patchbay flow --port 4318 --project demo`는 자식 프로세스에 포트·프로젝트를 넘긴다. LangGraph/Neo4j URL은 **부모 셸의 환경**을 그대로 물려준다.

---

## 14. PortId · Atlas · overlay

### 14.1 PortId

주소 형식 `kind:ref`.

| kind | 예 |
| --- | --- |
| `source` | `source:README.md` |
| `skill` | `skill:map-project` (Bay) 또는 `skill:skills/map-project/SKILL.md` (레포 안 파일. 반드시 `SKILL.md`로 끝남) |
| `artifact` / `agent` / `signal` | 예약. v1 스캐너는 source·skill만 찾는다 |

Bay slug는 `[a-z0-9][a-z0-9-]*`. 점이나 대문자가 들어간 이름은 스킬 slug로 쓸 수 없다.

보드 항목 id는 PortId와 별 체계다.

| kind | id | ref |
| --- | --- | --- |
| langgraph | `langgraph:{assistantId}:{nodeId}` | `{assistantId}:{nodeId}` |
| neo4j | `neo4j:{라벨소문자}:{경로}` | 경로 |
| port | `port:{PortId}` | PortId |

### 14.2 overlay.yaml

사람이 소유한다. 대략:

```yaml
patches: []
wires: []
decisions: []
accepted_guides: []
```

`patch`는 `wires`에만 한 줄을 붙인다. Patch(의도 선언)와 Wire(실제로 생긴 연결)는 다르다. 매칭 키는 `(from, to, kind)`.

### 14.3 board.yaml 예

```yaml
items:
  - id: langgraph:research_flow:draft
    kind: langgraph
    ref: research_flow:draft
    title: "LangGraph · draft"
    x: 220
    y: 0
  - id: neo4j:file:README.md
    kind: neo4j
    ref: README.md
    title: "File · README.md"
    x: 88
    y: 64
links:
  - from: langgraph:research_flow:draft
    to: neo4j:file:README.md
```

없는 파일은 `{ items: [], links: [] }`와 같다.

---

## 15. 문제 해결

| 증상 | 먼저 볼 것 |
| --- | --- |
| 콘솔 “등록된 프로젝트가 없습니다” | `PATCHBAY_HOME`이 CLI와 같은지. `patchbay init` / `project add`를 그 홈에 했는지 |
| 프로젝트 탭 “아직 스캔되지 않았습니다” | `project new`만 했거나 inferred가 없음. `patchbay scan --project <alias>` |
| `project add`가 exit 2 | clarity < 40. README·커밋·중복 파일명. `triage` 또는 `--force-add` |
| `scan`/`atlas`가 여러 프로젝트라고 함 | `--project <alias>` |
| `progress`가 기록이 없다고 함 | 한 번도 `progress write`를 안 함. 롤업과 프로젝트 파일이 같이 생긴다 |
| 흐름이 연결 안 됨 | 그 레포에서 `langgraph dev`. 방화벽/포트 2024. `PATCHBAY_LANGGRAPH_URL`. 「다시 연결」 |
| 실행 403/실패 | LangGraph 쪽 로그. Patchbay는 위임만 한다. JSON 입력 형식 |
| 지식이 연결 안 됨 | `app/`에서 `docker compose up -d`. 비밀번호 `patchbay`. 포트 7687 |
| 지식 검색 0건 | 스캔 여부, alias, 쿼리가 경로·이름 일부인지. 의미 검색이 아님 |
| 캔버스가 비어 있음 | 흐름/지식에서 「캔버스에 올리기」. 워크스페이스 alias가 맞는지 |
| 「초안 확정」이 초안 없음 | 먼저 「스킬 초안으로」. 이미 확정만 있고 `.proposed`가 없음 |
| 「초안 확정」이 덮지 않음 | 같은 slug 확정본이 이미 Bay에 있음. 다른 slug를 쓰거나 확정 폴더를 사람이 정리 |
| `patch`가 Bay에 없다고 함 | `skill accept` 전인지. slug 오타. seed 후 `~/.patchbay/skills/` 확인 |
| MCP가 다른 스튜디오를 봄 | mcp.json의 `PATCHBAY_HOME` |
| `patchbay flow`가 바로 죽음 | `pnpm --filter @patchbay/flow build` 했는지. 포트가 이미 쓰이는지 |
| 화면이 안 따라감 | 콘솔 프로세스가 살아 있는지. 감시 파일은 `progress.yaml`/`inferred.json`/`overlay.yaml`/`board.yaml`뿐 |
| CLI와 콘솔이 어긋남 | 둘 다 빌드했는지. 콘솔은 `dist-server`를 띄운 시점의 코드 |

종료 코드 요약:

| 코드 | 뜻 |
| --- | --- |
| 0 | 성공 |
| 1 | 인자·미등록·없는 파일·잘못된 slug 등 |
| 2 | `project add` clarity 게이트 (등록 안 함) |

---

## 16. 하지 않는 것

제품이 의도적으로 안 하는 일이다. 버그로 보이지 말 것.

- 자작 워크플로 엔진, n8n식 스케줄러, Patchbay 내부 그래프 DSL
- 벡터 임베딩 · 자작 GraphRAG
- 커널이 모델을 직접 호출
- 스킬이 워커 세션을 원격으로 켜기
- 확정 overlay/board를 스캔이 덮기
- 부팅 자동 워치 데몬
- 채팅 트랜스크립트 자동 수집
- 삭제 (`rm`). 폐기는 `_archive/`
- 멀티유저 SaaS, Tauri 데스크탑, Cursor 채팅 대체
- 캔버스에서 LangGraph invoke / Neo4j 검색

아직 커널에 없는 것 (호스트 스킬이 메우거나, P9 이후):

- `project new`의 대화형 설계 인터뷰 (스킬 `new-project`가 담당)
- 단절·빈 스튜디오·왕복의 전 구간 마감 점검 (P9)
- overlay 초안 MCP (`overlay_propose`)

---

## 관련 문서

- 비전공자 실습 (한 단계씩): `knowledge/patchbay/사용설명서/Patchbay_세부매뉴얼_20260918a.md`
- LangGraph 계정·로컬 서버 (한 단계씩): `knowledge/patchbay/사용설명서/Patchbay_LangGraph_세부매뉴얼_20260919a.md`
- 제품 경계: `archive/docs/기획/Patchbay_기획_20260918a.md`
- HTTP·파일 계약: `knowledge/patchbay/명세/Patchbay_명세_20260918a.md`
- 단계 계획: `knowledge/patchbay/구현계획/Patchbay_구현계획_20260917a.md`
- 번들 스킬 원문: `app/packages/skills/<slug>/SKILL.md`
