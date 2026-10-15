# Patchbay 명세서

| 항목 | 값 |
| --- | --- |
| 문서명 | Patchbay_명세 |
| 버전 | 20260929a |
| 범위 | **M1 계약 확정.** IR · 권한 · 실행 기록 · 버전 |
| 기준 기획 | `docs/기획/Patchbay_기획_20260928a.md` (P0 계약) |
| 입력 | `docs/구현계획/Patchbay_구현준비_20260928a.md` |
| 상태 | **채택값의 최종 원본.** 기획서와 어긋나면 6절이 이긴다 |
| 구현 | 이 문서는 M2~M6이 구현할 계약이다. 이 문서만으로 코드가 돌지 않는다 |

기획서 10절이 *"채택값은 명세가 이긴다. 명세는 아직 없다"*로 끝난다. 이 문서가 그 자리를 채운다.
제품을 다시 설계하지 않는다 — 다섯 단계와 열 칸은 기획서가 정했고, 여기서는 **필드·타입·경로·검사 이름**을 박는다.

---

## 1. M1이 닫아야 할 여섯 질문

구현 준비 계획이 「하나라도 미정이면 M2 제품 코드를 시작하지 않는다」고 정한 중지 조건이다.

| # | 질문 | 답 | 어디 |
| --- | --- | --- | --- |
| 1 | `overlay.ir` 각 필드의 타입·필수 여부·기본값은? | 3절의 표 17개 | §3 |
| 2 | 초안을 승인된 IR로 바꾸는 **유일한** 쓰기 경로는? | `patchbay ir adopt` 하나. 스캔·MCP·화면은 못 쓴다 | §2.3 |
| 3 | `caps[]`는 **어디에서** 집행되는가? | 네 곳. 그리고 **런타임 강제는 Patchbay가 하지 않는다** | §4.3 |
| 4 | 요구사항 링크와 런타임 실행 기록의 식별자는 어떻게 연결되는가? | `requirementLinks[]`는 설계 안에서, 실행 기록은 `(irVersion, nodeId)`로 바깥에서 | §5.4 |
| 5 | v(n)의 IR·평가 결과는 어디에 보관하는가? | `versions/<n>/` — 지우지 않는다 | §6 |
| 6 | 어떤 외부 관측 도구를 첫 어댑터로 삼는가? | **로컬 LangGraph HTTP.** LangSmith는 보류 | §5.5 |

---

## 2. IR이 사는 곳

### 2.1 파일 세 개와 그 성격

IR은 **저작물**이다(원칙 2·9절 소유권). 커널이 덮는 파생물과 같은 폴더에 있지만 규칙이 다르다.

| 대상 | 경로 | 누가 쓰나 | 스캔이 덮나 |
| --- | --- | --- | --- |
| **승인된 IR** | `~/.patchbay/projects/<alias>/overlay.yaml` 의 `ir` 절 | `ir adopt`만 | 안 덮음 |
| **초안** | `~/.patchbay/projects/<alias>/ir.proposed.yaml` | 호스트 모델·사람. 자유롭게 다시 생성 | 안 덮음 |
| **보관본** | `~/.patchbay/projects/<alias>/versions/<n>/` | `ir adopt`가 채택 직전에 복사 | 안 덮음. **지우지 않음** |

`ir`는 `overlay.yaml`의 **새 절**이고 `process`를 확장하지 않는다. 두 축이 다르기 때문이다 —
`process`는 **사람의 작업 계획**(커리큘럼·주차·공정)이고 `ir`는 **그래프의 설계**다.
역추출에서 둘의 겹침이 0인 사례가 나왔다(기획서 §2). `process.bind`가 둘을 잇는 자리다.

`host.json`은 IR의 원본이 아니다. 기획 대화 상태(beat)만 들고 있다.

### 2.2 `overlay.yaml`에 붙는 자리

현재 스키마(`dev/packages/core/src/types/overlay.ts`)는 `patches` · `wires` · `decisions` ·
`accepted_guides` · `process` 다섯 절이다. 여섯 번째로 `ir`를 **선택 절**로 추가한다.

```yaml
# ~/.patchbay/projects/<alias>/overlay.yaml
patches: []
wires: []
decisions: []
accepted_guides: []
process: { configured: false }
ir:                      # ← 없으면 「1단계 미착수」다. 빈 객체로 만들지 않는다
  schemaVersion: 1
  version: 1
  ...
```

`ir`가 없는 것과 `ir`가 비어 있는 것은 다르다. **없으면 미착수**, 비어 있으면 스키마 오류다.

### 2.3 쓰기 경로는 하나다 (질문 2)

```
ir.proposed.yaml ──► patchbay ir diff ──► 사람이 본다 ──► patchbay ir adopt ──► overlay.ir
                                                              │
                                                              └─► versions/<n>/ 에 이전 판 복사
```

| 규칙 | 내용 |
| --- | --- |
| **유일 경로** | `patchbay ir adopt --project <alias>` 하나. 스캔·SSE·화면·MCP는 `overlay.ir`를 쓰지 않는다 |
| **차이 먼저** | `adopt`는 `ir diff`가 낸 차이를 출력하고 확인을 받는다. `--json` 또는 비대화 TTY면 `--yes` 없이는 거절한다 |
| **검사 먼저** | DRC(§7)가 실패하면 `adopt`는 거절한다. `--force`는 두지 않는다 — 통과 못 한 설계가 승인되면 게이트가 없는 것과 같다 |
| **보관 먼저** | 교체 직전에 현재 IR과 평가 결과를 `versions/<n>/`로 복사한다. 복사가 실패하면 교체하지 않는다 |
| **초안 불변** | `adopt`는 `ir.proposed.yaml`을 지우거나 고치지 않는다 |

MCP는 이 경로에 없다. 기획서 10절의 「쓰기 MCP는 확정 overlay를 쓰지 않는다」가 그대로다.

---

## 3. IR 필드 계약 (질문 1)

### 3.0 키 표기 — 채택

**기계가 읽는 키는 영어 camelCase, 값과 설명은 한국어 자유 문장.**

시험용 초안(`ir.proposed.yaml`)은 `무엇` · `되돌림` · `사람_확인` · `한국어` 같은 한국어 키를 썼다.
읽기는 좋지만 **스키마·코드 생성·검사 이름이 전부 그 키를 참조**하게 되고, 한 글자만 달라도
(`사람_확인` / `사람확인`) 조용히 통과한다. 그래서 키는 영어로 고정하고, 사람이 읽을 말은 값에 둔다.

§3.8에 초안 → 이 명세로 옮기는 변환표를 둔다.

### 3.1 최상위

| 필드 | 타입 | 필수 | 기본값 | 뜻 |
| --- | --- | --- | --- | --- |
| `schemaVersion` | `number` | ✅ | — | **IR 파일 형식** 버전. 이 명세는 `1`. 모르는 값은 거절(마이그레이션 메시지) |
| `version` | `number` | ✅ | — | **프로젝트 설계 반복 번호.** 1부터. v(n)↔v(n+1) 비교 기준 |
| `project` | `string` | ✅ | — | 등록된 alias. `studio.yaml`과 달라도 되지만 경고 |
| `graph` | `string` | ⬜ | `""` | LangGraph `graph_id`. 2단계 대조 대상 |
| `why` | `object` | ✅ | — | §3.2 — 1.0 |
| `goal` | `string` | ✅ | — | 목적 한 문장 — 1.1 |
| `done` | `string[]` | ✅ | — | 판정 가능한 완료 조건. **1개 이상** — 1.1 |
| `caps` | `Cap[]` | ✅ | — | §3.3 — 1.2 |
| `tools` | `Tool[]` | ✅ | `[]` | §3.3. 빈 배열이 정상(툴 없는 에이전트) |
| `models` | `Model[]` | ✅ | `[]` | §3.3. 툴과 **다른 축** |
| `reads` | `Read[]` | ✅ | — | §3.4 — 1.3 |
| `emits` | `Emit[]` | ✅ | `[]` | §3.4 — 1.3 |
| `state` | `StateField[]` | ✅ | — | §3.5 — 1.4 |
| `nodes` | `Node[]` | ✅ | — | §3.5 — 1.5 |
| `edges` | `Edge[]` | ✅ | — | §3.5 — 1.5 |
| `documents` | `DocDep[]` | ✅ | `[]` | §3.6 — 1.6 |
| `requirements` | `Requirement[]` | ✅ | — | §3.7 — 1.7 |
| `evals` | `Eval[]` | ✅ | — | §3.7 — 1.8 |
| `requirementLinks` | `Link[]` | ✅ | — | §3.7 — 1.8의 추적 표 |

**`ir.trace[]`는 없다.** 요구사항 추적은 `requirementLinks[]`, 테스트 중 기록은 §5의 **실행 기록**이다.
같은 이름을 쓰면 M6에서 어느 쪽을 뜻하는지 판정할 수 없다.

**검사 결과를 IR에 적지 않는다.** 초안의 `L4_없음: true` · `rtm_빈칸:` 같은 필드는 받지 않는다 —
그것은 DRC가 판정할 것이지 사람이 선언할 것이 아니다. 선언과 판정이 갈리면 선언이 거짓말을 한다.

### 3.2 `why` — 1.0 에이전트가 필요한가 (AJR)

| 필드 | 타입 | 필수 | 뜻 |
| --- | --- | --- | --- |
| `alternative` | `string` | ✅ | 더 단순한 대안(스크립트·규칙표·검색)으로 어디까지 되나 |
| `modelNeed` | `string` | ✅ | 그 대안으로 **안 되는** 지점. 여기가 모델이 필요한 자리다 |
| `verdict` | `string` | ✅ | 한 문장 결론. 비면 1.0 실패 |
| `needsModel` | `boolean` | ✅ | **결론이 모델을 요구하나.** 사람이 적는다 |
| `note` | `string` | ⬜ | 경고·메모 |

`needsModel`을 따로 두는 이유: 시험 DRC는 `verdict` 문장을 정규식(`/모델이 한다|모델만|LLM/`)으로
훑어 모델 필요성을 판정했다. 문장 표현이 바뀌면 검사가 조용히 뒤집힌다. **판정을 문장에서 추측하지 않는다.**

### 3.3 권한과 호출 — 1.2

```
caps[]   행위자가 무엇을 할 수 있나      ← 집합이다. 순서 있는 등급이 아니다
tools[]  툴 하나가 무슨 caps를 요구하나
models[] 모델 호출이 무슨 caps를 요구하나  ← 툴과 다른 축. 노드는 툴 없이도 모델을 부른다
```

**`Cap`**

| 필드 | 타입 | 필수 | 뜻 |
| --- | --- | --- | --- |
| `id` | `"cap:read" \| "cap:draft" \| "cap:pr" \| "cap:external"` | ✅ | 네 값 고정. 다섯 번째를 만들지 않는다 |
| `scope` | `string` | ✅ | 무엇에 대해 허용하나 (경로·대상) |
| `undo` | `string` | ✅ | 되돌리는 방법. 「번거롭다」도 답이다 |
| `humanApproval` | `boolean` | ✅ | 사람 확인이 필요한가 |

초안은 이 필드를 `level: cap:read`로 적었다. **`level`은 콘텐츠 민감도 전용**이고(원칙 10),
같은 키에 `cap:*`를 담으면 용어 사고가 스키마에 박힌다. 그래서 `id`다.

**`Tool`** — `id`(✅) · `caps`(`Cap.id[]`, ✅, 1개 이상) · `what`(✅) · `irreversible`(`boolean`, 기본 `false`)
**`level`을 두지 않는다.** 툴은 행위자고 등급은 콘텐츠의 것이다.

**`Model`** — `id`(✅, 예 `claude-opus-5`) · `provider`(✅) · `caps`(✅) · `usedBy`(`node id[]`, ✅) ·
`timeoutMs`(⬜, 기본 `20000`) · `fallback`(⬜)

`usedBy`가 필수인 이유: 「모델이 필요하다」와 「어느 노드가 부른다」는 다른 말이고,
2단계 생성기와 M6 실행 대조가 둘 다 노드 단위로 붙는다.

### 3.4 정보 경계 — 1.3

**`Read`** — `path`(✅, glob 허용) · `level`(`0..4`, ✅) · `why`(⬜)
**`Emit`** — `what`(✅) · `level`(`0..4`, ✅) · `to`(✅ — `model` \| `file` \| `external`) · `reason`(✅)

`level`은 **콘텐츠 민감도 하나의 뜻**이다: `0` 공개 · `1` 구조 · `2` 작업 · `3` 원본 · `4` 비밀.
정보 상세도(`atlas --level 1~3`)와 행위자 능력(`cap:*`)은 다른 축이고 다른 이름이다(용어집 「등급」).

`emits[].to: external`인데 `caps`에 `cap:external`이 없으면 1.2 실패다.

### 3.5 넷리스트와 회로 — 1.4 · 1.5

**`StateField`**

| 필드 | 타입 | 필수 | 뜻 |
| --- | --- | --- | --- |
| `field` | `string` | ✅ | State 키 |
| `type` | `string` | ✅ | 타입 문자열. 생성기가 그대로 쓴다 |
| `reducer` | `"append" \| "lastWrite" \| "custom"` | ✅ | 세 값 고정. 화면 표시는 「덧붙임 · 덮어씀 · 직접」 |
| `reducerRef` | `string` | `custom`일 때 ✅ | 구현 위치 |
| `default` | `string` | ✅ | 코드 리터럴 문자열(`"[]"`, `'""'`). 빈 문자열도 값이다 |

초안은 reducer를 「덧붙임 / 덮어씀」이라는 한국어 자유 문자열로 적었다. 생성기가 읽어야 하므로 값을 고정한다.

**`Node`** — `id`(✅) · `label`(✅, 한국어 표시명) · `reads`(`field[]`) · `writes`(`field[]`) ·
`models`(`Model.id[]`, ⬜) · `tools`(`Tool.id[]`, ⬜) · `documents`(`DocDep.id[]`, ⬜)

**`Edge`** — `from`(✅) · `to`(✅) · `when`(⬜ — 분기 조건 한 문장)

예약 id는 `__start__` · `__end__` 둘뿐이고 `nodes[]`에 적지 않는다(LangGraph 관례).
초안의 튜플 표기(`- [__start__, intake]`)는 받지 않는다 — 분기 조건(`when`)을 실을 자리가 없다.

### 3.6 문서 의존 — 1.6

**`DocDep`** — `id`(✅) · `node`(✅) · `path`(✅) · `level`(`0..4`, ✅) · `when`(✅ — 어떤 입력일 때 이 문서인가) · `via`(⬜)

초안은 `영역별_조각: {reading: ..., listening: ...}` 같은 **맵**으로 적었다. 맵은 키가 곧 분기 조건이라
프로젝트마다 다른 이름이 생기고 검사가 프로젝트를 알아야 한다. 그래서 **한 줄 = 한 의존**으로 편다.

`when`이 4단계의 대체 대상이다 — 하드코딩된 문서 라우팅(코드 안의 분기 표)이 이 자리로 올라오고,
M5에서 그래프 조회로 바뀐다. 「후보는 많은데 표가 몇 개만 쓴다」가 `1.6/doc-coverage`가 잡는 상태다.

### 3.7 요구사항 · 평가 · 추적 — 1.7 · 1.8

**`Requirement`** — `id`(✅) · `pattern`(✅ — `ubiquitous`·`event`·`state`·`unwanted`·`optional`) ·
`text`(✅) · `note`(⬜)

**`Eval`** — `id`(✅) · `node`(✅) · `input`(✅) · `expect`(✅) ·
`kind`(✅ — `deterministic` \| `model`) · `scoring`(`kind: model`일 때 ✅)

`kind`를 나누는 이유: 결정적 검사는 CI가 매번 돌리고, 모델 평가는 **고정 응답 어댑터**로만 돌린다(§8).
둘을 섞으면 CI가 외부 API에 매달린다.

**`Link`** (`requirementLinks[]`) — `requirement`(✅) · `node`(✅) · `eval`(✅)

추적 표는 `evals[].covers`가 아니라 **이 배열**이 원본이다. 요구사항 × 노드 × 평가 세 축이 한 행에 있어야
「State를 고쳤다 → 어느 요구사항이 무효인가」를 기계가 답한다. 무효 전파(§7.3)가 이 표를 읽는다.

### 3.8 한국어 키 초안 → 이 명세 변환표

2026-09-28의 시험용 초안은 한국어 키로 쓰여 이 계약에 **맞지 않는다.** 옮길 때 쓴다.
(같은 표기를 쓴 초안이 또 나오면 그대로 적용된다.)

| 초안 | 이 명세 | 비고 |
| --- | --- | --- |
| `why.단순_대안` · `LLM이_필요한_곳` · `결론` · `경고` | `why.alternative` · `modelNeed` · `verdict` · `note` | `needsModel`을 새로 적어야 한다 |
| `caps[].level: cap:read` | `caps[].id` | `level`은 민감도 전용 |
| `caps[].무엇` · `되돌림` · `사람_확인` | `scope` · `undo` · `humanApproval` | `humanApproval`은 boolean |
| `emits[].무엇` · `근거` | `emits[].what` · `reason` | `to`를 새로 적어야 한다 |
| `state[].reducer: 덧붙임/덮어씀` | `append` / `lastWrite` | 값 고정 |
| `nodes[].한국어` | `nodes[].label` | |
| `edges: [[a, b]]` | `edges: [{from, to}]` | 분기 조건 자리 |
| `documents[].영역별_조각{}` | `documents[]` 한 줄 = 한 의존 | `when`으로 분기를 적는다 |
| `requirements[].문장` · `지금_코드` | `text` · `note` | |
| `evals[].입력` · `기대` · `covers` | `input` · `expect` → `requirementLinks[]` | `kind`를 새로 적어야 한다 |
| `L4_없음` · `rtm_빈칸` | **삭제** | 검사가 판정한다 |
| `models: []` | 채워야 한다 | 1.0이 모델을 요구하므로 비면 1.2 실패 |

---

## 4. 권한 두 축 (질문 3)

### 4.1 두 축은 이름을 겹치지 않는다

| 축 | 필드 | 값 | 어디에 |
| --- | --- | --- | --- |
| **콘텐츠 민감도** | `level` | `0` 공개 · `1` 구조 · `2` 작업 · `3` 원본 · `4` 비밀 | `reads[]` · `emits[]` · `documents[]` **에서만** |
| **행위자 능력** | `caps` / `id` | `cap:read` · `cap:draft` · `cap:pr` · `cap:external` | `caps[]` · `tools[].caps` · `models[].caps` |

`tools[]`에 `level`을 두지 않고, `caps[]`에 `level`을 쓰지 않는다. 게이트는 두 축의 **곱**이다.

### 4.2 이미 집행되는 곳 (2026-09-28 구현, 그대로)

| # | 어디 | 무엇 |
| --- | --- | --- |
| ① | `GET/PUT /api/source` | L4를 403. 경로만 보므로 거절할 때 파일을 열지 않는다 |
| ② | `readSignalExcerpts` | L4 건너뜀 — MCP `get_project_bundle`이 **모델로** 보내므로 ①의 403이 닿지 않는다 |
| ③ | Neo4j `search`·`neighborhood`·`counts` | `coalesce(n.level, 2) < 4` |

등급은 읽을 때 계산하지 않고 **쓸 때 분류해 저장한다** — `scanner.gradePorts` → `inferred.portLevels`
→ `Knowledge.level`. L4 포트는 `discoveredPorts`에서 아예 빠진다.

### 4.3 `caps[]`는 어디에서 집행되는가 — 답

| # | 어디 | 언제 | 무엇 |
| --- | --- | --- | --- |
| ① | **DRC** (M2) | 설계 시점 | `tools[]`·`models[]`가 요구하는 caps가 `caps[]`에 선언됐나. 되돌릴 수 없는 행동에 `humanApproval`이 붙었나 |
| ② | **생성기** (M4) | 스캐폴드 생성 시 | 노드 껍데기에 요구 caps와 사람 확인 지점을 **주석과 스텁**으로 넣는다 |
| ③ | **실행 대조** (M6) | 테스트 후 | 실행 기록의 `toolCalls[].caps`가 IR 선언을 벗어나면 어긋남으로 띄운다 |
| ④ | **Patchbay 자신** | 항상 | MCP 쓰기 도구는 확정 overlay를 쓰지 않는다. `ir adopt`만이 쓰기다 |

**Patchbay는 런타임에서 caps를 강제하지 않는다.** 원칙 9 — 그래프 invoke는 LangGraph의 몫이고
Patchbay는 실행 엔진이 아니다. 강제는 **생성된 코드와 그 런타임**이 한다. Patchbay가 하는 일은
**선언을 요구하고, 어긋남을 띄우는 것**이다. 이 문장을 명세에 박아 두지 않으면
「caps가 있는데 왜 막지 않느냐」가 M6에서 결함으로 올라온다.

---

## 5. 실행 기록 (질문 4 · 6)

### 5.1 이름

테스트 중 런타임이 남긴 기록은 **실행 기록**(`run record`)이다. `trace`라고 부르지 않는다 —
요구사항 추적 표(`requirementLinks`)와 이름이 겹치면 M6에서 어느 쪽인지 판정할 수 없다.
Patchbay는 **트레이스 뷰어를 만들지 않는다.** 시계열은 외부 관측 도구의 몫이다.

### 5.2 최소 형식

공급자별 어댑터가 아래로 정규화한다. Core 타입과 DRC는 **공급자 SDK를 직접 보지 않는다.**

| 필드 | 타입 | 필수 | 뜻 |
| --- | --- | --- | --- |
| `runId` | `string` | ✅ | 공급자의 실행 식별자 |
| `graphId` | `string` | ✅ | 어느 그래프인가 |
| `irVersion` | `number` | ✅ | **어느 설계와 대조할지.** 없으면 대조 불가 |
| `status` | `"success" \| "error" \| "timeout" \| "refused"` | ✅ | 네 값 고정 |
| `nodeId` | `string \| null` | ✅ | 실패 노드, 성공이면 마지막 노드 |
| `startedAt` · `endedAt` | ISO8601 UTC | ✅ | 실행 구간 |
| `modelCalls[]` | `{nodeId, model, provider, status, ms, tokensIn?, tokensOut?}` | ✅ | 선언된 호출과 대조 |
| `toolCalls[]` | `{nodeId, tool, caps[], status}` | ✅ | §4.3 ③의 입력 |
| `documentCalls[]` | `{nodeId, path, level, via?}` | ✅ | `via`가 M5의 **근거 경로** |
| `usage` | `{inputTokens, outputTokens, costUsd?}` | ✅ | 비용 한도 검사 |
| `error` | `{kind, message, nodeId} \| null` | ✅ | 실패를 평가 사례로 바꿀 근거 |

빈 배열은 값이다. 필드를 빼는 것과 `[]`는 다르다 — 「툴을 안 불렀다」와 「기록이 없다」는 다른 사실이다.

### 5.3 어디에 저장하나

`~/.patchbay/projects/<alias>/test-runs/<runId>.json` — 한 실행 한 파일.
원칙 7대로 **파일이 원본**이고 Neo4j는 재인제스트로 다시 채울 수 있는 인덱스다.
트레이스·토큰 로그를 Neo4j에 넣지 않는다(기획서 §6).

### 5.4 식별자는 이렇게 연결된다 — 답 (질문 4)

```
설계 안 (IR)                          바깥 (런타임)
requirements[].id ──┐
                    ├─ requirementLinks[] ─┐
nodes[].id ─────────┤                      │
                    │                      ├── nodes[].id ──► runRecord.nodeId
evals[].id ─────────┘                      │                  runRecord.modelCalls[].nodeId
                                           │
ir.version ────────────────────────────────┴── runRecord.irVersion
```

| 규칙 | 내용 |
| --- | --- |
| 설계 안의 세 축은 **`requirementLinks[]`가 잇는다** | 요구사항 × 노드 × 평가 한 행 |
| 실행 기록은 설계에 **두 개로만 붙는다** | `(irVersion, nodeId)`. 요구사항·평가 id를 실행 기록에 넣지 않는다 |
| 실행 기록 → 평가는 **사람을 거친다** | 실패 기록으로 `evals[]` 초안을 만들되, `requirementLinks[]`의 빈 칸은 사람이 채운다 |
| 승인 전에 원본을 바꾸지 않는다 | 초안은 `ir.proposed.yaml`에만 쓴다 (원칙 6) |

실행 기록에 요구사항 id를 싣지 않는 이유: 런타임은 요구사항을 모른다. 알게 만들면 설계 문서가
런타임 코드로 새고, v(n+1)에서 요구사항 id가 바뀌는 순간 옛 실행 기록이 거짓말을 한다.

### 5.5 첫 어댑터 — 채택 (질문 6)

**로컬 LangGraph HTTP (`PATCHBAY_LANGGRAPH_URL`, 기본 `http://127.0.0.1:2024`).**

| 후보 | 판단 |
| --- | --- |
| **LangGraph 스레드·실행 기록** | **채택.** 로컬 `:2024`에 이미 떠 있고, 콘솔이 `POST /threads/{id}/history`를 이미 읽는다. 로컬 보관이라 외부 전송이 없다 |
| LangSmith | 보류. 클라우드 전송이 필요하고, P0에서 로컬 노출을 막은 직후에 밖으로 내보낼 이유가 없다 |
| 자체 호스팅 관측 도구 | 보류. 사이드카가 하나 더 늘고, 첫 어댑터로 형식을 검증하기 전에는 이르다 |

어댑터는 `dev/apps/flow/src/`의 LangGraph 어댑터 **옆**에 둔다. 정규화 함수는 Core로 간다 —
`modelCalls`·`toolCalls`·`documentCalls`를 어떻게 뽑는지는 공급자마다 다르지만,
**나온 형식은 §5.2 하나**다.

---

## 6. 버전 (질문 5)

### 6.1 설계 버전의 원본 — 채택

**`overlay.ir.version`이 원본이다.** `host.json.version`을 쓰지 않는다.

기획서는 `host.json.version`을 말했지만 「저작물은 하나 — IR」(원칙 2)과 충돌한다.
`host.json`은 기획 대화 상태(`beatId`·`status`·`completed`)를 들고 있고, 제품 설계 버전과 섞으면
대화를 닫는 행위가 제품 버전을 올리게 된다.

| 무엇 | 어디 | 누가 올리나 |
| --- | --- | --- |
| IR **파일 형식** 버전 | `ir.schemaVersion` | 이 명세 |
| **설계 반복** 번호 | `ir.version` | `ir adopt`가 +1 |
| 기획 대화 상태 | `host.json.beatId` · `completed` | 사람이 beat를 닫을 때 |

### 6.2 보관 (원칙 16 — 삭제 대신 보관)

```
~/.patchbay/projects/<alias>/versions/<n>/
├── ir.yaml          채택 직전의 overlay.ir 사본
├── evals.json       그 버전으로 돌린 평가 결과
└── adopted.json     {adoptedAt, from, drcPassed}
```

| 규칙 | 내용 |
| --- | --- |
| 언제 | `ir adopt`가 교체 **직전에** 복사한다. 복사 실패면 교체하지 않는다 |
| 불변 | `versions/`는 만든 뒤 고치지 않는다. 지우지 않는다 |
| 비교 | v(n)과 v(n+1)은 **같은 평가 묶음**으로만 비교한다. 평가가 바뀌었으면 점수를 나란히 놓지 않는다 |

---

## 7. 설계 규칙 검사 — DRC (1.9)

### 7.1 검사 목록

M2가 커널로 구현한다. **검사마다 안정된 id**를 둔다 — 통과 개수(14/17 같은 숫자)를 회귀 기준으로
쓰지 않는다. 검사 목록이 고쳐지면 숫자는 뜻을 잃는다. 회귀는 **실패한 검사 id와 돌아갈 칸**으로 한다.

| 검사 id | 칸 | 무엇을 본다 | 실패 예시 |
| --- | --- | --- | --- |
| `1.0/verdict` | 1.0 | `why.verdict`가 비어 있지 않다 | `verdict: ""` |
| `1.1/done-judgeable` | 1.1 | `done[]`이 1개 이상이다 | `done: []` |
| `1.2/tool-caps` | 1.2 | 모든 `tools[].caps`가 1개 이상이고 `caps[]`에 선언돼 있다 | 툴에 `caps: []` |
| `1.2/model-declared` | 1.2 | `why.needsModel`이면 `models[]`가 비어 있지 않다 | `needsModel: true` + `models: []` |
| `1.2/model-caps` | 1.2 | `models[].caps`가 `caps[]`에 선언돼 있다 | 모델이 `cap:external`인데 선언 없음 |
| `1.2/irreversible-approval` | 1.2 | `tools[].irreversible`이면 그 cap에 `humanApproval: true` | `cap:pr`에 `humanApproval: false` |
| `1.2/caps-known` | 1.2 | `caps[].id`가 네 값 중 하나다 | `cap:admin` |
| `1.3/read-level` | 1.3 | 모든 `reads[]`·`emits[]`·`documents[]`에 `level`이 있다 | `level` 누락 |
| `1.3/no-l4` | 1.3 | `level: 4`가 없다 | 비밀 파일을 `reads[]`에 |
| `1.3/external-cap` | 1.3 | `emits[].to == external`이면 `cap:external`이 선언돼 있다 | 선언 없이 외부 전송 |
| `1.4/reducer-default` | 1.4 | 모든 `state[]`에 `reducer`와 `default`가 있다 | `default` 누락 |
| `1.4/custom-ref` | 1.4 | `reducer: custom`이면 `reducerRef`가 있다 | `custom`인데 참조 없음 |
| `1.5/known-fields` | 1.5 | 노드가 존재하는 State 칸만 읽고 쓴다 | `writes: [없는칸]` |
| `1.5/no-orphan-field` | 1.5 | 아무도 읽지도 쓰지도 않는 칸이 없다 | 쓰기만 하고 아무도 안 읽는 칸 |
| `1.5/reachable` | 1.5 | `__start__`에서 모든 노드에 닿는다 | 엣지 없는 노드 |
| `1.5/can-end` | 1.5 | 모든 노드에서 `__end__`로 갈 수 있다 | 막다른 노드 |
| `1.6/doc-exists` | 1.6 | `documents[].path`가 실제로 있는 파일이다 | 오타 난 경로 |
| `1.6/doc-coverage` | 1.6 | 같은 폴더의 후보 중 쓰는 비율이 절반 이상이다 | 조각 14개 중 4개만 씀 |
| `1.6/node-exists` | 1.6 | `documents[].node`가 존재하는 노드다 | 지운 노드를 가리킴 |
| `1.6/doc-ref-exists` | 1.6 | `nodes[].documents`가 존재하는 `documents[].id`다 | 오타 난 `D9` |
| `1.7/ears-pattern` | 1.7 | 모든 요구사항이 5패턴 중 하나다 | `pattern: 기타` |
| `1.7/unwanted` | 1.7 | `unwanted`가 1개 이상이다 | 거절·타임아웃 문장 없음 |
| `1.8/rtm-complete` | 1.8 | 모든 요구사항이 `requirementLinks[]`에 최소 1행 있다 | 링크 없는 요구사항 |
| `1.8/eval-node-exists` | 1.8 | 모든 `evals[].node`가 존재하는 노드다 | 지운 노드를 가리킴 |
| `1.8/link-integrity` | 1.8 | `requirementLinks[]`의 세 id가 전부 실재한다 | 없는 eval id |
| `1.8/eval-scoring` | 1.8 | `kind: model`인 평가에 `scoring`이 있다 | 채점법 없는 모델 평가 |

**옮기지 않는 것:** 시험 구현의 `t.level` 검사(툴에 `level`이 있나)는 커널로 옮기지 않는다 —
툴에 `level`을 두지 않기로 했으므로(§4.1) 검사 자체가 사라진다.

**고친 것:** 시험 구현의 「1.0이 모델 호출을 요구하면 툴이 최소 1개」는 모델 호출과 툴 호출을 섞은
잘못된 결합이었다. `1.2/model-declared`가 그 자리를 대신한다.

### 7.2 결과 형식

```json
{
  "passed": false,
  "checks": [{ "id": "1.2/model-declared", "gate": "1.2", "ok": false, "note": "models[]가 0개다" }],
  "failedGates": ["1.2"],
  "invalidated": ["1.5", "1.6"]
}
```

CLI는 사람이 읽는 표로, `--json`은 위 형식으로 낸다. 두 출력의 원본은 하나다.

### 7.3 무효 전파 — 지목해서 돌아간다

하네스 DRC는 처음으로 돌려보내지 않고 **어느 넷이 틀렸는지 지목한다.** 통과한 칸까지 매번 다시
확인하게 만들면 몇 번 뒤에 사람이 게이트를 건너뛴다.

| 실패한 칸 | 돌아갈 칸 | 같이 무효가 되는 칸 | 왜 |
| --- | --- | --- | --- |
| 권한 등급이 없다 | 1.2 | 1.5 · 1.6 | 권한이 만들 수 있는 노드를 제약한다 |
| Unwanted가 없다 | 1.7 | 1.8 | 문장이 바뀌면 평가도 바뀐다 |
| 추적 표에 빈 칸 | 1.8 | — | |
| State를 고쳤다 | 1.4 | 1.5 · 1.8 | 넷리스트가 흔들리면 노드와 평가가 다 흔들린다 |
| 문서 의존이 바뀌었다 | 1.6 | 1.8 · (3·4단계) | |
| **목적이 바뀌었다** | **1.0 · 1.1** | **전부** | |

무엇이 무효가 됐는지는 `requirementLinks[]`가 답한다. 그게 그 표가 존재하는 이유다.

---

## 8. 고정 시험 자료

검증을 두 층으로 나눈다(기획서 §8) — **CI는 고정 자료로, 실물 수락 시험은 구현이 끝난 뒤에.**

| 경로 | 무엇 | 상태 |
| --- | --- | --- |
| `core/src/ir/__fixtures__/valid.ir.yaml` | 모든 검사를 통과하는 최소 IR 1개 (부록 A) | ✅ 26/26 |
| `core/src/ir/__fixtures__/guides/` | 그 IR이 가리키는 안내 문서. **후보 6개 중 4개만 쓴다** | ✅ |
| `core/src/ir/__fixtures__/fail-cases.yaml` | 칸별 실패 26건 — 검사마다 1건 | ✅ 26건이 각자 제 검사를 깨뜨린다 |
| `core/src/runs/__fixtures__/success.json` · `refused.json` · `timeout.json` | 실행 기록 세 상태 | ✅ 필수 12필드 |
| `core/src/runs/__fixtures__/from-failure.expected.json` | 실패 기록 → `evals[]` 초안의 예상 결과 | ✅ |

검증: `docs/절차/고정자료-검증_20260929_v1.mjs`.

**실패 자료를 IR 파일 26개로 두지 않는다 — 한 파일에 최소 변형만 적는다.**

```yaml
- check: 1.2/model-declared
  why: 1.0이 모델을 요구하는데 부를 모델이 없다
  ops: [{ set: "models", to: [] }]
```

사본 26개는 서로 드리프트하고, 사본을 열었을 때 「이 검사가 무엇 때문에 깨지는지」가
IR 전체에 묻힌다. 최소 변형만 적으면 **자료가 곧 검사의 뜻**이 된다.
경로(`state[1].default`)는 **반드시 따옴표로** 묶는다 — flow 표기 안에서 `[`는 시퀀스 시작이다.

검증기는 「지목한 검사가 깨지나」만 본다. **같이 깨지는 검사는 막지 않는다** — 한 칸이 무너지면
다른 칸도 흔들리는 것이 설계의 사실이고, 무효 전파(§7.3)가 말하는 바다.

| 규칙 | 내용 |
| --- | --- |
| CI는 실제 모델 API를 부르지 않는다 | 고정 응답 어댑터로 성공·거절·타임아웃을 재현한다 |
| CI는 외부 레포에 의존하지 않는다 | 외부 레포의 미커밋 상태에 회귀 검사가 매달리면 제 구실을 못 한다. **고정 자료는 자기 폴더 안에서 닫힌다** |
| 새 검사는 실패 자료를 먼저 만든다 | 통과부터 만들면 검사가 아무것도 안 잡아도 초록이다 |
| 실물 수락 시험은 **구현이 끝난 뒤** | 구현 중에 대상 레포를 고치지 않고, 그 내용을 명세·고정 자료에 끌어오지도 않는다. 수락 시험 때 **처음부터** 한 바퀴 돈다 (사용자 결정 2026-09-28) |

---

## 9. 채택값 (이 절이 이긴다)

| # | 항목 | 값 |
| --- | --- | --- |
| 1 | IR이 사는 곳 | `overlay.yaml`의 `ir` 절. `process` 확장 아님 |
| 2 | 초안 | `~/.patchbay/projects/<alias>/ir.proposed.yaml` |
| 3 | 보관본 | `~/.patchbay/projects/<alias>/versions/<n>/{ir.yaml, evals.json, adopted.json}` |
| 4 | 실행 기록 | `~/.patchbay/projects/<alias>/test-runs/<runId>.json` |
| 5 | 쓰기 경로 | `patchbay ir adopt` 하나. `--force` 없음. DRC 실패면 거절 |
| 6 | 키 표기 | 기계 키는 영어 camelCase, 값은 한국어 자유 문장 |
| 7 | IR 형식 버전 | `schemaVersion: 1` |
| 8 | 설계 버전 원본 | `overlay.ir.version`. `host.json.version` 아님 |
| 9 | 민감도 | `level: 0..4`. `reads`·`emits`·`documents`에서만 |
| 10 | 능력 | `cap:read` · `cap:draft` · `cap:pr` · `cap:external` 넷 고정 |
| 11 | reducer | `append` · `lastWrite` · `custom` 셋 고정 |
| 12 | EARS | `ubiquitous` · `event` · `state` · `unwanted` · `optional` 다섯 고정. Unwanted ≥ 1 |
| 13 | 예약 노드 id | `__start__` · `__end__`. `nodes[]`에 적지 않음 |
| 14 | 실행 상태 | `success` · `error` · `timeout` · `refused` 넷 고정 |
| 15 | 첫 실행 기록 공급자 | 로컬 LangGraph HTTP (`http://127.0.0.1:2024`) |
| 16 | 모델 타임아웃 기본 | `20000` ms |
| 17 | 추적 표 원본 | `requirementLinks[]`. `evals[].covers` 아님 |
| 18 | 검사 회귀 기준 | 실패한 검사 id와 돌아갈 칸. 통과 **개수**가 아님 |
| 19 | caps 런타임 강제 | **하지 않는다.** 선언을 요구하고 어긋남을 띄운다 |
| 20 | 사이드카 바인드 | Neo4j·콘솔 기본 `127.0.0.1`. 콘솔 원격은 `patchbay flow --host` 명시 선택 |

---

## 10. 이 명세가 하지 않는 것

- **IR ↔ 코드 왕복 동기화** — 생성은 한 방향이다(원칙 3). 두 번째 생성이 사람 수정을 덮지 않는다
- **트레이스 뷰어** — 시계열은 외부 관측 도구. Patchbay는 설계와 실물을 대조한다
- **트레이스·토큰 로그를 Neo4j에** — 시간 순 append는 그래프 DB에서 비대해진다
- **caps 런타임 강제** — §4.3
- **벡터 인덱스 · 자작 리랭커** — 기획서 §5의 유보 조건 전까지
- **다섯 번째 능력 등급** — 되돌림 × 외부 영향으로 자르면 넷이다
- **파일명 개명** — `ATLAS.md` → `구조요약.md` 등은 용어 작업 4단계다. 이 명세는 현재 파일명을 쓴다

---

## 11. 자가 점검

| 중지 조건 (여섯 질문) | 닫혔나 | 어디 |
| --- | --- | --- |
| 1. 필드 타입·필수·기본값 | ✅ | §3.1~3.7 — 17개 절 |
| 2. 유일한 쓰기 경로 | ✅ | §2.3 — `ir adopt` |
| 3. `caps[]` 집행 지점 | ✅ | §4.3 — 네 곳 + 런타임 강제 안 함 |
| 4. 식별자 연결 | ✅ | §5.4 — 설계는 `requirementLinks`, 실행은 `(irVersion, nodeId)` |
| 5. 버전 보관 | ✅ | §6 — `versions/<n>/` |
| 6. 첫 어댑터 | ✅ | §5.5 — 로컬 LangGraph |

**M1이 아직 남긴 것** (이 문서 밖의 산출물):

| 남은 것 | 어디 | 왜 지금이 아닌가 |
| --- | --- | --- |
| 유효 IR 고정 자료 | `__fixtures__/valid.ir.yaml` | **부록 A를 파일로 옮기면 된다** — 26/26 통과를 이미 확인했다 |
| 칸별 실패 고정 자료 | `__fixtures__/fail-*.ir.yaml` | §7.1의 「실패 예시」 열이 목록이다 |
| 실행 기록 고정 자료 3개 | `runs/__fixtures__/` | §5.2 형식으로 **손으로 쓴다.** 실제 공급자 응답과의 대조는 M6 어댑터의 일이다 — 고정 자료가 살아 있는 런타임에 매달리면 CI가 다시 외부에 묶인다 |
| 한국어 키 초안 변환 | §3.8 변환표 | 실물 수락 시험은 구현이 끝난 뒤 처음부터 돈다 — 지금 옮길 초안이 없다 |

이 넷이 끝나면 M1이 닫히고 M2(스키마·DRC 구현)로 간다.

---

## 부록 A. 유효한 IR 예시

**고정 시험 자료용 가상 프로젝트다. 실물 레포를 가리키지 않는다.**
문서 경로는 고정 자료 폴더 안(`__fixtures__/guides/`)을 가리키므로 `1.6`의 파일 존재 검사가
외부 레포 상태에 매달리지 않는다 — 구현준비 2.5가 정한 「외부 레포에 의존하지 않는다」가 이것이다.

§7.1의 검사 26개를 **실제로 돌려 26/26 통과를 확인했다** (2026-09-29):

```
cd dev/packages/core
node ../../../docs/절차/명세검사-DRC_20260929_v1.mjs <ir.yaml> <고정 자료 루트>
→ 26 / 26 통과 · 게이트 통과 — 2단계로
   1.6/doc-exists    4개 확인
   1.6/doc-coverage  후보 6개 중 4개를 쓴다
```

**검사 목록의 원본은 커널이다** (2026-09-29, M2) — `dev/packages/core/src/ir/checks.ts`.
`docs/절차/명세검사-DRC_20260929_v1.mjs`는 고정 자료 검증기가 쓰는 시험 구현으로 남는다.
검사를 고칠 때는 커널을 먼저 고친다.

```yaml
# 고정 시험 자료. 실물 프로젝트가 아니다 — 검사 26개가 무엇을 보는지 한 파일로 보여 주는 것이 목적이다.
schemaVersion: 1
version: 1
project: fixture-agent
graph: triage

why:
  alternative: 갈래 나누기(버그·요청·질문)는 키워드 표로 충분하다.
  modelNeed: 왜 그 갈래로 골랐는지 근거 문장 한 줄을 쓰는 것. 표로는 안 된다.
  verdict: 갈래는 표가 정하고, 고른 이유만 모델이 쓴다.
  needsModel: true

goal: 기록 한 건을 넣으면 갈래 하나와 그 근거 한 줄, 다음에 볼 안내 문서 한 개가 나온다.
done:
  - 안내 문서 경로가 실제로 존재하는 파일이다
  - 근거 한 줄이 입력 문장 중 하나를 인용한다
  - 갈래가 세 값 중 하나로 정해진다

caps:
  - id: cap:read
    scope: inbox/** 와 guides/** 를 읽는다
    undo: 아무것도 바꾸지 않는다
    humanApproval: false
  - id: cap:draft
    scope: out/triage.md 에 초안을 쓴다
    undo: 지우면 된다
    humanApproval: false
  - id: cap:pr
    scope: guides/** 를 고친다
    undo: 번거롭다 — 커밋을 되돌려야 한다
    humanApproval: true
  - id: cap:external
    scope: 입력 문장을 모델 공급자에게 보낸다
    undo: 되돌릴 수 없다 — 보낸 것은 회수하지 못한다
    humanApproval: false

tools:
  - id: write-draft
    caps: [cap:draft]
    what: out/triage.md 에 결과를 적는다
    irreversible: false
  - id: edit-guide
    caps: [cap:pr]
    what: 안내 문서를 고친다
    irreversible: true

models:
  - id: claude-opus-5
    provider: anthropic
    caps: [cap:external]
    usedBy: [explain]
    timeoutMs: 20000

reads:
  - { path: inbox/**, level: 2 }
  - { path: guides/**, level: 1 }
emits:
  - what: 입력 기록의 원문을 모델에 보낸다
    level: 2
    to: external
    reason: 작업 등급이라 비밀은 아니지만 밖으로 나가므로 cap:external 이다

state:
  - { field: messages, type: "BaseMessage[]", reducer: append,    default: "[]" }
  - { field: input,    type: string,          reducer: lastWrite, default: '""' }
  - { field: kind,     type: string,          reducer: lastWrite, default: '""' }
  - { field: reason,   type: string,          reducer: lastWrite, default: '""' }
  - { field: guide,    type: string,          reducer: lastWrite, default: '""' }

nodes:
  - { id: intake,   label: 받아적기,        reads: [messages],      writes: [input] }
  - { id: classify, label: 갈래 정하기,      reads: [input],         writes: [kind] }
  - { id: explain,  label: 고른 이유 쓰기,   reads: [input, kind],   writes: [reason], models: [claude-opus-5] }
  - { id: pick,     label: 안내 문서 고르기, reads: [input, kind, reason], writes: [guide, messages],
      tools: [write-draft], documents: [D1, D2, D3, D4] }
edges:
  - { from: __start__, to: intake }
  - { from: intake,    to: classify }
  - { from: classify,  to: explain }
  - { from: classify,  to: pick, when: 모델 호출이 거절되거나 20초를 넘기면 근거 없이 안내 문서만 준다 }
  - { from: explain,   to: pick }
  - { from: pick,      to: __end__ }

documents:
  - { id: D1, node: pick, path: guides/bug.md,      level: 1, when: 갈래가 버그 }
  - { id: D2, node: pick, path: guides/request.md,  level: 1, when: 갈래가 요청 }
  - { id: D3, node: pick, path: guides/question.md, level: 1, when: 갈래가 질문 }
  - { id: D4, node: pick, path: guides/unknown.md,  level: 1, when: 갈래를 못 정했을 때 }

# EARS 문장에는 쉼표가 들어간다. flow 표기(`{ }`)에서 쉼표는 항목 구분자라 문장이 쪼개진다 —
# 요구사항과 평가는 블록 표기로 적는다.
requirements:
  - id: R1
    pattern: ubiquitous
    text: 시스템은 기록 하나마다 안내 문서 경로를 하나 준다.
  - id: R2
    pattern: event
    text: When 새 기록이 들어오면, 시스템은 갈래를 다시 정한다.
  - id: R3
    pattern: state
    text: While kind 가 비어 있으면, 시스템은 안내 문서를 고르지 않는다.
  - id: R4
    pattern: unwanted
    text: If input 이 비어 있으면, 시스템은 안내 문서를 고르지 말고 "입력이 비었다"고 답한다.
  - id: R5
    pattern: unwanted
    text: If 고른 안내 문서가 실제로 없으면, 시스템은 없다고 답하고 다른 문서를 고르지 않는다.
  - id: R6
    pattern: unwanted
    text: If 모델이 근거 쓰기를 거절하거나 20초를 넘기면, 시스템은 갈래와 문서만 주고 근거는 비워 둔다.

evals:
  - id: E1
    node: pick
    kind: deterministic
    input: "버그 한 건 — 저장 버튼이 두 번 눌린다"
    expect: kind 가 "bug" 이고 안내 문서 경로가 존재하는 파일이다
  - id: E2
    node: intake
    kind: deterministic
    input: 기록 하나를 덧붙인 입력
    expect: 갈래가 새 기록 기준으로 다시 정해진다
  - id: E3
    node: pick
    kind: deterministic
    input: 'kind == ""'
    expect: 안내 문서를 고르지 않는다
  - id: E4
    node: intake
    kind: deterministic
    input: '""'
    expect: '"입력이 비었다"를 답하고 문서 경로가 없다'
  - id: E5
    node: pick
    kind: deterministic
    input: 존재하지 않는 문서 경로
    expect: 없다고 답하고 다른 문서를 고르지 않는다
  - id: E6
    node: explain
    kind: model
    input: 고정 응답 어댑터의 거절 응답과 20초 초과 응답
    scoring: 근거 한 줄이 입력 문장을 인용했는지 사람이 1~5로 채점한다
    expect: reason 이 빈 문자열이고 guide 는 정상으로 채워진다

requirementLinks:
  - { requirement: R1, node: pick,     eval: E1 }
  - { requirement: R2, node: intake,   eval: E2 }
  - { requirement: R3, node: pick,     eval: E3 }
  - { requirement: R4, node: intake,   eval: E4 }
  - { requirement: R5, node: pick,     eval: E5 }
  - { requirement: R6, node: explain,  eval: E6 }
```

### 같이 만들어야 하는 파일

`1.6/doc-exists`와 `1.6/doc-coverage`가 파일을 실제로 본다. 고정 자료 루트에 이만큼이 있어야 한다.

```
__fixtures__/
├── valid.ir.yaml        위 내용
└── guides/              후보 6개 중 4개를 IR이 쓴다 (coverage 검사의 재료)
    ├── bug.md  request.md  question.md  unknown.md      ← 선언된 4개
    └── stale-a.md  stale-b.md                            ← 일부러 안 쓰는 2개
```

안 쓰는 파일 2개를 일부러 두는 이유: `1.6/doc-coverage`가 **무엇을 재는 검사인지** 자료가 보여 줘야
한다. 전부 쓰는 자료만 있으면 그 검사는 아무것도 안 잡아도 늘 초록이다.

### 이 예시가 보여 주는 것

| 검사 | 자료 안의 어디 |
| --- | --- |
| `1.2/model-declared` | `why.needsModel: true` + `models[]` 1개 |
| `1.2/irreversible-approval` | `edit-guide`가 `irreversible: true` → `cap:pr`이 `humanApproval: true` |
| `1.3/external-cap` | `emits[].to: external` → `cap:external` 선언 |
| `1.5/can-end` | 거절·타임아웃 분기(`classify → pick`)가 있어 모델이 죽어도 끝에 닿는다 |
| `1.6/doc-coverage` | 후보 6개 중 4개 |
| `1.7/unwanted` | R4·R5·R6 — 빈 입력 · 없는 파일 · 모델 거절 |
| `1.8/eval-scoring` | E6이 `kind: model`이라 `scoring`이 붙는다 |

**실물 프로젝트를 여기에 넣지 않는다.** 검증은 두 층이고(기획서 §8), 이 자료는 CI 층이다.
실물 수락 시험은 **구현이 끝난 뒤** 대상 프로젝트를 처음부터 한 바퀴 돌려서 한다 — 그때의 IR은
이 자료가 아니라 그 프로젝트에서 새로 만든다.
