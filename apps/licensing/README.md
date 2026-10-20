# AICOM licensing service

Small service owned by the developer: licence activation and periodic checks, latest-version announcements, and opt-in anonymous error reports. It never receives customers' accounting data.

```sh
npm install
npm run admin -- keygen      # prints LICENSE_PRIVATE_KEY, ADMIN_TOKEN and the public key
cp .env.example .env         # paste the two secrets
npm run dev                  # http://127.0.0.1:8090, licences stored in data/licenses.json
npm test
```

Deployment to Cloud Run (Firestore store, secrets from Secret Manager) and day-to-day licence administration are described in [`../../docs/02-google-cloud.md`](../../docs/02-google-cloud.md).

| Endpoint | Purpose |
|---|---|
| `POST /v1/licenses/activate`, `/check`, `/deactivate` | Called by the app; return a signed activation valid offline for `GRACE_DAYS` |
| `POST /v1/licenses/activate-account` | Activation by Google account: verifies the Google ID token (audience in `GOOGLE_CLIENT_IDS`) and looks the address up in the licences' `emails`; returns a per-PC renewal secret, never the code |
| `GET /v1/updates/latest` | Latest version and release notes, from `releases.json` |
| `POST /v1/errors` | Technical error reports, written to the service log only |
| `/v1/admin/*` | Licence administration, behind `ADMIN_TOKEN`; use `npm run admin` |
