---
name: propose-dashboard
description: 등록된 프로젝트의 스캔 재료를 바탕으로 DASHBOARD.md 초안(View 4~7개 + 계측 갭)을 작성한다. 확정 파일은 절대 건드리지 않는다 — 언제나 DASHBOARD.proposed.md에만 쓴다.
---

# propose-dashboard

v1 대시보드는 위젯 런타임이 아니라 **가이드 스펙**이다(기획 5.4절). "이 화면들을 보라"는 제안과, 그걸 보려면 실제로 뭘 계측해야 하는지("계측 갭")를 같이 준다.

## 핵심 규칙 (반드시 지킬 것)

- **언제나 `<studioHome>/projects/<alias>/DASHBOARD.proposed.md`에만 쓴다.** 확정본(`DASHBOARD.md`)이 있든 없든, 처음이든 아니든 마찬가지다.
- 새 온톨로지 클래스를 만들지 않는다 — View는 이미 있는 클래스이고, `signals: PortId[]`(kind: signal)를 갖는다.
- 지금 시점엔 **`signal:` 종류 포트를 스캐너가 전혀 발견하지 않는다** (v1 스캐너는 source/skill만 찾는다). 그래서 이 스킬이 제안하는 View는 거의 항상 `signals: []`(비어 있음)일 것이다 — 이게 버그가 아니라 바로 "계측 갭"이다. 이 점을 정직하게 드러내는 게 이 스킬의 핵심 가치다.

## 절차

1. **시작 기록**: `patchbay progress write --project <alias> --summary "propose-dashboard: 초안 작성 시작" --skill propose-dashboard --step start`

2. **재료 수집**: MCP `get_project_bundle({ alias, scope: "full" })`를 호출해서 atlas/graph/excerpts를 읽는다.

3. **View 4~7개를 제안한다.** 각 View는:
   ```yaml
   id: <짧은 슬러그, 예: build-health>
   name: <사람이 읽을 제목>
   description: <이 화면이 뭘 보여주려는 건지 한두 문장>
   signals: []   # 거의 항상 비어있음 — 아래 "계측 갭"에서 왜인지 설명
   ```
   실제 프로젝트 종류/재료(atlas의 Skills·Rules, excerpts 내용)를 보고 그 프로젝트에 실제로 의미 있는 View를 고른다 — 아무 프로젝트에나 똑같이 복사할 수 있는 템플릿 문구를 쓰지 않는다. 예를 들어 CLI 도구라면 "명령 사용 빈도", 라이브러리라면 "API 채택률" 같은 식으로, 재료에서 실제로 근거를 찾을 수 있는 View만 제안한다. 근거가 부족하면 4개 미만이어도 된다 — 개수를 채우려고 억지로 지어내지 않는다.

4. **계측 갭을 명시적으로 적는다.** 제안한 View마다: "이 화면을 실제로 채우려면 지금 없는 무슨 신호(Signal)가 필요한가"를 한 줄로 적는다. 예: "build-health를 채우려면 CI 결과를 signal:ci/status 같은 포트로 발견할 수 있어야 하는데, v1 스캐너는 아직 이런 신호를 찾지 않는다."

5. **파일 쓰기**: `<studioHome>/projects/<alias>/`가 없으면 만들고(보통 이미 있음, `project add`가 만듦), `DASHBOARD.proposed.md`를 쓴다. 구조:
   ```markdown
   # Dashboard (제안)

   ## Views

   ### <id>: <name>
   <description>

   **계측 갭**: <위 4번 내용>

   (View마다 반복)
   ```

6. **사람에게 안내**: 어디에 썼는지, 승인하려면 `DASHBOARD.proposed.md`를 `DASHBOARD.md`로 직접 옮기면 된다는 것을 알려준다.

7. **종료 기록**: `patchbay progress write --project <alias> --summary "propose-dashboard: 초안 작성 완료 (View N개)" --skill propose-dashboard --step done`

## 하지 않는 것

- `DASHBOARD.md`(확정본)를 직접 쓰지 않는다 — 예외 없음.
- 위젯이나 실행 가능한 대시보드 코드를 만들지 않는다 — 이건 스펙 문서일 뿐이다.
- 근거 없이 신호가 있는 척(`signals`를 억지로 채우기) 하지 않는다.
