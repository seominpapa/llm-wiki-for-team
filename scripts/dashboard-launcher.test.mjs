import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { fileURLToPath } from "node:url";

import { createOntologyServer } from "./serve-ontology-editor.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcherPath = path.join(repoRoot, "지식관리-대시보드.command");
const windowsLauncherPath = path.join(repoRoot, "지식관리-대시보드.cmd");

let root;
let server;

afterEach(async () => {
  if (server?.listening) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
  server = undefined;
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

test("macOS launcher builds, starts one local server, waits, and opens the dashboard", async () => {
  const [metadata, script] = await Promise.all([stat(launcherPath), readFile(launcherPath, "utf8")]);

  assert.notEqual(metadata.mode & 0o111, 0, "launcher must be executable");
  assert.match(script, /^#!.*(?:ba|z)sh/m);
  assert.match(script, /cd\s+.*(?:dirname|0)/, "launcher must cd to its own project root");
  assert.match(script, /command\s+-v\s+node/, "launcher must check that Node.js exists");
  assert.match(script, /brew\s+install\s+node/, "launcher should install Node with Homebrew when available");
  assert.match(script, /nodejs\.org\/dist\/index\.json/);
  assert.match(script, /pkgutil\s+--check-signature/, "official pkg signature must be checked");
  assert.match(script, /sudo\s+installer\s+-pkg/, "launcher should fall back to the official macOS package");
  assert.match(script, /node\s+scripts\/build-wiki-graph\.mjs/);
  assert.match(script, /node\s+scripts\/serve-ontology-editor\.mjs/);
  assert.match(script, /(?:ONTOLOGY_EDITOR_PORT\s*=\s*8766|127\.0\.0\.1:8766)/);
  assert.match(script, /api\/health/, "launcher must only reuse a compatible dashboard server");
  assert.match(script, /(?:curl|lsof).+127\.0\.0\.1:8766|lsof.+8766/s, "launcher must detect an existing server");
  assert.match(script, /(?:until|while|for)[\s\S]*curl[\s\S]*127\.0\.0\.1:8766/, "launcher must wait for HTTP readiness");
  assert.match(script, /open\s+["']?http:\/\/127\.0\.0\.1:8766\/dashboard["']?/);
});

test("Windows launcher uses its Google Drive folder, builds, starts one server, and opens the dashboard", async () => {
  const script = await readFile(windowsLauncherPath, "utf8");

  assert.match(script, /cd\s+\/d\s+["']?%~dp0/i, "launcher must cd to its own synced folder");
  assert.match(script, /where\s+node/i, "launcher must check that Node.js exists");
  assert.match(script, /winget\s+install[^\r\n]*OpenJS\.NodeJS\.LTS/i);
  assert.match(script, /nodejs\.org\/dist\/index\.json/i, "launcher should have an official installer fallback");
  assert.match(script, /Get-AuthenticodeSignature/i, "official MSI signature must be checked");
  assert.match(script, /msiexec/i);
  assert.match(script, /node\s+scripts[\\/]build-wiki-graph\.mjs/i);
  assert.match(script, /node\s+scripts[\\/]serve-ontology-editor\.mjs/i);
  assert.match(script, /127\.0\.0\.1:8766/);
  assert.match(script, /api\/health/i, "launcher must only reuse a compatible dashboard server");
  assert.match(script, /(?:curl|Invoke-WebRequest|Test-NetConnection)/i, "launcher must detect and wait for the local server");
  assert.match(script, /start\s+["']{0,2}\s*["']?http:\/\/127\.0\.0\.1:8766\/dashboard/i);
});

test("server exposes the generated dashboard and server-mode editor without replacing existing routes", async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dashboard-routes-"));
  const ontologyDir = path.join(root, "llm-wiki", "wiki", "ontology");
  await mkdir(ontologyDir, { recursive: true });
  await writeFile(
    path.join(ontologyDir, "relations.md"),
    `# 온톨로지 관계

## 관계 유형

| key | label | inverse | scope | description |
| --- | --- | --- | --- | --- |
| related_to | 관련된다 | related_to | 공통 | 일반 관계 |

## 관계

| id | source | relation | target | status | evidence | location | note |
| --- | --- | --- | --- | --- | --- | --- | --- |
`,
    "utf8",
  );
  const dashboardFixture = "<!doctype html><html><body><h1>지식관리 대시보드 fixture</h1></body></html>";
  await writeFile(path.join(root, "지식관리-대시보드.html"), dashboardFixture, "utf8");
  const graphFixture = "<!doctype html><html><body><h1>지식 그래프 fixture</h1></body></html>";
  await mkdir(path.join(root, "graphify-out"), { recursive: true });
  await writeFile(path.join(root, "graphify-out", "graph.html"), graphFixture, "utf8");

  server = createOntologyServer({ root, rebuild: async () => ({ exitCode: 0 }) });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const [dashboard, graph, editorAlias, rootEditor, relations, health] = await Promise.all([
    fetch(`${baseUrl}/dashboard`),
    fetch(`${baseUrl}/graphify-out/graph.html`),
    fetch(`${baseUrl}/ontology-editor.html`),
    fetch(`${baseUrl}/`),
    fetch(`${baseUrl}/api/relations`),
    fetch(`${baseUrl}/api/health`),
  ]);
  const [dashboardHtml, editorHtml, rootHtml] = await Promise.all([
    dashboard.text(),
    editorAlias.text(),
    rootEditor.text(),
  ]);

  assert.equal(dashboard.status, 200);
  assert.match(dashboard.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(dashboardHtml, dashboardFixture);
  assert.equal(graph.status, 200);
  assert.match(graph.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(graph.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.equal(await graph.text(), graphFixture);
  assert.equal(editorAlias.status, 200);
  assert.match(editorAlias.headers.get("content-type") ?? "", /text\/html/);
  assert.equal(editorAlias.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(editorHtml, /<table\b/i);
  assert.match(editorHtml, /\/api\/relations/);
  assert.equal(rootEditor.status, 200);
  assert.equal(rootHtml, editorHtml);
  assert.equal(relations.status, 200);
  assert.deepEqual(await health.json(), { ok: true, app: "knowledge-dashboard", version: 1 });
});
