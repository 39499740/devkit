#!/usr/bin/env python3
"""Enhanced read-only dumper for design.pen (adds stroke + variable resolution)."""
import json, sys, os

PEN = "/Users/hao/WebstormProjects/web_tools/design.pen"
_d = json.load(open(PEN, encoding="utf-8"))
_vars = _d.get("variables") or {}


def light(varname):
    v = _vars.get(varname)
    if not v:
        return None
    val = v.get("value")
    if not isinstance(val, list):
        return val
    for e in val:
        if isinstance(e, dict) and e.get("theme", {}).get("mode") == "light":
            return e.get("value")
    return None


def resolve(v):
    if isinstance(v, str) and v.startswith("$"):
        name = v[1:]
        return "%s(%s)" % (v, light(name))
    return v


def get(nid):
    found = []

    def rec(n):
        if n.get("id") == nid:
            found.append(n)
        for c in n.get("children") or []:
            rec(c)

    for c in _d["children"]:
        rec(c)
    return found[0] if found else None


KEYS = ("content", "text", "fill", "fontSize", "fontFamily", "fontWeight",
        "width", "height", "x", "y", "gap", "padding", "layout",
        "justifyContent", "alignItems", "textGrowth", "cornerRadius",
        "stroke", "strokeWidth", "strokeAlign", "opacity", "itemSpacing",
        "lineHeight", "letterSpacing")


def dump(n, maxdepth=99, resolve_colors=True):
    lines = []

    def rec(x, d):
        if d > maxdepth:
            return
        pad = "  " * (d - 1)
        extra = []
        for k in KEYS:
            if k in x and x[k] is not None:
                v = x[k]
                if k in ("fill", "stroke") and resolve_colors:
                    v = resolve(v)
                if k in ("text", "content") and isinstance(v, str):
                    v = v.replace("\n", "\\n")[:120]
                if k == "fill" and isinstance(v, list):
                    v = json.dumps(v, ensure_ascii=False)
                extra.append("%s=%s" % (k, v))
        lines.append("%s%s [%s] %r %s" % (pad, x.get("id"), x.get("type"),
                                          x.get("name"), " ".join(extra)))
        for c in (x.get("children") or []):
            rec(c, d + 1)

    rec(n, 1)
    return "\n".join(lines)


if __name__ == "__main__":
    if sys.argv[1] == "dump":
        nid = sys.argv[2]
        md = int(sys.argv[3]) if len(sys.argv) > 3 else 99
        n = get(nid)
        print("### " + (n.get("name") if n else "NOT FOUND"))
        if n:
            print(dump(n, md))
    elif sys.argv[1] == "raw":
        n = get(sys.argv[2])
        print(json.dumps(n, ensure_ascii=False, indent=1))
    elif sys.argv[1] == "refs":
        root = get(sys.argv[2])

        def walk(x, path):
            if x.get("type") == "ref":
                over = {k: v for k, v in x.items()
                        if k not in ("type", "ref", "id", "name", "children")}
                print("  " * (len(path)) + "-> ref=%s name=%r over=%s" %
                      (x.get("ref"), x.get("name"), json.dumps(over, ensure_ascii=False)))
            for c in x.get("children") or []:
                walk(c, path + [c.get("name")])

        walk(root, [])
    elif sys.argv[1] == "vars":
        print(json.dumps({k: light(k) for k in _vars}, ensure_ascii=False, indent=1))
