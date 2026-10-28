import { NativeController, walletSources } from './controller.mjs';
import { normalizeAccount, createInspector } from './runtime.mjs';
import { mountPanel } from './panel.mjs';

// Loaded on demand by the separate native button. No key material or EVM state enters here.
window.AllowanceNative = {
  mount(root, net, abi) {
    const injected = () => window.injectedWeb3 || {};
    const controller = new NativeController({ injected, normalize: normalizeAccount,
      inspect: createInspector(net, new window.ethers.Interface(abi)) });
    return mountPanel(root, controller, () => walletSources(injected()));
  },
};
