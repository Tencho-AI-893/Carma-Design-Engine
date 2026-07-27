"use strict";
// Playwrightによる15navi操作。send_offers.mjs のロジックを移植。
// ログイン状態は storageState ファイルに保存し、以降の操作はヘッドレスで行う。

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

class Automation {
  constructor(dataDir, logger) {
    this.dataDir = dataDir;
    this.stateFile = path.join(dataDir, "auth-state.json");
    this.screenshotsDir = path.join(dataDir, "screenshots");
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    this.log = logger;
    this.loginBrowser = null;
    this.loginPage = null;
  }

  hasAuthState() {
    return fs.existsSync(this.stateFile);
  }

  // === ログイン: 目視できるブラウザを起動し、可能ならID/PWを自動入力 ===
  async launchLogin(settings) {
    if (this.loginBrowser) {
      this.log("ログイン用ブラウザは既に起動しています");
      return;
    }
    this.log("ログイン用ブラウザを起動します...");
    this.loginBrowser = await chromium.launch({ headless: false, slowMo: 100 });
    const context = await this.loginBrowser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "ja-JP"
    });
    this.loginPage = await context.newPage();
    this.loginBrowser.on("disconnected", () => {
      this.loginBrowser = null;
      this.loginPage = null;
    });
    await this.loginPage.goto(settings.loginUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });
    if (settings.loginId && settings.loginPassword) {
      try {
        await this.loginPage.locator('input[type="text"]').first().fill(settings.loginId);
        await this.loginPage.locator('input[type="password"]').fill(settings.loginPassword);
        this.log("ID/パスワードを自動入力しました。画面でログインを完了してください");
      } catch {
        this.log("自動入力できませんでした。手動でログインしてください");
      }
    } else {
      this.log("画面で手動ログインしてください（設定タブにID/PWを保存すると自動入力されます）");
    }
  }

  // === ログイン完了: セッションを保存してブラウザを閉じる ===
  async finishLogin() {
    if (!this.loginPage) throw new Error("ログイン用ブラウザが起動していません");
    if (this.loginPage.url().includes("login")) {
      throw new Error("まだログインが完了していないようです（URLがloginのまま）");
    }
    await this.loginPage.context().storageState({ path: this.stateFile });
    await this.loginBrowser.close();
    this.loginBrowser = null;
    this.loginPage = null;
    this.log("ログイン状態を保存しました");
  }

  async _newSession() {
    if (!this.hasAuthState()) {
      throw new Error("ログインしていません。先に「ブラウザ起動ログイン」→「ログイン完了」を実行してください");
    }
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      storageState: this.stateFile,
      viewport: { width: 1280, height: 900 },
      locale: "ja-JP"
    });
    const page = await context.newPage();
    return { browser, page };
  }

  async _screenshot(page, name) {
    const file = path.join(this.screenshotsDir, `${name}_${Date.now()}.png`);
    await page.screenshot({ path: file, fullPage: true }).catch(() => {});
    return file;
  }

  // === リストページを巡回してスカウト対象を収集 ===
  async collectTargets(settings) {
    const { browser, page } = await this._newSession();
    try {
      let targets = [];
      for (let p = 0; p < settings.maxPages; p++) {
        const pageUrl = p === 0 ? settings.listUrl : `${settings.listUrl}&pos=${p * 24}`;
        this.log(`リストページ ${p + 1}/${settings.maxPages} を取得中...`);
        await page.goto(pageUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
        if (page.url().includes("login")) {
          throw new Error("セッション切れです。再ログインしてください");
        }
        const items = await page.$$eval("#scoutlist > li", (lis) =>
          lis
            .map((li) => {
              const detailLink = li.querySelector('a.btn_square_p[href*="detail"]');
              const nameLink = li.querySelector(
                'a[href*="detail"]:not(.btn_square_p):not(.add_hash_line)'
              );
              return {
                detailUrl: detailLink ? detailLink.href : "",
                member: nameLink ? nameLink.textContent.trim() : "不明"
              };
            })
            .filter((x) => x.detailUrl)
        );
        if (items.length === 0) {
          this.log(`ページ ${p + 1}: 対象者なし → 打ち切り`);
          break;
        }
        targets = targets.concat(items);
        this.log(`ページ ${p + 1}: ${items.length}件取得`);
      }
      this.log(`合計対象者: ${targets.length}件`);
      return targets;
    } finally {
      await browser.close();
    }
  }

  // === 下書き1件を実送信 ===
  // 戻り値: { status: "sent"|"skipped"|"failed", reason }
  async sendOne(page, draft) {
    const label = `[#${draft.id}] ${draft.member}`;
    try {
      await page.goto(draft.detailUrl, { waitUntil: "domcontentloaded", timeout: 15000 });

      // 受信上限チェック（例: "今日の受信数：28件/30件"）
      const limitText = await page
        .locator("text=今日の受信数")
        .textContent()
        .catch(() => "");
      if (limitText) {
        const m = limitText.match(/(\d+)件\/(\d+)件/);
        if (m && parseInt(m[1]) >= parseInt(m[2])) {
          this.log(`${label} → スキップ（受信上限: ${limitText.trim()}）`);
          return { status: "skipped", reason: "受信上限" };
        }
      }

      // 送信済みチェック（オファー回数が1以上）
      const offerCountText = await page
        .locator("text=オファー回数")
        .textContent()
        .catch(() => "");
      const cm = offerCountText.match(/(\d+)回/);
      if (cm && parseInt(cm[1]) > 0) {
        this.log(`${label} → スキップ（送信済み: ${offerCountText.trim()}）`);
        return { status: "skipped", reason: "送信済み" };
      }

      await page.locator('input[name="txtTitle"]').fill(draft.subject);
      await page.locator('textarea[name="txtMessage"]').fill(draft.body);
      await page.locator('input[name="btnKakunin"]').click();
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });

      const confirmText = await page.textContent("body");
      if (!confirmText.includes("送信します")) {
        this.log(`${label} → 失敗（確認画面に遷移できず）`);
        await this._screenshot(page, `error_confirm_${draft.id}`);
        return { status: "failed", reason: "確認画面エラー" };
      }

      await page.locator('input[name="btnSubmit"]').click();
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 });
      this.log(`${label} → 送信成功`);
      return { status: "sent", reason: "" };
    } catch (err) {
      this.log(`${label} → エラー: ${err.message}`);
      await this._screenshot(page, `error_send_${draft.id}`);
      return { status: "failed", reason: err.message };
    }
  }

  // === 選択した下書きを送信（dry-run対応・日次上限は呼び出し側で管理） ===
  async sendDrafts(drafts, settings, { onResult, canSend }) {
    if (settings.dryRun) {
      for (const d of drafts) {
        this.log(`[DRY RUN] [#${d.id}] ${d.member} → 送信対象（実送信なし）`);
        onResult(d, { status: "dry-run", reason: "dry-run" });
      }
      return;
    }
    const { browser, page } = await this._newSession();
    try {
      for (let i = 0; i < drafts.length; i++) {
        const d = drafts[i];
        if (!canSend()) {
          this.log(`本日の送信上限に到達したため中断します`);
          break;
        }
        const result = await this.sendOne(page, d);
        onResult(d, result);
        if (i < drafts.length - 1) {
          const waitMs = (Math.random() * 2 + 3) * 1000; // 3〜5秒のランダム待機
          await new Promise((r) => setTimeout(r, waitMs));
        }
      }
    } finally {
      await browser.close();
    }
  }

  // === 定期更新(bump): 設定されたURLを開きボタンをクリック ===
  async bumpOnce(settings) {
    if (!settings.bumpUrl || !settings.bumpSelector) {
      this.log("定期更新: bumpのURL/セレクタが未設定のためスキップ");
      return false;
    }
    const { browser, page } = await this._newSession();
    try {
      await page.goto(settings.bumpUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
      if (page.url().includes("login")) {
        this.log("定期更新: セッション切れです。再ログインしてください");
        return false;
      }
      await page.locator(settings.bumpSelector).first().click({ timeout: 10000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      this.log("定期更新(bump) 実行完了");
      return true;
    } catch (err) {
      this.log(`定期更新エラー: ${err.message}`);
      await this._screenshot(page, "error_bump");
      return false;
    } finally {
      await browser.close();
    }
  }
}

module.exports = { Automation };
