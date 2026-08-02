# CodeBloomAfrica

Marketing and paid-registration site for CodeBloomAfrica — career-oriented tech training for aspiring African professionals.

Applicants browse training tracks, submit registration details, and pay a **₦10,000** registration fee through Paystack.

## Stack

| Layer | Tech |
|--------|------|
| Frontend | Static HTML, CSS, vanilla JavaScript |
| Hosting | Netlify |
| Serverless | Netlify Functions |
| Database | Supabase (Postgres) |
| Payments | Paystack (InlineJS v2) |

## Project structure

```
├── index.html              # Landing page
├── register.html           # Registration + payment
├── payment-success.html    # Post-payment confirmation
├── styles.css / script.js  # Landing page assets
├── register.css / register.js
├── payment-success.css / payment-success.js
├── images/                 # Branding and marketing assets
├── netlify/
│   └── functions/          # Payment + webhook endpoints
├── supabase-schema.sql     # DB schema and RLS policies
└── netlify.toml
```

### Netlify Functions

| Function | Role |
|----------|------|
| `initialize-payment` | Creates a Paystack transaction and returns an `access_code` for InlineJS |
| `verify-payment` | Verifies the transaction with Paystack after client success |
| `paystack-webhook` | HMAC-verified webhook for authoritative payment updates |
| `create-payment` | Legacy redirect checkout (unused by the current frontend) |

## Registration flow

1. User submits name, email, WhatsApp phone, and course.
2. Browser inserts an unpaid registration into Supabase (anon key, insert-only RLS).
3. Browser calls `initialize-payment`; the function creates a ₦10,000 Paystack transaction.
4. Paystack InlineJS opens an in-page payment modal.
5. On success, `verify-payment` confirms the charge with Paystack and marks the registration paid.
6. The Paystack webhook independently records success (covers closed browsers / failed redirects).
7. User is redirected to the success page.

## Prerequisites

- Node.js **20+**
- npm
- A [Supabase](https://supabase.com) project
- A [Paystack](https://paystack.com) account (use **test** keys locally)

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
PAYSTACK_SECRET_KEY=sk_test_your-paystack-test-secret-key
```

> The browser-side Supabase URL and anon key live in `register.js`. The anon key is safe to expose under the insert-only RLS policy defined in `supabase-schema.sql`. Never put the service-role or Paystack secret key in frontend code.

### 3. Apply the database schema

In the Supabase SQL Editor, run the full contents of `supabase-schema.sql`.

### 4. Start the site

Use Netlify Dev so the static pages and Functions run together:

```bash
npx netlify dev --port 8888
```

Open [http://localhost:8888](http://localhost:8888).

### Landing page only

For visual work without payment Functions:

```bash
python3 -m http.server 8000
```

Registration and payment calls will fail outside `netlify dev`.

## Production (Netlify)

Set these environment variables in the Netlify dashboard:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `PAYSTACK_SECRET_KEY`

After deploy, configure the Paystack webhook URL:

```text
https://<your-netlify-site>/.netlify/functions/paystack-webhook
```

The Netlify build runs `npm install`, publishes the repo root, and bundles Functions with esbuild (`netlify.toml`).

## Notes

- Landing page highlights six schools; registration currently offers four courses.
- `create-payment.js` is unused; the live path is Paystack InlineJS via `initialize-payment`.
- There is no auth, admin UI, or CMS in this codebase.
- Use Paystack test keys for local checkout testing.
