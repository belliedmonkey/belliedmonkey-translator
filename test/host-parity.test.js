// test/host-parity.test.js — 一个仓库，两个宿主（Claude Code + Reasonix）。
//
// 为什么需要这道门禁：这个仓库的配置面**靠"两个宿主都读同一个文件"来工作**，而那条
// 约定坏了的时候，没有别的东西会红。
//
//   · 有人给某个 skill 加了新目录，却建在 `.reasonix/skills/` 下 —— Claude Code 看不到
//     它，Reasonix 看到的又是另一个同名副本。两边各自"有"这个 skill，谁都不报错。
//   · 有人把 `.mcp.json` 里的 `gbrain` 写成绝对路径或补一个 access_token —— 提交进公开
//     仓库时才想起它是给人看的。2026-09-26 这次改造里，我自己先写了 `${HOME}/.bun/bin/gbrain`
//     和一条 `$comment`：前者 Reasonix 的静态回读**不展开**（doctor 报
//     `mcp.command_not_found`），后者是 Claude Code 的 schema 没承诺的字段。
//     这正是需要机器来盯的那类错误 —— 人写的时候两边都"看着对"。
//   · 有人删掉某个 SKILL.md 的 `description:` —— Claude Code 照用不误，Reasonix 的索引
//     条目却退化成占位描述，于是"自动挑 skill"这件事静默变差。
//
// 判据是**两份宿主解析出来的东西一致**，不是「文件存在」。CI 上拿不到 Reasonix 的运行时
// （也不该让 `npm test` 依赖一个本机二进制），所以这里只做**静态一致性**：文件在不在、
// 声明全不全、有没有第二个副本。真正的生效回读是人跑一次
// `reasonix doctor capabilities --json`（见 AGENTS.md > "Two hosts, one project"）。
const { describe, test, ok, eq } = require('./harness');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MCP = '.mcp.json';
const SKILL_ROOT = '.claude/skills';
// Reasonix 的约定根目录。留空是约定：填了一个，就等于有了第二份 skill 定义。
const OTHER_SKILL_ROOTS = ['.reasonix/skills', '.agents/skills', '.agent/skills'];
const ABS = (rel) => path.join(ROOT, rel);
const exists = (rel) => fs.existsSync(ABS(rel));

function parseFrontmatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(src);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

function walkStrings(v, fn, keyPath = '') {
  if (typeof v === 'string') return fn(v, keyPath);
  if (Array.isArray(v)) return v.forEach((x, i) => walkStrings(x, fn, `${keyPath}[${i}]`));
  if (v && typeof v === 'object') {
    return Object.keys(v).forEach((k) => walkStrings(v[k], fn, keyPath ? `${keyPath}.${k}` : k));
  }
}

function projectSkills() {
  if (!exists(SKILL_ROOT)) return [];
  return fs.readdirSync(ABS(SKILL_ROOT), { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(ABS(path.join(SKILL_ROOT, d.name, 'SKILL.md'))))
    .map((d) => d.name)
    .sort();
}

describe('two hosts, one project', () => {
  test('.mcp.json exists, parses, and every server declares a transport', () => {
    ok(exists(MCP), '.mcp.json is missing — it is the single source for this repo\'s MCP servers '
      + '(Claude Code reads it at project scope; Reasonix reads it as-is). See AGENTS.md.');
    let doc;
    try {
      doc = JSON.parse(fs.readFileSync(ABS(MCP), 'utf8'));
    } catch (e) {
      throw new Error(`.mcp.json is not valid JSON: ${e.message}`);
    }
    ok(doc.mcpServers && typeof doc.mcpServers === 'object', '.mcp.json has no `mcpServers` object');
    const names = Object.keys(doc.mcpServers);
    ok(names.length > 0, '.mcp.json declares no servers');
    for (const name of names) {
      const s = doc.mcpServers[name];
      const hasCommand = typeof s.command === 'string' && s.command.length > 0;
      const hasUrl = typeof s.url === 'string' && s.url.length > 0;
      ok(hasCommand || hasUrl, `server "${name}" declares neither \`command\` nor \`url\` — `
        + 'it would register as a server that can never start');
      ok(!(hasCommand && hasUrl), `server "${name}" declares both \`command\` and \`url\``);
      if (s.type !== undefined) {
        ok(['stdio', 'http', 'sse'].includes(s.type), `server "${name}" has unknown transport type ${JSON.stringify(s.type)}`);
        ok(s.type !== 'stdio' || hasCommand, `server "${name}" is stdio but has no \`command\``);
      }
    }
  });

  test('.mcp.json carries no personal absolute path and no inline credential', () => {
    // A public repo: an absolute home path makes the file work on exactly one machine,
    // and an inline token makes it a leak. Both were written for real on 2026-09-26.
    const doc = JSON.parse(fs.readFileSync(ABS(MCP), 'utf8'));
    const offenders = [];
    walkStrings(doc, (v, kp) => {
      if (/(^|[^A-Za-z0-9_])\/(Users|home)\//.test(v)) offenders.push(`${kp} holds an absolute home path: ${v}`);
      if (/(access[_-]?token|api[_-]?key|apikey|secret|password|bearer\s)/i.test(v)) {
        offenders.push(`${kp} looks like it holds a credential: ${v.replace(/=.+$/, '=…')}`);
      }
    });
    eq(offenders.length, 0, offenders.join('; '));
  });

  test('every project skill has name + description frontmatter (Reasonix indexes on it)', () => {
    const skills = projectSkills();
    ok(skills.length > 0, `no skills under ${SKILL_ROOT}/ — the project skills are shared by both hosts`);
    for (const dir of skills) {
      const src = fs.readFileSync(ABS(path.join(SKILL_ROOT, dir, 'SKILL.md')), 'utf8');
      const fm = parseFrontmatter(src);
      ok(fm, `${SKILL_ROOT}/${dir}/SKILL.md has no YAML frontmatter — Reasonix would index it by filename only`);
      eq(fm.name, dir, `${SKILL_ROOT}/${dir}/SKILL.md frontmatter name is ${JSON.stringify(fm.name)}, `
        + `but the directory is ${JSON.stringify(dir)} — the two hosts resolve the name differently if these disagree`);
      ok(fm.description && fm.description.length >= 20,
        `${SKILL_ROOT}/${dir}/SKILL.md has no usable \`description:\` — Claude Code still uses the skill, `
        + 'but Reasonix falls back to a placeholder index entry, so automatic skill selection degrades silently');
    }
  });

  test('no skill is defined in a second convention root (shadowing, not extension)', () => {
    const shared = new Set(projectSkills());
    const dupes = [];
    for (const root of OTHER_SKILL_ROOTS) {
      if (!exists(root)) continue;
      for (const d of fs.readdirSync(ABS(root), { withFileTypes: true })) {
        if (d.isDirectory() && shared.has(d.name)) dupes.push(`${root}/${d.name}`);
      }
    }
    eq(dupes.length, 0, `skill defined in two roots: ${dupes.join(', ')} — `
      + `keep one copy under ${SKILL_ROOT}/ (both hosts read it there); a second root shadows, it does not extend`);
  });

  test('instruction surface stays one copy: no REASONIX.md', () => {
    ok(!exists('REASONIX.md'),
      'REASONIX.md appeared. AGENTS.md + CLAUDE.md are already loaded by both hosts; a third file is '
      + 'a copy that will drift. Add to AGENTS.md instead (AGENTS.md > "Two hosts, one project").');
  });

  test('every skill path cited in the instruction docs exists', () => {
    // The docs route work to skills by path. Renaming a skill directory is the moment
    // that reference rots — silently, because nothing reads the path until an agent does.
    const cited = new Set();
    for (const doc of ['AGENTS.md', 'CLAUDE.md']) {
      if (!exists(doc)) continue;
      const src = fs.readFileSync(ABS(doc), 'utf8');
      for (const m of src.matchAll(/\.claude\/skills\/([A-Za-z0-9._-]+)\/SKILL\.md/g)) cited.add(m[1]);
    }
    const missing = [...cited].filter((name) => !exists(path.join(SKILL_ROOT, name, 'SKILL.md')));
    eq(missing.length, 0, `doc cites a skill that is not there: ${missing.map((n) => `${SKILL_ROOT}/${n}/SKILL.md`).join(', ')}`);
  });
});
