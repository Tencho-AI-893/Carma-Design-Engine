/**
 * 「作業ログ」シートへの記録。シートが無ければ作成する（既存シートには触れない）。
 */

function MM_getOrCreateLogSheet_(ss) {
  var sheet = ss.getSheetByName(MM_CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(MM_CONFIG.LOG_SHEET_NAME);
    sheet.appendRow(['日時', '実行者', '種別', '内容']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function MM_log_(ss, type, message) {
  var sheet = MM_getOrCreateLogSheet_(ss);
  var user = '';
  try {
    user = Session.getActiveUser().getEmail() || '';
  } catch (e) {
    user = '';
  }
  sheet.appendRow([new Date(), user || 'unknown', type, message]);
}
