#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成实验编号 + 分派 offset。

    python tools/make_codes.py --n 40 --group remote --prefix R
    python tools/make_codes.py --n 20 --group lab    --prefix L   # 可多次运行，累加

产出两份：
  stimuli/codes.json      ← **随站点部署**，App 用它校验编号并取 offset
  codes_roster.csv        ← **只留本地**，你的花名册（.gitignore 已排除）

为什么 offset 要预先分派而不是运行时算：
  运行时算（hash % 4）在小样本下会偏斜 —— 实测 20 人可能得到 7/1/4/8，
  某个布局少一半样本。预先按 0,1,2,3 轮转，**均衡是确定的**。
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import string
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "stimuli")
CODES_PATH = os.path.join(OUT_DIR, "codes.json")
ROSTER_PATH = os.path.join(ROOT, "codes_roster.csv")

# 去掉容易看错的字符：I O 0 1
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
N_LAYOUTS = 4

# 各组别允许的前缀字母（避免 L/R 撞到随机体里）
PREFIXES = {"lab": "L", "remote": "R"}


def load_existing():
    if not os.path.exists(CODES_PATH):
        return {}
    with open(CODES_PATH, encoding="utf-8") as f:
        d = json.load(f)
    return d.get("codes", {})


def next_offset(codes):
    """下一个可用的 offset —— 让**全部编号**整体按 0,1,2,3 轮转。

    这样无论把实验室和远程合并分析、还是分开分析，分布都是均衡的。
    """
    n = len(codes)
    return n % N_LAYOUTS


def gen_code(prefix: str, taken: set) -> str:
    while True:
        body = "".join(random.choice(ALPHABET) for _ in range(4))
        code = f"{prefix}{body}"
        if code not in taken:
            return code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, required=True, help="新增多少个编号")
    ap.add_argument("--group", choices=["lab", "remote"], default="remote")
    ap.add_argument("--prefix", default=None, help="编号前缀，默认 lab→L / remote→R")
    ap.add_argument("--seed", type=int, default=None, help="固定随机种子（可复现）")
    args = ap.parse_args()

    if args.seed is not None:
        random.seed(args.seed)

    prefix = args.prefix or PREFIXES[args.group]
    codes = load_existing()
    taken = set(codes)

    added = []
    for _ in range(args.n):
        code = gen_code(prefix, taken)
        taken.add(code)
        off = next_offset(codes)
        codes[code] = {"offset": off, "group": args.group}
        added.append((code, off))

    os.makedirs(OUT_DIR, exist_ok=True)
    payload = {
        "meta": {
            "version": "1.0",
            "generated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "n_codes": len(codes),
            "layouts_per_offset": N_LAYOUTS,
        },
        "codes": dict(sorted(codes.items())),
    }
    with open(CODES_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)

    # 花名册：保留已有的 assigned_to，不覆盖
    roster = {}
    if os.path.exists(ROSTER_PATH):
        with open(ROSTER_PATH, encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                roster[row["code"]] = row
    for code, meta in codes.items():
        roster.setdefault(code, {"code": code, "group": meta["group"],
                                 "offset": meta["offset"], "assigned_to": ""})
    with open(ROSTER_PATH, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["code", "group", "offset", "assigned_to"])
        w.writeheader()
        for code in sorted(roster):
            w.writerow(roster[code])

    # 汇总
    from collections import Counter
    dist = Counter(v["offset"] for v in codes.values())
    grp = Counter(v["group"] for v in codes.values())
    print(f"新增 {len(added)} 个编号（{args.group}），当前共 {len(codes)} 个")
    print(f"  offset 分布: {dict(sorted(dist.items()))}")
    print(f"  组别分布:   {dict(grp)}")
    print(f"  编号表:     {CODES_PATH}   ← 随站点部署")
    print(f"  花名册:     {ROSTER_PATH}   ← 只留本地")
    print()
    print("新编号预览:", ", ".join(c for c, _ in added[:8]) + (" …" if len(added) > 8 else ""))


if __name__ == "__main__":
    main()
