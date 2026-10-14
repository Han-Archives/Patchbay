# Patchbay LangGraph 세부 매뉴얼

| 항목 | 값 |
| --- | --- |
| 문서명 | Patchbay_LangGraph_세부매뉴얼 |
| 버전 | 20260919a |
| 상태 | 비전공자도 한 단계씩. Mac. LangSmith 계정부터 흐름 탭 연결까지 |
| 독자 | `Patchbay_세부매뉴얼_20260918a` 의 도착점 Z를 이미 성공한 사람 |
| 짝 문서 | `knowledge/patchbay/사용설명서/Patchbay_사용설명서_20260918a.md` 12.1절 |
| 근거 | [LangSmith 계정·API 키](https://docs.langchain.com/langsmith/create-account-api-key), [JS 로컬 서버](https://docs.langchain.com/oss/javascript/langgraph/local-server), Patchbay 명세 4.1 |

Patchbay는 LangGraph를 **대신 설치하거나 로그인하지 않습니다.** 흐름 탭은 내 컴퓨터 `http://127.0.0.1:2024` 에 떠 있는 LangGraph 서버를 읽을 뿐입니다. 그래서 계정·키·그래프 폴더는 **LangChain 쪽**에서 내가 직접 만듭니다.

지금 목표(Z2)는 이것뿐입니다.

> Patchbay 왼쪽 아래 LangGraph가 **연결됨**이고, 흐름 탭에 그래프(assistant) 이름이 보인다.

이 글의 최소 템플릿은 LLM을 아직 부르지 않습니다. 그래서 OpenAI/Anthropic 결제는 **연결을 확인한 뒤**에 해도 됩니다.

---

## 한눈에 내가 해야 하는 것

체크하면서 갑니다. 위부터 아래 순서입니다.

| # | 내가 할 일 | 어디서 | 지금 꼭? |
| --- | --- | --- | --- |
| 1 | LangSmith(LangChain) **무료 계정** 만들기 | 브라우저 | 꼭 |
| 2 | **API 키** 만들고 메모하기 (`lsv2_` 로 시작) | LangSmith 설정 | 꼭 |
| 3 | 그래프 **연습 폴더** 만들기 | 터미널 | 꼭 |
| 4 | 그 폴더에서 재료 설치 | 터미널 | 꼭 |
| 5 | `.env` 에 LangSmith 키 넣기 | 텍스트 편집 | 꼭 |
| 6 | `langgraph` 로컬 서버 켜기 (`:2024`) | **새** 터미널. 끄지 않음 | 꼭 |
| 7 | Patchbay 콘솔에서 흐름 탭 **다시 연결** | 브라우저 | 꼭 |
| 8 | (선택) 흐름 탭에서 JSON으로 한 번 실행 | Patchbay | 연결 확인 후 |
| 9 | (나중) OpenAI 또는 Anthropic 키 | 각 사이트 | LLM을 붙일 때 |
| 10 | (나중) LangSmith Studio로 디버그 | `smith.langchain.com/studio` | Patchbay와 다른 화면 |

**없는 것:** Patchbay 회원가입, LangGraph Cloud 유료 배포, Docker(이 경로에서는).

---

## 이 글을 읽는 법

1. `Patchbay_세부매뉴얼_20260918a` 를 끝까지 성공한 뒤에 합니다. Node 22와 `dev` 폴더 들어가는 법은 그 글에 있습니다.
2. 명령은 회색 상자만 복사합니다. 맨 앞 `$` 를 붙이지 않습니다.
3. 터미널은 **터미널 앱**을 씁니다. Cursor 안 조그만 창보다 일반 터미널이 안전합니다.
4. LangGraph 서버 창과 Patchbay 화면 창은 **동시에** 켜 둡니다. 하나만 끄면 연결이 끊깁니다.
5. API 키는 채팅·GitHub·스크린샷에 올리지 않습니다.

---

## 단계 0. 무엇이 다른지

| 이름 | 하는 일 | 주소 |
| --- | --- | --- |
| Patchbay 콘솔 | 내 프로젝트 관제 | `http://127.0.0.1:4317` |
| LangGraph 로컬 서버 | 그래프 실행 | `http://127.0.0.1:2024` |
| LangSmith 웹 | 계정, API 키, (선택) Studio | `https://smith.langchain.com` |

4317과 2024는 **다른 프로그램**입니다. Patchbay를 켠다고 LangGraph가 켜지지 않습니다.

연습 노트 폴더(`~/Documents/patchbay-tutorial/my-notes`)와 그래프 폴더는 **따로** 둡니다. 그래프는 아래 경로를 씁니다.

`~/Documents/patchbay-tutorial/my-graph`

---

## 단계 1. LangSmith 계정을 만듭니다

LangGraph 로컬 서버 공식 안내의 준비물입니다. 카드는 필요 없습니다.

1. 브라우저(Safari 또는 Chrome)를 엽니다.
2. 주소창에 그대로 칩니다.

```text
https://smith.langchain.com
```

3. **Sign up** (가입) 또는 **Log in** (이미 있으면 로그인)을 누릅니다.
4. 아래 중 **하나만** 고릅니다.
   - Google
   - GitHub
   - 이메일 + 비밀번호
5. Google/GitHub면 그 사이트가 허락을 묻습니다. 내 계정인지 확인하고 허용합니다.
6. 이메일이면 인증 메일의 링크를 엽니다.
7. 처음이면 이름·워크스페이스(작업 공간)를 묻기도 합니다. 기본값으로 두거나 `나` / `personal` 처럼 짧게 적습니다.

### 성공하면

`smith.langchain.com` 안에 대시보드(프로젝트 목록이나 홈)가 보입니다. 다시 로그인하라고만 반복되면 단계 1을 다시 합니다.

### 안 되면

- 회사 네트워크가 `langchain.com` 을 막으면 다른 네트워크에서 합니다.
- GitHub 로그인이 실패하면 Google 또는 이메일로 바꿉니다.

---

## 단계 2. API 키를 만듭니다

이 키는 내 컴퓨터의 LangGraph 서버가 LangSmith에게 “나 맞다”고 말할 때 씁니다. 비밀번호와 같습니다.

1. 같은 사이트에서 **Settings**(설정)로 갑니다.
   - 왼쪽 아래 또는 오른쪽 위 프로필 → **Settings**
   - 또는 주소창에 `https://smith.langchain.com/settings`
2. **API Keys** 항목을 엽니다.
3. **Create API Key** (키 만들기)를 누릅니다.
4. 연습용이면 이렇게 고르면 됩니다.
   - 종류: **Personal Access Token**(개인 토큰)이면 충분합니다
   - 이름: `patchbay-local`
   - 만료: 연습이면 길게, 또는 Never가 있으면 그것
5. 만들기를 확정합니다.
6. 화면에 키가 **한 번만** 나옵니다. `lsv2_` 로 시작합니다.
7. 전체를 복사해서, 나 혼자만 보는 메모(메모장, 비밀번호 앱)에 붙여 둡니다. 창을 닫으면 다시 안 보여 줍니다.

### 성공하면

메모에 `lsv2_` 로 시작하는 긴 영어·숫자 한 줄이 있습니다.

### 안 되면

- 키가 `lsv2_` 가 아니면 다른 화면을 연 것입니다. API Keys로 돌아갑니다.
- EU 등 미국이 아닌 리전으로 가입했으면, 나중에 `.env`에 `LANGSMITH_ENDPOINT` 가 더 필요할 수 있습니다. 기본(미국)이면 비워 둡니다.

---

## 단계 3. (아직 하지 마세요) 모델 키

OpenAI(`platform.openai.com`)나 Anthropic(`console.anthropic.com`) 키는 **그래프가 진짜 LLM을 부를 때** 필요합니다.

이 글의 연습 템플릿은 고정 인사(`Hi there! How are you?`)만 돌려서, **연결 확인에는 모델 키가 필요 없습니다.** 단계 9에서 Patchbay가 연결됨을 본 뒤에 해도 됩니다.

---

## 단계 4. 그래프 연습 폴더를 만듭니다

Patchbay `dev` 안이 아닙니다. Documents 아래 연습 폴더입니다.

터미널을 열고 한 줄씩 합니다.

```bash
mkdir -p "$HOME/Documents/patchbay-tutorial"
```

그다음, 공식 템플릿(최소 챗봇)을 받습니다. 인터넷이 필요합니다. 처음이면 1–2분 걸릴 수 있습니다.

```bash
npx create-langgraph@latest "$HOME/Documents/patchbay-tutorial/my-graph" --template new-langgraph-project-js
```

질문이 나오면:

| 질문 느낌 | 답 |
| --- | --- |
| Git 저장소를 초기화할까요? | `n` (아니요) 또는 `y` 둘 다 됩니다. 모르면 `n` |
| 템플릿을 고르라는 목록 | `--template` 을 쳤으면 안 나옵니다. 나오면 **New LangGraph Project** |

### 성공하면

에러 없이 끝나고, 아래가 폴더를 보여 줍니다.

```bash
ls "$HOME/Documents/patchbay-tutorial/my-graph"
```

`package.json` 과 `langgraph.json` 과 `src` 가 보이면 성공입니다.

### 안 되면

- `npx: command not found` → 세부 매뉴얼 단계 2–3 (Node). 터미널을 완전히 종료하고 다시 엽니다.
- `TTY initialization failed` → Cursor 숨은 터미널이 아니라 **터미널 앱**에서 같은 명령을 칩니다.
- `Directory is not empty` → 그 폴더를 이미 만들다 만 것입니다. Finder에서 `my-graph` 를 지우고 명령을 다시 칩니다. 안에 중요한 파일이 있으면 지우지 마세요.

---

## 단계 5. 재료를 설치합니다

```bash
cd "$HOME/Documents/patchbay-tutorial/my-graph"
pwd
```

끝이 `/my-graph` 인지 봅니다. 그다음:

```bash
npm install
```

몇 분이 걸릴 수 있습니다.

### 성공하면

마지막에 빨간 `Error` 없이 프롬프트가 돌아옵니다. `node_modules` 폴더가 생깁니다.

```bash
ls node_modules | head
```

이름이 여러 줄 나오면 됩니다.

---

## 단계 6. `.env` 에 키를 넣습니다

그래프 폴더 안에서:

```bash
cd "$HOME/Documents/patchbay-tutorial/my-graph"
cp .env.example .env
```

그다음 `.env` 를 엽니다.

- Cursor로 이 프로젝트를 여는 중이 아니면, Finder에서 `my-graph` → `.env` 를 TextEdit으로 엽니다.
- 숨김 파일이 안 보이면 Finder에서 `command`+`shift`+`.` 을 누릅니다.

파일 맨 아래에 아래를 **그대로 구조만** 넣고, `여기에키` 자리만 단계 2에서 복사한 값으로 바꿉니다. 앞뒤 따옴표는 넣지 않습니다.

```bash
LANGSMITH_API_KEY=lsv2_여기에키
```

저장합니다 (`command`+`S`).

`.env` 는 Git에 올리지 않습니다. 템플릿 `.gitignore` 에 이미 들어 있는 경우가 많습니다.

### 성공하면

`.env` 한 줄에 내 키가 있고, 화면 공유·채팅에 그 줄이 없습니다.

---

## 단계 7. LangGraph 서버를 켭니다

이 창은 **끄지 않습니다.** Patchbay용 창과 별도입니다.

```bash
cd "$HOME/Documents/patchbay-tutorial/my-graph"
npx @langchain/langgraph-cli dev --no-browser --host 127.0.0.1 --port 2024
```

`--no-browser` 는 LangSmith Studio를 자동으로 열지 말라는 뜻입니다. 지금은 Patchbay만 보면 됩니다.

### 성공하면

조금 기다리면 비슷한 줄이 보입니다.

```text
- API: http://127.0.0.1:2024
```

`Studio UI` 주소가 같이 나와도 지금은 누르지 않아도 됩니다.

이 창을 최소화만 하고 닫지 마세요.

### 안 되면

| 보이는 것 | 할 일 |
| --- | --- |
| `LANGSMITH_API_KEY` / license / Deployment | 단계 6 키, `pwd`가 `my-graph`인지 |
| `address already in use` / `EADDRINUSE` / `2024` | 예전에 켠 LangGraph가 살아 있습니다. 그 창에서 `control`+`C`. 모르면 맥을 재시작하거나 Activity Monitor에서 `node` 를 찾아 종료 |
| `Cannot find module` | 단계 5 `npm install` 을 `my-graph` 안에서 했는지 |
| 바로 끝나고 프롬프트가 돌아옴 | 위 명령을 다시. 빨간 줄 전체를 읽습니다 |
| Safari만 Studio가 안 됨 | Patchbay 연결에는 상관 없습니다. Studio를 쓸 때만 `npx @langchain/langgraph-cli dev --tunnel` |

서버가 떠 있는지 다른 터미널에서 확인:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:2024/assistants/search -H "content-type: application/json" -d '{"limit":1}'
```

`200` 이면 Patchbay가 연결할 수 있는 상태입니다. `000` 이면 서버가 안 떠 있습니다.

---

## 단계 8. Patchbay 콘솔을 켭니다

**새 터미널**을 엽니다. LangGraph 창은 그대로 둡니다.

세부 매뉴얼처럼 `dev` 로 들어갑니다. Finder에서 Patchbay의 `dev` 폴더를 `cd ` 뒤에 끌어다 놓아도 됩니다.

```bash
pwd
```

끝이 `/dev` 인지 확인한 뒤:

```bash
node packages/cli/dist/index.js flow --project practice
```

연습 프로젝트를 안 만들었으면 세부 매뉴얼 단계 8–13을 먼저 합니다. `--project` 없이 켜도 됩니다.

브라우저가 `http://127.0.0.1:4317` 을 엽니다.

---

## 단계 9. 흐름 탭에서 연결을 확인합니다

1. 왼쪽에서 **흐름** 을 누릅니다. 또는 왼쪽 아래 **LangGraph** 작은 카드를 누릅니다.
2. `연결 안 됨` 이면 **다시 연결**을 누릅니다.
3. 왼쪽 아래 LangGraph 줄이 **연결됨** 인지 봅니다.

### 성공하면 (Z2)

- LangGraph **연결됨**
- 흐름 탭에 assistant 이름이 있습니다. 이 템플릿은 `agent` 또는 그래프 이름입니다.
- 노드가 보이면 더 좋습니다. `callModel` 같은 이름이 흔합니다.

### 안 되면

- LangGraph 터미널이 `control`+`C` 로 꺼졌는지 봅니다. 꺼졌으면 단계 7을 다시 합니다.
- Patchbay를 `--port 4318` 로 켰어도 LangGraph는 **2024** 입니다. 둘을 섞지 마세요.
- `PATCHBAY_LANGGRAPH_URL` 을 예전에 바꿨으면 터미널에서 확인합니다.

```bash
echo "$PATCHBAY_LANGGRAPH_URL"
```

비어 있으면 기본값 `http://127.0.0.1:2024` 입니다. 그게 맞습니다.

---

## 단계 10. (선택) 한 번 실행해 봅니다

흐름 탭의 입력 칸에 **JSON만** 넣습니다. 한국어 문장만 넣으면 Patchbay는 실행하지 않습니다.

```json
{"messages":[{"role":"human","content":"안녕"}]}
```

실행(또는 런)을 누릅니다. 약 20초 안에 끝나야 합니다.

이 템플릿은 모델 키가 없어도 인사 문장을 돌려 줍니다. 원문/정리본 칸이 비어 있을 수 있습니다. Patchbay는 상태 키 `original` / `summary` 등을 찾을 때만 그 칸을 채웁니다. **연결됨 + 실행이 에러가 아니면** 이 단계의 성공입니다.

실행이 빨간 에러면 LangGraph를 켠 터미널의 영어 로그를 봅니다. Patchbay는 위임만 합니다.

---

## 단계 11. (선택) 그래프 폴더를 Patchbay에 등록합니다

관제 목록에 그래프 레포도 보이게 하려면, Patchbay용 터미널이 아니라 **세 번째 창**에서, `dev` 안에서:

```bash
cd "$HOME/Documents/Claude/Projects/Patchbay/dev"
```

본인 Patchbay 위치가 다르면 그 `dev`로 갑니다. 그다음:

```bash
node packages/cli/dist/index.js project add --path "$HOME/Documents/patchbay-tutorial/my-graph" --alias my-graph
```

Clarity가 40 미만이면 템플릿 `README.md` 가 있는데도 점수가 낮을 수 있습니다. 그때만 `--force-add` 를 붙입니다.

등록은 **흐름 탭 연결과 별개**입니다. 흐름 탭은 `langgraph dev` 프로세스만 보면 됩니다.

---

## 단계 12. 끌 때

1. Patchbay 터미널에서 `control`+`C` (command+C 아님).
2. LangGraph 터미널에서도 `control`+`C`.
3. 브라우저 탭은 닫아도 됩니다.

하나만 끄면 다른 쪽은 “연결 안 됨”이 됩니다. 그게 정상입니다.

---

## 단계 13. 다음날 다시 켜는 법

**순서:** LangGraph를 먼저 켜고, 그다음 Patchbay.

터미널 1:

```bash
cd "$HOME/Documents/patchbay-tutorial/my-graph"
npx @langchain/langgraph-cli dev --no-browser --host 127.0.0.1 --port 2024
```

`API: http://127.0.0.1:2024` 가 보이면,

터미널 2:

```bash
cd "$HOME/Documents/Claude/Projects/Patchbay/dev"
node packages/cli/dist/index.js flow --project practice
```

`dev` 경로가 다르면 본인 경로로 바꿉니다.

---

## 단계 14. (나중) 진짜 모델을 붙일 때

`src/agent/graph.ts` 주석에 Anthropic / OpenAI 예가 있습니다. 그때:

1. OpenAI는 [platform.openai.com](https://platform.openai.com) 가입 → API keys → Create. 결제 수단을 물을 수 있습니다.
2. Anthropic은 [console.anthropic.com](https://console.anthropic.com) 가입 → API Keys.
3. `.env`에 예:

```bash
OPENAI_API_KEY=sk-...
```

또는

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

4. LangGraph 서버를 `control`+`C` 후 단계 7처럼 다시 켭니다. `.env` 는 켤 때 읽습니다.

Patchbay 계정은 생기지 않습니다. 모델 요금은 그 업체 몫입니다.

---

## 단계 15. (나중) LangSmith Studio

LangGraph를 켠 터미널이 알려 주는 Studio 주소는 대략 이렇게입니다.

```text
https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2024
```

여기는 Patchbay가 아닙니다. 그래프를 LangChain이 제공하는 화면에서 디버그할 때 씁니다. Safari가 localhost를 막으면 `--tunnel` 이 필요합니다. **Patchbay 흐름 탭은 Safari에서도** `http://127.0.0.1:4317` 로 열면 됩니다.

---

## 막혔을 때

| 보이는 것 | 먼저 할 일 |
| --- | --- |
| LangSmith가 로그인만 반복 | 단계 1. 다른 브라우저, 추적 방지 해제 |
| API 키를 다시 못 봄 | 단계 2에서 **새 키**를 만들고 `.env`를 고칩니다. 옛 키는 버려도 됩니다 |
| `npx` 없음 | 세부 매뉴얼 Node 설치. 터미널 재실행 |
| 템플릿이 안 받아짐 | 인터넷, 단계 4를 터미널 앱에서 |
| `npm install` 빨간 에러 | `pwd`가 `my-graph`인지, 같은 명령 재시도 |
| 2024 포트 사용 중 | 옛 `langgraph` 창 `control`+`C` |
| Patchbay는 켜졌는데 연결 안 됨 | 단계 7 창이 살아 있는지, `curl` 이 `200`인지 |
| 흐름 탭은 연결됨, 실행만 실패 | LangGraph 로그. JSON 형식. 모델 키는 이 템플릿에선 보통 불필요 |
| 키를 채팅에 붙여 버림 | LangSmith에서 그 키를 지우고 단계 2를 다시 |

---

## Python으로 하고 싶을 때 (이 글의 본길이 아님)

이미 Python 3.11 이상이 있으면 [Python 로컬 서버 안내](https://docs.langchain.com/oss/python/langgraph/local-server) 를 따릅니다. `pip install -U "langgraph-cli[inmem]"` → `langgraph new … --template new-langgraph-project-python` → `.env` → `langgraph dev`. Patchbay가 보는 주소는 똑같이 `http://127.0.0.1:2024` 입니다. Node가 있는 사람은 위 JS 경로가 세부 매뉴얼과 맞습니다.

---

## 한 장 요약 (이미 계정이 있는 사람용)

브라우저: `https://smith.langchain.com` 로그인 → Settings → API Keys → 키 복사.

```bash
npx create-langgraph@latest "$HOME/Documents/patchbay-tutorial/my-graph" --template new-langgraph-project-js
cd "$HOME/Documents/patchbay-tutorial/my-graph"
npm install
cp .env.example .env
# .env 에 LANGSMITH_API_KEY=lsv2_... 저장
npx @langchain/langgraph-cli dev --no-browser --host 127.0.0.1 --port 2024
```

다른 창, Patchbay `dev` 안에서:

```bash
node packages/cli/dist/index.js flow --project practice
```

흐름 탭 → 다시 연결 → LangGraph 연결됨.
