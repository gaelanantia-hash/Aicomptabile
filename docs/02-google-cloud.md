# Collegare AICOM a Google Drive

## Per chi usa AICOM

Il cliente **non deve creare un progetto Google Cloud**, inserire manualmente un indirizzo e-mail o configurare Drive.

1. Nell'installazione completa, scegliere **Connetti con Google** (o cliccare sull'indicatore «Solo su questo PC»).
2. Si apre la pagina ufficiale di Google: scegliere l'indirizzo del Drive da usare e autorizzare AICOM.
3. Tornare all'app. AICOM mostra l'indirizzo collegato e salva una copia dei dati sul PC, sincronizzandola con il Drive scelto.

L'indirizzo e-mail viene restituito da Google dopo l'accesso: non è sufficiente digitarlo in AICOM per concedere accesso ai file. La password Google non viene comunicata all'app. AICOM richiede l'accesso solo ai file che crea e gestisce per il cliente.

I dati occupano spazio nella quota Google del cliente. Non viene creato né aumentato automaticamente un piano di archiviazione: la quota disponibile dipende dal piano Google e, per gli account personali, è condivisa con Drive, Gmail e Google Foto. Se lo spazio finisce, i dati restano sul PC finché non si libera spazio o si acquista spazio aggiuntivo tramite Google.

## Configurazione una tantum, a carico dell'editore

I passaggi seguenti servono a chi **sviluppa e distribuisce AICOM**, non ai clienti. Il progetto Cloud contiene l'identità OAuth dell'app, il servizio licenze e gli aggiornamenti. **Non contiene i dati dei clienti**: quelli restano nel Google Drive di ciascuno.

Nessuno di questi passaggi è stato eseguito: richiedono il tuo account Google e una carta per la fatturazione. Tempo stimato: mezza giornata, più l'attesa della verifica di Google.

Sostituisci `PROGETTO` con l'ID del progetto e usa la regione `europe-west8` (Milano).

È una preparazione dell'editore, da fare prima di distribuire l'installer. Il client OAuth configurato viene incluso nella versione pubblicata; non va chiesto al cliente di crearne uno o di incollare valori nelle impostazioni.

## Via rapida: lo script

`scripts/setup-google-cloud.ps1` esegue da solo i punti 1 (creazione progetto), 2, 5, 6, 7 e 8 e scrive i valori in `desktop.config.json`:

```powershell
# una volta sola: installa Google Cloud CLI da https://cloud.google.com/sdk/docs/install
gcloud auth login
pwsh scripts/setup-google-cloud.ps1 -ProjectId PROGETTO
```

Si può rilanciare senza danni: salta ciò che esiste già. Si ferma con un link se la fatturazione non è collegata. Restano a mano, perché Google non li espone a riga di comando, il collegamento della fatturazione, la schermata di consenso (punto 3) e il client OAuth desktop (punto 4).

**Lo script non è mai stato eseguito**: su questo PC Google Cloud CLI non è installata. Alla prima esecuzione potrebbe servire qualche ritocco. I paragrafi seguenti descrivono gli stessi passaggi a mano.

## 1. Progetto e fatturazione (T10)

1. In console.cloud.google.com crea il progetto.
2. Collega un account di fatturazione.
3. *Fatturazione → Budget e avvisi*: crea un budget (es. 20 €/mese) con avvisi al 50, 90 e 100 %. Il servizio licenze costa pochi euro al mese.

## 2. API (T13)

```sh
gcloud config set project PROGETTO
gcloud services enable drive.googleapis.com run.googleapis.com firestore.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
```

`drive.googleapis.com` va attivata nel **tuo** progetto perché è il tuo client OAuth a chiamarla; i file restano nel Drive del cliente.

## 3. Schermata di consenso OAuth (T11)

*API e servizi → Schermata consenso OAuth*:

- Tipo utente: **Esterno**.
- Nome app, e-mail di assistenza, logo.
- Dominio autorizzato: un dominio che possiedi e che hai verificato in Search Console.
- Link a privacy policy e termini d'uso pubblicati su quel dominio (bozze in `docs/privacy-policy.md` e `docs/termini-uso.md`).
- Ambiti: `openid`, `.../auth/userinfo.email`, `.../auth/drive.file`. Nessun altro.

Finché l'app è in stato **Test** possono accedere solo gli utenti di prova che aggiungi (massimo 100) e il login scade dopo 7 giorni. Per i clienti veri serve la verifica: vedi `docs/04-sicurezza-conformita.md`.

Verifica anche in **Google Auth Platform → Data Access** che gli ambiti `openid`, `email` e `https://www.googleapis.com/auth/drive.file` siano elencati; abilita l'API Google Drive nel progetto.

### Errore «Request had insufficient authentication scopes»

Questo errore significa che il token Google usato da AICOM non include il permesso Drive necessario; non è un problema di spazio. Controlla che `drive.file` sia aggiunto in Data Access e che l'account usato sia incluso in **Test users** mentre l'app è in modalità Test. Poi rimuovi l'accesso AICOM da [Sicurezza dell'account Google → Connessioni con app e servizi di terze parti](https://myaccount.google.com/connections), riavvia AICOM e riconnetti lo stesso account per mostrare e concedere nuovamente i permessi. Le modifiche già effettuate restano nella copia locale finché non si sincronizzano.

## 4. Client OAuth «App desktop» (T12) — editore

*API e servizi → Credenziali → Crea credenziali → ID client OAuth → App desktop*.

Copia **ID client** e **secret client** in `apps/ledgerflow/desktop.config.json` (parti da `desktop.config.example.json`). Per i client desktop Google stessa documenta che il «secret» non è riservato: la protezione è data da PKCE. Non mettere mai in quel file chiavi di account di servizio.

## 5. Regione e database licenze (T14)

```sh
gcloud firestore databases create --location=europe-west8
```

## 6. Ruoli del team (T15)

Assegna a ogni persona solo ciò che le serve:

| Chi | Ruolo |
|---|---|
| Titolare | Proprietario (solo lui) |
| Sviluppatore che pubblica | Cloud Run Developer, Service Account User |
| Chi gestisce le licenze | Nessun ruolo cloud: usa `npm run admin` con `ADMIN_TOKEN` |

Crea un account di servizio dedicato per Cloud Run:

```sh
gcloud iam service-accounts create aicom-licensing
gcloud projects add-iam-policy-binding PROGETTO \
  --member=serviceAccount:aicom-licensing@PROGETTO.iam.gserviceaccount.com --role=roles/datastore.user
```

## 7. Servizio licenze su Cloud Run (T33–T37)

Genera le chiavi una sola volta:

```sh
cd apps/licensing
npm install
npm run admin -- keygen
```

Il comando stampa `LICENSE_PRIVATE_KEY`, `ADMIN_TOKEN` e la chiave pubblica.

```sh
printf '%s' 'VALORE_LICENSE_PRIVATE_KEY' | gcloud secrets create aicom-license-private-key --data-file=-
printf '%s' 'VALORE_ADMIN_TOKEN'         | gcloud secrets create aicom-admin-token --data-file=-
gcloud secrets add-iam-policy-binding aicom-license-private-key \
  --member=serviceAccount:aicom-licensing@PROGETTO.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor
gcloud secrets add-iam-policy-binding aicom-admin-token \
  --member=serviceAccount:aicom-licensing@PROGETTO.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor

gcloud run deploy aicom-licensing --source . --region europe-west8 --allow-unauthenticated \
  --service-account aicom-licensing@PROGETTO.iam.gserviceaccount.com \
  --set-secrets LICENSE_PRIVATE_KEY=aicom-license-private-key:latest,ADMIN_TOKEN=aicom-admin-token:latest
```

Copia l'URL del servizio in `licenseServerUrl` e la chiave pubblica in `licensePublicKey` di `desktop.config.json`.

**Se perdi la chiave privata** tutte le licenze attive smettono di rinnovarsi: conservane una copia fuori da Google Cloud.

### Gestire le licenze

```sh
export LICENSE_SERVER_URL=https://aicom-licensing-xxxx.run.app
export ADMIN_TOKEN=...
npm run admin -- create "Nome Cliente SARL" --devices 2 --expires 2027-12-31
npm run admin -- list
npm run admin -- revoke <id>
npm run admin -- reset-devices <id>     # il cliente ha cambiato PC senza liberare la licenza
npm run admin -- delete <id>            # cancellazione definitiva (richieste GDPR)
```

Il codice (`AICOM-XXXXX-XXXXX-XXXXX-XXXXX`) viene mostrato **una sola volta** alla creazione: nel database resta solo la sua impronta.

## 8. Bucket per gli aggiornamenti

```sh
gcloud storage buckets create gs://PROGETTO-aicom-releases --location=europe-west8 --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://PROGETTO-aicom-releases --member=allUsers --role=roles/storage.objectViewer
```

È pubblico in lettura perché contiene solo l'installer. Metti `https://storage.googleapis.com/PROGETTO-aicom-releases/releases` in `updateFeedUrl`.

## 9. Monitoraggio (T62)

- **Disponibilità**: *Monitoring → Controlli di uptime* su `https://…run.app/healthz`, con avviso via e-mail.
- **Errori**: il servizio scrive log JSON con `severity: ERROR`. Crea un avviso basato sui log con filtro `resource.type="cloud_run_revision" severity>=ERROR`. I rapporti d'errore inviati dalle app hanno `type: client_error`.
- **Costi**: il budget del punto 1.
- **Tempi di risposta**: grafici predefiniti di Cloud Run (latenza, richieste, istanze).

## Cosa non serve più

`apps/ledgerflow/server/` e `CLOUD_DEPLOYMENT.md` descrivono l'architettura precedente (sito web con database e archivio tuoi per tutti i clienti). Con l'opzione A l'app desktop non li usa. Sono stati lasciati al loro posto; si possono eliminare quando confermi che la versione web non serve.
