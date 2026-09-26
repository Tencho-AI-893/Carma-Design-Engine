'use strict';

const { readJson, writeJsonAtomic } = require('../utils/atomicFile');

/**
 * visit_history の拡張（GASフェーズ1-B相当）。
 * 既存レコード・既存フィールドは一切変更せず、無ければ新フィールドを
 * null で追加するだけ。件数（行数）は増減しないので、前後の件数が
 * 一致することをそのまま安全確認として使う。
 *
 *   nominationType  指名種別（フリー/本指名/場内指名/その他）
 *   usageMinutes    利用時間（分）
 *   castName        担当キャスト
 *   feedback        手ごたえ（良好/普通/要フォロー/リピート確度高）
 *   feedbackNote    手ごたえ自由記述
 */
function extendVisitHistory({ config, workLog }) {
  const file = config.VISIT_HISTORY_FILE;
  const records = readJson(file, []);
  const rowsBefore = records.length;

  let fieldsAddedToRecords = 0;
  const updated = records.map((record) => {
    const copy = Object.assign({}, record);
    config.VISIT_HISTORY_NEW_FIELDS.forEach((field) => {
      if (!(field in copy)) {
        copy[field] = null;
        fieldsAddedToRecords++;
      }
    });
    return copy;
  });

  writeJsonAtomic(file, updated);
  const rowsAfter = updated.length;

  const ok = rowsBefore === rowsAfter;
  workLog.log({
    phase: 'visit-history',
    type: ok ? 'success' : 'error',
    message:
      'visit_history拡張: 追加前=' +
      rowsBefore +
      ' 追加後=' +
      rowsAfter +
      (ok ? ' (行数一致OK)' : ' (⚠行数不一致)') +
      ' / 新フィールド付与レコード分=' +
      fieldsAddedToRecords
  });

  return { rowsBefore, rowsAfter, ok, fields: config.VISIT_HISTORY_NEW_FIELDS };
}

module.exports = { extendVisitHistory };
