// 中国 IP 段匹配。bt-models 与 bt-relay 共用这一份（#592，2026-10-15）。
// 段表不在这里读：调用方把 cn-cidrs.txt 的文本传进来。算法与抽出前 bt-models 里的
// 那一份相同（ipdeny 聚合表，长前缀优先；IPv6 仍是网络前缀的字符串粗匹配）。

export type V4 = { base: number; mask: number; bits: number };

export function ipv4ToInt(s: string): number {
  const p = s.split(".");
  if (p.length !== 4) return -1;
  let out = 0;
  for (const x of p) {
    const n = Number(x);
    if (!Number.isInteger(n) || n < 0 || n > 255) return -1;
    out = ((out << 8) | n) >>> 0;
  }
  return out >>> 0;
}

export function parseChinaCidrs(txt: string): { v4: V4[]; v6: string[] } {
  const v4: V4[] = [];
  const v6: string[] = [];
  for (const raw of txt.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes(":")) { v6.push(line.toLowerCase()); continue; }
    const [a, b] = line.split("/");
    const bits = Number(b);
    if (!a || !(bits >= 0 && bits <= 32)) continue;
    const base = ipv4ToInt(a);
    if (base < 0) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    v4.push({ base: (base & mask) >>> 0, mask, bits });
  }
  v4.sort((x, y) => y.bits - x.bits);
  return { v4, v6 };
}

/** 拿不到 IP、或解析不了 ⇒ false（当非中国）。 */
export function isChina(ip: string, v4: V4[], v6: string[]): boolean {
  if (!ip) return false;
  const v = ip.trim().toLowerCase();
  if (v.includes(":")) {
    for (const net of v6) {
      const pfx = net.split("/")[0];
      if (v === pfx || v.startsWith(pfx)) return true;
    }
    return false;
  }
  const n = ipv4ToInt(v);
  if (n < 0) return false;
  for (const r of v4) if (((n & r.mask) >>> 0) === r.base) return true;
  return false;
}
