# ONE TEAM 員工自助註冊上線流程 — User Story + UML 設計

## Context

重新定義整個員工從新報到到使用數位員工證的完整流程。取代原有的「邀請碼 + 批次 email 邀請」流程，改為更簡潔的「掃 QR Code → 自助註冊 → 主管審核」模式。

**設計決策**（已與使用者確認）：
- 員工資料輸入：**LIFF 網頁表單**（非 LINE 聊天對話）
- 審核方式：**WEB 後台 + LINE 雙軌**並行
- 舊邀請碼流程：**移除**，僅保留新的自助註冊流程

---

## 1. User Stories（使用者故事）

### US-1: 新進員工 — 加入 LINE OA 並申請開通

**作為**新進員工，
**我想要**透過掃描 QR Code 加入公司的 LINE 官方帳號，並填寫員工資料申請開通，
**以便**我能快速完成身份綁定，使用數位員工證與員工服務。

**驗收標準**:
1. 員工掃描 QR Code 後成功加入 LINE OA（觸發 follow event）
2. 系統自動回覆歡迎 Flex Message，含公司名稱與操作指引
3. 員工點選 Rich Menu「申請開通」後，收到含 LIFF 連結的回覆訊息
4. 點選連結開啟 LIFF 註冊表單，要求輸入：員工編號 + 暱稱
5. LIFF 透過 LINE LIFF SDK 取得 ID Token，連同表單資料送至 API
6. 系統驗證 LINE ID Token → 建立 EmployeeBindingRecord（accessStatus = PENDING）
7. 系統連結 pending rich menu
8. 員工看到「申請已送出，請等待管理員審核」確認畫面

### US-2: 新進員工 — 收到審核結果通知

**作為**新進員工，
**我想要**在管理員審核完成後立即收到 LINE 推播通知，
**以便**我知道是否已通過並能開始使用員工服務。

**驗收標準**:
1. 核准時：收到「✅ 存取申請已通過」Flex Message，Rich Menu 切換為 approved 版本
2. 拒絕時：收到「❌ 存取申請未通過」Flex Message，引導聯絡管理員
3. 被拒絕的員工可重新點選「申請開通」重新提交

### US-3: 管理員 — WEB 後台審核員工

**作為**管理員/主管，
**我想要**在 WEB 管理後台查看待審核的員工清單，並進行核准或拒絕，
**以便**我能有效管理員工的存取權限。

**驗收標準**:
1. 管理員登入 admin-web 後台（JWT 驗證）
2. 顯示待審核員工清單：員工編號、暱稱、申請時間
3. 可點選「核准」或「拒絕」按鈕
4. 操作完成後清單即時更新，系統自動推播通知給員工

### US-4: 管理員 — LINE 內審核員工

**作為**擁有管理權限的員工（主管），
**我想要**直接在 LINE 聊天室中審核待開通的員工，
**以便**不需要登入後台就能快速處理。

**驗收標準**:
1. 管理員從 approved rich menu →「員工服務」→「管理後台」→ 統計儀表板
2. 點選「查看待審核」→ carousel 顯示待審核員工卡片（顯示暱稱）
3. 每張卡片有「核准」「拒絕」按鈕，點選後立即執行
4. 有新註冊申請時，管理員收到 LINE 推播通知（含快速核准/拒絕按鈕）

### US-5: 已核准員工 — 使用數位員工證

**作為**已通過審核的員工，
**我想要**從 Rich Menu 快速開啟數位員工證 QR Code，
**以便**我能在需要時出示員工身份。

**驗收標準**:
1. Approved rich menu 左側按鈕「員工證」直接開啟 LIFF digital-id 頁面
2. 頁面顯示 QR Code，定期自動更新（25 秒）
3. QR Code 可被掃描器驗證

---

## 2. UML 圖表（Mermaid 語法）

### 2a. Use Case Diagram

```mermaid
graph TB
    subgraph Actors
        Employee["🧑 新進員工"]
        Admin["👔 管理員/主管"]
    end

    subgraph "ONE TEAM System"
        UC1["掃描 QR Code 加入 LINE OA"]
        UC2["查看歡迎訊息"]
        UC3["開啟 LIFF 填寫註冊表單"]
        UC4["提交自助註冊"]
        UC5["接收審核結果通知"]
        UC6["查看數位員工證 QR Code"]
        UC7["WEB 後台查看待審核清單"]
        UC8["WEB 後台核准/拒絕員工"]
        UC9["LINE 內查看管理儀表板"]
        UC10["LINE 內核准/拒絕員工"]
        UC11["接收新申請推播通知"]
    end

    Employee --> UC1
    Employee --> UC2
    Employee --> UC3
    Employee --> UC4
    Employee --> UC5
    Employee --> UC6

    Admin --> UC7
    Admin --> UC8
    Admin --> UC9
    Admin --> UC10
    Admin --> UC11
```

### 2b. Sequence Diagram — 完整流程

```mermaid
sequenceDiagram
    autonumber
    participant Emp as 新進員工
    participant LINE as LINE App
    participant LIFF as LIFF 註冊頁面
    participant WH as Webhook Handler
    participant API as ONE TEAM API
    participant DB as DynamoDB
    participant LineAPI as LINE Platform API
    participant AdminWeb as Admin Web
    participant AdminLINE as 管理員 (LINE)

    Note over Emp, LineAPI: Phase 1: 掃描 QR Code → 加入 LINE OA

    Emp->>LINE: 掃描 QR Code
    LINE->>WH: follow event {type:"follow", userId:"Uxxxx"}
    WH->>DB: 查詢是否有既有 binding
    DB-->>WH: 無記錄
    WH->>LineAPI: linkRichMenu → pending menu
    WH->>LineAPI: replyMessage → 歡迎 Flex Message
    LineAPI-->>LINE: 顯示歡迎訊息 + pending Rich Menu
    LINE-->>Emp: 看到歡迎訊息

    Note over Emp, LineAPI: Phase 2: 點選「申請開通」→ LIFF 表單

    Emp->>LINE: 點選 Rich Menu「申請開通」
    LINE->>WH: postback {data:"action=request_access"}
    WH->>DB: 查詢 tenant (取得 tenantName, liffId)
    WH->>LineAPI: replyMessage → 含 LIFF 連結 Flex Message
    Emp->>LINE: 點選「填寫員工資料」按鈕
    LINE->>LIFF: 開啟 /register?tenantId={tenantId}

    Note over LIFF, API: Phase 3: 提交註冊 → 建立 Binding

    LIFF->>LIFF: liff.init() → liff.getIDToken()
    Emp->>LIFF: 輸入 employeeId + nickname → 送出
    LIFF->>API: POST /v1/public/self-register
    API->>LineAPI: 驗證 LINE ID Token
    LineAPI-->>API: {lineUserId:"Uxxxx"}
    API->>DB: 檢查 employeeId / lineUserId 重複
    API->>DB: 建立 EmployeeBindingRecord (PENDING)
    API->>LineAPI: linkRichMenu → pending menu
    API-->>LIFF: 200 OK {status:"PENDING"}
    LIFF-->>Emp: 「申請已送出，請等待審核」

    Note over API, AdminLINE: Phase 4: 通知管理員

    API->>DB: 查詢該 tenant 的管理員
    API->>LineAPI: pushMessage → 每位管理員
    LineAPI-->>AdminLINE: 收到「新員工申請開通」通知

    Note over AdminWeb, DB: Phase 5a: WEB 後台審核

    AdminWeb->>API: GET /v1/admin/tenants/{tid}/employees?status=PENDING
    API->>DB: 查詢 PENDING 員工
    API-->>AdminWeb: 員工清單
    AdminWeb->>API: POST /v1/admin/.../access-decision {decision:"APPROVE"}
    API->>DB: 更新 accessStatus → APPROVED
    API->>LineAPI: linkRichMenu → approved menu
    API->>LineAPI: pushMessage → 員工「申請已通過」
    API-->>AdminWeb: 200 OK

    Note over AdminLINE, DB: Phase 5b: LINE 內審核

    AdminLINE->>LINE: 點選通知「核准」按鈕
    LINE->>WH: postback {data:"action=admin_approve&eid=E001"}
    WH->>API: decideAccess(APPROVE)
    API->>DB: 更新 accessStatus → APPROVED
    API->>LineAPI: linkRichMenu → approved menu
    API->>LineAPI: pushMessage → 員工「申請已通過」
    WH->>LineAPI: replyMessage → 管理員「已核准 E001」

    Note over Emp, LINE: Phase 6: 使用數位員工證

    Emp->>LINE: 點選 Rich Menu「員工證」
    LINE->>LIFF: 開啟 /digital-id
    LIFF->>API: GET /v1/liff/.../me/digital-id
    API-->>LIFF: {qrPayload, expiresAt, ...}
    LIFF-->>Emp: 顯示數位員工證 QR Code
```

### 2c. State Machine Diagram — Employee Binding 生命週期

```mermaid
stateDiagram-v2
    [*] --> UNREGISTERED: follow LINE OA

    UNREGISTERED --> PENDING: 提交 LIFF 註冊表單<br/>POST /v1/public/self-register

    PENDING --> APPROVED: 管理員核准<br/>(WEB 或 LINE)<br/>→ 切換 approved rich menu

    PENDING --> REJECTED: 管理員拒絕<br/>→ 保持 pending rich menu

    REJECTED --> PENDING: 重新申請開通<br/>→ 重新提交表單

    APPROVED --> OFFBOARDED: 離職處理<br/>→ unlink rich menu

    OFFBOARDED --> [*]

    state UNREGISTERED {
        direction LR
        u1: 尚無 BindingRecord
        u2: Rich Menu = pending
    }

    state PENDING {
        direction LR
        p1: accessStatus = PENDING
        p2: Rich Menu = pending
    }

    state APPROVED {
        direction LR
        a1: accessStatus = APPROVED
        a2: Rich Menu = approved
        a3: 可使用員工證 / 員工服務
    }

    state REJECTED {
        direction LR
        r1: accessStatus = REJECTED
        r2: Rich Menu = pending
    }

    state OFFBOARDED {
        direction LR
        o1: employmentStatus = OFFBOARDED
        o2: Rich Menu = unlinked
        o3: Session revoked
    }
```

### 2d. Activity Diagram — 整體流程含決策點

```mermaid
flowchart TD
    Start([開始]) --> ScanQR[員工掃描 QR Code]
    ScanQR --> FollowOA[加入 LINE OA]
    FollowOA --> CheckExisting{有既有<br/>active binding?}

    CheckExisting -->|有| AlreadyBound[顯示對應 rich menu]
    CheckExisting -->|無| SendWelcome[回覆歡迎訊息<br/>連結 pending rich menu]

    SendWelcome --> ClickApply[員工點選「申請開通」]
    ClickApply --> PostbackHandler[Webhook 處理 postback]
    PostbackHandler --> ReplyLIFF[回覆 LIFF 註冊連結]
    ReplyLIFF --> OpenLIFF[開啟 LIFF 註冊頁面]
    OpenLIFF --> FillForm[填寫 employeeId + nickname]
    FillForm --> SubmitForm[提交表單]

    SubmitForm --> ValidateToken{LINE ID Token<br/>驗證成功?}
    ValidateToken -->|失敗| ShowError[顯示錯誤訊息]
    ShowError --> OpenLIFF

    ValidateToken -->|成功| CheckDuplicate{employeeId 或<br/>lineUserId 重複?}
    CheckDuplicate -->|是| ShowConflict[顯示「帳號已被綁定」]
    CheckDuplicate -->|否| CreateBinding[建立 Binding<br/>PENDING]

    CreateBinding --> NotifyAdmin[推播通知管理員]
    NotifyAdmin --> ShowSuccess[「申請已送出」]

    ShowSuccess --> WaitApproval{管理員審核}

    WaitApproval -->|WEB 後台| WebApproval[admin-web 操作]
    WaitApproval -->|LINE| LineApproval[LINE postback 操作]

    WebApproval --> Decision{審核決定}
    LineApproval --> Decision

    Decision -->|核准| Approve[APPROVED<br/>切換 approved rich menu]
    Decision -->|拒絕| Reject[REJECTED<br/>保持 pending rich menu]

    Approve --> NotifyApproved[推播「申請已通過」]
    NotifyApproved --> UseService([員工使用數位員工證<br/>與員工服務])

    Reject --> NotifyRejected[推播「申請未通過」]
    NotifyRejected --> CanReapply([可重新申請])
    CanReapply --> ClickApply
```

---

## 3. API 變更

### 3.1 新增端點

#### POST /v1/public/self-register（替代舊的 bind/start + bind/complete）

```
POST /v1/public/self-register
Content-Type: application/json

{
  "tenantId": "tenant_abc",
  "lineIdToken": "eyJ...",
  "employeeId": "E001",
  "nickname": "小明"
}
```

處理流程：
1. `LineAuthClient.validateIdToken()` 驗證 lineIdToken → 提取 lineUserId
2. 檢查 employeeId / lineUserId 是否已被綁定（409 if duplicate）
3. 建立 EmployeeBindingRecord: `{ accessStatus: PENDING, nickname }`
4. linkRichMenu → pending menu
5. 查詢 tenant 管理員 → pushMessage 通知
6. Response: `{ tenantId, employeeId, accessStatus: "PENDING", registeredAt }`

Zod schema:
```typescript
const selfRegisterSchema = z.object({
  tenantId: z.string().min(1),
  lineIdToken: z.string().min(1),
  employeeId: z.string().min(1).max(50),
  nickname: z.string().min(1).max(50)
});
```

#### GET /v1/admin/tenants/{tenantId}/employees

```
GET /v1/admin/tenants/{tenantId}/employees?status=PENDING&limit=50
Authorization: Bearer {adminJwt}
```

Response:
```json
{
  "employees": [
    {
      "employeeId": "E001",
      "nickname": "小明",
      "accessStatus": "PENDING",
      "boundAt": "2026-02-28T10:00:00.000Z",
      "accessRequestedAt": "2026-02-28T10:00:00.000Z"
    }
  ]
}
```

### 3.2 移除的端點（舊 invitation flow）

| 端點 | 說明 |
|------|------|
| `POST /v1/admin/tenants/{tid}/invites` | 建立邀請連結 |
| `POST /v1/admin/tenants/{tid}/invites/batch-email` | 批次 email 邀請 |
| `POST /v1/admin/tenants/{tid}/invites/batch-jobs/{jid}/dispatch` | 發送批次邀請 |
| `POST /v1/public/bind/start` | 開始綁定（需 invitation token） |
| `POST /v1/public/bind/complete` | 完成綁定（需 binding code） |
| `POST /v1/liff/tenants/{tid}/me/invites` | 員工自建邀請 |

### 3.3 保留的端點

- `POST /v1/admin/tenants/{tid}/employees/{eid}/access-decision` — WEB 後台審核用
- `GET /v1/liff/tenants/{tid}/me/digital-id` — 數位員工證
- `POST /v1/line/webhook/{tid}` — LINE webhook

---

## 4. Rich Menu + Webhook 變更

### 4.1 「申請開通」按鈕行為

Rich menu 跨 tenant 共用同一 channel，無法在 URI 中嵌入 tenantId。

**方案**：保持 postback `action=request_access`，webhook handler（知道 tenantId）回覆含 LIFF 連結的 Flex Message：

```
LIFF URL: https://liff.line.me/{liffId}/register?tenantId={tenantId}
```

### 4.2 新增 `request_access` postback handler

```typescript
// WebhookEventService.handlePostback() 新增 case
case 'request_access':
  await this.handleRequestAccess(tenantId, event);
  return;
```

`handleRequestAccess` 邏輯：
1. 查詢 tenant → 取得 tenantName, liffId
2. 檢查 lineUserId 是否已有 binding：
   - 有 PENDING binding → 回覆「申請正在審核中」
   - 有 APPROVED binding → 回覆「您已開通」
   - 無 binding → 回覆 LIFF 註冊連結 Flex Message
3. 被 REJECTED 的也可重新填表

### 4.3 更新 Follow 事件歡迎訊息

```
handleFollow() 更新：
1. 查詢 tenant → 取得 tenantName
2. 檢查是否已有 binding
3. 無 binding → linkRichMenu(pending) + 回覆歡迎 Flex Message
4. 有 binding → 根據 accessStatus 連結對應 rich menu
```

---

## 5. 通知流程

| 事件 | 對象 | 管道 | 訊息 |
|------|------|------|------|
| 員工加入 LINE OA | 員工 | LINE reply | 歡迎 Flex Message |
| 員工點選「申請開通」 | 員工 | LINE reply | LIFF 註冊連結 |
| 員工提交註冊 | 管理員(s) | LINE push | 新申請通知（含核准/拒絕按鈕） |
| 管理員核准 | 員工 | LINE push | 「✅ 申請已通過」 |
| 管理員拒絕 | 員工 | LINE push | 「❌ 申請未通過」 |

管理員判定：`accessStatus === 'APPROVED'` 且 `canInvite === true || canRemove === true`

---

## 6. Domain Model 變更

`EmployeeBindingRecord` 新增欄位：
```typescript
nickname?: string;  // 員工暱稱
```

---

## 7. 前端變更

### LIFF Web — 新增 /register 頁面
```
apps/liff-web/src/registration/
  registration-form.tsx    // 表單元件
  use-registration.ts      // Hook: liff.init + API call
  types.ts
```

### Admin Web — 新增員工管理頁面
```
apps/admin-web/src/employee-management/
  employee-list.tsx        // 員工清單
  employee-card.tsx        // 員工卡片（含核准/拒絕按鈕）
  use-employee-list.ts     // Hook
  api-client.ts
  types.ts
```

---

## 8. 實作順序

| # | 工作項目 | 關鍵檔案 |
|---|----------|----------|
| 1 | Domain model: 新增 nickname 欄位 | `apps/api/src/domain/invitation-binding.ts` |
| 2 | 新增 POST /v1/public/self-register API | `apps/api/src/lambda.ts`, new service |
| 3 | 新增 GET /admin/.../employees API | `apps/api/src/lambda.ts` |
| 4 | 更新 webhook: follow 歡迎訊息 + request_access handler | `apps/api/src/services/webhook-event-service.ts` |
| 5 | 新增 Flex Message templates | `apps/api/src/line/flex-message-templates.ts` |
| 6 | 在 decideAccess 加入員工推播通知 | `apps/api/src/services/employee-access-governance-service.ts` |
| 7 | 在 self-register 加入管理員推播通知 | Step 2 的 service |
| 8 | LIFF Web: 註冊表單頁面 | `apps/liff-web/src/registration/` |
| 9 | Admin Web: 員工管理頁面 | `apps/admin-web/src/employee-management/` |
| 10 | 移除舊 invitation flow | `apps/api/src/lambda.ts` |
| 11 | 更新 Rich Menu script | `scripts/update-richmenu.mjs` |

---

## 9. 驗證方式

1. `pnpm build && pnpm test` — 確保所有測試通過
2. 部署後：掃 QR Code → 確認收到歡迎訊息 + pending rich menu
3. 點選「申請開通」→ 確認收到 LIFF 連結
4. 填寫表單送出 → 確認管理員收到推播
5. 管理員核准 → 確認員工收到通知 + rich menu 切換
6. 員工點選「員工證」→ 確認 QR Code 顯示正常
