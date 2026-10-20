# AICOM — Guida rapida per la prova

Questa guida accompagna il Setup di AICOM e descrive un percorso di prova con dati aziendali reali o di test. I nomi dei pulsanti nell'app possono essere in francese.

## Prima di iniziare

Per accedere servono:

- il Setup Windows ricevuto dal referente AICOM;
- un codice di licenza valido fornito dal referente;
- l'account Google autorizzato per la prova. Se l'app è in modalità test Google, il referente deve aver aggiunto l'indirizzo tra gli utenti di test;
- una connessione internet per attivazione e sincronizzazione.

Non inviare al referente password, codici di recupero o documenti contabili reali. Per una prima prova, usa dati fittizi se non hai l'autorizzazione a trattare dati reali.

## Installazione e primo accesso

1. Scarica `AICOM-Setup-0.2.7.exe` dal link del referente (circa 100 MB: se la connessione è lenta, avvia il download quando la rete è più libera; il browser può riprenderlo se si interrompe). Avvialo con doppio clic e completa l'installazione. Se hai già la 0.1.0, installa sopra: i dati restano. Dalla 0.2.0 in poi gli aggiornamenti si scaricano da soli e si installano alla chiusura dell'app.
2. Avvia AICOM dal collegamento creato sul desktop o dal menu Start.
3. Inserisci il codice di licenza fornito.
4. Premi *Se connecter avec Google*, scegli l'account autorizzato e concedi ad AICOM l'accesso richiesto al proprio file su Drive. Non occorre inserire l'e-mail a mano né configurare Google Cloud.
5. Crea l'utente AICOM richiesto al primo avvio e conserva nome utente, password e codice di recupero in un luogo sicuro.
6. Inserisci il nome dell'azienda. Per una prova concreta senza esempi, lascia deselezionata l'opzione *Charger des données d'exemple*.

I dati sono salvati localmente e sincronizzati nell'account Google collegato. Usa la stessa azienda e lo stesso account durante la prova; non aprire contemporaneamente la stessa azienda su più PC.

## Mappa dell'app

- **Espace de travail**: panoramica, fatture fornitori, banca, chiusura mensile, previsione di cassa, analisi articoli, qualità dei dati, audit e aiuto.
- **Gestion des opérations** raccoglie tre aree collegate:
  - **Gestion commerciale**: clienti, documenti di vendita, acquisti con articoli e quantità, articoli, produzione e inventario.
  - **Saisie de caisse**: registrazione di vendite al banco e controllo delle disponibilità.
  - **Comptabilité**: conti, giornali, scritture, pagamenti e report.

Le schede sono collegate: gli acquisti e le vendite possono cambiare lo stock; le fatture, gli incassi e i pagamenti alimentano inoltre le registrazioni contabili secondo il flusso previsto.

## Prova consigliata: fornitore, acquisto, vendita

1. In **Gestion commerciale → Gestion des articles**, crea un articolo con riferimento univoco, descrizione, costo e prezzo di vendita. Il riferimento aiuta a ritrovare lo stesso prodotto nei documenti.
2. In **Gestion commerciale → Gestion des achats**, registra una fattura fornitore con il nome del fornitore, l'articolo e una quantità facile da riconoscere (per esempio 10). Salva la fattura per ricevere la merce in stock.
3. Apri la scheda **Au Magasin**. Controlla le colonne *Reçu fournisseurs*, *Vendu*, *Acheté − vendu* e *Stock réel*.
4. In **Gestion commerciale → Saisir une commande**, registra un ordine cliente per una parte della quantità. Un ordine non scarica ancora lo stock.
5. In **Liste des documents**, trasforma l'ordine in consegna. La merce viene scaricata al momento della consegna; la fatturazione successiva registra la vendita senza scaricare di nuovo lo stock.
6. Torna ad **Au Magasin** e verifica che *Vendu* sia aumentato e *Stock réel* diminuito della quantità consegnata. La differenza *Acheté − vendu* confronta acquisti ricevuti e vendite; può differire dallo stock reale se ci sono scorte iniziali, produzione o rettifiche di inventario.
7. Prova anche **Saisie de caisse → Ventes comptoir** con un articolo e una quantità contenuta: un ticket incassato riduce lo stock e compare nelle vendite.

## Altre schede da provare

- **Factures fournisseurs**: importa o inserisci fatture ricevute, verifica i dati, approva o rifiuta e consulta/esporta lo storico. La fattura inserita qui senza righe articolo non aggiorna le quantità del magazzino.
- **Gestion des fabrications**: definisci una nomenclatura e registra la produzione; i componenti vengono consumati e il prodotto finito entra in stock.
- **Inventaire**: confronta stock teorico e quantità contata; la validazione applica gli scostamenti.
- **Comptabilité**: controlla le scritture generate dai documenti e consulta i conti dei clienti e fornitori.
- **Analyse des articles**: verifica articoli registrati, venduti, consumati in produzione e rimanenti.

## Backup, reset e segnalazione problemi

In *Paramètres* puoi esportare una copia di sicurezza e i dati in Excel. *Repartir de zéro → Supprimer toutes les données* crea prima una copia sul PC, poi svuota i dati aziendali e sincronizza lo svuotamento sul Drive condiviso: riguarda anche gli altri PC collegati alla stessa azienda. Non usarlo se vuoi conservare dati della prova.

Per segnalare un problema, indica al referente la versione AICOM, i passaggi che hai eseguito e il risultato atteso/ottenuto. Non allegare password, codici di recupero o dati contabili riservati.
