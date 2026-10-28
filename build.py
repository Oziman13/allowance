#!/usr/bin/env python3
"""Build the dashboard: inject ABI, bytecode and network config into web/index.src.html -> docs/index.html.
Run `forge build` first. GitHub Pages serves docs/."""
import base64, hashlib, json, pathlib, shutil, subprocess, tempfile
root = pathlib.Path(__file__).parent
art = json.loads((root / "out/Allowance.sol/Allowance.json").read_text())
nets = json.loads((root / "config/networks.json").read_text())
by_chain = {str(v["chainId"]): {k: v[k] for k in v if k != "chainId"} for k, v in nets.items()
            if isinstance(v, dict) and v.get("chainId")}
html = (root / "web/index.src.html").read_text()
# Local fonts distributed under SIL OFL 1.1; see web/fonts/*-OFL.txt.
font_sets = [("Sora", "sora", (500, 600, 700)),
             ("Inter", "inter", (400, 500, 600, 700)),
             ("JetBrains Mono", "jetbrains-mono", (400,))]
fonts = "\n".join(
    "@font-face { font-family: '%s'; font-style: normal; font-display: swap; font-weight: %s; "
    "src: url(data:font/woff2;base64,%s) format('woff2'); }"
    % (family, weight, base64.b64encode((root / f"web/fonts/{slug}-latin-{weight}-normal.woff2").read_bytes()).decode())
    for family, slug, weights in font_sets for weight in weights)
html = (html.replace("__POLICY_CSS__", (root / "web/policy-field.css").read_text())
            .replace("__NATIVE_CSS__", (root / "web/native-wallet.css").read_text())
            .replace("__POLICY_JS__", (root / "web/policy-field.js").read_text())
            .replace("__SPENDING_JS__", (root / "web/spending-view.js").read_text())
            .replace("__DEMO_GUIDE_JS__", (root / "web/demo-guide.js").read_text())
            .replace("__SITE_QR__", (root / "web/site-qr.svg").read_text())  # script/make_qr.py
            .replace("__FONTS__", fonts)
            .replace("__ABI__", json.dumps(art["abi"]))
            .replace("__BYTECODE__", art["bytecode"]["object"])
            .replace("__NETWORKS__", json.dumps(by_chain)))
# Serve the same pinned ethers release locally; do not depend on a third-party CDN at demo time.
# SHA-256 independently matched the official 6.13.4 CDN distribution and installed npm package.
vendor = root / "web/vendor"
assert hashlib.sha256((vendor / "ethers-6.13.4.umd.min.js").read_bytes()).hexdigest() == "fd66c04651929c6a37806a37e8217e6b6aac07c7e816ad478f52690b7429bc61", "Unexpected ethers vendor asset"
(root / "docs/vendor").mkdir(parents=True, exist_ok=True)
for name in ("ethers-6.13.4.umd.min.js", "ethers-LICENSE.md"):
    shutil.copyfile(vendor / name, root / "docs/vendor" / name)
(root / "docs").mkdir(exist_ok=True)
(root / "docs/index.html").write_text(html)
# Simulation mode: bundle the in-browser chain (web/sim) into docs/sim.js. Needs `npm install` in web/sim;
# without it the committed docs/sim.js is kept as is.
sim = root / "web/sim"
if (sim / "node_modules/.bin/esbuild").exists():
    subprocess.run([str(sim / "node_modules/.bin/esbuild"), "provider.js", "--bundle", "--format=iife", "--minify",
                    "--platform=browser", "--target=es2020", "--legal-comments=eof", f"--outfile={root / 'docs/sim.js'}",
                    "--banner:js=/* Allowance simulation (MIT). Bundles unmodified EthereumJS packages (MPL-2.0; source: "
                    "https://github.com/ethereumjs/ethereumjs-monorepo) and @noble/@scure crypto (MIT). See web/sim/package.json. */"],
                   cwd=sim, check=True, capture_output=True)
    print("docs/sim.js bundled,", (root / "docs/sim.js").stat().st_size // 1024, "KB")
else:
    print("web/sim/node_modules missing: kept the existing docs/sim.js (run `npm install` in web/sim to rebuild it)")
# Native SDK loads only on explicit panel open. Reuses the pinned simulation esbuild.
native = root / "substrate"
if (sim / "node_modules/.bin/esbuild").exists() and (native / "node_modules/@polkadot/api").exists():
    with tempfile.TemporaryDirectory(prefix="allowance-native-build-") as tmp:
        meta = pathlib.Path(tmp) / "bundle.json"
        subprocess.run([str(sim / "node_modules/.bin/esbuild"), "browser/entry.mjs", "--bundle", "--format=iife", "--minify",
                        "--platform=browser", "--target=es2022", "--legal-comments=eof", f"--metafile={meta}",
                        f"--outfile={root / 'docs/native-wallet.js'}",
                        "--banner:js=/* Allowance native read-only adapter (MIT). Pinned SDK dependencies: substrate/package-lock.json; licenses: vendor/native-wallet-LICENSES.txt. */"],
                       cwd=native, check=True, capture_output=True)
        packages = {}
        for name in json.loads(meta.read_text())["inputs"]:
            path = (native / name).resolve().parent
            while path != root and path != path.parent:
                package = path / "package.json"
                if package.exists():
                    info = json.loads(package.read_text())
                    if "name" not in info:
                        path = path.parent
                        continue
                    if "node_modules" in path.parts:
                        licenses = sorted(set(path.glob("LICENSE*")) | set(path.glob("LICENCE*")) | set(path.glob("COPYING*")))
                        packages[info["name"]] = (f'{info["name"]}@{info["version"]} ({info.get("license", "see package")})\n'
                                                 + f'https://registry.npmjs.org/{info["name"]}/{info["version"]}\n'
                                                 + "\n".join(p.read_text() for p in licenses if p.is_file()))
                    break
                path = path.parent
        license_text = ("Third-party packages in the lazy native-wallet bundle. Generated from pinned npm packages.\n\n"
                        + "\n\n".join(packages[key] for key in sorted(packages)))
        (root / "docs/vendor/native-wallet-LICENSES.txt").write_text(
            "\n".join(line.rstrip() for line in license_text.splitlines()) + "\n")
    print("docs/native-wallet.js bundled,", (root / "docs/native-wallet.js").stat().st_size // 1024, "KB")
elif not (root / "docs/native-wallet.js").exists():
    raise RuntimeError("Native bundle missing: run npm ci in substrate and web/sim")
else:
    print("Native build dependencies missing: kept docs/native-wallet.js; run npm ci in substrate and web/sim to rebuild")
(root / "docs/abi.json").write_text(json.dumps(art["abi"], indent=1))
print("docs/index.html written,", len(html) // 1024, "KB; networks:", ", ".join(v["name"] for v in by_chain.values()))
