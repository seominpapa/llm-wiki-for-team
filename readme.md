# LLM Wiki for Team

팀의 원자료를 Markdown Wiki로 정리하고, 검토 가능한 온톨로지 관계와 로컬 지식 그래프를 만들어 RAG 답변에 활용하는 작업공간입니다.

원본 자료와 생성된 Wiki·그래프는 로컬 또는 팀 공유 드라이브에만 보관합니다. GitHub에는 재사용 가능한 규칙, 템플릿, 스크립트와 빈 폴더 구조만 저장합니다.

## 처리 흐름

```text
sources/의 사용자 정의 업무 폴더
  → templates/source-markdown.md 형식으로 원문 Markdown 변환
  → sources/_generated/에 변환본 저장
  → llm-wiki/wiki/에 ingest
  → ontology/relations.md에서 관계 검토·확정
  → graphify-out/ 지식 그래프 생성
  → 원문 근거와 확정 관계를 사용한 RAG 답변
```

핵심 원칙:

- 원본 파일은 수정하지 않습니다.
- ingest는 사용자가 명시한 범위에서만 실행합니다.
- 새 객체 관계는 기본적으로 `확정` 상태로 시작합니다.
- RAG 관계 추론에는 `확정` 관계만 사용합니다.
- `검토`는 다른 팀원의 검토가 필요하다는 의미입니다.
- `제외`는 맞지 않는 관계이며 향후 동일 관계도 제외한다는 의미입니다.

## sources 폴더를 업무에 맞게 구성하기

새 저장소의 `sources/`는 비어 있습니다. 사용자가 업무에서 실제로 사용하는 분류를 바로 아래 폴더로 만드세요.

예시:

```text
sources/
├── 고객 계약서/
│   ├── 국내/
│   └── 해외/
├── 제품 매뉴얼/
├── 회의록/
├── 시장 조사/
└── _generated/          # 시스템이 만드는 원문 변환 Markdown
```

다른 업무 예시:

- 법무팀: `계약서`, `법률`, `판례`, `내부 규정`
- 기술팀: `요구사항`, `설계 문서`, `매뉴얼`, `시험 보고서`
- 영업팀: `고객 자료`, `제안서`, `시장 조사`, `미팅 기록`
- 연구팀: `논문`, `실험 기록`, `데이터 설명`, `외부 기준`

폴더 규칙:

1. `sources/` 바로 아래 폴더명이 `source_category`가 됩니다.
2. 각 분류 안에는 필요한 만큼 하위 폴더를 만들 수 있습니다.
3. `_generated/`는 변환본 저장용 예약 폴더이며 ingest 원본 검색에서 제외됩니다.
4. `.` 또는 `_`로 시작하는 폴더는 시스템·임시 폴더로 보고 자동 분류에서 제외합니다.
5. 분류명을 바꾸려면 ingest 전에 바꾸는 것이 안전합니다. ingest 후 이름을 바꾸면 기존 Markdown의 `source_category`와 `source_file`도 함께 갱신해야 합니다.
6. 원자료는 GitHub에 올라가지 않습니다. 팀 공유가 필요하면 Google Drive, 사내 파일 서버 등 별도 저장소를 사용하세요.

AI agent는 ingest를 시작할 때 현재 `sources/` 폴더 구조를 다시 읽고, 실제 존재하는 분류만 사용합니다. 특정 산업이나 번호 체계를 강제하지 않습니다.

## 폴더 구조

```text
llm-wiki-for-team/
├── AGENTS.md
├── readme.md
├── templates/
│   └── source-markdown.md
├── scripts/
│   ├── ingest-pdf-sources.py
│   ├── build-wiki-graph.mjs
│   ├── serve-ontology-editor.mjs
│   ├── lib/
│   └── *.test.*
├── sources/
│   └── .gitkeep
├── llm-wiki/
│   ├── raw/
│   ├── wiki/
│   │   ├── sources/
│   │   ├── concepts/
│   │   ├── entities/
│   │   ├── ideas/
│   │   ├── decisions/
│   │   └── ontology/
│   └── outputs/
├── graphify-out/
│   ├── graph.html                 # 사용자가 여는 지식 그래프
│   ├── graph.json                 # 그래프 원본 데이터
│   ├── GRAPH_REPORT.md            # 그래프 요약 보고서
│   ├── cache/                     # Graphify 내부 캐시
│   └── manifest.json              # 증분 처리 이력
├── ontology-editor.html              # 로컬 생성 파일
├── 지식관리-대시보드.html             # 로컬 생성 파일
├── 지식관리-대시보드.command          # macOS 실행기
└── 지식관리-대시보드.cmd              # Windows 실행기
```

## 가장 쉬운 실행 방법

운영체제에 맞는 파일을 더블클릭합니다.

- macOS: `지식관리-대시보드.command`
- Windows: `지식관리-대시보드.cmd`

실행기가 자동으로 수행하는 작업:

1. 자신의 위치를 프로젝트 루트로 설정
2. Node.js 확인 및 없으면 공식 LTS 설치 시도
3. 현재 `sources/` 업무 폴더를 자동 탐색
4. Wiki 그래프와 대시보드 재생성
5. 로컬 편집 서버 시작
6. 기본 브라우저에서 대시보드 열기

Node.js 자동 설치에는 인터넷 연결과 관리자 승인 또는 UAC 승인이 필요할 수 있습니다. 조직 정책이 설치를 차단하면 [Node.js LTS](https://nodejs.org/)를 수동 설치한 뒤 다시 실행하세요.

## PDF 원본 변환

AI agent에 ingest를 요청하면 먼저 원본과 기존 변환본을 비교합니다. 직접 실행할 수도 있습니다.

```bash
python3 scripts/ingest-pdf-sources.py "sources/제품 매뉴얼" \
  --source-root sources
```

기본 출력 위치는 `sources/_generated/`입니다. `pypdf`가 없다면 다음 명령으로 설치합니다.

```bash
python3 -m pip install pypdf
```

변환본은 [공통 템플릿](templates/source-markdown.md)을 사용하며 다음 정보를 포함합니다.

- 원본 상대경로와 사용자 정의 분류
- 제목, 발행처, 발행일, 문서 유형
- 페이지 경계와 원문 텍스트
- 핵심 요약과 주요 기준·수치·요건
- 기본 `확정` 상태의 typed relation 후보
- 클라우드 VLM 분석 페이지·모델·판독 결과·불확실성

텍스트가 추출되지 않거나 이미지·표·도면에 핵심 정보가 있는 페이지는 필요한 페이지만 이미지로 렌더링해 클라우드 VLM으로 분석합니다. 문서 이미지 전송 전에 사용자 승인을 받고, 모델명과 페이지를 기록하며, 모호한 수치·표·도면은 원 PDF 재확인 대상으로 남깁니다. VLM 분석이 필요한 페이지가 처리되지 않으면 ingest 완료로 보지 않습니다.

변환 스크립트는 텍스트 추출과 빈 페이지 표시까지만 담당하며 파일을 클라우드로 자동 전송하지 않습니다. AI agent가 혼합형 페이지의 표·도면 누락 여부를 확인한 뒤, 사용자가 승인한 페이지만 클라우드 VLM으로 분석합니다.

기존 변환본은 덮어쓰지 않습니다.

## Wiki ingest 저장 위치

| 내용 | 위치 |
| --- | --- |
| 원본 PDF·문서 | `sources/<사용자 업무 폴더>/` |
| 원본 변환 Markdown | `sources/_generated/` |
| 원문별 Wiki 노트 | `llm-wiki/wiki/sources/` |
| 반복 개념 | `llm-wiki/wiki/concepts/` |
| 회사·제품·인물·조직 | `llm-wiki/wiki/entities/` |
| 아이디어 | `llm-wiki/wiki/ideas/` |
| 결정과 근거 | `llm-wiki/wiki/decisions/` |
| typed relation | `llm-wiki/wiki/ontology/relations.md` |

첫 실행 또는 첫 ingest에서 필요한 `index.md`, `log.md`, `relations.md`를 생성합니다.

## 온톨로지 관계 편집

`llm-wiki/wiki/ontology/relations.md`가 관계 유형과 객체 관계의 단일 원본입니다.

- `확정`: 새 관계의 기본 상태이며 RAG 답변과 관계 추론에 사용하는 관계
- `검토`: 다른 팀원의 검토가 필요한 관계
- `제외`: 맞지 않는 관계이며 향후 동일 관계도 제외할 관계

권장 실행 방식은 대시보드 실행기를 여는 것입니다. 서버 모드에서는 저장 시 검증 후 `relations.md`를 원자적으로 갱신하고 그래프를 자동 재생성합니다.

루트의 `ontology-editor.html`은 외부 의존성 없는 standalone 사본입니다. 브라우저 보안상 그래프 자동 재생성은 할 수 없으므로, 관계를 실제 프로젝트에 반영할 때는 대시보드 서버 모드를 사용하세요.

## RAG 기반 질문·문서 생성·아이디어 참조 절차

RAG 답변, 문서 생성, 아이디어 검토는 결과 형식은 다르지만 같은 순서로 지식을 확인합니다.

```text
1. 찾기       GRAPH_REPORT.md → wiki/index.md
2. 검증       relations.md → decisions/ · concepts/ · entities/ · ideas/
3. 근거 확인  wiki/sources/ → sources/_generated/ → sources/<업무 폴더>/ 원본
```

한 문장으로 표현하면 다음과 같습니다.

> 먼저 지식지도에서 관련 자료를 찾고, 확정된 관계와 정리된 지식으로 내용을 검증한 다음, 필요한 만큼 원문으로 내려가 답변 근거를 확인합니다.

### 참조 파일과 역할

| 단계 | 참조 파일 | 파일에 있는 내용 | 사용하는 목적 |
| --- | --- | --- | --- |
| 찾기 | `graphify-out/GRAPH_REPORT.md` | 전체 문서 수, 핵심 문서, 문서 연결, 주요 지식 군집 | 질문과 관련된 지식 영역과 후보 문서를 빠르게 찾습니다. 이 파일 자체를 최종 사실 근거로 사용하지 않습니다. |
| 찾기 | `llm-wiki/wiki/index.md` | source, concept, entity, idea, decision 문서의 목차와 링크 | 실제로 읽어야 할 Wiki 문서를 선택합니다. |
| 검증 | `llm-wiki/wiki/ontology/relations.md` | 객체 간 관계의 유형, 방향, 근거, `검토·확정·제외` 상태 | 상태가 `확정`인 관계만 객체 간 연결 근거로 사용합니다. |
| 검증 | `llm-wiki/wiki/decisions/` | 기존 판단, 선택 결과와 근거 | 이미 결정된 내용과 판단 배경을 확인합니다. |
| 검증 | `llm-wiki/wiki/concepts/` | 반복되는 핵심 개념의 정의와 관련 문서 | 질문에 등장하는 용어와 개념을 이해합니다. |
| 검증 | `llm-wiki/wiki/entities/` | 회사, 제품, 인물, 조직 등 객체 정보 | 질문의 대상과 관련 객체를 확인합니다. |
| 검증 | `llm-wiki/wiki/ideas/` | 기존 아이디어, 가정, 검증 질문과 실험 | 아이디어 요청에서 기존 제안과의 중복 및 연결 가능성을 확인합니다. |
| 근거 확인 | `llm-wiki/wiki/sources/` | 원문별 요약, 주요 기준·수치, 출처와 페이지 근거 | 답변과 문서의 주된 사실 근거로 사용합니다. |
| 근거 확인 | `sources/_generated/` | 원본을 변환한 Markdown, 페이지 경계, 텍스트 추출 상태 | Wiki 요약에 없는 세부 문맥과 원문 표현을 확인합니다. |
| 근거 확인 | `sources/<업무 폴더>/` | PDF 등 최종 원본과 표·도면·페이지 | 정확한 조문, 수치, 표, 페이지를 최종 검증합니다. |

### 읽기 원칙

- 모든 파일을 전부 읽지 않고 질문에 필요한 범위까지만 읽습니다.
- `GRAPH_REPORT.md`와 `index.md`는 자료를 찾는 지도이며 최종 사실 근거가 아닙니다.
- 객체 간 관계는 `relations.md`에서 상태가 `확정`인 경우에만 사용합니다.
- `검토` 관계는 관계 검토 요청이 아닌 일반 답변·문서·아이디어의 근거로 사용하지 않습니다.
- 주요 사실은 `wiki/sources/`에서 확인하고, 세부 문맥이 부족하면 변환 Markdown을 확인합니다.
- 정확한 조문·수치·표·페이지가 필요한 경우에만 최종 원본까지 확인합니다.
- 사용한 Wiki 문서와 원문 위치를 가능한 범위에서 결과에 함께 표시합니다.

## 주요 명령

| 명령 | 용도 |
| --- | --- |
| `node scripts/build-wiki-graph.mjs` | Wiki·관계 그래프와 대시보드 생성 |
| `node scripts/serve-ontology-editor.mjs` | 온톨로지 편집 서버 실행 |
| `python3 scripts/ingest-pdf-sources.py <폴더> --source-root sources` | PDF 변환본 생성 |
| `node --test scripts/*.test.mjs` | Node 테스트 |
| `python3 scripts/ingest-pdf-sources.test.py` | PDF 변환기 테스트 |

`graphify-out/`에서 사용자가 직접 여는 파일은 `graph.html` 하나입니다. `cache/`와 `manifest.json`은 증분 처리용 내부 파일이므로 유지합니다.

## GitHub 공개 범위

다음 내용은 `.gitignore`로 제외됩니다.

- `sources/**` 실제 원자료
- `llm-wiki/**` 실제 Wiki와 산출물
- `graphify-out/**` 생성 그래프
- 루트의 생성된 dashboard/editor HTML

각 작업 폴더의 빈 구조를 유지하는 `.gitkeep`과 재사용 가능한 코드·템플릿만 추적합니다. 공개 전에는 `git status`와 비밀정보 검색을 다시 확인하세요.

## 라이선스

[MIT License](LICENSE)
