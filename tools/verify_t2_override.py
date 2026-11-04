#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
重建前后差异审计：确认 --t2-overrides 只改了目标 T2 配对。

    python tools/verify_t2_override.py \
        --before data/sealed/2026-11-04_pre_t2_override/stimuli.json \
        --after  stimuli/stimuli.json \
        --overrides stimuli/t2_overrides_pilot6.json

规则：
  · 未覆盖的刺激记录必须逐字段完全相同。
  · 被覆盖的 (graph_id, pair index) 只允许下列字段变化：
    pair / targets / target_degree / ground_truth / degree_ratio
    其余字段（stimulus_id, task, graph_id, layout, degree_level, nodes, edges）必须不变。
  · 被覆盖的配对在四种布局里必须写成同一组节点。
  · meta 除 t2_overrides 外必须一致。

退出码：0 = 通过；1 = 有差异。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys

LAYOUTS = ["LPFD", "KK", "FR", "FA2"]
T2_ID_RE = re.compile(r"_p(\d+)_(" + "|".join(map(re.escape, LAYOUTS)) + r")$")
ALLOWED_CHANGED = {"pair", "targets", "target_degree", "ground_truth", "degree_ratio"}


def load_json(path):
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except OSError as e:
        sys.exit(f"无法读取 {path}：{e}")
    try:
        return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        sys.exit(f"{path} 不是合法 UTF-8 JSON：{e}")


def as_stimuli(doc):
    if isinstance(doc, dict):
        return doc.get("stimuli", [])
    if isinstance(doc, list):
        return doc
    sys.exit("stimuli 文件结构不对：既不是 {meta, stimuli} 也不是数组")


def parse_t2_id(stimulus_id):
    m = T2_ID_RE.search(str(stimulus_id))
    return (int(m.group(1)), m.group(2)) if m else None


def main():
    ap = argparse.ArgumentParser(description="审计 T2 覆盖重建的差异")
    ap.add_argument("--before", required=True, help="重建前的 stimuli.json")
    ap.add_argument("--after", required=True, help="重建后的 stimuli.json")
    ap.add_argument("--overrides", required=True, help="覆盖 JSON")
    args = ap.parse_args()

    before_doc, h_before = load_json(args.before)
    after_doc, h_after = load_json(args.after)
    ov_doc, h_ov = load_json(args.overrides)

    before = as_stimuli(before_doc)
    after = as_stimuli(after_doc)
    bmap = {s["stimulus_id"]: s for s in before}
    amap = {s["stimulus_id"]: s for s in after}

    fails = []

    def bad(msg):
        fails.append(msg)

    if set(bmap) != set(amap):
        missing = sorted(set(bmap) - set(amap))[:5]
        added = sorted(set(amap) - set(bmap))[:5]
        bad(f"刺激 id 集合变化：缺少 {missing}，新增 {added}")

    pairs = ov_doc.get("pairs")
    if not isinstance(pairs, list):
        sys.exit("覆盖文件的 pairs 不是数组")
    overrides = {}
    for e in pairs:
        key = (e.get("graph_id"), e.get("index"))
        if key in overrides:
            bad(f"覆盖文件重复条目：{key}")
        overrides[key] = e

    # 覆盖条目必须都能在 after 里找到四布局记录
    for (graph_id, idx), e in overrides.items():
        found = []
        for layout in LAYOUTS:
            sid = f"T2_{graph_id}_p{idx}_{layout}"
            if sid in amap:
                found.append(amap[sid])
        if len(found) != 4:
            bad(f"{graph_id} p{idx}: 只找到 {len(found)} 个布局记录")
            continue
        for s in found:
            if s.get("pair") != e.get("pair"):
                bad(f'{s["stimulus_id"]}: pair={s.get("pair")} ≠ 覆盖值 {e.get("pair")}')
            if s.get("targets") != e.get("pair"):
                bad(f'{s["stimulus_id"]}: targets 与覆盖配对不一致')

    for sid in sorted(bmap):
        b = bmap[sid]
        a = amap.get(sid)
        if a is None:
            continue
        parsed = parse_t2_id(sid)
        key = (b.get("graph_id"), parsed[0]) if parsed else None
        in_override = bool(key and key in overrides)
        if not in_override:
            if b != a:
                changed = sorted(k for k in set(b) | set(a) if b.get(k) != a.get(k))
                bad(f"{sid}: 未覆盖的记录被改动（{changed}）")
            continue

        for k in b:
            if k not in a:
                bad(f"{sid}: 字段 {k} 被删除")
            elif k not in ALLOWED_CHANGED and b[k] != a[k]:
                bad(f"{sid}: 不允许变化的字段 {k} 被改动")
        for k in a:
            if k not in b:
                bad(f"{sid}: 新增字段 {k}")

        exp = overrides[key].get("pair")
        if a.get("pair") != exp:
            bad(f"{sid}: pair 不是覆盖值")
        if a.get("targets") != exp:
            bad(f"{sid}: targets 不是覆盖值")
        td = a.get("target_degree")
        if not isinstance(td, dict) or set(td) != set(exp or []):
            bad(f"{sid}: target_degree 的键不是覆盖配对")
        ans = (a.get("ground_truth") or {}).get("answer")
        if ans not in (exp or []):
            bad(f"{sid}: ground_truth.answer 不在覆盖配对里")

    # meta 除 t2_overrides 外应一致
    bmeta = before_doc.get("meta") if isinstance(before_doc, dict) else None
    ameta = after_doc.get("meta") if isinstance(after_doc, dict) else None
    if bmeta is not None and ameta is not None:
        b2 = {k: v for k, v in bmeta.items() if k != "t2_overrides"}
        a2 = {k: v for k, v in ameta.items() if k != "t2_overrides"}
        if b2 != a2:
            changed = sorted(k for k in set(b2) | set(a2) if b2.get(k) != a2.get(k))
            bad(f"meta 除 t2_overrides 外被改动（{changed}）")
        if ameta.get("t2_overrides") is None:
            bad("after.meta 缺少 t2_overrides 审计信息")

    print(f"before : {args.before}  sha256={h_before}")
    print(f"after  : {args.after}  sha256={h_after}")
    print(f"override: {args.overrides}  sha256={h_ov}")
    print(f"覆盖条目: {len(overrides)}；记录数: {len(bmap)} → {len(amap)}")

    if fails:
        print(f"\n{len(fails)} 项差异：")
        for m in fails:
            print(f"  [x] {m}")
        sys.exit(1)
    print("\n[ok] 只改动了目标 T2 配对，其余记录与 meta 不变。")


if __name__ == "__main__":
    main()
