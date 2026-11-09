# Gmail (Google Workspace) send + sync — setup

This connects the CRM to your agents' Google Workspace mailboxes so that:

- emails an agent sends from the CRM go out from **their own Gmail**, show in their
  Gmail *Sent* folder, and thread with the lead's replies;
- emails an agent sends to a lead **directly from Gmail**, and **replies from leads**,
  appear on the lead's Email History in the CRM (synced every 5 minutes);
- the assigned agent gets a notification when a lead replies.

Only mail to/from addresses that match a lead (primary or alternate email) is stored.
Everything else in the mailbox is never imported.

Bulk and automated mail (auto cold outreach, follow-ups, contracts, invites, reports)
keeps going through the **default** provider (Resend). The Workspace provider can't be
made the default.

Agents are matched by their CRM login email, which must be their Workspace address.

You need: a Google Workspace **super admin** and access to a Google Cloud project.
It takes about 15 minutes.

---

## 1. Create the service account (Google Cloud console)

1. Go to <https://console.cloud.google.com/>, then create or select a project (e.g. "Noveliotech CRM").
2. **APIs & Services → Library**, then search **Gmail API** and click **Enable**.
3. **IAM & Admin → Service Accounts → Create service account**
   - Name: `crm-gmail-sync`. Skip the optional role/access steps, then click **Done**.
4. Open the new service account, go to the **Keys** tab, then **Add key → Create new key → JSON**.
   A `.json` file downloads. Keep it secret: it is the credential.
5. On the service account's **Details** tab, copy the **Unique ID** (a long number,
   also called the OAuth2 Client ID).

> If key creation is blocked by the org policy `iam.disableServiceAccountKeyCreation`,
> an org admin has to allow it for this project first.

## 2. Grant domain-wide delegation (Google Workspace Admin console)

1. Go to <https://admin.google.com/> as a super admin.
2. **Security → Access and data control → API controls → Manage Domain Wide Delegation**.
3. Click **Add new**:
   - **Client ID**: the Unique ID from step 1.5
   - **OAuth scopes** (comma-separated, exactly):
     ```
     https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.send
     ```
4. Click **Authorize**. It can take a few minutes (occasionally up to an hour) to take effect.

## 3. Add environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | The entire contents of the downloaded JSON key file. Pasting the raw JSON works; base64 of the file also works. |
| `GOOGLE_WORKSPACE_DOMAINS` | Your mailbox domain(s), comma-separated, e.g. `noveliotech.com` |
| `GMAIL_SYNC_BACKFILL_DAYS` | *(optional)* How far back the first sync looks. The default is `14`. |

Redeploy after saving.

## 4. Apply the database migration

Run `supabase/migrations/116_gmail_workspace_sync.sql` on the production database, the
same way as earlier migrations (see `APPLY_MIGRATION.md`).

## 5. Turn it on in the CRM

1. **Settings → Email → Email Providers → Add Provider**. For provider, choose
   **Agent's Gmail (Workspace)**, name it (e.g. "My Gmail"), then save.
   Click **Test** to send a test email from your own mailbox.
   Keep **Resend** as the default.
2. **Settings → Email → Gmail Sync** shows each Workspace mailbox. Click **Sync now**
   once. The first run imports the last 14 days of lead conversations, and larger
   mailboxes catch up over the next few runs.

The compose window now preselects "Agent's Gmail" for everyone. Agents can still pick
another provider from the *From* dropdown.

## Cron

`vercel.json` runs `/api/cron/gmail-sync` every 5 minutes. If the app is hosted on a
server with a crontab instead, add:

```
*/5 * * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/gmail-sync
```

## Troubleshooting (errors shown per mailbox in Settings → Gmail Sync)

| Error | Fix |
|---|---|
| `domain-wide delegation is not set up … (unauthorized_client)` | Step 2 is missing, the Client ID is wrong, or the scopes don't match exactly. Wait a few minutes after saving. |
| `mailbox not found in the Workspace domain or suspended (invalid_grant)` | That CRM user's email isn't an active Workspace user. Fix their CRM email, or ignore the error if they don't use Gmail. |
| `GOOGLE_WORKSPACE_DOMAINS is not set` / `GOOGLE_SERVICE_ACCOUNT_JSON …` | Step 3, then redeploy. |
| Compose: `… is not a Google Workspace mailbox on this domain` | The sender's login isn't on the Workspace domain. Pick another provider in *From*. |

## Limits

- Google Workspace allows about 2,000 sent messages per user per day, which is why bulk mail stays on Resend.
- Open/click tracking and the unsubscribe footer still apply to CRM-sent mail.
  Mail an agent writes directly in Gmail is synced but not tracked.
- Inline images in synced emails that reference attachments (`cid:`) don't render
  in the CRM preview. The rest of the email does.
