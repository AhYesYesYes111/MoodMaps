# Survey analysis

The repository publishes only aggregate survey evidence. Row-level inputs stay
in the ignored `analysis/raw/` directory and are never part of a release. The
extractor removes IP addresses, exact submission times, source details, and
free-text responses before creating that local intermediate, but the remaining
answer combinations can still be identifying and must not be committed.

Create an isolated environment and install the declared dependencies:

```bash
python3 -m venv .venv-analysis
source .venv-analysis/bin/activate
python -m pip install -r analysis/requirements.txt
```

Extract two local exports without embedding machine-specific paths in code:

```bash
python analysis/extract_survey_workbooks.py \
  --numeric /private/path/to/numeric.xlsx \
  --text /private/path/to/text.xlsx
```

Then rebuild and run the notebook:

```bash
python analysis/build_survey_notebook.py
jupyter nbconvert --to notebook --execute --inplace \
  analysis/moodmaps_survey_calibration.ipynb
python analysis/report/validate_report_queries.py
```

The same environment can regenerate the checked-in website handoff document:

```bash
python build_moodmaps_web_brief.py
```

Only `survey-factor-summary.csv`, `proposed-model-weights.csv`,
`survey-model-evidence.json`, the executed notebook, and derived reports should
be published. Do not publish the original workbooks or anything under
`analysis/raw/`.
