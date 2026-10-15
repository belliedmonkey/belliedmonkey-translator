# X-Real-IP 与 cn-cidrs.txt 打包 — 验证方案

日期：2026-10-15。issue [#592](https://github.com/belliedmonkey/belliedmonkey-translator/issues/592)。

这一份只是方案。不部署、不推送、不改线上 `bt-relay`、不改线上环境变量、不读密钥。下面的命令和函数代码是批准之后才允许执行的步骤，本次提交不执行。

要回答的三件事：

1. 托管 Edge Function 收到的请求上有没有 `X-Real-IP`。没有的话，代码该改读哪个头，只按官方文档建议，不靠试出来的头。
2. `cn-cidrs.txt` 会不会随 `supabase functions deploy` 带上。分两种：`static_files` 声明；放进 `_shared` 里被 import 的模块。
3. 读不到文件时，`bt-relay` 的 503 `grant_misconfigured` 是否如 `docs/relay-qwencloud-rollout.md` 第 3 节所述。

官方页面都在 2026-10-15 读过。文档没写的句子下面标「待确认」，不补一套猜测。

## 1. 依据和预期（先于实验）

### 1.1 请求头

| 页面 | 链接 | 适用范围 | 写了什么 | 没写什么 |
|---|---|---|---|---|
| CAPTCHA support with Cloudflare Turnstile | https://supabase.com/docs/guides/functions/examples/cloudflare-turnstile | 一个 Edge Function 示例。函数里读请求头，再把取出的地址交给 Turnstile 的 `remoteip` | `req.headers.get('x-forwarded-for')`，按逗号拆开，用第一段 | 不提 `X-Real-IP`，不提 `cf-connecting-ip`，不说平台会不会覆盖客户端自己带的值 |
| Authorization headers | https://supabase.com/docs/guides/functions/auth-headers | Edge Function 的平台 JWT 检查，在函数代码之前 | `verify_jwt` 默认开。缺、坏或密钥不对的 `Authorization` 时，平台回 401，函数代码不跑 | 不谈客户端 IP |
| Function Configuration | https://supabase.com/docs/guides/functions/function-configuration | 单个函数的 `config.toml` | 默认要有效 JWT。没有用户令牌的调用（页上的例子是 webhook）把 `verify_jwt` 设为 `false`。页上写：这样任何人都能调用 | 不谈客户端 IP |
| Supabase CLI config | https://supabase.com/docs/guides/local-development/cli/config | `config.toml` 字段 | `functions.<name>.verify_jwt` 默认 `true`。`--no-verify-jwt` 覆盖这份配置 | 不谈客户端 IP |
| Log sources and fields | https://supabase.com/docs/guides/observability/log-field-reference | 日志表里记哪些头 | API 网关日志（`edge_logs`）捕获的请求头包括 `x-real-ip`、`cf-connecting-ip`。同页写：别的头仍会到达应用和客户端，只是不进这些日志。Edge Function 调用的日志源是 `function_edge_logs`，字段表里的请求头是 `accept`、`content-length`、`host`、`user-agent` | 没有写函数的 `Request` 上一定有 `x-real-ip` |
| Securing your API | https://supabase.com/docs/guides/api/securing-your-api | Postgres `current_setting('request.headers')`，PostgREST | 用 `x-forwarded-for` 逗号前的第一段当客户端 IP | 不是 Edge Function。不拿来回答第 1 问 |
| Discovering and Interpreting API Errors in the Logs | https://supabase.com/docs/guides/troubleshooting/discovering-and-interpreting-api-errors-in-the-logs-7xREI9 | `edge_logs`，示例过滤的是 `/auth/v1/` | `cf-connecting-ip` 的说明是请求方 IP | 不是函数的 `Request`。不拿来改代码 |

`bt-relay` 今天读的是 `req.headers.get('x-real-ip')`（`supabase/functions/bt-relay/index.ts`，2026-10-15 在第 341 行）。`isChina` 对空字符串返回 false，当作非中国（`supabase/functions/bt-models/china-ip.ts` 第 38–40 行）。`bt-models` 文件头写的 `X-Real-IP` 是中国机 Caddy `header_up` 放进去的，不是托管 Supabase 的文档。

**预期。** 文档没有写托管函数的 `Request` 上有 `X-Real-IP`。这一条在实验之前是 **待确认**。实验只回答「有没有、值的格式是哪一种」，不回答「该改读哪个头」。改读哪个头只按上表：函数代码里被文档拿来当客户端 IP 的头，是 Turnstile 示例的 `x-forwarded-for` 第一段。平台会不会盖掉客户端自己写的这个头，文档没写，也是 **待确认**。在那条确认之前，方案不建议把中继改成读它。

### 1.2 `static_files`

| 页面 | 链接 | 写了什么 |
|---|---|---|
| Supabase CLI config | https://supabase.com/docs/guides/local-development/cli/config | `static_files` 默认 None。是要随函数打包的文件数组，可以写 glob。注：目前只支持 `functions` 目录里的路径 |
| Using Wasm modules | https://supabase.com/docs/guides/functions/wasm | 要打包的文件写进 `config.toml` 的 `static_files`。CLI 2.7.0 及以上才有这个字段。静态文件不能用 `--use-api` 部署，要在带 Docker 的 CLI 上构建 |
| Deploy to Production | https://supabase.com/docs/guides/functions/deploy | `supabase functions deploy` 部署 `functions` 目录里的全部函数；`supabase functions deploy <名字>` 部署一个。没有写未 import、也未列入 `static_files` 的兄弟文件会不会带上 |
| CLI Reference | https://supabase.com/docs/reference/cli/supabase-functions-deploy | `--use-api` 的说明是不用 Docker、在服务端打包。`--prune` 会删除项目里有、本地没有的函数 |

**预期。** 声明了 `static_files`、路径在 `functions/` 内、部署时不带 `--use-api`、CLI 不少于 2.7.0、本机有 Docker：文档写的是这些文件会随函数打包。`Deno.readTextFile(new URL(..., import.meta.url))` 是否读到这份打包文件，上述页面没有写。路径解析是 **待确认**。实验的预期读数是：`file.exists === true`，且 `file.lines` 等于部署前在仓库里数的非空行数。读不到则 `exists === false`、`lines === 0`，不把错误文本回出去。

### 1.3 `_shared` 里被 import 的模块

| 页面 | 链接 | 写了什么 |
|---|---|---|
| Development tips | https://supabase.com/docs/guides/functions/development-tips | 要在两个函数之间共享的代码，放在以下划线开头的目录里。示例是 `functions/_shared/*.ts` |
| Development Environment | https://supabase.com/docs/guides/functions/development-environment | 同样：共享代码放在下划线开头的目录 |
| Unable to call Edge Function | https://supabase.com/docs/guides/troubleshooting/unable-to-call-edge-function | 具体的相对 import：`import { corsHeaders } from '../_shared/cors.ts'` |
| AI Prompt: Writing Supabase Edge Functions | https://supabase.com/docs/guides/ai-tools/ai-prompts/edge-functions | 复用的工具放进 `supabase/functions/_shared`，用相对路径 import。不要在 Edge Function 之间互相依赖。入口是 `export default { fetch }`。`withSupabase` 会读预置的环境变量。文件写入只允许 `/tmp` |

这些页面写的是 import 一个 `.ts` 模块。没有写：模块里再 `readTextFile` 一个没有列入 `static_files` 的 `.txt`，那个 `.txt` 会不会在包里。也没有写「下划线目录不会被当成一个函数部署」。因此本方案的 `_shared` 方式不靠 `readTextFile`：段表原文放进被 import 的 `.ts` 字符串里。这和 `cors.ts` 那种「模块源码随相对 import 走」是同一类。`.txt` 靠 `readTextFile` 跟随模块，是 **待确认**，本方案不把它当成预期。

**预期。** 函数能起来，响应里 `shared.marker` 为 `tmp-probe-592`，`shared.lines` 等于仓库里那份 `cn-cidrs.txt` 的非空行数。marker 对但 lines 为 0：占位字符串没换成段表，实验无效，不解释成打包失败。函数起不来：相对 import 没有按文档工作，原因 **待确认**，不改 `bt-relay`。

`supabase functions deploy` 不带函数名会部署整个 `functions` 目录（Deploy 页）。下划线目录会不会因此变成一个线上函数，文档没写，**待确认**。所以实验只点名部署下面两个函数，不跑不带名字的 deploy，也不加 `--prune`。

### 1.4 读不到文件时的 503

这一条对的是源码和 `docs/relay-qwencloud-rollout.md` 第 3 节，不是对线上 `bt-relay` 发请求。线上函数和它的环境变量本次不动，所以托管环境里的 503 **本次不观测**，仍是 **待确认**。

源码（2026-10-15，`supabase/functions/bt-relay/index.ts`）：

- 只有 `UPSTREAM=qwencloud` 才读 `new URL("../bt-models/cn-cidrs.txt", import.meta.url)`（约第 164–174 行）。读抛错，或解析后的 IPv4 表为空，则 `CN_BAD`。日志一行 `relay cn_cidr` 加上抹掉 URL、截到 80 字的错误。没有令牌哈希。
- `OPTIONS` 在这道门之前返回，不是 503。
- 名单未设置（`QWENCLOUD_ALLOW_TOKEN_HASHES` 未设置）且 `CN_BAD`：每一个非 OPTIONS 请求，在验令牌之前返回 **503**，正文 `{"error":"grant_misconfigured"}`（约第 268 行）。不带令牌也是这个 503，不是 401。
- 名单已设置（含空串）：这道「验令牌之前」的 503 不发生。走 QwenCloud 的令牌在算出哈希之后同样 503（约第 307 行）。名单外不因为段表失败被这道门关掉。

这和部署清单第 3 节「读不到」那一条一致。本地 `test/bt-relay.test.js` 里的 `grant_misconfigured` 是中国 IP 没配转写模型，不是段表缺失。所以 503 的托管表现没有单测，也没有这次的线上观测。

探针返回 `file.exists === false` 只说明这次部署没读到文件。它不是 `bt-relay` 的 503。不要为了看 503 去部署 `bt-relay` 或修改它的环境变量。

## 2. 探针代码

两个函数，名字都以 `tmp-probe` 开头。只在批准之后创建。本次不把它们放进仓库。

共同约束：不读 `Deno.env`，不用 `withSupabase`（写作提示里它会读预置密钥），不 `fetch` 任何地址，不写日志，不回请求头原文，不回段表正文，不回密钥。只回三个头各自的有无和格式，以及文件是否存在、非空行数。格式只有 `absent`、`empty`、`ipv4`、`ipv6`、`comma-list`、`other`。

仓库里目前没有 `supabase/config.toml`。实验时新建的 toml 只放第 3 节那两段，不要用 `supabase init` 覆盖现有的 `supabase/`。

### 2.1 `tmp-probe-592-static`

`supabase/functions/tmp-probe-592-static/index.ts`：

```ts
const HEADER_NAMES = ["x-real-ip", "x-forwarded-for", "cf-connecting-ip"] as const;

function headerShape(raw: string | null): { present: boolean; format: string } {
  if (raw === null) return { present: false, format: "absent" };
  const s = raw.trim();
  if (s.length === 0) return { present: true, format: "empty" };
  if (s.includes(",")) return { present: true, format: "comma-list" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return { present: true, format: "ipv4" };
  if (s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s)) return { present: true, format: "ipv6" };
  return { present: true, format: "other" };
}

async function fileLines(url: URL): Promise<{ exists: boolean; lines: number }> {
  try {
    const txt = await Deno.readTextFile(url);
    let lines = 0;
    for (const raw of txt.split(/\r?\n/)) {
      if (raw.trim().length > 0) lines += 1;
    }
    return { exists: true, lines };
  } catch {
    return { exists: false, lines: 0 };
  }
}

export default {
  fetch: async (req: Request) => {
    if (req.method !== "GET") {
      return Response.json({ error: "method" }, { status: 405 });
    }
    const headers: Record<string, { present: boolean; format: string }> = {};
    for (const name of HEADER_NAMES) {
      headers[name] = headerShape(req.headers.get(name));
    }
    const file = await fileLines(new URL("../bt-models/cn-cidrs.txt", import.meta.url));
    return Response.json({ probe: "tmp-probe-592-static", headers, file });
  },
};
```

相对路径与 `bt-relay` 相同：函数目录和 `bt-models` 是兄弟。不 import `bt-models` 或 `bt-relay` 的代码。写作提示禁止函数之间互相依赖；这里只读那个 `.txt`，不 import 另一个函数。

`supabase/config.toml` 里只加：

```toml
[functions.tmp-probe-592-static]
verify_jwt = false
static_files = [ "./functions/bt-models/cn-cidrs.txt" ]
```

路径写法与 CLI config 页、Wasm 页的示例一致：相对 `config.toml` 所在的 `supabase/` 目录，且落在 `functions/` 内。

### 2.2 `tmp-probe-592-shared`

`supabase/functions/_shared/tmp-probe-592-cidr.ts`：

```ts
export const marker = "tmp-probe-592";

// 批准部署之前，把 supabase/functions/bt-models/cn-cidrs.txt 的原文换进这个常量。
// 方案文档保持空字符串，不抄段表。空字符串时 lines 为 0，那次实验作废。
export const CIDR_TEXT = "";

export function lineCount(text: string): number {
  let lines = 0;
  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim().length > 0) lines += 1;
  }
  return lines;
}
```

`supabase/functions/tmp-probe-592-shared/index.ts`：

```ts
import { CIDR_TEXT, lineCount, marker } from "../_shared/tmp-probe-592-cidr.ts";

const HEADER_NAMES = ["x-real-ip", "x-forwarded-for", "cf-connecting-ip"] as const;

function headerShape(raw: string | null): { present: boolean; format: string } {
  if (raw === null) return { present: false, format: "absent" };
  const s = raw.trim();
  if (s.length === 0) return { present: true, format: "empty" };
  if (s.includes(",")) return { present: true, format: "comma-list" };
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return { present: true, format: "ipv4" };
  if (s.includes(":") && /^[0-9a-fA-F:.]+$/.test(s)) return { present: true, format: "ipv6" };
  return { present: true, format: "other" };
}

export default {
  fetch: async (req: Request) => {
    if (req.method !== "GET") {
      return Response.json({ error: "method" }, { status: 405 });
    }
    const headers: Record<string, { present: boolean; format: string }> = {};
    for (const name of HEADER_NAMES) {
      headers[name] = headerShape(req.headers.get(name));
    }
    return Response.json({
      probe: "tmp-probe-592-shared",
      headers,
      shared: { marker, lines: lineCount(CIDR_TEXT) },
    });
  },
};
```

这个函数不声明 `static_files`，也不 `readTextFile`。响应里没有 `CIDR_TEXT`。

```toml
[functions.tmp-probe-592-shared]
verify_jwt = false
```

## 3. 部署和删除

在仓库根目录执行。CLI 用已经 `supabase link` 过的项目（Deploy 页的 link 步骤）。不在命令行和文档里写 project ref。还没 link：先停下，那一步也要批准，本方案不替它执行。

**JWT 关掉。** 依据：Function Configuration 与 Authorization headers。默认 `verify_jwt` 为 true；没有合法用户 JWT 时平台回 401，函数代码不执行，头和文件都看不到。这个探针由用户用 curl 调用，不带用户 JWT，也不带密钥。Authorization headers 写过另一种走法：`apikey` 上的 publishable key 也能通过平台检查。那要碰密钥，本方案不用。因此 `config.toml` 写 `verify_jwt = false`，部署命令再带 `--no-verify-jwt`。CLI config 页写明这个 flag 覆盖 toml。Function Configuration 写明关掉之后任何人都能调用，风险见第 5 节。

部署命令只点名，不带 `--use-api`，不带 `--prune`，不部署其他函数：

```bash
supabase functions deploy tmp-probe-592-static --no-verify-jwt
supabase functions deploy tmp-probe-592-shared --no-verify-jwt
```

`static` 那条按 Wasm 页：不用 `--use-api`，CLI ≥ 2.7.0，本机要有 Docker。没有 Docker 就停，不要改用 `--use-api` 再看结果。`shared` 那条文档没有禁止 `--use-api`；为了不换成另一种打包器，同样不用。

Deploy 页写的线上地址是 `https://<project-ref>.supabase.co/functions/v1/<函数名>`。ref 用本机 link 的那个，不写进本文件。

测完立刻删除。CLI Reference：`supabase functions delete <Function name>` 从已 link 的项目删除函数，**不**删除本地文件。该节没有列出 flags，所以不加文档没写的 flag。

```bash
supabase functions delete tmp-probe-592-static
supabase functions delete tmp-probe-592-shared
supabase functions list
```

**确认已删除：** `supabase functions list`（CLI Reference：列出已 link 项目里的全部函数）的输出里没有这两个名字。删除后的 URL 回什么状态码，CLI 页和 Deploy 页都没写，**待确认**，不用一次 curl 的状态码代替 `functions list`。

然后删掉本地的两个函数目录、`_shared/tmp-probe-592-cidr.ts`，以及 toml 里的两段。这些本地文件不要提交。不要接着跑不带名字的 `supabase functions deploy`，也不要跑带 `--prune` 的部署。

## 4. 谁来发请求

用户在自己的网络上发 GET。不要设置 `x-real-ip`、`x-forwarded-for`、`cf-connecting-ip`。平台会不会盖掉客户端自己写的这些头，文档没写；自己带了，响应里的「有」就不能说明是平台写的。不要带 `Authorization`，不要带 `apikey`，不要带正文。

```bash
curl -sS 'https://<project-ref>.supabase.co/functions/v1/tmp-probe-592-static'
curl -sS 'https://<project-ref>.supabase.co/functions/v1/tmp-probe-592-shared'
```

第一次是用户当前的出口。不事先把它叫做中国或非中国。

第二次要另一条出口，其地址不在 `cn-cidrs.txt` 里。本方案不假设用户有 VPN，也不指定跳板、云主机或公开代理。用户没有这样一条出口，第二次 **做不到**。不要为了凑第二次去改请求头。

格式里没有国家。`ipv4` 和 `comma-list` 都看不出是不是中国。这两次请求回答的是：两种出口上这三个头在不在、格式是不是单个地址或逗号列表。不能靠它们判断 `isChina`。探针按第 2 节不回地址，也不回匹配结果。

头的问题打 `tmp-probe-592-static` 一次就够（`shared` 回的是同一组头）。两个函数都要各打一次，才能分开看两种打包。有第二条出口时，只对 `static` 再打一次。打完就删除，不要留到下一天。

响应若出现 IP 原文、段表正文或任何密钥：不要贴进 issue，立刻按第 3 节删除。

## 5. 风险，以及要批准的步骤

函数在 `verify_jwt = false` 时公开可访问（Function Configuration 的原文警告）。响应只有第 2 节那几项。不转发。不读环境变量。平台自己的 `function_edge_logs` 仍可能记下 `accept`、`content-length`、`host`、`user-agent`（Log sources and fields）；函数代码不把 IP 头打进 `console`。

要用户点头之后才能做的步骤，按这个顺序：

1. 在工作树里新建第 2 节的两个目录、`_shared` 模块（把段表原文换进 `CIDR_TEXT`）、以及只含两段的 `config.toml`。不提交。
2. 确认 CLI ≥ 2.7.0，且 Docker 可用。否则 `static` 那份停。
3. 点名部署两个函数，命令与第 3 节相同。
4. 用户按第 4 节发请求。没有第二条出口就只发当前网络。
5. 点名删除两个函数，用 `functions list` 确认名字不在。
6. 删掉本地临时文件和 toml 两段。

本次提交不包含 1–6。不批准就不做。

## 6. 通过标准和下一步

下一步只是建议。本方案不改 `bt-relay`。

| 读数 | 下一步 |
|---|---|
| `x-real-ip` 的格式是 `ipv4` 或 `ipv6` | 中继继续读 `x-real-ip`。不改。空值仍是非中国，这是 `isChina` 的现有行为 |
| `x-real-ip` 是 `absent` 或 `empty`，`x-forwarded-for` 是 `ipv4`、`ipv6` 或 `comma-list` | 文档里函数侧的客户端 IP 读法是 Turnstile 示例：`x-forwarded-for` 拆开后的第一段。平台是否覆盖客户端自带的值仍是待确认。确认之前不改代码 |
| 只有 `cf-connecting-ip` 有值 | 这个头的「请求方 IP」说明在 API 日志页，不在函数 `Request` 的文档里。不改代码 |
| 三个都是 `absent` | 不从别的头里猜。停 |
| `static` 的 `file.exists` 为 true，且 `lines` 等于仓库非空行数 | `static_files` 加上这次的 `readTextFile` 读到了文件。路径解析被这次实验回答，不再是待确认 |
| `static` 的 `exists` 为 false，或 `lines` 对不上 | 不把 `bt-relay` 改成这条。不用 `--use-api` 重试。停下来把读数记进 issue |
| `shared.marker` 为 `tmp-probe-592` 且 `lines` 等于仓库非空行数 | 段表正文放进被 import 的 `_shared` 模块这条，按文档的相对 import 走通了 |
| marker 对、`lines` 为 0 | 占位没换。实验作废，重做。不解释成打包失败 |
| `shared` 函数起不来 | 不改 `bt-relay`。原因待确认 |
| 想看 `bt-relay` 线上 503 | 不做。那要部署 `bt-relay` 或改它的环境变量。源码预期已在第 1.4 节 |

非空行数在部署前数：仓库文件 `supabase/functions/bt-models/cn-cidrs.txt` 里，去掉首尾空白后长度大于 0 的行。与两份探针的计数相同，包含以 `#` 开头的行。这是「文件在不在」的计数，不是 `parseChinaCidrs` 的有效段数。

## 7. 仍是待确认

- 托管函数的 `Request` 上有没有 `X-Real-IP`。文档没写。等第 4 节的响应。
- 平台会不会覆盖客户端自己带的 `x-forwarded-for`、`x-real-ip`、`cf-connecting-ip`。文档没写。所以未确认之前不改中继去读 `x-forwarded-for`。
- `static_files` 打包之后，`Deno.readTextFile(import.meta.url)` 是否读到该文件。文档只写了会打包。
- 被 import 的模块里再 `readTextFile` 一个未列入 `static_files` 的 `.txt`，那个 txt 会不会在。本方案不靠这种读法。
- 下划线目录会不会在「不带名字的 `functions deploy`」里变成一个函数。所以禁止那条命令。
- 删除之后 URL 的 HTTP 状态。确认删除只看 `functions list`。
- 托管上的 `bt-relay` 在读不到段表时是否 503。本次不部署、不改环境变量，不观测。
- 用户没有中国段表以外的出口时，第二次请求做不到。

## 所依据的规约

- BAN-39（`docs/conventions-digest.md`，来源 `AGENTS.md`）：涉及 Supabase 的说法先查该服务自己的文档，写明页面、链接、适用范围和日期。没写的标待确认，不靠试。
- `docs/relay-qwencloud-rollout.md` 第 3 节：段表读不到时的 503，以及 `X-Real-IP` 仍待确认。本方案不执行那份清单。
- `docs/learning-design.md` §8.10：中继不记录内容。探针不回地址、不回段表、不读密钥。
- 并行 session：只在 `mobiletranslator-592` 新增这一份文档。没有碰 `main`，没有碰 `release/1.19.0`。
