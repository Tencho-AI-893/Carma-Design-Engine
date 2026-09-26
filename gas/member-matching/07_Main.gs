/**
 * 実行の入口。
 *
 * 使い方（店長向け）:
 *   Apps Scriptエディタの関数選択プルダウンで「MM_runFullProcess」を選んで
 *   ▶実行 を押すだけで、バックアップ→名寄せ→visit_history拡張→二重チェックを
 *   順番に全部実行する。バックアップが失敗した場合は、そこで自動的に停止し
 *   フェーズ1（名寄せ・拡張）には進まない。
 *
 *   結果はポップアップと「作業ログ」シートの両方に出る。
 */

function MM_runFullProcess() {
  var ss = SpreadsheetApp.openById(MM_CONFIG.SPREADSHEET_ID);

  var backupResult = MM_runBackup();
  if (!backupResult.success) {
    var msg0 =
      'バックアップに失敗したため、フェーズ1（名寄せ・visit_history拡張）は実行しませんでした。\nエラー: ' +
      backupResult.error;
    try {
      MM_log_(ss, '中止', msg0);
    } catch (e) {}
    MM_safeAlert_(msg0);
    return { success: false, step: 'backup', error: backupResult.error };
  }

  var phase1AResult;
  try {
    phase1AResult = MM_runPhase1A_MemberMatching();
  } catch (e) {
    var msg1 = 'フェーズ1-A（名寄せ）でエラーが発生したため処理を中止しました: ' + e.message;
    MM_log_(ss, '中止', msg1);
    MM_safeAlert_(msg1);
    return { success: false, step: 'phase1A', error: e.message };
  }

  var phase1BResult;
  try {
    phase1BResult = MM_runPhase1B_ExtendVisitHistory();
  } catch (e) {
    var msg2 = 'フェーズ1-B（visit_history拡張）でエラーが発生したため処理を中止しました: ' + e.message;
    MM_log_(ss, '中止', msg2);
    MM_safeAlert_(msg2);
    return { success: false, step: 'phase1B', error: e.message };
  }

  var checkResult = MM_runDoubleCheck(phase1AResult);

  var finalMessage =
    '全処理完了。\n' +
    '・既存一致: ' + phase1AResult.matched + '件\n' +
    '・新規: ' + phase1AResult.brandNew + '件\n' +
    '・空欄新規: ' + phase1AResult.blankNew + '件\n' +
    '・要確認(エラー行): ' + phase1AResult.errorRows + '件\n' +
    '・スキップ(処理済み): ' + phase1AResult.skipped + '件\n' +
    '・visit_history 行数: 追加前=' + phase1BResult.rowsBefore + ' → 追加後=' + phase1BResult.rowsAfter + '\n' +
    '・二重チェック: ' + (checkResult.ok ? 'OK（不一致なし）' : '⚠不一致あり。作業ログを確認してください');

  MM_log_(ss, '完了', finalMessage.replace(/\n/g, ' / '));
  MM_safeAlert_(finalMessage);

  return { success: true, backup: backupResult, phase1A: phase1AResult, phase1B: phase1BResult, check: checkResult };
}

// 任意: スプレッドシートを開いた状態で一度だけ実行するとメニューが出る（onOpenは既存のを壊さないため未定義）
function MM_showMenu() {
  SpreadsheetApp.getUi()
    .createMenu('会員データ名寄せ')
    .addItem('① バックアップのみ実行', 'MM_runBackup')
    .addItem('② 全処理を実行（バックアップ→名寄せ→拡張→検証）', 'MM_runFullProcess')
    .addToUi();
}
