---
name: adopt-project
description: 기존 문서·커밋에서 기획 의도와 진행 상태를 발굴한 뒤 사용자 확인을 받아 기록한다. 기존 CLAUDE.md/rules는 덮어쓰지 않고 diff로만 보강한다. 확인 전에는 progress.yaml.current에 추정값을 쓰지 않는다.
---

# adopt-project

기획 6.2절의 실물화. 이미 코드와 이력이 있고 서사가 살아있는 프로젝트를 스튜디오에 들일 때 쓴다. **새로 쓰지 않는다 — 있는 걸 발굴하고, 사람에게 맞는지 확인받는다.**

## 언제 쓰는가

`patchbay project add --path <path> --alias <alias>`로 프로젝트가 이미 등록된 직후(클리어리티 게이트를 통과했다는 뜻 — 커널의 결정적 스캔은 이미 끝났다). `triage-project`에서 "발견된 의도 이어가기"를 선택해 넘어온 경우도 여기로 들어온다 — 이때는 정리된 클러스터가 발굴 입력 자료가 된다.

## 핵심 규칙 (반드시 지킬 것)

- **발굴 후 확인** — 문서·커밋에서 읽어낸 내용을 사람에게 "이렇게 이해했는데 맞나요?"로 제시한다. 스스로 지어내지 않는다.
- **확인 전에는 `progress.yaml.current`에 추정값을 쓰지 않는다.** 커밋 패턴으로 "지금 이걸 하고 있는 것 같다"를 추정하는 건 괜찮지만, 사람이 맞다고 확인하기 전까지는 그 추정을 `patchbay progress write`로 기록하지 않는다. (이 스킬 자신의 시작/종료 기록은 예외 — 아래 절차의 progress write 호출은 이 스킬의 실행 상태를 남기는 것이지, 대상 프로젝트의 추정 현재 작업이 아니다.)
- 기존 `CLAUDE.md`/`AGENTS.md`/`.cursor/rules`가 있으면 **절대 덮어쓰지 않는다** — diff로 보강만 제안한다.

## 절차

1. **시작 기록**: `patchbay progress write --project <alias> --summary "adopt-project: 기획 의도 발굴 시작" --skill adopt-project --step start`

2. **재료 수집**: `patchbay atlas --project <alias> --level 2`(또는 MCP `get_atlas`/`get_project_bundle`)로 이미 끝난 결정적 스캔 결과(Skills/Rules/Unlabeled ports/Gaps)를 읽는다. 대상 레포의 README, 커밋 로그, 기존 기획/설계 문서가 있다면 직접 읽는다.

3. **기획 의도를 L1/L2로 발굴해 제시한다.** "한 줄 정의"와 "왜 이 프로젝트가 존재하는가" 수준을 문서·커밋 메시지 패턴에서 뽑아 사람에게 보여주고, 맞다/틀리다로 정정받는다. 근거 없는 추측은 하지 않는다 — 근거가 부족하면 "잘 모르겠다, 직접 알려달라"고 정직하게 묻는다.

4. **진행 상태 추정.** 최근 커밋 메시지/변경 패턴을 보고 "지금 대략 이런 걸 하고 있는 것 같다"는 가설을 세워 사람에게 보여준다. 사람이 확인(또는 정정)한 뒤에만:
   `patchbay progress write --project <alias> --summary "<확인된 현재 작업 요약>"`
   확인받지 못했으면 이 호출을 하지 않는다 — 불확실한 채로 남겨둔다.

5. **계획 문서.** 대상 레포에 이미 `ROADMAP.md`나 그에 준하는 계획 문서가 있으면 내용을 확인차 보여준다. 없으면 3번에서 발굴한 내용을 바탕으로 사람에게 짧게 몇 가지만 물어 `ROADMAP.md`를 역산해서 쓴다(새로 설계하는 게 아니라 이미 벌어진 일을 정리하는 것).

6. **CLAUDE.md/AGENTS.md/.cursor rules 보강.** 기존 파일이 있으면 **덮어쓰지 않고** diff(추가할 내용)만 제안한다. 없으면 3번에서 발굴한 내용을 바탕으로 새로 스캐폴딩해도 된다.

7. **승인**: 4~6번에서 쓴/제안한 내용을 사람에게 diff로 보여주고 승인을 구한다.

8. **종료 기록**: `patchbay progress write --project <alias> --summary "adopt-project: 발굴 완료, 공통 루프 진입" --skill adopt-project --step done`. 사람에게 6.4 공통 루프(`map-project`/`propose-ontology`/`propose-dashboard`)로 이어갈 수 있다고 안내한다.

## 하지 않는 것

- 기존 `CLAUDE.md`/`AGENTS.md`/`.cursor/rules`를 덮어쓰지 않는다 — 예외 없음.
- 사람이 확인하기 전에 추정한 현재 작업을 `progress.yaml.current`에 쓰지 않는다.
- 문서·커밋에 근거가 없는 기획 의도를 지어내지 않는다.
