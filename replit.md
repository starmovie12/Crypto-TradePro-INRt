# Crypto TradePro INR

A mobile-first Binance crypto options dashboard with INR-only pricing, safe Paper Trading, bracket orders, AI trade ideas, and portfolio tracking.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/crypto-tradepro/src/App.tsx` — responsive trading cockpit and route-level screens
- `artifacts/crypto-tradepro/src/index.css` — palette, typography, motion, and chart surface tokens
- `lib/api-spec/openapi.yaml` — source of truth for market, portfolio, advisor, and paper-order contracts
- `artifacts/api-server/src/routes/tradepro.ts` — safe in-memory development API and paper order math

## Architecture decisions

- Paper mode is the default and the only mode that can place orders in the current build; Live mode stays visibly locked until a server-side Binance connection is configured.
- All values exposed to the UI are INR-denominated; the frontend never accepts or renders Binance credentials.
- The frontend uses a sub-second reactive market simulation in Paper mode so chain, spot, and portfolio values visibly move without REST polling.
- Advisor recommendations are read-only and the paper order endpoint is separate from the advisor endpoint.

## Product

- Market desk with BTC option chain, ATM marker, strike focus chart, live connection indicator, and bracket order sheet.
- Paper wallet with mock fund deposits, target/stop preview, active positions, close-one, close-all, and activity history.
- AI Advisor conversation surface with structured recommendations and chart deep links.
- Settings for Paper/Live environment, Confirm before send vs Instant execute, and server-side security guardrails.

## User preferences

- User requested the complete website from the attached Crypto TradePro INR PRD without missing product flows.

## Gotchas

- Keep product copy and fallback data aligned to Binance BTC options; do not reintroduce equity/NIFTY/NSE terminology.
- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before touching generated API types.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
