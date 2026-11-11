# 2026-11-11 我的訂單篩選與分頁（Issue #4）

## User Story
作為會員，我希望查詢自己的訂單時可以依狀態篩選並分頁，以便在訂單很多時快速找到需要的訂單。

## Spec

### API 規格
- `GET /api/orders`，需 JWT（authMiddleware）
- Query 參數（皆選填）：

| 參數 | 規則 | 預設 |
|------|------|------|
| `status` | `pending`、`paid`、`failed` 其中之一 | 不篩選 |
| `page` | 正整數 | 1 |
| `limit` | 正整數；超過 50 以 50 計 | 10 |

- 成功回應：`{ data: { orders: [...], pagination: { page, limit, total, totalPages } }, error: null, message }`，格式與 `GET /api/admin/orders` 相同
- 只回傳目前登入會員自己的訂單，依建立時間由新到舊排序
- `status` 不在允許值內，或 `page`、`limit` 不是正整數：`400 VALIDATION_ERROR`，`data: null`

### 資料庫變更
- 無。沿用既有 `orders` 資料表。

### 業務規則
- 與後台列表不同：非法值**回 400**，不自動修正（後台是自動修正，不能沿用那段程式）
- 排序 `created_at DESC, rowid DESC`：`created_at` 只有秒級精度，同秒訂單以 `rowid` 排序，分頁才穩定
- `page` 超過總頁數：回 200 與空陣列（`pagination` 照實回傳）。需避免極大 `page` 造成 SQLite `OFFSET` 溢位而回 500：`offset >= total` 時不查詢
- 陣列或物件型別的 query（`?page=1&page=2`、`?status[]=paid`）視為非法，回 400
- 既有前端訂單頁需配合新格式：預設每頁只有 10 筆，必須提供換頁，否則舊訂單會看不到

### 檔案
- 新增 `src/utils/orderListQuery.js`：解析與驗證查詢參數的純函式
- 修改 `src/services/orderService.js`：`listOrdersForUser` 支援篩選與分頁，回傳 `{ orders, total }`
- 修改 `src/routes/orderRoutes.js`：驗證、呼叫 service、組合回應與 `@openapi`
- 修改 `public/js/pages/orders.js`、`views/pages/orders.ejs`：最小的上一頁／下一頁

## 驗收條件對照
| 驗收條件 | 對應測試 |
|----------|----------|
| 不帶參數：第 1 頁、每頁 10 筆、由新到舊 | 驗收測試、`tests/orderList.test.js` |
| `status=paid` 只回已付款 | 驗收測試、`tests/orderList.test.js` |
| 12 筆、`limit=5`，第 3 頁 2 筆、`totalPages` 為 3 | 驗收測試、`tests/orderList.test.js` |
| `limit=100` 以 50 計 | 驗收測試、`tests/orderList.test.js` |
| `status=unknown`、`page=0`、`limit=-1` 回 400 | 驗收測試、`tests/orderListQuery.test.js`、`tests/orderList.test.js` |
| 不會回傳其他會員的訂單 | 驗收測試、`tests/orderList.test.js` |

## 不做的項目（依 Issue）
- 後台訂單列表（`GET /api/admin/orders`）的調整
- 依日期區間或關鍵字搜尋
- 前端訂單頁的**篩選**與分頁 UI（選做）；只做「換頁」這個為避免舊訂單消失所必須的最小調整

## Tasks
- [x] 取得驗收測試失敗基準（`npm run test:acceptance -- order-filter`）
- [x] 實作查詢參數解析、service 與路由（含 `@openapi`）
- [x] 前端訂單頁換頁
- [x] 撰寫 Unit／API／Integration 測試
- [x] 驗證：`test:unit`、`test:integration`、`test:acceptance -- order-filter` 全綠
- [x] 更新文件與 `openapi.json`，計畫移至 `docs/plans/archive/`
- [ ] AI 審查、開 PR、標記 in-review
