---
name: propose-ontology
description: 등록된 프로젝트의 스캔 재료(get_project_bundle)를 바탕으로 ontology/<alias>.yaml 초안을 작성한다. 확정 파일은 절대 건드리지 않는다 — 언제나 .proposed.yaml에만 쓴다.
---

# propose-ontology

원칙 3("제안은 호스트 모델이 한다")의 첫 실물. 이 스킬을 실행하는 건 항상 **호스트 LLM 자신**이다 — 커널(Core/CLI/MCP)은 온톨로지를 절대 쓰지 않고, 재료(`get_project_bundle`)와 쓸 위치만 알려준다.

## 핵심 규칙 (반드시 지킬 것)

- **언제나 `ontology/<alias>.proposed.yaml`에만 쓴다.** `ontology/<alias>.yaml`(확정본)이 이미 있든 없든 상관없다 — 처음 제안하는 것도 곧바로 확정 경로에 쓰지 않는다. 사람이 diff를 보고 직접 `ontology/<alias>.yaml`로 승격(복사/이름변경)하기 전까지는 초안일 뿐이다.
- 확정 파일이 이미 있으면, 그 내용을 참고해서 **겹치지 않게, 기존 라벨을 보존하며** diff를 만든다 — 처음부터 다시 쓰지 않는다.
- 새 온톨로지 클래스를 만들지 않는다. v0 스키마(아래)를 벗어나지 않는다.

## 스튜디오 홈 경로 찾기

이 스킬은 MCP/CLI가 아직 노출하지 않는 한 가지를 직접 계산해야 한다 — 스튜디오 홈의 절대 경로:
1. 환경변수 `PATCHBAY_HOME`이 설정돼 있으면 그 값.
2. 없으면 `~/.patchbay`.

쓸 파일 경로: `<studioHome>/ontology/<alias>.proposed.yaml` (확정본은 `<studioHome>/ontology/<alias>.yaml`, 참고용으로만 읽는다).

## 절차

1. **시작 기록**: `patchbay progress write --project <alias> --summary "propose-ontology: 초안 작성 시작" --skill propose-ontology --step start`

2. **재료 수집**: MCP `get_project_bundle({ alias, scope: "full" })`를 호출한다. 이게 주는 것:
   - `atlas` — 지금까지 알려진 Skills/Rules/Unlabeled ports/Gaps
   - `graph` — 노드/엣지 구조
   - `excerpts` — 발견된 신호 파일(README/AGENTS.md/CLAUDE.md/.cursor rules)의 실제 내용(최대 2000자, 잘렸으면 `truncated: true`)

3. **확정 파일 확인**: `<studioHome>/ontology/<alias>.yaml`이 존재하는지 확인한다.
   - 있으면: 읽어서 기존 `ports[].id`(라벨된 것들)를 파악하고, 새로 제안할 내용이 그것과 충돌하지 않게 한다.
   - 없으면: 처음부터 초안을 짠다 (그래도 `.proposed.yaml`에만 쓴다).

4. **초안 작성** — v0 최소 스키마 (명세 7.3절):
   ```yaml
   version: 1
   alias: <alias>
   ports:
     - id: <PortId, 예: source:README.md>
       label: <한 줄 설명, excerpts 내용을 바탕으로>
   concepts: []
   ```
   - `ports`에는 `atlas.unlabeledPorts`에 나온 발견된 스킬(skill: 포트)과, `excerpts`로 실제 내용을 읽은 신호 파일(source: 포트)들을 우선 포함한다 — 이게 바로 "라벨 없는 잭에 라벨을 붙이는" 작업이다.
   - `label`은 excerpts 내용을 실제로 읽고 판단해서 쓴다 — 파일 이름만 보고 추측하지 않는다.
   - `concepts`는 v0에서는 빈 배열로 둬도 된다. 프로젝트 성격이 명확히 보이면(excerpts에서 뚜렷한 도메인 개념이 드러나면) 1~3개 정도만 조심스럽게 제안한다. 억지로 채우지 않는다 — 빈 배열이 "아직 모른다"는 정직한 신호다.

5. **파일 쓰기**: `<studioHome>/ontology/`가 없으면 만들고, `<alias>.proposed.yaml`을 쓴다. **`<alias>.yaml`(확정본)은 절대 쓰지 않는다.**

6. **사람에게 안내**: 뭘 어디에 썼는지, 스튜디오 홈이 자체 git 레포이니 `cd <studioHome> && git diff`(또는 `git status`)로 리뷰할 수 있다는 것, 승인하려면 `<alias>.proposed.yaml`을 `<alias>.yaml`로 직접 옮기면 된다는 것을 알려준다.

7. **종료 기록**: `patchbay progress write --project <alias> --summary "propose-ontology: 초안 작성 완료 (port N개)" --skill propose-ontology --step done`

## 하지 않는 것

- `ontology/<alias>.yaml`(확정본)을 직접 쓰지 않는다 — 예외 없음.
- 새 온톨로지 클래스를 만들지 않는다.
- excerpts에 없는 내용을 지어내지 않는다 — 모르면 빈 채로 둔다.
