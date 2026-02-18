## Why

企業內部員工福利系統常因為需要下載獨立 App 而導致啟用率低、維運成本高，且離職後權限回收慢，存在管理與資安風險。現在需要先交付一個可上線 Pilot 的 MVP，驗證「在 LINE 內完成員工身份與福利入口」是否能同時提升使用率與管理效率。

## What Changes

- 建立 HR 後台 5-Minute Setup 流程：輸入 LINE Channel 設定後可自動完成 LIFF、Rich Menu、Webhook 佈建。
- 建立邀請與綁定流程：支援邀請連結/QR（TTL、使用次數限制）、批次 Email，員工以 LINE Login + 工號 + 一次性綁定碼完成綁定。
- 建立動態員工證：LIFF 顯示每 30 秒更新的動態 QR，提供線上驗證 API 判斷有效性與在職狀態。
- 建立基礎 Kill Switch：HR 標記離職後即時解除 Rich Menu、撤銷所有 active session、加入黑名單並保留稽核軌跡。
- MVP 僅交付社群版部署（Public Serverless + DynamoDB），企業版 VPC/RDS 留待後續階段。

## Capabilities

### New Capabilities
- `tenant-line-setup-wizard`: 企業租戶初始化與 LINE 資源自動佈建流程。
- `employee-invitation-binding`: 員工邀請、綁定與身分生命週期管理（含一次性綁定碼）。
- `digital-employee-id`: 動態員工證生成與掃碼驗證。
- `employee-offboarding-kill-switch`: 離職剔除、token/session 撤銷與黑名單控制。

### Modified Capabilities
- None.

## Impact

- API 與資料模型：新增租戶設定、邀請、綁定 session、員工身份、token/session 撤銷與稽核事件相關介面。
- 前端：新增 Admin Setup Wizard 與 LIFF 員工證頁面。
- 基礎建設：新增 AWS Lambda、API Gateway、DynamoDB、SQS、SES、Secrets Manager、CloudWatch、WAF、Budgets。
- 安全：採用 hardened JWT 混合策略（短效 access token + 伺服器端 refresh session + jti 撤銷）。
