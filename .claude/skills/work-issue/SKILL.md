---
name: work-issue
description: 把一個標示 ready 的 GitHub Issue 做完：領取、建分支、依規格實作、補測試、跑驗收測試、AI 審查、開 PR、標記 in-review 並在 Issue 留言回報。用法 /work-issue <Issue 編號>。只處理自己開的 Issue，絕不合併 PR。
argument-hint: <Issue 編號>
---

# work-issue：處理單一 Issue 直到開出 PR

處理的 Issue 編號：`$ARGUMENTS`

這個 Skill 負責從「領取 Issue」做到「PR 已開、Issue 標為 in-review、已留言回報」，然後**結束**。PR 的 CI 追蹤、修正與合併不在這裡：CI 失敗由 loop 的下一輪處理，合併一律由人工進行。

標籤狀態流轉：`ready` → `in-progress` → `in-review`；任何做不下去的情況 → `needs-human`。

## 步驟

### 0. 檢查參數

`$ARGUMENTS` 必須是單一正整數。不是就停止，說明用法 `/work-issue <Issue 編號>`，不做任何其他動作。以下用 `<n>` 代表這個編號。

### 1. 領取前檢查（任一項不符就停止，不改任何東西，只回報原因）

```bash
gh issue view <n> --json number,title,body,state,author,labels,comments
gh api user -q .login
gh issue list --author @me --state open --json number,labels
```

- Issue 必須是 `open`，且作者就是目前登入的帳號（只處理自己開的 Issue）
- 必須有 `ready` 標籤，且沒有 `in-progress`、`in-review`、`needs-human`
- 自己開的 open Issue 裡，不得已有其他 Issue 帶 `in-progress` 或 `in-review`（同時只處理一個）
- 計算輪數：已存在、開頭為 `Loop 回報｜Issue #<n>` 的留言數 + 1，記為 `N`。**`N` 大於 3 就不要動工**，直接走「失敗處理」改為 `needs-human`
- 規格必須讀得懂：缺「規則或規格」或「驗收條件」、內容互相矛盾，走「失敗處理」，不要自行臆測

### 2. 領取

```bash
gh issue edit <n> --remove-label ready --add-label in-progress
```

先改標籤再動工。這樣若中途中斷，下一輪 loop 會看到 `in-progress` 並改成 `needs-human`。

### 3. 讀規格與專案慣例

- Issue 內容：功能說明、規則或規格、驗收條件、驗收測試、**不在本次範圍**
- 驗收測試檔（Issue 內有指名，通常是 `tests/acceptance/<名稱>.test.js`）：**只讀不改**，用它確認實際 API 契約
- `CLAUDE.md`、`docs/ARCHITECTURE.md`、`docs/DEVELOPMENT.md`、`docs/FEATURES.md`、`docs/TESTING.md`
- 相關既有程式碼（路由、`src/utils/`、`src/services/`、既有測試）

規格有「選做」的項目，預設不做；但為了讓既有功能不因新格式而壞掉所必須的調整（例如回應格式改變後，既有前端要能正常顯示），一定要做。

### 4. 建分支與計畫文件

```bash
git fetch origin main
git switch -c issue-<n>-<英文 kebab-case 簡稱> origin/main
```

- 分支從最新的 `origin/main` 切出，例如 `issue-3-order-filter`
- 工作目錄裡原本就有、與本 Issue 無關的變更（例如 `package-lock.json`、`.claude/loop.md`）**不要 stage、不要還原、不要 stash**。若這些變更導致切分支失敗，走「失敗處理」
- 依 `CLAUDE.md` 在 `docs/plans/issue-<n>-<簡稱>.md` 寫簡短計畫：目標、要改的檔案、驗收條件對照、不做的項目

### 5. 取得驗收測試的失敗基準

派 `test-runner` 執行 `npm run test:acceptance -- <關鍵字>`（關鍵字取驗收測試檔名，如 `order-filter`）。實作前預期失敗，記下失敗項目，作為完成後的對照。

### 6. 實作

遵守 `CLAUDE.md` 與 `docs/DEVELOPMENT.md`：

- 所有 API 回應為 `{ data, error, message }`，錯誤時 `data: null`；錯誤碼與 HTTP 狀態碼對照 `docs/ARCHITECTURE.md`
- Request Body 欄位 camelCase，Response 欄位 snake_case；CommonJS；檔名依命名規則
- 費用、折扣、狀態轉換等業務規則放 `src/utils/`（無狀態純函式）；需讀寫 DB 且多處共用的邏輯放 `src/services/`；路由只負責驗證輸入、呼叫 service、組合回應
- 金額一律整數；後端自行重算，不信任前端傳入的總額
- SQL 一律用 `?` 參數化；動態的 `ORDER BY` 等片段用白名單
- 查詢參數與 Body 都要處理非預期型別（陣列、物件、空字串、負數、小數、超大值）
- 只回傳目前登入會員自己的資料；改動認證或授權相關程式時格外小心
- 改既有資料表欄位時，用可重複執行的 migration，並明確處理舊資料
- 路由要補 `@openapi` JSDoc
- 只改規格要求的範圍，不順手重構，不做「不在本次範圍」的項目

### 7. 補測試

- 在 `tests/` 新增或擴充 Unit/API 測試（檔名 `*.test.js`），需要時補 `tests/integration/`
- 涵蓋驗收條件裡的每一項與邊界值（例如分頁的 `page`／`limit` 上下限、空結果、其他會員的資料）
- 重要資料變更同時斷言 API 回應與 SQLite 最終狀態
- 測試一律使用記憶體 SQLite，從 `tests/setup.js` 取得 `app`，不得碰專案 `database.sqlite`；外部服務必須 mock
- **不得**修改 `tests/acceptance/`；**不得**刪除、`.skip`、`.only`、放寬既有測試的斷言來讓測試通過。既有測試因規格而必須調整時，調整的理由要寫進 PR 描述

### 8. 驗證

派 `test-runner` 依序執行：

```bash
npm run test:unit
npm run test:integration
npm run test:acceptance -- <關鍵字>
```

- 三項都全綠才能往下。出現被跳過（skipped）的測試也要查明原因
- 有失敗就修正再跑。**同一個失敗修正嘗試超過 3 次仍無法通過**，走「失敗處理」
- 不執行 `npm run test:e2e`（會寫入開發資料庫並連綠界 staging）

### 9. 同步文件與 OpenAPI

- 路由或 JSDoc 有變動就執行 `npm run openapi`，重生並提交 `openapi.json`
- 更新相關文件：`docs/FEATURES.md`（功能與錯誤碼）、`docs/ARCHITECTURE.md`（API、schema、流程）、`docs/TESTING.md`（測試數量與驗收測試狀態）、`docs/CHANGELOG.md`、`docs/README.md`（若有對外說明）
- 測試數量以實際執行結果為準
- 驗證全綠後，把計畫文件移到 `docs/plans/archive/`（`git mv`）

### 10. AI 審查

派 `code-reviewer` 與 `security-reviewer`（兩者都只讀、沒有 Bash）。在 prompt 中附上 Issue 編號、規格、`git diff main...HEAD` 的內容或變更檔案清單。改動涉及 `src/middleware`、`src/routes`、`src/utils/ecpay.js`、`src/services/paymentService.js`、訂單、購物車或後台 API 時，`security-reviewer` 必派。

- 🔴／高嚴重度與「必須修正」項目：修正後重跑步驟 8
- 🟡 以下：能安全修的就修；刻意不改的，整理進 PR 描述的「留給人工審查者決定」
- 審查回報若指出測試被削弱或 `tests/acceptance/` 被改動，視為最高優先，立即處理

### 11. 提交

先自我檢查：

```bash
git status
git diff --stat main...HEAD
git diff --name-only main...HEAD | grep '^tests/acceptance/'   # 必須沒有輸出
```

- 用**明確路徑**逐一 `git add`，不用 `git add -A` 或 `git add .`
- 不得提交 `.env`、`database.sqlite`、`postman_collection.json`、與本 Issue 無關的變更
- Commit 訊息：`feat: <繁體中文摘要>（Issue #<n>）`（修 bug 用 `fix:`），本文條列行為、實作、測試結果與不在範圍的項目，最後一行 `Closes #<n>`，再依當下 session 的署名指示加上 Co-Authored-By
- 不使用 `--no-verify`、`--amend` 已推送的 commit、force push

### 12. 推送並開 PR

```bash
git push -u origin issue-<n>-<簡稱>
gh pr create --base main --title "feat: <摘要>（Issue #<n>）" --body "<內容>"
```

PR 描述（繁體中文），開頭第一行 `Closes #<n>`，依序包含：

1. 摘要（含規則表或行為說明）
2. 行為與實作重點
3. 測試：`test:unit`、`test:integration`、`test:acceptance -- <關鍵字>` 的項數與結果；註明 `test:e2e` 未執行，以及 `tests/acceptance/` 未修改
4. 文件更新了哪些
5. AI 審查結果：兩位審查者各自的結論、已修正的項目
6. 留給人工審查者決定的低風險項目（未修改）
7. 不在本次範圍（依 Issue）

最後依當下 session 的署名指示加上 PR 署名行。

**開完 PR 就停，不得合併。**

### 13. 標記 in-review 並留言

```bash
gh issue edit <n> --remove-label in-progress --add-label in-review
gh pr checks <PR 編號>      # 剛開的 PR，通常是尚未執行或執行中
gh issue comment <n> --body "<回報>"
```

回報格式固定：

```
Loop 回報｜Issue #<n>｜第 <N> 輪
- 本輪動作：<做了什麼：實作、測試結果、PR 連結>
- CI 狀態：<gh pr checks 的實際結果；剛開通常是尚未執行／執行中，並註明本機三組測試已通過>
- 下一步：等待 CI 與人工審查合併；CI 失敗時由下一輪 loop 處理
```

留言後**本次結束**，不要再領其他 Issue。

## 失敗處理（改為 needs-human）

遇到下列任一情況，就不要硬做：

- 規格不明確、互相矛盾，或與既有行為衝突，需要人決定
- 要通過驗收測試就得修改 `tests/acceptance/`、或得削弱既有測試
- 需要新增相依套件、改動範圍外的行為，或必須執行 `test:e2e`
- 同一個失敗修正嘗試超過 3 次仍未通過，或 `N` 大於 3
- 因工作目錄狀態、網路、權限，導致切分支、推送、開 PR 失敗

處理方式：

1. `gh issue edit <n> --remove-label in-progress --remove-label ready --add-label needs-human`（沒有的標籤略過）
2. 在 Issue 留言，格式同上，並在「本輪動作」寫明卡在哪一步、失敗的測試名稱與錯誤摘要、需要人決定什麼；「下一步」寫「已改為 needs-human，等待人工處理」
3. 已完成的進度保留在 Issue 分支（可 commit 為 `wip:` 並推送該分支），**不要開 PR**、不要 reset 或清除成果
4. 結束

## 邊界（任何情況都不得違反）

- 只處理自己開的 Issue；同時只處理一個
- **不得合併 PR**：不執行 `gh pr merge`、不加 `--auto`、不 approve、不直接推送到 `main`。合併一律由人工進行
- **不得修改 `tests/acceptance/`**；不得刪除、跳過或放寬既有測試
- 不執行 `npm run test:e2e`；不開啟或修改 `database.sqlite`、`.env`
- 不 force push、不 `git reset --hard`、不 `git clean`、不 `--no-verify`
- 不手動關閉 Issue（PR 合併後由 `Closes #<n>` 自動關閉）
- 範圍以 Issue 為準，不做「不在本次範圍」的項目
- 修正輪數以 Issue 上的 `Loop 回報` 留言計算，合計超過 3 輪就改為 `needs-human`
