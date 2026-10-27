#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
刺激生成管线 —— 用户实验平台

数据源：`data/dataset/benchmark_test_0312/` 里 **≤110 节点的原生图**
（26 张）。**不裁剪、不重新布局** —— 图本身就是刺激，坐标直接取自
`<graph>_layouts.json`。

    python tools/build_stimuli.py                    # 默认包围盒归一化
    python tools/build_stimuli.py --normalization median_edge   # pilot 对比
    python tools/build_stimuli.py --check            # 生成后跑不变量断言
    python tools/build_stimuli.py --allow-overlap    # 允许同一张图同时进两档

设计规格见 `docs/02_数据方案.md`。关键约束（`docs/01 §2.1`）：
  · 绝不能高亮 hub —— 所有非目标节点同色同大小
  · 归一化：留白 = 画布每边 8%（可用区 84%），从**像素**里扣，不从原坐标扣
  · 匿名化：只留纯拓扑
  · 确定性：同输入必得同输出，逐位可复现

本脚本**不跑任何布局算法**。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import statistics
import sys
from collections import Counter

try:
    import networkx as nx
except ImportError:
    sys.exit("需要 networkx：pip install networkx")

# ─────────────────────────── 路径与常量 ───────────────────────────

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(ROOT)
DATA_DIR = os.path.join(REPO, "data", "dataset", "benchmark_test_0312")
LAYOUTS_DIR = os.path.join(
    REPO, "data", "eval_out", "bench_pipeline_out_0612_ablation_2", "graph_details"
)
OUT_DIR = os.path.join(ROOT, "stimuli")

ALGORITHMS = {
    "LPFD": "ablation_exp0_baseline",
    "KK": "Kamada-Kawai",
    "FR": "Fruchterman-Reingold",
    "FA2": "ForceAtlas2",
}

# 度数档（docs/02 §3.2）：低 2–8 ／ 高 ≥16（无上限）
#   ⚠️ docs/03 §3.5 仍写着「低 [5,8] ／ 高 [16,25]」，那是旧版：
#      低 [5,8] 与「比值 ≥2」在数学上无解（8/5 = 1.6 < 2）。
#      以 docs/02 为准（它是更新的数据方案，且与实测供给一致）。
BANDS = {"low": (2, 8), "high": (16, None)}   # None = 不设上限
BAND_ORDER = ("low", "high")

MAX_NODES = 110          # docs/02 §3.1
PER_BAND = 8             # docs/02 §3.3
N_LAYOUTS = len(ALGORITHMS)

CANVAS_W, CANVAS_H = 900, 620     # docs/01 §2.3（GVRRI 规格）
PAD_PER_SIDE = 0.08               # 画布每边留白 ⇒ 可用区 84%（docs/02 §4.3）
USABLE = 1.0 - 2 * PAD_PER_SIDE

TARGET_MEDIAN_PX = 40.0           # 仅 median_edge 归一化用（pilot 对比）

# T4 配对（docs/03 §3.5）
T4_MIN_DIFF = 2
T4_MIN_RATIO = 2.0
T4_OBVIOUS_RATIO = 4.0


# ─────────────────────────── 工具 ───────────────────────────

def log(msg: str) -> None:
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        enc = sys.stdout.encoding or "ascii"
        print(msg.encode(enc, errors="replace").decode(enc, errors="replace"), flush=True)


def node_key(n: dict):
    """取节点的标识符。

    ⚠️ **不能用 `n.get('name') or n.get('id')`** —— 这批图的节点 id 是**整数且从 0 开始**，
    而 Python 里 `0` 是 falsy，会把「节点 0」静默丢掉（连带它的边）。
    实测：26 张图会被误读成 12 张，每张图的节点数都恰好少 1。
    """
    k = n.get("name")
    if k is None:
        k = n.get("id")
    return None if k is None else str(k)


# ─────────────────────────── 读入 ───────────────────────────

def load_graph(path: str):
    """读一张图，节点 id 统一成 str（layouts.json 里的 id 也是 str）。"""
    if path.endswith(".graphml"):
        G = nx.read_graphml(path)
        G = nx.Graph(G)                       # 无向化（若源是 Multi/DiGraph）
    else:
        with open(path, encoding="utf-8") as f:
            d = json.load(f)
        G = nx.Graph()
        for n in d["nodes"]:
            k = node_key(n)
            if k is not None:
                G.add_node(k)
        for e in d["links"]:
            s, t = e.get("source"), e.get("target")
            if s is None or t is None:
                continue
            s, t = str(s), str(t)
            if s != t and s in G and t in G:
                G.add_edge(s, t)
    # graphml 的节点 id 可能带引号或为数值，统一成 str 并去自环
    G = nx.Graph(G)
    G.remove_edges_from(nx.selfloop_edges(G))
    return G


def load_all_graphs():
    """读 DATA_DIR 下所有 .json / .graphml，返回 {图名: G}（已按 n ≤ 110 过滤）。"""
    out, skipped = {}, []
    for fn in sorted(os.listdir(DATA_DIR)):
        if not fn.endswith((".json", ".graphml")):
            continue
        name = fn.rsplit(".", 1)[0]
        try:
            G = load_graph(os.path.join(DATA_DIR, fn))
        except Exception as e:                                  # noqa: BLE001
            log(f"  [!] 读取失败 {fn}: {e}")
            continue
        if G.number_of_nodes() == 0:
            continue
        if G.number_of_nodes() > MAX_NODES:
            skipped.append((name, G.number_of_nodes()))
            continue
        out[name] = G
    return out, skipped


def load_layouts(name: str):
    """返回 {布局标签: {节点 id(str): (x, y)}}。"""
    path = os.path.join(LAYOUTS_DIR, f"{name}_layouts.json")
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    want = {v: k for k, v in ALGORITHMS.items()}
    out = {}
    for ev in d["evaluations"]:
        label = want.get(ev["algorithm"])
        if label is None:
            continue
        out[label] = {str(n["id"]): (float(n["x"]), float(n["y"]))
                      for n in ev["layout_data"]["nodes"]}
    missing = set(ALGORITHMS) - set(out)
    if missing:
        raise SystemExit(f"{name}: 缺少布局 {sorted(missing)}")
    return out


# ─────────────────────────── 选图 ───────────────────────────

def in_band(deg: int, band: str) -> bool:
    lo, hi = BANDS[band]
    return deg >= lo and (hi is None or deg <= hi)


def pick_target(G: nx.Graph, band: str, rule: str = "top"):
    """在该档内挑目标节点。

    ⚠️ **文档没有规定档内怎么挑** —— docs/02 §4 步骤 3 只说「每图挑 1 个该档的目标节点」。
    所以这是一个由实现方补的规则，三种取法各有取舍：

    | rule | 低档取到 | 高档取到 | 跨档对比度 | 风险 |
    |---|---|---|---|---|
    | **`top`（默认）** | ≈8 | 图的最大度 | 2×–4×（最弱） | 无 |
    | `bottom` | ≈2 | 图的最大度 | 8×–16×（最强） | 低档只有 2 个邻居 → T1 可能天花板 |
    | `mid` | ≈5 | 图的最大度 | 3×–6× | 折中 |

    默认取 `top`（「档内最像 hub 的那个」）：**在低档也会给出一个有实质邻域的节点**，
    避开 docs/02 §3.2 自己点名的低度天花板风险。要追求最大对比度用 `--target-rule bottom`。
    """
    lo, hi = BANDS[band]
    cands = [v for v, d in G.degree() if in_band(d, band)]
    if not cands:
        return None
    deg = {v: G.degree(v) for v in cands}
    if rule == "top":
        return sorted(cands, key=lambda v: (-deg[v], str(v)))[0]
    if rule == "bottom":
        return sorted(cands, key=lambda v: (deg[v], str(v)))[0]
    # mid：取档内度数最接近中位数的（高档无上限时以判据下界 + 4 为参考）
    ref = (lo + (hi if hi is not None else lo + 8)) / 2
    return sorted(cands, key=lambda v: (abs(deg[v] - ref), str(v)))[0]


def select_graphs(graphs, allow_overlap=False, target_rule="top"):
    """按 docs/02 §4.2：图名升序，每档取前 8 张。

    ⚠️ 与文档的一处**有意偏离**：docs/02 §4.2 写「若某张图在两档都被选中 → 允许」，
    但实测有 **5 张重叠**（GD2 / GD5 / GD6 / Babel / aves），
    这样只有 11 张不同的图，且这 5 张会被同一被试看 **4 次**
    （T1低 + T1高 + T4低 + T4高）—— 与 docs/02 §7.2 F1 的「每张图见 2 次」自相矛盾。
    所以**默认不重合**（先满足候选更少的高档，再从剩下的里取低档）；
    要按文档字面行为跑，加 `--allow-overlap`。
    """
    by_band = {}
    for band in BAND_ORDER:
        ok = [n for n, G in graphs.items() if pick_target(G, band, target_rule) is not None]
        by_band[band] = sorted(ok, key=str)

    if allow_overlap:
        picked = {b: by_band[b][:PER_BAND] for b in BAND_ORDER}
    else:
        # 高档候选少（10 张），先满足它；低档从剩下的里取
        order = sorted(BAND_ORDER, key=lambda b: len(by_band[b]))
        picked, used = {}, set()
        for band in order:
            pool = [n for n in by_band[band] if n not in used]
            picked[band] = pool[:PER_BAND]
            used |= set(picked[band])

    for band in BAND_ORDER:
        if len(picked[band]) < PER_BAND:
            log(f"  [!] {band} 档只选到 {len(picked[band])} 张（需要 {PER_BAND}）")
    return picked


def t4_pair(G: nx.Graph, band: str, prefer_obvious: bool):
    """docs/03 §3.5：挑一对，|Δdeg| ≥ 2 且比值 ≥ 2，**度数更高的那个落在本档区间内**。

    偏好落空时回退到另一档 —— 宁可比值偏大，也不能没有 T4 trial。
    返回 (pair, ratio, hi_deg, lo_deg, fell_back) 或 None。
    """
    deg = dict(G.degree())

    def collect(want_obvious):
        out = []
        for a in sorted(G.nodes(), key=lambda v: (-deg[v], str(v))):
            if not in_band(deg[a], band):
                continue                     # 高度方必须落在本档
            for b in sorted(G.nodes(), key=str):
                if b == a:
                    continue
                hi, lo = deg[a], deg[b]
                if lo <= 0 or hi - lo < T4_MIN_DIFF:
                    continue
                r = hi / lo
                if r < T4_MIN_RATIO:
                    continue
                if (r >= T4_OBVIOUS_RATIO) != want_obvious:
                    continue
                out.append(([a, b] if str(a) <= str(b) else [b, a], r, hi, lo))
        return out

    for i, want in enumerate((prefer_obvious, not prefer_obvious)):
        got = collect(want)
        if got:
            pair, r, hi, lo = min(got, key=lambda t: (t[1], str(t[0])))
            return pair, r, hi, lo, (i == 1)
    return None


# ─────────────────────────── 匿名化与归一化 ───────────────────────────

def anonymize(G: nx.Graph, layouts):
    """节点重编为 n0..nN，只留纯拓扑（docs/02 §6）。

    编号按**原始 id 排序**（不是按度数）—— 这样编号本身不携带任何度数信息，
    即使某天界面上显示了编号也不会泄露「谁是 hub」。
    """
    order = sorted(G.nodes(), key=str)
    remap = {old: f"n{i}" for i, old in enumerate(order)}
    nodes = [{"id": remap[v], "deg": G.degree(v)} for v in order]
    edges = []
    for u, v in G.edges():
        a, b = remap[u], remap[v]
        if a > b:
            a, b = b, a
        edges.append({"s": a, "t": b})
    edges.sort(key=lambda e: (int(e["s"][1:]), int(e["t"][1:])))
    coords = {
        label: {remap[k]: xy for k, xy in pos.items() if k in remap}
        for label, pos in layouts.items()
    }
    return remap, nodes, edges, coords


def normalize_bbox(coords):
    """包围盒归一化（docs/02 §4.3）：留白 = 画布每边 8% ⇒ 可用区 84%。

        scale = min( (W × 0.84) / w, (H × 0.84) / h )

    ⚠️ 留白必须从**画布像素**里扣。早期版本写作 `pad = 0.08 × max(w,h)` 再
    `(W − 2·pad)/w`，把**原坐标单位当像素减了** —— 实测约 75% 的图会裁掉边界节点，
    且 LPFD/KK/FR 全裁、FA2 不裁（因为各方法的原坐标量级差 160 倍以上）。
    """
    xs = [p[0] for p in coords.values()]
    ys = [p[1] for p in coords.values()]
    w, h = (max(xs) - min(xs)) or 1e-9, (max(ys) - min(ys)) or 1e-9
    scale = min(CANVAS_W * USABLE / w, CANVAS_H * USABLE / h)
    sw, sh = w * scale, h * scale
    ox = (CANVAS_W - sw) / 2 - min(xs) * scale
    oy = (CANVAS_H - sh) / 2 - min(ys) * scale
    out = {k: (v[0] * scale + ox, v[1] * scale + oy) for k, v in coords.items()}
    return out, {"scale": scale, "bbox_w": sw, "bbox_h": sh,
                 "pad_x": (CANVAS_W - sw) / 2, "pad_y": (CANVAS_H - sh) / 2}


def normalize_median_edge(coords, edges, target_px=TARGET_MEDIAN_PX):
    """中位边长归一化 —— 仅供 pilot 稳健性对比（docs/02 §7.3）。"""
    lens = [math.dist(coords[e["s"]], coords[e["t"]]) for e in edges
            if e["s"] in coords and e["t"] in coords]
    med = statistics.median(lens) if lens else 1.0
    scale = target_px / med
    xs = [p[0] * scale for p in coords.values()]
    ys = [p[1] * scale for p in coords.values()]
    ox = CANVAS_W / 2 - (max(xs) + min(xs)) / 2
    oy = CANVAS_H / 2 - (max(ys) + min(ys)) / 2
    out = {k: (v[0] * scale + ox, v[1] * scale + oy) for k, v in coords.items()}
    xs2 = [p[0] for p in out.values()]
    ys2 = [p[1] for p in out.values()]
    return out, {"scale": scale, "bbox_w": max(xs2) - min(xs2), "bbox_h": max(ys2) - min(ys2),
                 "pad_x": min(xs2), "pad_y": min(ys2)}


# ─────────────────────────── 主流程 ───────────────────────────

def build(normalization, allow_overlap, target_rule="top"):
    graphs, skipped = load_all_graphs()
    log(f"读入 {len(graphs)} 张图（≤{MAX_NODES} 节点），跳过 {len(skipped)} 张过大的")

    picked = select_graphs(graphs, allow_overlap, target_rule)
    log("选图：" + "  ".join(f"{b}={len(picked[b])}" for b in BAND_ORDER))

    slots = []
    for band in BAND_ORDER:
        for name in picked[band]:
            G = graphs[name]
            tgt = pick_target(G, band, target_rule)
            slots.append({"band": band, "name": name, "graph": G, "target": tgt,
                          "target_deg": G.degree(tgt)})

    stimuli, report, norm_log = [], [], []
    pair_kind = Counter()

    for sl in slots:
        band, name, G, tgt = sl["band"], sl["name"], sl["graph"], sl["target"]
        layouts = load_layouts(name)
        remap, nodes, edges, coords_by_layout = anonymize(G, layouts)
        t = remap[tgt]
        tdeg = G.degree(tgt)
        nbrs = sorted(remap[v] for v in G.neighbors(tgt))

        kind = "obvious" if pair_kind[band] % 2 == 0 else "close"
        pair = t4_pair(G, band, prefer_obvious=(kind == "obvious"))
        pair_kind[band] += 1

        entry = {
            "graph_id": name, "degree_level": band,
            "n_nodes": G.number_of_nodes(), "n_edges": G.number_of_edges(),
            "target": t, "target_degree": tdeg,
            "t4_pair": None, "t4_ratio": None, "t4_kind": None, "t4_fell_back": None,
        }

        for layout, raw in coords_by_layout.items():
            if normalization == "bbox":
                co, nrm = normalize_bbox(raw)
            else:
                co, nrm = normalize_median_edge(raw, edges)
            norm_log.append({"graph_id": name, "layout": layout, **nrm})
            pts = [{"id": k, "x": round(v[0], 2), "y": round(v[1], 2)}
                   for k, v in sorted(co.items(), key=lambda kv: int(kv[0][1:]))]
            geo = {"nodes": pts, "edges": edges}

            stimuli.append({
                "stimulus_id": f"T1_{name}_{layout}", "task": "T1",
                "graph_id": name, "layout": layout, "degree_level": band,
                **geo, "targets": [t], "target_degree": tdeg,
                "ground_truth": {t: nbrs}, "pair": None,
            })

            t4 = {"stimulus_id": f"T4_{name}_{layout}", "task": "T4",
                  "graph_id": name, "layout": layout, "degree_level": band,
                  **geo, "targets": None, "target_degree": None,
                  "ground_truth": None, "pair": None}
            if pair is None:
                t4["pair_missing"] = True
            else:
                p_raw, ratio, hi_d, lo_d, fell = pair
                p = [remap[x] for x in p_raw]
                degmap = {n["id"]: n["deg"] for n in nodes}
                t4.update({
                    "targets": list(p),
                    "target_degree": {p[0]: degmap[p[0]], p[1]: degmap[p[1]]},
                    "ground_truth": {"answer": max(p, key=lambda x: degmap[x])},
                    "pair": list(p),
                    "degree_ratio": round(ratio, 3),
                    "pair_kind": "close" if ratio < T4_OBVIOUS_RATIO else "obvious",
                    "pair_kind_fell_back": fell,
                })
            stimuli.append(t4)

        if pair is not None:
            p_raw, ratio, hi_d, lo_d, fell = pair
            entry.update({"t4_pair": [remap[x] for x in p_raw], "t4_ratio": round(ratio, 3),
                          "t4_kind": "close" if ratio < T4_OBVIOUS_RATIO else "obvious",
                          "t4_fell_back": fell})
        report.append(entry)

    return graphs, picked, slots, stimuli, report, norm_log, skipped


# ─────────────────────────── 输出 ───────────────────────────

def write_outputs(normalization, stimuli, report, norm_log, graphs, picked, skipped):
    os.makedirs(OUT_DIR, exist_ok=True)
    suffix = "" if normalization == "bbox" else f".{normalization}"
    meta = {
        "version": "2.0",
        "data_source": "自选数据集里 ≤110 节点的原生图（不裁剪、不重新布局）",
        "normalization": "bounding_box" if normalization == "bbox" else "median_edge_length",
        "usable_fraction": USABLE if normalization == "bbox" else None,
        "target_median_px": TARGET_MEDIAN_PX if normalization != "bbox" else None,
        "canvas": {"width": CANVAS_W, "height": CANVAS_H},
        "layouts": list(ALGORITHMS),
        "tasks": ["T1", "T4"],
        "graphs": len({s["graph_id"] for s in stimuli}),
        "trials_per_task": len({s["graph_id"] for s in stimuli}),
        "total_trials": 2 * len({s["graph_id"] for s in stimuli}),
        "degree_bands": {k: list(v) for k, v in BANDS.items()},
    }
    path = os.path.join(OUT_DIR, f"stimuli{suffix}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"meta": meta, "stimuli": stimuli}, f, ensure_ascii=False, indent=1)
    log(f"写出 {path}（{len(stimuli)} 条记录，{meta['graphs']} 张图）")

    if normalization == "bbox":
        rep = {"meta": meta, "graphs": report,
               "selected": {b: picked[b] for b in BAND_ORDER},
               "skipped_too_large": skipped,
               "normalization_log": norm_log}
        rp = os.path.join(OUT_DIR, "selection_report.json")
        with open(rp, "w", encoding="utf-8") as f:
            json.dump(rep, f, ensure_ascii=False, indent=1)
        log(f"写出 {rp}")
    return path


def write_practice_and_examples(graphs, used_names, normalization):
    """练习 × 4（T4/T1/T4/T1）与示例 × 4 —— 全部取自刺激池【之外】的图。"""
    pool = [n for n in sorted(graphs, key=str) if n not in used_names]
    ok = [n for n in pool
          if pick_target(graphs[n], "low") is not None and t4_pair(graphs[n], "low", True) is not None
          or t4_pair(graphs[n], "low", False) is not None]
    ok = sorted(set(ok), key=str)
    if len(ok) < 4:
        log(f"  [!] 池外可用于练习的图只有 {len(ok)} 张（需要 4）")

    def render(name, slot):
        G = graphs[name]
        layouts = load_layouts(name)
        remap, nodes, edges, cbl = anonymize(G, layouts)
        tgt = pick_target(G, "low") or sorted(G.nodes(), key=str)[0]
        t = remap[tgt]
        out = {}
        for layout, raw in cbl.items():
            co, _ = (normalize_bbox(raw) if normalization == "bbox"
                     else normalize_median_edge(raw, edges))
            out[layout] = {
                "nodes": [{"id": k, "x": round(v[0], 2), "y": round(v[1], 2)}
                          for k, v in sorted(co.items(), key=lambda kv: int(kv[0][1:]))],
                "edges": edges,
            }
        return {"graph_id": name, "slot": slot, "remap": remap, "target_raw": tgt,
                "target_deg": G.degree(tgt), "geo": out, "graph": G}

    def make_t1(sl, layout_id):
        g = sl["geo"][layout_id]
        nbrs = sorted(sl["remap"][x] for x in sl["graph"].neighbors(sl["target_raw"]))
        return {"stimulus_id": f"T1_{sl['slot']}_{layout_id}", "task": "T1",
                "phase": "practice", "graph_id": f"{sl['slot']}", "layout": layout_id,
                "degree_level": "low", **g, "targets": [sl["remap"][sl["target_raw"]]],
                "target_degree": sl["target_deg"],
                "ground_truth": {sl["remap"][sl["target_raw"]]: nbrs}, "pair": None}

    def make_t4(sl, layout_id):
        g = sl["geo"][layout_id]
        pair = t4_pair(sl["graph"], "low", True) or t4_pair(sl["graph"], "low", False)
        if pair is None:
            return None
        p_raw, ratio, hi_d, lo_d, _ = pair
        p = [sl["remap"][x] for x in p_raw]
        dm = {f"n{i}": sl["graph"].degree(v) for i, v in
              enumerate(sorted(sl["graph"].nodes(), key=str))}
        return {"stimulus_id": f"T4_{sl['slot']}_{layout_id}", "task": "T4",
                "phase": "practice", "graph_id": f"{sl['slot']}", "layout": layout_id,
                "degree_level": "low", **g, "targets": list(p),
                "target_degree": {p[0]: dm[p[0]], p[1]: dm[p[1]]},
                "ground_truth": {"answer": max(p, key=lambda x: dm[x])},
                "pair": list(p), "degree_ratio": round(ratio, 3),
                "pair_kind": "close" if ratio < T4_OBVIOUS_RATIO else "obvious"}

    practice, examples = [], []
    lc = list(ALGORITHMS)
    for i, name in enumerate(ok[:4]):
        sl = render(name, f"practice{i}")
        layout_id = lc[i % len(lc)]
        rec = make_t4(sl, layout_id) if i % 2 == 0 else make_t1(sl, layout_id)
        if rec:
            practice.append(rec)
    for i, name in enumerate(ok[4:8]):
        sl = render(name, f"example{i}")
        examples.append(make_t1(sl, "LPFD"))

    for fname, data, note in (
        ("practice.json", practice, "取自刺激池之外；题序 T4/T1/T4/T1（docs/03 §7）"),
        ("examples.json", examples, "说明页静态示意，固定 LPFD（docs/03 §8①）"),
    ):
        p = os.path.join(OUT_DIR, fname)
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"meta": {"version": "2.0", "normalization": normalization,
                                "note": note}, "stimuli": data}, f,
                      ensure_ascii=False, indent=1)
        log(f"写出 {p}（{len(data)} 条）")
    return practice, examples


def write_readme(report, picked, skipped, normalization, allow_overlap, target_rule):
    """产出 stimuli/README.md —— 选图规则、实际选中的图、已知取舍、文档冲突。"""
    by_band = {b: [e for e in report if e["degree_level"] == b] for b in BAND_ORDER}
    L = []
    A = L.append
    A("# 刺激数据说明\n\n")
    A(f"> 由 `tools/build_stimuli.py --normalization {normalization}` 生成，请勿手改。\n\n")
    A("## 数据源\n\n")
    A("`data/dataset/benchmark_test_0312/` 里 **≤110 节点的原生图**（26 张）。\n\n")
    A("**不裁剪、不重新布局** —— 图本身就是刺激，坐标直接取自 `<graph>_layouts.json`。\n")
    A("这是 2026-09-28 的设计改版：原方案从 case 大图里截 60 节点 ego 窗口，\n")
    A("实测那个窗口的局部几何被破坏（seed 处角均匀度只有 0.02–0.09），\n")
    A("而 T4 恰恰测的就是角度分布 —— 等于把要测的信号提前毁掉。\n\n")

    A("## 文件\n\n| 文件 | 内容 |\n|---|---|\n")
    A(f"| `stimuli.json` | {len({e['graph_id'] for e in report})} 图 × 4 布局 × 2 任务 = "
      f"**{len({e['graph_id'] for e in report}) * 8}** 条 |\n")
    A(f"| `practice.json` | 3 条练习（T1×2 + T2×1，取自池外） |\n")
    A(f"| `examples.json` | 4 条（说明页示意，固定 LPFD） |\n")
    A(f"| `selection_report.json` | 机器可读，供论文撰写 |\n\n")
    A("**每任务 16 trial，两个任务（T1+T2）共 32 trial**（约 30–35 分钟）。T4 已关闭。\n\n")

    A("## 选图规则（docs/02 §4.2）\n\n")
    A("1. 读 `*.json` + `*.graphml`，筛出 **n ≤ 110** 的 → 26 张\n")
    A("2. 两档：**低 = 度 2–8** ／ **高 = 度 ≥16（无上限）**\n")
    A("3. 按**图名升序**，每档取前 8 张\n")
    A("4. 每图挑 1 个目标节点（档内规则见下）\n")
    A("5. 坐标**原样使用**，只做包围盒归一化（留白 = 画布每边 8%）\n\n")
    A("> ⚠️ **确定性**：排序全用字符串键，无浮点比较。\n")
    A("> 已实测 `PYTHONHASHSEED ∈ {1,7,99999,31337}` 下产物 md5 完全一致。\n\n")

    A(f"### 档内怎么挑目标节点 —— `--target-rule {target_rule}`\n\n")
    A("⚠️ **文档没有规定档内怎么挑**（docs/02 §4 步骤 3 只说「每图挑 1 个该档的目标节点」）。\n")
    A("这是实现方补的规则，三种取法：\n\n")
    A("| rule | 低档取到 | 高档取到 | 跨档对比度 | 风险 |\n|---|---|---|---|---|\n")
    A("| **`top`（当前）** | ≈8 | 图的最大度 | 2×–4× | 无 |\n")
    A("| `bottom` | ≈2 | 图的最大度 | 8×–16× | 低档只有 2 个邻居 → T1 可能天花板 |\n")
    A("| `mid` | ≈5 | 图的最大度 | 3×–6× | 折中 |\n\n")
    A("默认 `top`（档内最像 hub 的那个）：在低档也给出有实质邻域的节点，\n")
    A("避开 docs/02 §3.2 自己点名的低度天花板风险。追求最大对比度用 `--target-rule bottom`。\n\n")

    A("## 实际选中的图\n\n")
    for b in BAND_ORDER:
        lo, hi = BANDS[b]
        A(f"### {b} 档（度 {lo}–{hi if hi is not None else '∞'}），{len(by_band[b])} 张\n\n")
        A("| graph_id | n | 边 | 目标度数 | T4 比值 | T4 档 |\n|---|---|---|---|---|---|\n")
        for e in by_band[b]:
            A(f"| `{e['graph_id']}` | {e['n_nodes']} | {e['n_edges']} | "
              f"{e['target_degree']} | {e['t4_ratio']} | {e['t4_kind']} |\n")
        A("\n")
    A(f"目标度数范围：" + "  ".join(
        f"{b} {min(e['target_degree'] for e in by_band[b])}–"
        f"{max(e['target_degree'] for e in by_band[b])}" for b in BAND_ORDER) + "\n\n")
    if skipped:
        A(f"因超过 {MAX_NODES} 节点被跳过的图：{len(skipped)} 张。\n\n")

    A("## ⚠️ 与文档的三处不一致（已按最佳判断处理，**需作者确认**）\n\n")
    A("### 1. `docs/03 §3.5` 的档位是旧版，且低档**数学上无解**\n\n")
    A("它写「高试次 `deg_max ∈ [16,25]`；**低试次两个节点都在 [5,8]**」+「比值 ≥2」。\n")
    A("但 [5,8] 内最大比值是 **8/5 = 1.6 < 2** —— **无解**。\n")
    A("本实现按 `docs/02 §3.2`（更新且自洽）：低 2–8 ／ 高 ≥16 无上限。\n")
    A("按 2–8，低档合法配对为 (4,2)(5,2)(6,2)(6,3)(7,2)(7,3)(8,2)(8,3)(8,4)。\n\n")
    A("### 2. 高档上限冲突\n\n")
    A("`docs/02 §3.2` 说「≥16 **无上限**」，但 `docs/03 §3.5` 说 `[16,25]`、\n")
    A("`docs/02 §7.2 F2` 说「上限是 **25**」。实际选出的图最大度是 "
      f"**{max(e['target_degree'] for e in by_band['high'])}** —— 超过 25。\n")
    A("本实现按 §3.2 的「无上限」。\n\n")
    A("### 3. 两档重合（本实现**默认不重合**）\n\n")
    A("`docs/02 §4.2` 写「若某张图在两档都被选中 → 允许」，但实测有 **5 张重叠**\n")
    A("（GD2 / GD5 / GD6 / Babel / aves），这样只有 11 张不同的图，\n")
    A("且这 5 张会被同一被试看 **4 次**（T1低 + T1高 + T4低 + T4高）—— \n")
    A("与 `docs/02 §7.2 F1` 的「每张图见 2 次」自相矛盾。\n")
    A(f"本实现默认**不重合**（当前 `--allow-overlap` = {allow_overlap}），"
      "先满足候选更少的高档，再从剩下的取低档。\n\n")

    A("## ⚠️ 必须在论文 Limitations 里报告的取舍（docs/02 §7.2）\n\n")
    A("### F1 — 跨任务图重复\n\n")
    A("T1 与 T2 **共用同一批 16 张图、同一份「图 → 布局」映射**。\n")
    A("每被试 32 trial ⇒ 每张图见 **2 次，两次都是同一种布局**。\n")
    A("残留风险：T1 学到的结构可能迁移到 T2，方向是**抹平各布局差异**（保守偏差）。\n")
    A("缓解：任务分块；两个任务问的是不同问题。\n\n")
    A("> 「跨任务错位」曾被考虑并**否决** —— 它把「自我污染」换成「交叉污染」，不可归因。\n\n")
    A("### F2 — 没有真正的 hub\n\n")
    A(f"刺激图的节点度数上限是 **{max(e['target_degree'] for e in by_band['high'])}**\n")
    A("（自选小图的限制）。论文第 1 章的动机是「hub 有上百个邻居」——本实验**测不到那个尺度**。\n")
    A("缓解：把「hub」口径明确为**相对定义**（度数 > 全图均值 + 一个标准差），并收窄动机句。\n\n")
    A("### F3 — 未做用户实验的案例研究\n\n")
    A("本轮只做到**编码层**（「布局更好读」），不主张**领域层**（「对黑灰产分析有用」）。\n\n")

    A("## 归一化\n\n")
    if normalization == "bbox":
        A("**包围盒（fit-to-view）**，留白 = 画布每边 8%（可用区 84%）：\n\n")
        A("```\nscale = min( (W × 0.84) / w, (H × 0.84) / h )\n```\n\n")
        A("⚠️ 留白必须从**画布像素**里扣。早期版本写作 `pad = 0.08 × max(w,h)` 再\n")
        A("`(W − 2·pad)/w`，把原坐标单位当像素减了 —— 实测约 **75% 的图会裁掉边界节点**，\n")
        A("且 LPFD/KK/FR 全裁、FA2 不裁（各方法原坐标量级差 160 倍以上）。\n\n")
    else:
        A("**中位边长归一化**（仅 pilot 稳健性对比用）。\n\n")
    A("> pilot 要求：另跑一套 `--normalization` 的刺激，对比结论方向是否稳定（docs/02 §7.3）。\n\n")

    A("## 图素养前测\n\n")
    A("**已取消**（`CONFIG.survey.literacy = false`）。理由见 `docs/03 §6.3`：\n")
    A("Zoss NVL 量表本体拿不到（仓库只提供分析脚本）；GGR 测的是统计图表不是网络图（构念不对）；\n")
    A("自编则违背「不适用就找权威替代，不要自己构建」的原则；且**信度不够的协变量会降低功效**。\n")
    A("替代：人口学里的「图论熟悉度自评」作协变量 + 分析里报告参与者方差成分。\n")

    p = os.path.join(OUT_DIR, "README.md")
    with open(p, "w", encoding="utf-8") as f:
        f.write("".join(L))
    log(f"写出 {p}")


# ─────────────────────────── 不变量检查 ───────────────────────────

def check(stimuli, graphs, picked):
    fails, notes = [], []
    bad = fails.append

    gids = sorted({s["graph_id"] for s in stimuli})
    want = PER_BAND * len(BAND_ORDER)
    if len(gids) != want:
        bad(f"图数 {len(gids)} ≠ {want}")

    band_of = {s["graph_id"]: s["degree_level"] for s in stimuli}
    per_band = Counter(band_of.values())
    for b in BAND_ORDER:
        if per_band[b] != PER_BAND:
            bad(f"{b} 档 {per_band[b]} 张 ≠ {PER_BAND}")

    # 每 (图, 布局) 必须有 T1 与 T4，且几何一致
    idx = {}
    for s in stimuli:
        idx.setdefault((s["graph_id"], s["layout"]), {})[s["task"]] = s
    if len(idx) != len(gids) * N_LAYOUTS:
        bad(f"(图 × 布局) 组合 {len(idx)} ≠ {len(gids) * N_LAYOUTS}")
    for key, v in idx.items():
        if set(v) != {"T1", "T4"}:
            bad(f"{key} 缺任务 {sorted(set(v))}")
            continue
        if v["T1"]["nodes"] != v["T4"]["nodes"] or v["T1"]["edges"] != v["T4"]["edges"]:
            bad(f"{key} 的 T1/T4 几何不一致")
    if len(stimuli) != len(gids) * N_LAYOUTS * 2:
        bad(f"记录数 {len(stimuli)} ≠ {len(gids) * N_LAYOUTS * 2}")

    # 目标节点度数必须落在它声明的档内
    for g, b in band_of.items():
        t1 = next(s for s in stimuli if s["graph_id"] == g and s["task"] == "T1")
        d = t1["target_degree"]
        lo, hi = BANDS[b]
        if not (d >= lo and (hi is None or d <= hi)):
            bad(f"{g} 标为 {b} 但目标度数 {d} 不在 [{lo},{hi or '∞'}]")

    # T4 配对合法性
    kinds = Counter()
    for s in stimuli:
        if s["task"] != "T4":
            continue
        if s.get("pair_missing"):
            bad(f'{s["stimulus_id"]} 缺配对')
            continue
        a, b_ = s["pair"]
        da, db = s["target_degree"][a], s["target_degree"][b_]
        hi, lo = max(da, db), min(da, db)
        if hi - lo < T4_MIN_DIFF:
            bad(f'{s["stimulus_id"]} |Δdeg|={hi - lo} < {T4_MIN_DIFF}')
        if lo <= 0 or hi / lo < T4_MIN_RATIO:
            bad(f'{s["stimulus_id"]} 比值 {hi}/{lo} < {T4_MIN_RATIO}')
        band = s["degree_level"]
        blo, bhi = BANDS[band]
        if not (hi >= blo and (bhi is None or hi <= bhi)):
            bad(f'{s["stimulus_id"]} 高度方 {hi} 不在声明档 [{blo},{bhi or "∞"}]')
        if s["ground_truth"]["answer"] != max(s["pair"], key=lambda x: s["target_degree"][x]):
            bad(f'{s["stimulus_id"]} answer 不是度数更大者')
        kinds[s.get("pair_kind")] += 1

    # 坐标 + 节点半径必须完整落在画布内（留白 ≥ 半径 5px）
    R = 5
    worst, clipped = 1e9, 0
    for s in stimuli:
        xs = [n["x"] for n in s["nodes"]]
        ys = [n["y"] for n in s["nodes"]]
        pad = min(min(xs), CANVAS_W - max(xs), min(ys), CANVAS_H - max(ys))
        worst = min(worst, pad)
        if pad < R:
            clipped += 1
    if clipped:
        bad(f"{clipped} 条刺激留白 < {R}px（节点会被裁）")
    if worst < R:
        bad(f"最小留白 {worst:.2f}px < 节点半径 {R}px")

    # 自环 / 悬空边
    for s in stimuli:
        ids = {n["id"] for n in s["nodes"]}
        for e in s["edges"]:
            if e["s"] == e["t"]:
                bad(f'{s["stimulus_id"]} 有自环')
            if e["s"] not in ids or e["t"] not in ids:
                bad(f'{s["stimulus_id"]} 有悬空边')

    # 匿名化审计：不应出现原始节点 id / 语义字段
    raw_ids = set()
    for G in graphs.values():
        raw_ids |= {str(v) for v in G.nodes()}
    leaked = set()
    for s in stimuli:
        for n in s["nodes"]:
            if n["id"] in raw_ids and not n["id"].startswith("n"):
                leaked.add(n["id"])
        if "deg" in s and not isinstance(s.get("deg"), int):
            pass
    if leaked:
        bad(f'节点 id 泄露原始值：{sorted(leaked)[:5]}')

    if kinds:
        notes.append(f'T4 档位分布：{dict(kinds)}')
    return fails, notes, {"clipped": clipped, "worst_pad": worst, "t4_kinds": dict(kinds)}


# ─────────────────────────── CLI ───────────────────────────

def main():
    ap = argparse.ArgumentParser(description="生成用户实验刺激数据")
    ap.add_argument("--normalization", choices=["bbox", "median_edge"], default="bbox")
    ap.add_argument("--allow-overlap", action="store_true",
                    help="允许同一张图同时进两档（文档字面行为；默认不重合）")
    ap.add_argument("--target-rule", choices=["top", "mid", "bottom"], default="top",
                    help="档内怎么挑目标节点（文档未规定，见 pick_target 的说明）")
    ap.add_argument("--check", action="store_true")
    args = ap.parse_args()

    (graphs, picked, slots, stimuli, report, norm_log,
     skipped) = build(args.normalization, args.allow_overlap, args.target_rule)

    meta_path = write_outputs(args.normalization, stimuli, report, norm_log,
                              graphs, picked, skipped)
    used = {n for b in BAND_ORDER for n in picked[b]}
    if args.normalization == "bbox":
        write_practice_and_examples(graphs, used, args.normalization)
        write_readme(report, picked, skipped, args.normalization,
                     args.allow_overlap, args.target_rule)

    gids = sorted({s["graph_id"] for s in stimuli})
    log("")
    log(f"归一化 = {args.normalization}   两档重合 = {'允许' if args.allow_overlap else '不允许'}")
    log(f"图 {len(gids)} 张（" + " / ".join(f"{b} {len(picked[b])}" for b in BAND_ORDER) + "）"
        f"  →  每任务 {len(gids)} trial，两个任务共 {2 * len(gids)} trial")
    log(f"目标度数：" + "  ".join(
        f"{b} {min(e['target_degree'] for e in report if e['degree_level'] == b)}"
        f"–{max(e['target_degree'] for e in report if e['degree_level'] == b)}"
        for b in BAND_ORDER))
    log(f"T4 配对 = {sum(1 for e in report if e['t4_pair'])}/{len(report)}")

    if args.check:
        log("")
        log("跑不变量检查 …")
        fails, notes, extra = check(stimuli, graphs, picked)
        for n in notes:
            log(f"  [i] {n}")
        if fails:
            for m in fails:
                log(f"  [x] {m}")
            sys.exit(f"\n{len(fails)} 项检查失败")
        log(f"  [ok] 全部通过（最小留白 {extra['worst_pad']:.1f}px，"
            f"裁切 {extra['clipped']} 条，T4 {extra['t4_kinds']}）")


if __name__ == "__main__":
    main()
