import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("typed relations are the editable source of active graph edges", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-graph-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  const scriptsDir = path.join(projectRoot, "scripts");
  const wikiDir = path.join(projectRoot, "llm-wiki", "wiki");
  await mkdir(path.join(wikiDir, "ontology"), { recursive: true });
  await mkdir(path.join(wikiDir, "sources"), { recursive: true });
  await mkdir(scriptsDir, { recursive: true });

  await cp(
    path.join(repoRoot, "scripts", "build-wiki-graph.mjs"),
    path.join(scriptsDir, "build-wiki-graph.mjs"),
  );
  const libDir = path.join(repoRoot, "scripts", "lib");
  if (await exists(libDir)) await cp(libDir, path.join(scriptsDir, "lib"), { recursive: true });

  await writeFile(
    path.join(wikiDir, "sources", "law.md"),
    "# 광산안전법\n\n본문의 [[발파 안전지침]] 링크는 탐색용으로 남긴다.\n\n## 온톨로지 관계 후보\n\n| 출발 객체 | 관계 | 도착 객체 |\n| --- | --- | --- |\n| [[광산안전법]] | 참조 | [[표 안의 대상]] |\n",
    "utf8",
  );
  await writeFile(
    path.join(wikiDir, "sources", "guide.md"),
    "---\naliases:\n  - 발파가이드\n---\n# 발파 안전지침\n\n[[광산안전법]]을 참조한다.\n",
    "utf8",
  );
  await writeFile(
    path.join(wikiDir, "ontology", "relations.md"),
    `# 온톨로지 관계

| 출발 객체 | 관계 | 도착 객체 | 상태 | 근거 | 메모 |
| --- | --- | --- | --- | --- | --- |
| [[광산안전법]] | 상위법 | [[발파가이드]] | 확정 | 제5조 | 법적 근거 |
| [[발파 안전지침]] | 참조 | [[광산안전법]] | 검토 | 총칙 | 확인 필요 |
| [[광산안전법]] | 무관계 | [[발파 안전지침]] | 제외 | 사용자 검토 | 오류 관계 |
`,
    "utf8",
  );
  const outDir = path.join(projectRoot, "graphify-out");
  await mkdir(outDir, { recursive: true });
  for (const staleName of ["wiki-graph.json", "wiki-graph.html", "WIKI_GRAPH_REPORT.md"]) {
    await writeFile(path.join(outDir, staleName), "stale", "utf8");
  }

  execFileSync(process.execPath, [path.join(scriptsDir, "build-wiki-graph.mjs")], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  const graph = JSON.parse(
    await readFile(path.join(outDir, "graph.json"), "utf8"),
  );
  assert.equal(await exists(path.join(outDir, "graph.html")), true);
  assert.equal(await exists(path.join(outDir, "GRAPH_REPORT.md")), true);
  assert.equal(await exists(path.join(outDir, "wiki-graph.json")), false);
  assert.equal(await exists(path.join(outDir, "wiki-graph.html")), false);
  assert.equal(await exists(path.join(outDir, "WIKI_GRAPH_REPORT.md")), false);
  assert.doesNotMatch(await readFile(path.join(outDir, "GRAPH_REPORT.md"), "utf8"), /wiki-graph|WIKI_GRAPH_REPORT/);

  assert.equal(graph.nodes.length, 2);
  assert.ok(graph.nodes.every((node) => node.path !== "llm-wiki/wiki/ontology/relations.md"));
  assert.deepEqual(graph.nodes.find(({ title }) => title === "발파 안전지침").aliases, ["발파가이드"]);

  const typedEdges = graph.edges.filter((edge) => edge.status === "확정" || edge.status === "검토");
  assert.deepEqual(
    typedEdges.map(({ type, status, evidence }) => ({ type, status, evidence })),
    [
      { type: "상위법", status: "확정", evidence: "제5조" },
      { type: "참조", status: "검토", evidence: "총칙" },
    ],
  );
  assert.equal(graph.edges.some((edge) => edge.type === "무관계" || edge.status === "제외"), false);
  assert.equal(graph.edges.some((edge) => edge.type === "wiki_link"), false);
  assert.ok(graph.edges.every((edge) => edge.relation_id));
  assert.deepEqual(graph.validation.wiki_links_without_relation, []);
  assert.equal(graph.ontology.relations.length, 3);
  assert.deepEqual(graph.rag_relations.map(({ id }) => id), ["shorthand-1"]);
  assert.equal(graph.nodes.reduce((sum, node) => sum + node.wiki_link_count, 0), 2);
  const report = await readFile(path.join(outDir, "GRAPH_REPORT.md"), "utf8");
  const graphHtml = await readFile(path.join(outDir, "graph.html"), "utf8");
  const index = await readFile(path.join(wikiDir, "index.md"), "utf8");
  assert.match(report, /본문 Wiki link.*메타데이터/);
  assert.match(graphHtml, /id="show-review"/);
  assert.match(graphHtml, /edge\.status === "검토"/);
  assert.doesNotMatch(graphHtml, /정방향:|역방향:/);
  assert.match(index, /\[\[광산안전법\]\]/);
  assert.match(index, /별칭: 발파가이드/);
  assert.match(index, /typed relation: 3개 \(검토 1, 확정 1, 제외 1\)/);
});

test("graph builder initializes an empty workspace and discovers user source folders", async (t) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "wiki-graph-empty-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));

  await mkdir(path.join(projectRoot, "scripts"), { recursive: true });
  await mkdir(path.join(projectRoot, "llm-wiki", "wiki", "sources"), { recursive: true });
  await mkdir(path.join(projectRoot, "sources", "고객 문서"), { recursive: true });
  await cp(
    path.join(repoRoot, "scripts", "build-wiki-graph.mjs"),
    path.join(projectRoot, "scripts", "build-wiki-graph.mjs"),
  );
  await cp(path.join(repoRoot, "scripts", "lib"), path.join(projectRoot, "scripts", "lib"), {
    recursive: true,
  });

  execFileSync(process.execPath, [path.join(projectRoot, "scripts", "build-wiki-graph.mjs")], {
    cwd: projectRoot,
    encoding: "utf8",
  });

  const relations = await readFile(
    path.join(projectRoot, "llm-wiki", "wiki", "ontology", "relations.md"),
    "utf8",
  );
  const dashboard = await readFile(path.join(projectRoot, "지식관리-대시보드.html"), "utf8");
  assert.match(relations, /\| delegates_to \| 위임한다 \| 위임받는다 \| 공통 \|/);
  assert.match(dashboard, /고객 문서/);
  assert.doesNotMatch(dashboard, /01 법률/);
});
