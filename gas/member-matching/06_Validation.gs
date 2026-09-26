/**
 * 二重チェック機構
 *
 * 「新規会員化された件数」と「電話番号空欄件数」が一致するかを、
 * 方式A（JS配列を走査する手動検算 = SUMIFS相当）と
 * 方式B（実際のスプレッドシート関数 COUNTBLANK/COUNTIF）の
 * 2系統で検算し、不一致があれば作業ログに警告を出力する。
 */

function MM_runDoubleCheck(phase1AResult) {
  var ss = SpreadsheetApp.openById(MM_CONFIG.SPREADSHEET_ID);
  var sourceSheet = ss.getSheetByName(MM_CONFIG.SOURCE_SHEET_NAME);

  if (!sourceSheet || !phase1AResult || !phase1AResult.numRows) {
    MM_log_(ss, '検証', '検証をスキップしました（対象データがありません）。');
    return { ok: true, skipped: true };
  }

  var numRows = phase1AResult.numRows;
  var phoneCol = phase1AResult.phoneCol;
  var judgeCol = phase1AResult.judgeCol;

  // 方式A: JS配列を1件ずつ走査して集計
  var phoneValues = sourceSheet.getRange(2, phoneCol, numRows, 1).getValues();
  var judgeValues = sourceSheet.getRange(2, judgeCol, numRows, 1).getValues();

  var blankPhoneCountA = 0;
  var blankNewCountA = 0;
  for (var i = 0; i < numRows; i++) {
    if (!MM_normalizePhone_(phoneValues[i][0])) blankPhoneCountA++;
    if (judgeValues[i][0] === MM_CONFIG.JUDGE_LABELS.BLANK_NEW) blankNewCountA++;
  }

  // 方式B: 実際のスプレッドシート関数(COUNTBLANK/COUNTIF)で検算
  var phoneColLetter = MM_columnToLetter_(phoneCol);
  var judgeColLetter = MM_columnToLetter_(judgeCol);
  var phoneRangeA1 = "'" + MM_CONFIG.SOURCE_SHEET_NAME + "'!" + phoneColLetter + '2:' + phoneColLetter + (numRows + 1);
  var judgeRangeA1 = "'" + MM_CONFIG.SOURCE_SHEET_NAME + "'!" + judgeColLetter + '2:' + judgeColLetter + (numRows + 1);

  var logSheet = MM_getOrCreateLogSheet_(ss);
  var scratchCell = logSheet.getRange(logSheet.getMaxRows(), 10); // ログ本体から離れたセルを一時使用

  scratchCell.setFormula('=COUNTBLANK(' + phoneRangeA1 + ')');
  SpreadsheetApp.flush();
  var blankPhoneCountB = scratchCell.getValue();

  scratchCell.setFormula('=COUNTIF(' + judgeRangeA1 + ',"' + MM_CONFIG.JUDGE_LABELS.BLANK_NEW + '")');
  SpreadsheetApp.flush();
  var blankNewCountB = scratchCell.getValue();

  scratchCell.clearContent();

  var ok =
    blankPhoneCountA === blankPhoneCountB &&
    blankNewCountA === blankNewCountB &&
    blankPhoneCountA === blankNewCountA;

  var message =
    '電話番号空欄件数[方式A]=' +
    blankPhoneCountA +
    ' [方式B:COUNTBLANK]=' +
    blankPhoneCountB +
    ' / 空欄新規件数[方式A]=' +
    blankNewCountA +
    ' [方式B:COUNTIF]=' +
    blankNewCountB;

  if (ok) {
    MM_log_(ss, '検証', '二重チェック結果: ' + message + ' → 一致OK');
  } else {
    MM_log_(ss, '検証', '⚠ 名寄せ件数不一致：要手動確認 / ' + message);
  }

  return {
    ok: ok,
    blankPhoneCountA: blankPhoneCountA,
    blankPhoneCountB: blankPhoneCountB,
    blankNewCountA: blankNewCountA,
    blankNewCountB: blankNewCountB
  };
}
