#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地开发服务器。

    python tools/serve.py            # 然后打开 http://127.0.0.1:8000/src/?pid=PILOT01
    python tools/serve.py --port 8080

为什么不直接用 `python -m http.server`：
  Windows 上 mimetypes 会读注册表，把 .js 映射成 text/plain，
  浏览器对 <script type="module"> 做严格 MIME 检查 → 直接报
  "Expected a JavaScript-or-Wasm module script but the server responded with text/plain"。
  这里显式钉住 MIME 类型，跨平台一致。

必须用服务器而不是直接双击 index.html：App 要 fetch stimuli.json，
file:// 下会被 CORS 拦掉（App 里对此有专门的错误提示）。
"""

import argparse
import functools
import http.server
import mimetypes
import os
import sys

# 显式钉住 —— 不依赖系统 registry
for ext, mime in {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".html": "text/html",
    ".svg": "image/svg+xml",
}.items():
    mimetypes.add_type(mime, ext)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 本地开发：禁用缓存，改完刷新就能看到
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    def send_head(self):
        """去掉 Last-Modified，从而**不会**回 304。

        SimpleHTTPRequestHandler 默认会按 If-Modified-Since 回 304 Not Modified，
        浏览器于是继续用本地缓存的那份（可能是上一次用别的服务器拿到的、
        Content-Type 为 text/plain 的副本）—— 会出现「改了服务器却仍报 MIME 错」
        这种非常难查的现象。开发服务器不需要协商缓存。
        """
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None
        try:
            fs = os.fstat(f.fileno())
            ctype = self.guess_type(path)
            self.send_response(200)
            self.send_header("Content-type", ctype)
            self.send_header("Content-Length", str(fs[6]))
            self.end_headers()
            return f
        except Exception:
            f.close()
            raise

    def log_message(self, fmt, *args):
        # 只报错，不刷屏
        if args and str(args[1]).startswith(("4", "5")):
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--dir", default=None,
                    help="服务根目录，默认是整个项目根（App 在 src/ 下）")
    args = ap.parse_args()

    root = args.dir or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)

    handler = functools.partial(Handler, directory=root)
    # 必须用 ThreadingHTTPServer：ES module 图会并发发起多个请求，
    # 单线程的 TCPServer 会让连接在 backlog 里被拒（ERR_CONNECTION_REFUSED），
    # 表现为「有些模块加载失败、随机报错」。
    with http.server.ThreadingHTTPServer((args.host, args.port), handler) as httpd:
        httpd.daemon_threads = True
        url = f"http://{args.host}:{args.port}/src/?pid=PILOT01"
        print(f"服务根目录：{root}")
        print(f"打开：{url}")
        print("Ctrl-C 停止")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n已停止")


if __name__ == "__main__":
    main()
