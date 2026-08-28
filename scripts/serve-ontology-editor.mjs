import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_RELATION_TYPES,
  parseOntologyMarkdown,
  serializeOntology,
  validateRelations,
  validateSourceCategoryCoverage,
} from "./lib/ontology-relations.mjs";
import { discoverSourceCategories } from "./lib/knowledge-dashboard-html.mjs";
import {
  ONTOLOGY_EDITOR_SCRIPT_HASH,
  renderOntologyEditorHtml,
} from "./lib/ontology-editor-html.mjs";

const MAX_REQUEST_BYTES = 1024 * 1024;
const RELATIONS_PATH = path.join("llm-wiki", "wiki", "ontology", "relations.md");
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

const etagFor = (text) => `"${createHash("sha256").update(text).digest("hex")}"`;

function send(response, status, body, headers = {}) {
  const content = typeof body === "string" ? body : JSON.stringify(body);
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    ...headers,
  });
  response.end(content);
}

function isLocalRequest(request) {
  if (!LOOPBACK_ADDRESSES.has(request.socket.remoteAddress ?? "")) return false;
  const host = request.headers.host ?? "";
  if (!/^127\.0\.0\.1(?::\d+)?$/.test(host)) return false;
  const origin = request.headers.origin;
  return !origin || origin === `http://${host}`;
}

function readJson(request) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    request.resume();
    return Promise.reject(Object.assign(new Error("요청이 너무 큽니다."), { status: 413 }));
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        tooLarge = true;
        chunks.length = 0;
      } else if (!tooLarge) {
        chunks.push(chunk);
      }
    });
    request.on("error", reject);
    request.on("end", () => {
      if (tooLarge) {
        reject(Object.assign(new Error("요청이 너무 큽니다."), { status: 413 }));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(Object.assign(new Error("올바른 JSON 요청이 아닙니다."), { status: 400 }));
      }
    });
  });
}

function validationErrors(relationTypes, relations, sourceCategories = []) {
  if (!Array.isArray(relationTypes) || !Array.isArray(relations)) {
    return ["relationTypes와 relations는 배열이어야 합니다."];
  }
  try {
    validateSourceCategoryCoverage(relationTypes, sourceCategories);
    const result = validateRelations(relations, relationTypes);
    if (Array.isArray(result)) return result;
    if (result === false) return ["온톨로지 관계가 유효하지 않습니다."];
    if (result && typeof result === "object" && result.valid === false) {
      return result.errors ?? ["온톨로지 관계가 유효하지 않습니다."];
    }
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function canonicalizeLegacyMarkdown(markdown) {
  return markdown
    .replace(/^## 관계 유형\s*$/m, "## 관계 유형 카탈로그")
    .replace(
      /^\| key \| label \| inverse \| scope \| description \|$/m,
      "| 유형 ID | 표시명 | 역관계 | 적용 분류 | 설명 |",
    )
    .replace(/^## 관계\s*$/m, "## 관계 목록")
    .replace(
      /^\| id \| source \| relation \| target \| status \| evidence \| location \| note \|$/m,
      "| ID | 출발 객체 | 관계 유형 | 도착 객체 | 상태 | 근거 | 위치 | 메모 |",
    );
}

function parseForApi(markdown) {
  const parsed = parseOntologyMarkdown(canonicalizeLegacyMarkdown(markdown));
  validateRelations(parsed.relations, parsed.relationTypes);
  return {
    relationTypes: parsed.relationTypes.map((type) => ({ ...type, scope: type.scope.join(", ") })),
    relations: parsed.relations,
  };
}

function normalizeForStorage(relationTypes, relations) {
  return {
    relationTypes: relationTypes.map((type) => ({
      ...type,
      scope: Array.isArray(type.scope)
        ? [...type.scope]
        : String(type.scope ?? "").split(/\s*[,，]\s*/).filter(Boolean),
    })),
    relations,
  };
}

async function atomicWrite(filePath, content) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.relations-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function ensureRelationsFile(filePath) {
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    await writeFile(
      filePath,
      serializeOntology({ relationTypes: DEFAULT_RELATION_TYPES, relations: [] }),
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function defaultRebuild(root) {
  const script = path.join(root, "scripts", "build-wiki-graph.mjs");
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script], { cwd: root, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(new Error(stderr.trim() || error.message), { cause: error }));
        return;
      }
      resolve({ exitCode: 0, stdout, stderr });
    });
  });
}

export function createOntologyServer({ root, rebuild = () => defaultRebuild(root) }) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("root가 필요합니다.");
  if (typeof rebuild !== "function") throw new TypeError("rebuild는 함수여야 합니다.");
  const resolvedRoot = path.resolve(root);
  const relationsFile = path.join(resolvedRoot, RELATIONS_PATH);
  const dashboardFile = path.join(resolvedRoot, "지식관리-대시보드.html");
  const graphFile = path.join(resolvedRoot, "graphify-out", "graph.html");

  return createServer(async (request, response) => {
    try {
      if (!isLocalRequest(request)) {
        send(response, 403, { error: "127.0.0.1에서만 접근할 수 있습니다." });
        return;
      }

      await ensureRelationsFile(relationsFile);

      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && url.pathname === "/api/health") {
        send(response, 200, { ok: true, app: "knowledge-dashboard", version: 1 });
        return;
      }

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/ontology-editor.html")) {
        const html = renderOntologyEditorHtml();
        send(response, 200, html, {
          "content-security-policy": `default-src 'none'; script-src '${ONTOLOGY_EDITOR_SCRIPT_HASH}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'`,
          "content-type": "text/html; charset=utf-8",
          "x-frame-options": "SAMEORIGIN",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/dashboard") {
        send(response, 200, await readFile(dashboardFile, "utf8"), {
          "content-type": "text/html; charset=utf-8",
        });
        return;
      }

      if (request.method === "GET" && url.pathname === "/graphify-out/graph.html") {
        send(response, 200, await readFile(graphFile, "utf8"), {
          "content-type": "text/html; charset=utf-8",
          "x-frame-options": "SAMEORIGIN",
        });
        return;
      }

      if (url.pathname !== "/api/relations") {
        send(response, 404, { error: "찾을 수 없습니다." });
        return;
      }

      if (request.method === "GET") {
        const markdown = await readFile(relationsFile, "utf8");
        const etag = etagFor(markdown);
        const { relationTypes, relations } = parseForApi(markdown);
        send(response, 200, { etag, relationTypes, relations }, { etag });
        return;
      }

      if (request.method !== "PUT") {
        send(response, 405, { error: "허용되지 않은 메서드입니다." }, { allow: "GET, PUT" });
        return;
      }
      if (request.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
        send(response, 415, { error: "application/json 요청만 허용됩니다." });
        return;
      }

      const currentMarkdown = await readFile(relationsFile, "utf8");
      const currentEtag = etagFor(currentMarkdown);
      if (!request.headers["if-match"]) {
        request.resume();
        send(response, 428, { error: "If-Match 헤더가 필요합니다." }, { etag: currentEtag });
        return;
      }
      if (request.headers["if-match"] !== currentEtag) {
        request.resume();
        send(response, 412, { error: "relations.md가 변경되었습니다." }, { etag: currentEtag });
        return;
      }

      const input = await readJson(request);
      if (!input || typeof input !== "object") {
        send(response, 422, { error: "요청 본문은 객체여야 합니다." });
        return;
      }
      if (!Array.isArray(input.relationTypes) || !Array.isArray(input.relations)) {
        send(response, 422, { error: "relationTypes와 relations는 배열이어야 합니다." });
        return;
      }
      const normalized = normalizeForStorage(input.relationTypes ?? [], input.relations ?? []);
      const sourceCategories = await discoverSourceCategories(resolvedRoot);
      const errors = validationErrors(normalized.relationTypes, normalized.relations, sourceCategories);
      if (errors.length > 0) {
        send(response, 422, { error: "온톨로지 관계가 유효하지 않습니다.", details: errors });
        return;
      }

      const nextMarkdown = serializeOntology(normalized);
      const latestEtag = etagFor(await readFile(relationsFile, "utf8"));
      if (latestEtag !== currentEtag) {
        send(response, 412, { error: "저장 중 relations.md가 변경되었습니다." }, { etag: latestEtag });
        return;
      }

      await atomicWrite(relationsFile, nextMarkdown);
      const etag = etagFor(nextMarkdown);
      try {
        const graphBuild = await rebuild();
        send(response, 200, { saved: true, etag, graphBuild }, { etag });
      } catch (error) {
        try {
          await atomicWrite(relationsFile, currentMarkdown);
          send(
            response,
            500,
            { saved: false, etag: currentEtag, error: `그래프 생성에 실패해 relations.md 변경을 되돌렸습니다: ${error instanceof Error ? error.message : String(error)}` },
            { etag: currentEtag },
          );
        } catch (rollbackError) {
          send(
            response,
            500,
            { saved: true, etag, error: `그래프 생성과 relations.md 원복에 실패했습니다: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}` },
            { etag },
          );
        }
      }
    } catch (error) {
      send(response, error?.status ?? 500, {
        error: error instanceof Error ? error.message : "요청 처리에 실패했습니다.",
      });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = process.cwd();
  const port = Number(process.env.ONTOLOGY_EDITOR_PORT ?? 8766);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("ONTOLOGY_EDITOR_PORT는 1~65535 범위의 정수여야 합니다.");
  }
  createOntologyServer({ root }).listen(port, "127.0.0.1", () => {
    process.stdout.write(`온톨로지 편집기: http://127.0.0.1:${port}\n`);
  });
}
