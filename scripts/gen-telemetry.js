#!/usr/bin/env node
// scripts/gen-telemetry.js — 把 build/telemetry.config.js 生成为边缘函数能 import 的 JSON。
// 用法：node scripts/gen-telemetry.js [--check]   （--check 只比对不写，CI/测试用）
'use strict';
const fs = require('fs');
const path = require('path');
const cfg = require('../build/telemetry.config.js');
const OUT = path.join(__dirname, '..', 'supabase', 'functions', 'bt-ingest', 'events.gen.json');
const text = JSON.stringify({
  _generated: 'by scripts/gen-telemetry.js from build/telemetry.config.js — do not edit',
  common: cfg.COMMON, events: cfg.EVENTS, limits: cfg.LIMITS,
}, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('✗ ' + path.relative(process.cwd(), OUT) + ' 与 build/telemetry.config.js 不一致，跑 node scripts/gen-telemetry.js'); process.exit(1); }
  console.log('✓ events.gen.json 与注册表一致');
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log('✓ wrote ' + path.relative(process.cwd(), OUT));
}
