## Why

MVP 變更已封存，但驗證中仍有 4 項 alignment warning，會影響規格信任度與安全語意一致性。這次變更的目標是補齊這些落差，讓實作、規格與設計敘述一致。

## What Changes

- 將批次邀請從「同步標記 SENT」調整為「先 QUEUED，再由背景派送流程更新為 SENT/FAILED」。
- 在綁定完成流程中，加入 LINE Rich Menu link 動作，確保綁定成功即可啟用員工選單。
- 在 offboarding 中補齊 active access token jti 失效流程，與 session revoke 一起生效。
- 更新架構設計敘述，使 runtime 決策與目前 Node.js Lambda 模組化實作一致（移除 NestJS 假設）。

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `employee-invitation-binding`: 強化批次邀請非同步派送行為與綁定後 Rich Menu 連結語意。
- `employee-offboarding-kill-switch`: 明確要求 offboarding 需撤銷有效 access token jti。

## Impact

- API service: `/apps/api/src/services/invitation-binding-service.ts`, `/apps/api/src/services/auth-session-service.ts`, `/apps/api/src/services/offboarding-service.ts`, `/apps/api/src/line/line-platform-client.ts`, `/apps/api/src/lambda.ts`
- Domain/repository contracts: invitation job status 與 active jti tracking
- Tests: invitation/auth/offboarding unit tests + integration/e2e
- OpenSpec artifacts: modified specs for invitation/offboarding + updated design for runtime architecture alignment
