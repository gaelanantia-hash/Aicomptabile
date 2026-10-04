# Fase 1 — Decisioni

Decisioni prese per il progetto AICOM, con il motivo. Stato al 1° ottobre 2026.

| # | Decisione | Scelta | Motivo |
|---|---|---|---|
| T01 | Elenco delle funzioni | Le 27 attività della checklist Sage 100 (9 gestione commerciale, 7 cassa, 11 contabilità), più nove sezioni di lavoro: panoramica, fatture fornitori, riconciliazione bancaria, chiusura mensile (con grafico delle vendite del mese), previsione di tesoreria, analisi degli articoli (registrati, venduti, rimasti), qualità dei dati, pista di audit, aiuto | Schermate in `src/SageModules.tsx` e `src/FinanceSections.tsx` |
| T02 | Utenti per cliente | **Uno** | Conseguenza dell'opzione A |
| T03 | Dove salvare i dati | **Opzione A: Google Drive del cliente** | Nessun costo per il cliente, nessun dato contabile sui nostri server |
| T04 | Permessi Google richiesti | `openid`, `email`, `drive.file` | Vedi sotto |
| T06 | Tecnologia dell'app | **Electron** | Riusa senza riscriverle le schermate React esistenti |
| T07 | Linguaggio del backend | **Node.js (TypeScript)** | Stesso linguaggio dell'app, un solo set di competenze |
| T08 | Comportamento senza internet | **Copia locale + sincronizzazione** | Vedi sotto |
| T09 | Schermate principali | Realizzate direttamente nell'app | Procedura guidata, login Google, moduli, registro attività, impostazioni |

T05 (ruoli interni) riguarda solo l'opzione B e non si applica.

## T04 — Permessi Google

L'app chiede tre permessi e nessun altro:

- `openid` e `email`: sapere quale account è collegato, per mostrarlo e per tenere separati i dati di account diversi.
- `https://www.googleapis.com/auth/drive.file`: accesso **solo ai file creati dall'app stessa**. L'app non vede né può toccare il resto del Drive del cliente.

`drive.file` è classificato da Google come permesso *non sensibile*: la verifica dell'app richiede la validazione del marchio ma **non** l'audit di sicurezza annuale (CASA) imposto per i permessi ampi come `drive`. Non va sostituito con un permesso più ampio senza rivalutare costi e tempi.

Il permesso `drive.appdata` (cartella nascosta) è stato scartato: il cliente non vedrebbe il file e non potrebbe usare la cronologia delle versioni di Drive.

## T08 — Senza internet

L'app lavora sempre su una copia locale (database SQLite sul PC) e invia una copia a Drive pochi secondi dopo ogni modifica. Senza connessione:

- si continua a lavorare normalmente; l'indicatore mostra «Hors ligne · enregistré sur ce PC»;
- al ritorno della connessione le modifiche partono da sole;
- la licenza resta valida per 14 giorni senza contattare il servizio licenze (valore `GRACE_DAYS`).

Limite accettato: se due PC modificano i dati mentre sono entrambi offline, al ritorno online l'utente deve scegliere quale versione tenere (l'altra resta recuperabile). Con un solo utente per cliente è un caso raro.

## Cosa resta da decidere

- **Nome dell'editore e `appId`**: oggi `com.aicom.desktop` e autore «AICOM» in `apps/ledgerflow/package.json`. Vanno allineati alla ragione sociale prima di firmare l'installer.
- **Icona dell'applicazione**: non impostata; l'installer usa l'icona predefinita di Electron.
- **macOS**: l'app è predisposta (cifratura via Keychain) ma l'installer macOS non è configurato né provato.
- **Lingua**: interfaccia in francese e inglese. L'italiano non è previsto.
