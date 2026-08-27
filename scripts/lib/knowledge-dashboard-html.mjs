import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export const RAG_FLOW = Object.freeze([
  "GRAPH_REPORT.md",
  "wiki/index.md",
  "ontology/relations.md",
  "decisions/ · concepts/ · entities/",
  "wiki/sources/",
  "sources/_generated/",
  "sources/ 사용자 정의 원본 폴더",
]);

export const SOURCE_CATEGORY_DESCRIPTIONS = Object.freeze({});

export async function discoverSourceCategories(root) {
  let entries;
  try {
    entries = await readdir(path.join(root, "sources"), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("_"))
    .map((entry) => entry.name.normalize("NFC"))
    .sort((a, b) => a.localeCompare(b, "ko"));
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

export async function createKnowledgeDashboardSnapshot({ root, sourceCategories, graph, relations }) {
  const discoveredCategories = sourceCategories ?? await discoverSourceCategories(root);
  const categories = await Promise.all(
    discoveredCategories.map(async (name) => {
      const files = await listFiles(path.join(root, "sources", name));
      const sizes = await Promise.all(files.map(async (filePath) => (await stat(filePath)).size));
      return {
        name,
        file_count: files.length,
        byte_size: sizes.reduce((total, size) => total + size, 0),
      };
    }),
  );
  const wikiSources = (await listFiles(path.join(root, "llm-wiki", "wiki", "sources"))).filter(
    (filePath) => filePath.toLowerCase().endsWith(".md"),
  );
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

export function renderKnowledgeDashboardHtml(snapshot) {
  const categoryCards = snapshot.sources.categories
    .map(
      ({ name, file_count: fileCount, byte_size: byteSize }) => `
        <article class="source-card">
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(snapshot.sources.category_descriptions[name] ?? "원천 자료")}</p>
          <dl><div><dt>파일</dt><dd>${fileCount}개</dd></div><div><dt>용량</dt><dd>${byteSize} B</dd></div></dl>
        </article>`,
    )
    .join("");
  const ragFlow = snapshot.rag_flow
    .map(
      (stage, index) =>
        `<li><span>${String(index + 1).padStart(2, "0")}</span><code>${escapeHtml(stage)}</code></li>`,
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
  dl { display:flex; gap:18px; margin:0; }
  dl div { display:flex; gap:6px; }
  dt { color:var(--muted); } dd { margin:0; font-weight:800; }
  .ontology-counts { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
  .ontology-counts div { padding:18px; border-radius:12px; background:#f7faf7; }
  .ontology-counts strong { display:block; margin-top:5px; font-size:24px; }
  .flow { display:flex; flex-wrap:wrap; gap:8px; padding:0; list-style:none; counter-reset:item; }
  .flow li { display:flex; align-items:center; gap:8px; padding:10px 12px; border:1px solid var(--line); border-radius:999px; background:#f8faf7; }
  .flow li:not(:last-child)::after { content:"→"; margin-left:6px; color:var(--green); }
  .flow span { display:grid; width:24px; height:24px; place-items:center; border-radius:50%; color:#fff; background:var(--green); font-size:11px; }
  code { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
  .editor-head { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:14px; }
  .editor-head p { margin:4px 0 0; color:var(--muted); }
  .sync-notice { margin:0 0 14px; padding:12px 14px; border:1px solid #ecd49b; border-radius:10px; color:#6f4e00; background:#fff8e5; font-weight:700; }
  a { color:var(--green); font-weight:800; }
  iframe { width:100%; height:72vh; min-height:560px; border:1px solid var(--line); border-radius:12px; background:#fff; }
  @media (max-width:800px) { .metrics { grid-template-columns:repeat(2,1fr); } .source-grid { grid-template-columns:1fr; } .flow { display:grid; } .flow li::after { display:none; } }
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
      <article class="metric"><span>원천 파일</span><strong>${snapshot.sources.file_count}개</strong><small>사용자 정의 분류</small></article>
      <article class="metric"><span>ingest Wiki source</span><strong>${snapshot.wiki.source_count}</strong><small>${snapshot.wiki.source_count > 0 ? "ingest 자료 있음" : "ingest 대기"}</small></article>
      <article class="metric"><span>그래프 노드</span><strong>${snapshot.graph.node_count}</strong><small>${snapshot.graph.node_count > 0 ? "그래프 생성됨" : "그래프 대기"}</small></article>
      <article class="metric"><span>그래프 엣지</span><strong>${snapshot.graph.edge_count}</strong><small>방향 관계</small></article>
    </div>
    <section class="panel"><h2>원천 분류</h2><div class="source-grid">${categoryCards}</div></section>
    <section class="panel"><h2>온톨로지 상태</h2><div class="ontology-counts">
      <div><span>검토</span><strong>${counts["검토"]}</strong></div><div><span>확정</span><strong>${counts["확정"]}</strong></div><div><span>제외</span><strong>${counts["제외"]}</strong></div>
    </div></section>
    <section class="panel"><h2>RAG 읽기 흐름</h2><ol class="flow">${ragFlow}</ol></section>
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
