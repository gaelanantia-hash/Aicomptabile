# Fase 7 — Sicurezza e conformità

## T47 — Verifica dell'app da parte di Google (da fare, tocca a te)

Senza verifica l'app resta in modalità Test: massimo 100 utenti aggiunti a mano e login che scade ogni 7 giorni. Per venderla serve la verifica.

Cosa prepara la richiesta (*Schermata consenso OAuth → Pubblica app → Prepara per la verifica*):

1. Dominio di proprietà verificato in Search Console.
2. Home page pubblica dell'app su quel dominio.
3. Privacy policy e termini d'uso pubblicati su quel dominio (bozze in questa cartella).
4. Logo e nome definitivi.
5. Giustificazione degli ambiti: «L'app salva i dati contabili dell'utente in un file che essa stessa crea nel suo Drive; `drive.file` limita l'accesso a quel file».
6. Video dimostrativo del login e dell'uso dei dati, se richiesto.

Con il solo ambito `drive.file` (non sensibile) è prevista la verifica del marchio, di norma qualche giorno lavorativo, **senza** audit di sicurezza esterno. Tempi e richieste restano a discrezione di Google.

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
- **File su Drive in chiaro.** `aicom-data.json` è leggibile da chiunque acceda all'account Google del cliente. Mitigazione: verifica in due passaggi sull'account Google.
- **Licenza aggirabile da un utente esperto** che modifichi l'applicazione: la licenza è un controllo commerciale, non una protezione crittografica del software.
- **Installer non firmato** finché non acquisti un certificato (vedi `06-rilascio.md`).
- **Fuso orario del PC**: scadenze e tolleranza offline usano l'orologio del PC, che l'utente può cambiare.

Da rifare a ogni versione: `npm audit` (lo fa la CI) e una rilettura di `electron/preload.cjs` e dei permessi Google.

## T50 — GDPR

### Ruoli

- **Dati contabili del cliente** (clienti, fornitori, fatture, scritture): il cliente ne è *titolare* e li conserva nel proprio PC e nel proprio account Google. Tu **non li tratti**: non transitano né sono conservati sui tuoi sistemi. Google agisce per conto del cliente in base al contratto tra loro.
- **Dati delle licenze**: sei *titolare*. Tratti: ragione sociale del cliente, impronta del codice licenza, per ogni PC attivato un identificativo casuale, il nome del PC, la versione dell'app e le date di attivazione e ultimo controllo. L'indirizzo e-mail Google del cliente **non** viene inviato al servizio licenze.
- **Rapporti d'errore** (solo con consenso): versione dell'app, sistema operativo, messaggio e traccia tecnica dell'errore.

### Da fare prima della vendita

| Adempimento | Stato |
|---|---|
| Informativa privacy pubblicata | Bozza in `privacy-policy.md` |
| Registro dei trattamenti (licenze, rapporti d'errore) | Da compilare |
| Base giuridica: contratto per le licenze, consenso per i rapporti d'errore | Il consenso è una casella disattivata di default nelle impostazioni |
| Conservazione: definire per quanto tieni le licenze scadute e i log | Da decidere (proposta: 24 mesi dopo la scadenza; log 30 giorni) |
| Cancellazione su richiesta | `npm run admin -- delete <id>` elimina il record della licenza e dei suoi PC. I log di Cloud Run seguono la loro scadenza |
| Luogo del trattamento | Regione `europe-west8` (Milano) |
| Contratto con Google Cloud come responsabile | Accetta l'addendum sul trattamento dei dati nella console |

Il nome del PC può contenere il nome di una persona (es. «PC-MARIO»): è un dato personale e va citato nell'informativa.

Questa sezione è un'analisi tecnica, non un parere legale.
