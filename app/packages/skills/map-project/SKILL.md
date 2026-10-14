---
name: map-project
description: Patchbay에 등록된 프로젝트의 현재 지도(Atlas/Flow)를 확인하고 요약한다. 데이터가 없거나 오래됐으면 재스캔을 안내한다. 아무것도 새로 쓰지 않는다 — 조회 전용 스킬이다.
---

# map-project

이 스킬은 **아무 파일도 쓰지 않는다.** Atlas(무엇이 있는지)와 Flow(어떻게 이어지는지)를 읽어서 사람에게 설명하는 게 전부다. 원칙 1(호스트를 대체하지 않는다)의 실물화 — 이 스킬은 채팅 안에서 요약해줄 뿐, 별도 화면을 만들지 않는다.

## 언제 쓰는가

사용자가 "이 프로젝트에 뭐가 있어", "지금 상태 좀 보여줘", "패치베이에 뭐라고 나와" 같은 걸 물을 때.

## 절차

1. **시작 기록.** 어떤 프로젝트(`<alias>`)를 보는지 확인한 뒤:
   ```
   patchbay progress write --project <alias> --summary "map-project: 프로젝트 지도 확인 시작" --skill map-project --step start
   ```
   (MCP가 붙어 있으면 `progress write` 대신 이후 Phase에서 노출될 쓰기 경로를 쓸 수도 있지만, v1은 CLI가 유일한 쓰기 경로다.)

2. **Atlas 조회.** MCP `get_atlas({ alias, level: 2 })`(또는 CLI `patchbay atlas --project <alias> --level 2`)로 전체 Atlas를 읽는다. 필요하면 `get_graph({ alias, level: 1 })`로 노드/엣지 개수 요약도 같이 본다.

3. **데이터가 없거나 오래됐으면 재스캔을 안내한다 — 대신 실행하지 않는다.**
   - `get_atlas`가 "아직 스캔되지 않음" 에러를 반환하면: 사용자에게 `patchbay scan --project <alias>`를 실행하라고 안내하고, 여기서 멈춘다. 스캔은 결정적 커널의 일이지 이 스킬의 일이 아니다.
   - 최근 활동(`get_graph`의 progress 정보나 Flow의 커밋 순서)이 이상하게 오래돼 보이면, 재스캔을 "권유"만 한다 — 자동으로 실행하지 않는다.

4. **요약한다.** Atlas의 4개 섹션(`## Skills`, `## Rules`, `## Unlabeled ports`, `## Gaps`)을 사람이 읽기 편하게 채팅으로 풀어 설명한다:
   - Skills: 이미 패치된 스킬이 있는지
   - Rules: 발견된 컨텍스트 신호(README/AGENTS.md/CLAUDE.md/.cursor rules) 목록
   - Unlabeled ports: 아직 아무도 안 건드린 발견된 스킬 — 이게 "라벨 없는 잭"이다, 특히 강조해서 짚어준다
   - Gaps: 선언은 됐는데 안 연결된 것(할 일), 연결은 됐는데 선언 안 된 것(발견된 연동 — 정상)

5. **종료 기록.**
   ```
   patchbay progress write --project <alias> --summary "map-project: 요약 완료 (Skills N, Rules N, Unlabeled N)" --skill map-project --step done
   ```

## 하지 않는 것

- `overlay.yaml`, `ontology/*.yaml`, `DASHBOARD.md` 중 어느 것도 쓰지 않는다.
- `patchbay scan`을 대신 실행하지 않는다 — 안내만 한다.
- 별도 UI/대시보드를 만들지 않는다.
