#!/usr/bin/env python3
"""
Independent check: pull the Java source straight out of the .pen file on disk
and compare it byte-for-byte with the .java files next to this script.

The .pen file is JSON, so this does not depend on the pen app at all.
Indentation in the editor is rendered with per-line padding, so each line's
padding-left is converted back into that many leading spaces before comparing.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PEN = Path("/Users/hao/.pencil/documents/2eaf4d55-9d3b-41f4-8e2c-1135fa843e1f/pencil-new.pen")

# board code-area node id -> (label, expected file)
TARGETS = {
    "gk9X4":  ("kOwO2  Order.java (POJO)",   HERE / "pojo"   / "com/devkit/model/Order.java"),
    "qcSLP":  ("zgIzV  Owner.java (POJO)",   HERE / "pojo"   / "com/devkit/model/Owner.java"),
    "veUVr":  ("tjYyC  Order.java (record)", HERE / "record" / "com/devkit/model/Order.java"),
    "s4v6p9": ("D10enz Owner.java (record)", HERE / "record" / "com/devkit/model/Owner.java"),
}


def walk(node):
    yield node
    for child in node.get("children", []) or []:
        yield from walk(child)


def pad_left(frame):
    p = frame.get("padding")
    if p is None:
        return 0
    if isinstance(p, list):
        if len(p) == 4:
            return p[3]
        if len(p) == 2:
            return p[1]
        return 0
    return 0


def board_text(nodes, code_id):
    """Reconstruct the visible source of one code area."""
    by_id = {n.get("id"): n for n in nodes}
    code = by_id.get(code_id)
    if code is None:
        raise SystemExit(f"code area {code_id} not found in the .pen file")
    lines = []
    for row in code.get("children", []) or []:
        if row.get("name") != "代码行":
            continue
        indent = pad_left(row)
        text = "".join(
            c.get("content", "")
            for c in row.get("children", []) or []
            if c.get("type") == "text"
        )
        lines.append(" " * indent + text.rstrip())
    return "\n".join(lines) + "\n"


def main():
    doc = json.loads(PEN.read_text(encoding="utf-8"))
    nodes = list(walk(doc))
    ok = True
    for code_id, (label, expected_path) in TARGETS.items():
        board = board_text(nodes, code_id)
        file_text = expected_path.read_text(encoding="utf-8")
        same = board == file_text
        ok &= same
        print(f"[{'OK ' if same else 'DIFF'}] {label}")
        print(f"        board={code_id}  file={expected_path}")
        if not same:
            import difflib
            for line in difflib.unified_diff(
                file_text.splitlines(), board.splitlines(),
                "file", "board", lineterm="",
            ):
                print("        " + line)
    print()
    print("BOARD == FILE for all four classes" if ok else "MISMATCH FOUND")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
