'use strict';

const { writeJsonAtomic } = require('../utils/atomicFile');
const { runMatching } = require('./matching');

const JUDGE_LABELS_JA = {
  MATCHED: '既存会員に紐付け予定',
  NEW: '新規会員ID発行予定',
  BLANK_NEW: '電話番号なし（要確認）',
  NAME_ONLY_HOLD: '氏名一致候補あり・保留',
  SKIPPED: '処理対象外（処理済み）',
  FINGERPRINT_MISMATCH_HOLD: '要確認（処理済み後にデータ変更検知）',
  ERROR: 'エラー・要確認'
};

/**
 * Dry Run: 実データを一切書き換えず、判定結果だけをプレビューする。
 * matching.runMatching を dryRun:true で呼ぶため、importStateRepo への
 * 書き込みは発生しない。結果は DRY_RUN_RESULT_FILE に保存し、
 * 管理画面や /form-import のAPIから読み出せるようにする。
 */
async function runDryRun({ sheetSource, memberRepository, importStateRepo, workLog, config }) {
  const matchResult = await runMatching({
    sheetSource,
    memberRepository,
    importStateRepo,
    workLog,
    dryRun: true,
    config
  });

  const rows = matchResult.results.map((r) => ({
    行番号: r.rowNumber,
    氏名: r.name,
    電話番号: r.phone,
    現在ID: r.currentId,
    判定: JUDGE_LABELS_JA[r.judge] || r.judge,
    紐付け予定ID: r.linkedMemberId || (r.judge === 'NEW' ? '(新規発行予定)' : ''),
    理由: r.reason
  }));

  const summary = {
    既存会員への紐付け予定件数: matchResult.counts.matched,
    新規会員ID発行予定件数: matchResult.counts.brandNew,
    '電話番号なし（要確認）件数': matchResult.counts.blankNew,
    同一氏名候補あり保留件数: matchResult.counts.nameOnlyHold,
    処理対象外件数: matchResult.counts.skipped,
    要確認_変更検知: matchResult.counts.fingerprintMismatch,
    エラー件数: matchResult.errorRows.length,
    総行数: matchResult.totalRows
  };

  const output = {
    generatedAt: new Date().toISOString(),
    summary,
    rows
  };

  writeJsonAtomic(config.DRY_RUN_RESULT_FILE, output);

  workLog.log({
    phase: 'dry-run',
    type: 'summary',
    message: 'Dry Run完了（書き込みなし）: ' + JSON.stringify(summary)
  });

  return output;
}

module.exports = { runDryRun, JUDGE_LABELS_JA };
