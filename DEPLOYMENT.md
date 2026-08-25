# Reporting Command Center - Production Deployment & Configuration Guide

Welcome to the production deployment manifest for the **Reporting Command Center** SaaS application. This guide outlines step-by-step instructions to configure, run, secure, and deploy the application to **Vercel** or any cloud platform, integrating with **GoHighLevel (GHL) V2 API** and supporting secure, multi-tenant workspace environments.

---

## Table of Contents
1. [Core Architecture & Security Design](#core-architecture--security-design)
2. [Local Development Setup](#local-development-setup)
3. [Environment Variables Reference](#environment-variables-reference)
4. [Authentication & Workspace Access Setup](#authentication--workspace-access-setup)
5. [How to Create the First Super Admin Access](#how-to-create-the-first-super-admin-access)
6. [Step-by-Step Vercel Deployment](#step-by-step-vercel-deployment)
7. [Mock vs. Live GHL Data Configuration](#mock-vs-live-ghl-data-configuration)
8. [Testing & QA Protocols](#testing--qa-protocols)
9. [Operational Token Rotation & SLA Management](#operational-token-rotation--sla-management)
10. [Troubleshooting Guide](#troubleshooting-guide)

---

## Core Architecture & Security Design

The Reporting Command Center is designed around three strict principles to prevent credential leaks and ensure data integrity:
* **Server-Side API Proxies ONLY:** Under no circumstance are GHL API keys, refresh tokens, private integration tokens, or Stripe secret keys loaded in the browser context. All calls are routed through secure, server-side Express handlers which validate active bearer tokens (`x-auth-token`) and session headers.
* **Database & Workspace Isolation:** Sub-account data queries are scoped at the repository level. Database operations partition query targets by `ghlLocationId` or the workspace’s unique `id`.
* **Zero Trust Client Architecture:** The frontend receives compiled, filtered statistical data structures only. No database connection strings, config parameters, or token variables are returned in API outputs.

---

## Local Development Setup

Follow these commands to boot a local development instance of the full-stack App:

### 1. Prerequisite Installations
Ensure Node.js v18+ or v20+ is active.
```bash
# Clone and enter the repository
cd reporting-command-center
```

### 2. Dependency Installation
```bash
npm install
```

### 3. Local Environment Blueprint
Copy the `.env.example` file to create your local variables configuration file:
```bash
cp .env.example .env
```
Populate the newly created `.env` file with your credentials (see the reference table below).

### 4. Running the Dev Server
The development environment leverages `tsx` to run the active TypeScript Express server directly in conjunction with a Vite development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

### 5. Production Compilation Test
Verify that the build executes correctly and bundles types smoothly:
```bash
# Run typescript compilation verification
npm run lint

# Compile Vite client assets and bundle Express backend into dist/server.cjs
npm run build
```

---

## Environment Variables Reference

Below is the exhaustive matrix of available variables. Always keep server-only keys protected behind secret managers.

### 1. Variables Guide Matrix

| Environment Variable | Category | Required | Server-Only? | Default Value | Description |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **`REPORTING_DATA_SOURCE`** | Core Engine | Yes | No | `mock` | Determines if the engine fetches from GoHighLevel live endpoints (`live`) or uses local realistic preview structures (`mock`). |
| **`REPORTING_CACHE_TTL_SECONDS`** | Performance | No | Yes | `300` | Duration inside the backend to store API responses before hard-updating GHL pipelines. |
| **`REPORTING_ENABLE_MOCK_FALLBACK`** | Resilience | No | Yes | `true` | Allows safe fallback to populated mock records if a GHL API query fails. |
| **`AUTH_SECRET`** | Security | Yes | Yes | *None* | Crypto passphrase used for validating workspace JSON Web Tokens or cookies. |
| **`APP_URL`** | Security | Yes | Yes | *None* | Root URL of your production server; used to authenticate OAuth webhooks or callbacks. |
| **`SUPABASE_URL`** | Core Engine | **Yes** | Yes | *None* | Base URL of the Supabase project backing authentication and all tenant data. Must be paired with a `SUPABASE_SERVICE_ROLE_KEY` from the **same** project. Set in both Production and Preview scopes if Preview logins are needed. |
| **`SUPABASE_SERVICE_ROLE_KEY`** | Core Engine | **Yes** | Yes | *None* | Service-role key for the same Supabase project. Bypasses Row Level Security — never expose to the client, never prefix with `VITE_`. |
| **`DATABASE_URL`** | Tooling | No | Yes | *None* | Direct Postgres connection string (Session Pooler, IPv4) used only by `scripts/migrate.mjs` for schema migrations. Not read by the deployed API. |
| **`TASK_MANAGEMENT_ENABLED`** | Task Management | No | Yes | `false` | Master server switch. When false every `/api/tasks/*` route refuses with `403 TASK_MODULE_DISABLED` before any authorization or data access. |
| **`TASK_TIME_TRACKING_ENABLED`** | Task Management | No | Yes | `false` | Time engine sub-switch. Implies nothing unless the master switch is on. |
| **`TASK_MANAGEMENT_ROLLOUT_MODE`** | Task Management | No | Yes | `off` | Staged rollout gate: `off` \| `canary` \| `all`. **Fails closed** — any absent, blank or unrecognised value resolves to `off`. `all` is reserved for the approved production release. |
| **`TASK_MANAGEMENT_CANARY_WORKSPACE_IDS`** | Task Management | No | Yes | *Empty* | Comma-separated workspace ids admitted while the mode is `canary`. Exact, case-sensitive matching. An empty or unparseable list admits nobody. |
| **`VITE_TASK_MANAGEMENT_ENABLED`** | Task Management | No | Yes | `false` | Client-side nav visibility only — **not** a security boundary. Inlined at build time and readable in the shipped bundle. |
| **`VITE_TASK_MANAGEMENT_CANARY_WORKSPACE_IDS`** | Task Management | No | Yes | *Empty* | Client mirror of the canary allowlist, so the tab is not shown to a tenant whose API calls would be refused. Workspace ids are not secrets. |
| **`GHL_AUTH_MODE`** | Integrations | Yes | Yes | `private_token` | `private_token` for single-workspace custom integrations, `oauth` for SaaS marketplace setups. |
| **`GHL_PRIVATE_INTEGRATION_TOKEN`** | Integrations | Conditionally | Yes | *None* | Key obtained from GoHighLevel Settings > Company/Location > API Keys. |
| **`GHL_LOCATION_ID`** | Integrations | Conditionally | Yes | *None* | Focus Location identifier to bind the initial custom integration. |
| **`GHL_COMPANY_ID`** | Integrations | No | Yes | *None* | Company parent identifier for cross-location analytics scopes. |
| **`GHL_API_VERSION`** | Integrations | No | Yes | `2021-07-28` | Target GHL V2 platform contract version header. |
| **`GHL_BASE_URL`** | Integrations | No | Yes | `https://services.leadconnectorhq.com` | Base gateway URL for GoHighLevel REST microservices. |
| **`GHL_CLIENT_ID`** | Integrations | No | Yes | *None* | OAuth application ID generated within GoHighLevel Marketplace Developer portal. |
| **`GHL_CLIENT_SECRET`** | Integrations | No | Yes | *None* | OAuth secret used to exchange dynamic auth codes for access keys. |
| **`GHL_REDIRECT_URI`** | Integrations | No | Yes | *None* | Fully qualified URL for receiving marketplace OAuth handshakes. |
| **`GHL_REFRESH_TOKEN`** | Integrations | No | Yes | *None* | Long-term bearer token used to periodically mint transient access codes. |
| **`STRIPE_SECRET_KEY`** | Merchant | No | Yes | *None* | Private checkout, portal, and webhook credential. |
| **`STRIPE_WEBHOOK_SECRET`** | Merchant | No | Yes | *None* | Secret to confirm incoming invoice or receipt payloads. |
| **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`**| Merchant | No | No | *None* | Public billing key used to instantiate checkout popups on client-side views. |

---

> **Supabase value hygiene.** When setting `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` via
> the Vercel dashboard, `vercel env add`, or any scripted transfer, paste the raw value with
> no surrounding quotes and no leading/trailing whitespace, and confirm the source did not
> inject a UTF-8 byte-order mark. A BOM-prefixed `SUPABASE_URL` parses as an invalid URL and
> every login fails as an opaque `"fetch failed"` with no indication of why — this has
> recurred more than once, typically from PowerShell 5.1 tools that write UTF-8 files with a
> BOM by default (`[System.IO.File]::WriteAllText` without an explicit `UTF8Encoding($false)`
> is the usual culprit). **Changing a Vercel environment variable does not affect an
> already-running deployment** — a new deployment is required afterward.

### Variable Exposure Classification

1. **Client-Safe Variables:**
   * **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`** and **`REPORTING_DATA_SOURCE`** (if client routing depends on it) are safe to expose to client bundle scripts. In Vite, only variables prefixed with `VITE_` are injected into client-side asset builds.
2. **Strictly Server-Only Variables:**
   * **`GHL_PRIVATE_INTEGRATION_TOKEN`**, **`GHL_CLIENT_SECRET`**, **`AUTH_SECRET`**, and **`STRIPE_SECRET_KEY`** must stay hidden.
   * **Security Rule:** **NEVER prefix secrets with `VITE_` or `NEXT_PUBLIC_`**. Standard Vite builds automatically ignore custom vars that lack the explicit client prefix, keeping them protected within server processes.

---

## Authentication & Workspace Access Setup

The SaaS platform implements a structured multi-tenant model mapped as follows:
* **Tenant (Workspace):** Represents an organization or business location (e.g. *Showtime Pool Mechanics*). Each has its own `ghlLocationId`, members, settings flags, and metrics pipeline.
* **Role Hierarchies:**
  * **Owner (`owner`):** Full dashboard read access, ability to adjust target locations, view settings, configure keys, and issue CSV exports.
  * **Marketing Team (`marketing`):** Full read access to Ad UTM performance, leads channels, and campaigns. Cannot edit API settings.
  * **Sales Team (`sales` / `user`):** Access is scoped exclusively to individual leaderboards, assigned pipelines, and individual SLA dashboards.
  * **Super Admin (`usr_super_admin`):** Access to all global workspaces, platform diagnostic logs, and suspension tools.

---

## How to Create the First Super Admin Access

The platform looks for specific credentials or environment identities to establish system super privileges.

### 1. Via Mock Store Initialization
When the server boots in developer mode, it creates a fallback database containing a designated super administrator:
* **Email:** `operations@showtimepoolmechanics.com`
* **Alternate Flag:** Any user object containing `role: "owner"` or `id: "usr_super_admin"` bypasses location restrictions during API diagnostics.

### 2. Overriding via Environment Claim
To promote an account in production deployments:
1. Log in via your preferred email address.
2. If self-hosting high-security databases, execute the following SQL patch:
   ```sql
   UPDATE users SET role = 'owner', id = 'usr_super_admin' WHERE email = 'operations@showtimepoolmechanics.com';
   ```
3. When using serverless backends, the administrative suite provides a secure "Workspace Settings Center" panel allowlists to toggle role weights instantly.

---

## Step-by-Step Vercel Deployment

Vercel is optimised for Serverless and Frontend hosting. Since this app utilizes an Express backend alongside Vite, it is configured to use Vercel Serverless Functions via the custom backend build target:

### Step 1: Push Code to Github
Initialize a repository and push your project files (ensuring `node_modules`, `.env`, and build artifacts are ignored):
```bash
git init
git add .
git commit -m "feat: complete performance analytics platform"
git remote add origin https://github.com/your-username/reporting-command-center.git
git branch -M main
git push -u origin main
```

### Step 2: `vercel.json` (current architecture)
The `builds`/`routes` schema shown in older revisions of this document (targeting
`server.ts` directly via `@vercel/node`) is **not** what this project currently uses.
`server.ts` is the **local development** server only (`npm run dev`, via `tsx`) and is not
part of the deployed build.

The actual production API is generated from `_api_src/index.ts`, bundled by esbuild into
`api/index.js` as part of the Vercel build step, then served through the modern
`buildCommand`/`rewrites` schema:

```json
{
  "buildCommand": "vite build && npx esbuild _api_src/index.ts --bundle --platform=node --target=node20 --format=cjs --packages=external --outfile=api/index.js",
  "outputDirectory": "dist",
  "functions": {
    "api/index.js": { "maxDuration": 30 }
  },
  "rewrites": [
    { "source": "/api/:path*", "destination": "/api/index" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

`api/index.js` is a **generated artifact** — `npx esbuild ...` regenerates it fresh on every
Vercel build before the function is packaged, so it is never hand-edited. (It is committed
to the repository, but that committed copy is only a snapshot; Vercel's build step overwrites
it before deployment, and a stale committed copy has no effect on what actually runs in
production.)

### Step 3: Link Vercel Project
1. Log into your **Vercel Dashboard**.
2. Click **Add New Project** and select your imported GitHub repository.
3. In **Build & Development Settings**, configure:
   * **Framework Preset:** Vite
   * **Build Command:** `npm run build`
   * **Install Command:** `npm install`
4. Expand **Environment Variables** and input the required credentials as described in the Reference Table (e.g. `AUTH_SECRET`, `GHL_PRIVATE_INTEGRATION_TOKEN`, etc.).
5. Click **Deploy**.

---

## Mock vs. Live GHL Data Configuration

The server-side proxy reads the configuration settings and checks if dynamic performance sync commands can be established.

```
                  ┌───────────────────────┐
                  │ REPORTING_DATA_SOURCE │
                  └───────────┬───────────┘
                              ▼
           Is variable set to 'LIVE' in settings?
                     /                \
                   YES                 NO (or undefined)
                   /                    \
                  ▼                      ▼
    ┌───────────────────────────┐  ┌───────────────────────────┐
    │  Fetch from Live GHL V2   │  │   Serve High-Fidelity     │
    │  API & Attribution Model  │  │   Generated Mock Models   │
    └───────────────────────────┘  └───────────────────────────┘
```

### Switch to Live GHL API Pipeline:
1. Access the **Reporting Settings Center** within the application UI (available for owners).
2. Set the **Data Source mode** dropdown to **LIVE** (or specify `REPORTING_DATA_SOURCE=live` in the environment variables).
3. Connect your **GHL Private Token** (or authorize via standard OAuth Integration).
4. Verify the **Location ID** matches your GHL live account.
5. Click **Save Settings**. The application backend will immediately validate the credentials against `/contacts` and `/pipelines` paths before switching.

---

## Testing & QA Protocols

Once deployed or setup, run the following regression tests to verify security, performance, and permission compliance:

### 1. Test GHL Live Connection
* Navigate to **Settings** > **Diagnostics Console**.
* Click **Test GHL Connection**.
* **Expected Result:** A success feedback toast showing "Connection Clean. GHL V2 SLA Verification Green" or an explicit connection error detail block if the key is wrong.

### 2. Test Specific Dashboard Views
* Open the **Reporting Command Center** and switch between the 5 dashboard type tabs.
* **Overview:** Verify that Recharts timeline streams compile.
* **Opportunity:** Ensure the CRM funnel block loads and adds up to isochronous 100% metrics.
* **Sales:** Verify that salesperson-level booking conversion columns sort correctly on mouse click.
* **Owner:** Ensure the Team Member response speed charts render and highlight the top agent.
* **Marketing:** Confirm Campaign list elements parse UTM parameters perfectly.

### 3. Verify Workspace Isolation
* Create a secondary test workspace (e.g., *Apex Blue*).
* Attempt to query the Showtime workspace endpoints using the secondary workspace credentials or token.
* **Expected Result:** The Express server blocks the request with a `403 Access Denied` response and logs a `UNAUTHORIZED_CROSS_LOC_QUERY` audit entry.

### 4. Verify Role Permissions Enforcement
* Log in as a sales representative (using a mock user mapped to role `user`).
* Attempt to access **Marketing Channels** or the **Settings** menu.
* **Expected Result:** The respective views remain hidden, and any brute-forced navigation attempts to `/api/reporting/owner-performance` return a `403: Role owner/admin required` status code.

### 5. Check Token Protection
* Open the browser **Developer Tools** (F12) > **Network Tab**.
* Click **Sync Metrics** and inspect the response headers and query payload body.
* **Expected Result:** Verify that the backend returns compiled telemetry totals but **never** exposes the `GHL_PRIVATE_INTEGRATION_TOKEN` or system private secret keys in any response headers or payload keys.

---

## Operational Token Rotation & SLA Management

### 1. Token Rotation Process
When integrating using OAuth, dynamic refresh models are essential. To rotate manually:
1. Obtain the new credentials from GoHighLevel Developer Portal under the Marketplace Client Manager.
2. Push the updated token to the production environments:
   ```bash
   vercel env set GHL_PRIVATE_INTEGRATION_TOKEN "new_api_token"
   ```
3. Restart or redeploy the project serverless slots.

### 2. How to Handle Failed GHL Sync
* The platform implements a **Gracious Fallback Engine**.
* If a GHL API bottleneck occurs (e.g., rate-limits, expired token, or unexpected carrier downtime), the backend catches the error, serves stale metrics from the database cache, and issues a structured warning:
  `"API sync failed - Serving cached metrics from 2026-05-28. Check private token validity."`

### 3. Why CPL (Cost-per-Lead) & ROAS (Return-on-Ad-Spend) Stay Unavailable
During initial connections, these parameters may show as "Unavailable" or "Ad account disconnected":
* **Reason:** In standard GoHighLevel channels, contacts and opportunities provide conversion data, but **Google Ad Manager** or **Facebook Business suite** integration is required to fetch spent ad budget figures.
* **SLA Safe Handling:** Until active spend budgets are mapped, the dashboard hides complex formulas and displays a neutral warning in the telemetry indicators: *"Ad Accounts spend disconnected. Mapping standard lead values instead."*

---

## Auth Health Monitoring & Post-Deployment Smoke Test

Authentication depends on Supabase being reachable. Three production incidents have all
presented identically to an end user (`Authentication service unreachable`) despite different
underlying causes, so the application now exposes a probe, emits a single alertable event,
and ships a smoke test.

### 1. Health endpoint

```
GET /api/health/auth
  200  {"status":"ok"}         Supabase Auth is configured and reachable
  503  {"status":"degraded"}   Configuration is invalid, or the Auth service is unreachable
```

The body is deliberately minimal. The reason, hostname, error codes, and configuration
diagnostics are written to the **server log only** — exposing them publicly would turn an
uptime probe into a reconnaissance endpoint. It authenticates no user, sends no service-role
key upstream, and caches its result for 30 seconds so polling cannot be amplified into
upstream load.

### 2. Uptime monitor — required external setup (NOT configured automatically)

Configure **one** of the following manually. None of this can be done from the repository,
and no monitoring is active until you complete it and confirm a real test alert arrives.

**Option A — Vercel (no extra vendor):**
1. Vercel Dashboard → project `reporting-command-center` → **Observability** → **Monitors**
   (availability checks require a Pro plan; confirm availability on your plan first).
2. New monitor → URL `https://<your-production-domain>/api/health/auth`, method `GET`.
3. Interval **5 minutes**; expected status **200**.
4. Failure threshold **2 consecutive failures** before alerting — a single brief network
   interruption should not page anyone.
5. Add notification channel (email / Slack) and enable recovery notifications.

**Option B — external uptime service** (UptimeRobot, Better Uptime, Pingdom, etc.):
1. New HTTP(S) monitor → `https://<your-production-domain>/api/health/auth`.
2. Interval 5 minutes; treat **only HTTP 200** as up.
3. Confirmation/retry setting: alert after **2 consecutive failures**.
4. Enable the "back up" / recovery notification.

### 3. Log-based alerting on repeated auth failures

The API emits one structured JSON line when authentication infrastructure fails after
exhausting its retry:

```json
{"event":"AUTH_UPSTREAM_UNAVAILABLE","timestamp":"…","route":"/api/auth/login",
 "attempts":2,"classification":"network","causeCode":"ECONNRESET","timedOut":false,
 "env":"production","deploymentId":"…","commit":"…"}
```

It contains no email, password, token, key, or raw environment value. It is **not** emitted
when a retry succeeds, and never for a rejected password — so any occurrence is a real
infrastructure event.

To alert on it: Vercel Dashboard → **Logs** → filter `AUTH_UPSTREAM_UNAVAILABLE` → save as a
Log Drain or connect a drain (Datadog, Better Stack, Axiom) and alert when the count exceeds
~3 in 5 minutes. Alerting on `/api/auth/login` responses with status `503` is an equivalent
signal if log drains are unavailable. A related `AUTH_HEALTH_DEGRADED` event is emitted by
the health endpoint itself and carries the specific reason.

### 4. Post-deployment smoke test (run after every production deploy)

```bash
BASE_URL=https://<your-production-domain> npx tsx scripts/smoke-test-production.ts
```

Checks `/api/health/auth` → 200, login-without-email → 400, `/api/auth/me` without token →
401, a protected route without token → 401, and that **bad credentials return 401 rather than
503** (a 503 there means the backend is unreachable and the deploy is not healthy).

To additionally exercise a real login, supply credentials **via environment only** — never as
command arguments, which are visible in process listings and shell history:

```bash
SMOKE_EMAIL=… SMOKE_PASSWORD=… BASE_URL=https://<your-production-domain> \
  npx tsx scripts/smoke-test-production.ts
```

The script prints no password, JWT, key, or authorization header under any outcome, and exits
non-zero on failure so it can gate a deploy pipeline.

### 5. Supabase auto-pause (operational risk — cannot be fixed in code)

Supabase **Free tier projects pause automatically after ~7 days of inactivity**, and a paused
project is indistinguishable from a deleted one from the application's perspective: DNS stops
resolving and every login fails. This has already caused at least one production outage in
this project.

**No application code can prevent a provider from pausing or taking a project offline**, and
generating artificial database traffic to evade pausing is not a supported fix — it is
fragile and does not stop Supabase from reaping an idle project.

The only durable remedy is an account-level change: **Supabase Dashboard → Project →
Settings → Billing → upgrade to Pro**, which removes auto-pause. Verify the current plan
under Settings → Billing; if it shows Free, the risk is live.

---

## Troubleshooting Guide

* **Issue: Preview is blank or shows "Please wait while your application starts..." indefinitely.**
  * *Fix:* Check server logs using `vercel logs` or your hosting provider console. Ensure `PORT` is bound on port `3050` or standard ingress variables. Verify your backend compiled script is located in `dist/server.cjs`.
* **Issue: Receiving "Missing or insufficient permissions" on GHL Sync.**
  * *Fix:* Ensure the Location ID matches the private token's specific sub-account tier inside the GoHighLevel workspace settings. Standard keys cannot cross-query.
* **Issue: HMR is disconnected.**
  * *Fix:* Standard behavior. The platform control plane operates in direct server configuration where hot module replacement is safely bypassed for stable data transfers. Focus on using manual refreshes in the active dashboards.
