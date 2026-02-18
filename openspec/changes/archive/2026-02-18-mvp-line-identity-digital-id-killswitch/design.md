## Context

`one-team` 目前僅有 OpenSpec 骨架，尚未有應用程式碼。此變更要在單一 codebase 建立第一個可上線 Pilot 的 MVP，支援企業在 LINE 中完成員工身份綁定、動態員工證、與離職剔除。目標部署模式為社群版（Public Serverless + DynamoDB），區域 `ap-northeast-1`。

本變更跨越多個邊界：
- 前端：Admin Web 與 LIFF Web
- 後端：API、背景工作、LINE webhook
- 基礎建設：AWS 資源、CI/CD 與安全控制
- 身份安全：短效存取、session 撤銷、離職即時失效

## Goals / Non-Goals

**Goals:**
- 交付可營運的 MVP 能力：Setup Wizard、Invitation + Binding、Digital ID、Kill Switch。
- 以規格先行方式鎖定需求與驗收準則，避免先寫碼後補規格。
- 在 MVP 即導入可接受的安全基線：hardened JWT 混合策略、秘密管理、稽核、速率限制。
- 維持後續升級到企業版（VPC + RDS）的可演進性。

**Non-Goals:**
- 本階段不交付 booking、抽獎、Beacon、福利券歸戶。
- 本階段不交付企業版部署與資料落地專屬隔離。
- 本階段不導入外部 IAM 平台（Auth0/Cognito）作為主要身份來源。
- 本階段不提供離線掃碼驗證。

## Decisions

### 1) 架構決策：單體 API + 模組化邊界（NestJS on Lambda）
- Decision: 使用單一 NestJS API（部署至 Lambda）承載 admin/public/scanner/webhook 路徑，內部以模組劃分 domain。
- Rationale: 在空白專案與 Pilot 規模下，單體可降低跨服務協調成本並加速交付。
- Alternatives considered:
  - 多微服務：邊界更清楚，但初期維運與部署複雜度過高。
  - Go API：性能更高，但會增加團隊在 MVP 期的開發摩擦。

### 2) 多租戶模型：shared-nothing-code + shared-data-with-tenant-key
- Decision: 使用單一部署、多租戶資料模型；所有資料主鍵或索引必帶 `tenant_id`。
- Rationale: 成本最低且符合 3-5 家公司 Pilot 目標。
- Alternatives considered:
  - 單租戶多部署：隔離高但部署與營運成本高。
  - 全租戶獨立資料庫：超出 MVP 需要。

### 3) 身份與會話：Hardened JWT 混合策略
- Decision:
  - Access token：JWT，TTL 10 分鐘。
  - Refresh：伺服器端 session（DynamoDB）TTL 7 天。
  - Token 撤銷：每次授權檢查 `employment_status` + session 狀態 + `jti` 黑名單。
- Rationale: 兼顧效能與可撤銷能力，支援 Kill Switch 即時失效。
- Alternatives considered:
  - 純 JWT：撤銷困難，不符合離職立即剔除。
  - 全 opaque token：安全性高，但每次授權都查表，成本與延遲較高。
  - Auth0：成熟但導入和 LINE 綁定流程整合成本過高。

### 4) 綁定驗證：LINE Login + 工號 + 一次性綁定碼
- Decision: 第二因子採一次性綁定碼，不採身分證後四碼。
- Rationale: 降低敏感個資風險，同時維持 onboarding 速度。
- Alternatives considered:
  - 工號 only：安全不足。
  - 公司信箱 OTP：安全高，但導入複雜度與摩擦較高。

### 5) 資料儲存：DynamoDB table-per-domain
- Decision:
  - `ot_tenants`
  - `ot_invitations`
  - `ot_employees`
  - `ot_sessions`
  - `ot_token_revocations`
  - `ot_audit_events`
- Rationale: 符合 serverless 成本模型與 key-value 訪問模式。
- Alternatives considered:
  - 單表設計：可行但初期可讀性較差，先以 domain 拆表降低上手門檻。
  - Aurora PostgreSQL：留待企業版。

### 6) 非同步任務：SQS 驅動批次寄信與離職重試
- Decision: Email 批次寄送、Rich Menu unlink retry 均用 SQS + worker lambda。
- Rationale: 吸收尖峰與外部 API 不穩定風險。
- Alternatives considered:
  - 直接同步呼叫：簡單但失敗時 UX 與穩定性差。

### 7) 動態員工證驗證模式：線上驗證 API
- Decision: 掃碼端呼叫 `/v1/scanner/verify` 做即時驗證，不做離線驗證。
- Rationale: 可即時反映離職/黑名單狀態，符合 Kill Switch 目標。
- Alternatives considered:
  - 離線簽章驗證：可脫機但撤銷即時性較差且實作複雜。

### 8) 安全與營運基線
- Decision: 強制 Secrets Manager、WAF、API rate limit、CloudWatch 指標告警、AWS Budgets 成本警戒。
- Rationale: MVP 仍需具備最小可營運安全水位。
- Alternatives considered:
  - 僅開發友善設定：雖更快但會放大可預見風險。

## Risks / Trade-offs

- [LINE API 配額或波動] → 以 SQS 緩衝、重試與告警，並在 admin 顯示可重送狀態。
- [多租戶資料誤查] → 所有 repository 層強制注入 `tenant_id` 條件，並新增測試防交叉租戶讀寫。
- [Token 撤銷遺漏導致離職後短暫可用] → 每次敏感操作額外檢查 `employment_status`，不只依賴 JWT。
- [初期 schema 調整頻繁] → 以 OpenSpec 先行控制需求，對變更維持 proposal/specs/design/tasks 一致更新。
- [DynamoDB 成本突增] → 設定 throttling、Budgets 告警與成本熔斷 runbook。

## Migration Plan

1. 建立 `dev` 環境 stack，先完成租戶連線與 setup smoke test。
2. 導入 invitation/binding 功能並完成端到端測試（含鎖定與重試）。
3. 上線 digital ID + verify API，與掃碼端整合測試。
4. 上線 kill switch 基礎版，驗證 60 秒內失效目標。
5. 以 feature flags 分階段啟用能力：`SETUP_WIZARD`、`INVITATION_BINDING`、`DIGITAL_ID`、`KILL_SWITCH`。
6. 若關鍵指標異常，先關閉對應 feature flag，再回退到前版 API/Lambda 別名。

## Open Questions

- 掃碼端（門禁/特約商店）是否統一由單一 scanner client 實作，或需支援多種第三方掃碼器？
- Pilot 客戶對邀請信網域與寄件人品牌化需求是否需要在 MVP 即支援？
