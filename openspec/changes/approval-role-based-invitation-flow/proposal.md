## Why

目前 MVP 已完成租戶開通、邀請綁定、數位員工證與離職封鎖，但 demo 關鍵路徑仍缺「權限申請與審核」流程，無法完整展示企業內部治理場景。需要補齊可審核的存取生命週期，讓非技術觀眾能看到從申請、授權到功能可見性的全流程。

## What Changes

- 新增員工存取申請流程：未核准使用者可送出 access request，並可查詢目前審核狀態。
- 新增管理者審核流程：管理者可批准或拒絕申請，批准時可設定是否具備「邀請他人」與「移除人員（offboard）」權限。
- 新增角色/權限模型：綁定資料需記錄授權狀態與 permission flags，並套用到 API 授權。
- 新增 Rich Menu 可見性切換：未核准與已核准使用者使用不同 Rich Menu；審核通過或取消資格時需即時重新綁定對應選單。
- 調整邀請與移除 API 權限：批次邀請與離職封鎖從「僅 admin token」擴展為「admin token 或具對應權限的已核准員工 session」。
- 新增邀請分享體驗：提供一次性邀請連結/QR payload 產生 API，供具邀請權限的員工發送給被邀請者。

## Capabilities

### New Capabilities
- `employee-access-approval-governance`: 定義 access request、審核決策、權限指派、以及審核狀態驅動的 Rich Menu 切換行為。

### Modified Capabilities
- `employee-invitation-binding`: 邀請建立與綁定後可用功能需受新權限治理約束，並新增邀請連結/QR 產生者權限要求。
- `employee-offboarding-kill-switch`: 觸發離職封鎖的行為主體需支援具移除權限的已核准員工，而非僅 HR/admin token。
- `tenant-line-setup-wizard`: 佈建階段需同時管理「未核准」與「已核准」兩組 Rich Menu 資源，並可在狀態變更時切換。

## Impact

- `apps/api/src/lambda.ts` 路由與授權邏輯（新增 access request/approval API，調整邀請與 offboard 授權判斷）。
- `apps/api/src/domain/*` 與 `apps/api/src/repositories/*`（新增授權狀態與 permission 欄位、查詢介面）。
- `apps/api/src/services/invitation-binding-service.ts`、`apps/api/src/services/offboarding-service.ts`、`apps/api/src/services/tenant-onboarding-service.ts`（整合權限判斷與 rich menu 切換）。
- 測試：`apps/api/src/*.test.ts` 與 smoke 測試腳本，覆蓋申請/審核/授權/切換流程。
