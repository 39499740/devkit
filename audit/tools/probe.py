#!/usr/bin/env python3
"""Live-page probe: DOM/CSS metrics, console errors, screenshot via Playwright."""
import json, sys, os, re

from playwright.sync_api import sync_playwright

BASE = os.environ.get("SITE", "http://localhost:3000")


def probe(url, shot=None, full=False, width=1440, height=900, theme="light", wait=900):
    out = {"url": url, "console": [], "pageerrors": [], "failed_requests": []}
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={"width": width, "height": height},
                            color_scheme=theme, device_scale_factor=1)
        page = ctx.new_page()
        page.on("console", lambda m: out["console"].append({"type": m.type, "text": m.text[:400]})
                if m.type in ("error", "warning") else None)
        page.on("pageerror", lambda e: out["pageerrors"].append(str(e)[:400]))
        page.on("requestfailed", lambda r: out["failed_requests"].append(r.url[:200]))
        resp = page.goto(url, wait_until="networkidle", timeout=45000)
        out["status"] = resp.status if resp else None
        page.wait_for_timeout(wait)
        out["title"] = page.title()
        out["metrics"] = page.evaluate("""() => {
          const q = s => document.querySelector(s);
          const r = el => { if(!el) return null; const b = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height),
                    bg:cs.backgroundColor,color:cs.color,font:cs.fontFamily,size:cs.fontSize,border:cs.borderColor}; };
          const elems = [...document.querySelectorAll('body *')];
          const texts = elems.filter(e=>e.children.length===0 && e.textContent.trim())
                             .map(e=>({t:e.textContent.trim().slice(0,120), tag:e.tagName,
                                      size:getComputedStyle(e).fontSize, color:getComputedStyle(e).color}));
          return {
            body: r(document.body),
            header: r(q('header') || q('[class*=top]') || q('nav')),
            nav: r(q('nav')),
            sidebar: r(q('aside') || q('[class*=side]')),
            main: r(q('main')),
            h1: r(q('h1')), h2: r(q('h2')),
            htmlBg: getComputedStyle(document.documentElement).backgroundColor,
            cssVars: (()=>{const cs=getComputedStyle(document.documentElement);const o={};
              for(const n of ['--bg','--surface','--surface-subtle','--border','--text-primary','--text-secondary','--text-tertiary','--accent','--accent-soft'])
                o[n]=cs.getPropertyValue(n).trim(); return o;})(),
            textSample: texts.slice(0, 260),
            counts: {a:document.querySelectorAll('a').length, button:document.querySelectorAll('button').length,
                     input:document.querySelectorAll('input,textarea,select').length,
                     imgs:document.querySelectorAll('img').length,
                     svg:document.querySelectorAll('svg').length},
            doc: {w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight},
            a11y: {
              buttonsNoName: [...document.querySelectorAll('button')].filter(b=>!b.textContent.trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length,
              imgNoAlt: [...document.querySelectorAll('img')].filter(i=>!i.hasAttribute('alt')).length,
              inputsNoLabel: [...document.querySelectorAll('input,textarea,select')].filter(i=>!i.getAttribute('aria-label') && !i.labels?.length && !i.getAttribute('placeholder')).length,
              landmarks: {header: !!q('header'), nav: !!q('nav'), main: !!q('main'), footer: !!q('footer')}
            }
          };
        }""")
        if shot:
            page.screenshot(path=shot, full_page=full)
            out["shot"] = shot
        ctx.close()
        b.close()
    return out


if __name__ == "__main__":
    url = sys.argv[1]
    if not url.startswith("http"):
        url = BASE + url
    shot = None
    full = False
    theme = "light"
    w, h = 1440, 900
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--shot":
            shot = args[i + 1]; i += 2
        elif args[i] == "--full":
            full = True; i += 1
        elif args[i] == "--dark":
            theme = "dark"; i += 1
        elif args[i] == "--w":
            w = int(args[i + 1]); i += 2
        elif args[i] == "--h":
            h = int(args[i + 1]); i += 2
        else:
            i += 1
    print(json.dumps(probe(url, shot, full, w, h, theme), ensure_ascii=False, indent=1))
