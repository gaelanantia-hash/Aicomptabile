# Registro delle attività di trattamento — BOZZA

> Bozza preparata dal software (articolo 30 del GDPR). Va completata nei punti tra parentesi quadre, rivista da un legale e tenuta aggiornata. Ultimo aggiornamento: 29 ottobre 2026.

**Titolare del trattamento:** [ragione sociale], [indirizzo], [partita IVA o numero di registro].
**Contatto privacy:** [e-mail]. **Responsabile della protezione dei dati (DPO):** [nominato / non obbligatorio, da valutare con il legale].

I **dati contabili dei clienti** (clienti, fornitori, fatture, scritture) **non compaiono in questo registro**: restano sul PC del cliente e nel suo Google Drive, cifrati, e non passano dai nostri sistemi. Per quei dati il titolare è il cliente.

## 1. Gestione delle licenze

| Voce | Contenuto |
|---|---|
| Finalità | Rilasciare, verificare, rinnovare e revocare le licenze di AICOM; limitare il numero di PC per licenza |
| Base giuridica | Esecuzione del contratto di licenza (art. 6.1.b) |
| Interessati | Clienti (persone giuridiche e, per loro, le persone che usano AICOM) |
| Dati | Ragione sociale intestataria; impronta SHA-256 del codice di licenza (il codice in chiaro non è conservato); scadenza; indirizzi Google autorizzati ad attivare la licenza; per ogni PC attivato: identificativo casuale, nome del PC (può contenere il nome di una persona), versione dell'app, date di attivazione e di ultimo controllo, indirizzo Google usato per l'attivazione (solo se il PC è stato attivato con l'account Google) |
| Fonte | Il cliente (in fase di vendita) e l'app installata (a ogni controllo) |
| Destinatari | Nessuno. Responsabile del trattamento: Google Cloud (Cloud Run, Firestore) |
| Luogo e trasferimenti | Regione `europe-west8` (Milano). Google è un gruppo statunitense: trasferimenti coperti dall'addendum sul trattamento dei dati di Google Cloud e dalle clausole contrattuali tipo [verificare con il legale] |
| Conservazione | Per tutta la durata della licenza; poi **24 mesi** dalla scadenza o dalla revoca. Un PC che non si collega da 24 mesi perde la sua attivazione. Applicata con `npm run admin -- purge`, da lanciare [una volta al mese] |
| Sicurezza | Codici salvati solo come impronta; firma Ed25519 dei permessi; amministrazione dietro token; limite di tentativi per IP; accesso a Firestore solo dal servizio |

## 2. Rapporti d'errore

| Voce | Contenuto |
|---|---|
| Finalità | Correggere i malfunzionamenti di AICOM |
| Base giuridica | Consenso (art. 6.1.a): opzione disattivata di default nelle impostazioni, revocabile in ogni momento |
| Interessati | Utenti che hanno attivato l'opzione |
| Dati | Versione dell'app, sistema operativo, messaggio e traccia tecnica dell'errore (il percorso utente è sostituito da `~`), lunghezza limitata. Nessun dato contabile |
| Destinatari | Nessuno. Responsabile: Google Cloud (Cloud Logging) |
| Conservazione | **30 giorni** (durata predefinita dei log di Cloud Logging, bucket `_Default`) |

## 3. Log tecnici del servizio

| Voce | Contenuto |
|---|---|
| Finalità | Sicurezza e funzionamento del servizio licenze (diagnosi, contrasto ai tentativi di indovinare i codici) |
| Base giuridica | Legittimo interesse (art. 6.1.f) |
| Dati | Indirizzo IP e browser/app di ogni richiesta (registrati da Cloud Run), esito della richiesta; per un account Google non autorizzato solo il dominio dell'indirizzo, non l'indirizzo |
| Destinatari | Nessuno. Responsabile: Google Cloud (Cloud Run, Cloud Logging) |
| Conservazione | **30 giorni** (bucket `_Default` di Cloud Logging, da non allungare) |

## 4. Assistenza ai clienti

| Voce | Contenuto |
|---|---|
| Finalità | Rispondere alle richieste di assistenza |
| Base giuridica | Esecuzione del contratto (art. 6.1.b) |
| Dati | Nome, e-mail e messaggi della persona che scrive; informazioni tecniche che fornisce (versione, schermate). Non si chiedono password né il file dei dati |
| Destinatari | [Servizio di posta usato, per esempio Google Workspace] |
| Conservazione | [Da decidere, proposta: 24 mesi dall'ultima richiesta] |

## Diritti degli interessati

Richieste a [e-mail]. Cancellazione di una licenza: `npm run admin -- delete <id>` (cancella il record e i suoi PC). I log si cancellano da soli alla scadenza dei 30 giorni.

## Clienti fuori dall'Unione europea

I clienti di AICOM sono in Africa centrale (CEMAC e RDC). Anche i loro paesi hanno, o stanno adottando, leggi sulla protezione dei dati personali, con obblighi propri (per esempio dichiarazioni all'autorità nazionale). Da verificare con un legale per ogni paese in cui si vende.
