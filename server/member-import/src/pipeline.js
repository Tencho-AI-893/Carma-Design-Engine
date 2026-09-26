'use strict';

const defaultConfig = require('./config');
const { withLockAsync } = require('./utils/lock');
const { runPreflight } = require('./services/preflight');
const { runBackup } = require('./services/backup');
const { runMatching } = require('./services/matching');
const { extendVisitHistory } = require('./services/visitHistory');
const { runValidation } = require('./services/validation');
const { runDryRun } = require('./services/dryRun');

/**
 * 本番取り込みの唯一の入口。
 * 必ず以下の順番でのみ実行する（この関数以外の経路で本番書き込みをしないこと）:
 *   1. Preflight
 *   2. Backup（失敗したら即中止・以降は一切実行しない）
 *   3. Member Matching（名寄せ）
 *   4. visit_history拡張
 *   5. Validation（二重チェック）
 *   6. 作業ログ記録
 *
 * 同時実行防止のため、全体を FileLock で保護する。ロックが取れない場合
 * （＝他の実行が進行中）は即座に安全側で停止する。
 */
async function runFullPipeline({ sheetSource, memberRepository, importStateRepo, workLog, config, _runBackup }) {
  const cfg = config || defaultConfig;

  const lockResult = await withLockAsync(cfg.LOCK_FILE, () =>
    runFullPipelineUnlocked({ sheetSource, memberRepository, importStateRepo, workLog, config: cfg, _runBackup })
  );

  if (lockResult.locked) {
    const message = '他の取り込み処理が実行中のため、今回の実行は開始しませんでした（多重実行防止）。';
    workLog.log({ phase: 'lock', type: 'stop', message });
    return { success: false, step: 'lock', error: message };
  }

  return lockResult.result;
}

async function runFullPipelineUnlocked({ sheetSource, memberRepository, importStateRepo, workLog, config, _runBackup }) {
  // _runBackup はテスト用の差し込み口（本番は常に実際の runBackup を使う）。
  const backupFn = _runBackup || runBackup;
  // --- 1. Preflight ---
  let preflight;
  try {
    preflight = await runPreflight({ sheetSource, memberRepository, importStateRepo, config });
  } catch (e) {
    const message = 'STOP: Preflightの実行自体に失敗しました: ' + e.message;
    workLog.log({ phase: 'preflight', type: 'stop', message });
    return { success: false, step: 'preflight', error: message };
  }

  if (!preflight.ok) {
    const message = 'STOP: 事前点検で問題が見つかったため本処理を開始しませんでした: ' + preflight.stops.join(' / ');
    workLog.log({ phase: 'preflight', type: 'stop', message });
    return { success: false, step: 'preflight', error: message, preflight };
  }

  // --- 2. Backup（失敗したら100%中止） ---
  const backupResult = backupFn(config, workLog);
  if (!backupResult.success) {
    const message = 'STOP: バックアップに失敗したため本処理を中止しました: ' + backupResult.error;
    workLog.log({ phase: 'backup', type: 'stop', message });
    return { success: false, step: 'backup', error: backupResult.error, preflight };
  }

  // --- 3. Member Matching ---
  let matchResult;
  try {
    matchResult = await runMatching({ sheetSource, memberRepository, importStateRepo, workLog, dryRun: false, config });
  } catch (e) {
    const message = 'フェーズ「Member Matching」で例外が発生したため処理を中止しました: ' + e.message;
    workLog.log({ phase: 'matching', type: 'stop', message });
    return { success: false, step: 'matching', error: e.message, preflight, backup: backupResult };
  }

  // --- 4. visit_history拡張 ---
  let visitHistoryResult;
  try {
    visitHistoryResult = extendVisitHistory({ config, workLog });
  } catch (e) {
    const message = 'フェーズ「visit_history拡張」で例外が発生したため処理を中止しました: ' + e.message;
    workLog.log({ phase: 'visit-history', type: 'stop', message });
    return {
      success: false,
      step: 'visitHistory',
      error: e.message,
      preflight,
      backup: backupResult,
      matching: matchResult
    };
  }

  // --- 5. Validation ---
  let validationResult;
  try {
    validationResult = await runValidation({ sheetSource, importStateRepo, workLog, config });
  } catch (e) {
    validationResult = { ok: false, problems: ['検証自体が例外で失敗: ' + e.message] };
    workLog.log({ phase: 'validation', type: 'error', message: validationResult.problems[0] });
  }

  // --- 6. 作業ログ記録（最終サマリ） ---
  const summaryMessage =
    '全処理完了。既存一致=' +
    matchResult.counts.matched +
    ' 新規=' +
    matchResult.counts.brandNew +
    ' 電話番号なし要確認=' +
    matchResult.counts.blankNew +
    ' 氏名一致保留=' +
    matchResult.counts.nameOnlyHold +
    ' visit_history行数(前/後)=' +
    visitHistoryResult.rowsBefore +
    '/' +
    visitHistoryResult.rowsAfter +
    ' 検証=' +
    (validationResult.ok ? 'OK' : '⚠不一致あり');

  workLog.log({ phase: 'complete', type: validationResult.ok ? 'success' : 'warn', message: summaryMessage });

  return {
    success: true,
    preflight,
    backup: backupResult,
    matching: matchResult,
    visitHistory: visitHistoryResult,
    validation: validationResult
  };
}

// Dry Runも本番実行と同じロックを共有する（実行中に競合して
// import-stateを読みながら本番が書き換える、といった事故を防ぐため）。
async function runDryRunLocked({ sheetSource, memberRepository, importStateRepo, workLog, config }) {
  const cfg = config || defaultConfig;
  const lockResult = await withLockAsync(cfg.LOCK_FILE, () =>
    runDryRun({ sheetSource, memberRepository, importStateRepo, workLog, config: cfg })
  );
  if (lockResult.locked) {
    const message = '他の処理が実行中のため、Dry Runを開始しませんでした。少し時間をおいて再実行してください。';
    workLog.log({ phase: 'lock', type: 'stop', message });
    return { locked: true, error: message };
  }
  return lockResult.result;
}

module.exports = { runFullPipeline, runPreflight, runDryRun, runDryRunLocked, runValidation };
