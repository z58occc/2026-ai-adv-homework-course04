# 2026-11-13 Loop 自動領取驗證（Issue #6）

## User Story
作為專案維護者，我希望 `/loop` 排程能自動讀取 `.claude/loop.md`、領取帶 `ready` 標籤的 Issue 並走完 `/work-issue` 流程，以便確認自動化流程可以正常運作。

## Spec

### Issue 要求
- 在專案檔案裡隨意更動一個檔案，作為「AI 已讀到這個 Issue」的證明
- 在終端機留下相關任務的讀取排程及說明

Issue 沒有指名驗收測試，也沒有「不在範圍」章節；以下對照表是依這兩句要求自行整理。

### 驗收條件對照
| Issue 要求 | 對應做法 |
|---|---|
| 隨意更動一個專案檔案作為證明 | `docs/CHANGELOG.md` 新增一行；PR diff 可查 |
| 在終端機留下讀取排程及說明 | 本輪結束時在終端機輸出實際的排程（以 `CronList` 查到的 cron 與間隔為準）與每輪判斷流程 |

### 變更範圍
- 修改 `docs/CHANGELOG.md`：在 `[Unreleased] → Added` 新增「Loop 自動領取驗證（Issue #6）」
- 新增本計畫文件（完成後歸檔於 `docs/plans/archive/`）
- 純文件變更：不改程式碼、API、資料庫或測試

### 不做的項目
- 不新增測試（沒有行為變更）；既有 Unit／Integration 測試仍須全綠
- 不修改 `tests/acceptance/`
- 不執行 `npm run test:e2e`

## Tasks
- [x] 領取 Issue（`ready` → `in-progress`），從最新 `origin/main` 切出 `issue-6-loop-proof`
- [x] 在 `docs/CHANGELOG.md` 新增紀錄
- [x] `npm run test:unit`（260 項）與 `npm run test:integration`（29 項）全綠，無跳過
- [x] `code-reviewer` 審查：無 🔴；🟡 計畫命名與結構已依 `docs/DEVELOPMENT.md` 修正
- [ ] 提交、推送、開 PR（`Closes #6`），Issue 改為 `in-review` 並留言回報
