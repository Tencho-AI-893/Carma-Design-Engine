# SM.Carma 会員データ取り込みモジュール（member-import）

会員データの名寄せ・visit_history拡張を、既存のNode.js/Expressサーバー
（SMCarmaServer）に安全に組み込むための独立モジュール。

## これは何か / 何でないか

- これは **既存の会員DB・スプレッドシートには一切書き込まない、読み取り専用の判定パイプライン**です。
  新規会員としてIDを発行した場合でも、それは「取り込み進捗台帳」(`data/import-state.json`)に
  記録されるだけで、既存の会員DB本体には自動で行を追加しません。
  実際に会員として登録するかどうかは、人が確認した上で別途行う前提です。
  （＝「誤った会員統合を起こさない」を最優先した設計判断）
- これは実際のGoogleスプレッドシート・実際の会員DBには、まだ一切接続していません。
  接続部分（アダプタ）は差し込み口として用意してあるだけです。下記「本番接続に必要な情報」を参照。

## ディレクトリ構成

```
src/
  config.js                 設定（パス・見出し候補などはすべて上書き可能）
  utils/                    電話番号・氏名の正規化、ID発行、原子的ファイル書き込み、ロック
  sources/sheetSource.js    データ取得元インターフェース（本番はここを実装する）
  repositories/             会員DB(読み取り専用)・取り込み進捗台帳へのアクセス
  services/                 preflight / dryRun / matching / visitHistory / validation / backup / workLog
  routes/formImport.js      Express Router（/form-import 配下のAPI）
  pipeline.js               本番実行の唯一の入口（Preflight→Backup→Matching→拡張→Validation）
  app.js                    動作確認用のスタンドアロンサーバー（ダミーデータのみ使用）
bin/restore.js              バックアップ復元のコマンド1発スクリプト
test/                       node:test によるテスト（すべてダミーデータで完結）
```

## 動作確認（実データ不使用）

```bash
cd server/member-import
npm install
npm test        # 全テスト実行
npm run dev      # ダミーデータで http://localhost:4321/form-import を起動
```

## 実際のSMCarmaServerへの組み込み方

既存の `app.js`（または相当するファイル）に、以下を追記するだけでよい設計にしてある。
既存のルーティングやミドルウェアは一切変更しない。

```js
const createFormImportRouter = require('./server/member-import/src/routes/formImport');
// sheetSource, memberRepository は実データにつながるアダプタを実装して渡す
app.use('/form-import', createFormImportRouter({ sheetSource, memberRepository, importStateRepo, config }));
```

### 本番接続に必要な情報（実装前に確認してほしいこと）

このモジュールは実際のスプレッドシート構造・DB構造を見ていないため、
以下は**推測で決め打ちせず、設定値として外から渡す形**にしてある。
実際に接続する前に、下記を確認・設定してほしい。

1. **スプレッドシートへの接続方法**
   - 既にSMCarmaServerがGoogleスプレッドシートを読んでいる場合、その認証方式
     （サービスアカウントの鍵ファイルの場所、もしくはAPIキー/OAuth等）は何か
   - `src/sources/sheetSource.js` の `GoogleSheetsSource` に、その方式で
     `fetchHeaderAndRows()` を実装する
2. **見出し列の実際の名前**
   - 電話番号・お客様名・来店日時・担当キャストの列見出しが、
     `src/config.js` の `*_HEADER_CANDIDATES` に含まれているか
   - 含まれていなければ候補を追加する（実データを壊さず追加できる）
3. **既存ローカルDBの実体**
   - SQLite / JSON / Postgres / その他何か
   - `src/repositories/memberRepository.js` の `MemberRepository` インターフェース
     （`findAll()` / `findByPhone()`）を、実際のDBに合わせて実装する
     （書き込みメソッドは意図的に用意していない）
4. **新規会員IDの命名規則**
   - 現状は `NEW-XXXXXXXX` 形式で仮発行している
   - 実際の運用に別のID体系（例:「I系列」等）があれば `src/utils/id.js` を差し替える

## 主要な安全設計

- **Preflight** (`services/preflight.js`): 接続・列の存在・列名重複・書き込み権限・
  件数系の異常を検知し、1つでも問題があれば `STOP: ...` で本処理を止める。副作用なし。
- **Dry Run** (`services/dryRun.js`): 実データを一切書き換えず、判定結果と理由を
  `data/dry-run-result.json` にプレビュー出力する。
- **本番パイプライン** (`pipeline.js`): Preflight→Backup→Matching→visit_history拡張→Validation
  の順に「しか」実行できない。Backup失敗時は100%中止。全体を`FileLock`で保護し、
  多重実行を防ぐ。
- **名寄せロジック** (`services/matching.js`): 電話番号の正規化（ハイフン・スペース・
  全角数字・前後空白を吸収）。電話番号空欄の行、氏名一致候補がある行は、どちらも
  **絶対に自動ではIDを確定させず、要確認/保留に回す**。新規ID発行は「電話番号があり、
  マスタにも氏名候補にも一致しない」場合のみ。同一電話番号には常に同一の新規IDを
  再利用する（複数回実行・別日実行をまたいで安全）。
- **Validation** (`services/validation.js`): スプレッドシート側の生データを直接数える
  方式と、保存済み判定結果を集計する方式の2系統で突き合わせ、加えて
  「同一電話番号に複数の新規ID」「同一の新規IDが複数の電話番号」という
  最重要リスクを直接検知する。
- **バックアップ** (`services/backup.js`): コピー後にSHA-256ハッシュを比較して
  検証するまでを「成功」とする。復元は `bin/restore.js` でコマンド1つで行え、
  復元の直前状態も自動でスナップショットする。
