# AI 審查報告：訂單、付款、運費、購物車與相關測試

- 審查日期：2026-11-11
- 範圍：訂單、付款（含綠界 ECPay）、運費、購物車，以及相關的 middleware、routes、services、utils 與測試
- 審查方式：`security-reviewer`、`code-reviewer`（皆唯讀）與 `test-runner`（只跑測試，不修改檔案）
- **本次沒有修改任何程式碼**，僅新增本文件

## 0. 修正狀態（2026-11-11 更新）

下列為審查後已處理與刻意保留的項目。**第 1 節起的內容是修正前的審查紀錄，保持原樣**，行號為修正前的位置。

**驗證結果**：`npm run test:unit` 105 項全過（0 跳過）、`npm run test:integration` 16 項全過。新增的測試已用修正前的程式碼驗證過：26 項單元與 3 項整合測試會失敗，確認它們抓得到對應的問題。`test:e2e`、`test:acceptance` 未執行。

### 已修正

| ID | 處理 |
|---|---|
| H-1 | `GET /api/orders/:id` 改用 `findOrderForUser`，他人訂單回 404；補詳情、`/pay`、`check-payment`、訂單列表的跨使用者測試 |
| H-2 | PATCH 改用 `parsePositiveInteger`；建單前再檢查購物車數量（舊髒資料回 400）；補 13 種非法值、超庫存與所有權測試。**未做** DB 層 `CHECK`，需要 migration，另行評估 |
| H-3 | `>` 改 `>=`；移除 `it.skip` 並補 1,499／1,500／1,501（宅配與超商）、1,500 加附加費；API 與整合測試都驗證 DB 內金額；`calculateShipping` 只接受非負整數 |
| H-4（部分） | `authMiddleware` 與 `dualAuth` 共用 `resolveUserFromToken`，`email`、`role` 改以資料庫為準；補偽造 role、降權、已刪除使用者、錯誤密鑰、`alg:none`、過期、無效 token 不退回 session 的測試。**未做**啟動時強制 `JWT_SECRET` 長度與預設管理員密碼檢查，見下方 |
| M-1 | `TradeStatus=1` 一律要求有效 `CheckMacValue`，並新增 `MerchantID` 核對；補缺簽章、`MerchantTradeNo` 不符、`MerchantID` 不符、付款冪等、他人查詢的整合測試 |
| M-3 | 扣庫存改為 `... WHERE stock >= ?`，未生效即中止並整筆回滾，路由回 400 `STOCK_INSUFFICIENT`；以 `RAISE(IGNORE)` trigger 從 HTTP 端驗證 |
| M-5 | 頁面渲染失敗改記錄於伺服器並回固定訊息 |
| M-7 | `orders.test.js` 改用固定商品、寫死期望金額、斷言 `CART_EMPTY`；整合測試補免運邊界；e2e 的運費斷言改為依規格推算（e2e 僅做語法檢查，未執行） |
| M-8（部分） | 測試數量、CHANGELOG、FEATURES、ARCHITECTURE、TESTING 與 README 已同步；Issue B 錯誤碼協調與 `docs/plans/` 仍待處理 |
| L-2 | 我的訂單、後台訂單列表加 `rowid DESC` 次要排序鍵 |
| L-3 | `calculateShipping` 改 `Number.isInteger` |
| L-4 | 結帳成功後不再把 `submitting` 設回 false |
| L-5 | `check-payment` 依 `markOrderPaid` 結果與 DB 現況回應，不再誤報成功 |
| L-6 | `/pay` 改用 `Object.hasOwn`，`constructor` 等原型鍵回 400 |
| L-11 | 收件人欄位以 trim 後的值儲存，並限制長度（100／254／200） |
| L-15（部分） | 已更新 PATCH 購物車、訂單詳情、建單的 JSDoc 並重新產生 `openapi.json`；各端點補列 401 與未文件化欄位尚未處理 |
| L-16 | 補「pending 訂單中的商品不可刪（409），付款後可刪」測試 |

### 刻意未處理

| ID | 原因 |
|---|---|
| H-4 啟動檢查 | 強制 `JWT_SECRET` 長度會讓目前本機 `.env`（回報為範例值）無法啟動，屬部署前的決策；預設管理員密碼同理。建議上線前再處理 |
| M-2 | 付款失敗是否回補庫存、pending 訂單逾時取消，需先確認需求（與 Issue B 相關） |
| M-4 | `/ecpay/notify` 是正式環境才需要的新功能，文件已說明本機以 `check-payment` 替代 |
| M-6 | 需新增相依套件（`express-rate-limit`、`helmet`）並改動登入流程，屬獨立工作 |
| L-1 | 訂單編號格式在 `FEATURES.md`、`ARCHITECTURE.md` 明文定為 5 碼，改格式是產品決策；可改為撞號時重試 |
| L-7 ～ L-10、L-12 ～ L-14 | 加固或待確認項目，未納入本次修正 |
| 第 7 節 Issue A／B／C | 屬新功能實作，不是缺陷修正；`tests/acceptance/` 維持原樣。**Issue A（優惠碼）已於 PR #2 實作**，B、C 尚未實作 |

## 1. 結論摘要

測試全綠（unit 54 通過 1 跳過、integration 10 通過），但**綠燈不代表正確**。被跳過的那一項測試，正好是能抓出運費邊界 bug 的測試；另有多個 High 問題沒有任何測試保護。

| 嚴重度 | 數量 | 項目 |
|---|---|---|
| High | 4 | H-1 訂單詳情 IDOR、H-2 購物車 PATCH 數量驗證、H-3 免運門檻差一、H-4（條件式）弱 JWT 密鑰與預設管理員 |
| Medium | 8 | M-1 ～ M-8 |
| Low | 16 | L-1 ～ L-16 |
| Critical | 0 | — |

建議優先處理：**H-2 → H-1 → H-3 → M-1**，這四項都能用幾行程式碼修正，且都能被金額或資料外洩直接衝擊。

### 嚴重度判定說明

- 兩位審查者對同一問題的評級不同時（例如免運門檻：security 評 Medium、code 評 High），本文取較高者。
- H-2 的「以約 6% 價格成交」完整攻擊鏈由 `security-reviewer` 追蹤程式碼得出，**未實際端到端執行**；其中兩個關鍵環節已由主對話驗證（見第 2 節）。若出貨為自動化，可視為 Critical。

## 2. 驗證狀態

下列項目由主對話在審查後親自對照原始碼或實測，其餘為審查者回報，**尚未獨立驗證**。

| 項目 | 驗證方式 | 結果 |
|---|---|---|
| H-3 免運門檻 | 讀 `src/utils/shipping.js:39-41`、`tests/shipping.test.js:29` | 屬實：`subtotal > 1500`，對應測試為 `it.skip` |
| H-1 訂單詳情 IDOR | 讀 `src/routes/orderRoutes.js:350-364` | 屬實：只用 `findOrderById(req.params.id)`，沒有 `user_id` 條件 |
| H-2 PATCH 數量 | 讀 `src/routes/cartRoutes.js:292-322` | 屬實：只有 `Number()` 加 `isNaN`；POST 在第 195 行有用 `parsePositiveInteger`，PATCH 沒有 |
| H-2 小數可寫入 | 在記憶體 SQLite 以相同 schema 實測 | 屬實：`0.0625`、`0.5`、`1.5` 皆通過 `CHECK(quantity > 0)` 並以 `real` 儲存；`0`、`-3` 被擋下 |
| M-1 缺簽章 | 讀 `src/services/paymentService.js:15` | 屬實：`tradeInfo.CheckMacValue &&` 在欄位缺失時跳過驗證 |
| L-6 `actionMap` 原型鍵 | 讀 `orderRoutes.js:437-438`，並實測 `actionMap['constructor']` | 屬實：為 truthy，會通過檢查 |
| `.env`、`database.sqlite` 未被追蹤 | `git ls-files .env database.sqlite` | 無輸出，未被追蹤 |
| H-4 `.env` 內容 | 僅 `security-reviewer` 以 grep 比對，未輸出內容 | 未獨立驗證 |

## 3. 測試執行結果

| 指令 | 結果 | 備註 |
|---|---|---|
| `npm run test:unit` | exit 0；54 passed、**1 skipped**（共 55） | 跳過：`tests/shipping.test.js:29` |
| `npm run test:integration` | exit 0；10 passed | 無 skip／todo |
| `test:e2e`、`test:acceptance` | **未執行** | e2e 會寫入開發 DB 並連綠界 staging；acceptance 針對尚未實作的功能，預期失敗 |

- 無警告或非預期的 console 錯誤；`database.sqlite` 執行前後修改時間不變，測試沒有動到專案資料庫。
- 隔離規則符合：Vitest 使用 `:memory:`，沒有測試直接引用 `database.sqlite`，整合測試以 `vi.stubGlobal('fetch')` 隔離綠界，`playwright.config.js` 沒有 `webServer`，CI 只跑 unit 與 integration。

## 4. High

### H-1　任何已登入會員都能讀取他人訂單（IDOR，含收件人個資）

- 位置：`src/routes/orderRoutes.js:350-364`（第 351 行）
- 來源：security、code（兩位獨立發現）
- 問題：`GET /api/orders/:id` 以 `findOrderById(req.params.id)` 查詢，沒有 `user_id` 過濾。同檔的 `/pay`（約 446 行）與 `/check-payment`（約 499 行）都正確使用 `findOrderForUser`，只有詳情漏掉。
- 情境：會員 B 取得會員 A 的訂單 ID 後呼叫此端點，回應為整列訂單：`user_id`、`recipient_name`、`recipient_email`、`recipient_address`、`merchant_trade_no`、金額與品項。訂單 ID 是 UUIDv4，難以枚舉，但這不是授權機制；ID 會出現在未驗證的 `/ecpay/payment/:orderId`、`ClientBackURL`、瀏覽器歷史與 Referer 中。
- 規格：`docs/FEATURES.md:288-299` 寫明「他人訂單視為 404」。
- 建議：改用 `findOrderForUser(req.params.id, req.user.userId)`，查無一律回 404 與 `data: null`。
- 測試缺口：沒有任何測試以另一位會員的 token 打 `GET /:id`、`/pay`、`/check-payment`。

### H-2　購物車 PATCH 的數量驗證不足：小數可低價成交，0 與負數回 500

- 位置：`src/routes/cartRoutes.js:292-322`（驗證 296-299，寫入 315）
- 來源：security、code（兩位獨立發現）
- 問題：PATCH 只做 `Number(quantity)` 與 `Number.isNaN`，沒有使用 `parsePositiveInteger`。
  - **小數**：`0.5`、`0.0625`、`1.5` 會通過並以 REAL 寫入（已實測）。
  - **0、負數、`null`、`""`、`false`、`[]`**：`Number()` 轉成 0 或負數，通過檢查後在 UPDATE 違反 `CHECK(quantity > 0)`，回 `500 INTERNAL_ERROR` 而非 400。
  - **型別混淆**：`"1e2"` 被當 100、`"0x10"` 被當 16、`[5]` 被當 5、`true` 被當 1。
- 攻擊情境（`security-reviewer` 追蹤，未端到端執行）：
  1. 加入 1 件 NT$1,680 商品。
  2. PATCH `{"quantity": 0.0625}`，只過 `qty > stock` 檢查。
  3. `POST /api/orders`：`getCheckoutItems` 取回 0.0625，subtotal = 1680 × 0.0625 = 105（剛好整數）。
  4. 寫入 `subtotal=105`、`order_items.quantity=0.0625`、`stock = stock - 0.0625`。
  5. ECPay `TotalAmount` 為 105 加運費；付款後 `TradeAmt` 與 `total_amount` 一致，訂單標為 `paid`。
  - 條件：品項單價與數量的乘積為整數即可（例如 1/2、1/4、1/16）。結果是以約 6% 價格成交，庫存被扣成小數。
- 規格：`docs/FEATURES.md:191,202` 寫明必須為正整數，否則 `400 VALIDATION_ERROR`。
- 建議：
  - PATCH 改用 `parsePositiveInteger(quantity)`，不合法回 400。
  - 建立訂單前再驗一次 `Number.isInteger(item.quantity) && item.quantity > 0`。
  - DB 層加強：例如 `CHECK(quantity = CAST(quantity AS INTEGER))`，並對 `orders.subtotal`、`total_amount` 加整數約束。
  - 注意：`CREATE TABLE IF NOT EXISTS` 不會更新既有資料庫，DB 層變更需要 migration。
- 測試缺口：`tests/cart.test.js` 只測 POST 的 `[1.9, '3abc', [5]]`，完全沒有 PATCH 的非法值測試。

### H-3　免運門檻差一（`>` 應為 `>=`），且對應測試被 `it.skip` 掩蓋

- 位置：`src/utils/shipping.js:39-41`（`return subtotal > SHIPPING_RATES.FREE_SHIPPING_THRESHOLD`）
- 來源：code、security、test-runner
- 情境：商品小計剛好 1,500 元時，宅配實收 120、超商實收 60；結帳頁卻顯示免基本運費，使用者實付比畫面多。ECPay 的 `TotalAmount` 取伺服器值。
- 規格與其他實作都指向 `>=`：
  - 文件：`docs/FEATURES.md:232`、`docs/README.md:70`、`docs/ARCHITECTURE.md:420`
  - 驗收測試：`tests/acceptance/coupon.test.js:74-77`（折扣後剛好 1,500 → `shippingFee: 0`）
  - 前端：`public/js/pages/checkout.js:28`（`cartTotal >= 1500`）、`views/pages/cart.ejs:17`（`total < 1500` 才提示差額）
- 為何測試沒抓到：`tests/shipping.test.js:29` 的 `it.skip('商品小計 1,500 元時免基本運費')` 正是這個邊界，已讀原始碼確認。
- 文件與現況不符：
  - `docs/TESTING.md`、`docs/ARCHITECTURE.md:112` 記載「55 項」，必須把被 skip 的算進去才成立（實際 54 項執行加 1 項跳過）。
  - `docs/CHANGELOG.md:74` 宣稱已覆蓋「免運邊界」，與現況不符。
  - `CHANGELOG [Unreleased]:9` 提到把 Shipping 改成規則表並把測試改成 table-driven，疑似就是引入此行為改變的重構；**僅有一個 commit，無法用 git 歷史確認**。
- 建議：
  - 改成 `>=`，移除 `it.skip`。
  - 補 1499／1500／1501 的測試，宅配與超商各一組，再加「1500 加附加費」的組合。`docs/DEVELOPMENT.md:53` 要求邊界門檻要有單元測試。
  - 前端運費邏輯改為呼叫伺服器試算，或共用常數，避免兩套邏輯再次漂移。

### H-4（條件式，視部署而定）　弱 JWT 密鑰、角色取自 token、公開的預設管理員密碼

- 位置：`server.js:6`、`src/middleware/authMiddleware.js:18-31`、`src/routes/cartRoutes.js:17-26`、`src/database.js:116-117`、`.env.example:6,16-17`
- 來源：security（**主對話未獨立驗證**）
- 問題：
  - `server.js` 只檢查 `JWT_SECRET` 是否存在，不檢查長度與是否為範例值。`security-reviewer` 以 grep 比對（未輸出內容）回報，本機 `.env` 的 `JWT_SECRET` 就是 `.env.example` 的公開占位字串，長度不足 32 字元。
  - `authMiddleware` 與 `dualAuth` 只用 `decoded.userId` 確認使用者存在，`role` 與 `email` 直接信任 token 內容。
  - `ADMIN_PASSWORD` 預設為公開文件中的弱密碼（`.env.example`、`docs/README.md`、`database.js:117` 的 fallback），本機 `.env` 亦同。
- 情境：以此設定部署時，任何人註冊帳號取得自己的 `userId`，用公開占位密鑰偽造 `{userId, role: 'admin'}` 的 HS256 token，即可通過 `adminMiddleware`，讀取全部訂單個資、修改商品價格與庫存。即使密鑰夠強，管理員被降權後舊 token 仍有效至 7 天到期。
- 建議：
  - 非 test 環境啟動時強制 `JWT_SECRET` ≥ 32 字元並拒絕範例值，否則 fail fast。
  - 兩個 middleware 改為 `SELECT id, email, role FROM users`，以 DB 的 role 填 `req.user`，並共用同一段驗證函式。
  - 非 test 環境若 `ADMIN_PASSWORD` 未設或為預設值，拒絕建立管理員。
- 測試缺口：沒有 JWT 偽造防護測試（`alg:none`、錯誤密鑰、token 帶 `role:admin` 但 DB 為 user、已刪除使用者的 token）。

## 5. Medium

### M-1　check-payment 的 CheckMacValue 驗證是「有帶才驗」

- 位置：`src/services/paymentService.js:15`（已讀原始碼確認）
- 來源：code、security
- 問題：`if (tradeInfo.CheckMacValue && !verifyCheckMacValue(...))`。回應缺 `CheckMacValue` 時整段跳過，只要 `TradeStatus=1`、`MerchantTradeNo`、`TradeAmt` 吻合就標記 `paid`。
- 規格：`docs/FEATURES.md:380` 寫「先驗證回應的 CheckMacValue」。
- 情境：回應由程式直接 HTTPS 呼叫綠界取得，直接利用難度高；但 TLS 驗證被關、經代理或中間人，或 `queryTradeInfoUrl` 設錯時，可回傳沒有簽章的假「已付款」回應。
- 建議：`TradeStatus === '1'` 時一律要求簽章存在且正確，缺少就當失敗；另核對 `MerchantID === config.merchantId`。
- 測試缺口：`tests/integration/order-checkout.integration.test.js:421-454` 只測簽章被竄改與金額不符，沒有「缺簽章」與「MerchantTradeNo 不符」。

### M-2　未付款訂單永不過期，建單即扣庫存（庫存囤積）；付款失敗也不回補庫存

- 位置：`src/services/orderService.js:67-112`；`src/routes/orderRoutes.js:459-460`
- 來源：security、code（設計意圖**待確認**）
- 問題：建單即扣庫存，沒有取消端點、沒有逾時回補、沒有每人 pending 上限；模擬付款 `action=fail` 把訂單設為 `failed`，建單時已扣的庫存不會回補。
- 情境：惡意會員把庫存最大量加入購物車、建單、永不付款，商品即顯示無庫存，重複即可癱瘓銷售。
- 建議：實作 pending 訂單逾時自動取消並回補庫存（以 `UPDATE ... WHERE status='pending'` 守衛並放進 transaction）；限制每人同時 pending 數；加 rate limit。
- 待確認：若需求預期「付款失敗後庫存回滾」，這就是缺口；現有 docs 未規定，Issue B 只規定取消 pending 訂單要回補。

### M-3　扣庫存 SQL 沒有條件保護，多行程下庫存不足會變 500

- 位置：`src/services/orderService.js:83,105`（`UPDATE products SET stock = stock - ? WHERE id = ?`）；庫存檢查在 `orderRoutes.js:167-175`，位於 transaction 之外
- 來源：code
- 說明：單一 Node 行程內安全（better-sqlite3 同步，檢查到扣減之間沒有 `await`）。多行程（pm2、cluster）下，檢查與扣減之間可能被插入，最後靠 `CHECK(stock>=0)` 擋住，回 500 而非 400。**這是縱深防禦，不是目前單行程下的實際 bug。**
- 建議：改為 `... SET stock = stock - ? WHERE id = ? AND stock >= ?`，檢查 `changes`，不符時在 transaction 內 throw 並映射成 `STOCK_INSUFFICIENT`。

### M-4　`/ecpay/notify` 不存在，卻被設為 ReturnURL

- 位置：`src/utils/ecpay.js:114`
- 來源：security（設計限制）
- 問題：`app.js` 與所有 route 都沒有 `/ecpay/notify`，付款成功只能靠使用者回站按「查詢付款狀態」由 `check-payment` 回寫。docs 說明這是為本機開發刻意的設計。
- 情境：若部署到公網，使用者付款後關閉瀏覽器不回站，訂單會一直 pending（已扣款未入帳）；綠界對 ReturnURL 收到 404 會持續重送。
- 建議：上正式環境前新增 `POST /ecpay/notify`：先 timing-safe 驗證 `CheckMacValue`、`MerchantTradeNo`、`TradeAmt`、`MerchantID`，只以 `UPDATE ... WHERE status='pending'` 轉 `paid`（冪等），並回應純文字 `1|OK`。

### M-5　頁面路由 500 時回傳 `err.message`

- 位置：`src/routes/pageRoutes.js:9,17`、`app.js:50`
- 來源：security
- 問題：EJS render 失敗時 `res.status(500).send(err.message)`。EJS 錯誤訊息通常含檔案路徑與模板片段，洩漏內部資訊，也違反「500 一律回伺服器內部錯誤」。
- 建議：改成 `next(err)` 或回固定文字，由 `errorHandler` 統一處理。

### M-6　缺少 rate limit、安全標頭與對外請求逾時

- 位置：`app.js`（全專案無 helmet／rate-limit）、`src/routes/authRoutes.js:216-261`、`src/routes/orderRoutes.js:496-545`、`src/utils/ecpay.js:160`
- 來源：security
- 問題：
  - 登入與註冊無限流，且使用同步 `bcrypt.compareSync/hashSync`（阻塞 event loop），暴力破解與 CPU 耗盡很容易。
  - `check-payment` 每次呼叫都對外呼叫綠界 QueryTradeInfo，沒有限流，可能使商店被綠界限流或封鎖。
  - `queryTradeInfo` 的 `fetch` 沒有逾時，綠界變慢會讓請求堆積。
- 建議：對 `/api/auth/*` 與 `/check-payment` 套 `express-rate-limit`；`fetch` 加 5–10 秒逾時（`AbortSignal.timeout`）；改用非同步 `bcrypt`；加 `helmet`、`app.disable('x-powered-by')`。

### M-7　既有測試過弱，或與實作互為鏡像

- 來源：code
- `tests/orders.test.js:46-49`：預期運費以 `(productPrice >= 1500 ? 0 : 60) + 200 + 250` 現算，且 `productPrice` 取自 `products[0]`。種子商品同秒建立，`ORDER BY created_at DESC` 的第一筆不固定；種子價格沒有 1500，測不到邊界，H-3 無法被抓到。建議固定商品與價格，直接寫死期望值（如 1,680 → 450）。
- `tests/orders.test.js:64-81`：空購物車只斷言 `status 400` 與 `error` 屬性存在，沒斷言 `CART_EMPTY`，任何 400 都能通過。
- `tests/e2e/ecpay-atm-payment.spec.js:169-170`：`shipping_fee` 只斷言 `>= 0`（永遠成立），`total === subtotal + shipping_fee` 是同義反覆，抓不到運費算錯。
- 整合測試只有 subtotal 1,400（`order-checkout.integration.test.js:15-22`、`:188-196`），免運分支沒有任何 API 或 SQL 層測試。

### M-8　docs 與實作／測試現況不一致

- 來源：code
- `docs/TESTING.md`、`docs/ARCHITECTURE.md:112` 的測試數量把 skipped 算進去；`docs/CHANGELOG.md:74` 宣稱覆蓋「免運邊界」（見 H-3）。
- 狀態不符的錯誤碼待協調：Issue B 驗收測試要求取消 paid 訂單回 409，但 `docs/ARCHITECTURE.md:268` 把狀態不符定為 `INVALID_STATUS` / 400。
- `docs/plans/` 只有 `.gitkeep`，沒有任何計畫或 Issue 文件；Issue A／B／C 的規格只能從 `tests/acceptance/*` 反推，違反專案「功能開發使用 docs/plans/ 記錄計畫」的規則。

## 6. Low

| ID | 位置 | 問題 | 來源 |
|---|---|---|---|
| L-1 | `orderService.js:9` | `order_no` 隨機段只有 5 碼十六進位（約 100 萬種）且有 UNIQUE；日單量大時撞號機率可觀，撞號時 INSERT 失敗回 500。`MerchantTradeNo` 上限 20 字元，目前約 16，可放寬到 9 碼 | code、security |
| L-2 | `orderService.js:33`、`adminOrderRoutes.js:106` | `ORDER BY created_at DESC` 只有秒級精度，同秒訂單順序不定；Issue C 加分頁後會跨頁重複或遺漏。建議加 `, rowid DESC` | code |
| L-3 | `shipping.js:26` | `calculateShipping` 接受小數 subtotal，與 `DEVELOPMENT.md:51`「金額一律整數」不符；建議改 `Number.isInteger` | code |
| L-4 | `public/js/pages/checkout.js:49-62` | `finally` 在 `window.location.href` 賦值後立刻把 `submitting` 設回 false，導頁前再點一次會送第二個請求（後端回 `CART_EMPTY`）。純體驗問題 | code |
| L-5 | `orderRoutes.js:521` | `check-payment` 忽略 `markOrderPaid` 回傳值；若同時被模擬付款改成 failed，仍回「付款成功」但 `status=failed`。僅測試環境會發生 | code |
| L-6 | `orderRoutes.js:437-438` | `/pay` 的 `actionMap[action]` 可被原型鍵繞過：`action: "constructor"` 通過檢查後丟 TypeError 變 500（已實測 `actionMap['constructor']` 為 truthy）。端點僅 `NODE_ENV=test` 開放；建議改 `Object.hasOwn` | security |
| L-7 | `pageRoutes.js:61-72` | `/ecpay/payment/:orderId` 不需登入，只憑 UUID 即可取得付款表單（含品項名稱與金額，不含收件人資料，欄位皆有 `escapeHtml`）。建議加登入與歸屬檢查或短效簽章 | security |
| L-8 | `ecpay.js:4-6` | 金鑰有硬編碼 fallback（綠界公開的 staging 測試值，非機密），但 fail-open：`ECPAY_ENV=production` 卻漏設金鑰時會用測試值打正式環境。建議 production 缺金鑰時拒絕啟動。另 `BASE_URL`（`ecpay.js:103`）缺省為 localhost，漏設會使 `ClientBackURL`、`ReturnURL` 指向 localhost | security |
| L-9 | `sessionMiddleware.js`、`authRoutes.js:12-41` | `X-Session-Id` 沒有長度與格式驗證；登入或註冊時會把任意 `X-Session-Id` 的購物車併入帳號並刪除；大量隨機 session ID 可塞滿 `cart_items`，沒有清理機制。session 僅用於購物車，建單只接受 JWT | security |
| L-10 | `authRoutes.js:128-135,227-234` | 註冊重複 email 回 409、登入對不存在帳號不跑 bcrypt（回應時間差），可列舉帳號；email 未正規化大小寫，`A@x.com` 與 `a@x.com` 可各自註冊 | security |
| L-11 | `orderRoutes.js:124-139` | `recipientName`／`recipientEmail`／`recipientAddress` 以 `trim()` 驗證但儲存未 trim 的原值，且無長度上限（只受 `express.json()` 預設 100KB 限制） | code、security |
| L-12 | `adminOrderRoutes.js:91-93`（productRoutes 同寫法） | `limit` 有上限 100，`page` 無上限，極大值可能使 `OFFSET` 溢位。**待確認**，未實測 | security |
| L-13 | `views/layouts/front.ejs:12` | 載入 `https://unpkg.com/vue@3/...` 未鎖版本也無 SRI；結帳頁與 localStorage 中的 JWT 暴露在此供應鏈風險下 | security |
| L-14 | 前端與 auth | JWT 存 localStorage、無撤銷機制、7 天效期、無 CSP；目前未發現可利用的 XSS，但一旦出現即可被竊取 | security |
| L-15 | orders／cart 的 JSDoc | 多數端點沒列 401，`POST /api/orders` 未列 401，`check-payment` 的 200 沒有 schema（與 `DEVELOPMENT.md:241` 不一致）；`GET /:id`、`/pay`、`check-payment` 以 `...serializeOrder(order)` 回整列，含 `user_id`、`merchant_trade_no`，openapi 未列。openapi.json 與 JSDoc 目前同步 | code |
| L-16 | `tests/adminProducts.test.js` | 沒有「商品在 pending 訂單中 → 409」測試，`adminProductRoutes.js:356-369` 的規則無覆蓋 | code |

## 7. 規格尚未實作（非缺陷，供排程參考）

依 `tests/acceptance/*` 反推，下列功能目前**沒有實作**，驗收測試預期失敗，且不在 CI 內。

| 需求 | 狀態 | 備註 |
|---|---|---|
| Issue A 優惠碼（FLOWER100／SPRING10／SUMMER50） | 未實作 | `orderRoutes.js` 完全沒有 `couponCode` 處理（未知欄位被忽略，無效碼會建單成功而非 400）；`database.js` 沒有 `discount`、`coupon_code` 欄位。免運需以**折扣後**小計判斷，並依賴 H-3 的 `>=` 修正；折扣務必在伺服器端計算 |
| Issue B `POST /api/orders/:id/cancel` | 未實作 | 無此路由；`database.js:66` 的 `status` CHECK 只允許 pending／paid／failed，需重建表的 migration；需在單一 transaction 內「改狀態＋回補庫存」，並用 `findOrderForUser` 做所有權檢查。與 M-2、M-8 相關 |
| Issue C `GET /api/orders` 篩選與分頁 | 未實作 | 目前無分頁與 status 過濾；上限 50（後台為 100）、非法值要回 400（後台與商品列表是自動修正），不能沿用現有程式。與 L-2 相關 |

## 8. 測試缺口清單（建議補）

- **Shipping**：1499／1500／1501；超商 1499 與 1500；1500 加附加費；subtotal 為 0 或小數
- **Cart**：PATCH 非法數量（0、負數、小數、字串、陣列、`null`）與超庫存；POST 數量 0 或負數；POST 累加後超庫存；他人品項 PATCH／DELETE 回 404；DELETE 不存在項目；完全沒有認證回 401；`total` 計算
- **Orders**：他人訂單 GET 回 404；`CART_EMPTY` 精確錯誤碼；非法 `shippingMethod`、非 boolean 旗標、壞 Email；`/pay` 的 `fail` 路徑、無效 action、他人訂單；`check-payment` 的 `NO_TRADE_NO`、非 pending 訂單回現狀、他人訂單 404；庫存剛好等於數量與庫存為 0；連續兩次建單的第二次回 `CART_EMPTY`
- **Integration**：缺簽章、`MerchantTradeNo` 不符、已付款訂單重複 `check-payment` 不變
- **Auth**：JWT 偽造防護（`alg:none`、錯誤密鑰、role 與 DB 不符、已刪除使用者）

測試完整性結論（`code-reviewer`）：整個 `tests/` 只有 `tests/shipping.test.js:29` 一個 `it.skip`；沒有 `.only`、`.todo`、`xit`，也沒有被註解掉的測試；`tests/acceptance/` 與 HEAD 一致。因為 repo 只有一個 commit，**無法確認有無「被放寬過」的斷言**，只能依現況與文件比對推斷。

## 9. 已檢查且未發現問題的範圍

- **建單流程**：驗證 → `CART_EMPTY` → `STOCK_INSUFFICIENT`（列出所有不足商品名）→ 以 DB 價格重算 → 單一 `db.transaction()`（建單 → 品項快照 → 扣庫存 → 清購物車），transaction 內無非同步操作；整合測試有 rollback trigger 的回滾驗證。
- **金額由伺服器計算**：價格、subtotal、運費、總額皆由 DB 價格與 `calculateShipping` 重算；配送方式與布林旗標有型別驗證（僅門檻判斷有誤，見 H-3）。
- **訂單狀態機**：pending → paid／failed 不可逆，`/pay` 與 `check-payment` 皆以 `WHERE status='pending'` 條件更新，重複呼叫不會重複入帳。
- **ECPay 實作**：`generateCheckMacValue`（SHA256、排序、綠界專用 URL 編碼）；`verifyCheckMacValue` 使用 `crypto.timingSafeEqual` 並先比對長度；`TradeAmt`、`MerchantTradeNo` 嚴格比對；表單欄位經 `escapeHtml`。
- **認證與權限**：`jwt.verify` 指定 `algorithms: ['HS256']` 並查 DB 確認使用者存在；token 無效時 `dualAuth` 立即回 401，不退回 `X-Session-Id`；後台路由 `router.use(authMiddleware, adminMiddleware)` 順序正確；建單 router 只掛 `authMiddleware`；註冊 role 寫死為 `'user'`，沒有 mass assignment。
- **購物車歸屬（POST 以外）**：PATCH／DELETE／GET 皆以 `WHERE id = ? AND user_id/session_id = ?` 查詢；`${owner.field}` 插值只來自程式內寫死的兩個欄位名，不構成 SQL injection。
- **SQL injection**：`src` 內 SQL 皆為 prepared statement 的 `?` 參數；管理端 status 篩選用白名單。
- **模擬付款**：`testEnvOnly` 在非 `NODE_ENV=test` 時回 404，未找到繞過方式。
- **XSS、CORS、CSRF**：EJS 僅 `<%- body %>` 與 include，使用者可控值以 `<%= %>` 輸出；前端唯一 `innerHTML` 在 `header-init.js:26,30`，使用者名稱以 `textContent` 設定；Vue 文字插值，無 `v-html`。CORS 為單一來源 `FRONTEND_URL`；認證用 Authorization header、不使用 cookie，無 CSRF 風險。
- **其他**：`errorHandler` 的 500 一律回「伺服器內部錯誤」，日誌沒有洩漏金鑰；訪客購物車合併（相加、以庫存為上限、庫存 0 捨棄）符合規格且有登入與註冊兩條路徑的測試；`.gitignore` 排除 `.env`、`*.sqlite`。

## 10. 建議處理順序

1. **H-2**：PATCH 改用 `parsePositiveInteger`，並補 PATCH 非法值測試（金額被操縱，影響最大）。
2. **H-1**：`GET /api/orders/:id` 改用 `findOrderForUser`，並補跨使用者測試。
3. **H-3**：`>` 改 `>=`、移除 `it.skip`、補邊界測試，同步修正 `TESTING.md`、`CHANGELOG.md` 的描述。
4. **M-1**：`TradeStatus === '1'` 時強制要求簽章，並補兩個負向測試。
5. **H-4**：部署前處理（啟動檢查、role 取自 DB、預設管理員密碼）。
6. **M-2、M-4、M-6**：上正式環境前處理（庫存囤積、notify 端點、限流）。
7. 其餘 Medium／Low 依排程處理；Issue A／B／C 實作時一併參考第 7 節的注意事項。

> 本文件為審查結果，**尚未修改任何程式碼**。修正前請先確認 M-2 的設計意圖與 M-8 的錯誤碼協調。
