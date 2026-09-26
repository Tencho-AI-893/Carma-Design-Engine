/**
 * フェーズ1-A: 電話番号による名寄せ処理
 *
 * ルール:
 *  1. 電話番号が入力されている行のみ、既存会員マスタと電話番号で完全一致照合。
 *  2. 一致すれば既存会員IDを紐付け。一致しなければ新規会員として新規ID発行。
 *  3. 電話番号が空欄の行は照合をスキップし、無条件で新規会員として新規ID発行。
 *  4. 一致しなかった行は、氏名一致だけ別列にフラグを立てる（自動統合はしない）。
 *
 * 「Form Responses 1」の末尾に結果列を追記するだけで、既存列・既存の
 * 会員証システム（LTVスコア・VIPフラグ計算）には一切手を加えない。
 *
 * 再実行時は、既に判定区分が入っている行はスキップし、結果を保持したまま
 * 未処理の行だけを処理する（誤って再実行してもIDが変わらないようにするため）。
 */

function MM_runPhase1A_MemberMatching() {
  var ss = SpreadsheetApp.openById(MM_CONFIG.SPREADSHEET_ID);
  var sourceSheet = ss.getSheetByName(MM_CONFIG.SOURCE_SHEET_NAME);
  if (!sourceSheet) {
    MM_log_(ss, 'エラー', '「' + MM_CONFIG.SOURCE_SHEET_NAME + '」シートが見つからないため処理を中止しました。');
    throw new Error('SOURCE_SHEET_NOT_FOUND');
  }

  var masterSheet = MM_getMemberMasterSheet_(ss);
  if (!masterSheet) {
    MM_log_(
      ss,
      'エラー',
      '既存会員マスタのシートが見つからないため名寄せ処理を中止しました。00_Config.gs の MEMBER_MASTER_SHEET_NAME を実際のシート名に修正してください。'
    );
    throw new Error('MEMBER_MASTER_NOT_FOUND');
  }

  var phoneCol = MM_findHeaderColumn_(sourceSheet, MM_CONFIG.PHONE_HEADER_CANDIDATES);
  var nameCol = MM_findHeaderColumn_(sourceSheet, MM_CONFIG.NAME_HEADER_CANDIDATES);
  if (phoneCol === -1) {
    MM_log_(ss, 'エラー', '「' + MM_CONFIG.SOURCE_SHEET_NAME + '」に電話番号列が見つからず処理を中止しました。');
    throw new Error('PHONE_COLUMN_NOT_FOUND');
  }

  var masterPhoneCol = MM_findHeaderColumn_(masterSheet, MM_CONFIG.PHONE_HEADER_CANDIDATES);
  var masterIdCol = MM_findHeaderColumn_(masterSheet, MM_CONFIG.MEMBER_ID_HEADER_CANDIDATES);
  var masterNameCol = MM_findHeaderColumn_(masterSheet, MM_CONFIG.NAME_HEADER_CANDIDATES);
  if (masterPhoneCol === -1 || masterIdCol === -1) {
    MM_log_(ss, 'エラー', '既存会員マスタに電話番号列または会員ID列が見つからず処理を中止しました。');
    throw new Error('MASTER_COLUMNS_NOT_FOUND');
  }

  var masterLastRow = masterSheet.getLastRow();
  var masterValues =
    masterLastRow > 1
      ? masterSheet.getRange(2, 1, masterLastRow - 1, masterSheet.getLastColumn()).getValues()
      : [];

  var phoneToId = {};
  var nameToIds = {};
  masterValues.forEach(function (row) {
    var phone = MM_normalizePhone_(row[masterPhoneCol - 1]);
    var id = row[masterIdCol - 1];
    if (phone) phoneToId[phone] = id;
    if (masterNameCol !== -1) {
      var name = MM_normalizeName_(row[masterNameCol - 1]);
      if (name) {
        if (!nameToIds[name]) nameToIds[name] = [];
        nameToIds[name].push(id);
      }
    }
  });

  var memberIdCol = MM_findOrCreateColumn_(sourceSheet, MM_CONFIG.RESULT_COLUMNS.MEMBER_ID);
  var judgeCol = MM_findOrCreateColumn_(sourceSheet, MM_CONFIG.RESULT_COLUMNS.JUDGE);
  var candidateCol = MM_findOrCreateColumn_(sourceSheet, MM_CONFIG.RESULT_COLUMNS.CANDIDATE_FLAG);
  var errorCol = MM_findOrCreateColumn_(sourceSheet, MM_CONFIG.RESULT_COLUMNS.ERROR);

  var lastRow = sourceSheet.getLastRow();
  if (lastRow < 2) {
    MM_log_(ss, '名寄せ', '「' + MM_CONFIG.SOURCE_SHEET_NAME + '」にデータ行がないため処理をスキップしました。');
    return { matched: 0, brandNew: 0, blankNew: 0, errorRows: 0, skipped: 0, numRows: 0, phoneCol: phoneCol, judgeCol: judgeCol };
  }

  var numRows = lastRow - 1;
  var data = sourceSheet.getRange(2, 1, numRows, sourceSheet.getLastColumn()).getValues();

  var existingMemberId = sourceSheet.getRange(2, memberIdCol, numRows, 1).getValues();
  var existingJudge = sourceSheet.getRange(2, judgeCol, numRows, 1).getValues();
  var existingCandidate = sourceSheet.getRange(2, candidateCol, numRows, 1).getValues();
  var existingError = sourceSheet.getRange(2, errorCol, numRows, 1).getValues();

  var resultMemberId = [];
  var resultJudge = [];
  var resultCandidate = [];
  var resultError = [];

  var matchedCount = 0,
    newCount = 0,
    blankNewCount = 0,
    errorCount = 0,
    skippedCount = 0;

  for (var r = 0; r < data.length; r++) {
    if (existingJudge[r][0]) {
      // 既に処理済みの行はそのまま保持してスキップ（再実行してもIDが変わらない）
      resultMemberId.push(existingMemberId[r][0]);
      resultJudge.push(existingJudge[r][0]);
      resultCandidate.push(existingCandidate[r][0]);
      resultError.push(existingError[r][0]);
      skippedCount++;
      continue;
    }

    try {
      var phone = MM_normalizePhone_(data[r][phoneCol - 1]);
      var candidateNote = '';

      if (!phone) {
        resultMemberId.push(MM_generateNewMemberId_());
        resultJudge.push(MM_CONFIG.JUDGE_LABELS.BLANK_NEW);
        blankNewCount++;
      } else if (phoneToId.hasOwnProperty(phone)) {
        resultMemberId.push(phoneToId[phone]);
        resultJudge.push(MM_CONFIG.JUDGE_LABELS.MATCHED);
        matchedCount++;
      } else {
        resultMemberId.push(MM_generateNewMemberId_());
        resultJudge.push(MM_CONFIG.JUDGE_LABELS.NEW);
        newCount++;

        if (nameCol !== -1 && masterNameCol !== -1) {
          var name = MM_normalizeName_(data[r][nameCol - 1]);
          if (name && nameToIds.hasOwnProperty(name)) {
            candidateNote = '氏名一致候補あり: ' + nameToIds[name].join(', ');
          }
        }
      }

      resultCandidate.push(candidateNote);
      resultError.push('');
    } catch (rowError) {
      resultMemberId.push('');
      resultJudge.push('');
      resultCandidate.push('要確認');
      resultError.push(String(rowError.message || rowError));
      errorCount++;
    }
  }

  sourceSheet.getRange(2, memberIdCol, numRows, 1).setValues(resultMemberId.map(function (v) { return [v]; }));
  sourceSheet.getRange(2, judgeCol, numRows, 1).setValues(resultJudge.map(function (v) { return [v]; }));
  sourceSheet.getRange(2, candidateCol, numRows, 1).setValues(resultCandidate.map(function (v) { return [v]; }));
  sourceSheet.getRange(2, errorCol, numRows, 1).setValues(resultError.map(function (v) { return [v]; }));

  var summary =
    '名寄せ結果集計: 既存一致=' +
    matchedCount +
    '件, 新規=' +
    newCount +
    '件, 空欄新規=' +
    blankNewCount +
    '件, 要確認(エラー)=' +
    errorCount +
    '件, スキップ(処理済み)=' +
    skippedCount +
    '件';
  MM_log_(ss, '名寄せ', summary);

  return {
    matched: matchedCount,
    brandNew: newCount,
    blankNew: blankNewCount,
    errorRows: errorCount,
    skipped: skippedCount,
    judgeCol: judgeCol,
    phoneCol: phoneCol,
    numRows: numRows
  };
}
