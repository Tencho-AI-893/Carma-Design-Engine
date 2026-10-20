/**
 * MemberExtension.gs — SM.Carma 会員データ名寄せ＆visit_history拡張
 *
 * 既存のLTV・VIP・QRコードは一切変更しない。このファイルを「追加」するだけ。
 * 手動実行専用（時間主導トリガーなし）。
 *
 * 実行順：surveyReadOnly（調査）→ 店長承認 → runBackup（フェーズ0）
 *        → ドライラン → 店長承認 → 本番
 */

// ===== 設定（店長が変更する値はここだけ）=====
var ME_CONFIG = {
  SHEET_FORM: 'Form Responses 1',   // 読み取り専用
  SHEET_VISIT: 'visit_history',
  SHEET_RESULT: '名寄せ結果',
  SHEET_LOG: '作業ログ',
  SHEET_MASTER: '',                 // 調査後に確定する（会員マスタのシート名）
  SHEET_CAST: '',                   // キャストマスタがあれば名前を入れる。空なら自由入力
  // 見出し名の候補（上から順に最初に見つかったものを使う）。調査後に確定させる
  HEADERS: {
    formPhone: ['電話番号', '電話', 'TEL', 'Phone'],
    formName: ['お名前', '氏名', '名前', 'Name'],
    masterId: ['会員ID', 'ID', '会員番号'],
    masterPhone: ['電話番号', '電話', 'TEL'],
    masterName: ['お名前', '氏名', '名前']
  },
  // 営業時間（この間の実行は確認ダイアログを出す）。20→翌5
  BUSINESS_START_HOUR: 20,
  BUSINESS_END_HOUR: 5,
  BACKUP_VALID_HOURS: 12,           // バックアップ後、この時間内だけ本番実行可
  NEW_ID_PREFIX: 'NEW-'             // 新規会員の仮ID（行番号から作る＝二重発行されない）
};

var ME_NEW_COLS = ['指名種別', '利用時間', '担当キャスト', '手ごたえ', '手ごたえメモ'];
var ME_RESULT_HEADERS = ['元の行番号', '判定', '紐付け会員ID', '候補一致フラグ'];

// ===== メニュー =====
// 既存の onOpen があると衝突するため、ここでは onOpen を定義しない。
// 既存 onOpen から memberExtensionMenu_() を1行呼ぶ（調査後に店長承認のうえ追加）。
function memberExtensionMenu_() {
  SpreadsheetApp.getUi().createMenu('会員データ拡張')
    .addItem('① 調査（読むだけ）', 'surveyReadOnly')
    .addItem('② バックアップ', 'runBackup')
    .addItem('③ 名寄せ ドライラン', 'dryRunMatch')
    .addItem('④ 名寄せ 本番', 'runMatch')
    .addItem('⑤ 列追加 ドライラン', 'dryRunColumns')
    .addItem('⑥ 列追加 本番', 'runColumns')
    .addToUi();
}

// ===== 共通 =====
function me_ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function me_log_(phase, message) {
  var ss = me_ss_();
  var sh = ss.getSheetByName(ME_CONFIG.SHEET_LOG) || ss.insertSheet(ME_CONFIG.SHEET_LOG);
  if (sh.getLastRow() === 0) sh.appendRow(['日時', '実行者', 'フェーズ', '内容']);
  var user = '';
  try { user = Session.getActiveUser().getEmail(); } catch (e) {}
  sh.appendRow([new Date(), user, phase, message]);
}

function me_findCol_(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = headers.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

function me_headers_(sh) {
  var lastCol = sh.getLastColumn();
  if (lastCol === 0) return [];
  return sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

function me_isBusinessHours_() {
  var h = new Date().getHours();
  var s = ME_CONFIG.BUSINESS_START_HOUR, e = ME_CONFIG.BUSINESS_END_HOUR;
  return s > e ? (h >= s || h < e) : (h >= s && h < e);
}

// 営業時間中は確認。false なら中止
function me_confirmHours_() {
  if (!me_isBusinessHours_()) return true;
  var ui = SpreadsheetApp.getUi();
  var r = ui.alert('営業時間中です',
    '店内のPCが同じシートを使っている時間帯です。営業時間外の実行をおすすめします。\nそれでも実行しますか？',
    ui.ButtonSet.YES_NO);
  return r === ui.Button.YES;
}

// 排他制御つきで実行。取れなければ案内を出して終了
function me_withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    SpreadsheetApp.getUi().alert('他の端末が処理中です。少し待って再実行してください');
    return;
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

// 電話番号の正規化。返り値: {ok, value}
function me_normPhone_(raw) {
  var s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (s === '') return { blank: true, ok: false, value: '' };
  s = s.normalize('NFKC');
  var plus81 = /^\+\s*81/.test(s);
  s = s.replace(/[^0-9]/g, '');
  if (plus81 && s.indexOf('81') === 0) s = '0' + s.substring(2);
  else if (s.indexOf('81') === 0 && (s.length === 12 || s.length === 11)) s = '0' + s.substring(2);
  else if (s.charAt(0) !== '0' && (s.length === 9 || s.length === 10)) s = '0' + s;
  var ok = (s.length === 10 || s.length === 11) && s.charAt(0) === '0';
  return { blank: false, ok: ok, value: s };
}

function me_last4_(p) { return '***' + String(p).slice(-4); }

// ===== 1章：調査（読むだけ。個人情報は出さない）=====
function surveyReadOnly() {
  var ss = me_ss_();
  var lines = [];
  ss.getSheets().forEach(function (sh) {
    lines.push('【' + sh.getName() + '】行数=' + sh.getLastRow() + ' 列数=' + sh.getLastColumn());
    lines.push('  見出し: ' + me_headers_(sh).join(' | '));
  });
  var text = lines.join('\n');
  Logger.log(text);
  SpreadsheetApp.getUi().alert('調査結果（このまま Claude に貼ってください）', text, SpreadsheetApp.getUi().ButtonSet.OK);
}

// ===== フェーズ0：バックアップ =====
function runBackup() {
  me_withLock_(function () {
    var ss = me_ss_();
    try {
      var stamp = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd_HHmm');
      var copy = DriveApp.getFileById(ss.getId()).makeCopy('BACKUP_' + stamp + '_会員データ拡張前');
      var cs = SpreadsheetApp.openById(copy.getId());
      var a = ss.getSheets(), b = cs.getSheets();
      var same = a.length === b.length;
      for (var i = 0; same && i < a.length; i++) {
        var other = cs.getSheetByName(a[i].getName());
        if (!other || other.getLastRow() !== a[i].getLastRow()) same = false;
      }
      if (!same) throw new Error('バックアップ検証不一致（シート数または行数）');
      PropertiesService.getScriptProperties().setProperty('ME_BACKUP_AT', String(Date.now()));
      me_log_('フェーズ0', 'バックアップ成功・検証OK: ' + copy.getUrl());
      SpreadsheetApp.getUi().alert('バックアップ完了。検証OKです。');
    } catch (e) {
      PropertiesService.getScriptProperties().deleteProperty('ME_BACKUP_AT');
      me_log_('フェーズ0', '⚠ バックアップ失敗: ' + e.message);
      SpreadsheetApp.getUi().alert('バックアップに失敗しました。以降の作業は実行できません。');
    }
  });
}

function me_backupFresh_() {
  var at = Number(PropertiesService.getScriptProperties().getProperty('ME_BACKUP_AT') || 0);
  return at > 0 && (Date.now() - at) < ME_CONFIG.BACKUP_VALID_HOURS * 3600 * 1000;
}

// ===== フェーズ1-A：名寄せ =====
function dryRunMatch() { me_withLock_(function () { me_match_(true); }); }
function runMatch() {
  if (!me_backupFresh_()) {
    SpreadsheetApp.getUi().alert('先にバックアップを実行してください（' + ME_CONFIG.BACKUP_VALID_HOURS + '時間以内）。');
    return;
  }
  if (!me_confirmHours_()) return;
  me_withLock_(function () { me_match_(false); });
}

function me_match_(dry) {
  var ss = me_ss_();
  var ui = SpreadsheetApp.getUi();
  var form = ss.getSheetByName(ME_CONFIG.SHEET_FORM);
  var master = ME_CONFIG.SHEET_MASTER ? ss.getSheetByName(ME_CONFIG.SHEET_MASTER) : null;
  if (!form || !master) {
    var msg = '必要なシートが見つかりません（フォーム回答 / 会員マスタ）。処理を中止しました。';
    if (!dry) me_log_('フェーズ1-A', '⚠ ' + msg);
    ui.alert(msg);
    return;
  }
  var H = ME_CONFIG.HEADERS;
  var fh = me_headers_(form), mh = me_headers_(master);
  var fPhone = me_findCol_(fh, H.formPhone), fName = me_findCol_(fh, H.formName);
  var mId = me_findCol_(mh, H.masterId), mPhone = me_findCol_(mh, H.masterPhone), mName = me_findCol_(mh, H.masterName);
  if (fPhone < 0 || mId < 0 || mPhone < 0) {
    var m2 = '想定外の列構成です（電話番号列 / 会員ID列が見つかりません）。書き込まずに停止しました。';
    if (!dry) me_log_('フェーズ1-A', '⚠ ' + m2);
    ui.alert(m2);
    return;
  }

  // マスタを一括読み込み → 正規化電話番号 → 会員ID（重複電話は要確認扱い）
  var mLast = master.getLastRow();
  var mVals = mLast > 1 ? master.getRange(2, 1, mLast - 1, master.getLastColumn()).getValues() : [];
  var phoneToId = {}, dupPhone = {}, nameSet = {};
  mVals.forEach(function (r) {
    var p = me_normPhone_(r[mPhone]);
    if (p.ok) {
      if (phoneToId[p.value] !== undefined && phoneToId[p.value] !== String(r[mId])) dupPhone[p.value] = true;
      phoneToId[p.value] = String(r[mId]);
    }
    if (mName >= 0 && String(r[mName]).trim() !== '') nameSet[String(r[mName]).normalize('NFKC').replace(/\s/g, '')] = true;
  });

  // 処理済み行（冪等性）
  var resSheet = ss.getSheetByName(ME_CONFIG.SHEET_RESULT);
  var done = {};
  if (resSheet && resSheet.getLastRow() > 1) {
    resSheet.getRange(2, 1, resSheet.getLastRow() - 1, 1).getValues().forEach(function (r) { done[String(r[0])] = true; });
  }

  var fLast = form.getLastRow();
  var fVals = fLast > 1 ? form.getRange(2, 1, fLast - 1, form.getLastColumn()).getValues() : [];
  var out = [], c = { 一致: 0, 新規: 0, 空欄新規: 0, 要確認: 0, スキップ: 0 };
  fVals.forEach(function (r, i) {
    var rowNo = i + 2;
    if (done[String(rowNo)]) { c['スキップ']++; return; }
    var verdict, id = '', cand = '';
    try {
      var p = me_normPhone_(r[fPhone]);
      if (p.blank) {
        verdict = '空欄新規'; id = ME_CONFIG.NEW_ID_PREFIX + rowNo;
      } else if (!p.ok || dupPhone[p.value]) {
        verdict = '要確認';
      } else if (phoneToId[p.value] !== undefined) {
        verdict = '一致'; id = phoneToId[p.value];
      } else {
        verdict = '新規'; id = ME_CONFIG.NEW_ID_PREFIX + rowNo;
      }
      if ((verdict === '新規' || verdict === '空欄新規') && fName >= 0) {
        var nm = String(r[fName]).normalize('NFKC').replace(/\s/g, '');
        if (nm !== '' && nameSet[nm]) cand = '候補あり（要目視・自動統合しない）';
      }
    } catch (e) {
      verdict = '要確認'; id = ''; // 個人情報は出さず行番号のみ
    }
    c[verdict]++;
    out.push([rowNo, verdict, id, cand]);
  });

  var summary = '一致=' + c['一致'] + ' / 新規=' + c['新規'] + ' / 空欄新規=' + c['空欄新規'] +
    ' / 要確認=' + c['要確認'] + ' / 処理済みスキップ=' + c['スキップ'];
  if (dry) { ui.alert('【ドライラン・書き込みなし】\n' + summary); return; }

  if (!resSheet) resSheet = ss.insertSheet(ME_CONFIG.SHEET_RESULT);
  if (resSheet.getLastRow() === 0) resSheet.getRange(1, 1, 1, 4).setValues([ME_RESULT_HEADERS]);
  if (out.length) resSheet.getRange(resSheet.getLastRow() + 1, 1, out.length, 4).setValues(out);

  var ok = me_verifyMatch_(resSheet, fVals, fPhone);
  me_log_('フェーズ1-A', summary + (ok.ok ? ' / 二重チェックOK' : ' / ⚠ 名寄せ件数不一致：要手動確認 ' + ok.detail));
  ui.alert((ok.ok ? '完了。' : '⚠ 名寄せ件数不一致：要手動確認。') + '\n' + summary);
}

// 二重チェック：配列走査 と COUNTIF式 の2方式で「新規会員化件数」を検算
function me_verifyMatch_(resSheet, fVals, fPhone) {
  var last = resSheet.getLastRow();
  var rows = last > 1 ? resSheet.getRange(2, 1, last - 1, 3).getValues() : [];
  // 方式A：配列走査（仮IDが付いた行の数）
  var a = rows.filter(function (r) { return String(r[2]).indexOf(ME_CONFIG.NEW_ID_PREFIX) === 0; }).length;
  // 方式B：COUNTIF式（空欄新規 + 新規）
  var tmp = resSheet.getRange('H1');
  tmp.setFormula('=COUNTIF(B2:B,"空欄新規")+COUNTIF(B2:B,"新規")');
  SpreadsheetApp.flush();
  var b = Number(tmp.getValue());
  tmp.clearContent();
  // 参考：元データから数えた空欄行数が空欄新規以下であること
  var blanks = fVals.filter(function (r) { return me_normPhone_(r[fPhone]).blank; }).length;
  var blankNew = rows.filter(function (r) { return r[1] === '空欄新規'; }).length;
  var ok = (a === b) && (blankNew === blanks);
  return { ok: ok, detail: 'A=' + a + ' B=' + b + ' 空欄元=' + blanks + ' 空欄新規=' + blankNew };
}

// ===== フェーズ1-B：visit_history 列追加 =====
function dryRunColumns() { me_withLock_(function () { me_columns_(true); }); }
function runColumns() {
  if (!me_backupFresh_()) {
    SpreadsheetApp.getUi().alert('先にバックアップを実行してください（' + ME_CONFIG.BACKUP_VALID_HOURS + '時間以内）。');
    return;
  }
  if (!me_confirmHours_()) return;
  me_withLock_(function () { me_columns_(false); });
}

function me_columns_(dry) {
  var ss = me_ss_();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getSheetByName(ME_CONFIG.SHEET_VISIT);
  if (!sh) {
    if (!dry) me_log_('フェーズ1-B', '⚠ visit_history が見つかりません');
    ui.alert('visit_history が見つかりません。処理を中止しました。');
    return;
  }
  var headers = me_headers_(sh);
  // 右端の「中身のある」見出し列を探す（既存列は動かさない）
  var lastUsed = 0;
  headers.forEach(function (h, i) { if (h !== '') lastUsed = i + 1; });
  var missing = ME_NEW_COLS.filter(function (n) { return headers.indexOf(n) < 0; });
  if (!missing.length) { ui.alert('5列はすでに揃っています。何もしません。'); return; }
  if (dry) { ui.alert('【ドライラン・書き込みなし】追加予定の列: ' + missing.join('、')); return; }

  var rowsBefore = sh.getLastRow();
  var start = lastUsed + 1;
  var need = start + missing.length - 1 - sh.getMaxColumns();
  if (need > 0) sh.insertColumnsAfter(sh.getMaxColumns(), need);
  sh.getRange(1, start, 1, missing.length).setValues([missing]);

  var vRows = Math.max(rowsBefore, 1) + 1000; // 今後の入力分も含めて入力規則を設定（値は入れない）
  var rule = function (list) {
    return SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(false).build();
  };
  missing.forEach(function (name, i) {
    var col = start + i;
    var rng = sh.getRange(2, col, vRows - 1, 1);
    if (name === '指名種別') rng.setDataValidation(rule(['フリー', '本指名', '場内指名', 'その他']));
    else if (name === '手ごたえ') rng.setDataValidation(rule(['良好', '普通', '要フォロー', 'リピート確度高']));
    else if (name === '利用時間') rng.setDataValidation(SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).build());
    else if (name === '担当キャスト' && ME_CONFIG.SHEET_CAST) {
      var cs = ss.getSheetByName(ME_CONFIG.SHEET_CAST);
      if (cs && cs.getLastRow() > 1) {
        rng.setDataValidation(SpreadsheetApp.newDataValidation()
          .requireValueInRange(cs.getRange(2, 1, cs.getLastRow() - 1, 1), true).setAllowInvalid(true).build());
      }
    }
  });
  SpreadsheetApp.flush();
  var rowsAfter = sh.getLastRow();
  var ok = rowsBefore === rowsAfter;
  me_log_('フェーズ1-B', '列追加: ' + missing.join('、') + ' / 行数 ' + rowsBefore + '→' + rowsAfter + (ok ? ' OK' : ' ⚠ 行数不一致：要手動確認'));
  ui.alert(ok ? '列追加が完了しました。' : '⚠ 行数が一致しません。作業ログを確認してください。');
}
