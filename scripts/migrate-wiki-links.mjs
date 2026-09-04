import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseOntologyMarkdown,
  serializeOntology,
  validateRelations,
} from "./lib/ontology-relations.mjs";

const root = process.cwd();
const ontologyPath = path.join(root, "llm-wiki", "wiki", "ontology", "relations.md");
const graphPath = path.join(root, "graphify-out", "graph.json");
const reportPath = path.join(root, "graphify-out", "WIKI_LINK_MIGRATION_REPORT.md");
const evidenceReportPath = path.join(root, "graphify-out", "EVIDENCE_DOCUMENT_REVIEW.md");
const unresolvedCoveragePath = path.join(root, "graphify-out", "UNRESOLVED_WIKI_LINK_COVERAGE.md");
const backupPath = `${ontologyPath}.before-wiki-link-migration`;

const canonical = (value) =>
  String(value)
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|", 1)[0]
    .split("#", 1)[0]
    .trim()
    .normalize("NFC")
    .toLocaleLowerCase("ko-KR");

const wikilinkTarget = (token) => canonical(token.slice(2, -2));
const pairKey = (source, target) => `${canonical(source)}\u0000${canonical(target)}`;
const wiki = (title) => `[[${title}]]`;
const escapeCell = (value) => String(value ?? "").replace(/\r?\n/g, " ").replaceAll("|", "\\|");

async function atomicWrite(filePath, content) {
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, filePath);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function copyOnce(source, target) {
  try {
    await copyFile(source, target, 1);
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function exists(filePath) {
  try {
    await readFile(filePath, "utf8");
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function listMarkdownFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return (
    await Promise.all(
      entries.map((entry) => {
        const filePath = path.join(directory, entry.name);
        return entry.isDirectory()
          ? listMarkdownFiles(filePath)
          : entry.isFile() && entry.name.endsWith(".md")
            ? [filePath]
            : [];
      }),
    )
  ).flat();
}

function contextFor(markdown, target) {
  const lines = markdown.split(/\r?\n/);
  let section = "문서 본문";
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(/^##\s+(.+)$/);
    if (heading) section = heading[1].trim();
    const tokens = [...lines[index].matchAll(/\[\[[^\]]+\]\]/g)].map(({ 0: token }) => token);
    const token = tokens.find((item) => wikilinkTarget(item) === canonical(target));
    if (token) {
      return {
        token,
        evidence: lines[index].trim().replace(/^[-*]\s+/, ""),
        location: `${section}, line ${index + 1}`,
      };
    }
  }
  return { token: "", evidence: "", location: "위치 확인 필요" };
}

function parseTableRow(line) {
  const body = line.trim().replace(/^\||\|$/g, "");
  const cells = [];
  let cell = "";
  for (let index = 0; index < body.length; index += 1) {
    if (body[index] === "\\" && body[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (body[index] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += body[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function candidateRelations(markdown, evidenceDocument) {
  const lines = markdown.split(/\r?\n/);
  const heading = lines.findIndex((line) => /^##\s+온톨로지 관계 후보\s*$/.test(line.trim()));
  if (heading < 0) return [];
  let header = heading + 1;
  while (header < lines.length && !lines[header].trim().startsWith("|")) header += 1;
  if (header >= lines.length) return [];
  const names = parseTableRow(lines[header]);
  const rows = [];
  for (let index = header + 2; index < lines.length && lines[index].trim().startsWith("|"); index += 1) {
    const values = parseTableRow(lines[index]);
    const row = Object.fromEntries(names.map((name, cell) => [name, values[cell] ?? ""]));
    if (!row.ID || !row["출발 객체"] || !row["관계 유형"] || !row["도착 객체"]) continue;
    rows.push({
      id: row.ID,
      source: row["출발 객체"],
      relation: row["관계 유형"],
      target: row["도착 객체"],
      status: "확정",
      evidenceDocument,
      evidence: row["근거"] ?? "",
      location: row["위치"] ?? "",
      note: row["메모"] ?? "",
    });
  }
  return rows;
}

function nextMigrationId(existingIds, counter) {
  let next = counter;
  let id;
  do {
    id = `wiki-migration-${String(next).padStart(3, "0")}`;
    next += 1;
  } while (existingIds.has(id));
  existingIds.add(id);
  return { id, next };
}

const graph = JSON.parse(await readFile(graphPath, "utf8"));
const wikiEdges = graph.edges.filter(({ type }) => type === "wiki_link");
const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const nodesByPath = new Map(graph.nodes.map((node) => [node.path.normalize("NFC"), node]));
const ontologyMarkdown = await readFile(ontologyPath, "utf8");
let { relationTypes, relations } = parseOntologyMarkdown(ontologyMarkdown);

if (!relationTypes.some(({ key }) => key === "references")) {
  throw new Error("relations.md에 references 관계 유형이 필요합니다.");
}
relationTypes = relationTypes.map((type) => ({
  ...type,
  scope: ["references", "related_to"].includes(type.key)
    ? ["공통"]
    : [...new Set(type.scope.map((item) => item.replace(/^\d+\s+/, "").trim()))],
}));
if (!relationTypes.some(({ key }) => key === "describes")) {
  relationTypes = [
    ...relationTypes,
    {
      key: "describes",
      label: "다룬다",
      inverse: "설명된다",
      scope: ["공통"],
      description: "문서가 대상을 주요 주제로 설명한다.",
    },
  ];
}
if (!relationTypes.some(({ key }) => key === "same_as")) {
  relationTypes = [
    ...relationTypes,
    {
      key: "same_as",
      label: "같은 대상이다",
      inverse: "같은 대상이다",
      scope: ["공통"],
      description: "두 명칭이 같은 canonical 대상을 가리킨다.",
    },
  ];
}

const existingIds = new Set(relations.map(({ id }) => id));
const byPair = new Map();
for (const relation of relations) {
  const key = pairKey(relation.source, relation.target);
  if (!byPair.has(key)) byPair.set(key, relation);
}

let candidateTotal = 0;
let candidateIntegrated = 0;
let candidateAdded = 0;
let evidenceDocumentBackfilled = 0;
const candidateConflicts = [];
const sourceTitles = new Map();
for (const filePath of await listMarkdownFiles(path.join(root, "llm-wiki", "wiki", "sources"))) {
  const markdown = await readFile(filePath, "utf8");
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? path.basename(filePath, ".md");
  sourceTitles.set(canonical(title), title);
  for (const candidate of candidateRelations(markdown, wiki(title))) {
    candidateTotal += 1;
    const sameId = relations.find(({ id }) => id === candidate.id);
    const samePair = byPair.get(pairKey(candidate.source, candidate.target));
    if (sameId && pairKey(sameId.source, sameId.target) !== pairKey(candidate.source, candidate.target)) {
      candidateConflicts.push({ id: candidate.id, reason: "같은 ID의 출발·도착 객체가 다름" });
      continue;
    }
    if (sameId || samePair) {
      const existing = sameId ?? samePair;
      if (!existing.evidenceDocument) {
        const updated = { ...existing, evidenceDocument: candidate.evidenceDocument };
        relations = relations.map((relation) => relation === existing ? updated : relation);
        byPair.set(pairKey(updated.source, updated.target), updated);
        evidenceDocumentBackfilled += 1;
      }
      candidateIntegrated += 1;
      continue;
    }
    relations = [...relations, candidate];
    existingIds.add(candidate.id);
    byPair.set(pairKey(candidate.source, candidate.target), candidate);
    candidateAdded += 1;
  }
}

relations = relations.map((relation) => {
  const sourceTitle = sourceTitles.get(canonical(relation.source));
  if (relation.evidenceDocument || !sourceTitle) return relation;
  evidenceDocumentBackfilled += 1;
  return { ...relation, evidenceDocument: wiki(sourceTitle) };
});

let integratedWithTyped = 0;
let addedGeneric = 0;
let aliasCanonicalized = 0;
let unresolved = 0;
let migrationCounter = 1;
const ledger = [];

for (const edge of wikiEdges) {
  const sourceNode = nodes.get(edge.source);
  const targetNode = nodes.get(edge.target);
  if (!sourceNode || !targetNode) {
    unresolved += 1;
    ledger.push({ edge, action: "미해결", relation: null, location: "노드 확인 필요" });
    continue;
  }

  const markdown = await readFile(path.join(root, sourceNode.path), "utf8");
  const context = contextFor(markdown, targetNode.title ?? targetNode.label);
  if (context.token.includes("|")) aliasCanonicalized += 1;
  const key = pairKey(sourceNode.title ?? sourceNode.label, targetNode.title ?? targetNode.label);
  const existing = byPair.get(key);
  if (existing) {
    integratedWithTyped += 1;
    ledger.push({ edge, sourceNode, targetNode, context, action: "기존 typed relation과 통합", relation: existing });
    continue;
  }

  const generated = nextMigrationId(existingIds, migrationCounter);
  migrationCounter = generated.next;
  const relation = {
    id: generated.id,
    source: wiki(sourceNode.title ?? sourceNode.label),
    relation: "references",
    target: wiki(targetNode.title ?? targetNode.label),
    status: "확정",
    evidenceDocument: wiki(sourceNode.title ?? sourceNode.label),
    evidence: context.evidence,
    location: context.location,
    note: "기존 wiki_link 마이그레이션",
  };
  relations = [...relations, relation];
  byPair.set(key, relation);
  addedGeneric += 1;
  ledger.push({ edge, sourceNode, targetNode, context, action: "references로 변환", relation });
}

const unresolvedWikiLinks = graph.validation?.unresolved_wiki_links ?? [];
let unresolvedWikiLinksAdded = 0;
let unresolvedWikiLinksIntegrated = 0;
let unresolvedWikiLinksMissingSource = 0;
const unresolvedLedger = [];
for (const item of unresolvedWikiLinks) {
  const sourceNode = nodesByPath.get(item.from.normalize("NFC"));
  if (!sourceNode) {
    unresolvedWikiLinksMissingSource += 1;
    unresolvedLedger.push({ item, action: "출발 문서 확인 필요", relation: null, context: null });
    continue;
  }
  const markdown = await readFile(path.join(root, sourceNode.path), "utf8");
  const context = contextFor(markdown, item.link);
  const key = pairKey(sourceNode.title ?? sourceNode.label, item.link);
  const existing = byPair.get(key);
  if (existing) {
    unresolvedWikiLinksIntegrated += 1;
    unresolvedLedger.push({ item, sourceNode, context, action: "기존 relation과 통합", relation: existing });
    continue;
  }
  const generated = nextMigrationId(existingIds, migrationCounter);
  migrationCounter = generated.next;
  const relation = {
    id: generated.id,
    source: wiki(sourceNode.title ?? sourceNode.label),
    relation: "references",
    target: wiki(item.link),
    status: "확정",
    evidenceDocument: wiki(sourceNode.title ?? sourceNode.label),
    evidence: context.evidence,
    location: context.location,
    note: "미해석 본문 Wiki link 마이그레이션",
  };
  relations = [...relations, relation];
  byPair.set(key, relation);
  unresolvedWikiLinksAdded += 1;
  unresolvedLedger.push({ item, sourceNode, context, action: "references로 변환", relation });
}

validateRelations(relations, relationTypes);
await copyOnce(ontologyPath, backupPath);
await atomicWrite(ontologyPath, serializeOntology({ relationTypes, relations }));

const processedTotal = integratedWithTyped + addedGeneric + unresolved;
const report = `# Wiki Link 마이그레이션 보고서

## 요약

- 기존 wiki_link 총수: ${wikiEdges.length}개
- 기존 typed relation과 통합: ${integratedWithTyped}개
- 새 구체적 typed relation으로 변환: 0개
- references/describes/related_to로 변환: ${addedGeneric}개
- alias를 canonical 노드로 통합: ${aliasCanonicalized}개
- 검토 상태: 0개
- 제외 상태: 0개
- 처리하지 못한 unresolved 링크: ${unresolved}개
- 처리 결과 합계: ${processedTotal}개

## Source 관계 후보 표 대조

- 후보 행: ${candidateTotal}개
- 기존 relations.md와 통합: ${candidateIntegrated}개
- relations.md에 추가: ${candidateAdded}개
- 충돌: ${candidateConflicts.length}개

## 처리 원장

| 기존 엣지 ID | 출발 문서 | 도착 문서 | 처리 | 관계 ID | 관계 유형 | 근거 위치 |
| --- | --- | --- | --- | --- | --- | --- |
${ledger
  .map(({ edge, sourceNode, targetNode, action, relation, context, location }) =>
    `| ${escapeCell(edge.id)} | ${escapeCell(sourceNode?.title ?? sourceNode?.label ?? edge.source)} | ${escapeCell(targetNode?.title ?? targetNode?.label ?? edge.target)} | ${action} | ${escapeCell(relation?.id ?? "")} | ${escapeCell(relation?.relation ?? "")} | ${escapeCell(context?.location ?? location)} |`,
  )
  .join("\n")}

## 충돌 목록

${candidateConflicts.length ? candidateConflicts.map(({ id, reason }) => `- \`${id}\`: ${reason}`).join("\n") : "- 없음"}
`;
await mkdir(path.dirname(reportPath), { recursive: true });
if (wikiEdges.length > 0 && !(await exists(reportPath))) await atomicWrite(reportPath, report);

if (!(await exists(unresolvedCoveragePath))) await atomicWrite(
  unresolvedCoveragePath,
  `# 미해석 본문 Wiki Link 대응 보고서

- 본문 언급: ${unresolvedWikiLinks.length}개
- 기존 relation과 통합: ${unresolvedWikiLinksIntegrated}개
- 새 references relation으로 변환: ${unresolvedWikiLinksAdded}개
- 출발 문서 확인 필요: ${unresolvedWikiLinksMissingSource}개
- 별도 Wiki 문서 노드 생성: 0개

| 출발 문서 | Wiki link | 처리 | 관계 ID | 근거 위치 |
| --- | --- | --- | --- | --- |
${unresolvedLedger.map(({ item, sourceNode, action, relation, context }) => `| ${escapeCell(sourceNode?.title ?? sourceNode?.label ?? item.from)} | ${escapeCell(item.link)} | ${action} | ${escapeCell(relation?.id ?? "")} | ${escapeCell(context?.location ?? "")} |`).join("\n")}
`,
);

const missingEvidenceDocuments = relations.filter(({ evidenceDocument }) => !evidenceDocument);
const relationsWithEvidenceDocument = relations.length - missingEvidenceDocuments.length;
await atomicWrite(
  evidenceReportPath,
  `# 근거 문서 확인 필요

- 전체 관계: ${relations.length}개
- 근거 문서 확인 완료: ${relationsWithEvidenceDocument}개
- 사용자 확인 필요: ${missingEvidenceDocuments.length}개

| 관계 ID | 출발 객체 | 관계 | 도착 객체 | 기존 근거 위치 |
| --- | --- | --- | --- | --- |
${missingEvidenceDocuments.map((relation) => `| ${escapeCell(relation.id)} | ${escapeCell(relation.source)} | ${escapeCell(relation.relation)} | ${escapeCell(relation.target)} | ${escapeCell(relation.location)} |`).join("\n")}
`,
);

process.stdout.write(`${JSON.stringify({
  inputWikiLinks: wikiEdges.length,
  integratedWithTyped,
  addedGeneric,
  aliasCanonicalized,
  unresolved,
  processedTotal,
  candidateTotal,
  candidateIntegrated,
  candidateAdded,
  candidateConflicts: candidateConflicts.length,
  unresolvedWikiLinkMentions: unresolvedWikiLinks.length,
  unresolvedWikiLinksIntegrated,
  unresolvedWikiLinksAdded,
  unresolvedWikiLinksMissingSource,
  evidenceDocumentBackfilled,
  missingEvidenceDocuments: missingEvidenceDocuments.length,
})}\n`);
