#!/usr/bin/env python3
"""Print the Substrate (SS58) account that funds a MetaMask / 0x address on Portaldot V3.

On Portaldot V3 (pallet-revive) an Ethereum address H160 maps to the AccountId32
H160 ++ 0xEE * 12. Send POT from the Node Console or a Substrate wallet to the SS58
address printed here, and it shows up as the balance of the 0x address in MetaMask.

Usage: python3 script/fallback_address.py 0xYourAddress [ss58_prefix=42]
No dependencies beyond the Python standard library.
"""
import hashlib, sys

B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def b58encode(b: bytes) -> str:
    n = int.from_bytes(b, "big")
    out = ""
    while n:
        n, r = divmod(n, 58)
        out = B58[r] + out
    return "1" * (len(b) - len(b.lstrip(b"\0"))) + out


def ss58(account: bytes, prefix: int = 42) -> str:
    if prefix > 63:
        raise SystemExit("only simple prefixes (0-63) are supported")
    payload = bytes([prefix]) + account
    checksum = hashlib.blake2b(b"SS58PRE" + payload, digest_size=64).digest()[:2]
    return b58encode(payload + checksum)


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    h = sys.argv[1].lower().removeprefix("0x")
    if len(h) != 40 or any(c not in "0123456789abcdef" for c in h):
        raise SystemExit("expected a 0x address with 40 hex characters")
    prefix = int(sys.argv[2]) if len(sys.argv) > 2 else 42
    account = bytes.fromhex(h) + b"\xee" * 12
    print("AccountId32 (hex):", "0x" + account.hex())
    print(f"SS58 (prefix {prefix}):", ss58(account, prefix))


if __name__ == "__main__":
    main()
