import importlib.util
import tempfile
import unicodedata
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("ingest-pdf-sources.py")


def load_module():
    spec = importlib.util.spec_from_file_location("ingest_pdf_sources", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakePage:
    def __init__(self, text):
        self.text = text

    def extract_text(self):
        return self.text


class FakeReader:
    pages = []

    def __init__(self, _path):
        self.pages = [FakePage(text) for text in type(self).pages]


class IngestPdfSourcesTest(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.sources = self.root / "sources"
        self.output = self.sources / "_generated"
        self.laws = self.sources / "법률 자료"
        self.guides = self.sources / "현장 지침"
        self.laws.mkdir(parents=True)
        self.guides.mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def test_converts_pdf_with_template_metadata_pages_and_no_overwrite(self):
        decomposed = unicodedata.normalize(
            "NFD", "산업안전보건법(법률)(제21374호)(20260801).pdf"
        )
        pdf = self.laws / decomposed
        original = b"unchanged-pdf"
        pdf.write_bytes(original)
        FakeReader.pages = [
            "산업안전보건법\n제1조 목적\n<script>alert(1)</script>\nC:\\Users\\test", None
        ]

        result = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
            converted_date="2026-08-27",
        )

        self.assertEqual(result.status, "created")
        self.assertEqual(result.path.name, unicodedata.normalize("NFC", result.path.name))
        self.assertEqual(result.path.name, "2026-08-01_법률 자료_산업안전보건법.md")
        content = result.path.read_text(encoding="utf-8")
        self.assertIn('source_file: "sources/법률 자료/산업안전보건법(법률)(제21374호)(20260801).pdf"', content)
        self.assertIn('source_category: "법률 자료"', content)
        self.assertIn('source_type: "law"', content)
        self.assertIn('published: "2026-08-01"', content)
        self.assertIn('converted: "2026-08-27"', content)
        self.assertIn("<!-- page: 1 -->\n\n산업안전보건법", content)
        self.assertIn("<!-- page: 2 -->\n\n[텍스트 추출 불가]", content)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", content)
        self.assertNotIn("<script>alert(1)</script>", content)
        self.assertIn("C:\\Users\\test", content)
        self.assertIn("|  |  |  | 검토 |  |  |  |", content)
        self.assertEqual(pdf.read_bytes(), original)

        before = result.path.read_text(encoding="utf-8")
        repeated = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
            converted_date="2030-01-01",
        )
        self.assertEqual(repeated.status, "skipped")
        self.assertEqual(result.path.read_text(encoding="utf-8"), before)

    def test_existing_source_metadata_prevents_duplicate_output(self):
        pdf = self.guides / "발파 안전지침.pdf"
        pdf.write_bytes(b"pdf")
        self.output.mkdir(parents=True)
        existing = self.output / "legacy-name.md"
        existing.write_text(
            '---\nsource: "sources/현장 지침/발파 안전지침.pdf"\n---\n',
            encoding="utf-8",
        )
        FakeReader.pages = ["발파 안전지침"]

        result = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
        )

        self.assertEqual(result.status, "skipped")
        self.assertEqual(result.path, existing.resolve())
        self.assertEqual(len(list(self.output.glob("*.md"))), 1)

    def test_generated_escaped_source_file_metadata_is_detected_on_rerun(self):
        pdf = self.guides / '발파"안전\\지침.pdf'
        pdf.write_bytes(b"pdf")
        FakeReader.pages = ["발파 안전지침"]
        first = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
        )
        second = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
        )

        self.assertEqual((first.status, second.status), ("created", "skipped"))
        self.assertEqual(first.path, second.path)
        self.assertEqual(len(list(self.output.glob("*.md"))), 1)

    def test_existing_title_or_filename_stem_prevents_duplicate_output(self):
        FakeReader.pages = ["발파 안전지침"]
        for marker, existing_name, body in (
            ("title", "legacy-title.md", '---\ntitle: "발파 안전지침"\n---\n'),
            ("stem", "stem 발파 안전지침.md", "# legacy\n"),
        ):
            with self.subTest(marker=marker):
                case_dir = self.root / marker
                pdf = self.guides / (marker + " 발파 안전지침.pdf")
                pdf.write_bytes(b"pdf")
                if marker == "title":
                    pdf = self.guides / "발파 안전지침.pdf"
                    pdf.write_bytes(b"pdf")
                case_dir.mkdir()
                existing = case_dir / existing_name
                existing.write_text(body, encoding="utf-8")
                result = self.module.convert_pdf(
                    pdf,
                    source_root=self.sources,
                    output_dir=case_dir,
                    reader_class=FakeReader,
                )
                self.assertEqual(result.status, "skipped")
                self.assertEqual(result.path, existing.resolve())

    def test_distinct_sources_with_same_output_name_are_both_created(self):
        first = self.laws / "산업안전보건법(법률)(제100호)(20260801).pdf"
        second = self.laws / "산업안전보건법(법률)(제200호)(20260801).pdf"
        first.write_bytes(b"first")
        second.write_bytes(b"second")
        FakeReader.pages = ["산업안전보건법"]

        one = self.module.convert_pdf(
            first,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
            converted_date="2026-08-27",
        )
        two = self.module.convert_pdf(
            second,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
            converted_date="2026-08-27",
        )

        self.assertEqual((one.status, two.status), ("created", "created"))
        self.assertNotEqual(one.path, two.path)
        self.assertEqual(len(list(self.output.glob("*.md"))), 2)

    def test_rejects_template_missing_required_section(self):
        pdf = self.guides / "발파 안전지침.pdf"
        pdf.write_bytes(b"pdf")
        FakeReader.pages = ["발파 안전지침"]
        template = self.root / "broken-template.md"
        canonical = Path(__file__).parents[1] / "templates" / "source-markdown.md"
        template.write_text(
            canonical.read_text(encoding="utf-8").replace("## 추출 메모", "## removed"),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(ValueError, "template"):
            self.module.convert_pdf(
                pdf,
                source_root=self.sources,
                output_dir=self.output,
                reader_class=FakeReader,
                template_path=template,
            )

    def test_uses_known_category_type_and_conservative_first_page_agency(self):
        pdf = self.guides / "D-C-6-2025_발파공사_기술지원규정.pdf"
        pdf.write_bytes(b"pdf")
        FakeReader.pages = ["발파공사 기술지원규정\n한국도로공사"]

        result = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
            converted_date="2026-08-27",
        )
        content = result.path.read_text(encoding="utf-8")

        self.assertIn('source_category: "현장 지침"', content)
        self.assertIn('source_type: "regulation"', content)
        self.assertIn('published: "확인 불가"', content)
        self.assertIn('author: "한국도로공사"', content)

    def test_source_type_override_accepts_arbitrary_category(self):
        custom = self.sources / "고객 A" / "심층"
        custom.mkdir(parents=True)
        pdf = custom / "제안 발표.pdf"
        pdf.write_bytes(b"pdf")
        FakeReader.pages = ["제안 발표"]

        result = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            category="임의 분류",
            source_type="submission",
            reader_class=FakeReader,
            converted_date="2026-08-27",
        )
        content = result.path.read_text(encoding="utf-8")

        self.assertIn('source_file: "sources/고객 A/심층/제안 발표.pdf"', content)
        self.assertIn('source_category: "임의 분류"', content)
        self.assertIn('source_type: "submission"', content)

    def test_unknown_category_infers_other(self):
        folder = self.sources / "사용자 폴더"
        folder.mkdir()
        pdf = folder / "메모.pdf"
        pdf.write_bytes(b"pdf")
        FakeReader.pages = ["메모"]

        result = self.module.convert_pdf(
            pdf,
            source_root=self.sources,
            output_dir=self.output,
            reader_class=FakeReader,
        )
        content = result.path.read_text(encoding="utf-8")

        self.assertIn('source_category: "사용자 폴더"', content)
        self.assertIn('source_type: "other"', content)

    def test_rejects_pdf_inside_generated_folder(self):
        generated = self.sources / "_generated" / "nested"
        generated.mkdir(parents=True)
        pdf = generated / "skip.pdf"
        pdf.write_bytes(b"pdf")
        FakeReader.pages = ["skip"]

        with self.assertRaisesRegex(ValueError, "_generated"):
            self.module.convert_pdf(
                pdf,
                source_root=self.sources,
                output_dir=self.output,
                reader_class=FakeReader,
            )

    def test_rejects_input_outside_source_root(self):
        pdf = self.root / "outside.pdf"
        pdf.write_bytes(b"pdf")
        FakeReader.pages = ["outside"]

        with self.assertRaisesRegex(ValueError, "source root"):
            self.module.convert_pdf(
                pdf,
                source_root=self.sources,
                output_dir=self.output,
                reader_class=FakeReader,
            )

    def test_discovers_pdf_file_or_folder_recursively(self):
        nested = self.laws / "nested"
        nested.mkdir()
        generated = self.sources / "_generated"
        generated.mkdir()
        one = self.laws / "one.PDF"
        two = nested / "two.pdf"
        generated_pdf = generated / "ignored.pdf"
        ignored = nested / "note.txt"
        one.write_bytes(b"pdf")
        two.write_bytes(b"pdf")
        generated_pdf.write_bytes(b"pdf")
        ignored.write_text("not a pdf", encoding="utf-8")

        discovered = self.module.discover_pdfs([self.sources, two], source_root=self.sources)

        self.assertEqual(discovered, sorted([one.resolve(), two.resolve()], key=str))

    def test_discover_rejects_direct_generated_pdf_input(self):
        generated = self.sources / "_generated"
        generated.mkdir()
        pdf = generated / "ignored.pdf"
        pdf.write_bytes(b"pdf")

        with self.assertRaisesRegex(ValueError, "_generated"):
            self.module.discover_pdfs([pdf], source_root=self.sources)

    def test_main_defaults_output_dir_to_generated(self):
        pdf = self.laws / "one.pdf"
        pdf.write_bytes(b"pdf")
        seen = {}
        original_discover = self.module.discover_pdfs
        original_convert = self.module.convert_pdf

        def fake_discover(inputs, source_root=None):
            seen["discover_source_root"] = source_root
            return [pdf.resolve()]

        def fake_convert(pdf_path, *, source_root, output_dir, category=None, source_type=None):
            seen["output_dir"] = output_dir
            return self.module.ConversionResult("skipped", output_dir / "one.md")

        try:
            self.module.discover_pdfs = fake_discover
            self.module.convert_pdf = fake_convert
            status = self.module.main(["--source-root", str(self.sources), str(self.sources)])
        finally:
            self.module.discover_pdfs = original_discover
            self.module.convert_pdf = original_convert

        self.assertEqual(status, 0)
        self.assertEqual(seen["output_dir"], self.sources / "_generated")

    def test_parse_args_accepts_arbitrary_category_and_source_type(self):
        args = self.module.parse_args([
            "sources/고객 A/file.pdf",
            "--category", "임의 분류",
            "--source-type", "submission",
        ])

        self.assertEqual(args.category, "임의 분류")
        self.assertEqual(args.source_type, "submission")


if __name__ == "__main__":
    unittest.main()
