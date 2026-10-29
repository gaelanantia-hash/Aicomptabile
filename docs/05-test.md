# Fase 8 — Test

## Cosa è verificato in automatico

Comandi: `npm test` in `apps/ledgerflow` (132 test di logica con `node --test`, di cui 12 su credenziali e storico degli accessi in `electron/auth.test.ts`, più 11 test delle schermate con Vitest; solo questi ultimi: `npm run test:ui`) e in `apps/licensing` (12 test). Girano anche nella CI.

| Area | Cosa provano | File |
|---|---|---|
| Sezioni di lavoro | Convalida fatture fornitori, lettura estratti conto CSV, riconciliazione e lettrage, cifre della panoramica, previsione di tesoreria, qualità dei dati, controlli di chiusura | `tests/finance.test.ts` |
| Regole di business | 27 attività presenti, scritture in pareggio, magazzino, catena preventivo → fattura, cassa, produzione, lettrage, numerazione | `tests/sage.test.ts` |
| Login Google | PKCE, permessi minimi, codice su indirizzo locale, `state` falsificato rifiutato, revoca | `electron/oauth.test.ts` |
| Token | Scritto solo cifrato; mai su disco senza cifratura del sistema | `electron/oauth.test.ts` |
| Database locale | Migrazioni, registro con valore prima/dopo, dati più recenti rifiutati, salvataggio fallito senza danni | `electron/database.test.ts` |
| Sincronizzazione su due PC (T54) | Nuovo PC ritrova i dati, modifiche nei due sensi, blocco «aperto altrove», conflitto e scelta, offline, accesso revocato, Drive pieno, ripristino versione, file cancellato da Drive | `electron/sync.test.ts` |
| Licenze nell'app | Firma, PC diverso, scadenza, 14 giorni offline, revoca | `electron/license.test.ts` |
| Servizio licenze | Attivazione, limite PC, rinnovo, revoca, scadenza, amministrazione protetta, aggiornamenti, rapporti d'errore, limite tentativi | `apps/licensing/src/app.test.ts` |
| Excel | Archivio valido, numeri come numeri, caratteri speciali | `tests/sage.test.ts` |
| Regole OHADA sulle scritture | Niente modifiche né cancellazioni dopo la registrazione, pièce in pareggio, niente scritture nei mesi chiusi, esercizio chiuso non riapribile, numerazione senza buchi | `tests/ledger.test.ts` |
| SYSCOHADA | Conti clienti/fornitori (40, 41, 481), bilancio, conto economico, tableau des flux che torna con la cassa, chiusura dell'esercizio | `tests/syscohada.test.ts`, `tests/yearEnd.test.ts` |
| IVA mensile | Dettaglio per aliquota, ripartizione TVA/CAC (Camerun), credito riportato, liquidazione mese per mese | `tests/vat.test.ts` |
| Fatture | Importo in lettere, totali per aliquota, mentions obbligatorie mancanti | `tests/invoice.test.ts` |
| Schermate (Vitest, browser simulato) | Vendita con fattura e stampa, fattura fornitore ricevuta e convalidata, chiusura mensile e dell'esercizio; ogni modifica passa dai controlli OHADA come nell'app | `tests/ui/*.test.tsx` |

Questi test usano un **Google simulato** (`electron/testing/fakeGoogle.ts`): provano la logica dell'app, non il comportamento reale di Google.

## Prova completa dell'app reale (eseguita il 1° ottobre 2026)

L'app Electron è stata avviata e pilotata attraverso la sua interfaccia, due volte, con 28 controlli superati su 28: procedura guidata, codice licenza errato e corretto, login nel browser, creazione azienda, vendita al banco, nuovo cliente, bilancio in pareggio, registro attività, impostazioni, avviso di aggiornamento, nessun errore in console; secondo PC con avviso «aperto su un altro PC», presa in carico e dati ritrovati; revoca dell'accesso con banner e riconnessione; terzo PC rifiutato dalla licenza a 2 posti. Anche qui Google era simulato.

Una seconda prova, in modalità locale, ha percorso le otto sezioni di lavoro con 21 controlli superati su 21: convalida di una fattura fornitore, riconciliazione di tre movimenti bancari, chiusura mensile, previsione, qualità dei dati, ricerca nell'aiuto, e bilancio ancora in pareggio alla fine.

Lo scenario del cliente in prova (primo avvio senza licenza né Google, inserimento dati, **riavvio**, scadenza della prova) passa 11 controlli su 11. Questa prova ha fatto emergere e correggere un difetto: al secondo avvio l'app tornava alla procedura guidata invece di aprire i dati.

L'installer è stato costruito. Le prime build impacchettate si sono avviate; l'ultima è stata bloccata da Smart App Control di Windows perché non firmata (vedi `06-rilascio.md`), quindi la versione finale è stata verificata solo in forma non impacchettata. **L'installer non è stato eseguito** (installazione vera e propria non provata).

## Da fare a mano, con Google vero

Servono il progetto Google Cloud (`02-google-cloud.md`) e `desktop.config.json` compilato. Segna l'esito accanto a ogni riga.

### T52 — Installazione con account nuovi

| # | Prova | Atteso |
|---|---|---|
| 1 | PC pulito, esegui l'installer | Si installa senza diritti di amministratore; compare l'icona AICOM |
| 2 | Primo avvio con account **Gmail personale** | Licenza → login nel browser → la schermata Google chiede solo e-mail e «file creati con questa app» |
| 3 | Crea l'azienda, registra una vendita | Indicatore «Enregistré sur Google»; in drive.google.com compare `AICOM/aicom-data.json` |
| 4 | Ripeti con account **Google Workspace** aziendale | Come sopra. Se l'amministratore del dominio blocca le app di terze parti, il login viene rifiutato da Google: annota il messaggio per la guida |
| 5 | Annulla il login chiudendo la scheda del browser | Dopo «Annuler» l'app torna al pulsante di login, senza bloccarsi |
| 6 | Account con verifica in due passaggi | Login riuscito |

### T53 — Revoca e riconnessione

| # | Prova | Atteso |
|---|---|---|
| 1 | Da myaccount.google.com/permissions rimuovi l'accesso di AICOM, poi modifica un dato | Entro pochi secondi banner «Reconnecter Google»; il dato resta visibile |
| 2 | Premi «Reconnecter Google» con lo stesso account | Torna «Enregistré sur Google»; il dato modificato è su Drive |
| 3 | *Paramètres → Déconnecter*, poi ricollega lo stesso account | Tutti i dati di nuovo presenti |
| 4 | Scollega e collega un **altro** account | Parte la creazione di una nuova azienda; i dati del primo account non compaiono |
| 5 | Ricollega il primo account | I suoi dati ricompaiono |

### T54 — Due PC (con Drive vero)

| # | Prova | Atteso |
|---|---|---|
| 1 | Installa su un secondo PC, stessa licenza e stesso account | Nessuna richiesta di creare l'azienda: i dati sono già lì |
| 2 | Apri AICOM su entrambi | Il secondo mostra «AICOM est ouvert sur un autre PC» |
| 3 | Stacca la rete al PC A, modifica; modifica anche sul PC B; ricollega A | Su A compare la scelta tra le due versioni |
| 4 | Scegli «Garder la version de ce PC» | B riceve la versione di A; la versione di B è in *cronologia versioni* di Drive |
| 5 | PC offline per un'ora di lavoro, poi online | Tutte le modifiche arrivano su Drive |

### Ripristino reale (T31)

| # | Prova | Atteso |
|---|---|---|
| 1 | *Paramètres → Sauvegardes*: ripristina una versione di ieri | I dati tornano a ieri; in `%APPDATA%\AICOM\backups` c'è `before-restore-…json` |
| 2 | *Importer une sauvegarde* con quel file | I dati tornano allo stato precedente al ripristino |

### T56 — Schermate principali

Per ognuno dei tre moduli apri ogni attività del menu (27 in tutto) e fai un'operazione completa: crea, modifica, controlla che il totale sia giusto. In contabilità verifica che dopo ogni operazione la *Balance* resti in pareggio.

### T57 — Beta con clienti reali

Da 3 a 5 clienti per 2-4 settimane, con l'app in stato Test su Google (aggiungili come utenti di prova). Raccogli: difficoltà nell'installazione, messaggi poco chiari, errori. Attiva con il loro consenso i rapporti d'errore.

## Non coperto

- Comportamento con migliaia di scritture (il file su Drive viene riscritto per intero a ogni sincronizzazione).
- macOS.
- Lo store Firestore del servizio licenze (i test usano lo store in memoria e su file).
- Aggiornamento automatico da una versione installata alla successiva.
