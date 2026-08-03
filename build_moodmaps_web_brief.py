from pathlib import Path

from docx import Document
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT, WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_BREAK
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "MoodMaps_网站项目介绍与网页制作Brief.docx"

# launch_messaging_guide preset (compact_reference_guide base)
# Named bilingual compatibility override for the macOS/LibreOffice render path.
FONT = "Arial Unicode MS"
CJK_FONT = "Arial Unicode MS"
INK = "17212B"
NAVY = "17324D"
BLUE = "2E74B5"
DARK_BLUE = "1F4D78"
MUTED = "66717C"
PALE_BLUE = "E8EEF5"
PALE_GRAY = "F2F4F7"
CALLOUT = "F4F6F9"
WHITE = "FFFFFF"
TABLE_WIDTH_DXA = 9360
TABLE_INDENT_DXA = 120


def set_cell_text(cell, text, *, bold=False, color=INK, size=10.5, align=None):
    p = cell.paragraphs[0]
    if align is not None:
        p.alignment = align
    p.paragraph_format.space_before = Pt(0)
    p.paragraph_format.space_after = Pt(0)
    p.paragraph_format.line_spacing = 1.15
    r = p.add_run(text)
    set_run(r, size=size, color=color, bold=bold)
    cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER


def set_run(run, *, size=10.5, color=INK, bold=False, italic=False, font=FONT):
    selected_font = (
        CJK_FONT
        if any("\u3400" <= character <= "\u9fff" for character in run.text)
        else font
    )
    run.font.name = selected_font
    run._element.get_or_add_rPr().rFonts.set(qn("w:ascii"), selected_font)
    run._element.get_or_add_rPr().rFonts.set(qn("w:hAnsi"), selected_font)
    run._element.get_or_add_rPr().rFonts.set(qn("w:eastAsia"), selected_font)
    run.font.size = Pt(size)
    run.font.color.rgb = RGBColor.from_string(color)
    run.bold = bold
    run.italic = italic


def set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def shade_cell(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def set_cell_margins(cell, top=80, start=120, bottom=80, end=120):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    tc_mar = tc_pr.first_child_found_in("w:tcMar")
    if tc_mar is None:
        tc_mar = OxmlElement("w:tcMar")
        tc_pr.append(tc_mar)
    for tag, value in (("top", top), ("start", start), ("bottom", bottom), ("end", end)):
        node = tc_mar.find(qn(f"w:{tag}"))
        if node is None:
            node = OxmlElement(f"w:{tag}")
            tc_mar.append(node)
        node.set(qn("w:w"), str(value))
        node.set(qn("w:type"), "dxa")


def set_table_geometry(table, widths_dxa, *, indent=TABLE_INDENT_DXA):
    table.autofit = False
    table.alignment = WD_TABLE_ALIGNMENT.LEFT
    tbl = table._tbl
    tbl_pr = tbl.tblPr
    layout = tbl_pr.find(qn("w:tblLayout"))
    if layout is None:
        layout = OxmlElement("w:tblLayout")
        tbl_pr.append(layout)
    layout.set(qn("w:type"), "fixed")

    tbl_w = tbl_pr.find(qn("w:tblW"))
    if tbl_w is None:
        tbl_w = OxmlElement("w:tblW")
        tbl_pr.append(tbl_w)
    tbl_w.set(qn("w:w"), str(sum(widths_dxa)))
    tbl_w.set(qn("w:type"), "dxa")

    tbl_ind = tbl_pr.find(qn("w:tblInd"))
    if tbl_ind is None:
        tbl_ind = OxmlElement("w:tblInd")
        tbl_pr.append(tbl_ind)
    tbl_ind.set(qn("w:w"), str(indent))
    tbl_ind.set(qn("w:type"), "dxa")

    grid = tbl.tblGrid
    for child in list(grid):
        grid.remove(child)
    for width in widths_dxa:
        col = OxmlElement("w:gridCol")
        col.set(qn("w:w"), str(width))
        grid.append(col)

    for row in table.rows:
        tr_pr = row._tr.get_or_add_trPr()
        cant_split = tr_pr.find(qn("w:cantSplit"))
        if cant_split is None:
            cant_split = OxmlElement("w:cantSplit")
            tr_pr.append(cant_split)
        cant_split.set(qn("w:val"), "true")
        for idx, cell in enumerate(row.cells):
            width = widths_dxa[min(idx, len(widths_dxa) - 1)]
            tc_pr = cell._tc.get_or_add_tcPr()
            tc_w = tc_pr.find(qn("w:tcW"))
            if tc_w is None:
                tc_w = OxmlElement("w:tcW")
                tc_pr.append(tc_w)
            tc_w.set(qn("w:w"), str(width))
            tc_w.set(qn("w:type"), "dxa")
            set_cell_margins(cell)


def add_page_field(paragraph):
    run = paragraph.add_run()
    fld_char_begin = OxmlElement("w:fldChar")
    fld_char_begin.set(qn("w:fldCharType"), "begin")
    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = "PAGE"
    fld_char_end = OxmlElement("w:fldChar")
    fld_char_end.set(qn("w:fldCharType"), "end")
    run._r.extend([fld_char_begin, instr_text, fld_char_end])
    set_run(run, size=8.5, color=MUTED)


def configure_numbering(doc):
    numbering = doc.part.numbering_part.element
    abstract_ids = [int(x.get(qn("w:abstractNumId"))) for x in numbering.findall(qn("w:abstractNum"))]
    num_ids = [int(x.get(qn("w:numId"))) for x in numbering.findall(qn("w:num"))]

    def create(kind, abstract_id, num_id):
        abstract = OxmlElement("w:abstractNum")
        abstract.set(qn("w:abstractNumId"), str(abstract_id))
        multi = OxmlElement("w:multiLevelType")
        multi.set(qn("w:val"), "singleLevel")
        abstract.append(multi)
        lvl = OxmlElement("w:lvl")
        lvl.set(qn("w:ilvl"), "0")
        start = OxmlElement("w:start")
        start.set(qn("w:val"), "1")
        lvl.append(start)
        num_fmt = OxmlElement("w:numFmt")
        num_fmt.set(qn("w:val"), "bullet" if kind == "bullet" else "decimal")
        lvl.append(num_fmt)
        lvl_text = OxmlElement("w:lvlText")
        lvl_text.set(qn("w:val"), "•" if kind == "bullet" else "%1.")
        lvl.append(lvl_text)
        suff = OxmlElement("w:suff")
        suff.set(qn("w:val"), "tab")
        lvl.append(suff)
        p_pr = OxmlElement("w:pPr")
        tabs = OxmlElement("w:tabs")
        tab = OxmlElement("w:tab")
        tab.set(qn("w:val"), "num")
        tab.set(qn("w:pos"), "540")
        tabs.append(tab)
        p_pr.append(tabs)
        ind = OxmlElement("w:ind")
        ind.set(qn("w:left"), "540")
        ind.set(qn("w:hanging"), "270")
        p_pr.append(ind)
        spacing = OxmlElement("w:spacing")
        spacing.set(qn("w:after"), "80")
        spacing.set(qn("w:line"), "300")
        spacing.set(qn("w:lineRule"), "auto")
        p_pr.append(spacing)
        lvl.append(p_pr)
        r_pr = OxmlElement("w:rPr")
        fonts = OxmlElement("w:rFonts")
        fonts.set(qn("w:ascii"), FONT)
        fonts.set(qn("w:hAnsi"), FONT)
        fonts.set(qn("w:eastAsia"), CJK_FONT)
        r_pr.append(fonts)
        lvl.append(r_pr)
        abstract.append(lvl)
        numbering.append(abstract)

        num = OxmlElement("w:num")
        num.set(qn("w:numId"), str(num_id))
        abstract_ref = OxmlElement("w:abstractNumId")
        abstract_ref.set(qn("w:val"), str(abstract_id))
        num.append(abstract_ref)
        numbering.append(num)

    next_abstract = max(abstract_ids or [0]) + 1
    next_num = max(num_ids or [0]) + 1
    create("bullet", next_abstract, next_num)
    create("decimal", next_abstract + 1, next_num + 1)
    create("decimal", next_abstract + 2, next_num + 2)
    return next_num, next_num + 1, next_num + 2


def apply_numbering(paragraph, num_id):
    p_pr = paragraph._p.get_or_add_pPr()
    num_pr = p_pr.find(qn("w:numPr"))
    if num_pr is None:
        num_pr = OxmlElement("w:numPr")
        p_pr.append(num_pr)
    ilvl = OxmlElement("w:ilvl")
    ilvl.set(qn("w:val"), "0")
    num = OxmlElement("w:numId")
    num.set(qn("w:val"), str(num_id))
    num_pr.extend([ilvl, num])


def add_list_item(doc, text, num_id, *, bold_prefix=None):
    p = doc.add_paragraph(style="Normal")
    apply_numbering(p, num_id)
    p.paragraph_format.space_after = Pt(4)
    p.paragraph_format.line_spacing = 1.2
    if bold_prefix and text.startswith(bold_prefix):
        r1 = p.add_run(bold_prefix)
        set_run(r1, bold=True)
        r2 = p.add_run(text[len(bold_prefix):])
        set_run(r2)
    else:
        r = p.add_run(text)
        set_run(r)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_paragraph(text, style=f"Heading {level}")
    p.paragraph_format.keep_with_next = True
    return p


def add_body(doc, text, *, bold_prefix=None, italic=False):
    p = doc.add_paragraph(style="Normal")
    if bold_prefix and text.startswith(bold_prefix):
        r1 = p.add_run(bold_prefix)
        set_run(r1, bold=True)
        r2 = p.add_run(text[len(bold_prefix):])
        set_run(r2, italic=italic)
    else:
        r = p.add_run(text)
        set_run(r, italic=italic)
    return p


def add_kicker(doc, text):
    p = doc.add_paragraph(style="Kicker")
    r = p.add_run(text.upper())
    set_run(r, size=9, color=BLUE, bold=True)
    return p


def add_callout(doc, label, text):
    p = doc.add_paragraph(style="Callout")
    p_pr = p._p.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:fill"), CALLOUT)
    p_pr.append(shd)
    borders = OxmlElement("w:pBdr")
    left = OxmlElement("w:left")
    left.set(qn("w:val"), "single")
    left.set(qn("w:sz"), "18")
    left.set(qn("w:space"), "8")
    left.set(qn("w:color"), BLUE)
    borders.append(left)
    p_pr.append(borders)
    r1 = p.add_run(label + "  ")
    set_run(r1, size=10.5, color=NAVY, bold=True)
    r2 = p.add_run(text)
    set_run(r2, size=10.5, color=INK)
    return p


def add_copy_block(doc, label, text):
    p = doc.add_paragraph(style="Copy Block")
    r1 = p.add_run(label + "\n")
    set_run(r1, size=8.5, color=BLUE, bold=True)
    r2 = p.add_run(text)
    set_run(r2, size=10.5, color=INK)
    return p


def page_break(doc):
    p = doc.add_paragraph()
    p.add_run().add_break(WD_BREAK.PAGE)


doc = Document()
section = doc.sections[0]
section.page_width = Inches(8.5)
section.page_height = Inches(11)
section.top_margin = Inches(0.82)
section.bottom_margin = Inches(0.78)
section.left_margin = Inches(1.0)
section.right_margin = Inches(1.0)
section.header_distance = Inches(0.42)
section.footer_distance = Inches(0.42)

styles = doc.styles
normal = styles["Normal"]
normal.font.name = FONT
normal._element.rPr.rFonts.set(qn("w:ascii"), FONT)
normal._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
normal._element.rPr.rFonts.set(qn("w:eastAsia"), CJK_FONT)
normal.font.size = Pt(10.5)
normal.font.color.rgb = RGBColor.from_string(INK)
normal.paragraph_format.space_before = Pt(0)
normal.paragraph_format.space_after = Pt(6)
normal.paragraph_format.line_spacing = 1.2

for level, size, color, before, after in (
    (1, 16, BLUE, 18, 10),
    (2, 13, BLUE, 14, 7),
    (3, 12, DARK_BLUE, 10, 5),
):
    style = styles[f"Heading {level}"]
    style.font.name = FONT
    style._element.rPr.rFonts.set(qn("w:ascii"), FONT)
    style._element.rPr.rFonts.set(qn("w:hAnsi"), FONT)
    style._element.rPr.rFonts.set(qn("w:eastAsia"), CJK_FONT)
    style.font.size = Pt(size)
    style.font.bold = True
    style.font.color.rgb = RGBColor.from_string(color)
    style.paragraph_format.space_before = Pt(before)
    style.paragraph_format.space_after = Pt(after)
    style.paragraph_format.keep_with_next = True

for name in ("Kicker", "Callout", "Copy Block", "Small Note"):
    if name not in styles:
        styles.add_style(name, 1)

styles["Kicker"].paragraph_format.space_before = Pt(0)
styles["Kicker"].paragraph_format.space_after = Pt(5)
styles["Kicker"].paragraph_format.keep_with_next = True
styles["Callout"].paragraph_format.space_before = Pt(8)
styles["Callout"].paragraph_format.space_after = Pt(12)
styles["Callout"].paragraph_format.left_indent = Inches(0.12)
styles["Callout"].paragraph_format.right_indent = Inches(0.08)
styles["Callout"].paragraph_format.line_spacing = 1.2
styles["Copy Block"].paragraph_format.space_before = Pt(4)
styles["Copy Block"].paragraph_format.space_after = Pt(9)
styles["Copy Block"].paragraph_format.left_indent = Inches(0.15)
styles["Copy Block"].paragraph_format.right_indent = Inches(0.1)
styles["Copy Block"].paragraph_format.line_spacing = 1.15

bullet_num_id, decimal_num_id, blueprint_num_id = configure_numbering(doc)

# Running header / footer, customer_pack pattern without decorative rule.
header = section.header
hp = header.paragraphs[0]
hp.alignment = WD_ALIGN_PARAGRAPH.LEFT
hp.paragraph_format.space_after = Pt(0)
hr = hp.add_run("MOODMAPS  |  WEBSITE HANDOFF BRIEF")
set_run(hr, size=8.5, color=MUTED, bold=True)

footer = section.footer
fp = footer.paragraphs[0]
fp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
fp.paragraph_format.space_before = Pt(0)
fr = fp.add_run("MoodMaps Project Brief  ·  ")
set_run(fr, size=8.5, color=MUTED)
add_page_field(fp)

# Page 1: title and handoff summary.
doc.add_paragraph().paragraph_format.space_after = Pt(16)
add_kicker(doc, "Portfolio project · Product & engineering handoff")
title = doc.add_paragraph()
title.paragraph_format.space_before = Pt(0)
title.paragraph_format.space_after = Pt(7)
tr = title.add_run("MoodMaps")
set_run(tr, size=31, color=NAVY, bold=True)
subtitle = doc.add_paragraph()
subtitle.paragraph_format.space_before = Pt(0)
subtitle.paragraph_format.space_after = Pt(18)
sr = subtitle.add_run("网站项目介绍与网页制作 Brief")
set_run(sr, size=15, color=MUTED)

meta = doc.add_table(rows=4, cols=2)
meta.style = "Table Grid"
meta_data = [
    ("项目类型", "Chrome Manifest V3 扩展 / Human-centered navigation tool"),
    ("当前版本", "v1.2.1 · Chrome desktop · Driving routes"),
    ("交付对象", "负责制作个人网站项目页的 Agent"),
    ("文档目的", "说明项目是什么、为什么做、如何工作，以及网页必须展示什么"),
]
for idx, (label, value) in enumerate(meta_data):
    shade_cell(meta.rows[idx].cells[0], PALE_BLUE)
    set_cell_text(meta.rows[idx].cells[0], label, bold=True, color=NAVY)
    set_cell_text(meta.rows[idx].cells[1], value)
set_table_geometry(meta, [1900, 7460])

add_heading(doc, "给网页 Agent 的一句话任务", 1)
add_callout(
    doc,
    "核心任务",
    "把 MoodMaps 介绍成一个从真实问题、第一手调研、可解释模型到浏览器产品落地的完整项目，而不仅仅是一张 Chrome 插件截图。",
)

add_heading(doc, "项目一句话", 2)
add_copy_block(
    doc,
    "中文推荐文案",
    "MoodMaps 是一个嵌入 Google Maps、Apple Maps、Waze 和高德地图的 Chrome 扩展。它不只告诉用户哪条路线最快，还通过可解释的 Mood Score 帮助用户比较哪条路线可能开起来更轻松。",
)
add_copy_block(
    doc,
    "English ready-to-use copy",
    "MoodMaps is a Chrome extension that adds explainable route-calmness scores directly to Google Maps, Apple Maps, Waze, and Amap, helping drivers compare not only which route is fastest, but which one may feel lighter to drive.",
)

add_heading(doc, "网页必须传达的四件事", 2)
for text in (
    "这是一个真正嵌入用户现有地图工作流的产品，而不是独立路线计算器。",
    "Mood Score 是可解释的加权模型，用户能看到每个因素和最终公式。",
    "模型参考了 209 份一手问卷，而不是凭感觉随意设定。",
    "项目同时体现产品设计、数据分析、前端工程、浏览器扩展和隐私判断。",
):
    add_list_item(doc, text, bullet_num_id)

# Product story.
add_kicker(doc, "01 · Product story")
add_heading(doc, "我做了一个什么东西", 1)
add_body(
    doc,
    "MoodMaps 是一个桌面端 Chrome 扩展。用户先在受支持地图中正常输入起点和终点、选择驾车路线；MoodMaps 随后自动读取当前路线卡片，并把 Mood Score 直接放在每条路线旁边。用户无需在插件里重复输入地址，也不需要离开地图。",
)
add_body(
    doc,
    "它解决的问题是：传统导航主要优化时间和距离，但“最快”不一定等于“开起来最舒服”。严重拥堵、额外延误、复杂并线、长时间驾驶和恶劣天气都会影响驾驶体验。MoodMaps 把这些因素组织成一个透明的路线舒适度估算，让用户看见时间与心理负担之间的取舍。",
)

add_heading(doc, "核心产品主张", 2)
add_copy_block(doc, "Primary tagline", "Choose the road that feels lighter.")
add_copy_block(doc, "Supporting line", "Route calmness, explained.")

add_heading(doc, "典型用户流程", 2)
steps = [
    "用户在 Google Maps、Apple Maps、Waze 或高德地图中规划一条驾车路线。",
    "扩展自动识别起点、终点和当前地图显示的多个候选路线。",
    "每条路线卡片出现一个紧凑的 Mood Score，不遮挡原生时间、距离或操作按钮。",
    "用户点击分数，地图上弹出该路线的计算明细。",
    "用户点击浏览器工具栏图标，可查看选中路线、其他路线和完整模型说明。",
]
for step in steps:
    add_list_item(doc, step, decimal_num_id)

add_heading(doc, "用户能看到什么", 2)
for text in (
    "地图路线卡上可见的真实路线名称，例如 via I-95 N，而不是抽象的 main roads。",
    "0-100 Mood Score 与 Very Calm、Calm、Balanced、Stressful、Very Stressful 标签。",
    "Fastest、Balanced choice、Calmest option 等路线角色。",
    "Traffic、Delay、Complexity、Duration、Weather 五项压力输入及其实际有效权重。",
    "100 - weighted stress = Mood Score 的完整、可读公式。",
):
    add_list_item(doc, text, bullet_num_id)

add_heading(doc, "产品边界", 2)
add_body(
    doc,
    "MoodMaps 不是导航替代品，不提供转向指令，也不声称判断“最安全路线”。它是一个实验性的 route comfort estimate，用于帮助用户理解路线条件，而不是医疗、心理健康或交通安全结论。",
)

# Page 3: features and scoring.
add_kicker(doc, "02 · Features & model")
add_heading(doc, "核心功能", 1)
features = [
    ("地图原生嵌入：", "分数直接出现在四个受支持地图的现有路线卡片中，位置跟随时间和距离栏。"),
    ("自动分析：", "路线卡片加载完成后自动运行，不要求用户再点 Analyze。"),
    ("无闪烁加载：", "先保留稳定占位，再平滑更新分数，避免突然弹出和页面跳动。"),
    ("路线级解释：", "点击任意分数即可查看该路线各项压力、权重、贡献值和公式。"),
    ("统一弹窗：", "工具栏弹窗展示当前路线、其他候选路线和自动展开的模型说明。"),
    ("路线级原因：", "每条路线显示二至四条可理解的比较原因，并可展开查看输入、权重、贡献值和公式。"),
    ("缺失数据保护：", "某个因素不可用时不会被当作 0 压力，而是退出分母，剩余权重自动重平衡。"),
]
for prefix, detail in features:
    add_list_item(doc, prefix + detail, bullet_num_id, bold_prefix=prefix)

add_heading(doc, "Mood Score V2", 1)
add_body(
    doc,
    "模型先把每个路线条件转换为 0-100 的压力值，再计算加权平均；最终用 100 减去路线压力，得到越高越平静的 Mood Score。模型是确定性的：相同输入应产生相同输出，增加拥堵或疲劳不会提高分数。",
)

weights = doc.add_table(rows=1, cols=4)
weights.style = "Table Grid"
headers = ["因素", "基础权重", "主要信号", "网页解释方式"]
for idx, header_text in enumerate(headers):
    shade_cell(weights.rows[0].cells[idx], PALE_BLUE)
    set_cell_text(weights.rows[0].cells[idx], header_text, bold=True, color=NAVY, align=WD_ALIGN_PARAGRAPH.CENTER)
rows = [
    ("Traffic", "32%", "可靠路段数据优先；否则用可见拥堵、ETA 或相对速度代理", "拥堵和慢行带来的压力"),
    ("Delay", "20%", "当前时间相对基准时间", "不可预期的额外时间损失"),
    ("Complexity", "20%", "可靠 maneuver 数据优先；否则用路线名称结构代理", "可见道路结构复杂度（不是转弯次数）"),
    ("Duration", "12%", "总驾驶时间", "持续驾驶造成的疲劳负担"),
    ("Weather", "16%", "Open-Meteo 当前天气", "降水、能见度、阵风和体感温度"),
]
for row_data in rows:
    cells = weights.add_row().cells
    for idx, value in enumerate(row_data):
        set_cell_text(cells[idx], value, align=WD_ALIGN_PARAGRAPH.CENTER if idx == 1 else WD_ALIGN_PARAGRAPH.LEFT)
set_repeat_table_header(weights.rows[0])
set_table_geometry(weights, [1700, 1200, 3300, 3160])

add_heading(doc, "核心公式", 2)
add_copy_block(
    doc,
    "Model",
    "Route Stress = Σ (available stress × effective weight)\nMood Score = 100 - Route Stress",
)
add_body(
    doc,
    "当前版本不采集或计算驾驶者状态；最终 Mood Score 就是 Route Calmness。缺失因素退出分母，其余可用权重自动重平衡。",
)

add_heading(doc, "一手研究基础", 2)
add_body(
    doc,
    "我收集并分析了 209 份关于路线条件、接单意愿和心情影响的问卷。数字版和文本版 Excel 是同一批回答的两种编码，按回答序号配对，不能重复计算为 418 份。",
)
for text in (
    "73.2% 的受访者把严重拥堵选入最重要的三个因素。",
    "60.3% 把恶劣天气选入最重要的三个因素。",
    "72.2% 表示雨、雾或暴风天气会让心情有所或明显变差。",
    "只有 8.6% 把长距离选入前三，因此模型保留较小的 Duration 权重，而不是强烈惩罚里程。",
):
    add_list_item(doc, text, bullet_num_id)
add_body(
    doc,
    "网页应把这部分描述为“survey-informed”或“research-informed”，不要写成经过科学证明、因果验证或适用于所有司机。",
    italic=True,
)

# Page 4: webpage blueprint and ready copy.
add_kicker(doc, "03 · Website blueprint")
add_heading(doc, "建议网页结构", 1)
blueprint = [
    ("Hero", "项目名、tagline、Chrome extension 定位和一张真实受支持地图产品截图。"),
    ("Problem", "解释为什么 fastest route 不一定是 easiest route。"),
    ("Product walkthrough", "用 3-5 步展示规划路线、出现分数、点击解释、比较路线。"),
    ("Mood Score model", "展示五个因素、权重、公式和缺失数据重平衡。"),
    ("Research", "展示 n=209 问卷、三个关键百分比和“保守校准”的方法。"),
    ("Engineering", "说明 Manifest V3、React/TypeScript、content script、service worker、Open-Meteo 和自动测试。"),
    ("Responsible design", "说明隐私、本地存储、无账号和产品边界。"),
    ("Reflection / Next steps", "说明真实交通 API、用户反馈校准和移动端不是当前范围。"),
]
for title_text, detail in blueprint:
    add_list_item(doc, title_text + "：" + detail, blueprint_num_id, bold_prefix=title_text + "：")

add_heading(doc, "Hero 推荐文案", 2)
add_copy_block(doc, "Eyebrow", "HUMAN-CENTERED NAVIGATION · CHROME EXTENSION")
add_copy_block(doc, "Title", "MoodMaps")
add_copy_block(doc, "Tagline", "Choose the road that feels lighter.")
add_copy_block(
    doc,
    "English summary",
    "MoodMaps adds explainable route-calmness scores directly to Google Maps, Apple Maps, Waze, and Amap. It helps drivers compare traffic stress, delay, route complexity, duration, and weather without leaving the navigation workflow they already use.",
)
add_copy_block(
    doc,
    "Chinese summary",
    "MoodMaps 把可解释的路线舒适度分数直接加入 Google Maps、Apple Maps、Waze 和高德地图，让用户在熟悉的导航流程中比较拥堵、延误、路线复杂度、时长和天气，而不只是选择最快路线。",
)

add_heading(doc, "Problem / Solution 推荐文案", 2)
add_copy_block(
    doc,
    "Problem",
    "Navigation tools are optimized for arrival time. But a route that saves five minutes can still feel worse if it includes heavier congestion, unpredictable delay, complex maneuvers, or difficult weather.",
)
add_copy_block(
    doc,
    "Solution",
    "MoodMaps translates those route conditions into a transparent 0-100 Mood Score and places the result next to each supported map route. Every score can be opened and inspected instead of being presented as a black box.",
)

add_heading(doc, "Research 推荐文案", 2)
add_copy_block(
    doc,
    "Research statement",
    "The scoring model was conservatively informed by 209 first-hand survey responses about how route conditions affect drivers' and couriers' willingness and mood. Congestion and weather emerged as the strongest observable signals, while distance alone was less consistently important.",
)

add_heading(doc, "Portfolio framing", 2)
add_body(
    doc,
    "这个页面应突出 end-to-end ownership：从提出问题、设计问卷、清洗两份 Excel、建立权重、实现扩展、反复修正 UI 位置和闪烁，到浏览器实测与打包发布。它是产品思考、研究判断和工程执行的结合。",
)

# Page 5: visual and technical handoff.
add_kicker(doc, "04 · Visual & technical handoff")
add_heading(doc, "网页需要准备的视觉素材", 1)
visuals = [
    ("Hero screenshot：", "受支持地图的路线栏同时显示多条路线，Mood Score 与时间和距离栏对齐。"),
    ("Interaction detail：", "点击路线分数后出现“How this score was calculated”的地图内浮层。"),
    ("Popup screenshot：", "黑白简约的 MoodMaps 工具栏弹窗，显示选中路线、公式、五项因素和其他路线。"),
    ("Model graphic：", "Traffic 32%、Delay 20%、Complexity 20%、Duration 12%、Weather 16%的简洁权重图。"),
    ("Research graphic：", "n=209，并突出 73.2% congestion、60.3% weather、72.2% weather worsened mood。"),
    ("Flow graphic：", "Plan in a supported map → Read visible route details → Calculate Mood Score → Compare routes。"),
]
for prefix, detail in visuals:
    add_list_item(doc, prefix + detail, bullet_num_id, bold_prefix=prefix)

add_heading(doc, "视觉方向", 2)
for text in (
    "以黑白、浅灰和少量深绿/深蓝为主，延续当前插件的克制感。",
    "不要使用过多渐变、霓虹或情绪化插画；重点是地图、路线和透明计算。",
    "截图中优先展示真实路线名称和多个不同分数，避免所有路线同分。",
    "网页动效应轻量：淡入、内容平滑更新、hover 展示解释；避免强烈弹跳。",
):
    add_list_item(doc, text, bullet_num_id)

add_heading(doc, "当前技术结构", 1)
tech = [
    ("Extension platform：", "Chrome Manifest V3，支持 Chrome 116+。"),
    ("Interface：", "React + TypeScript + Vite 的工具栏 popup。"),
    ("Map integration：", "Content script 通过 URL、语义 DOM 和各地图的最小结构识别路线，找不到高置信数据时停止分析。"),
    ("Background logic：", "Service worker 负责分析、天气请求、session cache 和本地设置。"),
    ("Weather：", "坐标优先；仅在明确为城市/地区级文本时使用 Open-Meteo geocoding，再查询当前天气。15 分钟 session cache，失败时安全降级。"),
    ("Scoring：", "确定性 TypeScript 模型，显示有效权重和每项贡献。"),
    ("Quality：", "Vitest 单元测试、TypeScript strict checking、生产构建检查和真实 Chrome 场景验证。"),
]
for prefix, detail in tech:
    add_list_item(doc, prefix + detail, bullet_num_id, bold_prefix=prefix)

add_heading(doc, "隐私与轻量化", 2)
for text in (
    "不要求登录或创建账号。",
    "扩展只在用户主动规划的受支持地图驾车路线中运行。",
    "不收集浏览历史、cookie、广告标识，也不上传完整地图 DOM。",
    "天气查询优先使用地图提供的端点坐标；无法取得坐标或明确的城市/地区时直接跳过天气。",
    "短期天气缓存不保存完整地址，过期数据会主动删除。",
):
    add_list_item(doc, text, bullet_num_id)

# Page 6: guardrails, status, checklist.
add_kicker(doc, "05 · Messaging guardrails & delivery checklist")
add_heading(doc, "网页可以说什么", 1)
for text in (
    "Estimated route calmness / route comfort estimate / experimental Mood Score。",
    "Research-informed by 209 first-hand survey responses。",
    "Explainable and deterministic weighted scoring。",
    "Integrated directly into supported map route-selection experiences。",
    "Independent project; not affiliated with or endorsed by Google。",
):
    add_list_item(doc, text, bullet_num_id)

add_heading(doc, "网页不要说什么", 1)
for text in (
    "不要称它为“最安全路线”或声称能避免事故。",
    "不要声称 Mood Score 是心理健康、医学或疲劳诊断。",
    "不要把调查写成科学因果证明或代表所有司机。",
    "不要声称插件获取了地图平台的私有交通数据；当前交通是基于页面可见信号的估算。",
    "不要声称 Weather 永远可用；网络或定位失败时模型会重新分配权重。",
):
    add_list_item(doc, text, bullet_num_id)

add_heading(doc, "当前版本状态", 2)
add_body(
    doc,
    "当前可展示版本为 v1.2.1。它已实现四个地图平台的路线卡片嵌入、自动分析、可见路线名称、地图内解释浮层、工具栏详细页、比较原因、问卷校准模型、Open-Meteo 当前天气和缺失数据重平衡。",
)
add_body(
    doc,
    "当前本地模式不调用 Google API。Traffic 优先使用页面可见的拥堵文字或 ETA 相对 without-traffic time；这些都没有时，至少两条具有可见时间和距离的路线可产生相对速度代理。Complexity 使用可识别道路名称与出口、并线等文字线索形成固定代理值，不声称是真实转弯次数。Delay 只比较可见路线时长，避免重复计分；信号确实不足时相应因素仍会退出模型。FastAPI 目录只用于研究和 demo，不是生产数据来源。",
)

add_heading(doc, "建议展示的下一步", 2)
for text in (
    "在四个受支持地图上持续验证可见路线信号、语言和 DOM 变化。",
    "收集用户对预测分数与真实驾驶感受的路线级反馈。",
    "继续校准不同职业、城市和天气环境下的权重。",
    "探索移动端或其他地图产品，但保持隐私和解释性优先。",
):
    add_list_item(doc, text, bullet_num_id)

add_heading(doc, "网页 Agent 完成交付前检查", 1)
checks = [
    "Hero 在第一屏明确出现 Chrome extension、四个受支持地图和 Mood Score。",
    "至少使用一张真实路线卡片截图和一张计算明细截图。",
    "完整说明五个评分因素与基础权重。",
    "明确展示 n=209，但同时保留 survey-informed 的限制说明。",
    "展示从 research → model → interface → testing 的完整过程。",
    "保留 not safety / not medical / not affiliated with Google 的说明。",
    "当前数据来源写准确：supported-map visible route details + optional Open-Meteo current weather。",
    "移动端页面中截图与文字不溢出，分数和路线名称仍清晰可读。",
]
for check in checks:
    add_list_item(doc, check, bullet_num_id)

add_heading(doc, "项目资料索引", 2)
for text in (
    "README.md + docs/ - 项目总览、产品范围、评分公式、隐私和发布材料；extension/src - 当前 Chrome extension 实现。",
    "analysis/moodmaps_survey_calibration.ipynb + 聚合 CSV/JSON - 209 份问卷的聚合分析与质量检查；逐行中间数据不发布。",
):
    add_list_item(doc, text, bullet_num_id)

doc.core_properties.title = "MoodMaps 网站项目介绍与网页制作 Brief"
doc.core_properties.subject = "Portfolio website handoff brief for MoodMaps"
doc.core_properties.author = "MoodMaps Project"
doc.core_properties.keywords = "MoodMaps, Chrome extension, route calmness, Mood Score, portfolio"
doc.save(OUTPUT)
print(OUTPUT)
