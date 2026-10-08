// bt-models — 模型下载的**按 IP 选源**中继（2026-10-08，用户裁定）。
//
// 客户端永远只请求 `api.belliedmonkey.com/models/<file>`；由这一层按**请求方 IP**决定把它 302 到
// 哪一边：**中国 IP → ModelScope，其它 → Hugging Face 原站**。为什么放在服务端：
//   · 客户端不调任何第三方 IP 服务（用户明确要求），也不该知道真实托管地址（那是 #565 的中继纪律）；
//   · 判据只有服务端看得见 —— 这里读的是 **Caddy 写进来的 `X-Real-IP`**（`header_up X-Real-IP
//     {http.request.remote.host}`），**不是**客户端自带的 `X-Forwarded-For`（那个可以伪造）。
//
// 三条纪律：
//   1. **只认清单里的文件**（`models.json`）。不在清单里 ⇒ 404 —— 它不是一个通用代理，也不许变成。
//   2. **不做缓存决定**：302 带 `Cache-Control: no-store`，免得中间层把「按 IP 选的那一边」缓存下来
//      发给别人。
//   3. **失败自动换备源仍留给客户端**：`?src=other` 返回「按这条规则**不会**选的那一边」——
//      客户端在下载失败时用它重试（`bt_model_sources.url_alt` 与包内 `urlAlt` 都指向它）。
//      另外 `?src=cn` / `?src=intl` 是强制档，只给排查用。
//
// 部署：与 `fn` / `grant` / `bt-relay` 同一套（denoland/deno 容器 + 挂这个目录），
// Caddy 一侧只加**一条** handle（其余三条既有跳转一个字不动）：
//   handle /models/speechbrain-ecapa-voxlingua107.zip {
//       reverse_proxy bt-models:8000
//   }
// `X-Real-IP` 由 Caddy 的 `header_up` 写进来，见 deploy/china/Caddyfile。

const MODELS: Record<string, { cn: string; intl: string }> = JSON.parse(
  await Deno.readTextFile(new URL("./models.json", import.meta.url)),
);

// ── 中国 IP 段表（ipdeny 的聚合版，随目录一起部署；刷新见 refresh-cn-cidrs.sh）──
type V4 = { base: number; mask: number; bits: number };
const V4LIST: V4[] = [];
const V6LIST: string[] = [];
{
  const txt = await Deno.readTextFile(new URL("./cn-cidrs.txt", import.meta.url));
  for (const raw of txt.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.includes(":")) { V6LIST.push(line.toLowerCase()); continue; }   // IPv6 直接存字符串前缀
    const [a, b] = line.split("/");
    const bits = Number(b);
    if (!a || !(bits >= 0 && bits <= 32)) continue;
    const base = ipv4ToInt(a);
    if (base < 0) continue;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    V4LIST.push({ base: (base & mask) >>> 0, mask, bits });
  }
  V4LIST.sort((x, y) => y.bits - x.bits);   // 长前缀优先，先命中先返回
}

function ipv4ToInt(s: string): number {
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

/** 这个 IP 是不是中国（含港澳台按 ipdeny 的 cn 表口径）。拿不到 IP ⇒ false（当非中国，走 HF 原站）。 */
function isChina(ip: string): boolean {
  if (!ip) return false;
  const v = ip.trim().toLowerCase();
  if (v.includes(":")) {
    for (const net of V6LIST) {
      const pfx = net.split("/")[0];
      if (v === pfx || v.startsWith(pfx)) return true;   // 粗匹配够用：表是"网络前缀"级别
    }
    return false;
  }
  const n = ipv4ToInt(v);
  if (n < 0) return false;
  for (const r of V4LIST) if (((n & r.mask) >>> 0) === r.base) return true;
  return false;
}

function pick(file: string, ip: string, src: string | null): { url: string; side: string } | null {
  const m = MODELS[file];
  if (!m) return null;
  const autoCn = isChina(ip);
  const wantCn = src === "cn" ? true : src === "intl" ? false : src === "other" ? !autoCn : autoCn;
  return wantCn ? { url: m.cn, side: "cn" } : { url: m.intl, side: "intl" };
}

Deno.serve((req: Request) => {
  const u = new URL(req.url);
  const file = u.pathname.replace(/^\/models\//, "");
  const src = u.searchParams.get("src");
  // X-Real-IP 只信 Caddy 写的那一个（`header_up` 会**覆盖**掉客户端自带值）。
  const ip = req.headers.get("x-real-ip") || "";
  const hit = pick(file, ip, src);
  if (!hit) return new Response("not found\n", { status: 404, headers: { "content-type": "text/plain" } });
  return new Response(null, {
    status: 302,
    headers: { location: hit.url, "cache-control": "no-store" },
  });
});
