'use strict';

const { normalizePhone } = require('../utils/phone');
const { findHeaderIndex } = require('./matching');
const defaultConfig = require('../config');

/**
 * 二重チェック機構。
 *
 * 1) 方式A(スプレッドシート側の生データを直接数える) と
 *    方式B(保存済みの判定結果=import-stateを集計する) を突き合わせ、
 *    「電話番号空欄の行」と「BLANK_NEW判定の行」が1対1で対応しているか検証する。
 * 2) ID発行の整合性検査:
 *    - 同一電話番号(NEW判定)に複数の異なる新規IDが発行されていないか
 *    - 同一の新規IDが複数の異なる電話番号に発行されていないか
 *    （このどちらかが起きていたら「同じ人に複数ID」または「別人に同じID」という
 *      最重要リスクが現実に発生しているということなので、最優先で警告する）
 */
async function runValidation({ sheetSource, importStateRepo, workLog, config }) {
  const cfg = config || defaultConfig;
  const problems = [];

  const { headers, rows } = await sheetSource.fetchHeaderAndRows();
  const phoneCol = findHeaderIndex(headers, cfg.PHONE_HEADER_CANDIDATES);
  if (phoneCol === -1) {
    const msg = '⚠ 検証失敗：電話番号列が見つかりません';
    workLog.log({ phase: 'validation', type: 'error', message: msg });
    return { ok: false, problems: [msg] };
  }

  const state = importStateRepo.loadAll();
  const byRowNumber = state.byRowNumber || {};

  let crossCheckMismatch = 0;
  let checkedRows = 0;

  Object.keys(byRowNumber).forEach((rowNumberStr) => {
    const rowNumber = Number(rowNumberStr);
    const rowIndex = rowNumber - 2;
    if (rowIndex < 0 || rowIndex >= rows.length) return; // 行が削除された等、対象外
    checkedRows++;

    const entry = byRowNumber[rowNumberStr];
    const phoneBlankNow = !normalizePhone(rows[rowIndex][phoneCol]);

    // 電話番号の空欄状態と判定が1対1で決まるのは MATCHED/NEW(非空欄) と
    // BLANK_NEW(空欄) だけ。NAME_ONLY_HOLD は空欄・非空欄どちらでも起こりうる
    // 判定なので、ここでの矛盾チェックの対象外にする。
    if (entry.judge === 'BLANK_NEW' && !phoneBlankNow) {
      crossCheckMismatch++;
      problems.push('行' + rowNumber + ': BLANK_NEW判定なのに電話番号が空欄ではありません');
    } else if ((entry.judge === 'MATCHED' || entry.judge === 'NEW') && phoneBlankNow) {
      crossCheckMismatch++;
      problems.push('行' + rowNumber + ': ' + entry.judge + '判定なのに電話番号が空欄です');
    }
  });

  // ID整合性チェック（NEW判定のみが対象）
  const phoneToIds = new Map();
  const idToPhones = new Map();
  Object.values(byRowNumber).forEach((entry) => {
    if (entry.judge !== 'NEW' || !entry.linkedMemberId || !entry.phoneNormalized) return;
    if (!phoneToIds.has(entry.phoneNormalized)) phoneToIds.set(entry.phoneNormalized, new Set());
    phoneToIds.get(entry.phoneNormalized).add(entry.linkedMemberId);

    if (!idToPhones.has(entry.linkedMemberId)) idToPhones.set(entry.linkedMemberId, new Set());
    idToPhones.get(entry.linkedMemberId).add(entry.phoneNormalized);
  });

  phoneToIds.forEach((idSet, phone) => {
    if (idSet.size > 1) {
      problems.push('⚠ 同一電話番号(' + phone + ')に複数の新規IDが発行されています: ' + Array.from(idSet).join(', '));
    }
  });
  idToPhones.forEach((phoneSet, id) => {
    if (phoneSet.size > 1) {
      problems.push('⚠ 同一の新規ID(' + id + ')が複数の異なる電話番号に発行されています: ' + Array.from(phoneSet).join(', '));
    }
  });

  const ok = problems.length === 0;

  workLog.log({
    phase: 'validation',
    type: ok ? 'success' : 'warn',
    message: ok
      ? '二重チェックOK（対象' + checkedRows + '行、不一致なし）'
      : '⚠ 名寄せ件数不一致：要手動確認 / ' + problems.join(' / ')
  });

  return { ok, problems, checkedRows, crossCheckMismatch };
}

module.exports = { runValidation };
