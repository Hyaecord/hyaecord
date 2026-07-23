import { networkInterfaces } from "node:os";

/**
 * Best-effort, heuristic VPN detection — looks for network interface names
 * common to VPN clients (WireGuard, OpenVPN, Mullvad, ProtonVPN, NordVPN's
 * NordLynx, generic tun/tap/ppp). This exists purely to inform the user why
 * Discord's login might be throwing up extra verification (Discord's own
 * anti-abuse systems are noticeably stricter about VPN/proxy IPs) — it never
 * blocks, alters, or routes around anything, just surfaces a heads-up.
 *
 * False negatives are expected (many VPN setups don't create a distinctly
 * named interface) and false positives are possible (a corporate/personal
 * `tun0` unrelated to a VPN) — treat the result as a hint, not a fact.
 */
const VPN_INTERFACE_PATTERNS = [
  /^wg\d*$/i, // WireGuard, Mullvad, generic
  /^tun\d*$/i, // OpenVPN and many others
  /^tap\d*$/i,
  /^ppp\d*$/i,
  /^nordlynx$/i,
  /^mullvad/i,
  /^protonvpn/i,
  /^outline/i
];

export function isLikelyUsingVpn(): boolean {
  const interfaces = Object.keys(networkInterfaces());
  return interfaces.some(name => VPN_INTERFACE_PATTERNS.some(pattern => pattern.test(name)));
}
