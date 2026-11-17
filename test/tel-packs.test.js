// test/tel-packs.test.js — BEL-293 P0 报表的纯聚合口径（不连库）。
const { describe, test, ok, eq } = require('./harness');
const { aggregate, format } = require('../scripts/tel-packs');

describe('BEL-293 tel:packs 去重 / 覆盖率口径', () => {
  test('按 (install_id, name, download_id) 去重；无 download_id 的老行单独标注且不进去重/第二行覆盖率', () => {
    const rows = [
      { install_id: 'a', v: '1.23.4', props: { pack_kind: 'tts', code: 'tts_failed', reason: 'hash', surface: 'first_run_packs', download_id: 'd1' } },
      { install_id: 'a', v: '1.23.4', props: { pack_kind: 'tts', code: 'tts_failed', reason: 'hash', surface: 'first_run_packs', download_id: 'd1' } },
      { install_id: 'a', v: '1.23.4', props: { pack_kind: 'tts', code: 'tts_failed', reason: 'disk', surface: 'first_run_packs', download_id: 'd2' } },
      { install_id: 'b', v: '1.23.3', props: { pack_kind: 'asr', code: 'download_asr', surface: 'listen' } },
    ];
    const r = aggregate(rows);
    eq(r.total, 4);
    eq(r.deduped, 2, '同一 install_id + download_id 只算一次');
    eq(r.legacy, 1, '无 download_id 的老行单独计数');
    eq(r.withReason, 3, 'reason 覆盖率按全部 fail 计分母');
    eq(r.withReasonNonLegacy, 3);
    eq(r.withDownloadId, 3);
    eq(r.reasonCoverage, '75.0%');
    eq(r.missingDetail, 4, '没有 detail 的老行单独计，不折算成 other');
    const out = format(r, 30);
    ok(/detail=\(missing\)/.test(out), '缺 detail 必须显示 (missing)');
    ok(!/detail=other/.test(out), '缺 detail 不得被算成 other');
    ok(/n=2/.test(out), '分布要把重复行聚合计数');
    ok(/无 download_id 的老行：1 条/.test(out));
    ok(/去重（install_id \+ name \+ download_id）：2 次下载尝试/.test(out));
  });

  test('同一 download_id 换 reason 仍算一次；props 字符串也能解析', () => {
    const r = aggregate([
      { install_id: 'a', v: '1', props: JSON.stringify({ download_id: 'x', pack_kind: 'vad', reason: 'hash', code: 'download_vad', surface: 'listen' }) },
      { install_id: 'a', v: '1', props: { download_id: 'x', pack_kind: 'vad', reason: 'disk', code: 'download_vad', surface: 'listen' } },
    ]);
    eq(r.deduped, 1);
    eq(r.withReason, 2);
    eq(r.counts.length, 2, '分布按 reason 分开，不被去重合并');
    // detail 参与分布：同一个 download_id 换 detail 也分开；缺 detail 仍是 (missing)。
    const d = aggregate([
      { install_id: 'a', v: '1', props: { download_id: 'y', pack_kind: 'vad', reason: 'hash', code: 'download_vad', surface: 'listen', detail: 'sha' } },
      { install_id: 'a', v: '1', props: { download_id: 'y', pack_kind: 'vad', reason: 'hash', code: 'download_vad', surface: 'listen' } },
    ]);
    eq(d.counts.length, 2);
    eq(d.missingDetail, 1);
    ok(d.counts.some((c) => c.detail === 'sha') && d.counts.some((c) => c.detail === '(missing)'));
  });
});
