from __future__ import annotations

import argparse
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "analysis" / "raw" / "survey-workbooks.json"

DROP_HEADERS = {
    "来源详情",
    "来自IP",
}
FREE_TEXT_PREFIX = "8、"
TIMESTAMP_HEADER = "提交答卷时间"
DATE_HEADER = "提交答卷日期"


def coarse_date(value: object) -> str | None:
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value is None:
        return None
    match = re.search(r"(\d{4})[/-](\d{1,2})[/-](\d{1,2})", str(value))
    if not match:
        return None
    year, month, day = (int(part) for part in match.groups())
    return date(year, month, day).isoformat()


def json_value(value: object) -> object:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value


def sanitize_values(values: list[list[object]]) -> list[list[object]]:
    if not values:
        return values

    headers = [str(value or "") for value in values[0]]
    retained = [
        index
        for index, header in enumerate(headers)
        if header not in DROP_HEADERS and not header.startswith(FREE_TEXT_PREFIX)
    ]
    sanitized_headers = [
        DATE_HEADER if headers[index] == TIMESTAMP_HEADER else headers[index]
        for index in retained
    ]
    sanitized: list[list[object]] = [sanitized_headers]

    for row in values[1:]:
        sanitized_row: list[object] = []
        for index in retained:
            value = row[index] if index < len(row) else None
            sanitized_row.append(
                coarse_date(value)
                if headers[index] == TIMESTAMP_HEADER
                else json_value(value)
            )
        sanitized.append(sanitized_row)
    return sanitized


def read_workbook(source: Path, encoding: str) -> dict[str, Any]:
    workbook = load_workbook(source, read_only=True, data_only=True)
    sheets: list[dict[str, Any]] = []
    try:
        for sheet in workbook.worksheets:
            rows = [list(row) for row in sheet.iter_rows(values_only=True)]
            while rows and not any(value is not None for value in rows[-1]):
                rows.pop()
            sheets.append(
                {
                    "name": sheet.title,
                    "values": sanitize_values(rows),
                }
            )
    finally:
        workbook.close()
    return {
        "encoding": encoding,
        "sourceFile": source.name,
        "sheets": sheets,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Extract the paired MoodMaps survey workbooks while removing IPs, "
            "exact timestamps, source details, and free-text responses."
        )
    )
    parser.add_argument("--numeric", required=True, type=Path)
    parser.add_argument("--text", required=True, type=Path)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    inputs = (
        ("numeric", args.numeric.expanduser().resolve()),
        ("text", args.text.expanduser().resolve()),
    )
    missing = [str(source) for _, source in inputs if not source.is_file()]
    if missing:
        raise SystemExit("Missing survey workbook(s): " + ", ".join(missing))

    extracted = [
        read_workbook(source, encoding) for encoding, source in inputs
    ]
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(
        json.dumps(extracted, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    summary = {
        workbook["encoding"]: {
            sheet["name"]: {
                "rows": max(0, len(sheet["values"]) - 1),
                "columns": len(sheet["values"][0]) if sheet["values"] else 0,
            }
            for sheet in workbook["sheets"]
        }
        for workbook in extracted
    }
    print(json.dumps({"output": str(output), "summary": summary}, ensure_ascii=False))


if __name__ == "__main__":
    main()
