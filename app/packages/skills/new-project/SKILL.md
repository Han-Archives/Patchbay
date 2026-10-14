---
name: new-project
description: 빈 프로젝트에 대해 대화형 설계 인터뷰를 진행하고 기획 스냅샷 + docs/기획/(목표·방향·채택) + docs/절차/ + ROADMAP.md + CLAUDE.md/AGENTS.md/.cursor rules 초안을 대상 프로젝트 레포 안에 쓴다. "빠른 시작" 모드를 지원한다.
---

# new-project

기획 6.1절의 실물화. 아직 코드도 서사도 없는 빈 캔버스에 대해 사람에게 설계 질문을 던지고, 그 답을 **프로젝트 자체 문서**(9.6절 — 스튜디오 메타 문서와 다르다)로 남긴다. 세 온보딩 시나리오 중 유일하게 그 자체로 완결되는 경로다.

## 언제 쓰는가

사용자가 "새 프로젝트 시작하자"라고 하거나, `patchbay project new <alias> --path <path>`를 이미 실행해 빈 프로젝트가 스튜디오에 등록된 직후. `triage-project`에서 "처음부터 설계 다시 잡기"를 선택해 넘어온 경우도 여기로 들어온다 — 이때는 정리된 클러스터 내용이 아래 인터뷰의 기본값을 채운다.

## 핵심 규칙 (반드시 지킬 것)

- 문서는 **대상 프로젝트 레포 안**에 쓴다, studio 홈이 아니다 — 9.6절 구분을 지킨다: `docs/<alias>_기획_YYYYMMDDa.md`(스냅샷), `docs/기획/`(목표·방향·채택), `docs/절차/`, `ROADMAP.md`, `CLAUDE.md`/`AGENTS.md`/`.cursor/rules`.
- "빠른 시작" 모드라도 1번(한 줄 정의)과 6번(성공 조건)은 반드시 사람에게 직접 물어본다 — 그 외 항목만 기본값으로 채운다.
- 방향은 서로 다른 md로 펼친 뒤 채택한다. 한 방향만 적고 구현으로 건너뛰지 않는다.
- 사람이 파일 내용을 승인하기 전까지 `patchbay scan`을 실행하지 않는다.

## 절차

1. 아직 `patchbay project new <alias> --path <path>`가 실행되지 않았다면 먼저 실행한다(빈 디렉터리를 만들고 스튜디오에 등록만 하는 단계 — 스캔은 아직 없다). **`progress write`는 이미 등록된 alias만 받으므로(미등록 alias는 exit 1) 이 등록이 반드시 다음 단계보다 먼저 끝나 있어야 한다.**

2. **시작 기록**: `patchbay progress write --project <alias> --summary "new-project: 설계 인터뷰 시작" --skill new-project --step start`

3. **대화형 인터뷰.** 전체 모드는 여섯 가지를 순서대로 묻는다:
   1. 한 줄 정의 — 이 프로젝트가 뭔지 한 문장
   2. 문제 — 왜 필요한지
   3. 1차 사용자 — 누가 쓰는지
   4. 쓸 면 — 콘솔 네 탭(프로젝트/흐름/지식/캔버스) 중 뭘 쓸 건지, 또는 자유 서술. 다섯 번째 탭은 제안하지 않는다.
   5. 비범위 — 이번엔 하지 않을 것
   6. 성공 조건 — 뭘 봐야 "됐다"고 판단할지

   **빠른 시작**을 요청하면 1번과 6번만 묻고, 2~5번은 합리적인 기본값(문제=1번에서 유추, 1차 사용자=미정, 쓸 면=콘솔 네 탭, 비범위=명시 안 함)으로 채운 뒤 그 기본값을 사람에게 보여주며 맞는지 확인한다 — 묻지 않고 그냥 채우지 않는다.

4. `docs/<alias>_기획_YYYYMMDDa.md`를 프로젝트 레포 안에 쓴다. 인터뷰 답변을 그대로 담는 **스냅샷**이다 — 지어내지 않는다. 이 스튜디오 자신의 기획서 컨벤션(`YYYYMMDDa`/`b`/`c` 버전 문자)을 따른다.

4.5 **구성 단계 폴더.** 스냅샷만으로 끝내지 않는다.
   - `docs/기획/README.md` — 목표 → 방향 md → 채택 → 절차 순서
   - `docs/기획/목표_YYYYMMDDa.md` — 한 줄 정의와 성공 조건
   - `docs/기획/방향_<짧은이름>_YYYYMMDDa.md` 최소 둘. 상태는 `제안`으로 시작한다. 사람이 고르기 전에 구현 폴더를 만들지 않는다.
   - 사람이 고르면 `docs/기획/채택_YYYYMMDDa.md`에 채택/보류/보완 표를 쓰고, overlay `decisions`에 같은 요약을 남긴다. 콘솔 프로젝트 탭 **기획 결정**이 여기를 읽는다.
   - `docs/절차/README.md`와 번호 파일 — 실제로 한 일. 채팅에만 두지 않는다.
   - `progress write --skill plan-stage`(또는 이 스킬)로 목표·채택 단계를 남긴다.

5. `ROADMAP.md`를 같은 레포 루트에 쓴다. 기획서에서 도출한 대략적 단계(Phase) 목록. Phase 0은 기획이다.

6. `CLAUDE.md`/`AGENTS.md`/`.cursor/rules`를 새로 스캐폴딩한다. 각 파일이 `docs/기획/`을 소스 오브 트루스로 참조하게 한다. 스냅샷 경로도 적는다.

7. `<studioHome>/skills/`(Skill Bay)를 살펴보고 이 프로젝트 성격에 맞을 만한 스킬을 추천한다. 사람이 고르면 `patchbay patch <skill> <alias>`로 설치한다.

8. 지금까지 쓴 파일들을 사람에게 diff/내용으로 보여주고 승인을 구한다. 승인되면:
   - `patchbay scan --project <alias>` 실행 — 이제 파일이 생겼으니 처음으로 실제 스캔이 돈다(`inferred.json`/`ATLAS.md`/`ATLAS.digest.md`/`FLOW.md` 생성).
   - `patchbay progress write --project <alias> --summary "new-project: 설계 인터뷰 완료, 공통 루프 진입" --skill new-project --step done`
   - 사람에게 6.4 공통 루프(`map-project`/`propose-ontology`/`propose-dashboard`)로 이어갈 수 있다고 안내한다.

## 하지 않는 것

- studio 홈 쪽 파일(`ATLAS.md`, `FLOW.md`, `DASHBOARD.md` 등)을 직접 쓰지 않는다 — 그건 `scan`과 propose-* 스킬의 일이다.
- 사람이 승인하기 전에 `patchbay scan`을 실행하지 않는다.
- 인터뷰 답 없이 기획서 내용을 지어내지 않는다 — 빠른 시작의 기본값도 반드시 사람에게 보여주고 확인받는다.
- 방향이 `제안`인 채로 강의·코드 폴더를 만들지 않는다.
