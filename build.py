#!/usr/bin/env python3
"""Build the dashboard: inject ABI, bytecode and network config into web/index.src.html -> docs/index.html.
Run `forge build` first. GitHub Pages serves docs/."""
import json, pathlib
root = pathlib.Path(__file__).parent
art = json.loads((root / "out/Allowance.sol/Allowance.json").read_text())
nets = json.loads((root / "config/networks.json").read_text())
by_chain = {str(v["chainId"]): {k: v[k] for k in v if k != "chainId"} for k, v in nets.items()
            if isinstance(v, dict) and v.get("chainId")}
html = (root / "web/index.src.html").read_text()
html = (html.replace("__ABI__", json.dumps(art["abi"]))
            .replace("__BYTECODE__", art["bytecode"]["object"])
            .replace("__NETWORKS__", json.dumps(by_chain)))
(root / "docs").mkdir(exist_ok=True)
(root / "docs/index.html").write_text(html)
(root / "docs/abi.json").write_text(json.dumps(art["abi"], indent=1))
print("docs/index.html written,", len(html) // 1024, "KB; networks:", ", ".join(v["name"] for v in by_chain.values()))
