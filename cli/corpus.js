// cli/corpus.js — 命令行宿主的语料（learning-design §9.10 / §7.2）。
//
// 语料是**一个 `mt-learn/1` 文件**，不是 `LearnStore` 的 IndexedDB（那绑浏览器源，CLI 没有）。
// 但格式与语义必须与扩展 / App **逐字一致**，否则导入导出的卡片对不上、同步会打架 —— 所以
// 这里只复用 `learn/chunk.js` 的编解码（build / toJsonl / fromJsonl / deflate / inflate）与
// `learn-model.js` 的合并规则，**不新写一套**。`LearnStore` 里那几段（mergeBatch / recordReview /
// applyDels / userDels）按同一规则在内存里重放，注释逐条标出对应处。
//
// 采集仍是 sink（domain-design §9.1 law 1）：capture 只读已经翻好的 (text, tr)，绝不改译文。
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const LearnModel = require(path.join(ROOT, 'extension/content/learn-model.js'));
const LearnScheduler = require(path.join(ROOT, 'extension/content/learn-scheduler.js'));
const LearnChunk = require(path.join(ROOT, 'extension/learn/chunk.js'));

// 语料文件位置：`$BM_CORPUS` → `$XDG_DATA_HOME/belliedmonkey/corpus.mtlearn` →
// `~/.local/share/belliedmonkey/corpus.mtlearn`。与 config 分开（一个可同步的语料，
// 一个本机凭证），互不影响。
function resolvePath(p) {
  if (p) return path.resolve(p);
  if (process.env.BM_CORPUS) return path.resolve(process.env.BM_CORPUS);
  const base = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'belliedmonkey', 'corpus.mtlearn');
}

class Corpus {
  constructor(file) {
    this.path = resolvePath(file);
    this.items = new Map();     // id → Item
    this.sources = new Map();   // id → {id,url,title,host,firstSeenAt}
    this.reviews = [];          // append-only [{itemId,grade,at,mode?,practice?,extra?}]
    this.dels = new Map();      // id → at（用户删除台账，§7.4）
    this.rules = null;          // learnRules（§8.9），CLI v1 只透传
  }

  allItems() { return [...this.items.values()]; }
  allSources() { return [...this.sources.values()]; }
  allReviews() { return this.reviews.slice(); }
  allDels() { return [...this.dels.entries()].map(([id, at]) => ({ id, at })); }
  itemById(id) { return this.items.get(id) || null; }

  stats() {
    const by = {};
    for (const it of this.items.values()) {
      const st = LearnScheduler.stateFor(it, LearnScheduler.DEFAULTS);
      by[st] = (by[st] || 0) + 1;
    }
    return { path: this.path, items: this.items.size, sources: this.sources.size,
      reviews: this.reviews.length, dels: this.dels.size, states: by };
  }

  // ── 载入 / 保存 / 导入 / 导出 ────────────────────────────────────────────
  async load() {
    if (!fs.existsSync(this.path)) return { empty: true, skipped: 0 };
    const bytes = new Uint8Array(fs.readFileSync(this.path));
    const text = await LearnChunk.inflate(bytes);
    const bundle = LearnChunk.fromJsonl(text);
    if (!bundle.header || bundle.header.format !== LearnChunk.FORMAT) {
      const e = new Error(`不是 ${LearnChunk.FORMAT} 文件：${this.path}`); e.code = 'bad_format'; throw e;
    }
    if (!LearnChunk.canRead(bundle.header)) {
      const e = new Error(`这个语料用 enc=${LearnChunk.encOf(bundle.header)}，本版本读不了`); e.code = 'enc_unsupported'; throw e;
    }
    return this.replay(bundle);
  }

  async save(now) {
    const t = now || Date.now();
    const bundle = LearnChunk.build(this.allItems(), this.allSources(), this.reviews, t, this.allDels(), this.rules);
    const bytes = await LearnChunk.deflate(LearnChunk.toJsonl(bundle));
    fs.mkdirSync(path.dirname(this.path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(this.path, Buffer.from(bytes));
    return { bytes: bytes.length, counts: bundle.header.counts };
  }

  // 导入一份**别的** `.mtlearn`（扩展 / App 的导出，或 CLI 自己的导出）。语义与
  // `load` 相同 —— 都是「重放一份拷贝」（accumulate:false），绝不累加计数器（§8.4.2）。
  async importFrom(file) {
    const abs = path.resolve(file);
    const bytes = new Uint8Array(fs.readFileSync(abs));
    const text = await LearnChunk.inflate(bytes);
    const bundle = LearnChunk.fromJsonl(text);
    if (!bundle.header || bundle.header.format !== LearnChunk.FORMAT) {
      const e = new Error(`不是 ${LearnChunk.FORMAT} 文件：${abs}`); e.code = 'bad_format'; throw e;
    }
    if (!LearnChunk.canRead(bundle.header)) {
      const e = new Error(`这个语料用 enc=${LearnChunk.encOf(bundle.header)}，本版本读不了`); e.code = 'enc_unsupported'; throw e;
    }
    const stats = this.replay(bundle);
    await this.save();
    return stats;
  }

  async exportTo(file, now) {
    const t = now || Date.now();
    const out = file ? path.resolve(file) : path.join(process.cwd(), LearnChunk.fileName(t));
    const bundle = LearnChunk.build(this.allItems(), this.allSources(), this.reviews, t, this.allDels(), this.rules);
    const bytes = await LearnChunk.deflate(LearnChunk.toJsonl(bundle));
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(bytes));
    return { path: out, bytes: bytes.length, counts: bundle.header.counts };
  }

  // ── 重放（对应 LearnStore + chunk.replay 的语义）─────────────────────────
  replay(bundle) {
    const stats = { cards: 0, sources: 0, reviews: 0, deleted: 0, skipped: bundle.skipped || 0 };
    // §7.4 删除先应用（两条路都应用：一个删除是用户意图，随语料走）。
    if (bundle.dels && bundle.dels.length) stats.deleted = this.applyDels(bundle.dels);
    // 台账抑制旧拷贝：重导入一份旧导出不能撤销删除（时间比较，§7.4）。
    let cards = bundle.cards || [];
    if (this.dels.size) {
      cards = cards.filter((c) => {
        const at = this.dels.get(c.id);
        return !(at !== undefined && at >= LearnModel.touchedAt(c));
      });
    }
    if (cards.length || (bundle.sources || []).length) {
      stats.cards = this.mergeBatch(cards, bundle.sources, { accumulate: false });
      stats.sources = (bundle.sources || []).length;
    }
    // 复习日志 append-only，按 (itemId, at) 去重（重放幂等）。
    const seen = new Set(this.reviews.map((r) => r.itemId + '|' + r.at));
    for (const r of bundle.reviews || []) {
      const key = r.itemId + '|' + r.at;
      if (seen.has(key)) continue;
      seen.add(key);
      this.reviews.push(Corpus.reviewRow(r.itemId, r.grade, r.at, r));
      stats.reviews++;
    }
    // §8.9 规则 LWW（整组覆盖）。
    if (bundle.rules && (!this.rules || (bundle.rules.updatedAt || 0) > (this.rules.updatedAt || 0))) {
      this.rules = bundle.rules;
    }
    return stats;
  }

  // 对应 LearnStore.mergeBatch：新卡进，旧卡按 LearnModel.mergeItem 合并。
  // `opts.accumulate` 默认 true（新观察累加）；重放一律传 false（拷贝，取 max）。
  mergeBatch(cards, sources, opts) {
    let added = 0;
    for (const src of sources || []) if (src && src.id) this.sources.set(src.id, src);
    for (const inc of cards || []) {
      if (!inc || !inc.id) continue;
      const prev = this.items.get(inc.id);
      if (!prev) added++;
      const merged = prev ? LearnModel.mergeItem(prev, inc, opts) : inc;
      // 与 store.js 的 mergeBatch 同一处：同步拉回来的物料打上「服务器已知」戳，
      // 按 touchedAt(inc) 而不是合并后的状态（否则本机新复习会被错误地标成已上传）。
      if (opts && opts.markSynced) {
        merged.syncedAt = Math.max(merged.syncedAt || 0, LearnModel.touchedAt(inc));
      }
      this.items.set(merged.id, merged);
    }
    return added;
  }

  // 对应 LearnStore.recordReview + review.js 的写入序列（applyReview → stateFor →
  // stampSkill → putItem → recordReview 一行）。CLI v1 只做 read 档（§5.4 其余技能随后补）。
  recordReview(itemId, grade, at, opts) {
    const t = at || Date.now();
    const o = opts || {};
    this.reviews.push(Corpus.reviewRow(itemId, grade, t, o));
    const item = this.items.get(itemId);
    if (!item) return;
    item.sched = LearnScheduler.applyReview(item.sched, grade, t, LearnScheduler.DEFAULTS);
    item.state = LearnScheduler.stateFor(item, LearnScheduler.DEFAULTS);
    item.lastSeenAt = Math.max(item.lastSeenAt || 0, t);
    if (o.skill) item.skills = LearnModel.mergeSkills(item.skills, { [o.skill]: t });
  }

  // 对应 LearnStore.applyDels：只删「删除之后没有动过」的卡（touchedAt ≤ at），
  // 台账 max(at) 始终 upsert。返回真实删掉的张数。
  applyDels(entries) {
    let deleted = 0;
    for (const e of entries || []) {
      if (!e || !e.id) continue;
      const at = e.at || 0;
      const it = this.items.get(e.id);
      if (it && LearnModel.touchedAt(it) <= at) {
        this.items.delete(e.id);
        this.reviews = this.reviews.filter((r) => r.itemId !== e.id);
        deleted++;
      }
      this.dels.set(e.id, Math.max(this.dels.get(e.id) || 0, at));
    }
    return deleted;
  }

  deleteItems(ids, at) {
    const t = at || Date.now();
    return this.applyDels((ids || []).map((id) => ({ id, at: t })));
  }

  // ── 采集（翻译时，§4.2 / §6）────────────────────────────────────────────
  // 把一段（已翻好的）(text, tr) 按句对齐拆分、造卡、并入语料。与扩展同一套规则与
  // 同一道 salience 门（§6）：门不过就不采。返回实际新增张数与跳过的对数。
  // `draft`: { lang?, targetLang?, sourceId?, anchor?, starred? }。
  capture(text, tr, draft, now) {
    const d = draft || {};
    const t = now || Date.now();
    const pairs = LearnModel.splitPair(text, tr, d.lang || 'und', d.targetLang || '');
    let added = 0, skipped = 0;
    const cards = [];
    for (const p of pairs) {
      const item = LearnModel.makeItem({
        text: p.text, tr: p.tr, lang: d.lang || 'und', targetLang: d.targetLang || '',
        sourceId: d.sourceId || '', kind: 'sentence',
        anchor: d.anchor || null,
        // 用户主动翻译这一段，等价于一次「读完」——门因此有据可过（§6）。
        dwellMs: LearnModel.DEFAULTS.DWELL_FULL_MS, seenCount: 1, starred: !!d.starred,
      }, t, LearnModel.DEFAULTS);
      if (!LearnModel.shouldCapture({
        text: p.text, tr: p.tr, starred: !!d.starred,
        dwellMs: LearnModel.DEFAULTS.DWELL_FULL_MS, seenCount: 1,
      }, LearnModel.DEFAULTS)) { skipped++; continue; }
      if (!this.items.has(item.id)) added++;
      this.mergeBatch([item], [], { accumulate: true });   // 新观察：累加（§8.4.2）
      cards.push(item);
    }
    return { added, skipped, cards };
  }

  static reviewRow(itemId, grade, at, opts) {
    const o = opts || {};
    const row = { itemId, grade, at };
    if (o.viaSync) row.viaSync = 1;
    if (o.practice) row.practice = 1;
    if (o.extra) row.extra = 1;
    if (o.mode) row.mode = o.mode;
    return row;
  }
}

module.exports = { Corpus, resolvePath };
