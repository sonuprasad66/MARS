# MARS Cosmetics Order & Inventory Sync

Local full-stack demo for the attached Order & Inventory Sync assignment. Backend and frontend are separate applications with independent dependencies, commands, and environment files. All marketplace and Microsoft Business Central integrations are local mocks; this project does not call external APIs.

## Layout

- `server/` — Node.js, Express, TypeScript, Prisma, PostgreSQL API and retry worker.
- `client/` — React, TypeScript, Vite operations dashboard.
- `docker-compose.yml` — PostgreSQL only; no Redis dependency. Sync work is durably persisted in PostgreSQL.
- `DESIGN.md` — architecture, consistency strategy, assumptions, trade-offs, and limitations.

## Requirements

- Node.js 20+
- npm
- Docker with Docker Compose (or a local PostgreSQL 14+ instance)

## Start PostgreSQL

From the repository root:

```sh
docker compose up -d postgres
```

Wait until `docker compose ps` reports PostgreSQL healthy.

## Run the backend independently

```sh
cd server
npm install
cp .env.example .env
npm run db:generate
npm run db:migrate -- --name init
npm run db:seed
npm run dev
```

In a second terminal, start the background worker:

```sh
cd server
npm run worker
```

API base URL: `http://localhost:4000/api`; health and readiness are `/health` and `/ready`. The worker can be omitted while inspecting queued jobs. `DATABASE_URL`, API port, browser origin, logging level, and worker poll interval are configured in `server/.env`.

Useful endpoints:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/dashboard/summary` | Dashboard counts |
| GET | `/api/inventory?search=lip` | Inventory and channel listing sync state |
| GET | `/api/orders` | Recent orders |
| POST | `/api/orders` | Ingest a normalized order |
| POST | `/api/orders/:id/cancel` | Cancel and release stock |
| POST | `/api/orders/:id/fulfill` | Deduct fulfilled stock |
| POST | `/api/orders/:id/return` | Restock a fulfilled order |
| GET | `/api/sync-jobs?status=FAILED` | Inspect sync failures |
| POST | `/api/sync-jobs/:id/retry` | Retry a sync job |
| POST | `/api/imports/blinkit` | Import CSV in JSON `{ "csv": "..." }` |
| GET | `/api/audit?sku=MRS-LIP-104` | Inventory change history |

Sample ingestion request:

```sh
curl -X POST http://localhost:4000/api/orders \
  -H 'Content-Type: application/json' \
  -d '{"channel":"NYKAA","external_order_id":"NYK-DEMO-1","items":[{"sku":"MRS-LIP-104","qty":1,"unit_price":349}],"payment_mode":"PREPAID","total_amount":349}'
```

## Run the frontend independently

```sh
cd client
npm install
cp .env.example .env
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). `VITE_API_BASE_URL` selects the API. The dashboard shows orders, inventory, queue/ERP status, failed-job retry actions, and Blinkit CSV import results.

## Checks

In each folder, run `npm test`, `npm run typecheck`, and `npm run build`. Backend database tests and migrations require a running PostgreSQL instance and generated Prisma client. The automated backend tests cover request-shape validation and the mock Blinkit retry path; they are not a substitute for PostgreSQL concurrency integration tests. No performance results or production API integration are claimed.

## Demo and limitations

The seed is repeatable: it creates five SKUs, all four channel listings, a confirmed website order with reserved stock, queued mock syncs, and a failed Blinkit job that can be retried from the dashboard. Re-running it does not add another demo order or duplicate seed failure. Start the worker to watch pending jobs complete. Blinkit CSV supports simple unquoted comma-separated rows with `order_id,sku,qty,unit_price`.

Production deployment still needs webhook authentication/signature verification, operator authentication and authorization, provider-specific adapters/cursors/rate limiting, distributed worker claims, monitoring, backup/restore, and tested ERP/provider idempotency. See [DESIGN.md](./DESIGN.md) for the concurrency model and explicit production gaps.
