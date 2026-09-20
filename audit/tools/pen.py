#!/usr/bin/env python3
"""Read-only helpers for design.pen (plain-JSON .pen file)."""
import json, re, sys, os

PEN = os.environ.get("PEN_FILE", "/Users/hao/WebstormProjects/web_tools/design.pen")
_cache = None


def load():
    global _cache
    if _cache is None:
        with open(PEN, encoding="utf-8") as f:
            _cache = json.load(f)
    return _cache


def iter_nodes(n, depth=1):
    yield n, depth
    for c in (n.get("children") or []):
        yield from iter_nodes(c, depth + 1)


def all_nodes():
    d = load()
    for c in d["children"]:
        yield from iter_nodes(c)


def find(name_re):
    rx = re.compile(name_re)
    return [(n, dep) for n, dep in all_nodes() if rx.search(str(n.get("name", "")))]


def get(nid):
    for n, dep in all_nodes():
        if n.get("id") == nid:
            return n
    return None


def path_of(nid):
    d = load()
    out = []

    def rec(n, acc):
        if n.get("id") == nid:
            out.extend(acc + [n])
            return True
        for c in (n.get("children") or []):
            if rec(c, acc + [n]):
                return True
        return False

    for c in d["children"]:
        if rec(c, []):
            break
    return out


def summary(n, depth=1):
    return {"id": n.get("id"), "type": n.get("type"), "name": n.get("name"),
            "w": n.get("width"), "h": n.get("height"), "depth": depth,
            "children": len(n.get("children") or [])}


def dump(n, depth=1, maxdepth=99):
    lines = []

    def rec(x, d):
        if d > maxdepth:
            return
        pad = "  " * (d - 1)
        extra = []
        for k in ("content", "fill", "fontSize", "fontFamily", "fontWeight", "width", "height",
                  "x", "y", "gap", "padding", "layout", "justifyContent", "alignItems",
                  "textGrowth", "cornerRadius", "opacity"):
            if k in x:
                v = x[k]
                if k == "content" and isinstance(v, str):
                    v = v.replace("\n", "\\n")[:140]
                extra.append("%s=%s" % (k, v))
        lines.append("%s%s [%s] %r %s" % (pad, x.get("id"), x.get("type"), x.get("name"), " ".join(extra)))
        for c in (x.get("children") or []):
            rec(c, d + 1)

    rec(n, depth)
    return "\n".join(lines)


def texts(n):
    out = []
    for x, dep in iter_nodes(n):
        if x.get("type") == "text" and x.get("content") is not None:
            out.append({"depth": dep, "text": x.get("content"), "fontSize": x.get("fontSize"), "name": x.get("name")})
    return out


def stats():
    d = load()
    types = {}
    for n, dep in all_nodes():
        types[n.get("type")] = types.get(n.get("type"), 0) + 1
    return {"top_frames": len(d["children"]), "nodes": sum(types.values()), "types": types,
            "variables": len(d.get("variables") or {}), "themes": d.get("themes")}


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "stats"
    if cmd == "stats":
        print(json.dumps(stats(), ensure_ascii=False, indent=1))
    elif cmd == "frames":
        for c in load()["children"]:
            print(summary(c))
    elif cmd == "find":
        for n, dep in find(sys.argv[2]):
            print(dep, n.get("id"), n.get("type"), n.get("name"))
    elif cmd == "dump":
        nid = sys.argv[2]
        md = int(sys.argv[3]) if len(sys.argv) > 3 else 6
        root = get(nid)
        if root is None:
            print("not found")
            sys.exit(1)
        print("\n".join(x.get("name") for x in path_of(nid)))
        print(dump(root, 1, md))
    elif cmd == "text":
        root = get(sys.argv[2])
        print(json.dumps(texts(root), ensure_ascii=False, indent=1))
    elif cmd == "node":
        print(json.dumps(get(sys.argv[2]), ensure_ascii=False)[:20000])
