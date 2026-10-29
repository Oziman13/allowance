// Inert local persistence primitives. Deliberately not imported by lib.js or index.js.
import * as fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { JournalError, fail, uuid, canonical, keys, id, binding, intent, childSpec, newChild, updateChild, validateChange } from "./journal-schema.js";
export { JournalError } from "./journal-schema.js";

const MAX_BYTES = 8 * 1024 * 1024;
const LOCAL_FILESYSTEMS = new Set([0xef53, 0x58465342, 0x9123683e, 0x794c7630]); // ext4, XFS, btrfs, overlayfs (conditional)
const digest = v => createHash("sha256").update(canonical(v)).digest("hex");
const seal = body => ({ ...body, digest: digest(body) });
const line = body => canonical(seal(body)) + "\n";
const sameInode = (a, b) => a.ino === b.ino && a.dev === b.dev;
const ioError = e => {
  if (e instanceof JournalError) return e;
  const out = new JournalError("FILESYSTEM_ERROR");
  out.fsCode = /^[A-Z0-9_]{1,40}$/.test(e?.code || "") ? e.code : "IO";
  return out; // never retain/serialize unrestricted error objects or messages
};
const version = v => { if (v !== 1) fail("UNSUPPORTED_SCHEMA"); };
function decoded(text) {
  let v; try { v = JSON.parse(text); } catch { fail("CORRUPT_STATE"); }
  if (canonical(v) !== text || !v || typeof v !== "object" || Array.isArray(v)) fail("CORRUPT_STATE");
  const { digest: stored, ...body } = v;
  if (typeof stored !== "string" || stored !== digest(body)) fail("CORRUPT_STATE");
  version(body.schemaVersion); return body;
}
class Files {
  constructor(io) { this.io = io; }
  ancestors(p) {
    if (process.platform !== "linux" || typeof process.getuid !== "function") fail("UNSUPPORTED_PLATFORM");
    if (typeof p !== "string" || !path.isAbsolute(p) || p.includes("\0") || path.normalize(p) !== p || p.endsWith("/")) fail("UNSAFE_PATH");
    let current = "/";
    for (const component of p.split("/").slice(1)) {
      if (!component || component === "." || component === "..") fail("UNSAFE_PATH");
      current = path.join(current, component);
      const st = this.io.lstatSync(current, { bigint: true });
      if (!st.isDirectory() || st.isSymbolicLink() || (st.uid !== 0n && st.uid !== BigInt(process.getuid())) || (st.mode & 0o022n)) fail("UNSAFE_PATH");
    }
  }
  dir(p) {
    this.ancestors(p);
    const st = this.io.lstatSync(p, { bigint: true });
    if (st.uid !== BigInt(process.getuid()) || (st.mode & 0o7777n) !== 0o700n) fail("UNSAFE_PERMISSIONS");
    const type = Number(BigInt.asUintN(32, BigInt(this.io.statfsSync(p).type)));
    if (!LOCAL_FILESYSTEMS.has(type)) fail("UNSUPPORTED_FILESYSTEM");
    return st;
  }
  syncDir(p) {
    const fd = this.io.openSync(p, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { this.io.fsyncSync(fd); } finally { this.io.closeSync(fd); }
  }
  open(p, flags) {
    const fd = this.io.openSync(p, flags | fs.constants.O_NOFOLLOW, 0o600);
    try {
      const st = this.io.fstatSync(fd, { bigint: true }), linked = this.io.lstatSync(p, { bigint: true });
      if (!st.isFile() || st.nlink !== 1n || st.uid !== BigInt(process.getuid()) || (st.mode & 0o7777n) !== 0o600n || !sameInode(st, linked)) fail("UNSAFE_FILE");
      return fd;
    } catch (e) { this.io.closeSync(fd); throw e; }
  }
  read(p) {
    const fd = this.open(p, fs.constants.O_RDONLY);
    try {
      const before = this.io.fstatSync(fd, { bigint: true });
      if (before.size > BigInt(MAX_BYTES)) fail("STATE_TOO_LARGE");
      const text = this.io.readFileSync(fd, "utf8"), after = this.io.fstatSync(fd, { bigint: true });
      if (before.size !== after.size || before.mtimeNs !== after.mtimeNs) fail("UNSTABLE_READ");
      return { text, stat: after };
    } finally { this.io.closeSync(fd); }
  }
  writeAll(fd, buffer, position) {
    for (let offset = 0; offset < buffer.length;) {
      const n = this.io.writeSync(fd, buffer, offset, buffer.length - offset, position + offset);
      if (!Number.isInteger(n) || n <= 0 || n > buffer.length - offset) fail("WRITE_FAILED");
      offset += n;
    }
  }
  create(p, text) {
    const fd = this.open(p, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL);
    try { this.writeAll(fd, Buffer.from(text), 0); this.io.fsyncSync(fd); }
    finally { this.io.closeSync(fd); }
  }
  single(p, expectedKeys) {
    const { text } = this.read(p);
    if (!text.endsWith("\n")) fail("CORRUPT_STATE");
    const v = decoded(text.slice(0, -1)); keys(v, expectedKeys); return v;
  }
}

export function initializeStore({ stateDir, io = fs }) {
  const f = new Files(io);
  try {
    f.ancestors(path.dirname(stateDir));
    if (path.normalize(stateDir) !== stateDir || stateDir.endsWith("/") || !path.isAbsolute(stateDir)) fail("UNSAFE_PATH");
    io.mkdirSync(stateDir, { mode: 0o700 }); // exclusive provisioning; never repair/reinitialize an existing directory
    f.dir(stateDir); f.syncDir(path.dirname(stateDir));
    f.create(path.join(stateDir, "initializing"), line({ kind: "INITIALIZING", schemaVersion: 1 })); f.syncDir(stateDir);
    const storeId = uuid();
    f.create(path.join(stateDir, "store.json"), line({ kind: "STORE", schemaVersion: 1, storeId }));
    f.syncDir(stateDir); f.syncDir(path.dirname(stateDir));
    io.unlinkSync(path.join(stateDir, "initializing")); f.syncDir(stateDir);
    return Object.freeze({ stateDir, storeId });
  } catch (e) { throw ioError(e); }
}

export function openStore({ stateDir, storeId, io = fs }) {
  try { id(storeId); return new Store(stateDir, storeId, io); } catch (e) { throw ioError(e); }
}
class Store {
  #f; #root; #id; #inode;
  constructor(root, storeId, io) {
    this.#f = new Files(io); this.#root = root; this.#id = storeId;
    this.#inode = this.#f.dir(root); this.#check();
    // Re-establish durable naming before opening this explicitly provisioned store.
    this.#f.syncDir(root); this.#f.syncDir(path.dirname(root));
  }
  #check() {
    if (!sameInode(this.#inode, this.#f.dir(this.#root))) fail("IDENTITY_MISMATCH");
    try { this.#f.io.lstatSync(path.join(this.#root, "initializing")); fail("INITIALIZATION_INCOMPLETE"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
    let v;
    try { v = this.#f.single(path.join(this.#root, "store.json"), ["kind", "schemaVersion", "storeId"]); }
    catch (e) { if (e.code === "INVALID_SCHEMA") fail("CORRUPT_STATE"); throw e; }
    if (v.kind !== "STORE" || v.storeId !== this.#id) fail("IDENTITY_MISMATCH"); id(v.storeId);
  }
  #paths(b) {
    binding(b); this.#check();
    const dir = path.join(this.#root, digest(b));
    return { dir, journal: path.join(dir, "journal.jsonl"), lock: path.join(dir, "owner.lock") };
  }
  #lock(paths, journalId, b, token) {
    const body = { kind: "LOCK", schemaVersion: 1, storeId: this.#id, journalId, bindingDigest: digest(b), token };
    try { this.#f.create(paths.lock, line(body)); }
    catch (e) { if (e.code === "EEXIST") fail("WALLET_BUSY"); throw e; }
    this.#f.syncDir(paths.dir);
    return this.#f.read(paths.lock).stat;
  }
  #load(paths, descriptor) {
    try { return this.#decodeJournal(paths, descriptor); }
    catch (e) {
      if (e instanceof JournalError && ["UNSUPPORTED_SCHEMA", "IDENTITY_MISMATCH", "OWNERSHIP_UNCERTAIN", "UNSTABLE_READ", "UNSAFE_FILE", "UNSAFE_PATH", "UNSAFE_PERMISSIONS", "UNSUPPORTED_FILESYSTEM", "STATE_TOO_LARGE"].includes(e.code)) throw e;
      if (!(e instanceof JournalError) && e?.code) throw e;
      fail("CORRUPT_STATE");
    }
  }
  #decodeJournal(paths, descriptor) {
    this.#check(); this.#f.dir(paths.dir);
    const { text, stat } = this.#f.read(paths.journal);
    if (!text.endsWith("\n")) fail("CORRUPT_STATE");
    const lines = text.slice(0, -1).split("\n"); if (lines.length < 2) fail("CORRUPT_STATE");
    const header = decoded(lines[0]); keys(header, ["kind", "schemaVersion", "storeId", "journalId", "binding", "ownerToken"]);
    id(header.journalId); id(header.ownerToken); binding(header.binding);
    if (header.kind !== "HEADER" || header.storeId !== this.#id || header.journalId !== descriptor.journalId || canonical(header.binding) !== canonical(descriptor.binding)) fail("IDENTITY_MISMATCH");
    let previous = JSON.parse(lines[0]).digest, ownerToken = header.ownerToken, ownerOpen = true;
    const operations = new Map();
    for (let i = 1; i < lines.length - 1; i++) {
      const v = decoded(lines[i]);
      if (v.sequence !== String(i) || v.previousDigest !== previous) fail("CORRUPT_STATE");
      if (v.kind === "OWNER") {
        keys(v, ["kind", "schemaVersion", "sequence", "previousDigest", "token", "action"]); id(v.token);
        if (v.action === "OPEN" && !ownerOpen && v.token !== ownerToken) { ownerToken = v.token; ownerOpen = true; }
        else if (v.action === "CLOSE" && ownerOpen && v.token === ownerToken) ownerOpen = false;
        else fail("OWNERSHIP_UNCERTAIN");
      } else if (v.kind === "OP") {
        keys(v, ["kind", "schemaVersion", "sequence", "previousDigest", "ownerToken", "operation"]);
        if (!ownerOpen || v.ownerToken !== ownerToken) fail("OWNERSHIP_UNCERTAIN");
        const old = operations.get(v.operation.operationId);
        if (!old && [...operations.values()].some(o => o.status === "OPEN")) fail("UNRESOLVED_OPERATION");
        validateChange(old, v.operation, descriptor.binding.wallet, operations); operations.set(v.operation.operationId, v.operation);
      } else fail("CORRUPT_STATE");
      previous = JSON.parse(lines[i]).digest;
    }
    const footer = decoded(lines.at(-1)); keys(footer, ["kind", "schemaVersion", "sequence", "lastDigest"]);
    if (footer.kind !== "SEAL" || footer.sequence !== String(lines.length - 2) || footer.lastDigest !== previous) fail("CORRUPT_STATE");
    return { operations, ownerToken, ownerOpen, sequence: footer.sequence, previous, stat,
      sealOffset: Buffer.byteLength(text) - Buffer.byteLength(lines.at(-1) + "\n"), text };
  }
  #append(paths, descriptor, state, body) {
    const frame = { ...body, schemaVersion: 1, sequence: String(BigInt(state.sequence) + 1n), previousDigest: state.previous };
    const frameLine = line(frame), nextDigest = JSON.parse(frameLine).digest;
    const tail = Buffer.from(frameLine + line({ kind: "SEAL", schemaVersion: 1, sequence: frame.sequence, lastDigest: nextDigest }));
    if (state.sealOffset + tail.length > MAX_BYTES) fail("STATE_TOO_LARGE");
    const fd = this.#f.open(paths.journal, fs.constants.O_RDWR);
    try {
      if (!sameInode(state.stat, this.#f.io.fstatSync(fd, { bigint: true }))) fail("IDENTITY_MISMATCH");
      if (this.#f.io.readFileSync(fd, "utf8") !== state.text) fail("UNSTABLE_READ");
      // Replace the sole end seal; a torn write or boundary truncation leaves no valid seal.
      this.#f.writeAll(fd, tail, state.sealOffset);
      this.#f.io.ftruncateSync(fd, state.sealOffset + tail.length);
      this.#f.io.fsyncSync(fd); this.#f.syncDir(paths.dir);
    } finally { this.#f.io.closeSync(fd); }
    return this.#load(paths, descriptor);
  }
  createWallet(b) {
    try {
      const paths = this.#paths(b), journalId = uuid(), token = uuid();
      this.#f.io.mkdirSync(paths.dir, { mode: 0o700 }); this.#f.dir(paths.dir); this.#f.syncDir(this.#root);
      const descriptor = { journalId, binding: structuredClone(b) };
      this.#lock(paths, journalId, b, token);
      const header = { kind: "HEADER", schemaVersion: 1, storeId: this.#id, journalId, binding: b, ownerToken: token };
      const first = line(header);
      this.#f.create(paths.journal, first + line({ kind: "SEAL", schemaVersion: 1, sequence: "0", lastDigest: JSON.parse(first).digest }));
      this.#f.syncDir(paths.dir); this.#f.syncDir(this.#root);
      const state = this.#load(paths, descriptor);
      this.#append(paths, descriptor, state, { kind: "OWNER", token, action: "CLOSE" });
      this.#f.io.unlinkSync(paths.lock); this.#f.syncDir(paths.dir);
      return structuredClone(descriptor);
    } catch (e) { throw ioError(e); }
  }
  inspect(descriptor) {
    try {
      keys(descriptor, ["journalId", "binding"]); id(descriptor.journalId);
      const s = this.#load(this.#paths(descriptor.binding), descriptor);
      return { journalId: descriptor.journalId, binding: structuredClone(descriptor.binding), ownerOpen: s.ownerOpen, operations: structuredClone([...s.operations.values()]) };
    } catch (e) { throw ioError(e); }
  }
  acquire(descriptor) {
    try {
      keys(descriptor, ["journalId", "binding"]); id(descriptor.journalId);
      binding(descriptor.binding); descriptor = structuredClone(descriptor);
      const paths = this.#paths(descriptor.binding), inode = this.#f.dir(paths.dir), token = uuid();
      this.#load(paths, descriptor); // reject a wrong identity/corrupt state before creating ownership
      const lockInode = this.#lock(paths, descriptor.journalId, descriptor.binding, token);
      const state = this.#load(paths, descriptor);
      if (state.ownerOpen) fail("OWNERSHIP_UNCERTAIN");
      this.#append(paths, descriptor, state, { kind: "OWNER", token, action: "OPEN" });
      let closed = false, poisoned = false;
      const guard = () => {
        if (closed || poisoned) fail("OWNERSHIP_UNCERTAIN");
        if (!sameInode(inode, this.#f.dir(paths.dir))) fail("IDENTITY_MISMATCH");
        const lock = this.#f.single(paths.lock, ["kind", "schemaVersion", "storeId", "journalId", "bindingDigest", "token"]);
        if (!sameInode(lockInode, this.#f.read(paths.lock).stat) || lock.kind !== "LOCK" || lock.token !== token
            || lock.storeId !== this.#id || lock.journalId !== descriptor.journalId || lock.bindingDigest !== digest(descriptor.binding)) fail("OWNERSHIP_UNCERTAIN");
        const s = this.#load(paths, descriptor);
        if (!s.ownerOpen || s.ownerToken !== token) fail("OWNERSHIP_UNCERTAIN");
        return s;
      };
      const write = fn => {
        try {
          const s = guard(), next = fn(s);
          const old = s.operations.get(next.operationId); validateChange(old, next, descriptor.binding.wallet, s.operations);
          this.#append(paths, descriptor, s, { kind: "OP", ownerToken: token, operation: structuredClone(next) }); guard();
          return structuredClone(next);
        } catch (e) {
          if (!(e instanceof JournalError) || !["INVALID_SCHEMA", "INVALID_ID", "INVALID_HASH", "INVALID_ADDRESS", "INVALID_INTEGER", "INVALID_INTENT", "INVALID_CHILD", "INVALID_TRANSACTION", "INVALID_OPERATION", "INVALID_STATE", "INVALID_REASON", "INVALID_RECEIPT", "INVALID_TRANSITION", "UNRESOLVED_OPERATION", "NONCE_CONFLICT", "UNKNOWN_OPERATION", "UNKNOWN_CHILD"].includes(e.code)) poisoned = true;
          throw ioError(e);
        }
      };
      const find = (s, operationId) => { id(operationId); const v = s.operations.get(operationId); if (!v) fail("UNKNOWN_OPERATION"); return structuredClone(v); };
      return Object.freeze({
        admit: spec => write(s => {
          keys(spec, ["intent", "child"]); intent(spec.intent); childSpec(spec.child, spec.intent, descriptor.binding.wallet);
          if ([...s.operations.values()].some(o => o.status === "OPEN")) fail("UNRESOLVED_OPERATION");
          return { operationId: uuid(), intent: structuredClone(spec.intent), status: "OPEN", closure: null, children: [newChild(spec.child)] };
        }),
        addChild: (operationId, spec) => write(s => {
          const o = find(s, operationId);
          if ([...s.operations.values()].some(x => x.operationId !== operationId && x.status === "OPEN")) fail("UNRESOLVED_OPERATION");
          childSpec(spec, o.intent, descriptor.binding.wallet); o.children.push(newChild(spec)); return o;
        }),
        transition: (operationId, childId, patch) => write(s => {
          const o = find(s, operationId); id(childId); const index = o.children.findIndex(c => c.childId === childId); if (index < 0) fail("UNKNOWN_CHILD");
          // Re-check the mutation gate at the future broadcast boundary, including
          // contradictions discovered after this operation was first prepared.
          if (patch?.state === "SUBMITTING" && ([...s.operations.values()].some(x => x.operationId !== operationId && x.status === "OPEN")
              || o.children.slice(0, index).some(c => c.state !== "CONFIRMED"))) fail("UNRESOLVED_OPERATION");
          o.children[index] = updateChild(o.children[index], patch); o.status = "OPEN"; o.closure = null; return o;
        }),
        closeOperation: (operationId, closure = "RESOLVED") => write(s => { const o = find(s, operationId); o.status = "CLOSED"; o.closure = closure; return o; }),
        release: () => {
          if (closed || poisoned) fail("OWNERSHIP_UNCERTAIN");
          try {
            const s = guard(); closed = true; // this capability can never mutate again, even on release failure
            this.#append(paths, descriptor, s, { kind: "OWNER", token, action: "CLOSE" });
            this.#f.io.unlinkSync(paths.lock); this.#f.syncDir(paths.dir);
          } catch (e) { poisoned = true; throw ioError(e); }
        },
      });
    } catch (e) { throw ioError(e); } // never remove an uncertain/stale ownership file
  }
}
