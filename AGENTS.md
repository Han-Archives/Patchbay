# Patchbay

에이전트 규칙은 `knowledge/patchbay/규칙/`에 모은다. Cursor는 `.cursor/rules/` 심볼릭 링크로 같은 `.mdc`를 붙인다. Claude Code는 `CLAUDE.md`가 그 폴더를 포함한다.

세부가 필요하면 `knowledge/patchbay/규칙/`의 `.mdc`를 연다.

시험: Codex 샌드박스에서는 네이티브 파일 감시가 막혀 `EMFILE`로 실패한다. 전체 시험은 `CHOKIDAR_USEPOLLING=1 pnpm test`로 돌리고, 네이티브 감시 시험(`studioWatch` · `server` SSE)은 샌드박스 밖에서 확인한다 (사용자 결정 A, 2026-10-21).
