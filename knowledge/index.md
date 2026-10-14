---
id: patchbay-index
kind: 목록
access: 자유
updated: 2026-10-14
---

# 위키 목록

LLM이 이 레포에서 **가장 먼저 읽는 문서**다. 무엇이 어디에 있는지 한 줄씩. 질문에 답할 때는 여기서 고른 문서를 연다.

이 레포에는 Patchbay **구성** 문서만 있다. 기획서 · 명세 · 기획 대화 · 결정 기록 · 일지는 사용자의 비공개 기록층(`workspace/records/`, git에 없음)에 있다 — 그 파일이 있는 환경에서만 연다.

## 시작

- [README](../README.md) — 프로젝트 개요: 다섯 단계 · 구조 · 파일 구조 · 시작하기
- [저장구조](patchbay/기획/저장구조.md) — 폴더 · 파일이 어디에 어떻게 쌓이나. 구조를 바꾸기 전에 확인
- [규칙](patchbay/규칙/README.md) — 에이전트 규칙 `.mdc` 목록 (CLAUDE.md가 불러온다)

## 쓰는 법

- [사용설명서](patchbay/사용설명서/Patchbay_사용설명서_20260918a.md) — 설치 · 빌드 · 콘솔 · CLI
- [세부매뉴얼](patchbay/사용설명서/Patchbay_세부매뉴얼_20260918a.md) · [LangGraph 세부매뉴얼](patchbay/사용설명서/Patchbay_LangGraph_세부매뉴얼_20260919a.md) — 따라 하기

## 만든 과정

- [절차](patchbay/절차/) — 작업 한 번마다의 기록 `<주제>_<날짜>_v<n>.md` (Patchbay 구성만 다룬 것)
- [디자인](patchbay/디자인/) — 콘솔 시안

## 코드

- `app/` — 콘솔(`apps/flow`) · 커널(`packages/core`) · CLI · MCP · 스킬
