#!/usr/bin/env python3
"""Write web/site-qr.svg: a QR code of the dashboard's address, shown in the wallet dialog so
someone on a laptop can open the dashboard on their phone. Run once when the address changes:

    pip install qrcode && python3 script/make_qr.py

The SVG is committed, so building the dashboard needs no extra package."""
import pathlib, qrcode, qrcode.image.svg
URL = "https://oziman13.github.io/allowance/"
root = pathlib.Path(__file__).resolve().parent.parent
qr = qrcode.QRCode(border=2, error_correction=qrcode.constants.ERROR_CORRECT_M)
qr.add_data(URL); qr.make(fit=True)
img = qr.make_image(image_factory=qrcode.image.svg.SvgPathFillImage)
svg = img.to_string(encoding="unicode")
(root / "web/site-qr.svg").write_text(svg)
print(f"web/site-qr.svg: {URL}, {qr.modules_count}x{qr.modules_count} modules, {len(svg)} bytes")
