# Runtime Architecture Decision

## Current Runtime (MVP)

The MVP backend is implemented as a **Node.js AWS Lambda handler** with modular domain services (`tenant`, `invitation-binding`, `auth-session`, `digital-id`, `offboarding`).

## Clarification

Earlier planning artifacts referenced "NestJS on Lambda" as an option. The implemented runtime in this repository is **not NestJS**. This is intentional for MVP scope and keeps deployment/runtime complexity low.

## Why this decision

- Faster MVP iteration with fewer framework constraints.
- Clear service boundaries without framework-level module overhead.
- Compatible with future migration to NestJS if scale or team conventions require it.

## Guardrails

- Keep business logic in service classes; keep `lambda.ts` as routing/composition layer.
- Maintain explicit tenant scoping and auth checks in service/middleware boundaries.
