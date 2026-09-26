'use strict';

const { toHalfWidthDigits } = require('./phone');

// 氏名の正規化（比較用）。空白除去・全角数字の半角化・トリムのみ行い、
// 表記ゆれ（カタカナ/ひらがな等）は正規化しない — 過剰な自動一致による
// 誤統合を避けるため、あえて緩めすぎない設計にしている。
function normalizeName(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).trim();
  s = toHalfWidthDigits(s);
  return s.replace(/\s+/g, '');
}

module.exports = { normalizeName };
