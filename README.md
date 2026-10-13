# Pennywise expense tracker

A responsive personal finance dashboard with an Express API, MongoDB storage, password-based accounts, category/date filters, and monthly category budgets.

## Requirements

- Node.js 18 or newer
- MongoDB running locally, or a MongoDB Atlas connection string

## Run locally

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set `MONGODB_URI` and replace `JWT_SECRET` with a random value at least 32 characters long.
4. Start the app with `npm start` (or `npm run dev` while developing).
5. Open `http://localhost:3000` and create an account.

The dashboard is populated by transactions entered by the signed-in user; transaction and budget data are stored in MongoDB. The JWT is kept in browser local storage. Use HTTPS in production and keep `.env` private.

## API

All transaction, dashboard, and budget routes require `Authorization: Bearer <token>`. Every database query is scoped to the authenticated user's ID.

| Method | Route | Description |
|---|---|---|
| `POST` | `/api/auth/register` | Create an account (`email`, `password`) |
| `POST` | `/api/auth/login` | Sign in and receive a token |
| `GET` | `/api/auth/me` | Return the current account |
| `GET` | `/api/transactions` | List transactions; optional `startDate`, `endDate`, `category`, `type` filters |
| `POST` | `/api/transactions` | Record an income or expense |
| `DELETE` | `/api/transactions/:id` | Delete one of the current user's transactions |
| `GET` | `/api/dashboard?month=YYYY-MM` | Monthly totals, daily cash flow, categories, and budget alerts |
| `GET` | `/api/budgets?month=YYYY-MM` | List the current user's budgets |
| `PUT` | `/api/budgets/:category` | Set/update a category limit (`month`, `limit`) |
| `DELETE` | `/api/budgets/:category?month=YYYY-MM` | Remove a category budget |

Dates use `YYYY-MM-DD`; transaction amounts are positive numbers and transaction type determines whether the amount is income or expense.
