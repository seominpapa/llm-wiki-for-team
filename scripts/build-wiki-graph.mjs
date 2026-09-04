import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  createKnowledgeDashboardSnapshot,
  discoverSourceCategories,
  renderKnowledgeDashboardHtml,
} from "./lib/knowledge-dashboard-html.mjs";
import {
  formatRelationSentence,
  renderOntologyEditorHtml,
} from "./lib/ontology-editor-html.mjs";
import {
  DEFAULT_RELATION_TYPES,
  parseOntologyMarkdown,
  serializeOntology,
  strictRagRelations,
  validateRelations,
  validateSourceCategoryCoverage,
} from "./lib/ontology-relations.mjs";

const root = process.cwd();
const wikiRoot = path.join(root, "llm-wiki");
const outDir = path.join(root, "graphify-out");
const ontologyPath = path.join(wikiRoot, "wiki", "ontology", "relations.md");
const excludedFilePatterns = [
  /^llm-wiki\/AGENTS\.md$/i,
  /^llm-wiki\/wiki\/index\.md$/i,
  /^llm-wiki\/wiki\/log\.md$/i,
  /^llm-wiki\/wiki\/ontology\/relations\.md$/i,
  /^llm-wiki\/raw\/sources-folder-manifest-.+\.md$/i,
];

const slug = (value) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "node";

async function listMarkdownFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return listMarkdownFiles(fullPath);
      return entry.isFile() && entry.name.endsWith(".md") ? [fullPath] : [];
    }),
  );
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

const titleFrom = (text, filePath) => {
  const h1 = text.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return path.basename(filePath, ".md").replace(/-/g, " ");
};

const sectionTitles = (text) =>
  [...text.matchAll(/^##\s+(.+)$/gm)].map((match) => match[1].trim());

const frontmatterValue = (text, key) => {
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatter) return "";
  const match = frontmatter[1].match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return match?.[1]?.trim() ?? "";
};

const frontmatterAliases = (text) => {
  const frontmatter = text.match(/^---\s*\n([\s\S]*?)\n---/)?.[1];
  if (!frontmatter) return [];
  const lines = frontmatter.split(/\r?\n/);
  const start = lines.findIndex((line) => /^aliases\s*:/.test(line));
  if (start < 0) return [];
  const inline = lines[start].replace(/^aliases\s*:\s*/, "").trim();
  const unquote = (value) => value.trim().replace(/^["']|["']$/g, "");
  if (inline.startsWith("[") && inline.endsWith("]")) {
    return inline.slice(1, -1).split(",").map(unquote).filter(Boolean);
  }
  const aliases = [];
  for (const line of lines.slice(start + 1)) {
    const match = line.match(/^\s+-\s+(.+)$/);
    if (!match) break;
    aliases.push(unquote(match[1]));
  }
  return aliases;
};

const wikiLinks = (text) =>
  [...text.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)].map((match) =>
    match[1].trim(),
  );

const navigationalMarkdown = (text) => {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+온톨로지 관계 후보\s*$/.test(line.trim()));
  if (start < 0) return text;
  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return [...lines.slice(0, start), ...lines.slice(next < 0 ? lines.length : next)].join("\n");
};

const sourceRefs = (text) =>
  [...text.matchAll(/`(sources\/[^`]+\.md)`/g)].map((match) => match[1].trim());

function parseShorthandOntology(markdown) {
  const rows = markdown.split(/\r?\n/);
  const headerIndex = rows.findIndex((line) =>
    /^\|\s*출발 객체\s*\|\s*관계\s*\|\s*도착 객체\s*\|\s*상태\s*\|\s*근거\s*\|\s*메모\s*\|?$/.test(line.trim()),
  );
  if (headerIndex < 0) return { relationTypes: [], relations: [] };

  const cells = (line) =>
    line
      .trim()
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replaceAll("\\|", "|"));
  const dataRows = [];
  for (const line of rows.slice(headerIndex + 2)) {
    if (!line.trim().startsWith("|")) break;
    const [source, relation, target, status, evidence = "", note = ""] = cells(line);
    if (source && relation && target && status) {
      dataRows.push({ source, relation, target, status, evidence, note });
    }
  }
  const parsedRelations = dataRows.map((relation, index) => ({
    id: `shorthand-${index + 1}`,
    ...relation,
    evidenceDocument: "",
    location: "",
  }));
  const relationTypes = [...new Set(parsedRelations.map(({ relation }) => relation))].map(
    (key) => ({
      key,
      label: key,
      inverse: key,
      scope: ["공통"],
      description: "6열 단축 관계 표에서 정의된 관계 유형",
    }),
  );
  return { relationTypes, relations: parsedRelations };
}

const categoryFrom = (filePath) => {
  const relative = path.relative(wikiRoot, filePath);
  const parts = relative.split(path.sep);
  if (parts[0] === "wiki" && parts.length > 2) return parts[1];
  if (parts.length > 1) return parts[0];
  return "root";
};

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function addEdge(edges, source, target, type, label = type, metadata = {}) {
  const id = metadata.id ?? `${source}->${target}:${type}`;
  if (!edges.has(id)) edges.set(id, { id, source, target, type, label, ...metadata });
}

const files = await listMarkdownFiles(wikiRoot);
const sourceCategories = await discoverSourceCategories(root);
const includedFiles = [];
const excludedFiles = [];
const pages = [];
const titleToIds = new Map();
const pathToId = new Map();
const unresolvedLinks = [];
const externalSourceRefs = [];
let relationTypes = [];
let relations = [];
let ontologyMarkdown = "";

if (!(await pathExists(ontologyPath))) {
  await mkdir(path.dirname(ontologyPath), { recursive: true });
  await writeFile(
    ontologyPath,
    serializeOntology({ relationTypes: DEFAULT_RELATION_TYPES, relations: [] }),
    { encoding: "utf8", flag: "wx" },
  );
}

if (await pathExists(ontologyPath)) {
  ontologyMarkdown = await readFile(ontologyPath, "utf8");
  ({ relationTypes, relations } = parseOntologyMarkdown(ontologyMarkdown));
  if (relationTypes.length === 0 && relations.length === 0) {
    ({ relationTypes, relations } = parseShorthandOntology(ontologyMarkdown));
  }
  validateSourceCategoryCoverage(relationTypes, sourceCategories);
  validateRelations(relations, relationTypes);
}

for (const filePath of files) {
  const text = await readFile(filePath, "utf8");
  const relativePath = path.relative(root, filePath).replaceAll(path.sep, "/");
  if (excludedFilePatterns.some((pattern) => pattern.test(relativePath))) {
    excludedFiles.push(relativePath);
    continue;
  }

  includedFiles.push(filePath);
  const title = titleFrom(text, filePath);
  const id = `file:${slug(relativePath)}`;
  const page = {
    id,
    label: title,
    title,
    file_type: "document",
    type: "file",
    category: categoryFrom(filePath),
    source_file: relativePath,
    path: relativePath,
    exists: true,
    sections: sectionTitles(text),
    source_category: frontmatterValue(text, "source_category"),
    aliases: frontmatterAliases(text),
    wiki_links: wikiLinks(navigationalMarkdown(text)),
    source_refs: sourceRefs(text),
    markdown: text,
  };

  pages.push(page);
  pathToId.set(relativePath.toLowerCase(), id);

  for (const name of [title, ...page.aliases]) {
    const normalizedTitle = name.normalize("NFC").toLocaleLowerCase("ko-KR");
    if (!titleToIds.has(normalizedTitle)) titleToIds.set(normalizedTitle, []);
    titleToIds.get(normalizedTitle).push(id);
  }
}

function relationEndpointIds(value) {
  const reference = wikiLinks(value)[0] ?? value.trim();
  const titleMatches = titleToIds.get(reference.normalize("NFC").toLocaleLowerCase("ko-KR")) ?? [];
  if (titleMatches.length > 0) return [...new Set(titleMatches)];

  const withoutExtension = reference.replace(/\.md$/i, "");
  const candidates = [
    reference,
    `llm-wiki/wiki/${reference}`,
    `llm-wiki/wiki/${withoutExtension}.md`,
  ];
  return [...new Set(candidates.map((candidate) => pathToId.get(candidate.toLowerCase())).filter(Boolean))];
}

const pageById = new Map(pages.map((page) => [page.id, page]));
const canonicalEndpointName = (value) => {
  const ids = relationEndpointIds(value);
  if (ids.length === 1) return pageById.get(ids[0])?.title ?? value;
  return wikiLinks(value)[0] ?? value.trim();
};
const endpointKey = (value) => canonicalEndpointName(value).normalize("NFC").toLocaleLowerCase("ko-KR");
const relationPairs = new Set(
  relations.map(({ source, target }) => `${endpointKey(source)}\u0000${endpointKey(target)}`),
);
const selfWikiLinks = pages.flatMap((page) =>
  page.wiki_links
    .filter((link) => endpointKey(page.title) === endpointKey(link))
    .map((link) => ({ from: page.path, link })),
);
const wikiLinksWithoutRelation = pages.flatMap((page) =>
  page.wiki_links
    .filter((link) => endpointKey(page.title) !== endpointKey(link))
    .filter((link) => !relationPairs.has(`${endpointKey(page.title)}\u0000${endpointKey(link)}`))
    .map((link) => ({ from: page.path, link })),
);
const aliasConflicts = [...titleToIds.entries()]
  .filter(([, ids]) => new Set(ids).size > 1)
  .map(([alias, ids]) => ({ alias, matches: [...new Set(ids)] }));

const edges = new Map();
const unresolvedTypedRelations = [];
const excludedTypedRelations = relations.filter(({ status }) => status === "제외");

for (const page of pages) {
  for (const link of page.wiki_links) {
    const targets = titleToIds.get(link.normalize("NFC").toLocaleLowerCase("ko-KR")) ?? [];
    if (targets.length === 0) {
      unresolvedLinks.push({
        from: page.path,
        link,
        reason: "No llm-wiki Markdown file has this H1 title.",
      });
      continue;
    }

  }

  for (const sourceRef of page.source_refs) {
    const workspacePath = path.join(root, sourceRef);
    externalSourceRefs.push({
      from: page.path,
      source: sourceRef,
      exists: await pathExists(workspacePath),
      included_as_node: false,
    });
  }
}

const relationTypeByKey = new Map(relationTypes.map((type) => [type.key, type]));
for (const relation of relations) {
  if (relation.status === "제외") continue;

  const sources = relationEndpointIds(relation.source);
  const targets = relationEndpointIds(relation.target);
  if (sources.length !== 1 || targets.length !== 1) {
    unresolvedTypedRelations.push({
      ...relation,
      reason:
        sources.length === 0 || targets.length === 0
          ? "Typed relation endpoint does not match an llm-wiki content document."
          : "Typed relation endpoint is ambiguous because multiple documents share its title.",
      source_matches: sources,
      target_matches: targets,
    });
    continue;
  }

  addEdge(
    edges,
    sources[0],
    targets[0],
    relation.relation,
    relationTypeByKey.get(relation.relation)?.label ?? relation.relation,
    {
      id: `ontology:${relation.id}`,
      relation_id: relation.id,
      status: relation.status,
      evidence_document: relation.evidenceDocument,
      evidence: relation.evidence,
      location: relation.location,
      note: relation.note,
      ontology_source: "llm-wiki/wiki/ontology/relations.md",
    },
  );
}

const graphEdges = [...edges.values()];

const graph = {
  directed: true,
  multigraph: false,
  graph: {
    generated_at: new Date().toISOString(),
    source_root: "llm-wiki",
    grounding: "Nodes are restricted to existing content Markdown files under llm-wiki; operational/meta files are excluded.",
  },
  nodes: pages.map((page) => {
    const { wiki_links: wikiLinksForPage, source_refs: sourceRefsForPage, ...node } = page;
    return {
      ...node,
      section_count: page.sections.length,
      wiki_link_count: wikiLinksForPage.length,
      source_ref_count: sourceRefsForPage.length,
      markdown_preview: page.markdown.slice(0, 4000),
    };
  }),
  edges: graphEdges,
  links: graphEdges.map(({ id, ...edge }) => edge),
  ontology: {
    source: "llm-wiki/wiki/ontology/relations.md",
    relation_types: relationTypes,
    relations,
  },
  rag_relations: strictRagRelations(relations),
  validation: {
    node_count: pages.length,
    edge_count: edges.size,
    unresolved_wiki_links: unresolvedLinks,
    self_wiki_links: selfWikiLinks,
    wiki_links_without_relation: wikiLinksWithoutRelation,
    alias_conflicts: aliasConflicts,
    unresolved_typed_relations: unresolvedTypedRelations,
    excluded_typed_relations: excludedTypedRelations,
    external_source_refs: externalSourceRefs,
    non_file_nodes: 0,
    excluded_meta_files: excludedFiles,
  },
};

function renderWikiIndex() {
  const statusCounts = { "검토": 0, "확정": 0, "제외": 0 };
  relations.forEach(({ status }) => { statusCounts[status] = (statusCounts[status] ?? 0) + 1; });
  const groups = new Map();
  pages.forEach((page) => {
    const group = page.category === "sources" ? (page.source_category || "분류 없는 source") : page.category;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ title: page.title, aliases: page.aliases });
  });
  const sections = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "ko"))
    .map(([group, titles]) => `## ${group}\n\n${titles.sort((a, b) => a.title.localeCompare(b.title, "ko")).map(({ title, aliases }) => `- [[${title}]]${aliases.length ? ` (\uBCC4칭: ${aliases.join(", ")})` : ""}`).join("\n")}`)
    .join("\n\n");
  return `# LLM Wiki 색인

## 현재 상태

- Wiki 콘텐츠 문서: ${pages.length}개
- source 분류: ${sourceCategories.join(", ") || "없음"}
- typed relation: ${relations.length}개 (검토 ${statusCounts["검토"]}, 확정 ${statusCounts["확정"]}, 제외 ${statusCounts["제외"]})
- RAG 관계 추론에는 [[온톨로지 관계]]의 확정 관계만 사용한다.

${sections}

## 운영 문서

- [[온톨로지 관계]]
- [[작업 로그]]
`;
}

const topLinked = graph.nodes
  .map((node) => ({
    label: node.label,
    path: node.path,
    incoming: graph.edges.filter((edge) => edge.target === node.id).length,
    outgoing: graph.edges.filter((edge) => edge.source === node.id).length,
  }))
  .sort((a, b) => b.incoming + b.outgoing - (a.incoming + a.outgoing))
  .slice(0, 10);

const fileList = graph.nodes
  .map((node) => `- \`${node.path}\` - ${node.label}`)
  .join("\n");

const unresolvedList =
  unresolvedLinks.length === 0
    ? "- None"
    : unresolvedLinks.map((item) => `- \`${item.from}\` links to \`${item.link}\``).join("\n");

const unresolvedTypedList =
  unresolvedTypedRelations.length === 0
    ? "- None"
    : unresolvedTypedRelations
        .map(
          ({ id, source, relation, target, reason }) =>
            `- \`${id}\`: ${source} --${relation}--> ${target} (${reason})`,
        )
        .join("\n");

const typedEdgeCount = graphEdges.filter(({ status }) => status === "확정" || status === "검토").length;
const bodyWikiLinkCount = pages.reduce((sum, page) => sum + page.wiki_links.length, 0);

const report = `# Graph Report - LLM Wiki File Graph

Generated: ${graph.graph.generated_at}
Source root: \`${graph.graph.source_root}\`

## 생성 기준
\`llm-wiki/\` 아래의 실제 콘텐츠 Markdown 파일만 노드로 표시합니다. \`llm-wiki/AGENTS.md\`, \`llm-wiki/wiki/index.md\`, \`llm-wiki/wiki/log.md\`, raw manifest 같은 운영/목차/메타 파일은 제외합니다. 본문 Wiki link는 탐색용으로 보존하고 노드 메타데이터로만 기록합니다. 활성 그래프 엣지는 모두 \`relations.md\`에서 생성합니다.

## 요약
- 포함된 콘텐츠 Markdown 파일: ${graph.nodes.length}
- 제외된 목차/운영/메타 Markdown 파일: ${excludedFiles.length}
- 본문 Wiki link 메타데이터: ${bodyWikiLinkCount}
- 활성 typed relation(검토·확정): ${typedEdgeCount}
- graph.json에 컴파일한 전체 relation: ${relations.length}
- 일반 RAG용 확정 relation: ${strictRagRelations(relations).length}
- 제외된 typed relation: ${excludedTypedRelations.length}
- 파일이 아닌 노드: 0
- 그래프에서 생략된 unresolved wiki link: ${unresolvedLinks.length}
- 관계로 생성하지 않는 자기 탐색 Wiki link: ${selfWikiLinks.length}
- relations.md 대응이 없는 본문 Wiki link: ${wikiLinksWithoutRelation.length}
- alias 충돌: ${aliasConflicts.length}
- 해석되지 않은 typed relation: ${unresolvedTypedRelations.length}
- 메타데이터로 기록한 외부 source ref: ${externalSourceRefs.length}

## 많이 연결된 파일
${topLinked.map((item, index) => `${index + 1}. ${item.label} - 들어오는 링크 ${item.incoming}, 나가는 링크 ${item.outgoing} (\`${item.path}\`)`).join("\n")}

## 해석되지 않은 Wiki Links
${unresolvedList}

## 해석되지 않은 Typed Relations
${unresolvedTypedList}

## 제외된 목차/운영/메타 파일
${excludedFiles.length === 0 ? "- None" : excludedFiles.map((file) => `- \`${file}\``).join("\n")}

## 포함된 파일
${fileList}

## 출력 파일
- \`graphify-out/graph.json\`
- \`graphify-out/graph.html\`
- \`ontology-editor.html\`
- \`지식관리-대시보드.html\`
`;

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>LLM 위키 지식 그래프</title>
<style>
  :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  body { margin: 0; background: #f7f7f4; color: #202124; }
  header { padding: 18px 24px 12px; border-bottom: 1px solid #deded8; background: #fff; }
  h1 { margin: 0 0 6px; font-size: 22px; font-weight: 700; letter-spacing: 0; }
  p { margin: 0; color: #5b5e66; font-size: 13px; }
  main { display: grid; grid-template-columns: minmax(0, 1fr) 320px; height: calc(100vh - 76px); }
  svg { width: 100%; height: 100%; background: #fbfbf8; touch-action: none; cursor: grab; }
  svg.is-panning { cursor: grabbing; }
  aside { border-left: 1px solid #deded8; padding: 16px; background: #fff; overflow: auto; }
  button { width: 34px; height: 34px; border: 1px solid #d8d8d2; border-radius: 6px; background: #fff; color: #202124; font-size: 16px; line-height: 1; cursor: pointer; }
  button:hover { background: #f2f2ee; }
  .graph-wrap { position: relative; min-width: 0; min-height: 0; }
  .controls { position: absolute; left: 14px; top: 14px; display: flex; gap: 6px; padding: 6px; border: 1px solid #dfdfd8; border-radius: 8px; background: rgba(255, 255, 255, .92); box-shadow: 0 8px 24px rgba(32, 33, 36, .08); }
  .stat { display: flex; justify-content: space-between; gap: 16px; padding: 8px 0; border-bottom: 1px solid #ecece8; font-size: 13px; }
  .detail { margin-top: 16px; padding: 12px; border: 1px solid #e1e1dc; border-radius: 8px; background: #fbfbf8; font-size: 12px; line-height: 1.45; }
  .detail strong { display: block; margin-bottom: 6px; font-size: 13px; }
  .detail span { display: block; color: #676b73; overflow-wrap: anywhere; }
  .detail h2 { margin: 12px 0 6px; font-size: 12px; }
  .detail ul { margin: 6px 0 0; padding-left: 18px; }
  .detail li { margin: 3px 0; overflow-wrap: anywhere; }
  .markdown-preview { max-height: 260px; overflow: auto; margin-top: 8px; padding: 10px; border: 1px solid #e4e4df; border-radius: 6px; background: #fff; color: #25272d; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 11px; line-height: 1.45; }
  .list { display: grid; gap: 8px; margin-top: 18px; font-size: 12px; line-height: 1.35; }
  .file { width: 100%; height: auto; padding: 8px; border: 1px solid #e4e4df; border-radius: 6px; background: #fbfbf8; text-align: left; cursor: pointer; }
  .file.is-selected { border-color: #2563eb; background: #eff6ff; }
  .file strong { display: block; font-size: 12px; }
  .file span { color: #676b73; overflow-wrap: anywhere; }
  text { font-size: 11px; paint-order: stroke; stroke: #fbfbf8; stroke-width: 3px; stroke-linejoin: round; }
  line { stroke: #8f949d; stroke-opacity: .75; }
  line.is-muted { stroke-opacity: .16; }
  line.is-active { stroke: #2563eb; stroke-opacity: .95; stroke-width: 2.6; }
  line.edge { cursor: pointer; }
  line.edge.is-selected { stroke: #dc2626; stroke-opacity: .95; stroke-width: 3; }
  line.edge.is-review { stroke-dasharray: 7 5; }
  line.edge.is-review-hidden { display: none; }
  .review-toggle { display: flex; align-items: center; gap: 5px; padding: 0 6px; font-size: 12px; white-space: nowrap; }
  .review-toggle input { width: 16px; height: 16px; }
  marker path { fill: #8f949d; }
  marker.is-active path { fill: #2563eb; }
  marker.is-selected path { fill: #dc2626; }
  circle { fill: #2563eb; stroke: #fff; stroke-width: 1.5; }
  g.node { cursor: pointer; }
  g.node.is-selected circle { fill: #dc2626; stroke: #7f1d1d; stroke-width: 2.5; }
  g.node.is-neighbor circle { fill: #059669; }
  g.node.is-muted { opacity: .32; }
</style>
</head>
<body>
<header>
  <h1>LLM 위키 지식 그래프</h1>
  <p>각 노드는 실제 콘텐츠 Markdown 파일이고, 모든 연결선은 relations.md의 관계입니다.</p>
</header>
<main>
  <div class="graph-wrap">
    <svg id="graph" role="img" aria-label="File-only wiki graph visualization"></svg>
    <div class="controls" aria-label="그래프 조작">
      <button id="zoom-in" type="button" title="확대">+</button>
      <button id="zoom-out" type="button" title="축소">-</button>
      <button id="zoom-reset" type="button" title="보기 초기화">1:1</button>
      <label class="review-toggle"><input id="show-review" type="checkbox"> 검토</label>
    </div>
  </div>
  <aside>
    <div class="stat"><strong>콘텐츠 노드</strong><span>${graph.nodes.length}</span></div>
    <div class="stat"><strong>본문 Wiki link</strong><span>${bodyWikiLinkCount}</span></div>
    <div class="stat"><strong>제외된 메타 파일</strong><span>${excludedFiles.length}</span></div>
    <div class="stat"><strong>미해석 링크</strong><span>${unresolvedLinks.length}</span></div>
    <div class="detail" id="selection-detail">
      <strong>선택된 노드 없음</strong>
      <span>노드를 클릭하면 Markdown 미리보기와 연결 관계를 볼 수 있습니다. 선을 클릭하면 연결 의미를 확인할 수 있습니다.</span>
    </div>
    <div class="list">
      ${graph.nodes.map((node) => `<button class="file" type="button" data-node-id="${escapeHtml(node.id)}"><strong>${escapeHtml(node.label)}</strong><span>${escapeHtml(node.path)}</span></button>`).join("")}
    </div>
  </aside>
</main>
<script type="application/json" id="graph-data">${JSON.stringify(graph).replaceAll("<", "\\u003c")}</script>
<script>
const data = JSON.parse(document.getElementById("graph-data").textContent);
${formatRelationSentence.toString()}
const svg = document.getElementById("graph");
const width = () => svg.clientWidth || 900;
const height = () => svg.clientHeight || 650;
const ns = "http://www.w3.org/2000/svg";
const nodes = data.nodes.map((node, index) => ({ ...node, x: width() / 2 + Math.cos(index * 1.7) * 180, y: height() / 2 + Math.sin(index * 1.7) * 180, vx: 0, vy: 0 }));
const nodeById = new Map(nodes.map((node) => [node.id, node]));
const edges = data.edges.map((edge) => ({ ...edge, sourceNode: nodeById.get(edge.source), targetNode: nodeById.get(edge.target) })).filter((edge) => edge.sourceNode && edge.targetNode);

function el(name, attrs = {}) {
  const node = document.createElementNS(ns, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const defs = el("defs");
defs.innerHTML =
  '<marker id="arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>' +
  '<marker id="arrow-active" class="is-active" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>' +
  '<marker id="arrow-selected" class="is-selected" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker>';
svg.append(defs);

const viewport = el("g");
const edgeLayer = el("g");
const nodeLayer = el("g");
viewport.append(edgeLayer, nodeLayer);
svg.append(viewport);

let transform = { x: 0, y: 0, scale: 1 };
let selectedNodeId = null;
let selectedEdgeId = null;
let panState = null;
let dragNode = null;
let dragPointerId = null;

const detail = document.getElementById("selection-detail");
const listButtons = [...document.querySelectorAll(".file[data-node-id]")];

function applyTransform() {
  viewport.setAttribute("transform", "translate(" + transform.x + " " + transform.y + ") scale(" + transform.scale + ")");
}

function screenToGraph(clientX, clientY) {
  const rect = svg.getBoundingClientRect();
  return {
    x: (clientX - rect.left - transform.x) / transform.scale,
    y: (clientY - rect.top - transform.y) / transform.scale,
  };
}

function zoomAt(clientX, clientY, factor) {
  const before = screenToGraph(clientX, clientY);
  transform.scale = Math.max(0.25, Math.min(4, transform.scale * factor));
  const rect = svg.getBoundingClientRect();
  transform.x = clientX - rect.left - before.x * transform.scale;
  transform.y = clientY - rect.top - before.y * transform.scale;
  applyTransform();
}

function setSelectedNode(nodeId) {
  selectedNodeId = nodeId;
  selectedEdgeId = null;
  const selected = nodeById.get(nodeId);
  const linkedIds = new Set();
  for (const edge of edges) {
    if (edge.source === nodeId) linkedIds.add(edge.target);
    if (edge.target === nodeId) linkedIds.add(edge.source);
  }

  nodeEls.forEach((group, index) => {
    const node = nodes[index];
    group.classList.toggle("is-selected", node.id === nodeId);
    group.classList.toggle("is-neighbor", linkedIds.has(node.id));
    group.classList.toggle("is-muted", Boolean(nodeId) && node.id !== nodeId && !linkedIds.has(node.id));
  });

  edgeEls.forEach((line, index) => {
    const edge = edges[index];
    const active = edge.source === nodeId || edge.target === nodeId;
    line.classList.toggle("is-active", active);
    line.classList.toggle("is-muted", Boolean(nodeId) && !active);
    line.classList.toggle("is-selected", false);
    line.setAttribute("marker-end", active ? "url(#arrow-active)" : "url(#arrow-default)");
  });

  listButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.nodeId === nodeId);
  });

  if (!selected) {
    detail.innerHTML = "<strong>선택된 노드 없음</strong><span>노드를 클릭하면 Markdown 미리보기와 연결 관계를 볼 수 있습니다. 선을 클릭하면 연결 의미를 확인할 수 있습니다.</span>";
    return;
  }

  const incomingEdges = edges.filter((edge) => edge.target === nodeId);
  const outgoingEdges = edges.filter((edge) => edge.source === nodeId);
  const incomingItems = incomingEdges.map((edge) => "<li>" + escapeText(edge.sourceNode.label) + " → " + escapeText(selected.label) + "</li>").join("") || "<li>없음</li>";
  const outgoingItems = outgoingEdges.map((edge) => "<li>" + escapeText(selected.label) + " → " + escapeText(edge.targetNode.label) + " <span>" + escapeText(edge.label) + "</span></li>").join("") || "<li>없음</li>";
  detail.innerHTML =
    "<strong>" + escapeText(selected.label) + "</strong>" +
    "<span>" + escapeText(selected.path) + "</span>" +
    "<span>연결 의미: relations.md에서 관리하는 typed relation입니다.</span>" +
    "<span>들어오는 링크: " + incomingEdges.length + "</span>" +
    "<span>나가는 링크: " + outgoingEdges.length + "</span>" +
    "<span>섹션 수: " + selected.section_count + "</span>" +
    "<h2>나가는 연결</h2><ul>" + outgoingItems + "</ul>" +
    "<h2>들어오는 연결</h2><ul>" + incomingItems + "</ul>" +
    "<h2>Markdown 미리보기</h2><pre class='markdown-preview'>" + escapeText(selected.markdown_preview || "") + "</pre>";
}

function setSelectedEdge(edgeId) {
  selectedNodeId = null;
  selectedEdgeId = edgeId;
  const edge = edges.find((item) => item.id === edgeId);

  nodeEls.forEach((group) => {
    group.classList.remove("is-selected", "is-neighbor", "is-muted");
  });
  listButtons.forEach((button) => button.classList.remove("is-selected"));
  edgeEls.forEach((line, index) => {
    const active = edges[index].id === edgeId;
    line.classList.toggle("is-selected", active);
    line.classList.toggle("is-muted", !active);
    line.classList.toggle("is-active", false);
    line.setAttribute("marker-end", active ? "url(#arrow-selected)" : "url(#arrow-default)");
  });

  if (!edge) return;
  const sentence = formatRelationSentence(
    { source: edge.sourceNode.label, relation: edge.type, target: edge.targetNode.label },
    { label: edge.label || edge.type },
  );
  detail.innerHTML =
    "<strong>연결</strong>" +
    "<span>" + escapeText(sentence) + "</span>" +
    "<span>유형: " + escapeText(edge.label || edge.type) + " (" + escapeText(edge.type) + ")</span>" +
    (edge.status ? "<span>상태: " + escapeText(edge.status) + "</span>" : "") +
    (edge.evidence_document ? "<span>근거 문서: " + escapeText(edge.evidence_document) + "</span>" : "") +
    (edge.evidence ? "<span>근거: " + escapeText(edge.evidence) + "</span>" : "") +
    (edge.location ? "<span>위치: " + escapeText(edge.location) + "</span>" : "") +
    (edge.note ? "<span>메모: " + escapeText(edge.note) + "</span>" : "");
}

const edgeEls = edges.map((edge) => {
  const line = el("line", { "stroke-width": 1.5, "marker-end": "url(#arrow-default)" });
  line.classList.add("edge");
  if (edge.status === "검토") line.classList.add("is-review", "is-review-hidden");
  const title = el("title");
  title.textContent = edge.sourceNode.label + " → " + edge.targetNode.label + "\\n" + edge.label + (edge.status ? " (" + edge.status + ")" : "");
  line.append(title);
  line.addEventListener("click", (event) => {
    event.stopPropagation();
    setSelectedEdge(edge.id);
  });
  edgeLayer.append(line);
  return line;
});

const nodeEls = nodes.map((node) => {
  const group = el("g");
  group.classList.add("node");
  group.dataset.nodeId = node.id;
  const radius = Math.max(7, Math.min(14, 7 + node.section_count));
  node.radius = radius;
  group.append(el("circle", { r: radius }));
  const text = el("text", { x: radius + 5, y: 4 });
  text.textContent = node.label;
  group.append(text);
  const title = el("title");
  title.textContent = node.label + "\\n" + node.path;
  group.append(title);
  group.addEventListener("click", (event) => {
    event.stopPropagation();
    setSelectedNode(node.id);
  });
  group.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    dragNode = node;
    dragPointerId = event.pointerId;
    group.setPointerCapture(event.pointerId);
  });
  group.addEventListener("pointermove", (event) => {
    if (dragNode !== node || dragPointerId !== event.pointerId) return;
    const point = screenToGraph(event.clientX, event.clientY);
    node.x = point.x;
    node.y = point.y;
    node.vx = 0;
    node.vy = 0;
  });
  group.addEventListener("pointerup", (event) => {
    if (dragPointerId === event.pointerId) {
      dragNode = null;
      dragPointerId = null;
    }
  });
  nodeLayer.append(group);
  return group;
});

svg.addEventListener("click", () => setSelectedNode(null));
svg.addEventListener("wheel", (event) => {
  event.preventDefault();
  zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? 1.12 : 0.88);
}, { passive: false });
svg.addEventListener("pointerdown", (event) => {
  panState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y };
  svg.classList.add("is-panning");
  svg.setPointerCapture(event.pointerId);
});
svg.addEventListener("pointermove", (event) => {
  if (!panState || panState.pointerId !== event.pointerId) return;
  transform.x = panState.tx + event.clientX - panState.x;
  transform.y = panState.ty + event.clientY - panState.y;
  applyTransform();
});
svg.addEventListener("pointerup", (event) => {
  if (panState?.pointerId === event.pointerId) {
    panState = null;
    svg.classList.remove("is-panning");
  }
});

document.getElementById("zoom-in").addEventListener("click", () => {
  const rect = svg.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 1.22);
});
document.getElementById("zoom-out").addEventListener("click", () => {
  const rect = svg.getBoundingClientRect();
  zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, 0.82);
});
document.getElementById("zoom-reset").addEventListener("click", () => {
  transform = { x: 0, y: 0, scale: 1 };
  applyTransform();
});
document.getElementById("show-review").addEventListener("change", (event) => {
  edges.forEach((edge, index) => {
    if (edge.status === "검토") edgeEls[index].classList.toggle("is-review-hidden", !event.target.checked);
  });
});

for (const button of listButtons) {
  button.addEventListener("click", () => {
    setSelectedNode(button.dataset.nodeId);
    const node = nodeById.get(button.dataset.nodeId);
    if (!node) return;
    const rect = svg.getBoundingClientRect();
    transform.x = rect.width / 2 - node.x * transform.scale;
    transform.y = rect.height / 2 - node.y * transform.scale;
    applyTransform();
  });
}

applyTransform();

function tick() {
  const w = width(), h = height();
  for (const node of nodes) {
    node.vx += (w / 2 - node.x) * 0.001;
    node.vy += (h / 2 - node.y) * 0.001;
  }
  for (const edge of edges) {
    const dx = edge.targetNode.x - edge.sourceNode.x;
    const dy = edge.targetNode.y - edge.sourceNode.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const force = (distance - 150) * 0.0028;
    const fx = dx / distance * force;
    const fy = dy / distance * force;
    edge.sourceNode.vx += fx; edge.sourceNode.vy += fy;
    edge.targetNode.vx -= fx; edge.targetNode.vy -= fy;
  }
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(10, Math.hypot(dx, dy));
      const force = 70 / (distance * distance);
      const fx = dx / distance * force, fy = dy / distance * force;
      a.vx -= fx; a.vy -= fy; b.vx += fx; b.vy += fy;
    }
  }
  for (const node of nodes) {
    node.vx *= 0.86; node.vy *= 0.86;
    node.x = Math.max(24, Math.min(w - 180, node.x + node.vx));
    node.y = Math.max(24, Math.min(h - 24, node.y + node.vy));
  }
  edges.forEach((edge, index) => {
    const dx = edge.targetNode.x - edge.sourceNode.x;
    const dy = edge.targetNode.y - edge.sourceNode.y;
    const distance = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / distance;
    const uy = dy / distance;
    const sourceOffset = (edge.sourceNode.radius || 9) + 2;
    const targetOffset = (edge.targetNode.radius || 9) + 9;
    edgeEls[index].setAttribute("x1", edge.sourceNode.x + ux * sourceOffset);
    edgeEls[index].setAttribute("y1", edge.sourceNode.y + uy * sourceOffset);
    edgeEls[index].setAttribute("x2", edge.targetNode.x - ux * targetOffset);
    edgeEls[index].setAttribute("y2", edge.targetNode.y - uy * targetOffset);
  });
  nodes.forEach((node, index) => nodeEls[index].setAttribute("transform", "translate(" + node.x + " " + node.y + ")"));
  requestAnimationFrame(tick);
}
tick();
</script>
</body>
</html>
`;

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

await mkdir(outDir, { recursive: true });
await Promise.all(
  ["wiki-graph.json", "wiki-graph.html", "WIKI_GRAPH_REPORT.md"].map((name) =>
    rm(path.join(outDir, name), { force: true }),
  ),
);
await writeFile(path.join(outDir, "graph.json"), `${JSON.stringify(graph, null, 2)}\n`);
await writeFile(path.join(outDir, "graph.html"), html);
await writeFile(path.join(wikiRoot, "wiki", "index.md"), renderWikiIndex());
await writeFile(
  path.join(root, "ontology-editor.html"),
  renderOntologyEditorHtml({
    standalone: true,
    markdown:
      relationTypes.length > 0
        ? serializeOntology({ relationTypes, relations })
        : ontologyMarkdown,
  }),
);
const dashboardSnapshot = await createKnowledgeDashboardSnapshot({
  root,
  sourceCategories,
  graph,
  relations,
});
await writeFile(
  path.join(root, "지식관리-대시보드.html"),
  renderKnowledgeDashboardHtml(dashboardSnapshot, html),
);
await writeFile(path.join(outDir, "GRAPH_REPORT.md"), report);

console.log(`Wrote ${graph.nodes.length} content file nodes and ${graph.edges.length} file-to-file edges (${typedEdgeCount} typed) from ${includedFiles.length} included llm-wiki Markdown files. Excluded ${excludedFiles.length} operational/meta files.`);
