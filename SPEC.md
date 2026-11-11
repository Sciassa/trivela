# TRIVELA — Specifica di prodotto e architettura

> Documento di riferimento del progetto. Ogni decisione di design o architettura che cambia va aggiornata qui **prima** di essere implementata.
> Stato: **v1.1 — prima versione giocabile (dati: Mondiali FIFA 1930–2026). Vincolo: tutto gratuito.**

---

## 0. Visione e principi non negoziabili

**TRIVELA** (trivela + trivia) è un quiz calcistico arcade **1 contro 1** per veri maniaci del calcio, giocabile su qualsiasi combinazione di dispositivi (1, 2 o 3 schermi), con estetica pixel-art anni '80, colonna sonora chiptune ed effetti 8-bit. Le partite possono essere inserite in un **Torneo** con Classifica Generale.

Principi che nessuna feature può violare:

| # | Principio | Conseguenza pratica |
|---|---|---|
| P1 | **Zero fatti non verificati.** Nell'app entra solo ciò che è confermato da fonti affidabili. | Regola delle due famiglie di fonti (§8.3). Nessun LLM genera fatti a runtime. |
| P2 | **Niente è contestabile.** | Nessun pulsante "contesta", "segnala errore" o override tra giocatori. Regole di accettazione fisse e pubblicate (§10). Statistiche sempre con definizione e data di aggiornamento. |
| P3 | **L'aiuto ortografico non dà alcuna informazione sulla risposta.** | È un correttore, non un completatore; è funzione pura del solo testo digitato (§10.3). Proprietà testata in CI. |
| P4 | **Argomento a piacere completamente libero.** | Input testuale libero, senza liste; generazione deterministica dal grafo con espansione (§7). |
| P5 | **Domande "da maniaco", mai da quiz generalista.** | Archetipi (§8.6), filtro di curiosità, distrattori verificati. |
| P6 | **Identità originale.** | Nessun nome, logo, persona reale o testata giornalistica reale usati come branding. Il conduttore è un ruolo generico; il giornale è di fantasia. |
| P7 | **Fonti usate nel rispetto dei loro termini.** | Nessuno scraping massivo di siti che lo vietano (§8.1). |

---

## 0.1 Decisioni della v1 (vincolo "tutto gratis")

Queste decisioni prevalgono sul resto del documento dove c'è contrasto.

| Tema | Decisione v1 |
|---|---|
| Fonti | Solo fonti gratuite e aperte: **openfootball** (pubblico dominio), **Wikipedia/Wikidata** (famiglia *wikimedia*), **StatsBomb Open Data**. Nessuna API a pagamento (livello B rimosso). I siti di livello C (Transfermarkt, Sky Sport, UEFA, FBref…) restano riferimenti per la verifica manuale, mai scaricati in massa. |
| Perimetro dati | **Fasi finali dei Mondiali FIFA 1930–2026**: è l'unico ambito in cui oggi esistono almeno due famiglie gratuite indipendenti con partite, marcatori al minuto, formazioni e rose. Serie A e club entreranno quando avranno una seconda fonte gratuita verificabile. |
| Verifica | Regola delle due famiglie invariata. In più vale l'**attestazione referenziata**: una dichiarazione Wikidata che cita esplicitamente una fonte esterna (es. data di nascita con riferimento a un database calcistico o a un'autorità bibliografica) conta come seconda famiglia; il riferimento viene mostrato tra le fonti. |
| Completezza | Elenchi, classifiche e insiemi (Decina, Dischetto, Asta, Intruso) si generano **solo dove i dati sono completi** (tutte le partite o tutte le rose dell'ambito verificate), così una risposta giusta non può mai essere rifiutata. |
| Il Mercato | Nessuna fonte gratuita fornisce cifre di trasferimento verificabili su due famiglie: **0 istanze**, il gioco è escluso dal sorteggio finché non esisterà una fonte idonea. |
| Il Giramondo | Diventa la **"carriera mondiale"**: club di appartenenza a ogni Mondiale disputato, ruolo, numeri di maglia, nazionale. |
| Il Filo Rosso | Compagni = stessa rosa nello stesso torneo (rose verificate). |
| La Formazione | Ruoli dalle rose ufficiali (concordanti), senza stringa del modulo tattico (non verificabile). |
| L'Intruso | Il legame si sceglie sempre fra 4 opzioni, in tutte le modalità. |
| Argomento libero | Interpretazione **deterministica nel browser** (n-grammi + indice entità + anni/stagioni/decenni); espansione sul grafo dei collegamenti; nessun LLM. Se i dati del perimetro non bastano, l'argomento viene allargato e la schermata lo dichiara. |
| LLM | Nessun LLM né in gioco né nella pipeline (costo). L'archivio redazionale YAML resta disponibile per aneddoti inseriti a mano, sempre con due famiglie. |
| Database | Niente Postgres: la pipeline produce `data/build/graph.json` e i pacchetti statici in `apps/web/public/packs/`. |
| Più dispositivi | **Server Node gratuito in rete locale** (`pnpm server`) che serve app e stanze WebSocket sulla stessa porta. L'adattatore Cloudflare Durable Objects è rimandato. |

## 0.2 Contenuti della v1 (snapshot 2026-11-11)

Verifica incrociata sulle fasi finali dei Mondiali 1930–2026: 1002 risultati concordanti, 906 partite con marcatori concordanti (723 anche nei minuti), 1185 formazioni titolari concordanti, 9606 voci di rosa verificate, 8410 giocatori arricchiti da Wikidata (6654 con data di nascita referenziata). I dati in disaccordo tra le fonti sono esclusi.

| Gioco | Istanze |
|---|---|
| Tiro Secco | 6397 |
| Prima Pagina | 550 |
| Il Mercato | 0 |
| La Decina | 22 |
| Dal Dischetto | 2 |
| La Formazione | 37 |
| La Cassaforte | 1929 |
| Il Giramondo | 98 |
| Il Frame | 279 |
| L'Intruso | 87 |
| L'Asta | 143 |
| Il Filo Rosso | 81 |
| Il Mappamondo | 421 |
| La Maglia | 2500 |
| **Totale** | **12546** |

Limiti noti: Il Mercato è vuoto (nessuna fonte gratuita verificabile per le cifre); Dal Dischetto e La Formazione hanno poche istanze perché richiedono dati completi su un intero perimetro; circa 940 titoli Wikipedia non sono stati risolti in Wikidata per i limiti di richieste (restano con un identificativo Wikipedia e senza etichetta italiana).

---

## 1. Glossario

- **Partita**: sfida 1v1 composta da 4 giochi sorteggiati + la finale *La Cassaforte*.
- **Gioco / Prova**: uno dei 14 mini-giochi del catalogo (§4).
- **Schermo**: dispositivo orizzontale che mostra tabellone, grafiche, timer e punteggi.
- **Regia**: dispositivo verticale del conduttore (Modalità A).
- **Controller**: smartphone personale di uno sfidante (Modalità B a 3 schermi).
- **Grafo**: database canonico dei fatti calcistici verificati (§8.2).
- **Istanza di domanda**: domanda concreta prodotta da un generatore o dalla redazione, con risposta, fonti e metadati.
- **Famiglia di fonti**: gruppo di fonti non indipendenti tra loro (es. Wikipedia + Wikidata = famiglia *Wikimedia*).
- **ANNO**: valore del filtro "Domande sul calcio a partire dall'anno".
- **Argomento**: tema libero dichiarato da ciascun giocatore a inizio partita.
- **Copione**: testo narrativo (aneddoto/retroscena) associato alla risposta; letto dal conduttore in Modalità A, mostrato a schermo in Modalità B.

---

## 2. Modalità di gioco e dispositivi

### 2.1 Modalità A — Con Conduttore (Schermo + Regia)

- **Schermo** (PC/TV/monitor/tablet) — **solo orizzontale**. Mostra tabellone, prove, timer, indizi scoperti, punteggi. Unico dispositivo che riproduce audio.
- **Regia** (smartphone/tablet) — **solo verticale**. Telecomando del conduttore:
  - avvia/ferma timer, scopre indizi, avanza le fasi;
  - vede in anticipo soluzioni, varianti accettate e fonti;
  - valida le risposte date a voce (✓/✗) e assegna i punti previsti dalla prova;
  - legge il **Copione** di ogni risposta.
- Il conduttore è il giudice delle risposte a voce: è una regola del gioco, non una contestazione (P2).

### 2.2 Modalità B — Senza Conduttore

- **B1 · Schermo singolo**: un dispositivo (tablet/telefono/PC), orizzontale.
  - Giochi a turni: *pass-and-play* (ci si passa il dispositivo).
  - Giochi a prenotazione: dispositivo al centro, **doppio pulsante** ai bordi (§2.4).
  - Funziona **completamente offline** (pacchetti di domande pre-generati), tranne l'argomento libero (richiede rete, §7).
- **B3 · Tre schermi**: Schermo centrale orizzontale + 2 smartphone **verticali** come controller (pulsante, inserimento risposte).
- In Modalità B, dopo ogni risposta lo Schermo rivela esito e mostra automaticamente il **box Copione**.

### 2.3 Matrice dispositivi

| Configurazione | Ruoli | Orientamento |
|---|---|---|
| 1 dispositivo | Schermo (B1) | Orizzontale |
| 2 dispositivi | Schermo + Regia (A) | Orizz. + Vert. |
| 3 dispositivi | Schermo + 2 Controller (B3) | Orizz. + Vert. + Vert. |
| 4 dispositivi | Schermo + Regia + 2 Controller (A con pulsantiere) | Orizz. + Vert. ×3 |

### 2.4 Doppio pulsante su schermo singolo (B1)

- Due assetti selezionabili:
  - **Leggio** (default): dispositivo in piedi, giocatori affiancati. Pulsante P1 a sinistra, P2 a destra, tabellone al centro.
  - **Tavolo**: dispositivo piatto, giocatori uno di fronte all'altro. Pannelli laterali ruotati ±90°, contenuto centrale duplicato e specchiato.
- Pulsanti: fasce verticali a tutta altezza (~18–20% della larghezza ciascuna), colori neon dei giocatori.
- Input: `pointerdown`, `touch-action: none`, multitouch indipendente; tastiera fisica su PC (`A` = P1, `L` = P2).
- Arbitraggio: vince il `event.timeStamp` più basso; a parità esatta nello stesso frame decide il seme della partita (deterministico).
- **Falsa partenza**: pressione prima della comparsa dell'indizio ⇒ blocco di 1 s per quel giocatore.
- Dopo la prenotazione: indizi congelati, pulsante avversario spento/grigio, pannello di risposta orientato verso chi ha premuto, con **tastiera pixel integrata** (mai la tastiera di sistema: non copre lo schermo e non mostra suggerimenti del sistema operativo).
- Feedback: flash laterale + `navigator.vibrate` dove disponibile.

---

## 3. Struttura della partita

### 3.1 Setup

1. Modalità e dispositivi (§2), con abbinamento via codice stanza/QR (§12).
2. Nomi dei due giocatori.
3. **Filtro anno**: "Domande sul calcio a partire dall'anno: [ANNO]" (default: nessun filtro). Si applica secondo la tabella §3.3.
4. **Argomento libero** di ciascun giocatore (obbligatorio), con riga di riepilogo dell'interpretazione (§7).
5. Sorteggio dei 4 giochi (§5.2) — mostrato con animazione "slot machine".

### 3.2 Turni

- Gioco 1: inizia chi vince il sorteggio iniziale (lancio di moneta animato).
- Dal gioco 2 alla Cassaforte: **inizia chi è in svantaggio** nel punteggio generale. A parità inizia chi **non** ha iniziato il gioco precedente.
- I punteggi possono essere negativi.

### 3.3 Applicazione del filtro anno

Regola generale: **elenchi e classifiche usano statistiche di tutte le epoche e ignorano il filtro**; i giochi su singolo fatto o singola persona lo rispettano; i giochi su argomento libero lo ignorano.

| Gioco | Filtro | Criterio di ammissibilità |
|---|---|---|
| Tiro Secco | ✅ | Tutti i fatti della domanda hanno data ≥ ANNO (`year_min ≥ ANNO`) |
| Il Mercato | ✅ | Data del trasferimento ≥ ANNO |
| La Formazione | ✅ | Data della partita ≥ ANNO |
| Il Frame | ✅ | Data della partita ≥ ANNO |
| Il Mappamondo | ✅ | Data della partita/evento ≥ ANNO |
| La Maglia | ✅ | Stagione ≥ ANNO |
| Il Giramondo | ✅ | Il giocatore ha almeno una stagione ≥ ANNO (la carriera precedente si mostra comunque) |
| Il Filo Rosso | ✅ | Giocatori di partenza e arrivo con almeno una stagione ≥ ANNO; anelli intermedi di qualsiasi epoca |
| L'Intruso | ✅ | I 4 nomi hanno almeno una stagione ≥ ANNO |
| La Decina | ❌ | Insiemi di tutte le epoche |
| Dal Dischetto | ❌ | Top 10 di tutte le epoche |
| L'Asta | ❌ | Insiemi di tutte le epoche |
| Prima Pagina | ❌ | Argomento libero del giocatore |
| La Cassaforte | ❌ | Argomento libero del giocatore |

"Stagione ≥ ANNO": la stagione 2005/06 vale come 2005.

---

## 4. Catalogo dei giochi

I nomi dei giochi originali sono **provvisori** (§19). Ogni gioco ha un `id` stabile usato nel codice.
Default dei timer configurabili nelle impostazioni avanzate.

### 4.1 `tiro_secco` — Tiro Secco
- 4 domande a testa (8 totali), risposta multipla A/B/C/D, a turno alternato. Nessuna possibilità di rubare.
- Timer: 20 s.
- Punti: **+2** esatta, 0 errata.
- Fonte: archivio redazionale + estrattori dal grafo (§8.6). Distrattori **verificati come errati** dal grafo.

### 4.2 `prima_pagina` — Prima Pagina
- Un ritaglio di quotidiano vintage a testa (§11), generato da una partita **dell'argomento del giocatore**, con **2 elementi oscurati** di tipo diverso (marcatore, portiere, stadio, città, arbitro, allenatore, minuto…).
- Timer: 45 s per ritaglio.
- Punti: **+2 per elemento** indovinato (0 / +2 / +4).

### 4.3 `mercato` — Il Mercato
- **3 profili** per gioco. Un trasferimento legato alla Serie A (in entrata, uscita o interno) da indovinare con 6 indizi progressivi:

  | # | Indizio | Punti |
  |---|---|---|
  | 1 | Prezzo (valuta dell'epoca: lire o euro; formula: definitivo / prestito / prestito con obbligo) | 20 |
  | 2 | Sessione e anno | 15 |
  | 3 | Ruolo | 10 |
  | 4 | Nazionalità (bandiera pixel) | 5 |
  | 5 | Squadra cedente | 3 |
  | 6 | Squadra acquirente | 2 |

- Prenotazione col pulsante. **Un solo tentativo per giocatore per profilo.** Chi sbaglia è fuori per quel profilo (0 punti, nessuna penalità); l'avversario ha via libera e può farsi scoprire gli indizi successivi prima di rispondere, prendendo i punti dell'indizio corrente.
- Modalità A: il conduttore scopre gli indizi. Modalità B: un indizio ogni 8 s; dopo un errore l'avversario rimasto scopre gli indizi a comando.
- Tempo di risposta dopo la prenotazione: 10 s.
- Prezzo: mostrato arrotondato (0,5 mln € / 1 mld lire); ammesso solo se le due famiglie di fonti concordano entro ±5% (§8.3).

### 4.4 `decina` — La Decina
- Categoria con **14–17 risposte valide** (es. doppi ex di due club, stranieri di una nazionalità in un club). Si devono dire **10 risposte in totale**, una a testa a turno alternato.
- Timer: 30 s per turno.
- Punti: **+2** per risposta valida.
- Chiusura:
  1. alla **10ª risposta esatta complessiva** il gioco termina subito;
  2. errore o tempo scaduto: nessuna penalità, la parola passa all'altro;
  3. ogni giocatore ha **2 errori/scene mute** a disposizione: al secondo esce, e l'altro continua da solo;
  4. il gioco termina quando entrambi sono usciti o si arriva a 10.
- Ripetere un nome già detto (da chiunque) = errore.

### 4.5 `dischetto` — Dal Dischetto
- **Top 10 statistica di tutte le epoche** (es. marcatori di una nazionalità in Serie A). Il sistema dichiara il valore del 1° e del 10° posto ("Il 1° ha 55 gol, il 10° ne ha 22"), con definizione e data di aggiornamento.
- **5 tiri a testa**, a turno alternato, senza oltranza. Timer 30 s a tiro.
- Punti: **+2** per ogni nome nella Top 10 (max +10 a testa).
- Pari merito al 10° posto: basta uno dei nomi a pari merito; detto quello, la 10ª casella si chiude.
- Nome fuori classifica, già detto o tempo scaduto = tiro sbagliato.
- Audio: gol ⇒ "GOOOL!" + rete che si gonfia; errore ⇒ palo/traversa o fischi.

### 4.6 `formazione` — La Formazione
- Partita storica con i moduli di entrambe le squadre: **6 titolari visibili, 5 oscurati** per squadra.
- Chi è in svantaggio **sceglie quale squadra completare**; l'avversario completa l'altra. **60 s** a testa.
- Un nome vale se è uno dei 5 titolari oscurati di quella squadra (lo slot cliccato non deve coincidere).
- Punti: 5/5 = **15**, 4/5 = **10**, 3/5 = **5**, 2/5 = **3**, 1/5 = **2**, 0/5 = **0**.

### 4.7 `cassaforte` — La Cassaforte (finale, sempre presente)
- Ogni giocatore ha 3 domande sul **proprio argomento**: Facile, Media, Difficile. Ne deve giocare **2 su 3**.
- Ordine delle scelte: 1ª di chi è in svantaggio → 1ª dell'altro → 2ª del primo → 2ª del secondo.
- Timer 30 s; non si può passare.
- Punti:

  | Livello | Esatta | Sbagliata |
  |---|---|---|
  | Facile | +10 | −30 |
  | Media | +20 | −20 |
  | Difficile | +30 | −10 |

- La Difficile può chiedere **2 elementi** (es. due marcatori): se ne manca uno è errore (−10).
- Audio: errore ⇒ tromba triste.

### 4.8 `giramondo` — Il Giramondo
- **2 profili**. Carriera di un giocatore rivelata club per club, **dal più oscuro al più noto** (giovanili, prestiti… fino al club di massima fama), ogni indizio con club, anni, presenze e gol.
- Prenotazione col pulsante, **un tentativo per giocatore per profilo** (stesse regole del Mercato).
- Punti per indizio: **12 / 9 / 6 / 3 / 1** (carriere con più di 5 club: gli indizi in eccesso si accorpano nei primi).

### 4.9 `frame` — Il Frame
- 2 domande a testa, a turno: "Partita X, minuto Y: qual era il risultato?". Inserimento con due selettori numerici.
- Bonus: chi aveva segnato l'ultimo gol prima di quel minuto (se 0-0: domanda bonus non posta).
- Timer 30 s.
- Punti: risultato esatto **+3**; solo segno 1X2 corretto **+1**; bonus **+2**.
- Ammesse solo partite con minuti di **tutti** i gol concordanti tra due famiglie di fonti, e minuto Y lontano almeno 2' da ogni gol.

### 4.10 `intruso` — L'Intruso
- 3 domande a testa, a turno. 4 nomi: 3 condividono una proprietà nascosta, 1 no.
- Fase 1: individuare l'intruso (**+3**). Fase 2: indicare il legame tra i 3 (**+2**) — in Modalità B a scelta tra 4 legami, tutti generati dal grafo e **verificati come falsi** per il terzetto, tranne quello vero.
- Timer 30 s.
- Il generatore garantisce che **nessun'altra proprietà** del catalogo renda "intruso" un nome diverso (controllo di ambiguità).

### 4.11 `asta` — L'Asta
- 2 categorie (insiemi come La Decina, dimensione annunciata).
- Per ogni categoria: asta a rilanci alternati (inizia chi è in svantaggio), puntata da 1 a min(10, dimensione); "passo" assegna l'asta all'altro alla puntata corrente.
- Chi vince l'asta deve dire **tanti nomi validi quanto la puntata** in 60 s.
- Punti: successo **+puntata**; fallimento **+5 all'avversario**.

### 4.12 `filo_rosso` — Il Filo Rosso
- 1 sfida a testa: collegare il giocatore A al giocatore B con una catena di **compagni di squadra** (stesso club, stessa stagione, entrambi con almeno una presenza ufficiale).
- Timer 60 s; massimo 6 anelli.
- Punti: catena di lunghezza ottimale **+10**; ottimale +1 **+5**; valida più lunga **+2**; non valida 0. Lunghezza ottimale calcolata con BFS sul grafo dei compagni.

### 4.13 `mappamondo` — Il Mappamondo
- 3 domande a testa, a turno: "Dove si è giocata…?", con segnaposto su una mappa pixel.
- Distanza calcolata dalle coordinate dello stadio (fonte: Wikidata + seconda famiglia).
- Punti: < 25 km **+5**; < 100 km **+3**; < 300 km **+1**.
- Gioco naturale per i trabocchetti geografici (archetipo 6).

### 4.14 `maglia` — La Maglia
- 3 domande a testa, a turno: club + stagione + numero ⇒ chi lo indossava?
- Timer 30 s. Punti: **+3**.
- Numeri di maglia ammessi solo se concordanti tra due famiglie.

---

## 5. Bilanciamento e sorteggio

### 5.1 Budget punti (massimo teorico per giocatore)

| Gioco | Max a testa | Note |
|---|---|---|
| tiro_secco | 8 | |
| prima_pagina | 4 | |
| mercato | 60 | 3 profili × 20; tipicamente 10–25 |
| decina | 20 | se l'altro esce subito |
| dischetto | 10 | |
| formazione | 15 | |
| giramondo | 24 | 2 profili × 12 |
| frame | 10 | |
| intruso | 15 | |
| asta | 20 | |
| filo_rosso | 10 | |
| mappamondo | 15 | |
| maglia | 9 | |
| cassaforte | +50 / −50 | sempre decisiva |

### 5.2 Regole di sorteggio (4 giochi + Cassaforte)

- Pool: 13 giochi (tutti tranne `cassaforte`).
- Vincoli:
  - al massimo 1 tra {`mercato`, `giramondo`} (pulsante a indizi progressivi);
  - al massimo 1 tra {`decina`, `dischetto`, `asta`} (elenchi);
  - lo slot 1 è pescato tra i giochi rapidi {`tiro_secco`, `frame`, `maglia`, `intruso`, `mappamondo`};
  - un gioco è escluso se il pacchetto non ha abbastanza istanze ammissibili con il filtro corrente.
- Ordine: slot 1 vincolato, slot 2–4 casuali, `cassaforte` sempre per ultima.
- Sorteggio deterministico dal seme della partita (riproducibile nei test).

---

## 6. Torneo

- Da **4 a 12** giocatori. Dispositivo "Direzione Torneo" (qualsiasi ruolo Schermo) gestisce calendario e classifica.
- **Fase 1 — Classifica Generale**
  - ≤ 6 giocatori: girone all'italiana. > 6: abbinamenti svizzeri, K turni (default 3, configurabile), evitando ripetizioni.
  - I **punti segnati in ogni sfida si sommano** (anche negativi). Se il numero di sfide disputate non è uguale per tutti, si ordina per **media punti per sfida**.
  - Spareggi: vittorie → scontro diretto → miglior punteggio in una singola sfida → saldo totale della Cassaforte → sorteggio.
- **Fase 2 — Eliminazione diretta**: i **primi 4** vanno in semifinale (1ª–4ª, 2ª–3ª), poi **finale**. Ogni partita riparte da 0.
- Il filtro anno è fissato a livello di torneo. Ogni giocatore dichiara un argomento per ogni sfida.
- **Nessuna domanda si ripete** in tutto il torneo (insieme delle istanze usate a livello di torneo); inoltre storico per dispositivo delle istanze già viste.
- Persistenza server-side (codice torneo) + esportazione/importazione JSON.
- UI: classifica stile "HI-SCORE" tra una sfida e l'altra.

---

## 7. Argomento libero

### 7.1 Flusso

1. **Input libero** (testo). Esempi: "La Juve di Conte 2011/12", "Il Mondiale Under-20 del 2005", "L'Udinese degli anni 2000".
2. **Interpretazione → entità del grafo**
   - Prima un parser deterministico: dizionario di alias (club, competizioni, persone), espressioni per stagioni ("2011/12", "2011-12"), decenni ("anni 2000"), allenatori ("di Conte"), ruoli.
   - Se il parser non basta: un LLM (servizio `topic`, server-side) **sceglie solo tra ID candidati** recuperati dal nostro indice, con output strutturato e validato. L'LLM non produce fatti né testo mostrato al giocatore.
   - Output: `perimetro = {club?, nazionale?, competizione?, stagioni?, persone?, partite?}`.
3. **Riga di riepilogo** non bloccante: "Argomento: Juventus · Serie A 2011/12 · all. Antonio Conte". Il giocatore può riscrivere se l'interpretazione è sbagliata.
4. **Espansione nel grafo** finché ci sono abbastanza istanze per Prima Pagina (≥ 2 partite con tabellino completo) e Cassaforte (≥ 1 domanda per livello):
   - livello 0: fatti diretti del perimetro (partite, rose, marcatori, trasferimenti di quella stagione/competizione);
   - livello 1: persone e club collegati (es. giocatori che hanno disputato quel torneo) e i loro fatti nello stesso periodo;
   - livello 2: carriere successive/precedenti di quelle persone, trasferimenti, aneddoti redazionali etichettati con quelle entità.
5. **Generazione deterministica** nel perimetro espanso, con gli stessi generatori dei giochi e l'archivio redazionale.
6. **Unico rifiuto**: testo che non corrisponde ad alcuna entità calcistica ⇒ "Non riconosco un argomento calcistico, riscrivilo".

### 7.2 Garanzie

- Ogni fatto delle domande proviene da righe verificate del grafo o da istanze redazionali pubblicate (P1).
- Il filtro anno non si applica.
- **Esclusa** la generazione al volo da documenti trovati in quel momento (rischio di fraintendimento senza revisione).

### 7.3 Difficoltà nella Cassaforte

- Facile / Media / Difficile da percentili di **fama** dell'entità-risposta (§8.5) e dal tipo di domanda (es. Difficile = due elementi, o entità nel quartile più basso di fama).

---

## 8. Architettura dati

### 8.1 Fonti

| Livello | Fonti | Uso |
|---|---|---|
| **A — ingestione automatica** | Wikidata (CC0), Wikipedia it/en (dump/API, CC BY-SA), openfootball (pubblico dominio), StatsBomb Open Data (con attribuzione), dataset pubblici con licenza compatibile (es. derivati Transfermarkt pubblicati con licenza aperta: **verificare la licenza prima dell'uso**), RSSSF, Wikimedia Pageviews | Costruzione del grafo |
| **B — API con licenza** (budget approvato) | Provider commerciali di dati calcistici (es. API-Football, Sportmonks; scelta in M0) | Eventi al minuto, formazioni, trasferimenti; seconda famiglia automatica |
| **C — riferimento per verifica** | Transfermarkt, Sky Sport, UEFA.com, Lega Serie A, FIGC, FBref, worldfootball, archivi storici dei quotidiani | Consultate **pagina per pagina** nella coda di verifica (§9.3); URL salvato come fonte |

Vincolo: i siti di livello C che vietano l'accesso automatico **non vengono mai scaricati in massa** (termini d'uso + diritto *sui generis* sulle banche dati UE).

### 8.2 Grafo canonico (Postgres)

Entità principali (nomi indicativi):

- `person` — nome, cognome, nome d'arte, data e luogo di nascita, nazionalità, altezza, ruoli.
- `person_alias` — alias con fonte (etichette Wikidata multilingua, redirect Wikipedia, nomi riportati da fonti di livello B/C).
- `club`, `national_team`, `competition`, `season`, `stadium` (lat/lon, città).
- `match` — data, ora, giorno della settimana, competizione, fase, stadio, arbitro, risultato finale e parziale.
- `appearance` — persona, partita, squadra, titolare/subentrato, ruolo/slot del modulo, minuti, numero di maglia, capitano.
- `match_event` — gol, autogol, rigore, ammonizione, espulsione, sostituzione; minuto + recupero.
- `lineup_formation` — modulo per squadra e partita.
- `club_stint` / `national_stint` — persona, squadra, inizio, fine, prestito sì/no, presenze, gol.
- `coach_stint`.
- `squad_number` — persona, club, stagione, numero.
- `transfer` — persona, cedente, acquirente, data, sessione, formula, cifra, valuta.
- `fact_source` — per ogni campo usato nelle domande: fonte, famiglia, URL, data di consultazione, valore riportato.

Ogni riga/campo rilevante ha uno **stato di verifica**: `single_source` · `concordant` · `conflicting`.

### 8.3 Regola delle due famiglie (verifica)

- Un campo è **utilizzabile** in una domanda solo se è `concordant`: confermato da **almeno 2 famiglie di fonti indipendenti**.
- Famiglie: Wikimedia (Wikipedia + Wikidata), Transfermarkt (incl. dataset derivati), UEFA, Lega Serie A, FIGC, StatsBomb, openfootball, RSSSF, Sky Sport, FBref/Opta, worldfootball, ciascun provider di livello B.
- La seconda famiglia può arrivare:
  - automaticamente (livelli A/B);
  - dalla **coda di verifica** umana su una fonte di livello C (§9.3).
- Tolleranze ammesse (e dichiarate a schermo): cifre di trasferimento ±5% (mostrate arrotondate); nessuna tolleranza su date, minuti, risultati, nomi, numeri di maglia.
- Campo `conflicting` ⇒ escluso da tutte le domande che lo usano.
- Statistiche cumulative (presenze, gol): sempre con **definizione** (es. "Champions League, esclusi i turni preliminari") e **data di aggiornamento**.

### 8.4 Generatori deterministici

- Scritti in **Python** in `data/generators/`, usati sia offline (pacchetti) sia dal servizio `topic` (argomento libero).
- Ogni istanza contiene:
  - `id` = hash(`generator_id` + parametri), stabile tra rigenerazioni;
  - `generator_id`, `params`, `game_id`;
  - `prompt` (dati per la UI), `answer`, `accepted_answers` (alias da fonti);
  - `fact_ids[]` (righe del grafo usate) e relative fonti;
  - `year_min`, `year_max`, `difficulty`, `fame`, `snapshot_date`;
  - `script` (Copione), generato **solo da template** sui fatti dell'istanza.
- Generatori previsti per gioco:

  | Gioco | Generatore |
  |---|---|
  | mercato | trasferimenti con cifra concordante che toccano la Serie A |
  | decina, asta | intersezioni di insiemi (club×club, nazionalità×club, ruolo×club, competizione×nazionalità…) con 14–17 elementi (asta: 8–30) |
  | dischetto | classifiche statistiche × filtri; scarta pari merito caotici attorno al 10° posto |
  | formazione | partite con 22 titolari e moduli concordanti, ordinate per fama |
  | giramondo | carriere con ≥ 4 club concordanti |
  | frame | partite famose con tutti i minuti dei gol concordanti |
  | intruso | terzetti con proprietà condivisa + intruso, con controllo di ambiguità |
  | filo_rosso | coppie di giocatori con percorso minimo 2–4 nel grafo dei compagni |
  | mappamondo | partite/eventi con stadio geolocalizzato e concordante |
  | maglia | `squad_number` concordante |
  | prima_pagina | partite con tabellino completo concordante |
  | tiro_secco, cassaforte | estrattori di aneddoti (§8.6) + archivio redazionale (§9) |

### 8.5 Fama e difficoltà

- `fame(entità)` = combinazione di visite Wikipedia (Wikimedia Pageviews), numero di lingue in cui esiste l'articolo, presenze/partite ufficiali.
- Usata per: difficoltà, ordinamento delle partite "famose", soglia di ambiguità dei cognomi (§10.2), filtro di curiosità.
- Calibrazione successiva (M4+): statistiche anonime di risposta per istanza, se attivate.

### 8.6 Archetipi "da maniaco" ed estrattori

| # | Archetipo | Estraibile dal grafo? |
|---|---|---|
| 1 | Incrocio statistico / anomalia di calendario o compleanno | Sì (gol nel giorno del compleanno, partite in giorni insoliti, allenatori nati lo stesso giorno che si affrontano) |
| 2 | Frame invisibile di partite famosissime | Sì (parziali al minuto, durata di un vantaggio, portiere improvvisato) |
| 3 | Esordio oscuro / canto del cigno | Sì (prima/ultima partita, primo gol, cartellini nell'ultima partita) |
| 4 | Aneddotica, citazioni, extra-campo | No → archivio redazionale |
| 5 | Insiemi trasversali, doppi ex, top asimmetriche | Sì |
| 6 | Trabocchetti geografici | Parziale (coordinate) + redazione |

- **Filtro di curiosità**: punteggio = rarità del fatto × fama dei protagonisti; sotto soglia l'istanza non entra nei pacchetti.
- **Distrattori** (risposta multipla, legami dell'Intruso): ognuno deve essere **verificato come errato** dal grafo con dati `concordant`.

### 8.7 Pacchetti e runtime

- **Pacchetti statici** (JSON compresso) per gioco, versionati, serviti da CDN e messi in cache dalla PWA: abilitano B1 offline.
- Indici per filtro anno precomputati (`year_min`, prima stagione utile) per selezionare in O(1).
- **Servizio `topic`** (Python, API HTTP) con accesso in lettura a Postgres per l'argomento libero.
- Rigenerazione pacchetti a ogni aggiornamento del grafo; gli ID stabili permettono di mantenere lo storico "già viste".

---

## 9. Archivio redazionale (aneddoti)

### 9.1 Formato

Una domanda = un file YAML in `content/questions/<archetipo>/<id>.yaml`. Schema (valori di esempio fittizi):

```yaml
id: q-000123
game: [tiro_secco, cassaforte]       # giochi in cui può comparire
archetype: 4
status: published                     # draft | verified | published | retired
difficulty: hard                      # easy | medium | hard
question: "<testo della domanda>"
options: ["<A>", "<B>", "<C>", "<D>"] # solo per risposta multipla
answer: "<risposta>"
answer_entities: [Q12345]             # ID del grafo
accepted_answers: ["<variante da fonte>"]
entities: [Q12345, Q67890]            # per argomento libero e torneo
year_min: 2012
year_max: 2012
script: "<Copione: ogni affermazione deve essere coperta dalle fonti>"
claims:
  - text: "<affermazione atomica>"
    sources:
      - family: wikimedia
        url: "<url>"
        quote: "<breve citazione testuale>"
        accessed: 2026-11-11
      - family: uefa
        url: "<url>"
        quote: "<breve citazione testuale>"
        accessed: 2026-11-11
distractor_checks:                    # per ogni distrattore, prova che è errato
  - option: "<B>"
    graph_query: "<riferimento al controllo sul grafo>"
author: "<nome>"
reviewer: "<nome diverso dall'autore>"
```

### 9.2 Pipeline di produzione

1. **Selezione fonti** (Wikipedia, archivi, pagine ufficiali) per un tema.
2. **Estrazione assistita offline** con la Claude API: documenti con **Citations** attive ⇒ candidate con citazione testuale per ogni affermazione; strutturazione in un secondo passaggio con output strutturato (citations e output strutturato non si combinano nella stessa richiesta); elaborazione in lotti con la Message Batches API. Il modello si configura nella pipeline, mai a runtime nell'app.
3. **Validatore automatico** (CI):
   - schema valido; entità risolte nel grafo;
   - ogni `quote` presente testualmente nella fonte salvata;
   - risposta contenuta nelle citazioni;
   - date/risultati coerenti con il grafo;
   - **ogni affermazione con ≥ 2 famiglie**;
   - distrattori verificati come errati;
   - nel Copione, ogni nome proprio, numero e data compare nelle `claims`.
4. **Revisione umana** via Pull Request (revisore ≠ autore) ⇒ `verified` ⇒ `published`.
5. Solo `published` entra nei pacchetti.

### 9.3 Coda di verifica (seconda famiglia su livello C)

- Strumento interno (`tools/review`) che elenca i fatti `single_source` richiesti dai generatori, ordinati per "domanda bloccata".
- Per ogni fatto mostra il valore, la prima fonte e un link alla pagina di riferimento di livello C; il revisore registra "confermato/non confermato" + URL + data.
- È lavoro editoriale manuale, non scraping.

---

## 10. Risposte: confronto e aiuto ortografico

### 10.1 Normalizzazione

NFKD + rimozione diacritici; mappe speciali (ø→o, ł→l, ß→ss, đ→d, æ→ae, ı→i, œ→oe…); minuscole; rimozione punteggiatura; compattazione spazi; varianti di traslitterazione da fonte.

### 10.2 Accettazione (regole pubblicate nel regolamento)

- Basta il **cognome** o il **nome d'arte** (Kaká, Pato, Sheva se attestato da fonte).
- **Cognomi ambigui** — condivisi da ≥ 2 persone con fama sopra soglia nell'indice globale (es. Inzaghi, Maldini) — richiedono **sempre** anche il nome, in qualsiasi domanda (regola indipendente dalla domanda).
- Tolleranza sugli errori di battitura (distanza Damerau-Levenshtein sul token normalizzato): ≤ 1 per lunghezza ≤ 5; ≤ 2 per 6–10; ≤ 3 per > 10. Più chiave fonetica adattata all'italiano. Soglie da calibrare in M1 e poi **congelate** e pubblicate.
- **Controllo del vicino più prossimo**: si accetta solo se il bersaglio è la miglior corrispondenza dell'intero indice globale entro soglia.
- Esiti: accettata / rifiutata. Nessun esito "ambiguo" dipendente dal contesto.
- Risposte non-persona: selettori numerici (risultati, minuti), alias di città e club da fonte (Torino/Turin, Inter/Internazionale).
- Elenchi (Decina, Dischetto, Asta): confronto con l'insieme + rilevamento "già detto".

### 10.3 Aiuto ortografico "a zero informazione"

- **Correttore, non completatore**: nessun suggerimento a partire dalle prime lettere.
- Un suggerimento compare solo se l'input è quasi completo: `len(input) ≥ 0.8 × len(candidato)` **e** somiglianza normalizzata ≥ 0.85.
- **Funzione pura** di (testo digitato, indice globale): non riceve la domanda, il contesto, il gioco né il filtro anno.
- Indice globale: tutte le persone, club, città del grafo, di tutte le epoche; scaricato interamente sul client (nessuna query al server).
- Massimo 5 suggerimenti, ordinati per somiglianza e poi alfabeticamente; stile identico per tutti.
- Disattivabile dalle impostazioni.
- **Test obbligatorio in CI**: per un campione di input e un campione di domande diverse, l'output deve essere identico ⇒ informazione reciproca nulla.

### 10.4 Modalità A

La Regia mostra risposta ufficiale, varianti accettate e fonti; il conduttore valida a voce.

---

## 11. Prima Pagina — quotidiano vintage generato

- Testata **di fantasia** (provvisoria: *La Trivela Sportiva*), data, giorno della settimana.
- Blocchi: occhiello, titolo, sommario, cronaca (template su eventi del grafo), **box tabellino** (formazioni, marcatori con minuto, arbitro, stadio, città). **Nessun box pagelle** (i voti sono contenuti editoriali di terzi e non sono fatti verificabili).
- Layout: canvas virtuale 1600×900 scalato con `transform: scale()`; griglia CSS a 4–5 colonne con filetti; capolettera; `text-align: justify` + `hyphens: auto` (`lang="it"`).
- Carta: fondo rosa antico, rumore SVG (`feTurbulence`), vignettatura, sbavatura d'inchiostro leggera, piega centrale, micro-rotazione ±0.5°; incorniciato dentro la UI arcade.
- Font (Google Fonts, licenze aperte): serif condensato per i titoli, serif da testo per la cronaca, monospace per il tabellino.
- **Censura senza fughe**:
  - lo Schermo non riceve mai il testo nascosto prima della rivelazione;
  - lunghezza del rettangolo nero **a fasce** (corto/medio/lungo), non esatta;
  - ogni occorrenza dell'entità nascosta è sostituita in tutta la pagina;
  - template neutri (niente perifrasi rivelatrici).
- Rivelazione: cancellazione a scatti con `clip-path` (effetto pixel) + timbro + effetto sonoro.
- Regia: versione non censurata con elementi evidenziati.

---

## 12. Tempo reale, abbinamento, orientamento

### 12.1 Stanze

- Un **Durable Object per stanza** (Cloudflare), WebSocket con ibernazione.
- **Stato autorevole sul server**: il motore di gioco (`packages/engine`) gira nel DO; i client inviano **intenzioni** e ricevono **viste filtrate per ruolo**.
- Intenzioni principali: `JOIN`, `READY`, `START_GAME`, `REVEAL_CLUE`, `START_TIMER`, `BUZZ`, `SUBMIT_ANSWER`, `HOST_VALIDATE`, `CHOOSE_TEAM`, `CHOOSE_LEVEL`, `BID`, `PASS`, `NEXT`.
- Viste: `screen` (mai soluzioni prima della rivelazione), `host` (soluzioni, varianti, fonti, Copione), `controller` (solo i dati del proprio giocatore).
- B1 offline: lo stesso motore gira nel browser, senza server.

### 12.2 Abbinamento

- Lo Schermo crea la stanza: **codice di 4 lettere** (alfabeto senza caratteri ambigui) + **QR per ruolo** (`/join/ABCD?r=host|p1|p2`).
- Token di sessione in `localStorage` per rientrare dopo blocco schermo o perdita di rete; lo Schermo mostra la lobby con lo stato dei dispositivi.

### 12.3 Equità del pulsante tra dispositivi

- Sincronizzazione orologio stile NTP (più ping all'ingresso e periodici) ⇒ offset per client.
- Il client invia `performance.now()` della pressione convertito in ora server.
- Il server raccoglie le pressioni per **150 ms** dalla prima ricevuta e assegna al timestamp corretto più basso.

### 12.4 Orientamento e schermo

- Overlay bloccante "Ruota il dispositivo" (pixel art animata) via `@media (orientation: …)`: Schermo solo orizzontale; Regia e Controller solo verticali.
- `screen.orientation.lock()` dove supportato (Android a schermo intero); campo `orientation` nel manifest PWA.
- Wake Lock API per evitare lo spegnimento.
- Sviluppo in rete locale: HTTPS obbligatorio per Wake Lock/Service Worker su IP di LAN ⇒ certificati locali (`mkcert`) o tunnel HTTPS.

---

## 13. Audio

- **Sblocco**: la schermata "PREMI START" è il gesto che sblocca l'`AudioContext`. Su iOS: Audio Session API impostata su riproduzione + avviso sull'interruttore silenzioso.
- **Musica dinamica a livelli**: tracce chiptune composte in un tracker ed esportate in livelli (base, percussioni, tensione). Timer attivo ⇒ entra il livello percussioni; Cassaforte ⇒ entra il livello tensione. Transizioni con dissolvenza a tempo.
- **Effetti sintetizzati** (procedurali, stile sfxr): bip menu, comparsa indizio, pulsante, risposta esatta, risposta errata, tic del timer (accelera negli ultimi 5 s), sirena tempo scaduto, slot machine del sorteggio.
- **Tromba triste**: 4 note cromatiche discendenti sintetizzate (dente di sega + filtro "wah", vibrato sull'ultima).
- **Campioni** (registrati in proprio o CC0, passati in bitcrusher): "GOOOL!", rete che si gonfia, palo/traversa, fischi dello stadio.
- Mix: ducking della musica sugli effetti; volumi separati musica/effetti + muto, salvati in `localStorage`; pausa con scheda in background.
- In Modalità A e B3 suona **solo lo Schermo**; Regia e Controller usano vibrazione e clic minimi.

---

## 14. Estetica e UI

- Arcade anni '80: pixel art, colori neon su fondo scuro, scanline opzionali (disattivabili).
- Font pixel con licenza OFL (es. "Press Start 2P" per titoli/punteggi, "VT323" per testi lunghi).
- Token colore come variabili CSS: fondo, testo, neon P1, neon P2, accento, successo, errore, avviso.
- `image-rendering: pixelated` per gli sprite; animazioni a scatti (`steps()`).
- Accessibilità: contrasto AA sui testi, `prefers-reduced-motion` (niente flash e scanline), dimensioni minime dei target touch 48 px.
- Box **Copione**: riquadro "terminale" che scrive il testo carattere per carattere (salto immediato al tocco).

---

## 15. Stack e struttura del repository

| Strato | Scelta |
|---|---|
| Linguaggi | TypeScript (app, motore, realtime); Python 3.12 (dati, generatori, servizio topic) |
| Monorepo JS | pnpm workspaces |
| Frontend | React + Vite, PWA (`vite-plugin-pwa`), CSS con variabili |
| Motore | `packages/engine`: TS puro, deterministico, RNG con seme, nessun accesso a orologio/rete |
| Tempo reale | Cloudflare Workers + Durable Objects |
| Hosting web | Cloudflare |
| Database grafo | Postgres gestito (provider da scegliere in M0) |
| Pipeline dati | Python + `uv`, DuckDB per le trasformazioni, notebook per analisi di qualità |
| Servizio topic | Python (API HTTP) con accesso in lettura a Postgres; hosting da scegliere in M0 |
| Archivio redazionale | YAML in `content/`, validatore in CI, revisione via PR |
| Test | Vitest (motore, matcher), Playwright con più contesti browser (Schermo + Regia + Controller), pytest (dati) |
| CI | GitHub Actions |

```
trivela/
├─ apps/
│  ├─ web/              # PWA: Schermo, Regia, Controller, B1
│  └─ realtime/         # Worker + Durable Objects (stanze, tornei)
├─ packages/
│  ├─ engine/           # 14 giochi, punteggi, turni, sorteggio, torneo
│  ├─ matcher/          # normalizzazione, accettazione, aiuto ortografico
│  ├─ ui-arcade/        # componenti pixel, Prima Pagina, mappa, tastiera
│  ├─ audio/            # musica a livelli, effetti sintetizzati
│  └─ protocol/         # tipi condivisi: intenzioni, viste, pacchetti
├─ data/
│  ├─ ingest/           # connettori fonti livello A/B
│  ├─ graph/            # schema Postgres, migrazioni, riconciliazione
│  ├─ generators/       # generatori per gioco + estrattori archetipi
│  ├─ packs/            # build dei pacchetti
│  └─ notebooks/        # qualità e copertura dati
├─ services/topic/      # API argomento libero
├─ content/             # archivio redazionale YAML
├─ tools/review/        # coda di verifica e revisione
├─ SPEC.md · CLAUDE.md · README.md
└─ .github/workflows/
```

---

## 16. Qualità e test

- **Motore**: test unitari per ogni gioco (punteggi, chiusure, turni, casi limite), test del sorteggio con seme, test del torneo (classifica, spareggi, media).
- **Matcher**: suite di nomi difficili (Szczęsny, Çalhanoğlu, Kvaratskhelia, Bjelanović…), cognomi ambigui, **test di proprietà "zero informazione"** dell'aiuto ortografico.
- **Realtime**: test e2e Playwright con 3–4 contesti (Schermo, Regia, P1, P2): abbinamento, rientro, arbitraggio del pulsante, **nessuna soluzione nella vista Schermo prima della rivelazione** (ispezione dei messaggi).
- **Dati**: test sui generatori (ogni istanza usa solo campi `concordant`), report di copertura per anno e per competizione, validatore dell'archivio redazionale.
- **UI**: screenshot di riferimento per Prima Pagina e schermate principali; overlay di orientamento.

---

## 17. Licenze e attribuzioni

- Wikidata: CC0. Wikipedia: CC BY-SA — salvare solo brevi citazioni + URL; pagina "Crediti" con attribuzioni.
- StatsBomb Open Data: attribuzione secondo i loro termini.
- Dataset di terzi e API di livello B: usare solo secondo licenza; documentare la licenza di ogni connettore in `data/ingest/<fonte>/LICENSE.md`.
- Font e campioni audio: solo licenze aperte (OFL, CC0) o produzione propria.
- I fatti calcistici non sono oggetto di diritto d'autore, ma le banche dati sì (diritto *sui generis* UE): niente estrazioni sostanziali da fonti che non lo consentono.

---

## 18. Roadmap

| Milestone | Contenuto | Criteri di accettazione |
|---|---|---|
| **M0 — Fondamenta e dati** | Scaffolding monorepo + CI. Schema del grafo su Postgres. Ingestione livello A (Wikidata, Wikipedia, openfootball, StatsBomb) per la Serie A e le coppe europee. Scelta provider livello B. Regola delle due famiglie. Generatori: `mercato`, `dischetto`, `decina`, `giramondo`, `maglia`. | ≥ 1.000 istanze generate con soli campi `concordant`; report di copertura per anno; revisione a campione senza errori. |
| **M1 — Motore + B1** | `packages/engine` con sorteggio e turni; `tiro_secco` da un primo archivio di ~150 domande pubblicate; matcher + aiuto ortografico; doppio pulsante; UI arcade di base; audio di base; filtro anno. | Partita completa giocabile offline su tablet; test "zero informazione" verde. |
| **M2 — Multi-dispositivo + argomento libero** | Stanze su Durable Objects, QR, rientro, orientamento; Modalità A e B3; `formazione`, `prima_pagina`, `cassaforte`; servizio `topic` con espansione nel grafo. | Serata reale PC + Regia + 2 telefoni; argomenti di prova ("La Juve di Conte 2011/12", "Il Mondiale Under-20 del 2005", "L'Udinese degli anni 2000") generano Prima Pagina e Cassaforte. |
| **M3 — Contenuti su scala** | Pipeline redazionale (estrazione con citazioni, validatore, PR); coda di verifica livello C; estrattori archetipi 1/2/3/5; filtro di curiosità; `frame`, `intruso`, `mappamondo`. | ≥ 1.000 aneddoti pubblicati; ogni gioco del pool ha istanze per ANNO ∈ {1990, 2000, 2010}. |
| **M4 — Completamento** | `asta`, `filo_rosso`; Torneo completo; musica dinamica a livelli; rifinitura PWA; calibrazione difficoltà. | Torneo da 8 giocatori in una serata senza interventi tecnici. |

---

## 19. Questioni aperte

1. Nomi definitivi dei 7 giochi originali (provvisori: Tiro Secco, Prima Pagina, Il Mercato, La Decina, Dal Dischetto, La Formazione, La Cassaforte) e della testata della Prima Pagina.
2. Provider Postgres e hosting del servizio `topic`.
3. Provider di livello B.
4. Chi compone la redazione/revisione (autore ≠ revisore).
5. Licenza del progetto (privato/proprietario o open source).
6. Telemetria anonima per la calibrazione della difficoltà: sì/no.
7. Eventuale verifica del marchio "TRIVELA" in caso di pubblicazione sugli store.
