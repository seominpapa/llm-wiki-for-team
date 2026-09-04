import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatRelationSentence,
  renderOntologyEditorHtml,
} from "./lib/ontology-editor-html.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdown = `# 온톨로지 관계

## 관계 유형 카탈로그

| 유형 ID | 표시명 | 역관계 | 적용 분류 | 설명 |
| --- | --- | --- | --- | --- |
| delegates_to | 위임한다 | 위임받는다 | 공통 | 상위 규범이 하위 규범에 사항을 위임함 |

## 관계 목록

| ID | 출발 객체 | 관계 유형 | 도착 객체 | 상태 | 근거 | 위치 | 메모 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rel-001 | [[광산안전법]] | delegates_to | [[광산안전법 시행령]] | 확정 | 광산안전법 | 제5조 | |
`;

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function embeddedData(html) {
  const match = html.match(
    /<script\b[^>]*\bid=["']ontology-data["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  assert.ok(match, "standalone HTML must embed parsed ontology data");
  return JSON.parse(match[1]);
}

test("standalone 렌더링은 현재 Markdown을 내장하고 API 없이 초기화한다", () => {
  const html = renderOntologyEditorHtml({ standalone: true, markdown });
  const data = embeddedData(html);

  assert.deepEqual(data.relationTypes, [
    {
      key: "delegates_to",
      label: "위임한다",
      inverse: "위임받는다",
      scope: ["공통"],
      description: "상위 규범이 하위 규범에 사항을 위임함",
    },
  ]);
  assert.deepEqual(data.relations, [
    {
      id: "rel-001",
      source: "[[광산안전법]]",
      relation: "delegates_to",
      target: "[[광산안전법 시행령]]",
      status: "확정",
      evidenceDocument: "",
      evidence: "광산안전법",
      location: "제5조",
      note: "",
    },
  ]);
  assert.doesNotMatch(html, /\/api\/relations/);
  assert.match(html, /Markdown 불러오기/);
  assert.match(html, /<input\b[^>]*type=["']file["'][^>]*accept=["'][^"']*\.md/i);
  assert.match(html, /(?:\.text\s*\(\)|FileReader)/);
});

test("standalone 내장 JSON은 Markdown의 script 종료 문자열을 안전하게 이스케이프한다", () => {
  const unsafeNote = "</script><img src=x onerror=alert(1)>";
  const unsafeMarkdown = markdown.replace("| 제5조 | |", `| 제5조 | ${unsafeNote} |`);
  const html = renderOntologyEditorHtml({ standalone: true, markdown: unsafeMarkdown });

  assert.equal(embeddedData(html).relations[0].note, unsafeNote);
  assert.doesNotMatch(html, /<\/script><img\b/i);
});

test("standalone 저장은 파일 덮어쓰기와 relations.md 다운로드 fallback을 모두 포함한다", () => {
  const html = renderOntologyEditorHtml({ standalone: true, markdown });

  assert.match(html, /showSaveFilePicker/);
  assert.match(html, /createWritable/);
  assert.match(html, /URL\.createObjectURL/);
  assert.match(html, /download\s*=\s*["']relations\.md["']/);
  assert.match(html, /catch/);
});

test("새 객체 관계는 확정이 기본이고 검토·제외 의미를 안내한다", () => {
  const html = renderOntologyEditorHtml({ standalone: true, markdown });

  assert.match(html, /status:\s*["']확정["']/);
  assert.match(html, /검토[^<]*다른 팀원의 검토가 필요/);
  assert.match(html, /제외[^<]*맞지 않는 관계[^<]*향후 동일 관계도 제외/);
});

test("객체 관계는 한국어 표시명으로 선택하고 근거 문서와 문장 미리보기를 보여준다", () => {
  const html = renderOntologyEditorHtml({ standalone: true, markdown });

  assert.match(html, /relation-type-select/);
  assert.match(html, /type\.label\s*\+\s*["'] \(["']\s*\+\s*type\.key/);
  assert.match(html, /근거 문서/);
  assert.match(html, /relation-preview/);
  assert.doesNotMatch(html, /정방향:|역방향:/);
  assert.match(html, /relation:\s*[^,]*references/);
});

test("관계 문장은 방향 구분 없이 출발 객체 기준으로 자연스럽게 표현한다", () => {
  assert.equal(
    formatRelationSentence(
      {
        source: "[[ES 03300.b 총칙(소음)]]",
        relation: "applies_to",
        target: "[[환경소음 및 소음·진동 규제기준]]",
      },
      { label: "적용된다", inverse: "적용대상으로 둔다" },
    ),
    '"ES 03300.b 총칙(소음)"은 "환경소음 및 소음·진동 규제기준"에 적용된다.',
  );
});

test("standalone HTML은 외부 스크립트, 모듈, 스타일시트에 의존하지 않는다", () => {
  const html = renderOntologyEditorHtml({ standalone: true, markdown });

  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<script\b[^>]*\btype=["']module["']/i);
  assert.doesNotMatch(html, /<link\b[^>]*\brel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i);
});

test("standalone HTML은 sources 01~10 고정 분류 datalist를 내장하지 않는다", () => {
  const html = renderOntologyEditorHtml({ standalone: true, markdown });

  assert.doesNotMatch(html, /03 표준품셈 및 시장단가/);
  assert.doesNotMatch(html, /08 입찰안내서/);
  assert.doesNotMatch(html, /const categories = \[/);
});

test("그래프 빌더는 standalone 편집기를 프로젝트 루트에만 생성한다", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "ontology-standalone-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
  await mkdir(path.join(projectRoot, "llm-wiki", "wiki", "ontology"), { recursive: true });
  await cp(
    path.join(repoRoot, "scripts", "build-wiki-graph.mjs"),
    path.join(projectRoot, "scripts", "build-wiki-graph.mjs"),
  );
  await cp(path.join(repoRoot, "scripts", "lib"), path.join(projectRoot, "scripts", "lib"), {
    recursive: true,
  });
  await writeFile(
    path.join(projectRoot, "llm-wiki", "wiki", "ontology", "relations.md"),
    markdown,
    "utf8",
  );

  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-wiki-graph.mjs")], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  const rootEditor = path.join(projectRoot, "ontology-editor.html");
  assert.equal(await exists(rootEditor), true);
  assert.equal(await exists(path.join(projectRoot, "graphify-out", "ontology-editor.html")), false);
  const data = embeddedData(await readFile(rootEditor, "utf8"));
  assert.equal(data.relations[0].id, "rel-001");
  assert.equal(data.relations[0].status, "확정");
});
