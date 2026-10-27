# Patchbay

에이전트 규칙 · 스킬의 원본은 Patchbay 작업 공간 `workspace/projects/patchbay/rules/` · `skills/`다. 특정 도구의 파일에 묶지 않는다 (사용자 결정 2026-10-27).
작업을 시작하면 Patchbay MCP `get_rules`(alias `patchbay`)나 `patchbay rule list|show --project patchbay`로 읽고, `apply: always` 규칙을 따른다. 사용자가 이름을 댄 규칙 · 스킬은 본문을 읽고 따른다.

시험: Codex 샌드박스에서는 네이티브 파일 감시가 막혀 `EMFILE`로 실패한다. 전체 시험은 `CHOKIDAR_USEPOLLING=1 pnpm test`로 돌리고, 네이티브 감시 시험(`studioWatch` · `server` SSE)은 샌드박스 밖에서 확인한다 (사용자 결정 A, 2026-10-21).
