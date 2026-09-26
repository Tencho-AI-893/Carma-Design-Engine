/**
 * 共通ユーティリティ（列検索・正規化・新規ID発行など）
 */

function MM_findHeaderColumn_(sheet, candidates) {
  var lastCol = sheet.getLastColumn();
  if (lastCol === 0) return -1;
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  for (var i = 0; i < headers.length; i++) {
    var h = String(headers[i]).trim();
    if (!h) continue;
    for (var j = 0; j < candidates.length; j++) {
      if (h === candidates[j] || h.indexOf(candidates[j]) !== -1) {
        return i + 1; // 1-indexed
      }
    }
  }
  return -1;
}

// 既存列があればその列番号を返し、無ければ末尾に新規列を追加して返す（既存列は変更しない）
function MM_findOrCreateColumn_(sheet, headerName) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  for (var i = 0; i < headers.length; i++) {
    if (String(headers[i]).trim() === headerName) return i + 1;
  }
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(headerName);
  return newCol;
}

function MM_normalizePhone_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[^0-9]/g, '');
}

function MM_normalizeName_(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, '').trim();
}

// 既存会員マスタのシートを取得。設定名で見つからなければ自動検出する。
function MM_getMemberMasterSheet_(ss) {
  var sheet = ss.getSheetByName(MM_CONFIG.MEMBER_MASTER_SHEET_NAME);
  if (sheet) return sheet;

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var s = sheets[i];
    var lastCol = s.getLastColumn();
    if (lastCol === 0) continue;
    var headers = s.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
      return String(h);
    });
    var matchCount = 0;
    MM_CONFIG.MEMBER_MASTER_AUTO_DETECT_HEADERS.forEach(function (needle) {
      if (headers.some(function (h) { return h.indexOf(needle) !== -1; })) matchCount++;
    });
    if (matchCount >= 1) return s;
  }
  return null;
}

function MM_findCastMasterSheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName();
    for (var j = 0; j < MM_CONFIG.CAST_MASTER_SHEET_NAME_CANDIDATES.length; j++) {
      if (name.indexOf(MM_CONFIG.CAST_MASTER_SHEET_NAME_CANDIDATES[j]) !== -1) {
        return sheets[i];
      }
    }
  }
  return null;
}

function MM_generateNewMemberId_() {
  return 'NEW-' + Utilities.getUuid().split('-')[0].toUpperCase();
}

function MM_columnToLetter_(column) {
  var temp, letter = '';
  while (column > 0) {
    temp = (column - 1) % 26;
    letter = String.fromCharCode(temp + 65) + letter;
    column = (column - temp - 1) / 26;
  }
  return letter;
}

function MM_safeAlert_(message) {
  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (e) {
    Logger.log(message);
  }
}
