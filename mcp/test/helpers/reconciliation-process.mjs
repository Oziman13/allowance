// Keyless fresh-process observer. No key or raw transaction in argv/environment.
import { ethers } from "ethers";
import { createLocalReconciler } from "../../local-reconcile.js";
let signs = 0;
ethers.Wallet.prototype.signTransaction = () => { signs++; throw Error("keyless signing forbidden"); };
const { options, operationId, childId } = JSON.parse(process.argv[2]);
try {
  const result = await createLocalReconciler(options).reconcile(operationId, childId, { maxPolls: 1 });
  console.log(JSON.stringify({ result, signs }));
} catch (e) { console.log(JSON.stringify({ code: e.code, signs })); process.exitCode = 1; }
