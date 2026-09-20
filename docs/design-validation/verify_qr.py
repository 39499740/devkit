#!/usr/bin/env python3
"""
Independent QR verification for the T39 board (VecLb).

Reads the PNG exported from the board's QR card and decodes it with OpenCV's
QRCodeDetector -- a completely separate implementation from whatever drew the
board. No network access.

Usage:  python3 verify_qr.py [png]
"""
import sys
from pathlib import Path

import cv2

HERE = Path(__file__).resolve().parent
PNG = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "WNWtF.png"

# The exact string the board shows in its 内容 field.
TARGET = "https://devkit.example/tools/base64?from=qrcode"


def main() -> int:
    img = cv2.imread(str(PNG))
    if img is None:
        raise SystemExit(f"could not read image: {PNG}")

    detector = cv2.QRCodeDetector()
    data, points, _ = detector.detectAndDecode(img)

    print(f"image        : {PNG.name}  {img.shape[1]}x{img.shape[0]} px")
    print(f"corners found: {'yes' if points is not None else 'no'}")
    print(f"decoded      : {data!r}")
    print(f"target       : {TARGET!r}")
    print(f"lengths      : decoded={len(data)}  target={len(TARGET)}")

    if data == TARGET:
        print("\nRESULT: EXACT MATCH -- the exported PNG is a real, scannable QR code")
        return 0
    print("\nRESULT: NO MATCH")
    return 1


if __name__ == "__main__":
    sys.exit(main())
