import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const RAG_FLOW = Object.freeze([
  {
    title: "관련 자료 찾기",
    files: "GRAPH_REPORT.md → wiki/index.md",
    description: "전체 지식지도에서 질문과 관련된 문서를 찾습니다.",
  },
  {
    title: "확정된 지식 확인",
    files: "ontology/relations.md → decisions/ · concepts/ · entities/",
    description: "확정 관계와 정리된 결정·개념·객체를 확인합니다.",
  },
  {
    title: "원문 근거 확인",
    files: "wiki/sources/ → sources/_generated/ → sources/업무별 원본",
    description: "요약부터 읽고 필요한 경우에만 원본까지 내려가 페이지·수치·문구를 확인합니다.",
  },
]);

export const SOURCE_CATEGORY_DESCRIPTIONS = Object.freeze({});

async function listSourceCategoryEntries(root) {
  let entries;
  try {
    entries = await readdir(path.join(root, "sources"), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .map((entry) => ({ name: entry.name.normalize("NFC"), directoryName: entry.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function discoverSourceCategories(root) {
  return (await listSourceCategoryEntries(root)).map(({ name }) => name);
}

async function listFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name === ".gitkeep") return [];
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(filePath);
      return entry.isFile() ? [filePath] : [];
    }),
  );
  return files.flat();
}

function frontmatterValue(markdown, key) {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!frontmatter) return null;
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.*?)\\s*$`, "m"));
  if (!match) return null;
  const value = match[1];
  if (value.length >= 2 && value[0] === '"' && value.at(-1) === '"') {
    return value.slice(1, -1).replace(/\\([\\"])/g, "$1");
  }
  if (value.length >= 2 && value[0] === "'" && value.at(-1) === "'") {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeSourceFile(value) {
  return String(value)
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/{2,}/g, "/")
    .normalize("NFC");
}

function isIngested(value) {
  if (!value) return false;
  return !/^(?:false|0|no|null|undefined)$/i.test(String(value).trim());
}

async function readWikiSourceReferences(wikiSources) {
  const references = await Promise.all(
    wikiSources.map(async (filePath) => {
      const markdown = await readFile(filePath, "utf8");
      const sourceFile = frontmatterValue(markdown, "source_file");
      const generatedSource = frontmatterValue(markdown, "generated_source");
      return {
        sourceFile: sourceFile && isIngested(frontmatterValue(markdown, "ingested"))
          ? normalizeSourceFile(sourceFile)
          : null,
        generatedSource: generatedSource ? normalizeSourceFile(generatedSource) : null,
      };
    }),
  );
  return {
    completed: new Set(references.map(({ sourceFile }) => sourceFile).filter(Boolean)),
    generated: new Set(references.map(({ generatedSource }) => generatedSource).filter(Boolean)),
  };
}

export async function createKnowledgeDashboardSnapshot({ root, sourceCategories, graph, relations }) {
  const sourceCategoryEntries = await listSourceCategoryEntries(root);
  const categoryDirectories = new Map(
    sourceCategoryEntries.map(({ name, directoryName }) => [name, directoryName]),
  );
  const discoveredCategories = sourceCategories ?? sourceCategoryEntries.map(({ name }) => name);
  const wikiSources = (await listFiles(path.join(root, "llm-wiki", "wiki", "sources"))).filter(
    (filePath) => filePath.toLowerCase().endsWith(".md"),
  );
  const sourceReferences = await readWikiSourceReferences(wikiSources);
  const categorySnapshots = await Promise.all(
    discoveredCategories.map(async (name) => {
      const normalizedName = name.normalize("NFC");
      const allFiles = await listFiles(
        path.join(root, "sources", categoryDirectories.get(normalizedName) ?? name),
      );
      const files = (
        await Promise.all(allFiles.map(async (filePath) => {
          const sourceFile = normalizeSourceFile(path.relative(root, filePath));
          if (sourceReferences.generated.has(sourceFile)) return null;
          const completed = sourceReferences.completed.has(sourceFile);
          return {
            name: path.basename(filePath).normalize("NFC"),
            source_file: sourceFile,
            byte_size: (await stat(filePath)).size,
            ingest_status: completed ? "완료" : "미완료",
          };
        }))
      ).filter(Boolean).sort((a, b) => a.source_file.localeCompare(b.source_file, "ko"));
      const completedCount = files.filter(({ ingest_status: status }) => status === "완료").length;
      return {
        name: normalizedName,
        file_count: files.length,
        byte_size: files.reduce((total, { byte_size: size }) => total + size, 0),
        completed_count: completedCount,
        pending_count: files.length - completedCount,
        files,
        generated_only: allFiles.length > 0 && files.length === 0,
      };
    }),
  );
  const categories = categorySnapshots
    .filter(({ generated_only: generatedOnly }) => !generatedOnly)
    .map(({ generated_only: _generatedOnly, ...category }) => category);
  const statusCounts = { "검토": 0, "확정": 0, "제외": 0 };
  for (const { status } of relations) {
    if (Object.hasOwn(statusCounts, status)) statusCounts[status] += 1;
  }

  return {
    generated_at: new Date().toISOString(),
    sources: {
      categories,
      category_descriptions: SOURCE_CATEGORY_DESCRIPTIONS,
      file_count: categories.reduce((total, category) => total + category.file_count, 0),
      byte_size: categories.reduce((total, category) => total + category.byte_size, 0),
      completed_count: categories.reduce((total, category) => total + category.completed_count, 0),
      pending_count: categories.reduce((total, category) => total + category.pending_count, 0),
    },
    wiki: { source_count: wikiSources.length },
    graph: { node_count: graph.nodes.length, edge_count: graph.edges.length },
    ontology: { status_counts: statusCounts },
    rag_flow: [...RAG_FLOW],
  };
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const safeJson = (value) =>
  JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

export const formatMegabytes = (byteSize) => `${(byteSize / 1_000_000).toFixed(2)} MB`;

export function renderKnowledgeDashboardHtml(snapshot) {
  const categoryCards = snapshot.sources.categories
    .map(
      ({ name, file_count: fileCount, byte_size: byteSize, completed_count: completedCount, pending_count: pendingCount, files }) => `
        <article class="source-card">
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(snapshot.sources.category_descriptions[name] ?? "원천 자료")}</p>
          <dl>
            <div><dt>파일</dt><dd>${fileCount}개</dd></div>
            <div><dt>용량</dt><dd>${formatMegabytes(byteSize)}</dd></div>
            <div><dt>완료</dt><dd>${completedCount}개</dd></div>
            <div><dt>미완료</dt><dd>${pendingCount}개</dd></div>
          </dl>
          ${files.length > 0 ? `<details><summary>파일별 현황</summary><div class="file-table-wrap"><table>
            <thead><tr><th>파일</th><th>용량</th><th>ingest</th></tr></thead>
            <tbody>${files.map(({ name: fileName, source_file: sourceFile, byte_size: fileSize, ingest_status: status }) => `
              <tr><td><strong>${escapeHtml(fileName)}</strong><small>${escapeHtml(sourceFile)}</small></td><td>${formatMegabytes(fileSize)}</td><td><span class="status ${status === "완료" ? "done" : "pending"}">${status}</span></td></tr>`).join("")}</tbody>
          </table></div></details>` : ""}
        </article>`,
    )
    .join("");
  const ragFlow = snapshot.rag_flow
    .map(
      (stage, index) =>
        `<li><span>${String(index + 1).padStart(2, "0")}</span><div><strong>${escapeHtml(stage.title)}</strong><code>${escapeHtml(stage.files)}</code><p>${escapeHtml(stage.description)}</p></div></li>`,
    )
    .join("");
  const counts = snapshot.ontology.status_counts;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>지식관리 대시보드</title>
<style>
  :root { color-scheme: light; font-family: Inter, Pretendard, ui-sans-serif, system-ui, -apple-system, sans-serif; --ink:#18211c; --muted:#647068; --line:#dfe6df; --paper:#f3f6f1; --card:#fff; --green:#276749; --mint:#dff2e6; --amber:#9a6700; --red:#b42318; }
  * { box-sizing: border-box; }
  body { margin:0; color:var(--ink); background:var(--paper); }
  header { padding:32px clamp(18px,5vw,64px) 22px; color:#fff; background:linear-gradient(120deg,#163f2d,#276749 62%,#3c7b59); }
  header p { margin:8px 0 0; color:#d7eadf; }
  h1 { margin:0; font-size:clamp(26px,4vw,42px); letter-spacing:-.04em; }
  nav { display:flex; gap:8px; padding:14px clamp(18px,5vw,64px) 0; background:var(--card); border-bottom:1px solid var(--line); }
  .tab { padding:12px 16px; border:0; border-bottom:3px solid transparent; color:var(--muted); background:transparent; font:inherit; font-weight:700; cursor:pointer; }
  .tab[aria-selected="true"] { color:var(--green); border-color:var(--green); }
  main { width:min(1280px,calc(100% - 36px)); margin:24px auto 48px; }
  [role="tabpanel"][hidden] { display:none; }
  .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
  .metric,.panel,.source-card { border:1px solid var(--line); border-radius:16px; background:var(--card); box-shadow:0 8px 22px rgba(24,33,28,.04); }
  .metric { padding:18px; }
  .metric span { display:block; color:var(--muted); font-size:13px; }
  .metric strong { display:block; margin-top:7px; font-size:26px; }
  .metric small { color:var(--green); font-weight:700; }
  h2 { margin:0 0 16px; font-size:20px; }
  .panel { margin-top:16px; padding:20px; }
  .source-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
  .source-card { padding:16px; box-shadow:none; }
  .source-card h3 { margin:0; font-size:15px; }
  .source-card p { min-height:38px; margin:7px 0 13px; color:var(--muted); font-size:13px; }
  dl { display:flex; flex-wrap:wrap; gap:10px 18px; margin:0; }
  dl div { display:flex; gap:6px; }
  dt { color:var(--muted); } dd { margin:0; font-weight:800; }
  details { margin-top:14px; border-top:1px solid var(--line); padding-top:12px; }
  summary { color:var(--green); font-weight:800; cursor:pointer; }
  .file-table-wrap { overflow-x:auto; margin-top:10px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th,td { padding:9px 8px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
  th { color:var(--muted); font-weight:700; }
  td small { display:block; max-width:520px; margin-top:3px; color:var(--muted); overflow-wrap:anywhere; }
  .status { display:inline-block; padding:3px 7px; border-radius:999px; font-weight:800; white-space:nowrap; }
  .status.done { color:var(--green); background:var(--mint); }
  .status.pending { color:var(--amber); background:#fff3cd; }
  .ontology-counts { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .ontology-counts div { padding:18px; border-radius:12px; background:#f7faf7; }
  .ontology-counts strong { display:block; margin-top:5px; font-size:24px; }
  .flow-intro { margin:-6px 0 16px; color:var(--muted); }
  .flow { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; padding:0; list-style:none; }
  .flow li { display:flex; align-items:flex-start; gap:10px; padding:16px; border:1px solid var(--line); border-radius:12px; background:#f8faf7; }
  .flow span { display:grid; flex:0 0 28px; width:28px; height:28px; place-items:center; border-radius:50%; color:#fff; background:var(--green); font-size:11px; }
  .flow strong,.flow code { display:block; }
  .flow code { margin:6px 0; color:var(--green); line-height:1.5; white-space:normal; }
  .flow p { margin:0; color:var(--muted); font-size:13px; line-height:1.5; }
  code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
  .editor-head { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:14px; }
  .editor-head p { margin:4px 0 0; color:var(--muted); }
  .sync-notice { margin:0 0 14px; padding:12px 14px; border:1px solid #ecd49b; border-radius:10px; color:#6f4e00; background:#fff8e5; font-weight:700; }
  a { color:var(--green); font-weight:800; }
  iframe { width:100%; height:72vh; min-height:560px; border:1px solid var(--line); border-radius:12px; background:#fff; }
  @media (max-width:800px) { .metrics { grid-template-columns:repeat(2,1fr); } .source-grid,.flow { grid-template-columns:1fr; } }
  @media (max-width:480px) { .metrics { grid-template-columns:1fr; } .ontology-counts { grid-template-columns:1fr; } .editor-head { align-items:flex-start; flex-direction:column; } iframe { min-height:480px; } }
</style>
</head>
<body>
<header><h1>지식관리 대시보드</h1><p>원천 자료부터 Wiki·그래프·확정 관계까지 한 눈에 확인합니다.</p></header>
<nav role="tablist" aria-label="대시보드 탭">
  <button class="tab" type="button" role="tab" id="status-tab" aria-controls="status-panel" aria-selected="true" tabindex="0">지식현황</button>
  <button class="tab" type="button" role="tab" id="ontology-tab" aria-controls="ontology-panel" aria-selected="false" tabindex="-1">온톨로지 편집</button>
</nav>
<main>
  <section id="status-panel" role="tabpanel" aria-labelledby="status-tab">
    <div class="metrics">
      <article class="metric"><span>원천 파일</span><strong>${snapshot.sources.file_count}개</strong><small>${formatMegabytes(snapshot.sources.byte_size)}</small></article>
      <article class="metric"><span>ingest 완료</span><strong>${snapshot.sources.completed_count} / ${snapshot.sources.file_count}</strong><small>미완료 ${snapshot.sources.pending_count}개</small></article>
      <article class="metric"><span>그래프 노드</span><strong>${snapshot.graph.node_count}</strong><small>${snapshot.graph.node_count > 0 ? "그래프 생성됨" : "그래프 대기"}</small></article>
      <article class="metric"><span>그래프 엣지</span><strong>${snapshot.graph.edge_count}</strong><small>방향 관계</small></article>
    </div>
    <section class="panel"><h2>원천 분류</h2><div class="source-grid">${categoryCards}</div></section>
    <section class="panel"><h2>온톨로지 상태</h2><div class="ontology-counts">
      <div><span>검토</span><strong>${counts["검토"]}</strong></div><div><span>확정</span><strong>${counts["확정"]}</strong></div><div><span>제외</span><strong>${counts["제외"]}</strong></div>
    </div></section>
    <section class="panel"><h2>RAG 읽기 흐름</h2><p class="flow-intro">모든 파일을 한꺼번에 읽지 않고, 질문에 필요한 범위까지만 순서대로 읽습니다.</p><ol class="flow">${ragFlow}</ol></section>
  </section>
  <section id="ontology-panel" role="tabpanel" aria-labelledby="ontology-tab" hidden>
    <div class="panel"><div class="editor-head"><div><h2>온톨로지 관계 편집기</h2><p>편집기를 새 화면으로 열거나 아래에서 바로 사용하세요.</p></div><a href="ontology-editor.html">새 화면으로 열기 ↗</a></div><p class="sync-notice">공유 폴더에서 동시에 편집하지 마세요. 저장하기 전에 최신 파일이나 페이지를 다시 연 뒤 변경하세요.</p><iframe src="ontology-editor.html" title="온톨로지 관계 편집기"></iframe></div>
  </section>
</main>
<script type="application/json" id="knowledge-dashboard-data">${safeJson(snapshot)}</script>
<script>
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus = false) {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute("aria-selected", String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute("aria-controls")).hidden = !selected;
    }
    if (focus) tab.focus();
  }
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
        event.key === "ArrowRight" ? (index + 1) % tabs.length :
        event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : -1;
      if (next >= 0) { event.preventDefault(); selectTab(tabs[next], true); }
    });
  }
</script>
</body>
</html>`;
}
