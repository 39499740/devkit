#!/usr/bin/env python3
"""L1 wide-layout audit: measure container widths, grid columns, overflow and screenshots."""
import json, os, sys

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SITE", "http://localhost:3000")
OUT_JSON = os.environ.get("OUT", "/Users/hao/WebstormProjects/web_tools/audit/logs/l1-wide-layout.json")
SHOT_DIR = "/Users/hao/WebstormProjects/web_tools/audit/evidence/l1"

WIDTHS = [
    (2560, 1400),
    (1920, 1080),
    (1440, 900),
    (390, 844),
]

PAGES = {
    "home": "/",
    "category": "/category/format",
    "favorites": "/favorites",
    "recent": "/recent",
    "settings": "/settings",
    "privacy": "/privacy",
    "help": "/help",
    "offline": "/offline",
    "tool": "/tools/json-format",
}

MEASURE_JS = r"""() => {
  const q = s => document.querySelector(s);
  const rect = el => { if (!el) return null; const b = el.getBoundingClientRect();
    return {x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height)}; };
  const gridCols = el => {
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display !== 'grid' && cs.display !== 'inline-grid') return null;
    const t = cs.gridTemplateColumns.trim();
    return t ? t.split(/\s+/).length : 0;
  };
  const root = document.documentElement;
  const vw = root.clientWidth;
  const over = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const b = el.getBoundingClientRect();
    if (b.width === 0 && b.height === 0) continue;
    if (b.right > vw + 1 || b.left < -1) {
      over.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.getAttribute('class') || '').slice(0, 80),
        left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width)
      });
    }
  }
  return {
    viewport: vw,
    doc: { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth,
           overflow: root.scrollWidth > root.clientWidth + 1 },
    shellContent: rect(q('.shell__content')),
    toolPage: rect(q('.tool-page')),
    toolBody: rect(q('.tool-page__body')),
    home: rect(q('.home')),
    homeGrid: rect(q('.home__grid')),
    homeGridCols: gridCols(q('.home__grid')),
    homeQuick: rect(q('.home__quick')),
    catPage: rect(q('.cat-page')),
    catGrid: rect(q('.cat-page__grid')),
    catGridCols: gridCols(q('.cat-page__grid')),
    fav: rect(q('.fav')),
    favWorkspace: rect(q('.fav__workspace')),
    favRow: rect(q('.fav__row')),
    favColTool: rect(q('.fav__cell--tool')),
    favColCat: rect(q('.fav__cell--cat')),
    recent: rect(q('.recent')),
    recentWorkspace: rect(q('.recent__workspace')),
    settings: rect(q('.settings')),
    panelBody: rect(q('.panel__body')),
    privacy: rect(q('.privacy')),
    help: rect(q('.help')),
    offline: rect(q('.offline')),
    overflowingElements: over.slice(0, 25),
    overflowCount: over.length
  };
}"""

SHOTS = {
    (2560, 1400): [("tool", "l1-2560-tool-json-format.png"), ("home", "l1-2560-home.png"),
                   ("favorites", "l1-2560-favorites.png")],
    (1920, 1080): [("tool", "l1-1920-tool-json-format.png")],
    (1440, 900): [("tool", "l1-1440-tool-json-format.png"), ("home", "l1-1440-home.png")],
    (390, 844): [("tool", "l1-390-tool-json-format.png")],
}

SEED_JS = r"""
(() => {
  const now = Date.now();
  const fav = { v: 2, items: ['t01','t02','t03','t05','t09','t12','t18','t19'].map((id, i) => (
    { id, at: new Date(now - i * 3600 * 1000).toISOString() })) };
  localStorage.setItem('devkit.favorites.v1', JSON.stringify(fav));
  const recent = ['t01','t05','t12','t18','t02','t14','t20','t22']
    .map((id, i) => ({ id, at: new Date(now - i * 3600 * 1000).toISOString() }));
  localStorage.setItem('devkit.recent.v1', JSON.stringify(recent));
  localStorage.setItem('devkit.visited.v1', JSON.stringify(['t01','t05','t12']));
})();
"""


def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    report = {"base": BASE, "runs": []}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h in WIDTHS:
            ctx = browser.new_context(viewport={"width": w, "height": h},
                                      color_scheme="light", device_scale_factor=1)
            ctx.add_init_script(SEED_JS)
            page = ctx.new_page()
            run = {"width": w, "height": h, "pages": {}}
            console_errors = []
            page.on("console", lambda m: console_errors.append(m.text[:300])
                    if m.type == "error" else None)
            page.on("pageerror", lambda e: console_errors.append("pageerror: " + str(e)[:300]))
            for name, path in PAGES.items():
                console_errors.clear()
                page.goto(BASE + path, wait_until="networkidle", timeout=60000)
                page.wait_for_timeout(700)
                data = page.evaluate(MEASURE_JS)
                data["consoleErrors"] = list(console_errors)
                if name == "tool":
                    # freeze SplitPanes split position report
                    data["splitPanes"] = page.evaluate(
                        "() => { const t = document.querySelector('.tool-page__body');"
                        " return t ? Math.round(t.getBoundingClientRect().width) : null; }")
                run["pages"][name] = data
            for key, fname in SHOTS.get((w, h), []):
                path = PAGES[key]
                page.goto(BASE + path, wait_until="networkidle", timeout=60000)
                page.wait_for_timeout(500)
                shot_path = os.path.join(SHOT_DIR, fname)
                page.screenshot(path=shot_path, full_page=False)
                run.setdefault("screenshots", []).append(shot_path)
            ctx.close()
            report["runs"].append(run)
        browser.close()
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=1)
    print(json.dumps(report, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
