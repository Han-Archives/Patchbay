# 에이전트 규칙 · 스킬

**원본은 여기가 아니다.** 2026-10-27부터 Patchbay를 쓰는 프로젝트의 규칙 · 스킬은 Patchbay 작업 공간에 프로젝트마다 둔다. 특정 도구(Cursor · Claude Code)의 파일에 묶지 않는다 (사용자 결정).

| 무엇 | 어디 |
| --- | --- |
| 규칙 | `<작업 공간>/projects/<alias>/rules/<이름>.md` — 머리말 `description` · `apply`(`always` 늘 지킴 / `request` 이름을 댈 때) |
| 스킬 | `<작업 공간>/projects/<alias>/skills/<이름>/SKILL.md`, 모든 프로젝트 공용은 `<작업 공간>/skills/` |
| Patchbay 자신 | `workspace/projects/patchbay/rules/` — architecture-map · briefing · doc-versions · portfolio-deck · reflect-to-patchbay · storage-layout · terms · visual-first |

## 읽고 쓰는 법

- 대화방: Patchbay가 `always` 규칙 본문과 나머지 목록을 어떤 LLM(Claude · Codex · 로컬)에든 넣는다. 말에 이름이 나오면 그 본문도 넣는다. 입력칸 「+ → 규칙 · 스킬」로 이름을 고른다.
- 다른 세션: MCP `get_rules` · `save_rule`, CLI `patchbay rule list|show|save --project <alias>`.
- 고치기: 콘솔 「폴더 · 문서」의 `rules/` · `skills/`, 또는 위 저장 명령.
- 도구 파일이 필요하면: `patchbay rule export --project <alias> --target cursor|claude` — `.cursor/rules/*.mdc`나 `CLAUDE.md` 맨 아래 칸을 만든다. 원본은 그대로다.

옛 `.mdc` 원본은 `archive/docs/규칙/`(portfolio-deck은 비공개 `workspace/records/archive/docs/규칙/`)에 보관했다.
