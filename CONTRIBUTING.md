# Contributing to @diagrammo/dgmo

Thanks for your interest in contributing! This guide will get you up and running.

## Prerequisites

- Node.js 18+
- [pnpm](https://pnpm.io/) (latest)

## Setup

```bash
git clone https://github.com/diagrammo/dgmo.git
cd dgmo
pnpm install
pnpm build
```

## Development

| Command | Description |
|---------|-------------|
| `pnpm build` | Build library + CLI (tsup, ESM + CJS) |
| `pnpm dev` | Watch mode (rebuild on save) |
| `pnpm test` | Run all tests (Vitest, 3800+ tests) |
| `pnpm test:watch` | Run tests in watch mode |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm check:all` | Full quality suite (dead code, spelling, duplication, circular deps, security audit, publish check, type check) |

## Testing

Run `pnpm test` before submitting a PR. Write tests for any new functionality. Tests live in `tests/` with one file per parser/renderer (e.g. `c4-parser.test.ts`, `gantt-renderer.test.ts`). Fixtures go in `tests/fixtures/`.

## Architecture

Each diagram type lives in its own folder under `src/`:

```
src/sequence/       # parser.ts, renderer.ts, types.ts
src/graph/          # Flowchart, state, generic graph
src/c4/             # C4 architecture diagrams
src/er/             # Entity-relationship
...
```

The router (`src/dgmo-router.ts`) dispatches to the correct parser based on the first line of input. D3-based charts go through `src/d3.ts`, ECharts-based through `src/echarts.ts`.

When adding a new diagram type, you'll typically create:
- `parser.ts` — parse DGMO text into a typed AST
- `renderer.ts` — render the AST to SVG
- `types.ts` — TypeScript interfaces
- `layout.ts` — optional layout logic

## Code Style

Prettier and ESLint run automatically on commit via lint-staged + husky. No manual formatting needed.

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes
3. Add or update tests
4. Run `pnpm test` and `pnpm typecheck`
5. Submit a pull request

Use imperative mood for commit messages ("Add venn diagram parser", not "Added venn diagram parser").

## Questions?

Open a [discussion](https://github.com/diagrammo/dgmo/discussions) or file an issue.
