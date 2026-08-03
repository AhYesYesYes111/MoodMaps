from __future__ import annotations

import collections
import json
import re
import statistics
from pathlib import Path


ROOT = Path(__file__).resolve().parent
RAW_PATH = ROOT / "raw" / "survey-workbooks.json"

if not RAW_PATH.is_file():
    raise SystemExit(
        "Missing local survey intermediate. Run "
        "analysis/extract_survey_workbooks.py first; analysis/raw is ignored."
    )


def normalized(value):
    if value is None:
        return None
    text = str(value).strip()
    return None if text in {"", "(空)", "N/A"} else text


workbooks = json.loads(RAW_PATH.read_text(encoding="utf-8"))
numeric_sheet = next(item for item in workbooks if item["encoding"] == "numeric")["sheets"][0]
text_sheet = next(item for item in workbooks if item["encoding"] == "text")["sheets"][0]

numeric_headers, *numeric_rows = numeric_sheet["values"]
text_headers, *text_rows = text_sheet["values"]

numeric_records = [dict(zip(numeric_headers, row)) for row in numeric_rows]
text_records = [dict(zip(text_headers, row)) for row in text_rows]

print(f"numeric_rows={len(numeric_records)} numeric_columns={len(numeric_headers)}")
print(f"text_rows={len(text_records)} text_columns={len(text_headers)}")
print(f"numeric_unique_ids={len({str(row['序号']) for row in numeric_records})}")
print(f"text_unique_ids={len({str(row['序号']) for row in text_records})}")

paired_numeric = {str(row["序号"]): row for row in numeric_records}
paired_text = {str(row["序号"]): row for row in text_records}
common_ids = sorted(set(paired_numeric) & set(paired_text), key=int)
print(f"paired_ids={len(common_ids)}")
print(f"numeric_only_ids={len(set(paired_numeric) - set(paired_text))}")
print(f"text_only_ids={len(set(paired_text) - set(paired_numeric))}")

print("\nTEXT DISTRIBUTIONS")
for index, header in enumerate(text_headers):
    if not str(header).startswith(("1、", "2、", "3、", "4、", "5、", "6、", "7、")):
        continue
    counts = collections.Counter(normalized(row.get(header)) for row in text_records)
    missing = counts.pop(None, 0)
    print(f"\n[{index + 1}] {header}\nmissing={missing}; distinct={len(counts)}")
    for value, count in counts.most_common(20):
        print(f"  {count:>3}  {value}")

print("\nNUMERIC↔TEXT MAPPINGS FOR COMMON HEADERS")
common_headers = [header for header in numeric_headers if header in set(text_headers)]
for header in common_headers:
    if not header.startswith(("1、", "2、", "3、", "4、", "5、", "7、")):
        continue
    mapping = collections.defaultdict(collections.Counter)
    for key in common_ids:
        mapping[normalized(paired_numeric[key].get(header))][
            normalized(paired_text[key].get(header))
        ] += 1
    print(f"\n{header}")
    for numeric_value, text_counts in sorted(mapping.items(), key=lambda item: str(item[0])):
        print(f"  {numeric_value}: {dict(text_counts)}")

print("\nQUALITY")
duration_seconds = []
for row in text_records:
    match = re.search(r"(\d+)", str(row.get("所用时间", "")))
    if match:
        duration_seconds.append(int(match.group(1)))
duration_seconds.sort()
print(f"response_seconds_min={min(duration_seconds)}")
print(f"response_seconds_median={statistics.median(duration_seconds)}")
print(f"response_seconds_max={max(duration_seconds)}")
print(f"response_under_60_seconds={sum(value < 60 for value in duration_seconds)}")
print(f"response_under_90_seconds={sum(value < 90 for value in duration_seconds)}")

source_counts = collections.Counter(normalized(row.get("来源")) for row in text_records)
print(f"sources={dict(source_counts)}")

top_three_header = "6、如果一个订单/驾驶有以下情况，你最在意哪三个？"
selection_counts = collections.Counter()
selection_size_counts = collections.Counter()
for row in text_records:
    selections = [
        item.strip()
        for item in str(row.get(top_three_header, "")).split("┋")
        if item.strip() and item.strip() != "(空)"
    ]
    selection_size_counts[len(selections)] += 1
    selection_counts.update(selections)
print(f"top_three_selection_sizes={dict(sorted(selection_size_counts.items()))}")
print("top_three_selection_rates=")
for value, count in selection_counts.most_common():
    print(f"  {count:>3}  {count / len(text_records):.1%}  {value}")

factor_pairs = [
    ("天气", "3、以下因素对你“是否愿意接单/驾驶”的影响有多大？—天气不好，例如下雨、大雾、暴雨", "天气差"),
    ("周末/节假日", "3、周末/节假日", "周末/节假日"),
    ("拥堵", "3、路线拥堵", "拥堵严重"),
    ("红绿灯", "3、红绿灯太多", "红绿灯多"),
    ("转弯/复杂", "3、转弯太多、路线复杂", "转弯多"),
    ("目的地偏远", "3、目的地偏远", "目的地偏远"),
    ("乘客态度", "3、乘客/顾客评分或态度较差", "乘客/顾客评分或态度较差"),
    ("距离长", "3、路线距离较长", "距离长"),
]
print("factor_summary=")
for label, header, selection_label in factor_pairs:
    values = [float(row[header]) for row in numeric_records]
    high = sum(value >= 4 for value in values) / len(values)
    selected = selection_counts[selection_label] / len(values)
    normalized_mean = (statistics.mean(values) - 1) / 4
    evidence_index = (normalized_mean + selected) / 2
    print(
        f"  {label:<12} mean={statistics.mean(values):.3f} "
        f"high={high:.1%} top3={selected:.1%} evidence={evidence_index:.3f}"
    )

print("weather_by_role=")
weather_header = factor_pairs[0][1]
for role in sorted({row["1、你的身份是？"] for row in text_records}):
    role_ids = {
        str(row["序号"])
        for row in text_records
        if row["1、你的身份是？"] == role
    }
    values = [float(paired_numeric[key][weather_header]) for key in role_ids]
    mood_values = [
        paired_text[key]["4、如果遇到下雨、大雾或暴雨天气，你的接单/驾驶心情通常会怎样？"]
        for key in role_ids
    ]
    worsened = sum(value in {"明显变差", "有一点变差"} for value in mood_values)
    print(
        f"  {role}: n={len(role_ids)} mean={statistics.mean(values):.3f} "
        f"high={sum(value >= 4 for value in values) / len(values):.1%} "
        f"mood_worsened={worsened / len(values):.1%}"
    )

factor_headers = [header for _, header, _ in factor_pairs]
straight_lined = 0
low_variation = 0
for row in numeric_records:
    responses = [row[header] for header in factor_headers]
    distinct = len(set(responses))
    straight_lined += distinct == 1
    low_variation += distinct <= 2
print(f"q3_straight_lined={straight_lined}")
print(f"q3_two_or_fewer_distinct_values={low_variation}")
print(f"first_submit_date={min(row['提交答卷日期'] for row in text_records)}")
print(f"last_submit_date={max(row['提交答卷日期'] for row in text_records)}")
