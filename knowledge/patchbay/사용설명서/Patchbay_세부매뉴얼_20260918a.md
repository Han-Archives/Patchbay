# Patchbay 세부 매뉴얼

| 항목 | 값 |
| --- | --- |
| 문서명 | Patchbay_세부매뉴얼 |
| 버전 | 20260918a |
| 상태 | 비전공자·중학생도 한 단계씩 따라 하는 실습. Mac |
| 독자 | 터미널을 처음 켜 보는 사람 |
| 짝 문서 | `knowledge/patchbay/사용설명서/Patchbay_사용설명서_20260918a.md` (사전처럼 찾아볼 때) |

이 글만 보고 **연습 폴더를 만들고, 프로그램을 조립하고, 브라우저 화면을 연 다음, 끄는 것**까지 갑니다. 사전 지식은 없다고 치고 씁니다.

2026-09-18에 이 글의 핵심 경로를 실제로 실행해 확인했습니다. 연습 폴더에 `README.md`만 두고 등록하니 점수 50이 나오고, 지도에 Rules 1이 보였습니다.

---

## 이 글을 읽는 법

1. **한 단계만** 합니다. 성공 표시가 보이면 다음 단계로 갑니다.
2. 명령은 **회색 상자 안을 그대로** 복사해서 터미널에 붙여넣습니다. 맨 앞에 `$`를 붙이지 않습니다.
3. 영어가 많이 나와도 정상입니다. 성공인지 실패인지만 이 글의 「성공하면」과 맞춰 보면 됩니다.
4. 이 글은 **Mac** 기준입니다. Windows는 경로와 설치 방법이 달라서 여기 범위가 아닙니다.

지금 목표(Z)는 이것뿐입니다.

> 브라우저에 Patchbay 화면이 뜨고, 왼쪽에서 **프로젝트**가 보이며, 「현재 작업」에 내가 쓴 문장이 있다.

LangGraph, Neo4j, MCP, 스킬 설치는 **나중에**입니다. 안 해도 화면은 열립니다. 흐름 탭을 실제로 연결하려면 Z가 끝난 뒤 `knowledge/patchbay/사용설명서/Patchbay_LangGraph_세부매뉴얼_20260919a.md` 를 봅니다.

---

## 단계 0. 무엇이 필요한지

아래가 준비되면 됩니다.

- Mac
- 인터넷
- 이 Patchbay 폴더 (이미 Cursor로 이 프로젝트를 열고 있으면 컴퓨터에 있는 상태입니다)
- 약 20–40분 (처음 재료를 받을 때가 가장 깁니다)

설치하게 될 프로그램:

| 이름 | 하는 일 | 지금 꼭? |
| --- | --- | --- |
| Node.js 22 이상 | 이 프로그램을 돌리는 엔진 | 꼭 |
| pnpm | 재료를 모으고 조립하는 도구 | 꼭 |
| (선택) Docker | 지식 탭용 검색 엔진 | 아니요 |

---

## 단계 1. 터미널을 켭니다

터미널은 **글자로 컴퓨터에게 일을 시키는 창**입니다. Finder처럼 아이콘을 누르는 대신, 한 줄 명령을 쓰고 return 키를 누릅니다.

1. 키보드 왼쪽 아래 `command(⌘)` 와 `스페이스` 를 같이 누릅니다.
2. `터미널` 또는 `Terminal` 을 입력합니다.
3. 맨 위 결과의 **터미널** 앱을 return으로 엽니다.

까만 또는 흰 창이 열리고, 맨 아래에 깜빡이는 줄이 있으면 성공입니다. 그 줄 끝이 `%` 또는 `$` 로 끝나면 **지금 입력해도 되는 상태**입니다.

창을 닫지 마세요. 이 글의 다음 단계도 같은 창에서 합니다. 실수로 닫았으면 단계 1부터 다시 열고, 「새 창을 열었을 때」 안내(단계 18)를 봅니다.

---

## 단계 2. Node.js가 있는지 봅니다

터미널에 아래를 **한 줄** 붙여넣고 return을 누릅니다.

```bash
node -v
```

### 성공하면

`v22.` 또는 `v23.` 또는 `v24.` 처럼 **22 이상** 숫자가 보입니다. 예: `v22.23.2`

이미 있으면 **단계 4로** 건너뜁니다.

### 안 되면

- `command not found: node`
- `zsh: command not found: node`

Node가 없는 것입니다. 단계 3으로 갑니다.

`v18` 이나 `v20` 처럼 22보다 작으면 단계 3에서 **다시 설치**합니다.

---

## 단계 3. Node.js를 설치합니다 (없을 때만)

1. 브라우저에서 [https://nodejs.org](https://nodejs.org) 를 엽니다.
2. **LTS** 라고 크게 적힌 버튼을 눌러 설치 파일을 받습니다. (Current보다 LTS를 고릅니다.)
3. 받은 `.pkg` 파일을 더블클릭하고, 안내대로 계속·설치를 누릅니다. Mac 암호를 물을 수 있습니다.
4. **설치가 끝나면 터미널 창을 완전히 종료**합니다. 빨간 단추로 창을 닫고, 독에서 터미널을 우클릭 → 종료.
5. 단계 1처럼 터미널을 **새로** 켭니다.
6. 다시 확인합니다.

```bash
node -v
```

`v22` 이상이 보여야 합니다. 안 보이면 맥을 한 번 재시작하거나, 설치 파일을 다시 받은 뒤 단계 3을 반복합니다.

---

## 단계 4. pnpm을 준비합니다

터미널에 한 줄씩, **한 줄마다 return** 합니다.

```bash
corepack enable
```

이어서:

```bash
corepack prepare pnpm@9 --activate
```

암호를 물으면 Mac 로그인 암호를 치고 return 합니다. 글자가 안 보이는 것이 정상입니다.

확인:

```bash
pnpm -v
```

### 성공하면

`9.` 또는 `10.` 또는 `12.` 처럼 숫자가 보입니다. 9 이상이면 됩니다.

### 안 되면

`corepack: command not found` 이면 Node 설치가 덜 된 것입니다. 단계 3을 다시 하고 터미널을 재시작합니다.

그래도 안 되면 Node와 함께 온 npm으로 설치합니다.

```bash
npm install -g pnpm
```

그다음 다시 `pnpm -v`.

---

## 단계 5. Patchbay의 `dev` 폴더로 들어갑니다

프로그램 재료는 저장소 맨 위가 아니라 **`dev`라는 안쪽 폴더**에 있습니다. 여기로 들어가지 않으면 다음 명령이 전부 실패합니다.

### 5-1. Finder에서 폴더를 찾습니다

Cursor로 이 프로젝트를 열고 있다면, 왼쪽 파일 목록에서 `dev` 폴더가 보입니다. Finder에서 같은 곳을 여는 가장 쉬운 방법:

1. Cursor에서 `dev` 폴더를 우클릭합니다.
2. **Reveal in Finder** / **Finder에서 보기** 가 있으면 누릅니다.

없거나 헷갈리면 Finder에서 `문서` → `Claude` → `Projects` → `Patchbay` → `dev` 처럼, 이 프로젝트를 넣어 둔 길을 따라갑니다. `dev` 안에 `package.json`, `packages`, `apps` 가 보이면 맞습니다.

### 5-2. 터미널에 그 폴더를 알려 줍니다

1. 터미널을 클릭해서 활성화합니다.
2. `cd` 를 치고 **스페이스 한 칸**을 띄웁니다. 아직 return은 누르지 않습니다.
3. Finder의 **`dev` 폴더 아이콘**을 터미널 창 위로 **끌어다 놓습니다**.
4. 경로가 자동으로 붙습니다. 이제 return을 누릅니다.

확인:

```bash
pwd
```

### 성공하면

맨 끝이 `/dev` 로 끝납니다. 예:

```text
/path/to/Patchbay/dev
```

가운데 `Users` 다음 이름은 사람마다 다릅니다. **끝이 `/dev`이면** 성공입니다.

### 안 되면

`pwd` 끝이 `/Patchbay` 뿐이면 한 단계 더 들어가야 합니다.

```bash
cd dev
pwd
```

다시 끝이 `/dev`인지 봅니다.

`No such file or directory` 이면 드래그한 폴더가 `dev`가 아닙니다. 단계 5-1부터입니다.

---

## 단계 6. 재료를 받습니다

**지금 `pwd` 끝이 `/dev`인지** 한 번 더 보고, 아래를 실행합니다.

```bash
pnpm install
```

처음이면 몇 분이 걸릴 수 있습니다. 영어가 많이 스크롤됩니다. 끝에서 다시 `%` 또는 `$` 가 나오고, 커서가 깜빡이면 끝난 것입니다.

질문이 나오고 `Y/n` 이면 `Y` 를 치고 return 합니다.

### 성공하면

마지막 근처에 `Done` 또는 에러 없이 프롬프트가 돌아옵니다. `packages` 안에 `node_modules` 비슷한 설치 흔적이 생깁니다. 에러 한 줄이 빨간색으로 남아 있고 프롬프트가 안 돌아오면 끝난 것이 아닙니다.

### 안 되면

- `pnpm: command not found` → 단계 4. 터미널을 재시작했는지 봅니다.
- `ENOENT` / `dev`가 아니라는 식 → 단계 5.
- 네트워크 오류 → 인터넷을 확인하고 같은 명령을 한 번 더 실행합니다. 이미 받은 것은 이어서 받는 경우가 많습니다.

---

## 단계 7. 프로그램을 조립합니다 (두 번)

재료를 받았다고 바로 실행되는 형태는 아닙니다. **사람 글을 컴퓨터가 실행하는 글로 바꾸는 일**을 두 번 합니다.

**반드시 `pwd` 끝이 `/dev`인 창에서** 합니다.

첫 번째 (핵심 도구):

```bash
pnpm build
```

성공하면 에러 없이 프롬프트가 돌아옵니다.

두 번째 (화면):

```bash
pnpm --filter @patchbay/flow build
```

`--filter` 는 빼기 기호가 **두 개**입니다. 빼기 하나면 실패합니다.

성공하면 비슷한 영어 로그 뒤에 `built in` 같은 짧은 시간이 보입니다.

### 안 되면

- `error TS` 가 많이 보이면 단계 6이 덜 끝났거나, Node가 22 미만입니다. `node -v` 와 단계 6을 다시 합니다.
- `@patchbay/flow` 를 못 찾으면 `pwd` 가 `/dev`가 아닙니다.
- 두 번째를 빼먹고 단계 12로 가면 화면이 안 열립니다. 지금 두 번째를 다시 하면 됩니다.

---

## 단계 8. 연습용 숙제 폴더를 만듭니다

Patchbay는 **이미 있는 폴더를 등록**해서 봅니다. 연습용으로 메모 폴더 하나를 만듭니다. 이 폴더는 Patchbay 프로그램 밖, 문서 아래에 둡니다.

터미널에 **한 줄씩** 실행합니다. (이 세 줄은 `dev`가 아니어도 됩니다.)

```bash
mkdir -p "$HOME/Documents/patchbay-tutorial/my-notes"
```

```bash
printf '%s\n' '# 내 메모' '연습용 프로젝트입니다.' > "$HOME/Documents/patchbay-tutorial/my-notes/README.md"
```

```bash
ls "$HOME/Documents/patchbay-tutorial/my-notes"
```

### 성공하면

`README.md` 라는 이름이 보입니다.

### 안 되면

`ls:` 오류이면 첫 `mkdir` 이 실패한 것입니다. `$HOME` 을 빼먹지 않았는지, 따옴표가 짝인지 봅니다. 세 줄을 위에서부터 다시 합니다.

Finder에서 `문서` → `patchbay-tutorial` → `my-notes` → `README.md` 가 보여도 성공입니다.

---

## 단계 9. Patchbay 스튜디오를 시작합니다

스튜디오는 **Patchbay가 기억을 저장하는 공책**입니다. 기본 위치는 홈 폴더 안의 `.patchbay` 입니다. Finder에는 점이 숨겨져 있을 수 있습니다.

다시 **`dev` 폴더**로 들어갑니다. 새 명령을 치기 전에:

```bash
pwd
```

끝이 `/dev`가 아니면 단계 5-2를 다시 합니다.

그다음:

```bash
node packages/cli/dist/index.js init --name "연습 스튜디오"
```

큰따옴표도 그대로 복사합니다.

### 성공하면

비슷한 한 줄이 보입니다.

```text
Initialized Patchbay studio "연습 스튜디오" at /Users/이름/.patchbay
```

`이름` 자리는 사람마다 다릅니다. `at` 뒤에 `/.patchbay` 로 끝나면 됩니다.

한 번 더 실행해도 괜찮습니다. 이미 있는 공책을 지우지 않습니다.

### 안 되면

- `Cannot find module` / `no such file` → 단계 7의 `pnpm build` 가 안 끝났거나, `pwd` 가 `/dev`가 아닙니다.
- `node: command not found` → 단계 2–3. 터미널을 재시작합니다. 재시작 후에는 단계 5-2로 `dev`에 다시 들어가야 합니다.

---

## 단계 10. 연습 폴더를 Patchbay에 등록합니다

같은 `dev` 창에서:

```bash
node packages/cli/dist/index.js project add --path "$HOME/Documents/patchbay-tutorial/my-notes" --alias practice
```

한 줄입니다. 중간에 return을 누르지 않습니다.

### 성공하면

두 줄이 보입니다. 숫자는 50 근처면 됩니다.

```text
Registered project "practice" at /Users/이름/Documents/patchbay-tutorial/my-notes (clarity score 50).
/Users/이름/.patchbay/projects/practice/ATLAS.md
```

점수가 50인 이유: 설명 파일(`README.md`)이 있어서입니다. 40보다 작으면 등록을 거절합니다. 이 연습 폴더는 README만으로 통과하게 만들어 두었습니다.

### 안 되면

**점수가 낮다고 하며 끝나는 경우** (Clarity score … below … 40):

README 이름이 정확한지 봅니다. `readme.md` 가 아니라 **`README.md`** 여야 합니다. 단계 8을 다시 하고, 그래도면 아래처럼 강제 등록합니다.

```bash
node packages/cli/dist/index.js project add --path "$HOME/Documents/patchbay-tutorial/my-notes" --alias practice --force-add
```

**이미 등록됐다고 하는 경우**:

같은 이름 `practice` 가 있습니다. 이름을 바꿉니다.

```bash
node packages/cli/dist/index.js project add --path "$HOME/Documents/patchbay-tutorial/my-notes" --alias practice2
```

이후 단계의 `practice` 를 `practice2` 로 바꿔 쓰면 됩니다.

**path does not exist**:

단계 8이 안 된 것입니다. `ls "$HOME/Documents/patchbay-tutorial/my-notes"` 로 확인합니다.

---

## 단계 11. 지도를 글자로 봅니다

```bash
node packages/cli/dist/index.js atlas --project practice --level 1
```

### 성공하면

대략 이런 블록이 보입니다.

```text
# Atlas Digest

- Skills: 0
- Rules: 1
- Unlabeled ports: 0
- Patches without a wire: 0
- Wires without a patch: 0
```

연습 폴더에는 설명 파일 하나뿐이라 **Rules: 1** 이 정상입니다. Skills가 0인 것도 정상입니다.

### 안 되면

`ATLAS.digest.md not found` → 단계 10이 실패했습니다.

`Multiple projects` → `--project practice` 를 빼먹지 않았는지 봅니다.

---

## 단계 12. 「지금 하는 일」을 적습니다

Patchbay는 채팅 몰라도, 이 한 줄로 **현재 작업**을 공책에 남깁니다.

```bash
node packages/cli/dist/index.js progress write --project practice --summary "세부 매뉴얼 따라 하기"
```

### 성공하면

```text
Recorded progress for "practice": 세부 매뉴얼 따라 하기
/Users/이름/.patchbay/projects/practice/PROGRESS.md
/Users/이름/.patchbay/progress.md
```

확인:

```bash
node packages/cli/dist/index.js progress --project practice
```

`세부 매뉴얼 따라 하기` 가 그대로 보이면 성공입니다.

---

## 단계 13. 화면을 엽니다

같은 `dev` 창에서:

```bash
node packages/cli/dist/index.js flow --project practice
```

이 명령은 **켜 둔 채로 두는 프로그램**입니다. 성공하면 터미널에 대략 이렇게 남고, **프롬프트 `%` 가 바로 돌아오지 않습니다.**

```text
Patchbay console at http://localhost:4317
Ctrl+C to stop.
```

조금 뒤 브라우저가 저절로 열릴 수 있습니다. 안 열리면 주소창에 아래를 직접 칩니다.

```text
http://127.0.0.1:4317
```

### 이 창에서 하지 말 것

- 이 창에 다른 명령을 치지 않습니다.
- 창을 닫지 않습니다. 닫으면 화면이 멈춥니다.
- 끌 때는 단계 16만 봅니다.

### 안 되면

**브라우저에 「등록된 프로젝트가 없습니다」**

단계 10을 다른 위치에서 했을 수 있습니다. 화면을 끄고(단계 16) 단계 10부터입니다.

**`EADDRINUSE` / `address already in use`**

4317번 문이 이미 쓰이는 것입니다. 끌 때는 단계 16처럼 `control`+`C` 를 먼저 시도하고, 안 되면 다른 문으로 엽니다.

```bash
node packages/cli/dist/index.js flow --project practice --port 4318
```

주소는 `http://127.0.0.1:4318` 입니다.

**바로 에러 나고 끝남**

단계 7 두 번째 조립(`pnpm --filter @patchbay/flow build`)을 빼먹은 경우가 많습니다. 화면 명령을 끄고, `dev`에서 그 조립을 다시 한 뒤 단계 13을 반복합니다.

**Cannot find … serve.js**

같은 원인입니다. 단계 7 두 번째를 다시 합니다.

---

## 단계 14. 화면에서 하나씩 확인합니다

왼쪽이 좁은 막대, 오른쪽이 넓은 내용입니다.

### 14-1. 왼쪽

| 보이는 것 | 정상 |
| --- | --- |
| 맨 위 `Patchbay` | 제목 |
| `localhost:4317` (또는 4318) | 주소 힌트 |
| 워크스페이스 상자 값이 `practice` | 단계 10에서 붙인 별명 |
| 버튼 네 개: 프로젝트, 흐름, 지식, 캔버스 | 탭 |
| 맨 아래 `LangGraph 연결 안 됨` | **지금 정상** |
| 맨 아래 `Neo4j 연결 안 됨` | **지금 정상** |

연결 안 됨을 고치려고 다른 프로그램을 설치하지 않아도 됩니다. 이 세부 매뉴얼의 Z에는 필요 없습니다.

### 14-2. 프로젝트 탭

왼쪽에서 **프로젝트** 를 누릅니다. (처음 열면 이미 여기일 수 있습니다.)

오른쪽에서 확인할 것:

- 제목 `프로젝트 · practice`
- 경로 안에 `patchbay-tutorial/my-notes`
- **현재 작업** 근처에 `세부 매뉴얼 따라 하기`
- Atlas 표에 포트가 있을 수 있습니다. `source:README.md` 비슷한 줄이 있으면 단계 8이 스캔된 것입니다.

「아직 스캔되지 않았습니다」가 보이면 단계 10이 안 끝난 것입니다. 화면을 끄고 단계 10을 다시 합니다.

### 14-3. 흐름 탭

**흐름** 을 누릅니다.

`LangGraph 연결 안 됨` 큰 안내가 보이면 **성공**입니다. 실행 그래프 엔진을 안 켠 상태라서 그렇습니다. 「다시 연결」은 누르지 않아도 됩니다.

이 탭은 나중에 다른 프로그램(`langgraph dev`)을 켠 사람을 위한 자리입니다.

### 14-4. 지식 탭

**지식** 을 누릅니다.

`Neo4j 연결 안 됨` 이 보이면 **성공**입니다. 검색용 데이터베이스를 안 켠 상태입니다.

### 14-5. 캔버스 탭

**캔버스** 를 누릅니다.

`지금은 올린 항목이 없다` 와 「캔버스에 올리기」 안내가 보이면 **성공**입니다. 흐름·지식에서 올린 것이 없어서 비어 있는 것이 맞습니다. 지금은 비어 있는 채로 둡니다.

여기까지 보면 Z에 도착한 것입니다.

---

## 단계 15. (권장) 화면이 살아 있는지 한 번 더 봅니다

화면은 켜 둔 채, **터미널을 하나 더** 엽니다.

1. 터미널에서 `command`+`N` 으로 새 창을 엽니다. (또는 단계 1처럼 앱을 또 열지 말고, 메뉴 셸 → 새 창)
2. 새 창에서 단계 5-2처럼 다시 `dev`로 들어갑니다. `pwd` 끝이 `/dev`인지 확인합니다.
3. 새 창에서만 아래를 실행합니다. **화면이 돌아가는 첫 창에는 치지 않습니다.**

```bash
node packages/cli/dist/index.js progress write --project practice --summary "두 번째 창에서 기록"
```

4. 브라우저의 **프로젝트** 탭을 봅니다. 새로고침을 안 해도 「현재 작업」이 `두 번째 창에서 기록` 으로 바뀌는 것이 정상입니다. 조금 기다립니다.

안 바뀌면 브라우저를 한 번 새로고침합니다. 그래도 첫 문장이면, 화면 프로세스가 꺼졌거나 다른 포트의 옛 화면을 보고 있는 것입니다. 주소가 단계 13과 같은지 봅니다.

---

## 단계 16. 화면을 끕니다

화면을 연 **첫 터미널 창**을 클릭합니다.

키보드 **`control (⌃)` 과 `C` 를 같이** 누릅니다. `command`+`C` 가 아닙니다. `command`+`C` 는 복사입니다.

### 성공하면

`Ctrl+C to stop.` 아래에 다시 `%` 또는 `$` 가 보이고 명령을 칠 수 있습니다.

브라우저는 창이 남아 있어도, 이제 서버가 꺼져서 새로고침하면 연결 실패가 됩니다. 브라우저 탭은 그냥 닫으면 됩니다.

---

## 단계 17. 다음날 다시 켜는 법

재료 받기(단계 6)와 조립(단계 7)은 **코드가 바뀌지 않았으면** 다시 하지 않아도 됩니다.

새 터미널마다:

1. 단계 5-2로 `dev`에 들어갑니다. `pwd` 확인.
2. 화면만 켭니다.

```bash
node packages/cli/dist/index.js flow --project practice
```

연습 폴더를 지웠다면 단계 8–10을 다시 합니다.

Node를 껐다 켠 맥에서는 `node -v` 와 `pnpm -v` 가 단계 2, 4처럼 보이는지만 보면 됩니다.

---

## 단계 18. 새 터미널을 열었을 때 체크

창을 새로 열면 컴퓨터는 **어제 들어가 있던 폴더를 기억하지 않습니다.** 매번:

```bash
node -v
pnpm -v
pwd
```

`pwd` 끝이 `/dev`가 아니면 단계 5-2.

그다음에만 `node packages/cli/dist/index.js …` 를 칩니다. 이 상대 경로는 **`dev` 안에서만** 통합니다.

---

## 단계 19. (선택) 지식 탭을 진짜 검색으로 쓰고 싶을 때

이 단계는 **안 해도 됩니다.** Docker라는 별도 앱이 필요하고, 설치와 권한이 중급입니다.

할 때만:

1. [Docker Desktop](https://www.docker.com/products/docker-desktop/) 을 설치하고 실행해서, 위쪽 고래 아이콘이 켜진 상태가 됩니다.
2. `dev` 터미널에서:

```bash
docker compose up -d
```

3. 조금 기다립니다. 그다음 Patchbay 화면을 켠 뒤 **지식** 탭에서 「다시 연결」을 누릅니다.
4. 계정은 프로그램이 기본으로 `neo4j` / 비밀번호 `patchbay` 를 씁니다.

끄기:

```bash
docker compose down
```

흐름 탭의 LangGraph는 이 글의 Z에 **필요 없습니다.** 연결 안 됨이 실패가 아닙니다. 계정 가입부터 `:2024` 서버, Patchbay 「다시 연결」까지는 `knowledge/patchbay/사용설명서/Patchbay_LangGraph_세부매뉴얼_20260919a.md` 에서 한 단계씩 합니다.

---

## 막혔을 때

| 보이는 것 | 먼저 할 일 |
| --- | --- |
| `command not found: node` | 단계 3 후 터미널 완전 종료·재실행 |
| `command not found: pnpm` | 단계 4, 터미널 재실행 |
| `pwd` 가 `/dev`가 아님 | 단계 5-2. Finder `dev`를 드래그 |
| `pnpm install` 중 빨간 에러 | 인터넷, 같은 명령 재시도 |
| `Cannot find module` 로 init 실패 | `pwd`가 `/dev`인지, 단계 7 `pnpm build` |
| 화면 명령이 바로 죽음 | 단계 7 두 번째 `pnpm --filter @patchbay/flow build` |
| 등록된 프로젝트가 없습니다 | 단계 10. 화면을 끄고 등록 후 다시 13 |
| Clarity score … 40 | README.md 이름. 단계 10의 `--force-add` |
| `address already in use` | `control`+`C` 로 옛 화면을 끄거나 `--port 4318` |
| 브라우저가 안 열림 | 주소창에 `http://127.0.0.1:4317` |
| 현재 작업이 안 바뀜 | 화면 창이 살아 있는지, 단계 15는 **다른** 창에서 쳤는지 |
| `command`+`C` 를 쳤는데 안 꺼짐 | `control`+`C` 입니다 |

---

## 이 글에서 일부러 안 가르치는 것

실패가 아닙니다. 첫 도착점 Z에 필요 없어서 빼 두었습니다.

- Cursor에 MCP를 붙이기
- 스킬 초안(수확)과 `patch`
- 여러 프로젝트를 한 스튜디오에 넣기
- 프로그램 코드를 고치기

LangGraph 계정·키·로컬 서버는 `knowledge/patchbay/사용설명서/Patchbay_LangGraph_세부매뉴얼_20260919a.md` 입니다.

그 밖의 목록과 명령 치트시트는 `knowledge/patchbay/사용설명서/Patchbay_사용설명서_20260918a.md` 4절에 있습니다. 이 세부 매뉴얼을 **끝까지 성공한 다음**에만 펼치는 것을 권합니다.

---

## 한 장 요약 (이미 성공한 사람용)

`dev` 안에서:

```bash
pnpm install
pnpm build
pnpm --filter @patchbay/flow build
node packages/cli/dist/index.js init --name "연습 스튜디오"
node packages/cli/dist/index.js project add --path "$HOME/Documents/patchbay-tutorial/my-notes" --alias practice
node packages/cli/dist/index.js progress write --project practice --summary "세부 매뉴얼 따라 하기"
node packages/cli/dist/index.js flow --project practice
```

끄기: 그 창에서 `control`+`C`.
