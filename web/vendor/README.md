# Pinned browser dependency

`ethers-6.13.4.umd.min.js` is the unmodified UMD distribution from ethers 6.13.4,
already used by this project. Its SHA-256 is:

`fd66c04651929c6a37806a37e8217e6b6aac07c7e816ad478f52690b7429bc61`

This was independently matched against both the installed npm package
(`mcp/node_modules/ethers/dist/ethers.umd.min.js`) and the official jsDelivr file:
https://cdn.jsdelivr.net/npm/ethers@6.13.4/dist/ethers.umd.min.js

The complete upstream MIT license is in `ethers-LICENSE.md`. `build.py` verifies
the pinned checksum and copies the file and license into `docs/vendor/`.
Serving the existing dependency locally removes a CDN availability/TLS dependency
from the demo. It does not upgrade ethers or change wallet/payment behavior.
