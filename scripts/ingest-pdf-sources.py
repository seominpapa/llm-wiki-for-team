#!/usr/bin/env python3
"""PDF 원본을 보존하며 source Markdown 변환본을 생성한다."""

import argparse
import hashlib
import html
import re
import sys
import unicodedata
from datetime import date, datetime
from pathlib import Path
from typing import List, NamedTuple, Optional, Sequence, Tuple, Type


RESERVED_OUTPUT_DIR = "_generated"
SOURCE_TYPES = (
    "law", "regulation", "cost", "catalog", "submission", "report", "manual",
    "tender", "other",
)
SOURCE_TYPE_KEYWORDS = (
    ("law", ("법률",)),
    ("regulation", ("지침", "고시", "규정", "기준", "시방")),
    ("cost", ("품셈", "시장단가", "단가", "원가")),
    ("catalog", ("카달로그", "카탈로그", "브로슈어", "catalog")),
    ("submission", ("제출", "제안", "발표", "기술카드")),
    ("report", ("보고서", "시험발파", "분석")),
    ("manual", ("매뉴얼", "manual", "운용", "작업")),
    ("tender", ("입찰", "제안요청", "rfp")),
)
DEFAULT_TEMPLATE = Path(__file__).resolve().parents[1] / "templates" / "source-markdown.md"
REQUIRED_TEMPLATE_FIELDS = (
    "title", "source", "source_file", "source_category", "source_type", "author",
    "published", "converted", "language", "description", "wiki_status",
)
REQUIRED_TEMPLATE_SECTIONS = (
    "# 원문 제목", "## 원문 정보", "## 핵심 요약", "## 주요 기준·수치·요건",
    "## 본문", "## 온톨로지 관계 후보", "## 추출 메모",
)


class ConversionResult(NamedTuple):
    status: str
    path: Path


def nfc(value: str) -> str:
    return unicodedata.normalize("NFC", value)


def yaml_string(value: str) -> str:
    clean = nfc(value).replace("\\", "\\\\").replace('"', '\\"')
    clean = clean.replace("\r", " ").replace("\n", " ")
    return '"{}"'.format(clean)


def safe_filename(value: str) -> str:
    value = nfc(value)
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', " ", value)
    value = re.sub(r"\s+", " ", value).strip(" .")
    return value or "제목 확인 불가"


def title_from_filename(pdf_path: Path) -> str:
    title = nfc(pdf_path.stem).replace("_", " ")
    metadata_group = (
        r"\((?:법률|대통령령|[^()]+(?:부령|청령|처령|고시)|"
        r"제\s*[0-9-]+호|20\d{6})\)"
    )
    title = re.sub(metadata_group, "", title)
    return re.sub(r"\s+", " ", title).strip(" ._-") or "확인 불가"


def extract_date(text: str) -> str:
    normalized = nfc(text)
    candidates = re.findall(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?!\d)", normalized)
    candidates += re.findall(
        r"(?<!\d)(20\d{2})\s*(?:[.\-/]|년)\s*(\d{1,2})\s*(?:[.\-/]|월)\s*(\d{1,2})(?:\s*일)?",
        normalized,
    )
    for year, month, day in candidates:
        try:
            return datetime(int(year), int(month), int(day)).date().isoformat()
        except ValueError:
            continue
    return "확인 불가"


def extract_agency(filename: str, first_page: str) -> str:
    combined = "{}\n{}".format(nfc(filename), nfc(first_page)[:4000])
    parenthesized = re.search(
        r"\(([가-힣]{2,30}(?:부|청|처|공사|공단|위원회))(?:령|고시)?\)", combined
    )
    if parenthesized:
        return parenthesized.group(1)
    for line in first_page.splitlines()[:30]:
        match = re.fullmatch(
            r"\s*((?:대한민국|한국)?[가-힣]{1,24}(?:부|청|처|공사|공단|위원회))\s*", nfc(line)
        )
        if match:
            return match.group(1)
    return "확인 불가"


def infer_category(pdf_path: Path, source_root: Path, override: Optional[str]) -> str:
    if override:
        return nfc(override)
    relative = pdf_path.relative_to(source_root)
    return nfc(relative.parts[0]) if len(relative.parts) > 1 else "기타"


def infer_source_type(category: str, override: Optional[str]) -> str:
    if override:
        if override not in SOURCE_TYPES:
            raise ValueError("알 수 없는 source_type: {}".format(override))
        return override
    folded = nfc(category).casefold()
    for source_type, keywords in SOURCE_TYPE_KEYWORDS:
        if any(keyword in folded for keyword in keywords):
            return source_type
    return "other"


def is_generated_path(path: Path, source_root: Path) -> bool:
    try:
        relative = path.relative_to(source_root)
    except ValueError:
        return False
    return bool(relative.parts) and relative.parts[0] == RESERVED_OUTPUT_DIR


def relative_source_file(pdf_path: Path, source_root: Path) -> str:
    relative = pdf_path.relative_to(source_root)
    return nfc((Path(source_root.name) / relative).as_posix())


def frontmatter_value(text: str, key: str) -> Optional[str]:
    match = re.search(r"^{}:\s*(.*?)\s*$".format(re.escape(key)), text, re.MULTILINE)
    if not match:
        return None
    value = match.group(1)
    if len(value) >= 2 and value[0] == value[-1] == '"':
        value = re.sub(r'\\([\\"])', r'\1', value[1:-1])
    elif len(value) >= 2 and value[0] == value[-1] == "'":
        value = value[1:-1]
    return nfc(value)


def existing_conversion(
    output_dir: Path, source_file: str, source_title: str, source_stem: str
) -> Optional[Path]:
    if not output_dir.exists():
        return None
    for markdown in sorted(output_dir.rglob("*.md")):
        try:
            with markdown.open("r", encoding="utf-8") as stream:
                head = stream.read(16384)
        except (OSError, UnicodeError):
            continue
        recorded_file = frontmatter_value(head, "source_file")
        if recorded_file == source_file:
            return markdown
        if recorded_file:
            continue
        recorded_source = frontmatter_value(head, "source")
        if recorded_source in (source_file, nfc(Path(source_file).name), source_stem):
            return markdown
        if frontmatter_value(head, "title") == source_title:
            return markdown
        if nfc(markdown.stem) == source_stem:
            return markdown
    return None


def read_pages(pdf_path: Path, reader_class=None) -> Tuple[List[str], List[int]]:
    if reader_class is None:
        try:
            from pypdf import PdfReader
        except ImportError as error:
            raise RuntimeError(
                "pypdf가 필요합니다: python3 -m pip install pypdf"
            ) from error
        reader_class = PdfReader
    reader = reader_class(str(pdf_path))
    pages = []
    missing = []
    for number, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = nfc(text).replace("\r\n", "\n").replace("\r", "\n").strip()
        if not text:
            missing.append(number)
        pages.append(html.escape(text, quote=False))
    return pages, missing


def document_number(filename: str) -> str:
    match = re.search(r"\(제\s*([0-9-]+)호\)", nfc(filename))
    return "제{}호".format(match.group(1)) if match else "확인 불가"


def load_template(template_path: Path) -> str:
    try:
        template = Path(template_path).read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError("template을 읽을 수 없습니다: {}".format(template_path)) from error
    missing = [
        item for item in REQUIRED_TEMPLATE_SECTIONS if item not in template
    ] + [
        field for field in REQUIRED_TEMPLATE_FIELDS
        if not re.search(r"^{}:".format(re.escape(field)), template, re.MULTILINE)
    ]
    if missing:
        raise ValueError("template 필수 구조 누락: {}".format(", ".join(missing)))
    return template


def markdown_document(
    *,
    title: str,
    source_file: str,
    category: str,
    source_type: str,
    published: str,
    converted: str,
    agency: str,
    document_no: str,
    pages: Sequence[str],
    missing_pages: Sequence[int],
    template_text: str
) -> str:
    if pages and not missing_pages:
        extraction_status = "완료"
    elif pages and len(missing_pages) < len(pages):
        extraction_status = "부분"
    else:
        extraction_status = "OCR 필요"
    page_body = []
    for number, text in enumerate(pages, start=1):
        page_body.append("<!-- page: {} -->\n\n{}".format(number, text or "[텍스트 추출 불가]"))
    missing_text = ", ".join(str(number) for number in missing_pages) or "없음"
    replacements = {
        "title": yaml_string(title),
        "source": yaml_string(agency),
        "source_file": yaml_string(source_file),
        "source_category": yaml_string(category),
        "source_type": yaml_string(source_type),
        "author": yaml_string(agency),
        "published": yaml_string(published),
        "converted": yaml_string(converted),
        "language": '"ko"',
        "description": yaml_string("{} 원문 PDF의 텍스트 추출 변환본".format(title)),
        "wiki_status": "unprocessed",
    }
    rendered = template_text
    for key, value in replacements.items():
        rendered = re.sub(
            r"^{}:.*$".format(re.escape(key)), "{}: {}".format(key, value), rendered,
            count=1, flags=re.MULTILINE,
        )
    rendered = rendered.replace("# 원문 제목", "# {}".format(title), 1)
    information = {
        "원본 파일": "`{}`".format(source_file),
        "발행처/작성자": agency,
        "발행일/개정일": published,
        "문서 번호/버전": document_no,
        "원본 분류": category,
        "페이지 수": str(len(pages)),
        "텍스트 추출 상태": "`{}`".format(extraction_status),
        "누락/판독 불가 페이지": missing_text,
        "OCR 또는 표/도면 재확인 필요 사항": (
            "텍스트 추출 불가 페이지 재확인 필요" if missing_pages else "없음"
        ),
        "중복 또는 대체 문서": "확인 불가",
        "기타": "pypdf 텍스트 추출을 사용함; raw HTML 이스케이프 적용",
    }
    for label, value in information.items():
        rendered = re.sub(
            r"^- {}:.*$".format(re.escape(label)), "- {}: {}".format(label, value), rendered,
            count=1, flags=re.MULTILINE,
        )
    for label in ("문서의 목적", "적용 대상", "핵심 내용", "주요 제한 또는 예외"):
        rendered = re.sub(
            r"^- {}:.*$".format(re.escape(label)), "- {}: 확인 불가".format(label),
            rendered, count=1, flags=re.MULTILINE,
        )
    body = "\n\n".join(page_body) or "[페이지 없음]"
    rendered = re.sub(
        r"(## 본문\s*\n).*?(?=\n## 온톨로지 관계 후보)",
        lambda match: "{}\n{}\n".format(match.group(1), body),
        rendered, count=1, flags=re.DOTALL,
    )
    return rendered.rstrip() + "\n"


def convert_pdf(
    pdf_path: Path,
    *,
    source_root: Path,
    output_dir: Path,
    category: Optional[str] = None,
    source_type: Optional[str] = None,
    reader_class=None,
    converted_date: Optional[str] = None,
    template_path: Path = DEFAULT_TEMPLATE
) -> ConversionResult:
    pdf_path = Path(pdf_path).expanduser().resolve()
    source_root = Path(source_root).expanduser().resolve()
    output_dir = Path(output_dir).expanduser().resolve()
    if not pdf_path.is_file() or pdf_path.suffix.lower() != ".pdf":
        raise ValueError("PDF 파일이 아닙니다: {}".format(pdf_path))
    try:
        pdf_path.relative_to(source_root)
    except ValueError as error:
        raise ValueError("PDF는 source root 안에 있어야 합니다: {}".format(pdf_path)) from error
    if is_generated_path(pdf_path, source_root):
        raise ValueError("{} 내부 PDF는 입력으로 사용할 수 없습니다: {}".format(RESERVED_OUTPUT_DIR, pdf_path))

    category = infer_category(pdf_path, source_root, category)
    source_type = infer_source_type(category, source_type)
    source_file = relative_source_file(pdf_path, source_root)
    title = title_from_filename(pdf_path)
    source_stem = nfc(pdf_path.stem)
    duplicate = existing_conversion(output_dir, source_file, title, source_stem)
    if duplicate:
        return ConversionResult("skipped", duplicate)

    pages, missing_pages = read_pages(pdf_path, reader_class)
    first_page = pages[0] if pages else ""
    published = extract_date("{}\n{}".format(pdf_path.name, first_page[:4000]))
    converted = converted_date or date.today().isoformat()
    try:
        datetime.strptime(converted, "%Y-%m-%d")
    except ValueError as error:
        raise ValueError("converted_date는 YYYY-MM-DD 형식이어야 합니다") from error
    agency = extract_agency(pdf_path.name, first_page)
    filename_date = published if published != "확인 불가" else converted
    output_name = safe_filename("{}_{}_{}".format(filename_date, category, title)) + ".md"
    output_path = output_dir / output_name
    if output_path.exists():
        identity = hashlib.sha256(source_file.encode("utf-8")).hexdigest()[:10]
        output_path = output_dir / "{}__{}{}".format(output_path.stem, identity, output_path.suffix)
        if output_path.exists():
            return ConversionResult("skipped", output_path)

    template_text = load_template(template_path)
    content = markdown_document(
        title=title,
        source_file=source_file,
        category=category,
        source_type=source_type,
        published=published,
        converted=converted,
        agency=agency,
        document_no=document_number(pdf_path.name),
        pages=pages,
        missing_pages=missing_pages,
        template_text=template_text,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    try:
        with output_path.open("x", encoding="utf-8", newline="\n") as stream:
            stream.write(content)
    except FileExistsError:
        return ConversionResult("skipped", output_path)
    return ConversionResult("created", output_path)


def discover_pdfs(inputs: Sequence[Path], source_root: Optional[Path] = None) -> List[Path]:
    found = []
    resolved_source_root = Path(source_root).expanduser().resolve() if source_root else None
    for item in inputs:
        path = Path(item).expanduser()
        if path.is_file() and path.suffix.lower() == ".pdf":
            candidate = path.resolve()
            if resolved_source_root and is_generated_path(candidate, resolved_source_root):
                raise ValueError("{} 내부 PDF는 입력으로 사용할 수 없습니다: {}".format(RESERVED_OUTPUT_DIR, candidate))
            found.append(candidate)
        elif path.is_dir():
            for candidate in path.rglob("*"):
                if not candidate.is_file() or candidate.suffix.lower() != ".pdf":
                    continue
                resolved = candidate.resolve()
                if resolved_source_root and is_generated_path(resolved, resolved_source_root):
                    continue
                found.append(resolved)
        else:
            raise ValueError("PDF 또는 폴더가 아닙니다: {}".format(path))
    unique = {candidate.resolve(): candidate.resolve() for candidate in found}
    return sorted(unique.values(), key=lambda path: nfc(str(path)))


def parse_args(argv: Optional[Sequence[str]] = None):
    parser = argparse.ArgumentParser(description="PDF source Markdown 변환본 생성")
    parser.add_argument("inputs", nargs="+", type=Path, help="PDF 파일 또는 PDF가 있는 폴더")
    parser.add_argument("--source-root", type=Path, default=Path("sources"))
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--category")
    parser.add_argument("--source-type", choices=SOURCE_TYPES)
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = parse_args(argv)
    source_root = args.source_root
    output_dir = args.output_dir or source_root / RESERVED_OUTPUT_DIR
    try:
        pdfs = discover_pdfs(args.inputs, source_root=source_root)
        if not pdfs:
            raise ValueError("변환할 PDF가 없습니다")
    except ValueError as error:
        print("오류: {}".format(error), file=sys.stderr)
        return 2

    failed = 0
    for pdf in pdfs:
        try:
            result = convert_pdf(
                pdf,
                source_root=source_root,
                output_dir=output_dir,
                category=args.category,
                source_type=args.source_type,
            )
            print("{}: {}".format(result.status, result.path))
        except Exception as error:
            failed += 1
            print("failed: {}: {}".format(pdf, error), file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
