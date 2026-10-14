---
name: triage-project
description: 포렌식 스캔(excavation.json) 결과로 클러스터 가설을 카드로 제시하고, 사용자 확인을 받아 분리/병합/아카이브 diff를 만든다. 삭제하지 않는다. 독립 종착점이 아니다 — 완료 후 반드시 new-project 또는 adopt-project로 안내한다.
---

# triage-project

기획 6.3절의 실물화. 서사가 없거나 깨진, 또는 여러 아이디어가 뒤섞인 폴더를 정리한다. 세 온보딩 시나리오 중 유일하게 **그 자체로 끝나지 않는 경로**다 — 반드시 A(`new-project`) 또는 B(`adopt-project`)로 합류시켜야 한다.

## 언제 쓰는가

- 사용자가 `patchbay project triage --path <path>`를 이미 실행해 `excavation.json`이 생긴 직후.
- `patchbay project add`가 clarity score 40 미만이라 exit 2로 거절하며 이 스킬을 권했을 때.

이 스킬 자신은 스캔을 실행하지 않는다 — 커널의 결정적/포렌식 스캔(LLM 없음)이 이미 만든 `excavation.json`을 재료로 삼아 사람과 함께 정리할 뿐이다. `excavation.json`이 없으면 먼저 `patchbay project triage --path <path>`를 실행하라고 안내한다.

## 핵심 규칙 (반드시 지킬 것)

- **삭제하지 않는다.** 폐기 후보는 `_archive/YYYYMMDD/`로 옮긴다(원칙 11) — `rm`을 쓰지 않는다.
- 확신 낮은 파일만 사람에게 배치로 물어본다. "모르겠음"은 `_needs-review/`로 보류한다 — 강제로 분류하지 않는다.
- **독립 종착점이 아니다.** 정리가 끝나면 반드시 사람이 (a) 처음부터 설계 다시 잡기(`new-project`) 또는 (b) 발견된 의도 이어가기(`adopt-project`) 중 하나를 명시적으로 선택하게 한다. 이 스킬 혼자 끝내지 않는다.
- `excavation.json`은 신호일 뿐 결론이 아니다 — 클러스터 가설은 반드시 사람의 확인/정정을 거친다.

## `excavation.json` 읽는 법

`patchbay project triage`가 대상 폴더 안(`<path>/excavation.json`, 스튜디오 홈이 아니다 — 9.7절)에 쓴 파일. 필드:

- `git`: `{ isRepo, commitCount, uniqueCommitRatio }` — 커밋 이력이 있는지, 메시지가 얼마나 반복적인지(낮은 `uniqueCommitRatio`는 "WIP", "fix" 같은 의미 없는 커밋이 많다는 신호).
- `readme`: `{ exists, wordCount }` — 서사가 있는지, 있다면 얼마나 빈약한지.
- `duplicateMatches`: `[{ relativePath, pattern }]` — `_v2`/`_final`/`_backup`/` copy`/`복사본` 패턴에 걸린 파일들. **여러 프로젝트가 섞였다는 가장 직접적인 신호** — 같은 stem(예: `report`, `report_v2`, `report_final`)을 가진 파일들이 흩어져 있으면 그 자체가 클러스터 후보다.
- `modificationDistribution`: `[{ label, maxAgeDays, fileCount }]` — 파일들이 언제 마지막으로 손댔는지의 분포(`7d`/`30d`/`90d`/`365d`/`365d+`). 파일들이 서로 다른 시대에 몰려 있으면("최근 30일에 몰린 그룹" vs "1년 넘게 안 건드린 그룹") 별개의 시도가 겹쳐 있다는 신호.
- `orphanFiles`: `string[]` — 같은 디렉터리에 다른 파일 없이 혼자 있는, README/LICENSE/package.json류가 아닌 파일. 과다 검출을 의도한 v0 휴리스틱이다 — 전부 진짜 고아는 아니다.
- `todoDensity`: `{ totalMatches, filesWithMatches, scannedTextFiles }` — TODO/FIXME 밀도. 미완성/방치된 작업이 얼마나 있는지의 대략적 지표.

## 절차

**진행 기록에 대해**: `patchbay progress write`는 이미 스튜디오에 등록된 alias만 받는다(등록 안 된 alias는 exit 1). triage 대상은 정의상 아직 등록 전이므로, 이 스킬은 `progress write`를 호출하지 **않는다** — 6~7단계에서 `new-project`/`adopt-project`로 넘어간 직후 그 스킬들이 자기 자신의 시작 기록을 남기는 것으로 충분하다(억지로 임시 alias를 지어내 기록하지 않는다).

1. `excavation.json`을 읽는다. 위 필드들을 종합해서 **클러스터 가설을 카드로 제시**한다 — 예: "`report_v2.md`/`report_final.md`/`report_backup.md`가 한 문서의 세 버전으로 보인다", "`src/old-idea/`가 최근 1년간 안 건드려졌고 나머지와 커밋 패턴이 다르다 — 별개 시도였을 수 있다". 카드마다 근거가 된 신호(파일 목록, 패턴, 날짜 분포)를 같이 보여준다.

2. 사람이 각 카드를 **분리 / 병합 / 보존 / 폐기** 후보로 표시하게 한다. 확신이 낮은 개별 파일은 배치로 모아 한 번에 물어본다("이 5개 파일, 살아있나요 죽었나요?"). "모르겠음"으로 답한 파일은 목록에 남겨두고 4번에서 `_needs-review/`로 보낸다.

3. 사람의 표시 결과를 diff로 정리해서 보여주고 최종 승인을 구한다.

4. 승인되면 실제로 옮긴다(삭제 없음):
   - 폐기 후보 → `<project>/_archive/YYYYMMDD/` (오늘 날짜)
   - "모르겠음" → `<project>/_needs-review/`
   - 살아있는 코드는 사람이 정한 클러스터별로 재배치(디렉터리 이동)

5. **다음 단계를 사람에게 명시적으로 묻는다** — 예외 없이 둘 중 하나를 고르게 한다:
   - (a) 처음부터 설계 다시 잡기 → `new-project`로 안내한다. 방금 정리한 클러스터 내용을 인터뷰 기본값으로 넘겨준다.
   - (b) 발견된 의도 이어가기 → `patchbay project add --path <path> --alias <alias>`부터 실행하도록 안내한 뒤 `adopt-project`로 넘어가게 한다. 정리된 클러스터가 그 스킬의 발굴 입력 자료가 된다. **막 정리를 마친 폴더는 README/git 이력이 아직 빈약해 clarity score가 낮게 나와 `project add`가 exit 2로 거절할 수 있다** — 이건 정상이다, 방금 사람이 직접 내용을 검토했으므로 `--force-add`를 붙여 다시 실행하도록 안내한다.

## 하지 않는 것

- 아무것도 삭제하지 않는다 — 폐기는 언제나 `_archive/`로 이동이다.
- 확신 없이 파일을 자동으로 분류하지 않는다 — "모르겠음"은 정직하게 `_needs-review/`에 둔다.
- 정리만 하고 끝내지 않는다 — 반드시 `new-project` 또는 `adopt-project`로 사용자를 안내한다.
- `excavation.json`이 제시하는 신호를 그대로 결론처럼 밀어붙이지 않는다 — 항상 사람의 확인을 거친다.
