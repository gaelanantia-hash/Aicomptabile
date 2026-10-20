# Fase 9 — Rilascio e manutenzione

## Comandi

Da `apps/ledgerflow`:

| Comando | Cosa fa |
|---|---|
| `npm run dev` | Interfaccia nel browser, modalità demo |
| `npm run desktop` | Costruisce e apre l'app desktop |
| `npm run desktop:dev` | App desktop sull'interfaccia di `npm run dev` (ricarica immediata) |
| `npm test` | Test automatici |
| `npm run dist` | Costruisce l'installer in `release/` |

Senza `desktop.config.json` l'app avviata dalla cartella del progetto funziona in *modalità sviluppo*: licenza non richiesta e pulsante «Continuer sans Google». L'app **installata** non ha mai questa scorciatoia.

## T58 — Installer (fatto)

`npm run dist` produce:

- `release/AICOM Setup <versione>.exe` — installer Windows (circa 107 MB), installazione per utente senza diritti di amministratore;
- `release/latest.yml` e `.blockmap` — servono agli aggiornamenti automatici.

Prima di costruire una versione per i clienti:

1. Copia `desktop.config.example.json` in `desktop.config.json` e compilalo (vedi `02-google-cloud.md`). Viene incluso nell'installer.
2. Aggiorna `version` in `package.json`.
3. Aggiungi un'icona: salva `build/icon.ico` (256×256). Oggi l'installer usa l'icona predefinita di Electron.

macOS non è configurato.

## Versione di prova per i clienti (fatto)

Per far provare il software prima di avere il progetto Google e il servizio licenze, `desktop.config.json` accetta `"trialUntil": "AAAA-MM-GG"`. Un installer costruito così:

- non chiede alcun codice di licenza fino a quella data, poi smette di aprirsi (i dati restano sul PC);
- permette di lavorare **senza account Google**, con i dati solo sul PC del cliente («Continuer sans Google»);
- se in seguito aggiungi `googleClientId`, offre anche il collegamento a Google.

`trialUntil` è ignorato non appena `licenseServerUrl` e `licensePublicKey` sono compilati. La cartella `consegna/` contiene l'installer di prova (scadenza 30 novembre 2026) e le istruzioni per il cliente in francese (`LISEZ-MOI.txt`). Per cambiare la data: modifica `trialUntil`, esegui `npm run dist` e ricopia l'installer.

Limite: la data è controllata sull'orologio del PC e non c'è alcun controllo online. È una prova tra persone che si fidano, non una protezione.

## T59 — Firma digitale (da fare, serve un acquisto)

L'installer attuale **non è firmato**. Le conseguenze sono due, la seconda scoperta durante le prove:

- Windows SmartScreen mostra «Windows ha protetto il PC»; il cliente può proseguire con *Ulteriori informazioni → Esegui comunque*.
- Sui PC con **Smart App Control** attivo (Windows 11 installato da zero, non aggiornato da Windows 10) il programma viene **bloccato senza possibilità di proseguire**. È successo sul PC di sviluppo: Windows ha impedito l'avvio dell'app impacchettata con «Un criterio di controllo dell'applicazione ha bloccato il file». L'unico rimedio corretto è la firma; disattivare Smart App Control è irreversibile senza reinstallare Windows e non va chiesto ai clienti.

Gli aggiornamenti automatici, inoltre, non possono verificare l'editore.

Opzioni:

| Opzione | Note |
|---|---|
| Azure Trusted Signing | Abbonamento mensile contenuto; richiede la verifica dell'identità dell'azienda; reputazione SmartScreen immediata |
| Certificato OV/EV da un'autorità (Sectigo, DigiCert…) | Costo annuale; dal 2023 la chiave sta su token hardware o HSM cloud |

Con un certificato `.pfx`, `electron-builder` firma da solo se trova le variabili `CSC_LINK` (file o base64) e `CSC_KEY_PASSWORD`. Il flusso `release.yml` le legge dai segreti `WINDOWS_CERTIFICATE` e `WINDOWS_CERTIFICATE_PASSWORD`. Per Azure Trusted Signing va aggiunta la sezione `win.azureSignOptions` in `package.json`.

## T60 — Aggiornamenti automatici (scritto, non provato da una versione all'altra)

- L'app installata controlla `updateFeedUrl` all'avvio, scarica la nuova versione in sottofondo e mostra «Redémarrer et installer»; altrimenti la installa alla chiusura.
- Il servizio licenze espone `/v1/updates/latest`, da cui l'app legge le note di rilascio (`apps/licensing/releases.json`).

Per pubblicare una versione: carica nel bucket il contenuto di `release/` (`.exe`, `.blockmap`, `latest.yml`), aggiorna `releases.json` e ripubblica il servizio licenze. Il flusso `release.yml` lo fa da solo.

### Pubblicare dal PC (senza GitHub Actions)

1. Installa Google Cloud CLI e accedi: `gcloud auth login`, poi `gcloud config set project <ID-progetto>`.
2. Alza `version` in `apps/ledgerflow/package.json` (e in `releases.json` le note).
3. Esegui `pwsh scripts/publish-release.ps1 -Bucket <nome-bucket>`.

Lo script crea il bucket se manca (lettura pubblica), scrive `updateFeedUrl` in `desktop.config.json`, esegue i test, costruisce l'installer `AICOM-Setup-<versione>.exe` e lo carica; `latest.yml` per ultimo e senza cache. Link fisso per i nuovi clienti: `https://storage.googleapis.com/<bucket>/releases/AICOM-Setup-latest.exe`.

Su una connessione a consumo (hotspot del telefono, rete Wi-Fi segnata *a consumo* in Windows, roaming o vicina al limite dati) l'app non scarica l'aggiornamento: mostra la versione e la dimensione massima e aspetta il pulsante *Télécharger quand même*. Il controllo usa `NetworkCostType` di Windows (`electron/network.ts`); se non riesce a leggerlo, scarica come prima.

**Le installazioni 0.1.0 non si aggiornano da sole**: il loro installer aveva `updateFeedUrl` vuoto. La 0.2.0 va installata a mano una volta (sopra la 0.1.0: i dati restano); dalla 0.2.0 in poi gli aggiornamenti sono automatici.

Senza firma, gli aggiornamenti funzionano lo stesso: l'app non verifica l'editore (nessun `publisherName`), controlla l'impronta SHA-512 dell'installer scritta in `latest.yml`. Chi può scrivere nel bucket può quindi distribuire codice ai clienti: limitare a te i permessi di scrittura.

Il passaggio reale da una versione installata alla successiva richiede due installer firmati: è nella lista delle prove manuali.

Importante: le regole di business sono dentro l'app. Un cliente con una versione vecchia calcola con le regole vecchie finché non aggiorna. Se una versione cambia lo schema dei dati, i PC non aggiornati si rifiutano di aprire i dati e chiedono l'aggiornamento.

## T61 — CI/CD (scritta, non attiva)

`.github/workflows/ci.yml` — a ogni push e pull request: controllo dipendenze, lint, test, build dell'app e del servizio licenze.

`.github/workflows/release.yml` — a ogni tag `v*`: installer Windows firmato, caricamento nel bucket, pubblicazione del servizio licenze su Cloud Run.

Per attivarle:

1. **La cartella `C:\AiComptabile` non è un repository git.** Esegui `git init`, crea un repository privato su GitHub e fai il primo push. `desktop.config.json`, `.env` e `release/` sono già esclusi.
2. In GitHub → *Settings → Secrets and variables → Actions* imposta:

| Tipo | Nome | Valore |
|---|---|---|
| Variabile | `GOOGLE_OAUTH_CLIENT_ID` | ID del client OAuth desktop |
| Segreto | `GOOGLE_OAUTH_CLIENT_SECRET` | Secret del client desktop |
| Variabile | `LICENSE_SERVER_URL` | URL del servizio su Cloud Run |
| Variabile | `LICENSE_PUBLIC_KEY` | Chiave pubblica stampata da `keygen` |
| Variabile | `RELEASE_BUCKET` | Nome del bucket degli aggiornamenti |
| Variabile | `GCP_REGION` | `europe-west8` |
| Variabile | `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_DEPLOY_SERVICE_ACCOUNT` | Federazione delle identità tra GitHub e Google Cloud (nessuna chiave salvata) |
| Segreto | `WINDOWS_CERTIFICATE`, `WINDOWS_CERTIFICATE_PASSWORD` | Certificato di firma |

`scripts/setup-github-release.ps1 -ProjectId <id>` prepara tutto questo per la pubblicazione: bucket, account di servizio `aicom-deploy`, federazione delle identità limitata a questo repository, `updateFeedUrl` locale e le variabili GitHub (con `gh`, oppure le stampa). Restano a mano solo `LICENSE_SERVER_URL`/`LICENSE_PUBLIC_KEY` (servizio licenze, vedi `setup-google-cloud.ps1`) e il certificato di firma.

I flussi non sono mai stati eseguiti: al primo avvio potrebbero servire ritocchi.

## T62 — Monitoraggio

Vedi `02-google-cloud.md`, punto 9.

## T63 e T64 — Guida e supporto

`guida-cliente.md` e `supporto.md`.

## Lista di controllo per ogni versione

1. `npm test` verde in entrambe le cartelle.
2. `version` aggiornata; note in `releases.json`.
3. Se cambia la struttura dei dati: nuova voce in `migrations` (mai modificare le esistenti) e prova di apertura di un file della versione precedente.
4. Tag `vX.Y.Z` → il flusso costruisce, firma e pubblica.
5. Installa la versione precedente su un PC di prova e verifica che si aggiorni.
