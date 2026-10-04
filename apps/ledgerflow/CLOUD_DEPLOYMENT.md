# AICOM Google Cloud Deployment

> **Superseded.** This describes the earlier hosted-web architecture, where AICOM's own project stores every customer's data. The product now ships as a desktop app that saves each customer's data in their own Google Drive; see `docs/02-google-cloud.md`. The code in `server/` is kept but not used by the desktop app.

## Architecture

- Firebase Authentication verifies customer identity and email.
- Cloud Run serves the AICOM web app and authenticated API over HTTPS.
- Cloud SQL for PostgreSQL stores workspaces, invoices, document metadata, storage quotas and audit events.
- A private Cloud Storage bucket stores original PDF/XML files. The client never receives public object URLs or database credentials.
- One AICOM-managed GCP project serves multiple isolated workspaces. A workspace owner selects a logical document quota of 10, 50 or 200 GB. This is an application quota, not a dedicated GCP database or a direct Google purchase; GCP bills the AICOM project.
- Workspace membership is checked on every data endpoint. A verified account must also have a write role to upload, create or review invoices.

The app can be opened from different devices after deployment and sign-in. Cloud data is fetched from the API, not browser storage. The current cloud views support workspace setup, document upload/download, invoice review and audit events. Bank reconciliation, forecasting, close controls and AI remain demo-only and are hidden in cloud mode.

## Prerequisites

Create a Google Cloud project under the AICOM organization, attach a billing account and choose the data region. The current development environment has no `gcloud` installation or project, so it cannot provision or deploy these resources yet.

Enable Cloud Run, Cloud Build, Artifact Registry, Cloud SQL Admin, Cloud Storage and Secret Manager APIs. Create a Firebase project for the same project ID, add a Web app, enable Email/Password sign-in, and enable email-enumeration protection. Add the final Cloud Run or custom domain to Firebase Authentication's authorized domains.

Create a Cloud SQL PostgreSQL instance and database in the selected region. Attach the instance to Cloud Run through the Cloud SQL connector. Create a migration principal for schema changes and a separate `aicom_app` database user for normal API traffic. The runtime user should receive only the table permissions required by the API, not schema-owner privileges.

Create a Cloud Storage bucket in the chosen region with uniform bucket-level access and public access prevention enabled. Do not add `allUsers` or `allAuthenticatedUsers`. Configure a runtime service account with Cloud SQL Client, Secret Manager Secret Accessor for the database-password secret, and object access scoped to this bucket. Prefer a custom bucket role limited to object create/get/delete over project-wide Storage Admin.

Enable Cloud SQL automated backups and point-in-time recovery before production data is used. Define retention, deletion and incident-response policies. Consider object versioning and lifecycle rules. The application audit table is useful for workflow history but is not a tamper-proof compliance ledger by itself.

## Environment

Copy `.env.example` to `.env` for the Vite client and set the Firebase Web app values. Firebase Web API keys are client identifiers, not server credentials; restrict the key to the AICOM domains and required Firebase APIs in Google Cloud.

Copy `.env.server.example` to `.env.server` only for local API development. Keep that file untracked. In production, inject `PGPASSWORD` from Secret Manager and use the Cloud Run service identity (Application Default Credentials); do not create or distribute service-account JSON keys.

For local API development, authenticate with Google Application Default Credentials and run the Cloud SQL Auth Proxy for the configured instance before starting the API. Then run `npm run build`, `npm run start`, and `npm run dev` in separate terminals. The app and API communicate through the Vite `/api` proxy.

## Database migration

Apply `server/migrations/001_initial.sql` once using the migration principal against the AICOM Cloud SQL database. Then grant `aicom_app` only the required `SELECT`, `INSERT`, `UPDATE` and `DELETE` permissions on the created tables. Run later migrations as an explicit deployment step, not automatically with every API process start.

## Build and deploy

Build the service from `apps/ledgerflow`:

```sh
npm ci
npm run lint
npm run build
```

Deploy to the selected region with Cloud Run, attaching the Cloud SQL instance and runtime service account. The container serves the web app and API on the same origin; the API itself is public at the network layer so the sign-in page can load, but every data route requires a verified Firebase ID token. Set these server environment variables on Cloud Run: `NODE_ENV=production`, `FIREBASE_PROJECT_ID`, `DOCUMENTS_BUCKET`, `PGHOST=/cloudsql/PROJECT_ID:REGION:INSTANCE_NAME`, `PGPORT=5432`, `PGDATABASE`, `PGUSER`, and `DB_POOL_MAX`. Bind `PGPASSWORD` from Secret Manager. Do not add database passwords to `VITE_*` variables.

After deployment, test `/healthz` and `/api/readyz`, register a verified test account, create a workspace, upload a synthetic PDF/XML, download it from another browser session, and verify workspace isolation with a second account. Then configure domain, backups, monitoring, billing alerts and an appropriate privacy notice before inviting customers.

## Limitations

- The real GCP resources have not been created or deployed from this workspace; no cloud project, billing account or `gcloud` CLI is configured here.
- The quota tiers are application limits only. Billing plans and customer payments are not implemented.
- Account invitations, MFA enforcement, account recovery policy, scheduled cleanup of failed uploads, malware scanning and a tamper-proof audit archive still need production work.
- The client supports a small currency list and the initial schema is not a complete international accounting ledger.
