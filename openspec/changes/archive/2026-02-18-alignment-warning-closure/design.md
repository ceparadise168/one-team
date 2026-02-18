## Context

`alignment-warning-closure` 目標是修補上一個 MVP 變更封存後的一致性警示。現況已具備主要功能，但在「非同步邀請派送」、「綁定後 Rich Menu link」、「offboarding jti 失效」與「架構決策文件」存在落差。

## Goals / Non-Goals

**Goals:**
- 讓批次邀請流程呈現明確的 queue -> dispatch 生命周期。
- 在綁定成功路徑中實際執行 Rich Menu link。
- 在 offboarding 時除了 session revoke，也撤銷已發行且仍有效的 access token jti。
- 將架構敘述更新為與現行 Node.js Lambda 模組化服務一致。

**Non-Goals:**
- 不引入新雲端服務或改變既有基礎設施拓撲。
- 不導入 NestJS 重構。
- 不更動既有 capability 命名與核心業務流程。

## Decisions

### 1) 批次邀請採「先排隊、後派送」狀態機
- Decision: 有效收件者建立時標記為 `QUEUED`，由獨立 dispatch 流程轉為 `SENT` 或 `FAILED`。
- Rationale: 對齊規格中 asynchronous queue 語意，並保留 per-recipient 狀態追蹤。
- Alternatives considered:
  - 保持同步 `SENT`: 無法表達 queue 語意。
  - 全改 SQS worker: MVP 可行但會放大此次修補範圍。

### 2) 綁定完成前執行 Rich Menu link
- Decision: `bind/complete` 在寫入綁定後、簽發 session 前，呼叫 LINE client 進行 Rich Menu link；link 失敗時回傳錯誤。
- Rationale: 讓「綁定成功」與「員工選單生效」在同一交易語意中完成。
- Alternatives considered:
  - 非同步 link: 會造成綁定成功但選單延遲生效的不一致。

### 3) Access token jti 追蹤與批次撤銷
- Decision: 在 refresh session 記錄 active jti 清單，offboarding/revoke session 時批次寫入 revoked-jti store。
- Rationale: 不新增資料表的前提下，補齊「offboarding 即時 access token 失效」要求。
- Alternatives considered:
  - 僅依賴 employment status: 可擋授權，但未落實 jti 失效語意。
  - 新增專用 jti 表: 更完整但超出本次修補成本。

### 4) 架構文件對齊現況
- Decision: 在 OpenSpec design 中明確採用「Node.js Lambda handler + domain service」而非 NestJS。
- Rationale: 文檔應反映實際部署與程式結構，避免誤導後續開發。
- Alternatives considered:
  - 重構成 NestJS: 成本高且與本次 alignment 目標不符。

## Risks / Trade-offs

- [Rich Menu link 失敗會阻斷綁定完成] → 以明確錯誤回傳，允許使用者重試完成流程。
- [active jti 清單成長] → 在 session 驗證與撤銷路徑做到期清理。
- [dispatch 仍為應用內流程而非真正外部 worker] → 透過顯式 queue 狀態與 dispatch API 保持語意一致，後續可平滑接 SQS worker。

## Migration Plan

1. 更新 invitation/auth/offboarding domain 與 service 合約。
2. 補齊 API 路由（batch dispatch）。
3. 更新單元/整合/E2E 測試驗證 queue、rich menu link、jti revoke。
4. 執行 lint/typecheck/test/build 驗證。
5. 以 feature-compatible 方式上線（不改既有 endpoint contract）。

## Open Questions

- 是否要在下一階段將 batch dispatch endpoint 改為正式 SQS consumer-only（移除手動觸發路由）？
