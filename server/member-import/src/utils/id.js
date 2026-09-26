'use strict';

const crypto = require('crypto');

// 新規会員IDを発行する。既存会員マスタのID体系と衝突しないよう "NEW-" 接頭辞を付ける。
// 実際の会員IDの命名規則が分かり次第、ここだけ差し替えればよい。
function generateNewMemberId() {
  return 'NEW-' + crypto.randomUUID().split('-')[0].toUpperCase();
}

module.exports = { generateNewMemberId };
