# Codex 상담 재개 인자 오류 진단 · 2026-10-19

요청: Patchbay 상담창에서 Codex로 실행할 때 `error: unexpected argument '--sandbox' found`가 발생하는 원인을 확인한다.

## 원인

`app/apps/flow/src/consultHost.ts`의 `codexArgs()`는 첫 실행과 재개에 같은 `common` 인자를 붙인다. 이 배열에 `--sandbox read-only`가 들어 있고 재개에서는 `resume <SESSION_ID>` 뒤에 붙는다.

```sh
codex exec resume <SESSION_ID> --json --sandbox read-only --skip-git-repo-check … <PROMPT>
```

설치된 `/opt/homebrew/bin/codex`는 `codex-cli 0.163.0`이다. `codex exec --help`에는 `--sandbox`가 있지만 `codex exec resume --help`에는 없다. 따라서 재개 명령 뒤에 이 옵션을 붙이면 인자 해석 단계에서 종료한다. 빌드된 `app/apps/flow/dist-server/consultHost.js`에도 같은 조립 방식이 있다.

## 재현과 검증

- 빌드된 `codexArgs()`로 가상 UUID·안내·MCP 경로를 사용해 재개 인자를 만들었다. 마지막에 `--help`를 붙여 모델·MCP를 실행하지 않고 CLI 인자만 검사했다.
- 현재 인자: 종료 코드 2. 사용자 오류의 `unexpected argument '--sandbox' found`, `-- --sandbox` 안내, `Usage: codex exec resume --json <SESSION_ID> [PROMPT]`가 동일하게 나왔다.
- `--sandbox read-only` 두 인자를 `exec` 다음, `resume` 앞으로만 이동: 종료 코드 0으로 재개 도움말이 출력됐다.
- `pnpm exec vitest run apps/flow/src/consultHost.test.ts`: 기존 시험 27개 통과. 기존 재개 인자 시험은 배열 앞 세 칸이 `exec`, `resume`, 세션 ID인지 확인할 뿐 실제 CLI 옵션 수용 여부를 검증하지 않는다.

## 수정 방향과 범위

샌드박스 옵션을 상위 `exec` 명령에 지정하고 재개 전용 인자를 뒤에 둔다.

```sh
codex exec --sandbox read-only resume <SESSION_ID> --json --skip-git-repo-check … <PROMPT>
```

첫 실행과 재개의 인자 구성을 구분하고 재개 시험의 기대값과 검증 범위를 보완해야 한다. CLI가 제시한 `-- --sandbox`는 뒤의 내용을 값으로 취급하게 하는 안내이므로 샌드박스 정책을 지정하는 해결책이 아니다.

이번 작업은 원인 진단이다. 제품 소스·빌드 결과·실제 상담·서버는 변경하지 않았다. 수정 방향의 검증은 인자 검사까지이며 실제 모델 응답·MCP 쓰기 검증은 수행하지 않았다.

참고: [OpenAI 공식 CLI 문서](https://learn.chatgpt.com/docs/developer-commands?surface=cli)의 `codex exec` 옵션과 재개 명령을 대조했다. 설치 버전의 옵션 위치와 실패·성공 판정은 위 로컬 도움말 및 재현 결과를 기준으로 한다.
