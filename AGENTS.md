# 프로젝트 에이전트 운영 규칙

이 프로젝트는 `sources/`에 사용자가 업무별로 구성한 원자료를 LLM Wiki로 정리하고, Graphify로 관계를 시각화한 뒤, 팀이 RAG 답변과 산출물에 활용하는 지식 작업공간이다.

기본 응답과 작성물은 한국어로 작성한다. 제품명, 회사명, 라이브러리명, 명령어처럼 영어 표기가 자연스러운 항목은 원문을 유지한다.

## Graphify 우선 규칙

이 프로젝트에는 `graphify-out/`에 god node, community structure, cross-file relationship을 담은 지식 그래프가 생성될 수 있다.

사용자가 `/graphify`를 입력하면 다른 작업보다 먼저 `skill` tool을 `skill: "graphify"`로 호출한다.

규칙:

- 소스 파일을 읽거나, grep/glob 검색을 하거나, 코드베이스/문서 구조 질문에 답하기 전에 항상 `graphify-out/GRAPH_REPORT.md`를 먼저 읽는다. 파일이 없으면 아직 그래프가 생성되지 않은 상태로 보고, 그 사실을 명시한 뒤 `readme.md`와 실제 폴더 구조를 확인한다.
- `graphify-out/wiki/index.md`가 있으면 raw file을 바로 읽기보다 해당 wiki index를 먼저 탐색한다.
- `llm-wiki/wiki/**/*.md` 내용은 기본적으로 한국어로 유지한다. H1 제목, 섹션 제목, 요약, 핵심 포인트, Obsidian 스타일 `[[...]]` 링크도 한국어를 우선한다.
- 목차나 운영 파일은 그래프 콘텐츠 노드로 보여주지 않는다. 시각 지식 그래프에서는 `llm-wiki/AGENTS.md`, `llm-wiki/wiki/index.md`, `llm-wiki/wiki/log.md`, `llm-wiki/wiki/ontology/relations.md`, raw manifest 파일을 제외한다.
- HTML 지식 그래프는 파일 간 wiki link를 방향 화살표로 보여줘야 한다. `A -> B`는 `A.md`가 `B.md`로 해석되는 Obsidian 스타일 링크를 포함한다는 뜻이다. 양방향 링크는 양쪽 페이지가 서로 링크한다는 뜻이다.
- 일반 `[[...]]` 링크는 탐색용 연결이고 `llm-wiki/wiki/ontology/relations.md`의 관계 목록은 의미가 정해진 typed relation의 단일 원본이다. typed relation은 `검토`, `확정`, `제외` 중 하나의 상태를 가져야 한다.
- 로컬 HTML 그래프를 재생성할 때는 `node scripts/build-wiki-graph.mjs`를 사용한다. 이 스크립트는 대표 산출물 `graphify-out/graph.json`, `graphify-out/graph.html`, `graphify-out/GRAPH_REPORT.md`와 프로젝트 루트의 `ontology-editor.html`, `지식관리-대시보드.html`을 생성하며, 이전 중복 별칭인 `wiki-graph.*`, `WIKI_GRAPH_REPORT.md`는 제거한다. `검토`와 `확정` typed relation은 상태와 근거를 보존해 그래프에 넣고 `제외`는 활성 edge에서 뺀다.
- "X와 Y가 어떻게 연결되는가" 같은 cross-module 질문은 grep보다 `graphify query "<question>"`, `graphify path "<A>" "<B>"`, `graphify explain "<concept>"`를 우선 사용한다. 이 명령들은 단순 파일 검색이 아니라 EXTRACTED + INFERRED edge를 따라간다.
- Windows에서 `graphify` 명령이 경로 문제로 실패하면 설치된 Python으로 `py -m graphify ...`를 사용한다.
- `sources/`, `llm-wiki/wiki/`, `llm-wiki/outputs/`, 그래프 생성 스크립트처럼 사용자 지식 콘텐츠나 그래프 생성 규칙에 영향을 주는 파일을 수정한 뒤에는 `node scripts/build-wiki-graph.mjs`를 실행한다. 이 프로젝트의 `graphify-out/`은 Wiki 그래프 전용이므로 일반 갱신에 `graphify update . --force`를 사용하지 않는다.
- `README`, `AGENTS.md`, `.gitignore`처럼 운영 설명이나 에이전트 행동 규칙만 바꾸는 경우에는 사용자 지식 그래프 변경이 아니므로 Graphify 갱신을 생략한다.

### 온톨로지 관계 편집

- `llm-wiki/wiki/ontology/relations.md`가 관계 유형과 관계 목록의 기준 파일이다. 사용자가 관계 유형을 추가하거나 관계의 방향·근거·상태를 수정할 수 있다.
- 프로젝트 루트의 `ontology-editor.html`은 외부 라이브러리나 서버 없이 더블클릭해 여는 standalone 편집기다. 생성 시점의 관계를 내장하며, 다른 `relations.md`를 불러오거나 수정본을 저장·다운로드할 수 있다.
- standalone HTML은 브라우저 보안상 Node/Graphify 명령을 실행할 수 없으므로 저장 후 그래프를 자동 생성하지 않는다. 그래프까지 자동 반영하려면 프로젝트 루트에서 `node scripts/serve-ontology-editor.mjs`를 실행하고 `http://127.0.0.1:8766/`을 연다.
- HTML에서 저장하면 `relations.md`를 검증해 원자적으로 저장하고 `node scripts/build-wiki-graph.mjs`를 자동 실행한다. 저장 충돌, 미등록 관계 유형, 잘못된 상태, 중복 관계가 있으면 원본을 덮어쓰지 않는다.
- 새 관계는 기본적으로 `확정`으로 추가한다. `검토`는 다른 팀원의 검토가 필요한 관계를 뜻한다. `제외`는 맞지 않는 관계이며 향후 동일 관계도 제외한다는 뜻이므로 삭제하지 않고 기록으로 남긴다.
- 관계 객체는 가능하면 실제 wiki 문서의 H1과 일치하는 `[[객체명]]`으로 쓴다. 관계 유형의 `적용 분류`는 현재 `sources/` 바로 아래의 실제 업무 폴더명 또는 모든 분류를 뜻하는 `공통`을 사용한다. 기존 유형으로 의미를 표현할 수 없을 때만 새 유형을 추가한다.

### 지식관리 대시보드와 공유 실행

- macOS 사용자는 루트의 `지식관리-대시보드.command`, Windows 사용자는 `지식관리-대시보드.cmd`를 더블클릭한다.
- launcher는 자신의 위치를 프로젝트 루트로 사용하므로 Google Drive 동기화 경로가 사용자마다 달라도 절대경로 수정이 필요 없다.
- 필수 의존성은 Node.js뿐이다. Node.js가 없으면 macOS는 Homebrew 또는 Node.js 공식 서명 PKG, Windows는 winget 또는 Node.js 공식 서명 MSI로 LTS 설치를 시도한다. 다른 선택 의존성은 자동 설치하지 않는다.
- 설치 과정에서 OS가 관리자 권한이나 UAC 승인을 요구하면 사용자가 직접 승인해야 한다. 설치가 거부되거나 네트워크가 차단되면 launcher는 원인을 표시하고 중단한다.
- launcher는 그래프와 대시보드를 갱신하고 로컬 서버를 시작한 뒤 `/dashboard`를 연다. 이 모드에서는 `relations.md` 업로드가 필요 없으며 저장 후 그래프와 대시보드도 자동 갱신된다.
- 대시보드는 `sources/` 바로 아래의 폴더를 실행 시점에 다시 탐색한다. `.` 또는 `_`로 시작하는 폴더는 원자료 분류에서 제외한다.
- Google Drive 공유 권한이 있는 사용자는 동일 파일을 편집할 수 있지만 동시 저장은 충돌 파일을 만들 수 있다. 한 번에 한 명만 편집하고, 편집 전 대시보드를 다시 열어 최신 동기화본을 사용한다.

## 질문 유형별 작업 방식

### 로컬 HTML 목업과 인앱 브라우저 사용

사용자가 HTML 목업, 로컬 웹 화면, `localhost`, `127.0.0.1`, 또는 인앱 브라우저 표시를 요청하면 다음 순서로 처리한다.

1. Browser 플러그인이 사용 가능한 경우 먼저 Browser skill 지침을 확인하고 Codex 인앱 브라우저를 우선 사용한다.
2. 단일 HTML 파일을 바로 보여줘야 하면 `file://`보다 로컬 정적 서버를 우선한다. Windows 환경에서는 다음 방식이 가장 단순하다.

```powershell
C:\Python314\python.exe -m http.server 8766 --bind 127.0.0.1
```

3. 서버는 HTML 파일이 있는 폴더에서 실행한다. 사용자가 지정한 파일 위치를 working directory로 두고 해당 파일명으로 로컬 URL을 안내한다.
4. 백그라운드 서버가 샌드박스 안에서 바로 종료될 수 있으므로, 사용자가 실제로 봐야 하는 로컬 서버는 필요하면 승인 요청 후 샌드박스 밖에서 실행한다.
5. URL을 안내하거나 브라우저에 열기 전에 반드시 `Invoke-WebRequest -UseBasicParsing <url>`로 `200 OK`와 응답 길이를 확인한다.
6. 사용자가 이미 열어둔 포트가 죽어 있으면 새 포트를 안내하기보다 가능하면 같은 포트에서 서버를 다시 띄운 뒤 새로고침을 요청한다.
7. 인앱 브라우저 자동화가 로컬 URL을 `ERR_BLOCKED_BY_CLIENT`, `ERR_CONNECTION_REFUSED`, 또는 Browser Use URL policy로 막으면 우회하지 않는다. 서버 상태, 포트, 바인딩 주소를 확인한 뒤에도 막히면 그 제한을 설명하고, 사용자의 승인 하에 기본 데스크톱 브라우저로 열거나 정적 이미지/스크린샷 대안을 제공한다.
8. 로컬 HTML 목업이나 장기 보존 문서의 기본 저장 위치를 정하지 않는다. 사용자가 저장 위치를 명시한 경우에만 해당 위치에 저장한다.

### 프로젝트 구조나 현재 상태를 묻는 질문

참고 순서:

1. `graphify-out/GRAPH_REPORT.md`
2. `graphify-out/wiki/index.md`가 있으면 해당 index
3. `readme.md`
4. 필요한 경우에만 관련 원본 파일

응답 방식:

- 그래프의 god node, community, surprising connection을 먼저 활용해 큰 지형을 설명한다.
- 필요한 파일 경로는 절대 경로 링크로 제시한다.
- 변경이 필요 없는 질문이면 파일을 수정하지 않는다.

### 특정 개념, 기업, 시장, 기술 관계를 묻는 질문

참고 순서:

1. `graphify-out/GRAPH_REPORT.md`
2. `llm-wiki/wiki/index.md`
3. 관련 `llm-wiki/wiki/concepts/`, `entities/`, `sources/` 문서
4. 관계형 질문이면 `graphify query`, `graphify explain`, `graphify path`

활용 도구:

- Graphify: 개념 간 연결, 핵심 노드, 경로 확인
- LLM Wiki: 기존 요약, 출처, 개념 노트 확인

Wiki 반영 요청 시:

- 사용자가 Wiki 반영을 명시한 경우에만 새 개념은 `llm-wiki/wiki/concepts/`, 기업·인물·제품은 `llm-wiki/wiki/entities/`, 원천 자료 요약은 `llm-wiki/wiki/sources/`에 저장한다.
- 변경했다면 `llm-wiki/wiki/index.md`와 `llm-wiki/wiki/log.md`도 함께 갱신한다.

### RAG 기반 질문·문서 생성·아이디어 요청

사용자는 RAG 기반 질문, 문서 생성, 아이디어 발굴·검토를 요청할 수 있다. 세 요청은 결과 형식만 다르며 기본 참조 절차는 동일하다. 전체 파일을 모두 읽지 말고 `찾기 → 검증 → 근거 확인` 순서로 질문에 필요한 범위까지만 읽는다.

#### 1단계: 관련 지식 찾기

1. `graphify-out/GRAPH_REPORT.md`
   - 내용: 전체 문서 수, 핵심 문서, 문서 간 연결, 주요 지식 군집, 해석되지 않은 링크와 관계.
   - 목적: 질문과 관련된 지식 영역과 후보 문서를 찾는다. 이 보고서 자체를 최종 사실 근거로 사용하지 않는다.
   - 파일이 없으면 그래프가 아직 생성되지 않았다고 밝히고 다음 단계로 진행한다.
2. `llm-wiki/wiki/index.md`
   - 내용: source, concept, entity, idea, decision 문서의 목차와 Wiki 링크.
   - 목적: 실제로 읽어야 할 문서를 선택한다.
   - 파일이 없으면 `llm-wiki/wiki/`의 관련 폴더를 직접 확인한다.

#### 2단계: 관계와 정리된 지식 검증

3. `llm-wiki/wiki/ontology/relations.md`
   - 내용: 객체 간 관계 유형, 출발·도착 객체, 방향, 근거, 위치, `검토·확정·제외` 상태.
   - 목적: 상태가 `확정`인 관계만 객체 간 연결과 추론의 근거로 선택한다.
4. 관련 `llm-wiki/wiki/decisions/`, `concepts/`, `entities/`, `ideas/`
   - `decisions/`: 기존 판단, 선택 결과와 근거.
   - `concepts/`: 반복되는 핵심 개념의 정의와 관련 문서.
   - `entities/`: 회사, 제품, 인물, 조직 등 객체 정보.
   - `ideas/`: 기존 아이디어, 가정, 검증 질문과 실험.
   - 목적: 질문의 의미와 기존 지식·결정·아이디어의 연결을 이해한다.

#### 3단계: 답변 근거 확인

5. 관련 `llm-wiki/wiki/sources/`
   - 내용: 원문별 요약, 주요 기준·수치, 출처, 페이지 근거, 관련 문서.
   - 목적: 답변, 문서, 아이디어의 주된 사실 근거로 사용한다.
6. 필요한 경우 `sources/_generated/`
   - 내용: 원본을 Markdown으로 변환한 내용, 페이지 경계, 텍스트 추출 상태, 세부 문맥.
   - 목적: Wiki source에 필요한 문맥이나 원문 표현이 부족할 때만 확인한다.
7. 정확한 조문·페이지·수치·표·도면 확인이 필요한 경우에만 관련 `sources/<업무 폴더>/` 원본
   - 내용: PDF 등 최종 원본 파일과 원본의 표·도면·페이지.
   - 목적: 정확성이 중요한 내용을 최종 검증한다.

읽기 중단 및 확장 조건:

- 신뢰할 수 있는 답변 근거가 확보되면 더 깊은 단계의 파일을 불필요하게 읽지 않는다.
- 관계를 주장하지 않는 단순 사실 질문이라도 관련 `wiki/sources/`에서 사실과 출처를 확인한다.
- Wiki source만으로 문맥이 충분하면 변환 Markdown과 원본을 읽지 않는다.
- 정확한 법률 조문, 수치, 표, 페이지가 필요하면 반드시 최종 원본까지 확인한다.
- 관련 Wiki 문서가 없으면 그 사실을 밝히고, 필요한 원자료를 사용자에게 요청하거나 최신 정보가 필요한 경우 웹 검색으로 확인한다.

공통 근거 규칙:

- 객체 간 관계를 사실이나 추론 근거로 사용할 때는 `relations.md`에서 상태가 `확정`인 관계만 사용한다.
- `검토`는 다른 팀원의 검토가 필요한 관계다. 답변, 문서, 아이디어의 사실 주장이나 추론에는 사용하지 않고, 사용자가 관계 검토 자체를 요청한 경우에만 후보임을 분명히 표시해 별도로 제시한다.
- `제외`는 맞지 않는 관계이며 향후 동일 관계도 제외하라는 의미다. 답변, 문서, 아이디어와 그래프의 활성 관계에서 사용하지 않는다.
- 관계 상태와 별개로 원문 또는 ingest 문서에서 직접 확인한 사실은 출처와 위치를 제시해 근거로 사용할 수 있다. 확인되지 않은 typed relation으로 문서 사이를 연결해 추론해서는 안 된다.
- 결과에는 사용한 wiki 문서와 원문 위치를 가능한 범위에서 함께 제시한다.

요청별 처리:

- RAG 기반 질문은 확인된 사실과 `확정` 관계를 중심으로 직접 답한다.
- 문서 생성은 대상 독자, 목적, 구조, 톤을 요청 내용에서 파악하고 공통 참조 절차로 확보한 근거를 사용한다. 문서의 기본 저장 위치를 정하거나 별도 경로를 안내하지 않는다. 사용자가 저장 위치를 명시한 경우에만 해당 위치에 저장한다.
- 아이디어 요청은 관련 `ideas/`, `decisions/`, `concepts/`, `entities/`를 확인해 기존 지식과 연결한다. 직접 관련된 기존 문서가 없으면 그 사실을 밝히고 사용자 아이디어를 1차 원문으로 삼아 문제, 대상 사용자, 가정, 검증 질문, 첫 실험을 정리한다.
- 최신 사실이나 외부 근거가 필요하지만 로컬 자료가 부족하면 웹 검색으로 확인하거나 필요한 원자료를 사용자에게 요청한다.
- 사용자가 결과를 Wiki에 반영하도록 명시적으로 요청한 경우에만 관련 문서를 갱신하고, Wiki 구조가 바뀌면 `llm-wiki/wiki/index.md`, `llm-wiki/wiki/log.md`, Graphify를 함께 갱신한다.

### 자료 ingest 또는 원천 자료 정리를 요청한 경우

참고 순서:

1. `sources/`
2. `llm-wiki/wiki/index.md`
3. `llm-wiki/wiki/log.md`
4. 기존 `llm-wiki/wiki/sources/`, `concepts/`, `entities/`, `ideas/`

`sources/` 입력 구조:

- `sources/` 바로 아래의 폴더는 사용자가 업무 특성에 맞게 자유롭게 구성한다.
- 바로 아래 폴더명이 해당 자료의 `source_category`다. 숫자 접두어나 특정 산업 분류를 가정하지 않는다.
- 각 업무 폴더 아래에는 하위 폴더를 자유롭게 둘 수 있다.
- `sources/_generated/`는 원문 변환 Markdown 전용 예약 폴더이며 원자료 ingest 대상에서 제외한다.
- `.` 또는 `_`로 시작하는 다른 폴더도 시스템·임시 폴더로 보고 자동 ingest 대상에서 제외한다.

wiki ingest 요청 시 PDF 사전 처리:

- 폴더 생성, 이동, 구조 확인만 요청받은 경우 ingest를 시작하지 않는다. 사용자가 명시적으로 ingest를 요청한 경우에만 원문 내용을 읽고 wiki를 갱신한다.
- 원본을 Markdown으로 변환하기 전에 항상 `templates/source-markdown.md`를 읽고, 모든 분류에 동일한 기본 구조를 적용한다. 해당하지 않는 필드는 `확인 불가`로 남기고 추정해서 채우지 않는다.
- 사용자가 wiki ingest를 요청하면 먼저 `sources/`의 현재 바로 아래 폴더 목록을 읽고, 사용자가 지정한 범위가 있으면 그 폴더만 재귀적으로 확인한다. 범위가 없으면 예약 폴더를 제외한 모든 업무 폴더를 확인한다.
- 각 PDF마다 `sources/_generated/`에 이미 대응되는 Markdown 변환본이나 요약본이 있는지 확인한다. 파일명 stem, 제목, 또는 변환본의 `source`/`source_file` 메타데이터로 같은 원본임을 판단한다.
- 대응되는 Markdown이 없고 PDF 변환이 필요하면 원본 PDF는 수정하지 않고 `sources/_generated/` 아래에 원본 분류를 알 수 있는 Markdown 변환본을 생성한다.
- 변환본에는 `templates/source-markdown.md`에 정의된 메타데이터, 원문 구조, 페이지 경계, 핵심 요약, 주요 기준·수치·요건, 추출 메모를 가능한 범위에서 포함한다.
- `pypdf` 텍스트 추출이 비어 있거나 이미지·표·도면의 핵심 정보가 텍스트에 반영되지 않은 페이지는 필요한 페이지만 이미지로 렌더링해 클라우드 VLM으로 분석한다. 문서 이미지의 외부 전송 승인이 현재 요청에 명시되지 않았다면 먼저 사용자에게 알리고 승인을 받는다.
- `scripts/ingest-pdf-sources.py`는 텍스트 변환과 빈 페이지 표시만 수행하며 클라우드에 파일을 자동 전송하지 않는다. AI agent가 문서 구조를 함께 확인해 혼합형 페이지의 표·도면 누락 여부를 판단하고, 승인된 페이지만 VLM에 전달한다.
- VLM 분석 기록에는 모델명, PDF 페이지, 페이지 유형, 판독 내용, RAG 반영 여부와 불확실성을 남긴다. 수치·표·도면은 추정하지 않고 판독이 모호하면 원 PDF 시각 재확인 대상으로 유지한다.
- VLM이 필요한 페이지를 분석하지 못한 경우 `VLM 분석 필요` 또는 `부분` 상태로 남기고 ingest 완료로 간주하지 않는다. 렌더링한 임시 이미지는 `sources/`나 Git에 저장하지 않는다.
- 변환본 파일명은 `YYYY-MM-DD_분류_제목.md`를 우선 사용하고, 제목이나 날짜를 알 수 없으면 PDF 파일명과 작업일을 사용한다.
- 이미 변환본이 있으면 덮어쓰지 않는다. 내용 갱신이 필요해 보이면 사용자에게 확인하거나 별도 새 파일로 저장한다.
- PDF 사전 처리가 끝난 뒤 사용자가 지정한 업무 폴더와 `sources/_generated/`의 대응 Markdown을 LLM Wiki ingest 대상으로 삼는다.
- ingest한 원문별 Markdown 지식 노트는 `llm-wiki/wiki/sources/`에 저장한다. 원본 변환본만 `sources/_generated/`에 둔다.
- ingest 중 발견한 객체 관계는 `templates/source-markdown.md`의 표 형식으로 추출하고 `llm-wiki/wiki/ontology/relations.md`의 관계 목록에 중복 없이 합친다. 새 관계의 기본 상태는 `확정`이며, 다른 팀원의 검토가 필요할 때만 `검토`로 지정한다.
- 문서 성격이 법률·시행령·시행규칙·고시·지침이면 위임, 구체화, 개정, 폐지·대체, 예외, 적용, 요구, 금지, 허용, 참조 관계의 방향과 근거 조문을 우선 기록한다. 다른 업무 자료는 실제 내용에 맞는 관계 유형을 사용한다.

활용 도구:

- LLM Wiki 또는 `llm-wiki-ideation`: 원자료를 wiki note로 변환하고 cross-link 생성
- Graphify: ingest 이후 관계 그래프 갱신

성과물 저장:

- PDF 원본을 Markdown으로 변환해달라는 요청이면 원본 PDF는 수정하지 않고 변환본을 `sources/_generated/`에 저장한다.
- 사용자 정의 업무 분류 자료와 생성 Markdown의 wiki 요약은 `llm-wiki/wiki/sources/`에 저장한다.
- 반복 등장하는 주제는 `llm-wiki/wiki/concepts/`에 저장한다.
- 회사, 제품, 인물, 조직은 `llm-wiki/wiki/entities/`에 저장한다.
- 판단이나 선택 근거는 `llm-wiki/wiki/decisions/`에 저장한다.
- 객체 간 typed relation은 `llm-wiki/wiki/ontology/relations.md`에 저장하고 일반 본문 링크와 구분한다.
- 원자료 자체는 `sources/`에서 수정하지 않는다. 단, PDF 변환 요청의 결과물은 원본과 구분해 `sources/_generated/`에 새 Markdown 파일로 저장할 수 있다.

### 실행계획, PoC, 구현, 자동화 요청

참고 순서:

1. 관련 wiki idea, decision, concept 문서
2. 기존 `llm-wiki/outputs/docs/` 산출물
3. 실제 코드나 스크립트가 있으면 `scripts/` 및 관련 파일

활용 도구:

- LLM Wiki: 관련 요구사항, 근거, 기존 결정을 확인
- 구현 단계가 여러 개인 경우 실행계획을 먼저 작성한다.
- 코드 변경이나 자동화 로직 구현은 테스트를 우선하고, 완료라고 말하기 전에 결과를 검증한다.
- PoC의 핵심 가정, 리스크, 반론을 문서에 명시한다.

성과물 저장:

- 설계서, 실행계획, 운영 문서의 기본 저장 위치는 정하지 않는다. 사용자가 위치를 명시한 경우에만 해당 위치에 저장한다.
- 코드 산출물은 사용자가 지정한 위치를 우선하고, 위치가 필요한데 지정되지 않은 경우에만 확인한다.
- 작업 결과가 wiki 지식 구조에 영향을 주면 관련 `ideas/`, `decisions/`, `concepts/` 문서를 갱신한다.

## 성과물 저장 원칙

- 사용자가 저장 위치를 명시하면 그 위치를 우선한다.
- 사용자가 요청한 문서, 보고서, 발표자료, 아이디어, 실행계획에는 기본 저장 위치를 지정하지 않는다. 저장 위치가 명시되지 않으면 임의의 폴더에 저장하지 않는다.
- ingest 변환본, Wiki 지식 노트, 온톨로지 관계처럼 시스템 운영상 위치가 정해진 파일만 해당 지침의 기존 경로를 사용한다.
- `sources/`, `llm-wiki/`, `graphify-out/`의 실제 내용은 개인 작업물로 보고 GitHub에 올리지 않는다. 폴더 구조 유지를 위한 `.gitkeep`만 추적한다.
- 모든 wiki 문서는 Obsidian에서 탐색하기 쉽게 `[[...]]` 링크를 적극 사용한다.
- 새 문서를 만들거나 기존 wiki 구조를 바꾸면 `llm-wiki/wiki/index.md`와 `llm-wiki/wiki/log.md`를 갱신한다.
- 작업 완료 전에는 필요한 검증 명령을 실행하고, 실행하지 못한 검증은 이유를 명확히 말한다.
