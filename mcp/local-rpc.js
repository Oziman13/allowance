// Experimental adapter transport. Literal loopback HTTP only, one request/end,
// no redirects, retries, connection pooling, SDK batching or background polling.
import http from "node:http";

export class LocalRpcError extends Error {
  constructor(code) { super(code); this.name = "LocalRpcError"; this.code = code; }
}
export function loopbackUrl(value) {
  let u; try { u = new URL(value); } catch { throw new LocalRpcError("INVALID_LOCAL_ENDPOINT"); }
  if (typeof value !== "string" || u.protocol !== "http:" || u.hostname !== "127.0.0.1" || !u.port
      || u.username || u.password || u.pathname !== "/" || u.search || u.hash
      || value !== `http://127.0.0.1:${u.port}` && value !== `http://127.0.0.1:${u.port}/`) throw new LocalRpcError("INVALID_LOCAL_ENDPOINT");
  return u;
}
export function localRpc(endpoint, method, params, { signal, active, authorize = () => {} }) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method, params });
  return new Promise((resolve, reject) => {
    let done = false, sent = false, request;
    const finish = (error, value) => {
      if (done) return; done = true; signal.removeEventListener("abort", abort);
      if (error) { request?.destroy(); reject(error); } else resolve(value);
    };
    const abort = () => finish(new LocalRpcError("ABORTED"));
    if (signal.aborted) { finish(new LocalRpcError("ABORTED")); return; }
    signal.addEventListener("abort", abort, { once: true });
    try {
      active();
      request = http.request(endpoint, { method: "POST", agent: false,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, response => {
        if (response.statusCode !== 200) { response.resume(); finish(new LocalRpcError(response.statusCode === 429 ? "HTTP_429" : "HTTP_STATUS")); return; }
        let bytes = 0; const chunks = [];
        response.on("data", chunk => {
          bytes += chunk.length;
          if (bytes > 512 * 1024) { response.destroy(); finish(new LocalRpcError("RPC_RESPONSE_LIMIT")); return; }
          chunks.push(chunk);
        });
        response.on("error", () => finish(new LocalRpcError("RPC_TRANSPORT")));
        response.on("aborted", () => finish(new LocalRpcError("RPC_TRANSPORT")));
        response.on("end", () => {
          if (done) return;
          try {
            active(); const v = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if (!v || v.jsonrpc !== "2.0" || v.id !== 1 || Object.hasOwn(v, "result") === Object.hasOwn(v, "error")) throw new LocalRpcError("RPC_RESPONSE");
            if (Object.hasOwn(v, "error")) throw new LocalRpcError("RPC_ERROR");
            finish(null, v.result);
          } catch (e) { finish(e instanceof LocalRpcError ? e : new LocalRpcError("RPC_RESPONSE")); }
        });
      });
      request.on("error", () => finish(new LocalRpcError("RPC_TRANSPORT")));
      request.once("socket", socket => {
        const send = () => {
          if (done || sent) return;
          try {
            active(); authorize(); active(); // No await between final authorization and end.
            sent = true; request.end(body);
          } catch (e) { finish(e); }
        };
        if (socket.connecting) socket.once("connect", send); else send();
      });
    } catch (e) { finish(e); }
  });
}
