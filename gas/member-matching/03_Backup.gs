/**
 * フェーズ0: バックアップ
 * スプレッドシート全体をコピーして別ファイルとして保存する。
 * これが成功しない限り、フェーズ1（名寄せ・visit_history拡張）は実行しない。
 */

function MM_runBackup() {
  var ss = SpreadsheetApp.openById(MM_CONFIG.SPREADSHEET_ID);
  try {
    var sourceFile = DriveApp.getFileById(MM_CONFIG.SPREADSHEET_ID);
    var now = new Date();
    var stamp = Utilities.formatDate(now, Session.getScriptTimeZone(), 'yyyyMMdd_HHmm');
    var backupName = MM_CONFIG.BACKUP_FILENAME_PREFIX + stamp + MM_CONFIG.BACKUP_FILENAME_SUFFIX;
    var backupFile = sourceFile.makeCopy(backupName);

    var user = '';
    try {
      user = Session.getActiveUser().getEmail() || '';
    } catch (e) {
      user = '';
    }

    MM_log_(
      ss,
      'バックアップ',
      'バックアップ完了: ' + backupName + ' (ファイルID: ' + backupFile.getId() + ') 実行者: ' + (user || 'unknown')
    );

    return { success: true, fileId: backupFile.getId(), fileName: backupName };
  } catch (e) {
    try {
      MM_log_(ss, 'エラー', 'バックアップ失敗: ' + e.message);
    } catch (e2) {
      Logger.log('作業ログへの書き込みにも失敗: ' + e2.message);
    }
    return { success: false, error: e.message };
  }
}
