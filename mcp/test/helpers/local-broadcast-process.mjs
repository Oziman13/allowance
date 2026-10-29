// Public deterministic local fixture keys only; never use this worker with real keys.
import * as fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import { createLocalBroadcastAdapter } from "../../local-broadcast.js";
const config = JSON.parse(process.argv[2]), io = { ...fs };
const emit = v => fs.writeSync(1, JSON.stringify(v) + "\n");
const pause = (phase, transactionHash = null) => { emit({ checkpoint: phase, transactionHash }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
function latest(p) {
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf8").trimEnd().split("\n").map(x => JSON.parse(x)).filter(x => x.kind === "OP").at(-1)?.operation.children.at(-1);
}
io.fsyncSync = fd => {
  fs.fsyncSync(fd);
  const name = fs.readlinkSync(`/proc/self/fd/${fd}`), directory = fs.fstatSync(fd).isDirectory();
  const c = latest(directory ? path.join(name, "journal.jsonl") : name.endsWith("journal.jsonl") ? name : "");
  if (config.mode === "prepared" && !directory && c?.state === "PREPARED") pause("prepared-file-synced");
  if (config.mode === "submitting" && directory && c?.state === "SUBMITTING") pause("submitting-file-and-directory-synced", c.transactionHash);
};
let signs = 0;
const sign = ethers.Wallet.prototype.signTransaction;
ethers.Wallet.prototype.signTransaction = async function(tx) {
  signs++; const raw = await sign.call(this, tx);
  if (config.mode === "signed") pause("signed-before-submitting", ethers.keccak256(raw));
  return raw;
};
try {
  const adapter = createLocalBroadcastAdapter({ ...config.options, key: process.env.LOCAL_ADAPTER_FIXTURE_KEY, io });
  const result = await adapter.pay(config.input, { timeoutMs: 60000 }); emit({ result, signs });
} catch (e) { emit({ code: e.code, state: e.state, transactionHash: e.transactionHash ?? null, signs }); }
