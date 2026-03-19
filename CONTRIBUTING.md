# Contributing to one-team

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/erictu/one-team.git
cd one-team

corepack enable
corepack prepare pnpm@9.15.4 --activate

pnpm install
```

## Quality Gates

Before submitting a PR, make sure all checks pass:

```bash
pnpm lint        # ESLint
pnpm typecheck   # TypeScript strict mode
pnpm test        # node:test runner
pnpm build       # Full build
```

Or run all at once:

```bash
pnpm check
```

## Environment Setup

Copy example env files and fill in your values:

```bash
cp apps/liff-web/.env.production.example apps/liff-web/.env.production
cp apps/admin-web/.env.local.example apps/admin-web/.env.local
```

## Project Structure

```
apps/api/         # Lambda API + domain services + tests
apps/liff-web/    # LIFF frontend (React)
apps/admin-web/   # Admin frontend (React)
infra/cdk/        # AWS CDK infrastructure
packages/shared-types/
```

## Pull Request Process

1. Fork the repo and create a feature branch from `main`
2. Make your changes with tests
3. Run `pnpm check` to verify all quality gates pass
4. Submit a PR with a clear description of the change

## Code Style

- TypeScript strict mode throughout
- Tests use `node:test` with in-memory repositories (no mocks)
- Inline styles in React components (no CSS framework)
- DynamoDB single-table design with `pk`/`sk` pattern

## Reporting Issues

Use GitHub Issues with the provided templates for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
