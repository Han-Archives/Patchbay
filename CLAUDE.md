# Patchbay

에이전트 규칙 · 스킬의 원본은 Patchbay 작업 공간 `workspace/projects/patchbay/rules/` · `skills/`다. 특정 도구(Cursor · Claude Code)의 파일에 묶지 않는다 (사용자 결정 2026-10-27).
다른 세션은 MCP `get_rules`(alias `patchbay`)나 `patchbay rule list|show --project patchbay`로 읽고, 고칠 때도 `save_rule` · `patchbay rule save`로 고친다.
맨 아래 칸은 `patchbay rule export --project patchbay --target claude`가 만든다 — 직접 고치지 않는다.

## Coding Guidelines

Behavioral guidelines to reduce common LLM coding mistakes.

**우선순위:** 모든 작업에 적용하는 기본 원칙이다. 위 Patchbay 규칙과 충돌하면 그 파일을 따른다. 그 규칙들이 요구하는 수정도 3절(Surgical Changes)의 "요청에서 직접 이어지는 변경"으로 본다.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- patchbay:rules — `patchbay rule export --target claude`가 고친다. 원본은 Patchbay 작업 공간 -->
@workspace/projects/patchbay/rules/architecture-map.md
@workspace/projects/patchbay/rules/briefing.md
@workspace/projects/patchbay/rules/doc-versions.md
@workspace/projects/patchbay/rules/portfolio-deck.md
@workspace/projects/patchbay/rules/reflect-to-patchbay.md
@workspace/projects/patchbay/rules/storage-layout.md
@workspace/projects/patchbay/rules/terms.md
@workspace/projects/patchbay/rules/visual-first.md
<!-- /patchbay:rules -->
