# Codex 상담 재개 인자 오류 수정 · 2026-10-19

요청: [원인 진단](Codex-상담-resume-인자오류-진단_20261019_v1.md) 후 사용자가 코드 수정을 요청했다.

## 변경

`app/apps/flow/src/consultHost.ts`의 `codexArgs()`에서 `--sandbox read-only`를 공통 하위 인자에서 빼고 상위 `exec` 바로 뒤에 둔다. 신규 상담과 기존 상담 재개 모두 읽기 전용 정책을 지정한다.

```sh
codex exec --sandbox read-only --json … <PROMPT>
codex exec --sandbox read-only resume <SESSION_ID> --json … <PROMPT>
```

기존 세션 ID, 모델, 생각 강도, JSON 출력, Git 검사 생략, MCP 명령·인자·환경, 상담 안내·사용자 입력은 그대로 전달한다. 화면·저장 형식·API·파일 구조 변경은 없다.

`consultHost.test.ts`에 재개 옵션 위치와 나머지 인자의 보존 검사를 추가했다. 선택적 `PATCHBAY_TEST_CODEX=1` 검사는 설치된 CLI에 실제 인자와 `--help`를 전달해 신규·재개 두 경로를 확인한다. 모델과 MCP 서버는 실행하지 않는다. 일반 시험 환경은 설치 CLI 검사 두 개만 건너뛴다.

## 검증

- 수정 전에 추가한 위치 검사와 실제 CLI 재개 검사 두 개가 실패했다. 실제 CLI 실패 메시지는 사용자가 제보한 `unexpected argument '--sandbox' found`와 동일했다. 신규 실행 검사는 통과했다.
- 수정 후 `PATCHBAY_TEST_CODEX=1 pnpm exec vitest run apps/flow/src/consultHost.test.ts apps/flow/src/roomExecution.test.ts`: 40개 통과. 상담 30개, 대화방 실행 10개이며 상담에는 설치 Codex CLI 0.163.0의 신규·재개 검사 두 개가 포함된다.
- `pnpm --filter @patchbay/flow build`: 타입 검사, 클라이언트 빌드, 서버 컴파일 통과. 기존 브라우저 호환·번들 크기 경고는 남아 있다.
- 빌드된 `codexArgs()`도 설치 CLI에 신규·재개 인자로 `--help`를 넘겨 두 경로 모두 종료 코드 0을 확인했다.
- 현재 4318 서버의 LLM 실행과 등록 프로젝트의 할일 준비 작업이 없음을 확인하고, 기존 실행 파일·접속 설정을 유지해 재시작했다. 새 프로세스의 작업 상태, 대시보드 History API, 루트 페이지 HTTP 200을 확인했다.

실제 상담 메시지·모델 응답·MCP 초안 쓰기를 실행하지 않았다. 검증은 명령 해석, 기존 상담 동작의 가짜 실행기 시험, 서버 반영까지다. 커밋은 요청받지 않아 수행하지 않았다.
