# Postgres CRUD Demo

Small Express + PostgreSQL API for testing AI PR reviews. This baseline is intentionally **clean** — add security/performance bugs in a follow-up PR to exercise the reviewer.

## Stack

- Node 20+
- Express 4
- PostgreSQL 16 (`pg` connection pool)
- Docker Compose for local DB

## Quick start

```bash
cd crud-demo
cp .env.example .env
docker compose up -d
npm install
npm run db:init   # only needed if you didn't use docker init scripts
npm run dev
```

Health check: `curl http://localhost:3000/health`

## API

### Users

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/users` | List users |
| GET | `/api/users/:id` | Get user |
| POST | `/api/users` | Create user `{ email, name, role? }` |
| PUT | `/api/users/:id` | Update user |
| DELETE | `/api/users/:id` | Delete user |

### Products

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/products` | List products (`?owner_id=` optional) |
| GET | `/api/products/:id` | Get product |
| POST | `/api/products` | Create product |
| PUT | `/api/products/:id` | Update product |
| DELETE | `/api/products/:id` | Delete product |

### Examples

```bash
# Create user
curl -s -X POST http://localhost:3000/api/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","name":"Alice","role":"admin"}'

# Create product
curl -s -X POST http://localhost:3000/api/products \
  -H 'Content-Type: application/json' \
  -d '{"name":"Widget","price_cents":999,"stock":10,"owner_id":1}'

# List products for owner
curl -s 'http://localhost:3000/api/products?owner_id=1'
```

## PR review testing ideas

Commit this folder as the baseline, then open a PR that introduces issues such as:

- SQL injection (string concatenation in queries)
- Missing auth on admin routes
- Hardcoded secrets / API keys
- N+1 queries when listing products with owner details
- Unbounded `SELECT *` without pagination
- Missing input validation on search params
- Blocking sync file I/O in request path

## Project layout

```
crud-demo/
├── docker-compose.yml
├── sql/schema.sql
├── src/
│   ├── index.js
│   ├── db.js
│   └── routes/
│       ├── users.js
│       └── products.js
└── scripts/init-db.js
```
