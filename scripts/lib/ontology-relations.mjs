const freezeType = ({ key, label, inverse, scope, description }) =>
  Object.freeze({ key, label, inverse, scope: Object.freeze([...scope]), description });

export const SOURCE_CATEGORIES = Object.freeze([]);

export const DEFAULT_RELATION_TYPES = Object.freeze(
  [
    {
      key: "delegates_to",
      label: "위임한다",
      inverse: "위임받는다",
      scope: ["공통"],
      description: "상위 규범이 하위 규범에 사항을 위임한다.",
    },
    {
      key: "implements",
      label: "구체화한다",
      inverse: "구체화된다",
      scope: ["공통"],
      description: "시행령·시행규칙·지침이 상위 규범을 구체화한다.",
    },
    {
      key: "amends",
      label: "개정한다",
      inverse: "개정된다",
      scope: ["공통"],
      description: "규범이나 기준의 일부를 개정한다.",
    },
    {
      key: "repeals",
      label: "폐지·대체한다",
      inverse: "폐지·대체된다",
      scope: ["공통"],
      description: "새 문서나 버전이 기존 문서의 효력을 없애거나 대체한다.",
    },
    {
      key: "exception_to",
      label: "예외이다",
      inverse: "예외를 둔다",
      scope: ["공통"],
      description: "특정 대상이나 조건이 일반 규칙의 예외임을 나타낸다.",
    },
    {
      key: "applies_to",
      label: "적용된다",
      inverse: "적용대상으로 둔다",
      scope: ["공통"],
      description: "규범·기준·단가·절차가 대상에 적용된다.",
    },
    {
      key: "requires",
      label: "요구한다",
      inverse: "요구된다",
      scope: ["공통"],
      description: "행위, 조건, 서류 또는 성능을 의무로 요구한다.",
    },
    {
      key: "prohibits",
      label: "금지한다",
      inverse: "금지된다",
      scope: ["공통"],
      description: "특정 행위나 조건을 금지한다.",
    },
    {
      key: "permits",
      label: "허용한다",
      inverse: "허용된다",
      scope: ["공통"],
      description: "특정 조건에서 행위나 사용을 허용한다.",
    },
    {
      key: "references",
      label: "참조한다",
      inverse: "참조된다",
      scope: ["공통"],
      description: "한 문서나 객체가 다른 문서·기준·객체를 명시적으로 참조한다.",
    },
    {
      key: "supports",
      label: "근거가 된다",
      inverse: "근거를 둔다",
      scope: ["공통"],
      description: "자료·측정·규정이 주장이나 결론을 뒷받침한다.",
    },
    {
      key: "derived_from",
      label: "파생된다",
      inverse: "파생시킨다",
      scope: ["공통"],
      description: "계산·요약·산출물이 다른 자료에서 파생된다.",
    },
    {
      key: "prices",
      label: "가격을 정한다",
      inverse: "가격이 정해진다",
      scope: ["공통"],
      description: "품목·공종·서비스의 단가 또는 가격을 정한다.",
    },
    {
      key: "calculated_from",
      label: "산정된다",
      inverse: "산정 근거가 된다",
      scope: ["공통"],
      description: "값이나 비용이 기준·수량·측정값에서 계산된다.",
    },
    {
      key: "component_of",
      label: "구성요소이다",
      inverse: "구성한다",
      scope: ["공통"],
      description: "제품·장비·시스템의 구성 관계를 나타낸다.",
    },
    {
      key: "compatible_with",
      label: "호환된다",
      inverse: "호환된다",
      scope: ["공통"],
      description: "제품·장비·소프트웨어가 함께 사용할 수 있다.",
    },
    {
      key: "uses",
      label: "사용한다",
      inverse: "사용된다",
      scope: ["공통"],
      description: "작업·제품·프로젝트가 기술·장비·재료·방법을 사용한다.",
    },
    {
      key: "measures",
      label: "측정한다",
      inverse: "측정된다",
      scope: ["공통"],
      description: "장비나 절차가 수치·현상을 측정한다.",
    },
    {
      key: "validates",
      label: "검증한다",
      inverse: "검증된다",
      scope: ["공통"],
      description: "시험·분석·심사가 주장, 성능 또는 요건 충족을 검증한다.",
    },
    {
      key: "precedes",
      label: "선행한다",
      inverse: "후행한다",
      scope: ["공통"],
      description: "절차나 작업의 시간·순서상 선행 관계를 나타낸다.",
    },
    {
      key: "submitted_to",
      label: "제출된다",
      inverse: "제출받는다",
      scope: ["공통"],
      description: "문서·제안·입찰 자료가 기관 또는 조직에 제출된다.",
    },
    {
      key: "evaluated_by",
      label: "평가받는다",
      inverse: "평가한다",
      scope: ["공통"],
      description: "자료·제품·제안이 기관, 기준 또는 절차에 의해 평가된다.",
    },
    {
      key: "related_to",
      label: "관련된다",
      inverse: "관련된다",
      scope: ["공통"],
      description: "더 구체적인 유형이 아직 없을 때만 사용하는 일반 관계다.",
    },
  ].map(freezeType),
);

const VALID_STATUSES = new Set(["검토", "확정", "제외"]);

function parseRow(line) {
  const trimmed = line.trim();
  const body = trimmed.slice(1, trimmed.endsWith("|") ? -1 : undefined);
  const cells = [];
  let cell = "";

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (character === "\\" && body[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function tableAfterHeading(markdown, heading) {
  if (typeof markdown !== "string") throw new TypeError("Markdown은 문자열이어야 합니다.");

  const lines = markdown.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => heading.test(line.trim()));
  if (headingIndex < 0) return [];

  let start = headingIndex + 1;
  while (start < lines.length && !lines[start].trim().startsWith("|")) {
    if (/^#{1,2}\s/.test(lines[start].trim())) return [];
    start += 1;
  }

  const tableLines = [];
  for (let index = start; index < lines.length && lines[index].trim().startsWith("|"); index += 1) {
    tableLines.push(lines[index]);
  }
  if (tableLines.length === 0) return [];

  const rows = tableLines.map(parseRow);
  const headers = rows[0];
  return rows.slice(1).filter((row) => !row.every((cell) => /^:?-{3,}:?$/.test(cell))).map(
    (row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])),
  );
}

const requiredCell = (row, header) => {
  const value = row[header]?.trim();
  if (!value) throw new Error(`필수 열 '${header}'이(가) 비어 있습니다.`);
  return value;
};

export function parseRelationTypes(markdown) {
  return tableAfterHeading(markdown, /^##\s+관계 유형 카탈로그\s*$/).map((row) => ({
    key: requiredCell(row, "유형 ID"),
    label: requiredCell(row, "표시명"),
    inverse: requiredCell(row, "역관계"),
    scope: requiredCell(row, "적용 분류")
      .split(/\s*[,，]\s*/)
      .filter(Boolean),
    description: requiredCell(row, "설명"),
  }));
}

export function parseRelations(markdown) {
  return tableAfterHeading(markdown, /^##\s+관계 목록\s*$/).map((row) => ({
    id: requiredCell(row, "ID"),
    source: requiredCell(row, "출발 객체"),
    relation: requiredCell(row, "관계 유형"),
    target: requiredCell(row, "도착 객체"),
    status: requiredCell(row, "상태"),
    evidence: row["근거"]?.trim() ?? "",
    location: row["위치"]?.trim() ?? "",
    note: row["메모"]?.trim() ?? "",
  }));
}

export function parseOntologyMarkdown(markdown) {
  return {
    relationTypes: parseRelationTypes(markdown),
    relations: parseRelations(markdown),
  };
}

function validateRelationTypes(relationTypes) {
  if (!Array.isArray(relationTypes)) throw new TypeError("관계 유형은 배열이어야 합니다.");

  const keys = new Set();
  for (const type of relationTypes) {
    if (!type || typeof type !== "object") throw new TypeError("관계 유형 항목이 올바르지 않습니다.");
    for (const field of ["key", "label", "inverse", "description"]) {
      if (typeof type[field] !== "string" || !type[field].trim()) {
        throw new Error(`관계 유형의 ${field}값이 필요합니다.`);
      }
    }
    if (!Array.isArray(type.scope) || type.scope.length === 0) {
      throw new Error(`관계 유형 '${type.key}'의 적용 분류가 필요합니다.`);
    }
    if (keys.has(type.key)) throw new Error(`중복 관계 유형 ID: ${type.key}`);
    keys.add(type.key);
  }
  return keys;
}

export function validateSourceCategoryCoverage(relationTypes, sourceCategories = SOURCE_CATEGORIES) {
  validateRelationTypes(relationTypes);
  if (!Array.isArray(sourceCategories)) throw new TypeError("source 분류 목록은 배열이어야 합니다.");
  if (sourceCategories.length === 0) return true;

  const categoryAliases = new Map(
    sourceCategories.flatMap((category) => [
      [category, category],
      [category.replace(/^\d+\s+/, ""), category],
    ]),
  );
  const covered = new Set();

  for (const { scope } of relationTypes) {
    for (const item of scope) {
      if (item === "공통") {
        sourceCategories.forEach((category) => covered.add(category));
        continue;
      }
      const category = categoryAliases.get(item);
      if (!category) throw new Error(`미등록 source 분류: ${item}`);
      covered.add(category);
    }
  }

  const missing = sourceCategories.filter((category) => !covered.has(category));
  if (missing.length > 0) throw new Error(`관계 유형이 포괄하지 않는 source 분류: ${missing.join(", ")}`);
  return true;
}

const canonicalEndpoint = (value) =>
  value
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .split("|", 1)[0]
    .split("#", 1)[0]
    .trim()
    .toLocaleLowerCase("ko-KR");

export function validateRelations(relations, relationTypes = DEFAULT_RELATION_TYPES) {
  if (!Array.isArray(relations)) throw new TypeError("관계 목록은 배열이어야 합니다.");
  const registeredTypes = validateRelationTypes(relationTypes);
  const ids = new Set();
  const triples = new Set();

  for (const relation of relations) {
    if (!relation || typeof relation !== "object") throw new TypeError("관계 항목이 올바르지 않습니다.");
    for (const field of ["id", "source", "relation", "target", "status"]) {
      if (typeof relation[field] !== "string" || !relation[field].trim()) {
        throw new Error(`관계의 ${field}값이 필요합니다.`);
      }
    }
    for (const field of ["evidence", "location", "note"]) {
      if (typeof relation[field] !== "string") throw new Error(`관계의 ${field}값은 문자열이어야 합니다.`);
    }
    if (!VALID_STATUSES.has(relation.status)) throw new Error(`허용되지 않은 상태: ${relation.status}`);
    if (!registeredTypes.has(relation.relation)) {
      throw new Error(`미등록 관계 유형: ${relation.relation}`);
    }
    if (ids.has(relation.id)) throw new Error(`중복 ID: ${relation.id}`);
    ids.add(relation.id);

    const triple = [
      canonicalEndpoint(relation.source),
      relation.relation,
      canonicalEndpoint(relation.target),
    ].join("\u0000");
    if (triples.has(triple)) throw new Error(`중복 관계 triple: ${relation.id}`);
    triples.add(triple);
  }
  return true;
}

export function strictRagRelations(relations) {
  if (!Array.isArray(relations)) throw new TypeError("관계 목록은 배열이어야 합니다.");
  return relations.filter(({ status }) => status === "확정");
}

const escapeCell = (value) => String(value).replace(/\r?\n/g, "<br>").replaceAll("|", "\\|");

const tableRow = (values) => `| ${values.map(escapeCell).join(" | ")} |`;

export function serializeOntology({ relationTypes, relations }) {
  validateRelations(relations, relationTypes);

  const typeRows = relationTypes.map(({ key, label, inverse, scope, description }) =>
    tableRow([key, label, inverse, scope.join(", "), description]),
  );
  const relationRows = relations.map(
    ({ id, source, relation, target, status, evidence, location, note }) =>
      tableRow([id, source, relation, target, status, evidence, location, note]),
  );

  return `# 온톨로지 관계

이 문서는 모든 typed relation의 단일 원본이다. 새 관계의 기본 상태는 \`확정\`이다. \`검토\`는 다른 팀원의 검토가 필요한 관계이고, \`제외\`는 맞지 않는 관계이며 향후 동일 관계도 제외한다는 의미다. RAG 답변과 관계 추론에는 \`확정\` 관계만 사용한다.

## 관계 유형 카탈로그

| 유형 ID | 표시명 | 역관계 | 적용 분류 | 설명 |
| --- | --- | --- | --- | --- |
${typeRows.join("\n")}

## 관계 목록

| ID | 출발 객체 | 관계 유형 | 도착 객체 | 상태 | 근거 | 위치 | 메모 |
| --- | --- | --- | --- | --- | --- | --- | --- |
${relationRows.join("\n")}
`;
}
