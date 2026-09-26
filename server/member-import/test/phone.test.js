'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone } = require('../src/utils/phone');

test('同じ電話番号のさまざまな表記が同一の正規化結果になる', () => {
  const forms = ['090-1234-5678', '09012345678', '090 1234 5678', '０９０１２３４５６７８', '  09012345678  '];
  const normalized = forms.map(normalizePhone);
  normalized.forEach((n) => assert.equal(n, '09012345678'));
});

test('空欄・null・undefinedは空文字になる', () => {
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone(null), '');
  assert.equal(normalizePhone(undefined), '');
  assert.equal(normalizePhone('   '), '');
});

test('全角と半角が混在していても正しく数字だけ抽出する', () => {
  assert.equal(normalizePhone('０90-1234-５６78'), '09012345678');
});
