import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";

import { createOntologyServer } from "./serve-ontology-editor.mjs";

const initialMarkdown = `# 온톨로지 관계

## 관계 유형

| key | label | inverse | scope | description |
| --- | --- | --- | --- | --- |
| delegates_to | 위임한다 | delegated_by | 법률 | 상위 법령이 하위 법령에 사항을 위임한다. |

## 관계

| id | source | relation | target | status | evidence | location | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rel-001 | [[광산안전법]] | delegates_to | [[광산안전법 시행령]] | 확정 | 광산안전법 | 제5조 | |
`;

const relationTypes = [
  {
    key: "delegates_to",
    label: "위임한다",
    inverse: "delegated_by",
    scope: "법률",
    description: "상위 법령이 하위 법령에 사항을 위임한다.",
  },
];

const relations = [
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
];

let root;
let server;
let baseUrl;
let rebuildCalls;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "ontology-editor-"));
  const ontologyDir = path.join(root, "llm-wiki", "wiki", "ontology");
  await mkdir(ontologyDir, { recursive: true });
  await writeFile(path.join(ontologyDir, "relations.md"), initialMarkdown, "utf8");
  rebuildCalls = 0;
  server = createOntologyServer({
    root,
    rebuild: async () => {
      rebuildCalls += 1;
      return { exitCode: 0 };
    },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  if (root) await rm(root, { recursive: true, force: true });
});

test("GET /api/relations returns editable relations, relation types, and an ETag", async () => {
  const response = await fetch(`${baseUrl}/api/relations`);

  assert.equal(response.status, 200);
  const etag = response.headers.get("etag");
  assert.ok(etag);
  assert.deepEqual(await response.json(), { etag, relationTypes, relations });
});

test("GET /api/relations initializes a fresh workspace with common relation types", async () => {
  const relationsPath = path.join(root, "llm-wiki", "wiki", "ontology", "relations.md");
  await rm(relationsPath);

  const response = await fetch(`${baseUrl}/api/relations`);

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.ok(body.relationTypes.length > 0);
  assert.ok(body.relationTypes.every(({ scope }) => scope === "공통"));
  assert.deepEqual(body.relations, []);
  assert.match(await readFile(relationsPath, "utf8"), /## 관계 유형 카탈로그/);
});

test("PUT /api/relations saves relation types and relations, then rebuilds the graph", async () => {
  const current = await fetch(`${baseUrl}/api/relations`);
  const etag = current.headers.get("etag");
  const updatedTypes = [
    ...relationTypes,
    {
      key: "applies_to",
      label: "적용된다",
      inverse: "has_applicable_rule",
      scope: "공통",
      description: "법률, 지침, 단가, 제품, 보고서, 매뉴얼 및 입찰 자료에 적용된다.",
    },
  ];
  const updatedRelations = [
    ...relations,
    {
      id: "rel-002",
      source: "[[발파 표준안전 작업지침]]",
      relation: "applies_to",
      target: "[[시험발파]]",
      status: "검토",
      evidenceDocument: "[[발파 표준안전 작업지침]]",
      evidence: "작업지침 원문",
      location: "3장",
      note: "현장 적용 범위 확인 필요",
    },
  ];

  const response = await fetch(`${baseUrl}/api/relations`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ relationTypes: updatedTypes, relations: updatedRelations }),
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.saved, true);
  assert.ok(body.etag);
  assert.deepEqual(body.graphBuild, { exitCode: 0 });
  assert.equal(rebuildCalls, 1);
  const saved = await readFile(
    path.join(root, "llm-wiki", "wiki", "ontology", "relations.md"),
    "utf8",
  );
  assert.match(saved, /\| applies_to \| 적용된다 \| has_applicable_rule \| 공통 \|/);
  assert.match(saved, /근거 문서 \| 근거 내용 \| 근거 위치/);
  assert.match(
    saved,
    /\| rel-002 \| \[\[발파 표준안전 작업지침\]\] \| applies_to \| \[\[시험발파\]\] \| 검토 \|/,
  );
});

test("PUT /api/relations rejects an unsupported status without saving or rebuilding", async () => {
  const current = await fetch(`${baseUrl}/api/relations`);
  const etag = current.headers.get("etag");
  const invalidRelations = [{ ...relations[0], status: "승인" }];

  const response = await fetch(`${baseUrl}/api/relations`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({ relationTypes, relations: invalidRelations }),
  });

  assert.equal(response.status, 422);
  assert.equal(rebuildCalls, 0);
  assert.equal(
    await readFile(path.join(root, "llm-wiki", "wiki", "ontology", "relations.md"), "utf8"),
    initialMarkdown,
  );
});

test("PUT /api/relations rejects a stale If-Match value", async () => {
  const response = await fetch(`${baseUrl}/api/relations`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": '"stale"' },
    body: JSON.stringify({ relationTypes, relations }),
  });

  assert.equal(response.status, 412);
  assert.equal(rebuildCalls, 0);
});

test("GET / serves an editable table with a save button", async () => {
  const response = await fetch(`${baseUrl}/`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(response.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(html, /<table\b/i);
  assert.match(html, /관계 유형/);
  assert.match(html, /<button\b[^>]*>\s*저장\s*<\/button>/i);
  assert.match(html, /result\.saved === true.*result\.etag/s);
});

test("그래프 재생성 실패 시 relations.md와 생성 파일을 모두 되돌린다", async () => {
  const graphPath = path.join(root, "graphify-out", "graph.json");
  const dashboardPath = path.join(root, "지식관리-대시보드.html");
  await mkdir(path.dirname(graphPath), { recursive: true });
  await writeFile(graphPath, "old graph", "utf8");
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  server = createOntologyServer({
    root,
    rebuild: async () => {
      rebuildCalls += 1;
      await writeFile(graphPath, "partial graph", "utf8");
      await writeFile(dashboardPath, "partial dashboard", "utf8");
      throw new Error("graph failed");
    },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const current = await fetch(`${baseUrl}/api/relations`);
  const etag = current.headers.get("etag");
  const response = await fetch(`${baseUrl}/api/relations`, {
    method: "PUT",
    headers: { "content-type": "application/json", "if-match": etag },
    body: JSON.stringify({
      relationTypes: [
        ...relationTypes,
        {
          key: "applies_to",
          label: "적용된다",
          inverse: "적용대상으로 둔다",
          scope: "공통",
          description: "모든 원자료 분류에 적용된다.",
        },
      ],
      relations,
    }),
  });

  assert.equal(response.status, 500);
  assert.equal((await response.json()).saved, false);
  assert.equal(rebuildCalls, 1);
  assert.equal(
    await readFile(path.join(root, "llm-wiki", "wiki", "ontology", "relations.md"), "utf8"),
    initialMarkdown,
  );
  assert.equal(await readFile(graphPath, "utf8"), "old graph");
  await assert.rejects(() => readFile(dashboardPath, "utf8"), /ENOENT/);
});
