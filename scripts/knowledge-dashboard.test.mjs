import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceCategories = [
  "고객 계약서",
  "제품 매뉴얼",
];

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function embeddedDashboardData(html) {
  const match = html.match(
    /<script\b[^>]*\bid=["']knowledge-dashboard-data["'][^>]*>([\s\S]*?)<\/script>/i,
  );
  assert.ok(match, "dashboard must embed its snapshot as knowledge-dashboard-data JSON");
  return JSON.parse(match[1]);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function visibleText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertVisibleMetric(text, label, value, unit = "") {
  const matches = [...text.matchAll(new RegExp(escapeRegExp(label), "gi"))];
  const valuePattern = new RegExp(`(?:^|\\D)${value}\\s*${escapeRegExp(unit)}(?:\\D|$)`, "i");
  assert.ok(
    matches.some(({ index }) => valuePattern.test(text.slice(index, index + 180))),
    `dashboard must show ${label}: ${value}${unit}`,
  );
}

test("graph builder creates a self-contained root knowledge dashboard from workspace data", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "knowledge-dashboard-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
  await mkdir(path.join(projectRoot, "llm-wiki", "wiki", "sources"), { recursive: true });
  await mkdir(path.join(projectRoot, "llm-wiki", "wiki", "ontology"), { recursive: true });
  await cp(
    path.join(repoRoot, "scripts", "build-wiki-graph.mjs"),
    path.join(projectRoot, "scripts", "build-wiki-graph.mjs"),
  );
  await cp(path.join(repoRoot, "scripts", "lib"), path.join(projectRoot, "scripts", "lib"), {
    recursive: true,
  });

  const expectedSources = [];
  for (const [index, category] of sourceCategories.entries()) {
    const directoryName = index === 0 ? category.normalize("NFD") : category;
    const categoryDir = path.join(projectRoot, "sources", directoryName);
    await mkdir(categoryDir, { recursive: true });
    await writeFile(path.join(categoryDir, ".gitkeep"), "", "utf8");
    await writeFile(path.join(categoryDir, `source-${index + 1}.txt`), "x".repeat(index + 1), "utf8");
    expectedSources.push({ name: category, file_count: 1, byte_size: index + 1 });
  }
  await mkdir(path.join(projectRoot, "sources", "_generated"), { recursive: true });
  await writeFile(path.join(projectRoot, "sources", "_generated", "ignored.md"), "generated", "utf8");
  await mkdir(path.join(projectRoot, "sources", sourceCategories[0].normalize("NFD"), "nested"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "sources", sourceCategories[0].normalize("NFD"), "nested", "appendix.bin"),
    "x".repeat(11),
    "utf8",
  );
  expectedSources[0] = { name: sourceCategories[0], file_count: 2, byte_size: 12 };

  for (const title of ["문서 A", "문서 B", "문서 C", "문서 D"]) {
    await writeFile(
      path.join(projectRoot, "llm-wiki", "wiki", "sources", `${title.at(-1).toLowerCase()}.md`),
      `# ${title}\n`,
      "utf8",
    );
  }
  await writeFile(
    path.join(projectRoot, "llm-wiki", "wiki", "ontology", "relations.md"),
    `# 온톨로지 관계

## 관계 유형 카탈로그

| 유형 ID | 표시명 | 역관계 | 적용 분류 | 설명 |
| --- | --- | --- | --- | --- |
| related_to | 관련된다 | 관련된다 | 공통 | 일반 관계 |

## 관계 목록

| ID | 출발 객체 | 관계 유형 | 도착 객체 | 상태 | 근거 | 위치 | 메모 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rel-review | [[문서 A]] | related_to | [[문서 B]] | 검토 | 자동 추출 | 1쪽 | |
| rel-confirmed | [[문서 B]] | related_to | [[문서 C]] | 확정 | 사용자 확인 | 2쪽 | |
| rel-excluded | [[문서 C]] | related_to | [[문서 D]] | 제외 | 오류 관계 | 3쪽 | |
`,
    "utf8",
  );

  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-wiki-graph.mjs")], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  const dashboardPath = path.join(projectRoot, "지식관리-대시보드.html");
  assert.equal(await exists(dashboardPath), true, "builder must create the dashboard at project root");
  const graphReport = await readFile(path.join(projectRoot, "graphify-out", "GRAPH_REPORT.md"), "utf8");
  assert.match(graphReport, /`지식관리-대시보드\.html`/);
  const html = await readFile(dashboardPath, "utf8");
  const data = embeddedDashboardData(html);
  const text = visibleText(html);

  assert.deepEqual(data.sources.categories, expectedSources);
  assert.equal(data.wiki.source_count, 4);
  assert.deepEqual(data.graph, { node_count: 4, edge_count: 2 });
  assert.deepEqual(data.ontology.status_counts, { "검토": 1, "확정": 1, "제외": 1 });

  for (const { name, file_count: fileCount, byte_size: byteSize } of expectedSources) {
    assertVisibleMetric(text, name, fileCount, "개");
    assertVisibleMetric(text, name, byteSize, "B");
  }
  assertVisibleMetric(text, "ingest Wiki source", 4);
  assertVisibleMetric(text, "그래프 노드", 4);
  assertVisibleMetric(text, "그래프 엣지", 2);
  assertVisibleMetric(text, "검토", 1);
  assertVisibleMetric(text, "확정", 1);
  assertVisibleMetric(text, "제외", 1);

  const ragStages = [
    "GRAPH_REPORT.md",
    "wiki/index.md",
    "ontology/relations.md",
    "decisions/ · concepts/ · entities/",
    "wiki/sources/",
    "sources/_generated/",
    "sources/ 사용자 정의 원본 폴더",
  ];
  assert.deepEqual(data.rag_flow, ragStages);
  assert.match(html, /RAG 읽기 흐름/);
  let previousStageIndex = -1;
  for (const stage of ragStages) {
    const stageIndex = html.indexOf(stage);
    assert.ok(stageIndex > previousStageIndex, `RAG stage must be visible in order: ${stage}`);
    previousStageIndex = stageIndex;
  }

  assert.match(html, /<a\b[^>]*href=["']ontology-editor\.html["'][^>]*>/i);
  assert.match(html, /<iframe\b[^>]*src=["']ontology-editor\.html["'][^>]*>/i);
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link\b[^>]*\brel=["']stylesheet["']/i);
  assert.doesNotMatch(html, /<(?:script|link)\b[^>]*(?:src|href)=["']https?:\/\//i);
});
