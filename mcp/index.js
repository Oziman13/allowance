#!/usr/bin/env node
// Allowance MCP server: gives an AI assistant a budget on Portaldot V3 that it cannot overspend.
// The assistant holds only the agent key. Limits, trusted recipients, expiry and the freeze switch
// are enforced by the Allowance contract, so a confused or prompt-injected assistant is still bound by them.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient, explain } from "./lib.js";

const env = process.env;
const die = (m) => { console.error(`allowance-mcp: ${m}`); process.exit(1); };
if (!env.ALLOWANCE_AGENT_KEY) die("Set ALLOWANCE_AGENT_KEY to the agent key from the Allowance dashboard. Never use your own wallet key.");
if (!env.ALLOWANCE_ADDRESS && (env.ALLOWANCE_NETWORK || "portaldot-testnet") !== "portaldot-testnet") die("Set ALLOWANCE_ADDRESS to the Allowance contract address.");

let client;
try {
  client = await createClient({
    key: env.ALLOWANCE_AGENT_KEY,
    address: env.ALLOWANCE_ADDRESS,
    network: env.ALLOWANCE_NETWORK || "portaldot-testnet",
    rpc: env.ALLOWANCE_RPC,
    accountId: env.ALLOWANCE_ACCOUNT_ID ? Number(env.ALLOWANCE_ACCOUNT_ID) : undefined,
  });
} catch (e) { die(e.message); }

const text = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
const fail = (e) => ({ ...text(`Not done: ${explain(e, client.iface)}`), isError: true });
const run = (fn) => async (args) => { try { return text(await fn(args)); } catch (e) { return fail(e); } };
const address = z.string().describe("Recipient address (0x...)");
const amount = z.union([z.number().positive(), z.string()]).describe("Amount in the allowance's currency, e.g. 0.25");

const server = new McpServer({ name: "allowance", version: "0.1.0" });

server.registerTool("allowance_status", {
  title: "Allowance: budget and rules",
  description: "Show your spending allowance on Portaldot: how much you can spend right now without asking, the limits, and whether the owner has frozen it. Call this before planning any purchase.",
  inputSchema: {},
}, run(() => client.status()));

server.registerTool("allowance_preview", {
  title: "Allowance: check a payment first",
  description: "Free dry run. Tells you whether paying `amount` to `to` would go through instantly, need the owner's approval (and why), or be blocked. Use it before allowance_pay so you can tell the user what will happen.",
  inputSchema: { to: address, amount },
}, run(({ to, amount }) => client.preview(to, amount)));

server.registerTool("allowance_pay", {
  title: "Allowance: pay",
  description: "Pay from your allowance. Inside the rules it settles immediately. Outside them (too large, over the period limit, untrusted recipient) it is NOT rejected: it is held for the owner's approval and you get a request_id. Never try to get around a hold by splitting a payment into smaller ones; the owner sees every payment. Always write a clear memo.",
  inputSchema: { to: address, amount, memo: z.string().min(3).max(140).describe("What this payment is for. The owner reads it when deciding.") },
}, run(({ to, amount, memo }) => client.pay(to, amount, memo)));

server.registerTool("allowance_request", {
  title: "Allowance: check a held payment",
  description: "See whether the owner approved, rejected or hasn't decided on a held payment yet.",
  inputSchema: { request_id: z.number().int().nonnegative() },
}, run(({ request_id }) => client.request(request_id)));

server.registerTool("allowance_cancel", {
  title: "Allowance: withdraw a held payment",
  description: "Withdraw one of your own pending requests, for example when the user no longer needs it.",
  inputSchema: { request_id: z.number().int().nonnegative() },
}, run(({ request_id }) => client.cancel(request_id)));

await server.connect(new StdioServerTransport());
console.error(`allowance-mcp: agent ${client.agent.address}, allowance #${client.accountId} on ${client.network.name}`);
