#!/usr/bin/env python3
"""Crawl every route once: status, console errors, overflow, key metrics."""
import json, os, sys, re

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SITE", "http://localhost:3000")
ROOT = "/Users/hao/WebstormProjects/web_tools"


def slugs():
    txt = open(os.path.join(ROOT, "devkit/app/data/tools.ts"), encoding="utf-8").read()
    return re.findall(r"slug: '([^']+)'", txt)


def cats():
    txt = open(os.path.join(ROOT, "devkit/app/data/tools.ts"), encoding="utf-8").read()
    return re.findall(r"key: '([^']+)'", txt)


ROUTES = (["/", "/favorites", "/recent", "/settings", "/privacy", "/help", "/offline",
           "/tools/does-not-exist", "/category/nope", "/nope"]
          + ["/tools/" + s for s in slugs()]
          + ["/category/" + c for c in cats()])


def crawl(width=1440, height=900, theme="light"):
    res = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": width, "height": height}, color_scheme=theme)
        page = ctx.new_page()
        for r in ROUTES:
            out = {"route": r, "console": [], "pageerrors": [], "failed": []}
            h1 = []
            def on_console(m, out=out):
                if m.type in ("error", "warning"):
                    out["console"].append("%s: %s" % (m.type, m.text[:300]))
            def on_err(e, out=out):
                out["pageerrors"].append(str(e)[:300])
            def on_fail(req, out=out):
                out["failed"].append(req.url[:160])
            page.on("console", on_console)
            page.on("pageerror", on_err)
            page.on("requestfailed", on_fail)
            try:
                resp = page.goto(BASE + r, wait_until="networkidle", timeout=40000)
                out["status"] = resp.status if resp else None
                page.wait_for_timeout(400)
                m = page.evaluate("""() => ({
                    sw: document.documentElement.scrollWidth,
                    vw: window.innerWidth,
                    sh: document.documentElement.scrollHeight,
                    text: document.body.innerText.slice(0, 400),
                    empty: document.body.innerText.trim().length,
                    err_text: (document.body.innerText.match(/500|Internal Server Error|Cannot read|undefined is not/)||[''])[0]
                })""")
                out.update(m)
                out["overflowX"] = m["sw"] > m["vw"] + 1
            except Exception as e:
                out["status"] = "EXC"
                out["pageerrors"].append(str(e)[:300])
            for ev in ("console", "pageerror", "requestfailed"):
                page.remove_listener(ev, {"console": on_console, "pageerror": on_err,
                                          "requestfailed": on_fail}[ev])
            res.append(out)
        ctx.close()
        b.close()
    return res


if __name__ == "__main__":
    w = int(sys.argv[1]) if len(sys.argv) > 1 else 1440
    h = int(sys.argv[2]) if len(sys.argv) > 2 else 900
    theme = sys.argv[3] if len(sys.argv) > 3 else "light"
    data = crawl(w, h, theme)
    out = "/Users/hao/WebstormProjects/web_tools/audit/raw/crawl_%d_%s.json" % (w, theme)
    json.dump(data, open(out, "w"), ensure_ascii=False, indent=1)
    bad = [d for d in data if d.get("status") not in (200, 404) or d["pageerrors"] or d["console"] or d["failed"] or d.get("overflowX")]
    print("routes:", len(data), "flagged:", len(bad), "->", out)
    for d in bad:
        print("-", d["route"], d.get("status"), "console:", d["console"][:2], "err:", d["pageerrors"][:1],
              "failed:", d["failed"][:2], "overflowX:", d.get("overflowX"))
