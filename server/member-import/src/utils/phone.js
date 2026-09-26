'use strict';

// 全角数字（０-９）を半角数字に変換する
function toHalfWidthDigits(str) {
  return str.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

// 電話番号の正規化。以下をすべて同一番号として扱う:
//   "090-1234-5678" / "09012345678" / "090 1234 5678" / 全角数字 / 前後スペース
// ハイフン・スペース・カッコ等は除去し、数字だけを比較キーにする。
// 電話番号を持たない(空欄)行は必ず空文字を返す — 呼び出し側はこれを
// 「照合しない・無条件で新規」の合図として扱うこと（氏名だけでの自動統合をしないため）。
function normalizePhone(value) {
  if (value === null || value === undefined) return '';
  let s = String(value).trim();
  s = toHalfWidthDigits(s);
  return s.replace(/[^0-9]/g, '');
}

module.exports = { normalizePhone, toHalfWidthDigits };
