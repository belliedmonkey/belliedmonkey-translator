// test/ext-vault-learn.test.js — ExtVault 对 learnEnabled 的缺键/显式 false（#125）。
// Swift 侧逻辑：`c.learnEnabled = (obj["learnEnabled"] as? Bool) ?? true`
'use strict';
const { describe, test, eq } = require('./harness');

function parseLearnEnabled(obj) {
  return (obj.learnEnabled != null && typeof obj.learnEnabled === 'boolean')
    ? obj.learnEnabled
    : true;
}

describe('ExtVault learnEnabled 解码（与 ExtVault.swift 同形）', () => {
  test('快照里 false → 扩展读 false', () => {
    eq(parseLearnEnabled({ learnEnabled: false }), false);
  });

  test('快照里 true → 扩展读 true', () => {
    eq(parseLearnEnabled({ learnEnabled: true }), true);
  });

  test('快照缺键 → 扩展读 true', () => {
    eq(parseLearnEnabled({}), true);
  });
});
