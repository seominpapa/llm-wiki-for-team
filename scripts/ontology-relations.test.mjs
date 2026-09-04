import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_RELATION_TYPES,
  SOURCE_CATEGORIES,
  parseOntologyMarkdown,
  parseRelationTypes,
  parseRelations,
  serializeOntology,
  strictRagRelations,
  validateSourceCategoryCoverage,
  validateRelations,
} from "./lib/ontology-relations.mjs";

const ontologyMarkdown = `# 온톨로지 관계

## 관계 유형 카탈로그

| 유형 ID | 표시명 | 역관계 | 적용 분류 | 설명 |
| --- | --- | --- | --- | --- |
| delegates_to | 위임한다 | 위임받는다 | 01 법률, 02 지침 및 고시 | 상위 규범이 하위 규범에 사항을 위임함 |
| supports | 근거가 된다 | 근거를 둔다 | 01 법률, 06 시험발파 보고서 | 주장·기준을 뒷받침함 |

## 관계 목록

| ID | 출발 객체 | 관계 유형 | 도착 객체 | 상태 | 근거 | 위치 | 메모 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rel-001 | [[광산안전법\\|광산안전법 원문]] | delegates_to | [[광산안전법 시행령]] | 검토 | 위임 규정 | 제5조 \\| 별표 1 | 법률 \\| 시행령 |
| rel-002 | [[시험발파 결과보고서]] | supports | [[발파 설계기준]] | 확정 | 시험 수치가 기준을 충족함 | 32쪽 | 수치 확인 완료 |
| rel-003 | [[구버전 매뉴얼]] | supports | [[HATS 운용 방법]] | 제외 | 개정본으로 대체됨 | 표지 | 답변에 사용하지 않음 |
`;

const relationTypes = [
  {
    key: "delegates_to",
    label: "위임한다",
    inverse: "위임받는다",
    scope: ["01 법률", "02 지침 및 고시"],
    description: "상위 규범이 하위 규범에 사항을 위임함",
  },
  {
    key: "supports",
    label: "근거가 된다",
    inverse: "근거를 둔다",
    scope: ["01 법률", "06 시험발파 보고서"],
    description: "주장·기준을 뒷받침함",
  },
];

const relations = [
  {
    id: "rel-001",
    source: "[[광산안전법|광산안전법 원문]]",
    relation: "delegates_to",
    target: "[[광산안전법 시행령]]",
    status: "검토",
    evidenceDocument: "",
    evidence: "위임 규정",
    location: "제5조 | 별표 1",
    note: "법률 | 시행령",
  },
  {
    id: "rel-002",
    source: "[[시험발파 결과보고서]]",
    relation: "supports",
    target: "[[발파 설계기준]]",
    status: "확정",
    evidenceDocument: "",
    evidence: "시험 수치가 기준을 충족함",
    location: "32쪽",
    note: "수치 확인 완료",
  },
  {
    id: "rel-003",
    source: "[[구버전 매뉴얼]]",
    relation: "supports",
    target: "[[HATS 운용 방법]]",
    status: "제외",
    evidenceDocument: "",
    evidence: "개정본으로 대체됨",
    location: "표지",
    note: "답변에 사용하지 않음",
  },
];

test("관계 유형과 관계 목록 Markdown 표를 구분해 파싱한다", () => {
  assert.deepEqual(parseRelationTypes(ontologyMarkdown), relationTypes);
  assert.deepEqual(parseRelations(ontologyMarkdown), relations);
  assert.deepEqual(parseOntologyMarkdown(ontologyMarkdown), { relationTypes, relations });
});

test("escaped pipe를 손실 없이 Markdown과 객체 사이에서 왕복한다", () => {
  const serialized = serializeOntology({ relationTypes, relations });

  assert.match(serialized, /\[\[광산안전법\\\|광산안전법 원문\]\]/);
  assert.match(serialized, /제5조 \\\| 별표 1/);
  assert.deepEqual(parseOntologyMarkdown(serialized), { relationTypes, relations });
  assert.match(serialized, /새 관계의 기본 상태는 `확정`/);
  assert.match(serialized, /`검토`는 다른 팀원의 검토가 필요/);
  assert.match(serialized, /`제외`는 맞지 않는 관계이며 향후 동일 관계도 제외/);
});

test("근거 문서를 포함한 새 스키마를 읽고 쓰며 기존 8열 형식도 계속 읽는다", () => {
  const relation = {
    ...relations[1],
    evidenceDocument: "[[시험발파 결과보고서]]",
  };
  const serialized = serializeOntology({ relationTypes, relations: [relation] });

  assert.match(serialized, /\| ID \| 출발 객체 \| 관계 유형 \| 도착 객체 \| 상태 \| 근거 문서 \| 근거 내용 \| 근거 위치 \| 메모 \|/);
  assert.deepEqual(parseRelations(serialized), [relation]);
  assert.equal(parseRelations(ontologyMarkdown)[0].evidenceDocument, "");
});

test("상태는 검토·확정·제외만 허용한다", () => {
  assert.doesNotThrow(() => validateRelations(relations, relationTypes));

  const invalid = relations.map((relation, index) =>
    index === 0 ? { ...relation, status: "임시" } : relation,
  );
  assert.throws(() => validateRelations(invalid, relationTypes), /상태|status/i);
});

test("카탈로그에 등록되지 않은 관계 유형을 거부한다", () => {
  const invalid = relations.map((relation, index) =>
    index === 0 ? { ...relation, relation: "invented_type" } : relation,
  );

  assert.throws(
    () => validateRelations(invalid, relationTypes),
    /미등록|relation type|관계 유형/i,
  );
});

test("중복 ID와 중복 source-relation-target triple을 탐지한다", () => {
  const duplicateId = [relations[0], { ...relations[1], id: relations[0].id }];
  assert.throws(() => validateRelations(duplicateId, relationTypes), /중복.*ID|duplicate.*id/i);

  const duplicateTriple = [
    relations[0],
    { ...relations[0], id: "rel-999", status: "확정", note: "다른 메모" },
  ];
  assert.throws(
    () => validateRelations(duplicateTriple, relationTypes),
    /중복.*(관계|triple)|duplicate.*triple/i,
  );
});

test("strict RAG 필터는 확정 관계만 새 배열로 반환한다", () => {
  const strict = strictRagRelations(relations);

  assert.deepEqual(strict, [relations[1]]);
  assert.notStrictEqual(strict, relations);
  assert.equal(relations.length, 3);
});

test("기본 관계 유형 카탈로그는 고정 sources 01~10 분류에 의존하지 않는다", () => {
  assert.deepEqual(SOURCE_CATEGORIES, []);
  assert.ok(
    DEFAULT_RELATION_TYPES.every(
      ({ key, label, inverse, scope, description }) =>
        key && label && inverse && Array.isArray(scope) && scope.includes("공통") && description,
    ),
  );
  for (const legalKey of ["delegates_to", "implements", "amends", "repeals", "prohibits", "permits"]) {
    assert.ok(DEFAULT_RELATION_TYPES.some(({ key }) => key === legalKey));
  }
  for (const commonKey of ["references", "describes", "related_to", "same_as", "uses"]) {
    assert.ok(DEFAULT_RELATION_TYPES.some(({ key }) => key === commonKey));
  }
});

test("source 분류 목록이 없으면 고정 sources 01~10 분류를 강제하지 않는다", () => {
  assert.doesNotThrow(() => validateSourceCategoryCoverage(DEFAULT_RELATION_TYPES));
  assert.doesNotThrow(() =>
    validateSourceCategoryCoverage([{ ...DEFAULT_RELATION_TYPES[0], scope: ["사용자 업무 폴더"] }]),
  );
});

test("전달된 동적 source 분류 목록은 공통 또는 등록 분류로 모두 포괄해야 한다", () => {
  const dynamicCategories = ["법률", "현장 매뉴얼"];

  assert.doesNotThrow(() =>
    validateSourceCategoryCoverage([{ ...DEFAULT_RELATION_TYPES[0], scope: ["공통"] }], dynamicCategories),
  );
  assert.doesNotThrow(() =>
    validateSourceCategoryCoverage(
      [
        { ...DEFAULT_RELATION_TYPES[0], scope: ["법률"] },
        { ...DEFAULT_RELATION_TYPES[1], scope: ["현장 매뉴얼"] },
      ],
      dynamicCategories,
    ),
  );
  assert.throws(
    () => validateSourceCategoryCoverage([{ ...DEFAULT_RELATION_TYPES[0], scope: ["법률"] }], dynamicCategories),
    /포괄|분류|category/i,
  );
  assert.throws(
    () => validateSourceCategoryCoverage([{ ...DEFAULT_RELATION_TYPES[0], scope: ["알 수 없음"] }], dynamicCategories),
    /알 수 없음|미등록|unknown/i,
  );
});

test("source 분류의 숫자 접두어가 바뀌어도 같은 논리 분류로 판단한다", () => {
  assert.doesNotThrow(() =>
    validateSourceCategoryCoverage(
      [{ ...DEFAULT_RELATION_TYPES[0], scope: ["10 기타"] }],
      ["11 기타"],
    ),
  );
});
