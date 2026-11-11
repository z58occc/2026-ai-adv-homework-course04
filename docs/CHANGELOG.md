# 更新日誌

所有重大變更皆記錄於此文件。格式參考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

### Added
- 結帳優惠碼（Issue #1）：`POST /api/orders` 可帶 `couponCode`（選填、不分大小寫、每張訂單最多 1 組）。`FLOWER100` 折抵 100 元（商品小計滿 800 元）、`SPRING10` 打 9 折最多折抵 300 元（折扣四捨五入至整數）、`SUMMER50` 已失效。優惠只折抵商品小計，免運門檻以折扣後小計判斷，訂單總額 = 商品小計 − 折扣 + 運費
- 新增 `src/utils/coupon.js` Coupon 模組：以規則表描述優惠碼，純函式、不依賴 Express 與資料庫，可獨立單元測試
- `orders` 新增 `discount`（預設 0）與 `coupon_code`（可為 NULL）欄位；既有資料庫啟動時自動補欄位，舊訂單視為未使用優惠碼
- 建立訂單回應、`GET /api/orders`、`GET /api/orders/:id` 與後台訂單 API 回傳 `discount`、`coupon_code`；無法使用的優惠碼回 400 `INVALID_COUPON`，不建立訂單、不扣庫存、不清空購物車
- 訂單詳情頁與後台訂單詳情顯示優惠折扣列
- 新增 `tests/coupon.test.js`（57 項）、訂單 API 與整合測試（含舊資料庫 migration）；驗收測試 `tests/acceptance/coupon.test.js` 通過。Unit 由 105 項增為 170 項，Integration 由 16 項增為 23 項
- 我的訂單篩選與分頁（Issue #4）：`GET /api/orders` 支援 `status`（`pending`、`paid`、`failed`）、`page`（預設 1）、`limit`（預設 10，最大 50，超過以 50 計），格式與後台列表相同；只回傳自己的訂單，依建立時間由新到舊，同秒訂單以 `rowid` 排序，換頁不會重複或遺漏
- 與後台列表不同，會員列表**拒絕**非法值：`status` 不在允許值內，或 `page`、`limit` 不是正整數（含空字串、陣列、物件）回 400 `VALIDATION_ERROR`；`page` 超過總頁數回 200 與空陣列，且不會因極大的 `page` 造成 SQLite `OFFSET` 溢位而回 500
- 新增 `src/utils/orderListQuery.js`：解析與驗證訂單列表的查詢參數（純函式）
- 新增 `tests/orderListQuery.test.js`（55 項）、`tests/orderList.test.js`（35 項）與 6 項整合測試；驗收測試 `tests/acceptance/order-filter.test.js` 通過。Unit 由 170 項增為 260 項，Integration 由 23 項增為 29 項

### Changed
- `GET /api/orders` 回應格式變更：原本一次回傳全部訂單，現在改為 `{ data: { orders, pagination: { page, limit, total, totalPages } } }`，預設只回第 1 頁 10 筆；`listOrdersForUser` 改為支援篩選與分頁並回傳 `{ orders, total }`
- 「我的訂單」頁配合新格式，每頁顯示 10 筆並提供上一頁／下一頁，避免第 10 筆以後的舊訂單看不到；換頁失敗時保留目前這一頁並顯示錯誤訊息，可直接重試（狀態篩選 UI 尚未提供）
- 抽出 `src/services/orderService.js`（訂單查詢、序列化與建單 transaction）與 `src/services/paymentService.js`（QueryTradeInfo 結果判斷與付款狀態更新）
- 新增 `src/utils/validators.js` 統一路由輸入驗證；Shipping 模組改以規則表描述，單元測試改為 table-driven
- `postman_collection.json` 不進版控（列入 `.gitignore`），需要時以 `npm run postman` 產生；路由變更後只需以 `npm run openapi` 同步 `openapi.json`。`docs/TESTING.md` 補上產生與匯入步驟
- `scripts/generate-postman.js` 產生結果固定，同一份 OpenAPI 重跑不再出現亂數差異

### Fixed
- `GET /api/orders/:id` 補上所有權檢查：他人訂單回 404，不再洩漏收件人姓名、Email、地址（與 `/pay`、`/check-payment` 一致）
- `PATCH /api/cart/:itemId` 改用 `parsePositiveInteger`：`0`、負數、小數、`"1e2"`、`[5]`、`null` 等回 400 `VALIDATION_ERROR`；修正前 `0` 與負數會回 500，小數會以 REAL 寫入並讓訂單金額與庫存失真（可用 `0.0625` 件以約 6% 價格成交）。建單前再檢查一次購物車數量，舊資料中的非整數數量回 400
- 免運門檻改為 `subtotal >= 1500`：商品小計剛好 1,500 元時，伺服器原本多收 60／120 元，與結帳頁、文件及驗收測試不一致。`calculateShipping` 同時改為只接受非負整數小計
- `check-payment` 對 `TradeStatus=1` 的回應一律要求帶有效 `CheckMacValue`（原本缺少簽章時會跳過驗證），並新增 `MerchantID` 核對
- 建單扣庫存改為條件式 `UPDATE ... WHERE stock >= ?`，未生效即中止並整筆回滾，回 400 `STOCK_INSUFFICIENT`；原本多行程下可能以 `CHECK` 失敗回 500
- `check-payment` 在訂單已被其他流程改成非 pending 時，不再誤報「付款成功」
- `PATCH /api/orders/:id/pay` 的 `action` 以 `Object.hasOwn` 檢查，`constructor` 等原型鍵回 400，不再回 500
- 頁面渲染失敗時不再把 `err.message`（含 EJS 檔案路徑）回給瀏覽器，改為記錄於伺服器並回固定訊息
- 收件人姓名、地址以 trim 後的值儲存，並限制姓名、Email、地址長度上限（100、254、200 字）
- 我的訂單、後台訂單列表排序加上 `rowid` 作次要鍵，同秒訂單的順序與分頁才穩定
- 結帳送出成功後不再把 `submitting` 設回 false，避免導向付款頁前重複送出
- 修正 macOS 上 Vitest 測試隨機失敗（401、200 或逾時）：supertest 自開的臨時伺服器綁在 `::`、卻連到 `127.0.0.1`，可能連到同埠的其他程式。新增 `tests/setup/testServer.js` 先在 `127.0.0.1` 開好伺服器，Unit、Integration 與驗收測試皆改用它

### Security
- `authMiddleware` 與 `dualAuth` 共用 `resolveUserFromToken`，`email`、`role` 改以資料庫為準，不再信任 JWT payload；管理員被降權或帳號被刪除後，舊 token 立即失效

### Tests
- 移除 `tests/shipping.test.js` 中被 `it.skip` 的「1,500 元免運」測試並補齊 1,499／1,500／1,501 邊界（宅配與超商）；`tests/orders.test.js` 改用固定商品與寫死的期望金額，空購物車斷言 `CART_EMPTY`
- 新增購物車 PATCH 數量驗證與所有權、他人訂單（詳情／付款／查詢）404、JWT 偽造與降權、`check-payment` 缺簽章／交易編號或商戶不符、付款冪等、免運邊界（API 與 DB）、庫存競爭回滾、pending 訂單中的商品不可刪除（409）等測試；Unit 由 54 項（另有 1 項 skip）增為 105 項，Integration 由 10 項增為 16 項
- E2E 的運費斷言改為依規格推算期望值，不再使用永遠成立的 `>= 0`

## [1.2.0] - 2026-10-06

### Added
- 第四場作業素材：`tests/acceptance/` 三份驗收測試（優惠碼、取消訂單、訂單篩選與分頁）、`vitest.acceptance.config.js` 與 `npm run test:acceptance`
- 根目錄 `README.md`：第四場作業前置準備（Use this template、GitHub CLI）

### Changed
- `test:unit` 排除 `tests/acceptance/`；驗收測試不加入 CI

## [1.1.1] - 2026-10-06

### Added
- 新增 GitHub Actions CI（`.github/workflows/test.yml`）：push、pull request 時執行 Unit 與 Integration Test，不執行 E2E
- 登入／註冊時若帶 `X-Session-Id`，將訪客購物車併入會員購物車（同商品數量相加、以庫存為上限），修正「訪客加入購物車 → 登入 → 結帳」時購物車變空
- 新增 10 項 Unit/API 測試與 1 項 Integration 測試，涵蓋本版修正

### Fixed
- 登入頁 `redirect` 參數只接受同源路徑，修正 open redirect 與 `javascript:` 造成的 XSS
- 導覽列使用者名稱改以 `textContent` 插入，不再經過 `innerHTML`
- 登入或註冊失敗（401）時不再被 `apiFetch` 導頁，錯誤訊息可正常顯示
- `POST /api/orders/:id/check-payment` 標記已付款前，驗證綠界回應的 CheckMacValue，並核對 `MerchantTradeNo` 與 `TradeAmt`；錯誤訊息不再夾帶內部錯誤細節
- 付款狀態更新加上 `status = 'pending'` 條件，確保狀態不可逆
- `PATCH /api/orders/:id/pay` 模擬付款僅在 `NODE_ENV=test` 開放，其他環境回 404
- 刪除仍在購物車中的商品時回 500：改為在 transaction 中先移除購物車品項
- `errorHandler` 依狀態碼回傳對應錯誤碼，JSON 格式錯誤改回 `VALIDATION_ERROR`，不再一律為 `INTERNAL_ERROR`
- 註冊、登入、建單、購物車、後台商品等 API 補上字串型別檢查；欄位傳入數字或物件時回 400，不再造成 500
- 購物車數量改為嚴格正整數驗證，`1.9`、`"3abc"`、`[5]` 不再被 `parseInt` 截斷後接受
- 後台新增商品拒絕全為空白的名稱，與編輯商品一致
- 註冊 API 的 bcrypt rounds 依規格於測試環境使用 1
- 訂單編號日期改採台北時間；前端訂單日期以 UTC 解析，修正台灣 00:00–08:00 下單顯示為前一天
- 購物車徽章改為重新查詢購物車品項數，修正重複加入同商品時數字與實際不符
- 文件修正：個人資料 API 的錯誤情境、check-payment 流程、OpenAPI 中 check-payment 的 400 說明與 `POST /api/cart` 的必填欄位

### Security
- Express 由 `~4.16.1` 升級至 `^4.22.3`，並以 `npm audit fix` 更新 `proxy-addr`、`uuid`、`brace-expansion`；`npm audit --omit=dev` 為 0
- `swagger-jsdoc` 僅供 `npm run openapi` 使用，移至 devDependencies

### Changed
- `CLAUDE.md` 與 `AGENTS.md` 內容同步：補齊 `test:unit`、`test:integration`、`test:e2e`、`postman` 指令與測試隔離、CI 規則
- `vitest.config.js` 移除無效的 `sequence.files` 設定；各測試檔使用獨立記憶體 SQLite，不依賴執行順序
- `.env.example` 補上 `NODE_ENV`、`PORT`，`FRONTEND_URL` 改為與本站同源的 `http://localhost:3001`
- 文件補充 Node.js 版本、CI 說明、目錄結構與已知限制（MerchantTradeNo 不可重複）

### Removed
- 移除 `pnpm-lock.yaml`，統一使用 npm（`package-lock.json`）
- 移除未使用的 `public/stylesheets/style.css`
- 清空 `docs/plans/archive/` 中的舊計畫

## [1.1.0] - 2026-08-17

### Added
- Playwright 綠界 E2E 於綠界付款成功後擷取 `ecpay-payment-success.png`；返回本站並驗證頁面「已付款」與 API `paid` 後，再擷取 `payment-return-success.png`。兩張均附加至 HTML report
- 新增 `npm run test:e2e` 與 Playwright 測試，對既有 3001 服務完成登入、購物車、配送結帳、綠界網路 ATM、土地銀行 Save、返店與 `paid` 雙重斷言
- 新增 `npm run postman`、`scripts/generate-postman.js` 及 `postman_collection.json`；登入自存 JWT，認證 API 自動使用 Bearer Token，並提供 `baseUrl` / `token` / `sessionId` 變數
- 新增 `npm run test:unit`，與 Integration/E2E/Postman 統一為明確的測試與產物指令
- 新增 `npm run test:integration`，以 Vitest + Supertest 驗證前端入口、建單 API、SQLite 寫入、運費、庫存、購物車、transaction rollback 與綠界付款流程
- 新增 `vitest.integration.config.js`、Integration Test fixture/reset helper 與 `database.sqlite` 雜湊守衛
- 新增 `src/utils/shipping.js` 獨立配送費用模組：宅配 120 元、超商 60 元、滿 1,500 元免基本運費、偏遠地區加收 200 元、當日急件加收 250 元
- 新增 `tests/shipping.test.js` Shipping 單元測試，覆蓋配送方式、免運邊界及附加費組合八種情境
- 訂單新增 `subtotal`、`shipping_fee`、`shipping_method`、`is_remote_area`、`is_express` 配送快照欄位
- 綠界 ECPay AIO 金流串接：結帳後導向綠界付款頁面完成真實付款流程
- 新增 `src/utils/ecpay.js` 工具模組：CheckMacValue 簽章產生/驗證、ECPay 專用 URL 編碼、QueryTradeInfo API 查詢
- 新增 `GET /ecpay/payment/:orderId` 頁面路由：產生自動送出的 ECPay 付款表單
- 新增 `POST /api/orders/:id/check-payment` API：透過 QueryTradeInfo API 主動查詢付款狀態（取代本地端無法接收的 Server Notify）
- 訂單新增 `merchant_trade_no` 欄位：對應綠界 MerchantTradeNo，由 order_no 去除連字號產生

### Changed
- `src/database.js` 支援 `DATABASE_PATH`；所有 Vitest 測試改用記憶體 SQLite，不再寫入專案 `database.sqlite`
- 綠界 QueryTradeInfo Integration Test 全數使用 mock fetch，測試不依賴外部網路
- `POST /api/orders` 新增配送條件驗證，由伺服器計算 `shipping_fee` 及 `total_amount = subtotal + shipping_fee`
- 結帳頁新增宅配/超商取貨、偏遠地區與當日急件選項；購物車及商品文案更新為滿 1,500 元免基本運費
- 訂單詳情與後台訂單詳情顯示商品小計、運費、配送條件與訂單總額
- 結帳頁面（checkout.js）：送出訂單後導向綠界付款頁面，不再直接跳轉訂單詳情
- 訂單詳情頁面（order-detail.ejs / order-detail.js）：原「付款成功/失敗」模擬按鈕改為「查詢付款狀態」與「前往付款」按鈕；從綠界導回時自動觸發付款狀態查詢

## [1.0.0] - 2026-04-12

### 新增
- 使用者註冊、登入、個人資料 API
- 商品列表與詳情 API（公開）
- 購物車 CRUD API（雙模式認證：JWT / X-Session-Id）
- 訂單建立、查詢、模擬付款 API
- 後台商品管理 API（CRUD）
- 後台訂單查詢 API（含狀態篩選）
- EJS 前台頁面（首頁、商品詳情、購物車、結帳、訂單）
- EJS 後台頁面（商品管理、訂單管理）
- SQLite 資料庫自動初始化與種子資料
- Vitest 測試套件（6 個測試檔案，循序執行）
- Swagger/OpenAPI 文件生成
- Tailwind CSS 樣式系統
- 專案文件結構建立
