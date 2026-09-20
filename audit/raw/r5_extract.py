#!/usr/bin/env python3
"""R5 read-only extractor for design.pen, resolving $vars to light values and refs."""
import json, re, sys, os

PEN = os.environ.get("PEN_FILE", "/Users/hao/WebstormProjects/web_tools/design.pen")
D = json.load(open(PEN, encoding="utf-8"))
VARS = D.get("variables") or {}

# index
IDX = {}
DUP = {}
def _walk(n, parent):
    n["__parent"] = parent
    if n.get("id") in IDX:
        DUP.setdefault(n["id"], [IDX[n["id"]]]).append(n)
    IDX[n.get("id")] = n
    for c in n.get("children") or []:
        _walk(c, n)
for c in D["children"]:
    _walk(c, None)


def var(v):
    if isinstance(v, str) and v.startswith("$"):
        name = v[1:]
        spec = VARS.get(name)
        if not spec:
            return v
        if spec.get("type") == "color":
            for e in spec["value"]:
                if e.get("theme", {}).get("mode") == "light":
                    return e["value"]
        return spec.get("value")
    return v


def fmt(v):
    if isinstance(v, list):
        return "[" + ", ".join(fmt(x) for x in v) + "]"
    return str(v)


def props(n, indent=0):
    out = []
    keys = ["type", "name", "icon", "width", "height", "layout", "gap", "padding",
            "alignItems", "justifyContent", "cornerRadius", "fill", "stroke",
            "strokeWidth", "strokeAlignment", "opacity", "textGrowth", "textAlign",
            "lineHeight", "letterSpacing", "content", "fontSize", "fontWeight", "fontFamily",
            "ref"]
    parts = []
    for k in keys:
        if k in n:
            v = n[k]
            if k in ("fill", "stroke") and isinstance(v, str):
                pv = var(v)
                if pv != v:
                    v = "%s(%s)" % (v, pv)
            if k == "content" and isinstance(v, str):
                v = repr(v[:160])
            if k == "fontFamily":
                pv = var(v)
                v = "%s(%s)" % (v, pv)
            parts.append("%s=%s" % (k, fmt(v)))
    return parts


def dump(nid, maxdepth=99, show_desc=True):
    root = IDX.get(nid)
    if root is None:
        print("NOT FOUND", nid); return
    def rec(n, d):
        pad = "  " * d
        line = "%s%s [%s] %r  %s" % (pad, n.get("id"), n.get("type"), n.get("name"), " ".join(props(n)))
        print(line)
        if show_desc and n.get("descendants"):
            print("%s      descendants=%s" % (pad, json.dumps(n["descendants"], ensure_ascii=False)))
        if n.get("type") == "ref" and n.get("ref") in IDX:
            print("%s      >> ref -> %s" % (pad, n["ref"]))
            if d + 1 <= maxdepth:
                rec(IDX[n["ref"]], d + 1)
        if d >= maxdepth:
            return
        for c in n.get("children") or []:
            rec(c, d + 1)
    # print path
    p = []
    x = root
    while x is not None:
        p.append("%s(%s)" % (x.get("id"), x.get("name")))
        x = x.get("__parent")
    print("PATH: " + " < ".join(reversed(p)))
    rec(root, 0)


def texts(nid):
    root = IDX.get(nid)
    def rec(n, d):
        if n.get("type") == "text" or n.get("content") is not None:
            print("%s%s %r content=%r fs=%s fw=%s fill=%s" % ("  " * d, n.get("id"), n.get("name"), n.get("content"), n.get("fontSize"), n.get("fontWeight"), (n.get("fill"), var(n.get("fill"))) if isinstance(n.get("fill"), str) else n.get("fill")))
        if n.get("type") == "ref" and n.get("ref") in IDX:
            rec(IDX[n["ref"]], d + 1)
        for c in n.get("children") or []:
            rec(c, d + 1)
    rec(root, 0)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "dump":
        dump(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 99)
    elif cmd == "text":
        texts(sys.argv[2])
    elif cmd == "node":
        print(json.dumps(IDX.get(sys.argv[2]), ensure_ascii=False, indent=1))
    elif cmd == "dups":
        for k, v in DUP.items():
            print(k, len(v), [x.get("name") for x in v])
    elif cmd == "vars":
        for k, v in VARS.items():
            light = var("$" + k)
            print("%-18s %s" % (k, light))
