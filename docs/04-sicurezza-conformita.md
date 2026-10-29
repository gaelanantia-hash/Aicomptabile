# Fase 7 — Sicurezza e conformità

## T47 — Verifica dell'app da parte di Google (da fare, tocca a te)

Senza verifica l'app resta in modalità Test: massimo 100 utenti aggiunti a mano e login che scade ogni 7 giorni. Per venderla serve la verifica.

Con il solo ambito `drive.file` (non sensibile) Google chiede la **verifica del marchio**, di norma qualche giorno lavorativo, **senza** audit di sicurezza esterno e senza video. Tempi e richieste restano a discrezione di Google.

### Prima di cominciare

- **Ragione sociale e nome dell'app definitivi** (punto 3.1): Google verifica che nome e logo della schermata di consenso corrispondano a quelli del sito.
- **Un dominio tuo** (per esempio `aicom-afrique.com`). Il dominio `run.app` di Cloud Run non va bene: non puoi dimostrare di esserne il proprietario.
- Consigliato: un indirizzo di supporto su quel dominio (`support@…`).

### Passi, in ordine

1. **Verifica il dominio** in Google Search Console (search.google.com/search-console), con un account Google che sia proprietario o editor del progetto Google Cloud di AICOM.
2. **Pubblica tre pagine sul dominio**, in francese (la lingua dei clienti):
   - home page: che cosa fa AICOM, con il nome «AICOM» identico alla schermata di consenso e i link alle due pagine seguenti;
   - informativa privacy (`privacy-policy.md`, completata e rivista; deve citare la *Google API Services User Data Policy* e l'uso limitato, la bozza lo fa già);
   - termini d'uso (`termini-uso.md`).
3. Nella console Google Cloud, **Google Auth Platform → Branding**:
   - nome: `AICOM`; logo: `apps/ledgerflow/build/google-consent-logo.png` (120×120, già pronto);
   - e-mail di supporto, link a home page, privacy e termini;
   - **Domini autorizzati**: il tuo dominio.
4. **Google Auth Platform → Accesso ai dati**: devono esserci solo `openid`, `…/auth/userinfo.email` e `…/auth/drive.file`. Se compare altro, toglilo: un ambito in più cambia il tipo di verifica. Giustificazione, in inglese (la leggono i revisori Google):
   > AICOM is a desktop accounting application. It stores the user's own accounting data in one file it creates in the user's Google Drive, so the data stay with the user and can be restored on another PC. The drive.file scope limits access to that file; the app never reads or lists any other file. The email address is shown to the user to confirm which account is connected.
5. **Google Auth Platform → Pubblico → Pubblica app**, poi **Invia per la verifica**.
6. Rispondi alle e-mail di Google dalla casella del progetto: se chiedono correzioni, di solito riguardano nome o logo diversi tra sito e schermata, oppure il link alla privacy.

### Cosa cambia dopo

- I clienti non vedono più l'avviso «Google non ha verificato questa app».
- Cade il limite di 100 utenti di prova e il collegamento non scade più ogni 7 giorni (oggi è la causa del banner «Reconnecter Google» citato in `supporto.md`).

## T48 — Privacy policy e termini d'uso (bozze da far rivedere)

`privacy-policy.md` e `termini-uso.md` sono **bozze**: descrivono fedelmente ciò che il software fa, ma non sono state riviste da un legale e contengono segnaposto tra parentesi quadre. Vanno completate, riviste, tradotte nella lingua dei clienti e pubblicate sul tuo dominio.

## T49 — Nessun segreto dentro l'app installata (fatto)

L'installer contiene solo:

| Dato | Perché non è un segreto |
|---|---|
| ID client OAuth desktop e relativo «secret» | Google documenta che per i client installati non è riservato; la protezione è PKCE |
| URL del servizio licenze e del feed aggiornamenti | Indirizzi pubblici |
| Chiave **pubblica** delle licenze | Serve solo a verificare le firme |

La chiave **privata** delle licenze e il token di amministrazione stanno solo in Secret Manager. Nessuna chiave di account di servizio è nel codice o nell'installer.

## T51 — Revisione di sicurezza (eseguita il 1° ottobre 2026)

| Controllo | Esito |
|---|---|
| Dipendenze (`npm audit`) dell'app e del servizio licenze | 0 vulnerabilità note |
| Token Google | Il refresh token è scritto solo cifrato dal sistema operativo (DPAPI su Windows, Keychain su macOS). Se la cifratura non è disponibile resta in memoria e non viene scritto. Coperto da test |
| Login | OAuth 2.0 con PKCE (S256), `state` casuale verificato, reindirizzamento solo su `127.0.0.1`. La password non passa dall'app. Coperto da test |
| Permessi Google | Solo `openid`, `email`, `drive.file`. Un test fallisce se viene aggiunto un permesso più ampio |
| Finestra dell'app | `contextIsolation` e `sandbox` attivi, `nodeIntegration` disattivo; l'interfaccia può chiamare solo 25 funzioni elencate in `electron/preload.cjs` |
| Contenuti | Content-Security-Policy restrittiva (`script-src 'self'`, `connect-src 'self'`); navigazione verso siti esterni bloccata, i link si aprono nel browser |
| Licenze | Firma Ed25519; codici a 100 bit salvati solo come impronta SHA-256; limite di tentativi per IP sull'attivazione |
| Servizio licenze | `helmet`, corpo richieste limitato a 16 kB, amministrazione dietro token confrontato a tempo costante |
| Rapporti d'errore | Disattivati di default; solo campi tecnici, lunghezza limitata, percorso utente sostituito con `~` |

Rischi residui noti:

- **Dati locali non cifrati.** Il database SQLite sul PC è leggibile da chi ha accesso alla sessione Windows del cliente. Mitigazione consigliata al cliente: sessione Windows con password e BitLocker.
- **Copia su Drive: cifrata.** `aicom-data.json` e gli archivi `aicom-audit-….json` sono cifrati (AES-256-GCM) con una chiave aziendale casuale, compressi prima della cifratura. Su Drive la chiave c'è solo «chiusa» con la password o il codice di soccorso di ogni utente (scrypt), quindi chi entra nell'account Google senza un identificativo AICOM non legge i dati (`electron/encryption.ts`). Limiti:
  - **Revisioni in chiaro precedenti.** Le versioni salvate prima dell'aggiornamento restano nella cronologia di Drive finché Google non le elimina (di norma 30 giorni o 100 revisioni). Mitigazione: verifica in due passaggi sull'account Google.
  - **Un utente disattivato** perde la sua serratura, ma la chiave non cambia: se l'aveva già su un PC (o ne aveva copiato il file), può ancora leggere le copie future. Per escluderlo davvero servirebbe cambiare la chiave (non ancora previsto).
  - **Perdita totale delle credenziali.** Se si perdono tutte le password, tutti i codici di soccorso e tutti i PC, la copia su Drive non è più leggibile. I backup locali (`Paramètres → Sauvegardes`) sono in chiaro e restano utilizzabili.
- **Licenza aggirabile da un utente esperto** che modifichi l'applicazione: la licenza è un controllo commerciale, non una protezione crittografica del software.
- **Installer non firmato** finché non acquisti un certificato (vedi `06-rilascio.md`).
- **Fuso orario del PC**: scadenze e tolleranza offline usano l'orologio del PC, che l'utente può cambiare.

Da rifare a ogni versione: `npm audit` (lo fa la CI) e una rilettura di `electron/preload.cjs` e dei permessi Google.

## T50 — GDPR

### Ruoli

- **Dati contabili del cliente** (clienti, fornitori, fatture, scritture): il cliente ne è *titolare* e li conserva nel proprio PC e nel proprio account Google. Tu **non li tratti**: non transitano né sono conservati sui tuoi sistemi. Google agisce per conto del cliente in base al contratto tra loro.
- **Dati delle licenze**: sei *titolare*. Tratti: ragione sociale del cliente, impronta del codice licenza, gli indirizzi Google autorizzati ad attivare la licenza, e per ogni PC attivato un identificativo casuale, il nome del PC, la versione dell'app, le date di attivazione e ultimo controllo e, se il PC è stato attivato con l'account Google, l'indirizzo usato. (Una versione precedente di questo documento diceva che l'e-mail non arriva al servizio: non è più vero da quando le licenze si attivano anche con l'account Google.)
- **Rapporti d'errore** (solo con consenso): versione dell'app, sistema operativo, messaggio e traccia tecnica dell'errore.

### Da fare prima della vendita

| Adempimento | Stato |
|---|---|
| Informativa privacy pubblicata | Bozza in `privacy-policy.md` |
| Registro dei trattamenti (licenze, rapporti d'errore, log, assistenza) | Bozza in `registro-trattamenti.md` |
| Base giuridica: contratto per le licenze, consenso per i rapporti d'errore | Il consenso è una casella disattivata di default nelle impostazioni |
| Conservazione: licenze scadute e log | Licenze: 24 mesi dopo la scadenza o la revoca, PC non visti da 24 mesi tolti; applicata con `npm run admin -- purge` (prima mostra, cancella con `--confirm`; `--months N` per un'altra durata). Log e rapporti d'errore: 30 giorni, durata predefinita di Cloud Logging. Il periodo resta una tua decisione: se cambi i 24 mesi, aggiorna `RETENTION_MONTHS` in `apps/licensing/src/retention.ts` e l'informativa |
| Cancellazione su richiesta | `npm run admin -- delete <id>` elimina il record della licenza e dei suoi PC. I log di Cloud Run seguono la loro scadenza |
| Luogo del trattamento | Regione `europe-west8` (Milano) |
| Contratto con Google Cloud come responsabile | Accetta l'addendum sul trattamento dei dati nella console |

Il nome del PC può contenere il nome di una persona (es. «PC-MARIO»): è un dato personale e va citato nell'informativa.

Questa sezione è un'analisi tecnica, non un parere legale.
