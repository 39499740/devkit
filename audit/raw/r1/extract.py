#!/usr/bin/env python3
"""Read-only design.pen extractor that understands `content` and `ref` nodes."""
import json, sys, os

PEN = os.environ.get("PEN_FILE", "/Users/hao/WebstormProjects/web_tools/design.pen")
D = json.load(open(PEN, encoding="utf-8"))
BYID = {}


def index(n):
    if isinstance(n, dict):
        if n.get("id"):
            BYID[n["id"]] = n
        for c in (n.get("children") or []):
            index(c)


for c in D["children"]:
    index(c)


def resolve(n, depth=0):
    """Yield (node, depth); expand refs whose target has children."""
    yield n, depth
    tgt = n
    if n.get("type") == "ref" and n.get("ref") in BYID:
        tgt = BYID[n["ref"]]
    for c in (tgt.get("children") or []):
        yield from resolve(c, depth + 1)


def find(name_re):
    import re
    rx = re.compile(name_re)
    out = []
    for n in BYID.values():
        if rx.search(str(n.get("name", ""))):
            out.append(n)
    return out


def walk_text(nid, maxdepth=99):
    root = BYID.get(nid)
    lines = []

    def rec(n, d):
        if d > maxdepth:
            return
        tgt = n
        pad = "  " * d
        label = n.get("name") or ""
        if n.get("type") == "ref":
            lines.append("%s<ref %s -> %s>" % (pad, n.get("id"), n.get("ref")))
            tgt = BYID.get(n.get("ref"), n)
        if tgt.get("type") == "text":
            lines.append("%s%s [%s] fs=%s w=%s fill=%s :: %r" % (
                pad, n.get("id"), label, tgt.get("fontSize"), tgt.get("width"),
                tgt.get("fill"), tgt.get("content")))
        elif tgt.get("type") in ("frame",) and d <= 3:
            lines.append("%s%s frame %r w=%s h=%s layout=%s gap=%s pad=%s fill=%s radius=%s" % (
                pad, n.get("id"), label, tgt.get("width"), tgt.get("height"),
                tgt.get("layout"), tgt.get("gap"), tgt.get("padding"),
                tgt.get("fill"), tgt.get("cornerRadius")))
        for c in (tgt.get("children") or []):
            rec(c, d + 1)

    rec(root, 0)
    return "\n".join(lines)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "text":
        for nid in sys.argv[2:]:
            n = BYID.get(nid)
            print("===== %s :: %s (w=%s h=%s)" % (nid, n.get("name"), n.get("width"), n.get("height")))
            print(walk_text(nid))
    elif cmd == "find":
        for n in find(sys.argv[2]):
            print(n.get("id"), n.get("type"), n.get("name"), n.get("width"), n.get("height"))
    elif cmd == "raw":
        print(json.dumps(BYID.get(sys.argv[2]), ensure_ascii=False)[:20000])
    elif cmd == "content":
        # all text content in a frame
        n = BYID.get(sys.argv[2])
        for x, d in resolve(n):
            if x.get("type") == "text":
                print("  " * d + repr(x.get("content")))
