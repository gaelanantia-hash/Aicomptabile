# Supporto clienti — scheda operativa

Per chi risponde ai clienti. I comandi `npm run admin` si eseguono da `apps/licensing` con `LICENSE_SERVER_URL` e `ADMIN_TOKEN` impostati.

## Prima di tutto, chiedi

1. Versione di AICOM (*Paramètres*, in alto).
2. Cosa dice l'indicatore in basso a sinistra.
3. Quale account Google è collegato (*Paramètres → Compte*).

**Non chiedere mai** la password Google né il file dei dati per e-mail senza necessità: contiene tutta la contabilità del cliente.

## Problemi tipici

| Sintomo | Causa probabile | Soluzione |
|---|---|---|
| «Non vedo più i miei dati», parte la creazione dell'azienda | Account Google diverso da quello usato prima | *Paramètres → Déconnecter ou changer de compte* e collegare l'account giusto. I dati dell'altro account non sono persi |
| Banner «Reconnecter Google» | Accesso revocato da myaccount.google.com, password cambiata, oppure l'app è ancora in modalità Test su Google (scade ogni 7 giorni) | *Reconnecter Google* con lo stesso account |
| «Espace Google Drive plein» | Spazio Google esaurito (condiviso con Gmail e Foto) | Liberare spazio, poi *Réessayer*. Nessun dato perso: resta sul PC |
| «Ouvert sur un autre PC» ma l'altro PC è spento | L'altro PC è stato spento senza chiudere AICOM | Aspettare 3 minuti o *Prendre la main sur ce PC* |
| «Deux versions de vos données» | Modifiche su due PC senza sincronizzazione | Far scegliere la versione più completa. L'altra è nella cronologia di Drive o in `%APPDATA%\AICOM\backups` |
| Licenza: «déjà utilisée sur le nombre maximal de PC» | PC sostituito senza liberare la licenza | `npm run admin -- list`, poi `reset-devices <id>` |
| Licenza: «n'a pas pu être vérifiée depuis trop longtemps» | PC offline da più di 14 giorni | Collegarsi a internet e riaprire AICOM |
| Licenza: «désactivée» | Licenza revocata | Verificare lo stato del contratto |
| «Mettez à jour AICOM» | Dati salvati da una versione più recente su un altro PC | Aggiornare AICOM su questo PC |
| Login Google rifiutato con account aziendale | L'amministratore di Google Workspace blocca le app di terze parti | L'amministratore del cliente deve autorizzare AICOM nella console di amministrazione |
| Dato cancellato o modificato per errore | — | *Journal d'activité* mostra chi, quando e il valore precedente; *Paramètres → Sauvegardes → Restaurer* riporta a una versione precedente |
| Il file `aicom-data.json` è stato cancellato da Drive | — | Riaprire AICOM sul PC: lo ricrea dalla copia locale. Se anche il PC è perso, recuperare dal cestino di Drive (30 giorni) |
| Un file `aicom-audit-….json` è stato cancellato da Drive | Errore di sincronizzazione sui PC che non lo avevano ancora scaricato (per esempio un PC nuovo o reinstallato); gli altri continuano a funzionare | Recuperarlo dal cestino di Drive (30 giorni) |

## Dove guardare

| Cosa | Dove |
|---|---|
| Dati locali del cliente | `%APPDATA%\AICOM\` |
| Salvataggi automatici | `%APPDATA%\AICOM\backups\` |
| Stato delle licenze | `npm run admin -- list` |
| Errori segnalati dalle app (se il cliente ha acconsentito) | Log di Cloud Run, filtro `jsonPayload.type="client_error"` |

## Recupero estremo

Il cliente ha perso il PC e non riesce a collegarsi: i dati sono nel suo Drive. Su un nuovo PC basta installare AICOM, attivare la licenza (se serve, `reset-devices`) e collegare lo stesso account Google.

## Cosa non possiamo fare

Non abbiamo accesso ai dati contabili dei clienti e non possiamo recuperarli al posto loro. Se il cliente perde sia il PC sia l'accesso al proprio account Google, i dati non sono recuperabili da noi.
