import { createHash } from "node:crypto";

import {
  parseOntologyMarkdown,
  validateRelations,
  validateSourceCategoryCoverage,
} from "./ontology-relations.mjs";

const editorScript = String.raw`
const typeColumns = ["key", "label", "inverse", "scope", "description"];
const relationColumns = ["id", "source", "relation", "target", "status", "evidenceDocument", "evidence", "location", "note"];
const statuses = ["확정", "검토", "제외"];
const columnLabels = {
  key: "유형 ID", label: "표시명", inverse: "역관계", scope: "적용 분류", description: "설명",
  id: "관계 ID", source: "출발 객체", relation: "관계 유형", target: "도착 객체",
  status: "상태", evidenceDocument: "근거 문서", evidence: "근거 내용", location: "근거 위치", note: "메모",
};
let snapshot = { etag: "", relationTypes: [], relations: [] };

const byId = (id) => document.getElementById(id);
const setMessage = (message, failed = false) => {
  const node = byId("message");
  node.textContent = message;
  node.dataset.failed = String(failed);
};

function textInput(value, label, onChange) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.setAttribute("aria-label", label);
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

function removeButton(onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "delete";
  button.textContent = "삭제";
  button.addEventListener("click", onClick);
  return button;
}

function renderTable(bodyId, rows, columns, updateRow, removeRow) {
  const body = byId(bodyId);
  body.replaceChildren();
  rows.forEach((row, rowIndex) => {
    let currentRow = row;
    const tr = document.createElement("tr");
    let preview;
    const refreshPreview = () => {
      if (!preview) return;
      const type = snapshot.relationTypes.find((item) => item.key === currentRow.relation);
      const clean = (value) => String(value || "").replace(/^\[\[/, "").replace(/\]\]$/, "").split("|", 1)[0];
      preview.textContent = clean(currentRow.source) + "는 " + (type?.label || currentRow.relation || "관계를 선택") + " " + clean(currentRow.target) + ".";
    };
    columns.forEach((column) => {
      const td = document.createElement("td");
      if (column === "status") {
        const select = document.createElement("select");
        select.setAttribute("aria-label", statusLabel(rowIndex));
        statuses.forEach((status) => {
          const option = document.createElement("option");
          option.value = status;
          option.textContent = status;
          option.selected = status === row.status;
          select.append(option);
        });
        select.addEventListener("change", () => {
          currentRow = updateRow(currentRow, "status", select.value);
        });
        td.append(select);
      } else if (column === "relation" && bodyId === "relation-rows") {
        const select = document.createElement("select");
        select.className = "relation-type-select";
        select.setAttribute("aria-label", columnLabel(column, rowIndex));
        snapshot.relationTypes.forEach((type) => {
          const option = document.createElement("option");
          option.value = type.key;
          option.textContent = type.label + " (" + type.key + ")";
          option.selected = type.key === row.relation;
          select.append(option);
        });
        select.addEventListener("change", () => {
          currentRow = updateRow(currentRow, column, select.value);
          refreshPreview();
        });
        preview = document.createElement("small");
        preview.className = "relation-preview";
        td.append(select, preview);
      } else {
        td.append(textInput(row[column], columnLabel(column, rowIndex), (value) => {
          currentRow = updateRow(currentRow, column, value);
          refreshPreview();
        }));
      }
      tr.append(td);
    });
    const action = document.createElement("td");
    action.append(removeButton(() => removeRow(rowIndex, currentRow)));
    tr.append(action);
    body.append(tr);
    refreshPreview();
  });
}

const columnLabel = (column, rowIndex) => (columnLabels[column] ?? column) + " " + (rowIndex + 1) + "행";
const statusLabel = (rowIndex) => columnLabel("status", rowIndex);

function visibleRelations() {
  const query = byId("relation-search").value.trim().toLocaleLowerCase("ko-KR");
  const status = byId("status-filter").value;
  return snapshot.relations.filter((relation) => {
    if (status && relation.status !== status) return false;
    if (!query) return true;
    return [relation.source, relation.target, relation.relation, relation.evidenceDocument, relation.evidence]
      .some((value) => String(value).toLocaleLowerCase("ko-KR").includes(query));
  });
}

function render() {
  const update = (collection) => (row, column, value) => {
    const next = { ...row, [column]: value };
    snapshot = {
      ...snapshot,
      [collection]: snapshot[collection].map((item) => item === row ? next : item),
    };
    return next;
  };
  renderTable("type-rows", snapshot.relationTypes, typeColumns, update("relationTypes"), (index) => {
    snapshot = { ...snapshot, relationTypes: snapshot.relationTypes.filter((_, itemIndex) => itemIndex !== index) };
    render();
  });
  renderTable("relation-rows", visibleRelations(), relationColumns, update("relations"), (_, row) => {
    snapshot = { ...snapshot, relations: snapshot.relations.filter((item) => item !== row) };
    render();
  });
}

async function load() {
  const response = await fetch("/api/relations", { cache: "no-store" });
  if (!response.ok) throw new Error("관계를 불러오지 못했습니다.");
  snapshot = await response.json();
  render();
  setMessage("relations.md를 불러왔습니다.");
}

byId("add-type").addEventListener("click", () => {
  snapshot = {
    ...snapshot,
    relationTypes: [...snapshot.relationTypes, { key: "", label: "", inverse: "", scope: "공통", description: "" }],
  };
  render();
});

byId("add-relation").addEventListener("click", () => {
  snapshot = {
    ...snapshot,
    relations: [...snapshot.relations, {
      id: crypto.randomUUID(), source: "", relation: snapshot.relationTypes.some(({ key }) => key === "references") ? "references" : (snapshot.relationTypes[0]?.key || ""), target: "", status: "확정",
      evidenceDocument: "", evidence: "", location: "", note: "",
    }],
  };
  render();
});

byId("relation-search").addEventListener("input", render);
byId("status-filter").addEventListener("change", render);

byId("save").addEventListener("click", async () => {
  const button = byId("save");
  button.disabled = true;
  setMessage("저장 중입니다.");
  try {
    const response = await fetch("/api/relations", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": snapshot.etag },
      body: JSON.stringify({ relationTypes: snapshot.relationTypes, relations: snapshot.relations }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 412) throw new Error("파일이 외부에서 변경되었습니다. 새로고침 후 다시 수정하세요.");
    if (!response.ok && result.saved === true && result.etag) {
      snapshot = { ...snapshot, etag: result.etag };
    }
    if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
    snapshot = { ...snapshot, etag: result.etag };
    setMessage("저장하고 지식 그래프를 갱신했습니다.");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
  }
});

load().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));
`;

export const ONTOLOGY_EDITOR_SCRIPT_HASH = `sha256-${createHash("sha256").update(editorScript).digest("base64")}`;

const serverLoad = String.raw`async function load() {
  const response = await fetch("/api/relations", { cache: "no-store" });
  if (!response.ok) throw new Error("관계를 불러오지 못했습니다.");
  snapshot = await response.json();
  render();
  setMessage("relations.md를 불러왔습니다.");
}`;

const serverSave = String.raw`byId("save").addEventListener("click", async () => {
  const button = byId("save");
  button.disabled = true;
  setMessage("저장 중입니다.");
  try {
    const response = await fetch("/api/relations", {
      method: "PUT",
      headers: { "content-type": "application/json", "if-match": snapshot.etag },
      body: JSON.stringify({ relationTypes: snapshot.relationTypes, relations: snapshot.relations }),
    });
    const result = await response.json().catch(() => ({}));
    if (response.status === 412) throw new Error("파일이 외부에서 변경되었습니다. 새로고침 후 다시 수정하세요.");
    if (!response.ok && result.saved === true && result.etag) {
      snapshot = { ...snapshot, etag: result.etag };
    }
    if (!response.ok) throw new Error(result.error || "저장하지 못했습니다.");
    snapshot = { ...snapshot, etag: result.etag };
    setMessage("저장하고 지식 그래프를 갱신했습니다.");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
  }
});`;

const standaloneSupport = String.raw`
function tableRows(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => heading.test(line.trim()));
  if (headingIndex < 0) return [];
  let start = headingIndex + 1;
  while (start < lines.length && !lines[start].trim().startsWith("|")) start += 1;
  const rows = [];
  for (let index = start; index < lines.length && lines[index].trim().startsWith("|"); index += 1) {
    const body = lines[index].trim().replace(/^\||\|$/g, "");
    const cells = [];
    let cell = "";
    for (let offset = 0; offset < body.length; offset += 1) {
      if (body[offset] === "\\" && body[offset + 1] === "|") {
        cell += "|";
        offset += 1;
      } else if (body[offset] === "|") {
        cells.push(cell.trim());
        cell = "";
      } else {
        cell += body[offset];
      }
    }
    cells.push(cell.trim());
    rows.push(cells);
  }
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
}

function parseMarkdown(markdown) {
  const required = (row, key) => {
    const value = String(row[key] || "").trim();
    if (!value) throw new Error("필수 열 '" + key + "'이(가) 비어 있습니다.");
    return value;
  };
  const relationTypes = tableRows(markdown, /^##\s+관계 유형 카탈로그\s*$/).map((row) => ({
    key: required(row, "유형 ID"), label: required(row, "표시명"), inverse: required(row, "역관계"),
    scope: required(row, "적용 분류").split(/\s*[,，]\s*/).filter(Boolean),
    description: required(row, "설명"),
  }));
  const relations = tableRows(markdown, /^##\s+관계 목록\s*$/).map((row) => ({
    id: required(row, "ID"), source: required(row, "출발 객체"), relation: required(row, "관계 유형"),
    target: required(row, "도착 객체"), status: required(row, "상태"), evidenceDocument: String(row["근거 문서"] || "").trim(),
    evidence: String(row["근거 내용"] || row["근거"] || "").trim(),
    location: String(row["근거 위치"] || row["위치"] || "").trim(), note: String(row["메모"] || "").trim(),
  }));
  return validate({ relationTypes, relations });
}

function validate(value) {
  if (!value || !Array.isArray(value.relationTypes) || !Array.isArray(value.relations)) {
    throw new Error("관계 유형과 관계 목록이 필요합니다.");
  }
  const relationTypes = value.relationTypes.map((type) => ({
    key: String(type.key || "").trim(), label: String(type.label || "").trim(), inverse: String(type.inverse || "").trim(),
    scope: (Array.isArray(type.scope) ? type.scope : String(type.scope || "").split(/\s*[,，]\s*/)).map(String).map((item) => item.trim()).filter(Boolean),
    description: String(type.description || "").trim(),
  }));
  if (relationTypes.length === 0) throw new Error("관계 유형 카탈로그가 필요합니다.");
  const keys = new Set();
  relationTypes.forEach((type) => {
    if (!type.key || !type.label || !type.inverse || !type.description || type.scope.length === 0) throw new Error("관계 유형의 필수값을 확인하세요.");
    if (keys.has(type.key)) throw new Error("중복 관계 유형 ID: " + type.key);
    keys.add(type.key);
  });
  const ids = new Set();
  const triples = new Set();
  const relations = value.relations.map((relation) => ({
    id: String(relation.id || "").trim(), source: String(relation.source || "").trim(), relation: String(relation.relation || "").trim(),
    target: String(relation.target || "").trim(), status: String(relation.status || "").trim(), evidenceDocument: String(relation.evidenceDocument || ""), evidence: String(relation.evidence || ""),
    location: String(relation.location || ""), note: String(relation.note || ""),
  }));
  relations.forEach((relation) => {
    if (!relation.id || !relation.source || !relation.relation || !relation.target || !relation.status) throw new Error("관계의 필수값을 확인하세요.");
    if (!statuses.includes(relation.status)) throw new Error("허용되지 않은 상태: " + relation.status);
    if (!keys.has(relation.relation)) throw new Error("미등록 관계 유형: " + relation.relation);
    if (ids.has(relation.id)) throw new Error("중복 ID: " + relation.id);
    ids.add(relation.id);
    const triple = [relation.source.toLocaleLowerCase("ko-KR"), relation.relation, relation.target.toLocaleLowerCase("ko-KR")].join("\u0000");
    if (triples.has(triple)) throw new Error("중복 관계 triple: " + relation.id);
    triples.add(triple);
  });
  return { relationTypes, relations };
}

const escapeCell = (value) => String(value).replace(/\r?\n/g, "<br>").replaceAll("|", "\\|");
const markdownRow = (values) => "| " + values.map(escapeCell).join(" | ") + " |";

function serialize(value) {
  const normalized = validate(value);
  const typeRows = normalized.relationTypes.map((type) => markdownRow([type.key, type.label, type.inverse, type.scope.join(", "), type.description]));
  const relationRows = normalized.relations.map((relation) => markdownRow([relation.id, relation.source, relation.relation, relation.target, relation.status, relation.evidenceDocument, relation.evidence, relation.location, relation.note]));
  return ["# 온톨로지 관계", "", "이 문서는 모든 typed relation의 단일 원본이다. 새 관계의 기본 상태는 \`확정\`이다. \`검토\`는 다른 팀원의 검토가 필요한 관계이고, \`제외\`는 맞지 않는 관계이며 향후 동일 관계도 제외한다는 의미다. RAG 답변과 관계 추론에는 \`확정\` 관계만 사용한다.", "", "## 관계 유형 카탈로그", "", "| 유형 ID | 표시명 | 역관계 | 적용 분류 | 설명 |", "| --- | --- | --- | --- | --- |", ...typeRows, "", "## 관계 목록", "", "| ID | 출발 객체 | 관계 유형 | 도착 객체 | 상태 | 근거 문서 | 근거 내용 | 근거 위치 | 메모 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |", ...relationRows, ""].join("\n");
}

function download(markdown) {
  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "relations.md";
  link.click();
  URL.revokeObjectURL(url);
}
`;

const standaloneSave = String.raw`byId("save").addEventListener("click", async () => {
  const button = byId("save");
  button.disabled = true;
  try {
    const markdown = serialize(snapshot);
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({ suggestedName: "relations.md", types: [{ description: "Markdown", accept: { "text/markdown": [".md"] } }] });
        const writable = await handle.createWritable();
        await writable.write(markdown);
        await writable.close();
        setMessage("relations.md를 저장했습니다.");
      } catch (error) {
        if (error && error.name === "AbortError") {
          setMessage("저장을 취소했습니다.");
        } else {
          download(markdown);
          setMessage("파일 다운로드로 저장했습니다.");
        }
      }
    } else {
      download(markdown);
      setMessage("파일 다운로드로 저장했습니다.");
    }
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), true);
  } finally {
    button.disabled = false;
  }
});`;

const replaceRequired = (source, search, replacement) => {
  if (!source.includes(search)) throw new Error("온톨로지 편집기 스크립트 템플릿이 일치하지 않습니다.");
  return source.replace(search, replacement);
};

const standaloneEditorScript = replaceRequired(
  replaceRequired(
    replaceRequired(editorScript, serverLoad, standaloneSupport),
    serverSave,
    standaloneSave,
  ),
  'load().catch((error) => setMessage(error instanceof Error ? error.message : String(error), true));',
  String.raw`snapshot = JSON.parse(byId("ontology-data").textContent);
render();
setMessage("내장된 relations.md를 불러왔습니다.");
byId("markdown-file").addEventListener("change", async (event) => {
  try {
    const file = event.target.files[0];
    if (!file) return;
    snapshot = parseMarkdown(await file.text());
    render();
    setMessage(file.name + "을(를) 불러왔습니다.");
  } catch (error) {
    setMessage(error instanceof Error ? error.message : String(error), true);
  } finally {
    event.target.value = "";
  }
});`,
);

export function renderOntologyEditorHtml({ standalone = false, markdown = "" } = {}) {
  const parsed = standalone ? parseOntologyMarkdown(markdown) : null;
  if (parsed && markdown.trim()) {
    validateSourceCategoryCoverage(parsed.relationTypes);
    validateRelations(parsed.relations, parsed.relationTypes);
  }
  const script = standalone ? standaloneEditorScript : editorScript;
  const scriptHash = standalone
    ? `sha256-${createHash("sha256").update(script).digest("base64")}`
    : ONTOLOGY_EDITOR_SCRIPT_HASH;
  const embedded = standalone
    ? `<script type="application/json" id="ontology-data">${JSON.stringify(parsed).replaceAll("<", "\\u003c")}</script>`
    : "";
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src '${scriptHash}'; style-src 'unsafe-inline'; connect-src '${standalone ? "none" : "self"}'; base-uri 'none'; form-action 'none'">
<title>온톨로지 관계 편집기</title>
<style>
  :root { font-family: system-ui, sans-serif; color: #202124; background: #f7f7f4; }
  body { margin: 0; padding: 24px; }
  main { max-width: 1600px; margin: auto; }
  h1 { margin-top: 0; }
  section { margin: 24px 0; padding: 18px; overflow-x: auto; border: 1px solid #ddd; border-radius: 10px; background: white; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 7px; border-bottom: 1px solid #e5e5e5; text-align: left; white-space: nowrap; }
  input, select { box-sizing: border-box; width: 100%; min-width: 120px; padding: 7px; border: 1px solid #bbb; border-radius: 5px; }
  button { padding: 8px 14px; border: 1px solid #777; border-radius: 6px; background: white; cursor: pointer; }
  button:hover { background: #f1f1ed; }
  button:disabled { cursor: wait; opacity: .6; }
  .actions { display: flex; gap: 8px; align-items: center; }
  .filters { display: flex; gap: 8px; margin-bottom: 12px; }
  .filters input { min-width: 280px; }
  .delete { color: #9b1c1c; }
  .notice { padding: 10px 12px; border-left: 4px solid #b26a00; background: #fff6df; }
  .status-guide { margin: 0 0 12px; padding: 10px 12px; border-radius: 8px; background: #f1f6f2; }
  .status-guide span { display: block; margin: 3px 0; }
  .relation-preview { display: block; max-width: 260px; margin-top: 5px; color: #666; white-space: normal; }
  #message { margin-left: 8px; color: #176b38; }
  #message[data-failed="true"] { color: #a31919; }
</style>
</head>
<body>
<main>
  <h1>온톨로지 관계 편집기</h1>
  <p><code>relations.md</code>의 관계 유형과 객체 관계를 편집합니다.${standalone ? "" : " 저장 시 지식 그래프가 자동으로 갱신됩니다."}</p>
  ${standalone ? '<p class="notice">Standalone 모드입니다. 저장 시 브라우저가 지원하면 위치를 선택하고, 지원하지 않으면 <code>relations.md</code>를 다운로드합니다. 그래프는 자동 갱신되지 않습니다.</p>' : ""}
  ${standalone ? '<p><label>Markdown 불러오기 <input id="markdown-file" type="file" accept=".md,text/markdown"></label></p>' : ""}
  <section>
    <h2>관계 유형</h2>
    <table>
      <thead><tr><th>키</th><th>표시명</th><th>역관계</th><th>범위</th><th>설명</th><th>작업</th></tr></thead>
      <tbody id="type-rows"></tbody>
    </table>
    <p><button id="add-type" type="button">관계 유형 추가</button></p>
  </section>
  <section>
    <h2>객체 관계</h2>
    <div class="status-guide">
      <span>확정: 새 관계의 기본 상태이며 RAG 답변과 관계 추론에 사용합니다.</span>
      <span>검토: 다른 팀원의 검토가 필요하다는 의미입니다.</span>
      <span>제외: 맞지 않는 관계이며 향후 동일 관계도 제외하라는 의미입니다.</span>
    </div>
    <div class="filters">
      <input id="relation-search" type="search" aria-label="객체, 관계 유형 또는 근거 검색" placeholder="객체·유형·근거 검색">
      <select id="status-filter" aria-label="관계 상태 필터">
        <option value="">전체 상태</option><option value="확정">확정</option><option value="검토">검토</option><option value="제외">제외</option>
      </select>
    </div>
    <table>
      <thead><tr><th>ID</th><th>출발 객체</th><th>관계</th><th>도착 객체</th><th>상태</th><th>근거 문서</th><th>근거 내용</th><th>근거 위치</th><th>메모</th><th>작업</th></tr></thead>
      <tbody id="relation-rows"></tbody>
    </table>
    <p><button id="add-relation" type="button">관계 추가</button></p>
  </section>
  <div class="actions"><button id="save" type="button">${standalone ? "relations.md 저장" : "저장"}</button><span id="message" role="status" aria-live="polite"></span></div>
</main>
${embedded}
<script>${script}</script>
</body>
</html>`;
}
