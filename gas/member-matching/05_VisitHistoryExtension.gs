/**
 * フェーズ1-B: visit_history への列追加
 *
 * 追加する4項目（手ごたえの自由記述を含めると実質5列）:
 *   指名種別 / 利用時間 / 担当キャスト / 手ごたえ / 手ごたえ_自由記述
 *
 * 既存列は変更・削除せず、末尾に追記するだけ。既存のLTVスコア計算ロジックは
 * 参照が増えるだけで、上書きは一切発生しない。
 */

function MM_runPhase1B_ExtendVisitHistory() {
  var ss = SpreadsheetApp.openById(MM_CONFIG.SPREADSHEET_ID);
  var sheet = ss.getSheetByName(MM_CONFIG.VISIT_HISTORY_SHEET_NAME);
  if (!sheet) {
    MM_log_(ss, 'エラー', '「' + MM_CONFIG.VISIT_HISTORY_SHEET_NAME + '」シートが見つからないため処理を中止しました。');
    throw new Error('VISIT_HISTORY_NOT_FOUND');
  }

  var rowsBefore = sheet.getLastRow();

  var addedCols = [];
  MM_CONFIG.VISIT_HISTORY_NEW_COLUMNS.forEach(function (headerName) {
    var col = MM_findOrCreateColumn_(sheet, headerName);
    addedCols.push({ name: headerName, col: col });
  });

  var numDataRows = Math.max(sheet.getLastRow() - 1, 0);

  if (numDataRows > 0) {
    var typeColInfo = addedCols[0]; // 指名種別
    var castColInfo = addedCols[2]; // 担当キャスト
    var feedbackColInfo = addedCols[3]; // 手ごたえ

    var typeRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(MM_CONFIG.NOMINATION_TYPE_OPTIONS, true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, typeColInfo.col, numDataRows, 1).setDataValidation(typeRule);

    var feedbackRule = SpreadsheetApp.newDataValidation()
      .requireValueInList(MM_CONFIG.FEEDBACK_OPTIONS, true)
      .setAllowInvalid(true)
      .build();
    sheet.getRange(2, feedbackColInfo.col, numDataRows, 1).setDataValidation(feedbackRule);

    // 既存キャストマスタがあれば、担当キャスト列をそこからの選択式にする
    var castMasterSheet = MM_findCastMasterSheet_(ss);
    if (castMasterSheet) {
      var castNameCol = MM_findHeaderColumn_(castMasterSheet, MM_CONFIG.CAST_NAME_HEADER_CANDIDATES);
      if (castNameCol !== -1) {
        var castLastRow = castMasterSheet.getLastRow();
        if (castLastRow > 1) {
          var castRange = castMasterSheet.getRange(2, castNameCol, castLastRow - 1, 1);
          var castRule = SpreadsheetApp.newDataValidation()
            .requireValueInRange(castRange, true)
            .setAllowInvalid(true)
            .build();
          sheet.getRange(2, castColInfo.col, numDataRows, 1).setDataValidation(castRule);
        }
      }
    }
  }

  var rowsAfter = sheet.getLastRow();

  MM_log_(
    ss,
    'visit_history拡張',
    'visit_history に列追加完了: ' +
      MM_CONFIG.VISIT_HISTORY_NEW_COLUMNS.join(', ') +
      ' / 追加前行数=' +
      rowsBefore +
      ' 追加後行数=' +
      rowsAfter +
      (rowsBefore === rowsAfter ? ' (一致OK)' : ' (⚠不一致)')
  );

  return { rowsBefore: rowsBefore, rowsAfter: rowsAfter, columns: addedCols };
}
