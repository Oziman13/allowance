#!/usr/bin/env python3
"""Check Allowance against the Portaldot Hacker House submission rules.

Run from the repository root after `forge build`:

    python3 script/check_submission.py            # repository + on-chain checks
    python3 script/check_submission.py --offline  # repository checks only

Each line is one requirement from the Hacker House page (check-in, final submission and code
compliance), with PASS, FAIL or TODO (needs a person: video, deck, DoraHacks form).
On-chain checks read the public Portaldot V3 testnet RPC; nothing is signed or sent.
Standard library only.
"""
import json, re, subprocess, sys, urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HACKER_HOUSE_START = datetime(2026, 10, 14, tzinfo=timezone.utc)
FINAL_DEADLINE = datetime(2026, 11, 6, 7, 0, tzinfo=timezone.utc)  # Nov 6, 07:00 UTC
results = []


def check(group, name, ok, detail=""):
    status = "TODO" if ok is None else ("PASS" if ok else "FAIL")
    results.append((group, status, name, detail))


def read(rel):
    p = ROOT / rel
    return p.read_text(encoding="utf-8") if p.exists() else ""


def git(*args):
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True).stdout.strip()


def rpc(url, method, params):
    body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
    req = urllib.request.Request(url, body, {"content-type": "application/json", "user-agent": "allowance-check/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.load(r)
    if "error" in out:
        raise RuntimeError(out["error"].get("message"))
    return out["result"]


def repo_checks():
    readme = read("README.md")
    g = "Repository"
    check(g, "README exists and is substantial", len(readme) > 4000, f"{len(readme)} characters")
    for title in ["## The problem", "## Contract", "## Tests", "## Deploy", "## Live on Portaldot V3 testnet", "## Business model", "## Prior work disclosure"]:
        check(g, f"README section: {title[3:]}", title in readme)
    arch = read("docs/ARCHITECTURE.md")
    check(g, "Product architecture diagram (docs/ARCHITECTURE.md, Mermaid)", "```mermaid" in arch and "(planned)" not in arch)
    check(g, "Deployment instructions in README", "forge script" in readme and "config/networks.json" in readme)
    check(g, "Project documentation (guide, judging map, proof)",
          all((ROOT / f).exists() for f in ["docs/SOLIDITY-ON-PORTALDOT-V3.md", "docs/JUDGING.md", "docs/PROOF.md"]))
    check(g, "Licence file", (ROOT / "LICENSE").exists())
    check(g, "Third-party dependencies disclosed", all(w in readme for w in ["Foundry", "ethers", "EthereumJS", "MCP TypeScript SDK"]))
    check(g, "CI workflow runs contract and MCP tests", "forge test" in read(".github/workflows/ci.yml") and "npm test" in read(".github/workflows/ci.yml"))
    check(g, "Runnable demo: dashboard built (docs/index.html) with simulation (docs/sim.js)",
          (ROOT / "docs/index.html").exists() and (ROOT / "docs/sim.js").exists() and "Try it without a wallet" in read("docs/index.html"))

    g = "Code compliance"
    log = git("log", "--format=%H|%aI|%s")
    if not log:
        check(g, "Git history available", False, "run inside a clone of the repository")
        return
    commits = [l.split("|", 2) for l in log.splitlines()]
    dates = [datetime.fromisoformat(d) for _, d, _ in commits]
    during = [d for d in dates if HACKER_HOUSE_START <= d <= FINAL_DEADLINE]
    check(g, "At least 3 valid commits during the Hacker House", len(during) >= 3, f"{len(during)} commits")
    check(g, "Code produced during the Hacker House (first commit on or after Oct 14)", min(dates) >= HACKER_HOUSE_START, f"first commit {min(dates):%Y-%m-%d}")
    days = sorted({d.astimezone(timezone.utc).date() for d in during})
    check(g, "Sustained activity (commits on several days)", len(days) >= 3, f"{len(days)} days: {', '.join(str(d) for d in days)}")
    core = ["src/Allowance.sol", "web/index.src.html", "mcp/index.js", "mcp/lib.js"]
    last24 = FINAL_DEADLINE - timedelta(hours=24)
    late = git("log", f"--since={last24.isoformat()}", "--name-only", "--format=", "--", *core)
    check(g, "Core modules not committed all at once in the last 24 hours before the deadline", not late.strip(),
          "no core changes in the final 24 hours" if not late.strip() else "core files changed: " + ", ".join(sorted(set(late.split()))))
    check(g, "Repository public", None, "check on GitHub: Settings → General → Danger Zone shows 'Change visibility' (public)")


def chain_checks():
    nets = json.loads(read("config/networks.json"))
    net = nets["portaldot-testnet"]
    url, address = net["rpc"], net.get("allowance")
    g = "Portaldot testnet"
    check(g, "Contract address recorded in config/networks.json", bool(address), address or "")
    if not address:
        return
    try:
        chain_id = int(rpc(url, "eth_chainId", []), 16)
        check(g, "RPC reachable and chain ID is 420420777", chain_id == 420420777, str(chain_id))
        code = rpc(url, "eth_getCode", [address, "latest"])
        art = ROOT / "out/Allowance.sol/Allowance.json"
        if art.exists():
            built = json.loads(art.read_text())["deployedBytecode"]["object"]
            check(g, "Deployed code is byte-for-byte this repository's build", code.lower() == built.lower(), f"{len(code) // 2 - 1} bytes on chain")
        else:
            check(g, "Deployed code is byte-for-byte this repository's build", None, "run `forge build` first")
        # The public testnet node prunes old blocks, so receipts of older transactions come back empty.
        # Contract events stay queryable, and only a successful transaction emits them, so each
        # transaction in PROOF.md (except the deployment, proven by the code above) is matched to its events.
        dep = (net.get("allowanceDeployTx") or "").lower()
        hashes = [h.lower() for h in re.findall(r"`(0x[0-9a-fA-F]{64})`", read("docs/PROOF.md")) if h.lower() != dep]
        logs = rpc(url, "eth_getLogs", [{"address": address, "fromBlock": hex(net.get("allowanceFromBlock", 0)), "toBlock": "latest"}])
        seen = {l["transactionHash"].lower() for l in logs}
        found = [h for h in hashes if h in seen]
        missing = [h[:12] + "…" for h in hashes if h not in seen]
        check(g, "Every transaction in docs/PROOF.md emitted its contract events (so it succeeded)", bool(hashes) and not missing,
              f"{len(found)}/{len(hashes)} found in {len(logs)} contract events" + (f"; missing {', '.join(missing)}" if missing else ""))
    except Exception as e:  # network trouble is reported, not hidden
        check(g, "On-chain checks", False, f"could not reach {url}: {e}")


def human_checks():
    g = "Needs you"
    check(g, "Demo video ≤ 3 minutes, narrated, public link (shows a real product, core functions, Portaldot usage)", None)
    check(g, "Pitch deck: problem, why Portaldot, proof it works, why keep supporting it (PDF or public link)", None, "final submission")
    check(g, "DoraHacks BUIDL updated: progress, outstanding items, repo, contract, tx hash, demo link", None)


def main():
    repo_checks()
    if "--offline" not in sys.argv:
        chain_checks()
    human_checks()
    width = max(len(r[2]) for r in results)
    group = None
    for g, status, name, detail in results:
        if g != group:
            print(f"\n{g}")
            group = g
        mark = {"PASS": "✔", "FAIL": "✘", "TODO": "…"}[status]
        print(f"  {mark} {status:4}  {name.ljust(width)}  {detail}".rstrip())
    fails = sum(r[1] == "FAIL" for r in results)
    todos = sum(r[1] == "TODO" for r in results)
    print(f"\n{len(results) - fails - todos} passed, {fails} failed, {todos} for you to do")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
