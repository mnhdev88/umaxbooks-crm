# UMAX CRM — Local Setup Guide

## Step 1 — Install Docker Desktop

Download and install Docker Desktop for Windows:
https://www.docker.com/products/docker-desktop/

- Run the installer, restart your PC when prompted
- After restart, open Docker Desktop and wait until it says **"Docker Desktop is running"**

> Docker is the only external dependency. Everything else (Supabase, PostgreSQL, Storage, Auth) runs inside it automatically.

---

## Step 2 — Start the Local Database

Open a terminal in the project folder and run:

```bash
npm run db:start
```

First run downloads ~1GB of Docker images (takes 2–5 minutes). Subsequent starts take ~15 seconds.

When done you'll see output like:
```
Started supabase local development setup.

         API URL: http://127.0.0.1:54321
     GraphQL URL: http://127.0.0.1:54321/graphql/v1
  S3 Storage URL: http://127.0.0.1:54321/storage/v1/s3
          DB URL: postgresql://postgres:postgres@127.0.0.1:54322/postgres
      Studio URL: http://127.0.0.1:54323
```

The `.env.local` file is already pre-filled with these local values — no changes needed.

---

## Step 3 — Run the Database Migration

Once the local Supabase is running, open **Supabase Studio** at:
http://127.0.0.1:54323

1. Click **SQL Editor** in the left sidebar
2. Open the file `supabase/migrations/001_initial_schema.sql` from this project
3. Paste the full content into the editor and click **Run**

Or use the CLI shortcut (after Step 2):
```bash
npm run db:reset
```
This applies all migrations automatically.

---

## Step 4 — Create Storage Bucket

In Supabase Studio (http://127.0.0.1:54323):
1. Go to **Storage** in the left sidebar
2. Click **New bucket**
3. Name it `crm-files` and check **Public bucket**
4. Click **Save**

---

## Step 5 — Create First Admin User

In Supabase Studio:
1. Go to **Authentication > Users**
2. Click **Add user** → enter your email and a password
3. Go to **Table Editor > profiles**
4. Find your user row and change the `role` column to `admin`

Or run in SQL Editor:
```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
```

---

## Step 6 — Start the App

```bash
npm run dev
```

Open http://localhost:3000 — sign in with the user you just created.

---

## Daily Workflow

```bash
# Start database (run once per session, after Docker Desktop is open)
npm run db:start

# Start the app
npm run dev

# Stop database when done
npm run db:stop
```

Other useful commands:
```bash
npm run db:status   # Check what's running
npm run db:reset    # Wipe and re-run all migrations (fresh start)
```

---

## Local Service URLs

| Service | URL |
|---------|-----|
| CRM App | http://localhost:3000 |
| Supabase Studio (DB admin UI) | http://127.0.0.1:54323 |
| API | http://127.0.0.1:54321 |
| Email inbox (Inbucket) | http://127.0.0.1:54324 |
| PostgreSQL direct | postgresql://postgres:postgres@127.0.0.1:54322/postgres |

---

## Email Notifications (Optional)

Without a Resend key, in-app notifications still work. To enable emails:
1. Sign up at https://resend.com (free: 3,000 emails/month)
2. Add your key to `.env.local`: `RESEND_API_KEY=re_...`
3. Update the `from` address in `lib/notifications.ts`

For local testing, all outgoing emails are captured in the **Inbucket** inbox at http://127.0.0.1:54324 — no real emails are sent.

---

## User Roles

| Role | Can Do |
|------|--------|
| Admin | Full access, user management, all records |
| Agent | Create/edit leads, log calls, audits, appointments, deals, revisions |
| Developer | Read-only on leads; upload demo URL, revision versions, live URL |

## Pipeline Stages

New → Contacted → Audit Ready → Demo Scheduled → Demo Done → Closed Won → Revision → Live → Completed

**Lost** is available at any stage via the lead edit form.
