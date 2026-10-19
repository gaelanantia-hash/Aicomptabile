# AICOM — Guida per il cliente

> Da tradurre nella lingua dei clienti prima della distribuzione. I nomi dei pulsanti sono quelli dell'interfaccia francese.

## Cosa ti serve

- Un PC con Windows 10 o 11.
- Un **account Google** (Gmail o Google Workspace). Se non ne hai uno, crealo gratis su accounts.google.com.
- Il **codice di licenza** ricevuto all'acquisto, nella forma `AICOM-XXXXX-XXXXX-XXXXX-XXXXX`.
- Una connessione a internet per l'installazione.

## 1. Installa

1. Scarica `AICOM Setup.exe` dal link ricevuto.
2. Fai doppio clic. L'installazione dura meno di un minuto e non richiede diritti di amministratore.
3. AICOM si apre da solo; trovi l'icona sul desktop e nel menu Start.

**Aggiornamenti.** AICOM scarica da solo le nuove versioni e le installa alla chiusura. Se il PC è collegato a internet tramite il telefono o una connessione a consumo, AICOM non scarica niente senza chiedere: compare un avviso con il pulsante *Télécharger quand même*. Puoi anche indicare a Windows che una rete Wi-Fi è a consumo: *Impostazioni → Rete e Internet → Wi-Fi → (la tua rete) → Connessione a consumo*.

## 2. Primo avvio

**Passo 1 — Licenza.** Incolla il codice e premi *Activer*.

**Passo 2 — Account Google.** Premi *Se connecter avec Google*. Non devi inserire l'indirizzo e-mail nel programma né configurare Google Cloud. Si apre il tuo browser:

1. scegli il tuo account Google;
2. Google ti chiede di consentire ad AICOM di «vedere, modificare, creare ed eliminare solo i file specifici di Google Drive che usi con questa app»: accetta;
3. compare «Connexion réussie»: chiudi la scheda e torna ad AICOM.

AICOM non vede gli altri file del tuo Drive e non conosce la tua password. L'indirizzo collegato viene riconosciuto automaticamente dopo l'accesso.

**Passo 3 — Azienda.** Scrivi il nome della tua azienda. Se vuoi prima fare delle prove, spunta *Charger des données d'exemple*.

Premi *Ouvrir AICOM*.

## 3. Dove sono i tuoi dati

- Sul tuo PC, per lavorare velocemente anche senza internet.
- Nel tuo Google Drive, cartella **AICOM**: file `aicom-data.json` e file `aicom-audit-….json` (lo storico delle modifiche). Sono **cifrati**: chi entra nel tuo account Google non può leggerli senza un identificativo AICOM. **Non spostarli, non rinominarli, non cancellarli e non modificarli a mano.**
- I dati usano lo spazio già disponibile nel tuo account Google. Se la quota condivisa con Gmail e Google Foto non basta, libera spazio o aumenta il piano direttamente tramite Google.

In basso a sinistra un indicatore ti dice lo stato:

| Indicatore | Significato |
|---|---|
| Enregistré sur Google | Tutto salvato sul tuo Drive |
| Modifications à envoyer / En synchronisation… | Salvataggio in corso, pochi secondi |
| Hors ligne · enregistré sur ce PC | Non c'è internet: puoi continuare, l'invio riparte da solo |
| Reconnexion Google requise | Vedi «Problemi» qui sotto |

## 4. Fatture dei fornitori

In *Factures fournisseurs*, seleziona un fornitore dal menu per vedere le sue fatture; *Tous les fournisseurs* mostra l'intero archivio, incluse fatture da validare, validate e rifiutate. Ogni fattura è salvata nei dati dell'azienda insieme al nome del fornitore e viene sincronizzata con lo stesso account Google.

Da *Historique des factures fournisseurs* puoi esportare l'elenco filtrato in Excel o PDF. Se registri manualmente una fattura di un fornitore non ancora presente, scegli *Ajouter un nouveau fournisseur…* e inserisci il nome; quando approvi la fattura, il fornitore viene aggiunto all'anagrafica. Le righe degli articoli sono incluse nel rapporto se sono state lette durante l'importazione del documento.

## 5. Acquisti e magazzino

Per registrare la merce acquistata con articolo, quantità e prezzo e farla entrare nel magazzino, usa *Gestion commerciale → Gestion des achats*. Registra la fattura ricevuta dal fornitore (oppure ricevi una sua commande): il fornitore, gli articoli e le quantità diventano collegati ai documenti d'acquisto. La sezione *Factures fournisseurs* serve invece per archiviare, verificare e contabilizzare le fatture ricevute; una fattura inserita lì senza righe articolo non aggiorna le quantità di magazzino.

Nella scheda *Au Magasin* trovi, per articolo, le quantità ricevute dai fornitori, quelle vendute, la differenza automatica *acquistato − venduto* e lo stock reale. Le vendite conteggiate sono quelle che hanno effettivamente fatto uscire la merce. La differenza non è sempre uguale allo stock reale: quest'ultimo considera anche stock iniziale, produzione e rettifiche d'inventario.

## 6. Schede di Gestion commerciale

- *Liste des clients*: anagrafica e recapiti dei clienti.
- *Liste des documents*: consulta e fai avanzare preventivi, ordini, consegne e fatture.
- *Saisir un document*: crea un documento di vendita scegliendone il tipo.
- *Saisir une commande*: registra direttamente un ordine cliente; non scarica ancora il magazzino.
- *Interrogation*: cerca un cliente o un articolo e consulta vendite e disponibilità.
- *Gestion des achats*: registra le fatture/merci acquistate con articoli e quantità; la ricezione aggiorna il magazzino.
- *Gestion des articles*: gestisci anagrafica articoli, prezzi, IVA e stock.
- *Gestion des fabrications*: definisci componenti e registra la produzione.
- *Inventaire*: confronta le quantità contate con quelle a sistema e corregge le differenze.

## 7. Usare AICOM su un secondo PC

Installa AICOM, inserisci lo **stesso codice di licenza** e collega lo **stesso account Google**, poi accedi con il tuo **identificativo e la tua password AICOM**: aprono i dati cifrati e li scaricano su questo PC. Se hai dimenticato la password, usa *Mot de passe oublié ?* con il codice di soccorso. La licenza indica su quanti PC puoi usarla.

**Conserva il codice di soccorso.** Se si perdono tutte le password e tutti i codici di soccorso, i dati su Google Drive non si possono più aprire su un PC nuovo.

Usa AICOM su **un PC alla volta**. Se lo apri su un secondo PC mentre è aperto sul primo, AICOM ti avvisa.

Se cambi PC: sul vecchio, *Paramètres → Libérer la licence de ce PC*.

## 6. Copie di sicurezza

- Google Drive conserva le versioni precedenti dei tuoi dati per circa 30 giorni: *Paramètres → Sauvegardes → Restaurer*.
- Per una copia tua: *Paramètres → Exporter une sauvegarde…* e conserva il file dove preferisci.
- *Exporter les données en Excel* crea un file leggibile con Excel.

## 7. Problemi frequenti

**«Reconnexion Google requise»** — L'accesso di AICOM al tuo account è stato rimosso o è scaduto. I dati sono al sicuro sul PC. Premi *Reconnecter Google* e accedi con lo stesso account.

**Ho collegato l'account sbagliato** — *Paramètres → Déconnecter ou changer de compte*, poi collega quello giusto. Ogni account ha i suoi dati separati.

**«Espace Google Drive plein»** — Libera spazio nel tuo Drive (o in Gmail e Google Foto, che condividono lo stesso spazio) e premi *Réessayer*. Nel frattempo i dati restano sul PC.

**«AICOM est ouvert sur un autre PC»** — Chiudi AICOM sull'altro PC, oppure premi *Prendre la main sur ce PC*.

**«Deux versions de vos données»** — Due PC hanno modificato i dati ciascuno per conto suo. Scegli la versione da tenere; l'altra resta recuperabile dalle copie di sicurezza.

**La licenza non viene accettata** — Controlla di averla copiata per intero. Se dice che è già in uso sul numero massimo di PC, liberala dal vecchio PC o contatta l'assistenza.

**Windows mostra «Windows ha protetto il PC» all'installazione** — [Solo finché l'installer non è firmato: premi *Ulteriori informazioni → Esegui comunque*.]

## 8. Assistenza

[E-mail e orari dell'assistenza.] Indica sempre la versione di AICOM, che trovi in *Paramètres*.
