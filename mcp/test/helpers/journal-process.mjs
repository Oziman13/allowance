// Disposable process-boundary fixtures; no RPC, wallet keys or signing.
import * as fs from "node:fs";
import { openStore } from "../../journal.js";
const [mode, encoded] = process.argv.slice(2), config = JSON.parse(encoded);
const io = { ...fs };
const emit = value => fs.writeSync(1, JSON.stringify(value) + "\n");
const pause = name => { emit({ checkpoint: name }); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0); };
if (mode === "torn") io.writeSync = (fd, buffer, offset, length, position) => {
  if (buffer.toString().includes('"kind":"OP"')) {
    fs.writeSync(fd, buffer, offset, Math.min(37, length), position); pause("partial-write");
  }
  return fs.writeSync(fd, buffer, offset, length, position);
};
if (mode === "durable") io.fsyncSync = fd => {
  fs.fsyncSync(fd);
  if (fs.fstatSync(fd).isFile() && fs.readlinkSync(`/proc/self/fd/${fd}`).endsWith("journal.jsonl")
      && fs.readFileSync(`/proc/self/fd/${fd}`, "utf8").includes('"kind":"OP"')) pause("record-fsynced-before-ack");
};
let session, simulatedBroadcasts = 0;
try {
  const store = openStore({ ...config.store, io });
  session = store.acquire(config.wallet);
  if (mode === "hold") pause("ownership-acquired");
  const operation = session.admit(config.spec);
  if (mode === "admit") {
    session.release(); emit({ operationId: operation.operationId, simulatedBroadcasts });
  } else {
    // This callback is simulated only; it can run only after durable admission and SUBMITTING.
    session.transition(operation.operationId, operation.children[0].childId,
      { state: "SUBMITTING", transactionHash: "0x" + "8".repeat(64), outcome: null, receipt: null, reasonCode: null });
    simulatedBroadcasts++;
    session.release(); emit({ admitted: true, simulatedBroadcasts });
  }
} catch (e) {
  try { session?.release(); } catch {}
  emit({ admitted: false, code: e.code || "ERROR", simulatedBroadcasts });
}
