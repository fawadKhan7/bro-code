/** Network-group derivation.
 *
 *  Discovery is network-scoped: you only see, and can only connect to, users who
 *  reach the coordinator from the same network. The group id is derived from the
 *  socket's source IP — never from anything the client claims.
 *
 *  On a LAN both users hit the coordinator directly, so their source addresses are
 *  private and share a /24. Behind NAT they'd share a public IP; that case collapses
 *  to the same rule with the full address as the key.
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Strip the IPv4-mapped-IPv6 prefix node hands us for v4 sockets. */
export function normalizeAddress(address: string | undefined): string {
  if (!address) return "";
  let addr = address.trim();
  if (addr.startsWith("[") && addr.includes("]")) addr = addr.slice(1, addr.indexOf("]"));
  if (addr.toLowerCase().startsWith("::ffff:")) addr = addr.slice(7);
  // Drop an IPv6 zone index (fe80::1%en0).
  const zone = addr.indexOf("%");
  if (zone !== -1) addr = addr.slice(0, zone);
  return addr;
}

function isPrivateV4(a: number, b: number): boolean {
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  return false;
}

/** Group key for a source address. Same key = same roster. */
export function deriveNetworkId(remoteAddress: string | undefined): string {
  const addr = normalizeAddress(remoteAddress);
  if (!addr) return "unknown";
  if (addr === "::1" || addr === "127.0.0.1") return "lan:loopback";

  const v4 = IPV4.exec(addr);
  if (v4) {
    const [a, b, c] = [Number(v4[1]), Number(v4[2]), Number(v4[3])];
    // A LAN puts both machines in the same /24 — that is the group.
    if (isPrivateV4(a, b)) return `lan:${a}.${b}.${c}`;
    // Public source: everyone behind one NAT shares the address exactly.
    return `wan:${addr}`;
  }

  const lower = addr.toLowerCase();
  const firstHextet = parseInt(lower.split(":")[0] || "0", 16);
  const uniqueLocal = (firstHextet & 0xfe00) === 0xfc00; // fc00::/7
  const linkLocal = lower.startsWith("fe80");
  if (uniqueLocal || linkLocal) {
    // Group on the /64 prefix, the IPv6 equivalent of a LAN segment.
    return `lan6:${lower.split(":").slice(0, 4).join(":")}`;
  }
  return `wan6:${lower}`;
}

/** Two machines on one LAN can be developed against from a single host; that is the
 *  only reason a client is ever allowed to name its own group. Off by default. */
export function networkOverrideAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.COORD_ALLOW_NETWORK_OVERRIDE === "1";
}
