# Issue #8：測試 AI 是否能抓到這個 Issue

## 目標
驗證 loop 排程能自動讀到標示 `ready` 的 Issue #8，並在專案檔案中留下變更作為證明。

## 規格（來自 Issue）
- 讀到 Issue 後，在專案檔案裡更動任一檔案作為證明
- 在終端機留下相關任務的讀取排程及說明

## 要改的檔案
- `docs/CHANGELOG.md`：新增「Loop 自動領取驗證（Issue #8）」一行，記錄排程設定與流程
- `docs/plans/archive/2026-11-13-issue-8-loop-proof.md`：本計畫文件（已歸檔）

## 驗收條件對照
| 條件 | 對應 |
|------|------|
| 專案檔案有被更動 | `docs/CHANGELOG.md` 新增紀錄 |
| 終端機留下讀取排程及說明 | 終端機輸出 CronCreate job `0cf6b97e`（`*/1 * * * *`，讀取 `.claude/loop.md`）與本輪流程說明；PR 與 Issue 留言同步記錄 |

## 不做的項目
- 不改程式碼、API、資料庫或測試
- 不執行 `test:e2e`
