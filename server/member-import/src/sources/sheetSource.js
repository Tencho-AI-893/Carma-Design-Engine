'use strict';

const fs = require('fs');

/**
 * SheetSource インターフェース:
 *   async fetchHeaderAndRows() -> { headers: string[], rows: any[][] }
 *
 * rows は「見出し行を含まない」2次元配列（1行目のインデックスがスプレッドシートの2行目に対応）。
 * 本モジュールの上位ロジック（preflight/matching/dryRun）はこのインターフェースにしか依存しない。
 * 実際のSMCarmaServerが既にGoogleスプレッドシートへ接続する仕組みを持っているはずなので、
 * その実装をラップした SheetSource を用意してここに差し込む（このファイルの下部を参照）。
 */

// テスト・Dry Run動作確認用: ローカルJSON([[...],[...]] 形式)を読み込むだけの実装。
// 本番データには一切接続しない。
class FixtureSheetSource {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async fetchHeaderAndRows() {
    const raw = fs.readFileSync(this.filePath, 'utf8');
    const table = JSON.parse(raw);
    if (!Array.isArray(table) || table.length === 0) {
      return { headers: [], rows: [] };
    }
    return { headers: table[0], rows: table.slice(1) };
  }
}

/**
 * 本番用スタブ。実際のSMCarmaServerが既に持っているGoogleスプレッドシート
 * 接続処理（googleapis のサービスアカウント認証、もしくは既存のCSVエクスポート
 * 取得処理など）をここに実装して差し替える。
 *
 * このファイルでは実装を決め打ちしない（サービスアカウントの鍵ファイルの場所、
 * 認証方式は実環境を見ないと分からないため）。実際に接続する際に必要な情報は
 * README.md の「本番接続に必要な情報」を参照。
 */
class GoogleSheetsSource {
  constructor(/* spreadsheetId, sheetName, authClient */) {
    throw new Error(
      'GoogleSheetsSource は未実装です。実際のSMCarmaServerが使っているGoogle認証方式を確認した上で実装してください（README.md参照）。'
    );
  }
}

module.exports = { FixtureSheetSource, GoogleSheetsSource };
