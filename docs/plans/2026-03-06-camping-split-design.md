# 露營分帳系統設計

## 概述

ONE TEAM 新功能模組，透過 LINE LIFF 提供露營活動的分帳功能。支援營位費用（按人頭）、共用費用（按 weight）、代墊記錄、戶長合併結算，以最少轉帳次數完成帳務結清。

## 需求

- 整合進現有 LIFF app，共用認證和 DynamoDB
- 參與者：員工（有 LINE 綁定）+ 外部人員（手動加入）
- 費用兩種分攤邏輯：
  - 營位費用：同營位人頭均分（不考慮 weight）
  - 共用費用（食材、器材等）：按 weight 均分（大人=1, 小孩=0.5, 小小孩=0）
- 代墊：任何參與者可代墊，指定分攤對象（全部 or 特定人）
- 戶（Household）：家庭/情侶可組成一戶，可選擇合併結算（戶長代表收付）
- 結算：僅活動建立者可觸發，淨額貪心配對演算法
- 通知：網頁顯示 + LINE 推播 + 分享連結

## 資料模型

### Entity 定義

**CampingTrip**（露營活動）
- `tripId`: string (ULID)
- `tenantId`: string
- `creatorEmployeeId`: string
- `title`: string
- `startDate`: string (YYYY-MM-DD)
- `endDate`: string (YYYY-MM-DD)
- `status`: OPEN | SETTLED
- `createdAt`: string (ISO)

**TripParticipant**（參與者）
- `tripId`: string
- `participantId`: string (ULID)
- `name`: string
- `employeeId?`: string（外部人員為空）
- `lineUserId?`: string（有 LINE 綁定的才有）
- `splitWeight`: 1 | 0.5 | 0（大人/小孩/小小孩）
- `householdId?`: string（同一戶共用）
- `isHouseholdHead`: boolean
- `settleAsHousehold`: boolean（由戶長設定，該戶是否合併結算）

**CampSite**（營位）
- `tripId`: string
- `campSiteId`: string (ULID)
- `name`: string（如 "雨棚A"）
- `cost`: number
- `paidByParticipantId`: string（代墊者）
- `memberParticipantIds`: string[]（分配到此營位的參與者）

**Expense**（費用紀錄）
- `tripId`: string
- `expenseId`: string (ULID)
- `description`: string
- `amount`: number
- `paidByParticipantId`: string（代墊者）
- `splitType`: ALL | CUSTOM
  - ALL：按 weight 均分給所有 weight > 0 的參與者
  - CUSTOM：按 weight 均分給指定的參與者
- `splitAmong?`: string[]（CUSTOM 時必填，participantId 列表）
- `createdAt`: string (ISO)

**Settlement**（結算結果）
- `tripId`: string
- `transfers`: Array<{ fromParticipantId, toParticipantId, amount }>
- `participantSummaries`: Array<{ participantId, totalOwed, totalPaid, netAmount }>
- `formula`: string（結算公式文字說明）
- `settledAt`: string (ISO)

### DynamoDB PK/SK

```
CAMPING_TRIP#{tripId}  /  RECORD                        → Trip 主記錄
CAMPING_TRIP#{tripId}  /  PARTICIPANT#{participantId}    → 參與者
CAMPING_TRIP#{tripId}  /  CAMP_SITE#{campSiteId}         → 營位
CAMPING_TRIP#{tripId}  /  EXPENSE#{expenseId}            → 費用
CAMPING_TRIP#{tripId}  /  SETTLEMENT                     → 結算結果
```

GSI `gsi-line-user` 可查詢某 LINE 用戶參與的所有活動。

## 結算演算法

### Step 1: 計算每人應付

對每個參與者，加總：

**營位費用**：`campSite.cost / campSite.memberParticipantIds.length`（按人頭，不管 weight）

**共用費用（ALL）**：
```
totalWeight = Σ(所有 weight > 0 的參與者的 weight)
unitCost = expense.amount / totalWeight
個人分攤 = unitCost × 自己的 splitWeight
```

**指定費用（CUSTOM）**：
```
customWeight = Σ(splitAmong 中參與者的 weight)
unitCost = expense.amount / customWeight
個人分攤 = unitCost × 自己的 splitWeight
```

### Step 2: 計算每人已墊

`已墊 = Σ(自己是 paidBy 的 expense.amount) + Σ(自己是 paidBy 的 campSite.cost)`

### Step 3: 淨額

`淨額 = 應付 - 已墊`
- 正數 → 欠錢（debtor）
- 負數 → 被欠（creditor）

### Step 4: 合併戶

`settleAsHousehold = true` 的戶，將同戶成員淨額加總，由戶長代表。

### Step 5: 貪心配對

```
1. 分成 debtors（正淨額）和 creditors（負淨額）
2. 各按金額降序排列
3. 最大 debtor 配最大 creditor
4. 轉帳金額 = min(debtor 欠款, creditor 被欠款)
5. 扣除後歸零的移除
6. 重複直到清零
```

### Step 6: 四捨五入 + 公式

金額四捨五入到整數。為每人產出明細公式文字。

## API 端點

```
# 活動管理
POST   /v1/liff/camping/trips                              → 建立活動
GET    /v1/liff/camping/trips                              → 我參與的活動列表
GET    /v1/liff/camping/trips/{tripId}                     → 活動詳情（含參與者、營位、費用）

# 參與者管理
POST   /v1/liff/camping/trips/{tripId}/participants        → 新增參與者
PUT    /v1/liff/camping/trips/{tripId}/participants/{id}   → 修改
DELETE /v1/liff/camping/trips/{tripId}/participants/{id}   → 移除

# 營位管理
POST   /v1/liff/camping/trips/{tripId}/campsites           → 新增營位
PUT    /v1/liff/camping/trips/{tripId}/campsites/{id}      → 修改（含成員分配）
DELETE /v1/liff/camping/trips/{tripId}/campsites/{id}      → 刪除

# 費用管理
POST   /v1/liff/camping/trips/{tripId}/expenses            → 新增費用
PUT    /v1/liff/camping/trips/{tripId}/expenses/{id}       → 修改
DELETE /v1/liff/camping/trips/{tripId}/expenses/{id}       → 刪除
GET    /v1/liff/camping/trips/{tripId}/expenses            → 費用列表

# 結算
POST   /v1/liff/camping/trips/{tripId}/settle              → 觸發結算（僅建立者）
GET    /v1/liff/camping/trips/{tripId}/settlement           → 結算結果

# 公開分享
GET    /v1/public/camping/trips/{tripId}/summary            → 分享用結算摘要（免登入）
```

## 前端頁面

```
/camping                          → 活動列表
/camping/new                      → 建立新活動
/camping/{tripId}                 → 活動主頁（Tab: 參與者/營位/費用/結算）
/camping/{tripId}/expenses/new    → 新增費用表單
/camping/{tripId}/settlement      → 結算結果頁
/camping/{tripId}/share           → 公開分享頁（免登入）
```

## UX 流程

```
Step 1: 建立活動（名稱、日期）
         ↓
Step 2: 加入參與者
        - 「新增一戶」→ 戶長 → 成員（類型：大人/小孩/小小孩）→ 合併or分開結算
        - 「新增個人」→ 名字 + 類型
        - 來源：員工名單 or 手動輸入
         ↓
Step 3: 設定營位
        - 新增營位（名稱、費用、代墊者）
        - 勾選/拖拉分配人員（可勾整戶）
         ↓
Step 4: 記錄費用（隨時可加）
        - 金額、說明、代墊者
        - 分攤：全部均分 or 指定人員
        - 費用列表底部即時顯示每人預估金額
         ↓
Step 5: 結算（建立者觸發）
        - 轉帳指示 + 每人明細公式
        - LINE 推播 + 分享連結
```

## LINE 推播

結算完成時，對有 `lineUserId` 的參與者推送 Flex Message：
- 活動名稱
- 你的應付/應收金額
- 轉帳對象
- 「查看詳情」按鈕 → 導向結算結果頁
