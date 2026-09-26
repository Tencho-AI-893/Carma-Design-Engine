/**
 * 会員データ名寄せ & visit_history拡張 - 設定
 *
 * このファイル一式（00〜07）は、既存のGASプロジェクトに「新規ファイル」として
 * 追加する前提で作成している。既存のコード・既存シートの既存列は一切変更しない。
 *
 * 関数名はすべて MM_ 接頭辞を付け、既存コード（onOpen等の既存トリガー含む）との
 * 名前衝突を避けている。onOpen は意図的に定義していない（既存のメニューを
 * 壊さないため）。メニューが欲しい場合は MM_showMenu() を手動実行する。
 */

var MM_CONFIG = {
  SPREADSHEET_ID: '1_9QzQDCWfGCrc7erfYMKo8zQhm1kypl_ysTR65MegcUw',

  SOURCE_SHEET_NAME: 'Form Responses 1',
  VISIT_HISTORY_SHEET_NAME: 'visit_history',
  LOG_SHEET_NAME: '作業ログ',

  // 既存会員マスタのシート名。実際の名前が違う場合はここを書き換える。
  // 見つからない場合は MEMBER_MASTER_AUTO_DETECT_HEADERS の見出しを含む
  // シートを自動検出する（LTVスコア・VIPフラグの計算元シートを想定）。
  MEMBER_MASTER_SHEET_NAME: '会員マスタ',
  MEMBER_MASTER_AUTO_DETECT_HEADERS: ['LTVスコア', 'VIPフラグ'],

  // 見出し名の候補（部分一致でも拾う）。実際の表記に応じて増やしてよい。
  PHONE_HEADER_CANDIDATES: ['電話番号', 'お電話番号', 'TEL', 'Phone'],
  MEMBER_ID_HEADER_CANDIDATES: ['会員ID', '会員番号', 'ID'],
  NAME_HEADER_CANDIDATES: ['お名前', '氏名', '名前', 'Name'],

  // 既存キャストマスタ（あれば）。担当キャスト列を選択式にするために使う。
  CAST_MASTER_SHEET_NAME_CANDIDATES: ['キャストマスタ', 'キャスト一覧', 'Cast Master'],
  CAST_NAME_HEADER_CANDIDATES: ['キャスト名', '氏名', '名前'],

  // Form Responses 1 に追記する結果列（既存列より右側に追加。既存列は変更しない）
  RESULT_COLUMNS: {
    MEMBER_ID: '会員ID(名寄せ結果)',
    JUDGE: '判定区分',
    CANDIDATE_FLAG: '候補一致フラグ(要確認)',
    ERROR: '処理エラー'
  },

  JUDGE_LABELS: {
    MATCHED: '既存一致',
    NEW: '新規',
    BLANK_NEW: '空欄新規'
  },

  // visit_history に追記する新規列（既存列は変更・削除しない）
  VISIT_HISTORY_NEW_COLUMNS: [
    '指名種別',
    '利用時間',
    '担当キャスト',
    '手ごたえ',
    '手ごたえ_自由記述'
  ],

  NOMINATION_TYPE_OPTIONS: ['フリー', '本指名', '場内指名', 'その他'],
  FEEDBACK_OPTIONS: ['良好', '普通', '要フォロー', 'リピート確度高'],

  BACKUP_FILENAME_PREFIX: 'BACKUP_',
  BACKUP_FILENAME_SUFFIX: '_会員データ拡張前'
};
