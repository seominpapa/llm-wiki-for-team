import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseOntologyMarkdown } from "./lib/ontology-relations.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("기존 wiki_link를 누락과 중복 없이 relations.md로 이관한다", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wiki-link-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const wiki = path.join(root, "llm-wiki", "wiki");
  const sources = path.join(wiki, "sources");
  const ontology = path.join(wiki, "ontology");
  const out = path.join(root, "graphify-out");
  const scripts = path.join(root, "scripts");
  await Promise.all([
    mkdir(sources, { recursive: true }),
    mkdir(ontology, { recursive: true }),
    mkdir(out, { recursive: true }),
    mkdir(scripts, { recursive: true }),
  ]);
  await cp(path.join(repoRoot, "scripts", "migrate-wiki-links.mjs"), path.join(scripts, "migrate-wiki-links.mjs"));
  await cp(path.join(repoRoot, "scripts", "lib"), path.join(scripts, "lib"), { recursive: true });

  const sourcePath = "llm-wiki/wiki/sources/source.md";
  const targetOnePath = "llm-wiki/wiki/sources/target-one.md";
  const targetTwoPath = "llm-wiki/wiki/sources/target-two.md";
  await writeFile(
    path.join(root, sourcePath),
    "# Source\n\n## 본문\n\n[[Target One]]을 참조하고 [[Target Two|두 번째 표시명]]을 함께 다룬다.\n[[Ghost]]도 명시한다.\n",
  );
  await writeFile(path.join(root, targetOnePath), "# Target One\n");
  await writeFile(path.join(root, targetTwoPath), "# Target Two\n");

  await writeFile(
    path.join(ontology, "relations.md"),
    `# 온톨로지 관계

## 관계 유형 카탈로그

| 유형 ID | 표시명 | 역관계 | 적용 분류 | 설명 |
| --- | --- | --- | --- | --- |
| references | 참조한다 | 참조된다 | 공통 | 명시적 참조 |
| uses | 사용한다 | 사용된다 | 공통 | 사용 관계 |

## 관계 목록

| ID | 출발 객체 | 관계 유형 | 도착 객체 | 상태 | 근거 | 위치 | 메모 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| typed-001 | [[Source]] | uses | [[Target One]] | 확정 | 기존 근거 | 본문 |  |
`,
  );

  const nodes = [
    { id: "source", title: "Source", path: sourcePath },
    { id: "target-one", title: "Target One", path: targetOnePath },
    { id: "target-two", title: "Target Two", path: targetTwoPath },
  ];
  await writeFile(
    path.join(out, "graph.json"),
    JSON.stringify({
      nodes,
      edges: [
        { id: "old-1", source: "source", target: "target-one", type: "wiki_link" },
        { id: "old-2", source: "source", target: "target-two", type: "wiki_link" },
      ],
      validation: {
        unresolved_wiki_links: [{ from: sourcePath, link: "Ghost", reason: "missing document" }],
      },
    }),
  );

  const run = () => JSON.parse(execFileSync(process.execPath, [path.join(scripts, "migrate-wiki-links.mjs")], {
    cwd: root,
    encoding: "utf8",
  }));
  const first = run();
  const parsed = parseOntologyMarkdown(await readFile(path.join(ontology, "relations.md"), "utf8"));

  assert.equal(first.inputWikiLinks, 2);
  assert.equal(first.integratedWithTyped, 1);
  assert.equal(first.addedGeneric, 1);
  assert.equal(first.aliasCanonicalized, 1);
  assert.equal(first.processedTotal, 2);
  assert.equal(first.unresolvedWikiLinkMentions, 1);
  assert.equal(first.unresolvedWikiLinksAdded, 1);
  assert.equal(parsed.relations.length, 3);
  assert.deepEqual(
    parsed.relations.find(({ target }) => target === "[[Target Two]]"),
    {
      id: "wiki-migration-001",
      source: "[[Source]]",
      relation: "references",
      target: "[[Target Two]]",
      status: "확정",
      evidenceDocument: "[[Source]]",
      evidence: "[[Target One]]을 참조하고 [[Target Two|두 번째 표시명]]을 함께 다룬다.",
      location: "본문, line 5",
      note: "기존 wiki_link 마이그레이션",
    },
  );
  assert.match(await readFile(path.join(out, "WIKI_LINK_MIGRATION_REPORT.md"), "utf8"), /old-1[\s\S]*old-2/);
  assert.match(await readFile(path.join(out, "UNRESOLVED_WIKI_LINK_COVERAGE.md"), "utf8"), /Ghost/);

  const second = run();
  assert.equal(second.addedGeneric, 0);
  assert.equal(second.unresolvedWikiLinksAdded, 0);
  assert.equal(parseOntologyMarkdown(await readFile(path.join(ontology, "relations.md"), "utf8")).relations.length, 3);
});
