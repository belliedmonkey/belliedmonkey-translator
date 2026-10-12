// test/review-value-moment.test.js — 复习的「收获时刻」在两条完成路径上都要计（#453）。
//
// 一轮复习有两种完成：做满一组还有剩卡（showGroupDone），和正好把牌堆清空（落进
// #nothing-due 屏）。1.17.0 真机三轮全落在清空屏、rate_prompt 零条 —— 只有前一条在计。
// 修复（release/1.17.0 e59dff72，1.18.0 手移植 f768b0c3）只进了 release 分支，没回 main，
// 于是 1.19.x 又漏了。这里钉源码形状，免得下一次分支漂移再把它丢掉。
const fs = require('fs');
const path = require('path');
const { describe, test, ok } = require('./harness');

const REVIEW = fs.readFileSync(path.join(__dirname, '..', 'src/shared/review.js'), 'utf8');

describe('#453 · 清空牌堆也计一次收获时刻', () => {
  const a = REVIEW.indexOf("if (sess.open) sessEnd('done'); else sessNothingDue();");
  test('清空分支存在', () => ok(a >= 0, '找不到清空分支的 sessEnd/sessNothingDue 那一行'));
  const seg = REVIEW.slice(a - 400, REVIEW.indexOf('return;', a));
  test('sessEnd 之前快照 sess.open（sessEnd 会把它置 false）', () => {
    ok(/const wasOpen = sess\.open;\s*\n\s*if \(sess\.open\) sessEnd\('done'\)/.test(seg),
      '清空分支没有在 sessEnd 之前记下 wasOpen —— 守卫读到的永远是 false');
  });
  test('wasOpen 且本轮 ≥ RATING_MIN_DONE 张时调 noteValueMoment(\'review\')', () => {
    ok(/wasOpen && [\s\S]*doneThisRun >= MTFeedback\.RATING_MIN_DONE[\s\S]*noteValueMoment\('review'\)/.test(seg),
      '清空分支没有计收获时刻 —— 正好做完最后一张的人永远不会被请求评分');
  });
});
