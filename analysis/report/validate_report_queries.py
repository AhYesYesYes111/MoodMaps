import csv
import json
import sqlite3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPORT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parent


connection = sqlite3.connect(":memory:")
with (ROOT / "survey-factor-summary.csv").open(
    encoding="utf-8-sig", newline=""
) as handle:
    factor_rows = list(csv.DictReader(handle))
connection.execute(
    "CREATE TABLE factor_summary (rank INTEGER, factor TEXT, mean_impact REAL, "
    "ci_low REAL, ci_high REAL, high_impact_share REAL, top_three_share REAL, "
    "evidence_index REAL, sample_size INTEGER)"
)
connection.executemany(
    "INSERT INTO factor_summary VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
        [
            index,
            row["因素"],
            row["平均影响(1-5)"],
            row["均值95%CI下限"],
            row["均值95%CI上限"],
            row["高影响占比"],
            row["进入前三占比"],
            row["问卷证据指数"],
            209,
        ]
        for index, row in enumerate(factor_rows, start=1)
    ],
)

with (ROOT / "proposed-model-weights.csv").open(
    encoding="utf-8-sig", newline=""
) as handle:
    weight_rows = list(csv.DictReader(handle))
connection.execute(
    "CREATE TABLE model_weights (component TEXT, weight REAL, fallback_weight REAL, "
    "observable TEXT, reason TEXT)"
)
connection.executemany(
    "INSERT INTO model_weights VALUES (?, ?, ?, ?, ?)",
    [
        [
            row["模型项"],
            row["权重"],
            row["仅天气缺失时有效权重"],
            row["主要数据"],
            row["理由"],
        ]
        for row in weight_rows
    ],
)

factor_result = connection.execute(
    (REPORT / "factor_summary.sql").read_text(encoding="utf-8")
).fetchall()
weight_result = connection.execute(
    (REPORT / "model_weights.sql").read_text(encoding="utf-8")
).fetchall()

assert len(factor_result) == 8
assert factor_result[0][1] == "拥堵"
assert len(weight_result) == 5
assert weight_result[0][0] == "交通强度"

artifact_path = REPORT / "artifact.json"
artifact = json.loads(artifact_path.read_text(encoding="utf-8"))
manifest = artifact["manifest"]
snapshot = artifact["snapshot"]
source_ids = {source["id"] for source in manifest["sources"]}
assert len(source_ids) == len(manifest["sources"])
for block in manifest["blocks"]:
    if "sourceId" in block:
        assert block["sourceId"] in source_ids

factor_snapshot = snapshot["datasets"]["factor_summary"]
weight_snapshot = snapshot["datasets"]["model_weights"]
assert [row["factor"] for row in factor_snapshot] == [
    row[1] for row in factor_result
]
snapshot_weights = {
    row["component"]: float(row["weight"]) for row in weight_snapshot
}
query_weights = {row[0]: float(row[1]) for row in weight_result}
assert snapshot_weights == query_weights

html = (REPORT / "moodmaps-model-report.html").read_text(encoding="utf-8")
for forbidden in (
    "Google Weather API current conditions documentation",
    "Google Maps Platform core services pricing",
    "GOOGLE_WEATHER_ENABLED",
    "按序号和提交时间配对",
):
    assert forbidden not in artifact_path.read_text(encoding="utf-8")
    assert forbidden not in html
assert "MoodMaps Open-Meteo current-weather implementation" in html
assert "相对速度代理" in artifact_path.read_text(encoding="utf-8")
assert "路线名称结构代理" in artifact_path.read_text(encoding="utf-8")
assert "相对速度代理" in html
assert "路线名称结构代理" in html
for stale_copy in (
    "可靠慢行/拥堵路段占比；缺失时退出模型",
    "可靠 maneuver 密度；缺失时退出模型",
    "通常只使用 Delay、Duration 和可选 Weather",
):
    assert stale_copy not in artifact_path.read_text(encoding="utf-8")
    assert stale_copy not in html

legacy_row_level_export = ROOT / "survey-workbooks.json"
assert not legacy_row_level_export.exists()
gitignore = (WORKSPACE / ".gitignore").read_text(encoding="utf-8").splitlines()
assert "analysis/raw/" in gitignore
assert "analysis/survey-workbooks.json" in gitignore
notebook = json.loads(
    (ROOT / "moodmaps_survey_calibration.ipynb").read_text(encoding="utf-8")
)
notebook_source = "\n".join(
    "".join(cell.get("source", [])) for cell in notebook["cells"]
)
assert 'ROOT / "analysis" / "raw" / "survey-workbooks.json"' in notebook_source

print(
    "Report validation passed: 8 factor rows, 5 model-weight rows, "
    "resolved sources, aggregate-only publication, and synchronized "
    "no-key weather and visible Traffic/Complexity proxy copy."
)
