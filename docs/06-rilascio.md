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

### Quale firma puoi comprare (verificato il 29 ottobre 2026)

| Opzione | Chi può | Costo e tempi | Note |
|---|---|---|---|
| **Azure Trusted Signing** (ora *Artifact Signing*) | Aziende registrate in **USA, Canada, Unione europea o Regno Unito**. I privati solo in USA e Canada | Abbonamento mensile basso; verifica dell'identità dell'azienda da parte di Microsoft (da qualche giorno a qualche settimana) | Microsoft chiedeva tre anni di storia fiscale: oggi le sue pagine si contraddicono, la decisione arriva alla verifica. Se rifiuta, il portale non sempre dice il motivo |
| **Certificato OV** da un'autorità (Sectigo, DigiCert, Certum…) | Qualsiasi azienda registrata, anche in Camerun o in un altro paese CEMAC | Costo annuale più alto; la chiave sta su un token USB o in un servizio cloud dell'autorità | Va bene se l'editore non è un'azienda UE/USA/UK/Canada |

**In pratica:** se la società che pubblica AICOM è registrata in Italia (o altrove nell'UE), prova prima Azure. Se è registrata in Africa centrale, compra un certificato OV.

### Cosa fare con Azure Trusted Signing

1. Nel portale Azure crea un account *Trusted Signing* (regione vicina, per esempio West Europe) e annota il suo **endpoint** (es. `https://weu.codesigning.azure.net`).
2. Avvia la **verifica dell'identità** come organizzazione (*Public Trust*), con la ragione sociale esattamente come nel registro delle imprese.
3. Quando è approvata, crea un **profilo di certificato** *Public Trust*.
4. In Microsoft Entra ID registra un'applicazione (es. «aicom-release»), crea per lei un *client secret* e dalle il ruolo **Trusted Signing Certificate Profile Signer** sull'account (con il nuovo nome il portale può mostrarlo come *Artifact Signing Certificate Profile Signer*).
5. In GitHub (*Settings → Secrets and variables → Actions*) inserisci:

| Nome | Tipo | Valore |
|---|---|---|
| `AZURE_SIGNING_ENDPOINT` | variabile | endpoint del punto 1 |
| `AZURE_SIGNING_ACCOUNT` | variabile | nome dell'account Trusted Signing |
| `AZURE_SIGNING_PROFILE` | variabile | nome del profilo di certificato |
| `AZURE_SIGNING_PUBLISHER` | variabile | ragione sociale **identica** a quella del certificato |
| `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` | variabili | dell'applicazione del punto 4 |
| `AZURE_CLIENT_SECRET` | segreto | il *client secret* del punto 4 |

Per firmare dal PC con `scripts/publish-release.ps1`, imposta le stesse sette variabili d'ambiente prima di lanciarlo.

### Cosa fare con un certificato OV

Inserisci in GitHub i segreti `WINDOWS_CERTIFICATE` (il file `.pfx` in base64) e `WINDOWS_CERTIFICATE_PASSWORD`. Se la chiave sta su un token USB o in un servizio cloud dell'autorità, il `.pfx` non esiste: segui le istruzioni dell'autorità per `signtool` e dimmelo, va aggiunto un passaggio.

### Come la build sceglie

`npm run dist` lancia `scripts/dist.mjs`: se trova le quattro variabili `AZURE_SIGNING_*` firma con Azure, altrimenti con il certificato di `CSC_LINK`, altrimenti produce un installer non firmato e lo scrive nel log. Se manca solo una parte delle variabili Azure si ferma con un errore, per non pubblicare per sbaglio un installer non firmato.

Dopo la prima versione firmata, il nome dell'editore non va più cambiato: gli aggiornamenti automatici controllano che il nuovo installer sia firmato dallo stesso editore.

## Microsoft Store: la firma gratuita

Lo Store firma gratis i pacchetti che pubblica: Windows li considera affidabili, quindi niente avviso SmartScreen, e Smart App Control dovrebbe lasciarli passare (da confermare con la prima versione pubblicata, installandola su questo PC, dove Smart App Control è attivo). La registrazione come sviluppatore è gratuita anche per le aziende (da maggio 2026).

L'installer classico resta: lo Store è un secondo canale, consigliato a chi ha Smart App Control.

### Differenze della versione Store

- **Aggiornamenti**: li fa lo Store. Nella versione Store il nostro aggiornamento automatico è spento (`process.windowsStore` in `electron/main.ts`); l'avviso «nuova versione» apre la pagina *Download e aggiornamenti* dello Store invece di scaricare l'installer.
- **Revisione**: ogni versione passa la certificazione di Microsoft, di solito qualche giorno. Pubblica sullo Store la stessa versione dell'installer.
- **Dati sul PC**: Windows tiene i file della versione Store in una cartella sua. Se un cliente ha già l'installer classico, la versione Store all'inizio vede i dati esistenti, ma ciò che scrive resta suo. Meglio un solo canale per PC; i dati non si perdono comunque, perché sono sul Drive del cliente.
- **Licenze**: invariate. Lo Store ammette che le app non di gioco vendano con un proprio sistema; AICOM nello Store è gratuito da scaricare e si attiva con la licenza come oggi.

### Prima pubblicazione (tocca a te, una volta)

1. **Account**: su storedeveloper.microsoft.com apri un account **azienda** con un account di lavoro Microsoft. Microsoft consiglia il numero D-U-N-S dell'azienda per approvare prima; la verifica dell'azienda può chiedere qualche giorno.
2. **Nome**: in Partner Center crea una nuova app e **prenota il nome** «AICOM». Se è già preso, scegline uno vicino (per esempio «AICOM Comptabilité») e dimmelo: va cambiato anche nel pacchetto.
3. **Identità**: in *Gestione prodotto → Identità del prodotto* copia i tre valori e mettili in GitHub come variabili (*Settings → Secrets and variables → Actions → Variables*):

| Variabile | Valore in Partner Center |
|---|---|
| `STORE_IDENTITY_NAME` | `Package/Identity/Name` |
| `STORE_PUBLISHER` | `Package/Identity/Publisher` (comincia con `CN=`) |
| `STORE_PUBLISHER_NAME` | `Package/Properties/PublisherDisplayName` |

   Da quel momento ogni rilascio (tag `v…`) produce anche il pacchetto Store, scaricabile come *store-package* dalla pagina del flusso in GitHub Actions. Dal PC: imposta le stesse tre variabili e lancia `npm run dist:store`.
4. **Invio**: in Partner Center crea un invio e compila:
   - *Prezzi e disponibilità*: gratuito; mercati: i paesi dei clienti (Camerun, Gabon, Congo, Ciad, Centrafrica, Guinea equatoriale, RD Congo) ed eventualmente l'Italia;
   - *Proprietà*: categoria *Business* (o *Produttività*), link all'informativa privacy (serve il dominio della 3.3);
   - *Classificazione per età*: questionario (app di gestione, nessun contenuto sensibile);
   - *Pacchetti*: carica il file `AICOM-Store-<versione>.appx`;
   - *Funzionalità con restrizioni*: il pacchetto chiede `runFullTrust`, obbligatorio per le app desktop. Spiegazione: «AICOM is an Electron desktop application; runFullTrust is required to run it»;
   - *Schede dello Store*: descrizione in francese, almeno uno screenshot (1366×768 o più), icona già nel pacchetto.
5. Dopo la certificazione, **installa AICOM dallo Store su questo PC** e verifica che parta con Smart App Control attivo.

### Pacchetto di prova senza Partner Center

Senza le tre variabili, `npm run dist:store` produce un pacchetto con un'identità di prova (`AICOM.Test`). Windows lo installa anche se non è firmato con `Add-AppxPackage -Path release\AICOM-Store-<versione>.appx -AllowUnsigned`, e lo toglie con `Get-AppxPackage AICOM.Test | Remove-AppxPackage`. Serve solo a guardare il pacchetto: lo Store lo rifiuta, e su un PC con Smart App Control attivo un pacchetto non firmato viene bloccato. Attenzione: la versione installata così legge i dati di AICOM già presenti sul PC e si collega allo stesso account Google.

Se la costruzione si ferma con «Cannot create symbolic link» su `winCodeSign`, è un problema noto di electron-builder senza la *Modalità sviluppatore* di Windows: riguarda due file per macOS e il pacchetto viene prodotto lo stesso.

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
6. Se l'app è sullo Store: scarica *store-package* dal flusso in GitHub Actions e caricalo in un nuovo invio in Partner Center, con la stessa versione.
