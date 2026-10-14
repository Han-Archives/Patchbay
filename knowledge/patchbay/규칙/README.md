# 에이전트 규칙

이 폴더가 Cursor와 Claude Code가 같이 보는 **규칙 원본**이다. `.mdc`만 규칙이다.

| 파일 | 언제 |
| --- | --- |
| `terms.mdc` | 조어를 정의 없이 쓰지 않는다. 원본은 `workspace/records/patchbay/용어.md`(비공개 기록층) |
| `architecture-map.mdc` | 패키지·API·탭·스튜디오 파일이 바뀔 때 아키텍처 맵을 맞춘다 |
| `reflect-to-patchbay.mdc` | 어떤 프로젝트든 프로세스·단계가 끝나면 Patchbay에 반영한다 |
| `portfolio-deck.mdc` (비공개 기록층 `workspace/records/patchbay/규칙/`) | **Patchbay 구현에만** — 덱은 프로젝트 완료 후에 만든다. 진행 중에는 재료(결정·근거·실측)만 남긴다 |
| `visual-first.mdc` | 사용자 표면은 텍스트 나열보다 보면 아는 인터페이스를 먼저 |
| `doc-versions.mdc` | 새 판을 쓰면 옛 판을 `_archive/` 로 옮긴다. 살아 있는 폴더에는 **한 판만** |
| `storage-layout.mdc` | 파일은 `기획/저장구조.md`가 정한 층 · 경로에만 둔다. 저장 구조가 바뀌면 같은 작업에서 그 문서를 고친다 |

Cursor는 `.cursor/rules/`에서 여기 파일을 가리킨다. Claude Code는 레포 루트 `CLAUDE.md`가 이 폴더를 포함한다.
