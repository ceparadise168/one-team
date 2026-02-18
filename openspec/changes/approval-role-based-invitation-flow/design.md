## Context

目前系統已具備租戶 LINE 連線、綁定邀請、員工綁定、數位員工證與離職封鎖，但權限模型仍停留在「admin token 或綁定成功即使用」層級。這使 demo 無法展示企業實務中的「先申請、再審核、最後開通權限」流程，也無法細緻區分可邀請他人與可移除人員的操作權。

此變更需要跨越多個模組：身份綁定 (`invitation-binding`)、離職封鎖 (`offboarding`)、租戶 LINE 資源 (`tenant-onboarding`)、API 授權 (`auth-middleware` / `lambda`) 與資料儲存（employee binding record）。此外，rich menu 需要由單一資源擴充為「pending/approved」雙 menu，並在審核狀態變更時即時切換。

## Goals / Non-Goals

**Goals:**
- 建立可追蹤的 access request 狀態機（PENDING/APPROVED/REJECTED）。
- 讓管理者能審核申請並指派兩個獨立 permission：`canInvite`、`canRemove`。
- 將 permission 套用到實際 API 授權：邀請 API 與 offboard API。
- 建立 pending/approved rich menu 切換，確保 UX 與審核狀態一致。
- 保持與現有 admin token 相容，避免中斷既有運維流程。

**Non-Goals:**
- 不引入完整 RBAC 多角色系統（僅針對本次 demo 所需兩個 permission）。
- 不開發完整前台審核 UI（以 API + LINE 端可見行為為主）。
- 不變更 JWT/Session 發行機制本身（僅擴充 claims 與授權判斷）。

## Decisions

1. **以 Employee Binding 作為授權主體，擴充 access governance 欄位**
   - 決策：在 `EmployeeBindingRecord` 增加 `accessStatus`、`permissions`、`accessRequestedAt`、`accessReviewedAt`、`accessReviewedBy`。
   - 原因：綁定與 offboarding 已以此 record 為核心，擴充成本最低，且可與現有 session revocation/blacklist 相容。
   - 替代方案：獨立 `AccessGrant` table。優點是模型乾淨；缺點是本次 MVP/demo 需要額外 join 與一致性處理，超出必要複雜度。

2. **新增顯式 access request / approval API，而非隱式在綁定時自動批准**
   - 決策：新增 `POST /v1/employee/access-requests` 與 `POST /v1/admin/tenants/:tenantId/employees/:employeeId/access-decision`。
   - 原因：符合使用者提出的「申請 -> 審核 -> 開通」流程，行為可被觀察與測試。
   - 替代方案：綁定完成即 `APPROVED`。無法展示審核治理，不符合需求。

3. **Rich menu 採雙資源模型：pending 與 approved**
   - 決策：tenant line resources 擴充 `pendingRichMenuId` 與 `approvedRichMenuId`，保留 `richMenuId` 向後相容為 approved alias。
   - 原因：最小侵入支援「審核前後選單不同」，且與 LINE link/unlink API 能直接對應。
   - 替代方案：單一 rich menu + 動態切頁。無法達到「審核前僅看到申請入口」的清楚體驗。

4. **API 授權採「admin token OR employee permission」混合模式**
   - 決策：邀請與 offboard 路由加上授權 helper，允許 admin token 或 `accessStatus=APPROVED` 且具所需 permission 的員工 session。
   - 原因：同時滿足既有運維與新 demo；逐步演進而非一次替換。
   - 替代方案：全面移除 admin token。短期風險高，會破壞現有 smoke 流程。

5. **邀請連結/QR 先提供 API payload，不在本次後端生成圖片檔**
   - 決策：新增 endpoint 回傳一次性 invitation URL 與 QR payload 字串，由前端/外部工具產生 QR。
   - 原因：可立即支援 demo 與自動化測試，避免引入影像處理依賴。
   - 替代方案：後端直接輸出 PNG QR。需要新套件與儲存策略，不符合最小可行實作。

## Risks / Trade-offs

- **[權限欄位回溯相容風險]** 舊資料沒有 `accessStatus` / `permissions`。  
  → Mitigation：讀取時套用安全預設（未設定視為 `PENDING` 且無權限），並在綁定成功時初始化欄位。

- **[Rich menu 切換失敗造成狀態不一致]** 審核狀態已更新但 LINE 切換失敗。  
  → Mitigation：決策 API 先更新狀態再執行切換；切換失敗寫入 warning/audit 並允許重試端點（後續可補 job queue）。

- **[權限判斷分散在多路由]** 後續功能可能重複實作授權邏輯。  
  → Mitigation：抽出共用 `requireEmployeePermission` helper，統一在 lambda route 層調用。

- **[Demo 複雜度增加]** 需要多一步申請與審核操作。  
  → Mitigation：更新 smoke-test 與 README demo script，提供一鍵演示流程。
