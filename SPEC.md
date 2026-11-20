# TRIVELA — Specifica di prodotto e architettura

> Documento di riferimento del progetto. Ogni decisione di design o architettura che cambia va aggiornata qui **prima** di essere implementata.
> Stato: **v15 — 10 giochi, stanze senza server, tastiera di gioco, timer a scelta, interfaccia «tramonto pixel» pensata per il telefono in orizzontale (vedi §0.6, che prevale sulle sezioni precedenti). Vincolo: tutto gratuito.**

---

## 0. Visione e principi non negoziabili

**TRIVELA** (trivela + trivia) è un quiz calcistico arcade **1 contro 1** per veri maniaci del calcio, giocabile su qualsiasi combinazione di dispositivi (1, 2 o 3 schermi), con estetica pixel-art anni '80, colonna sonora chiptune ed effetti 8-bit. Le partite possono essere inserite in un **Torneo** con Classifica Generale.

Principi che nessuna feature può violare:

| # | Principio | Conseguenza pratica |
|---|---|---|
| P1 | **Zero fatti non verificati.** Nell'app entra solo ciò che è calcolato su dati affidabili e coerenti. | Una sola fonte uniforme con controlli di completezza (§0.5, §0.6). Nessun LLM, né in gioco né nella pipeline. |
| P2 | **Niente è contestabile.** | Nessun pulsante "contesta", "segnala errore" o override tra giocatori. Regole di accettazione fisse e pubblicate (§10). Statistiche sempre con definizione e data di aggiornamento. |
| P3 | **L'aiuto ortografico non dà alcuna informazione sulla risposta.** | È un correttore, non un completatore; è funzione pura del solo testo digitato (§10.3). Proprietà testata in CI. |
| P4 | *(rimosso con la v5: l'argomento a piacere non esiste più, §0.6)* | — |
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

## 0.3 Decisione v2: una fonte autorevole per dominio (sostituisce la regola delle due famiglie)

Decisione del committente (novembre 2026): la doppia fonte concorde era troppo restrittiva. Da ora:

| Dominio | Fonte autorevole | Copertura reale |
|---|---|---|
| Trasferimenti e cifre, altezze, date di nascita, presenze, tabellini (formazioni, moduli, marcatori al minuto, arbitri, capitani, numeri) | **Transfermarkt** (dataset `dcaribou/transfermarkt-datasets`, file DuckDB su R2) | partite/eventi/presenze **2012/13 – 2025/26** (+ Mondiali); trasferimenti con cifra quasi tutti dal 2004 |
| Fasi finali dei Mondiali 1930–2026 | openfootball + Wikipedia (già verificati in v1) | completa |
| Nazionali: risultati 1872 – oggi | **martj42/international_results** (CC0) | completa per i risultati; i marcatori sono incompleti nei primi decenni e non si usano per classifiche "di sempre" |
| Stagione in corso 2026/27 | **open-matchday** (aggiornato ogni giorno; uso non commerciale) | risultati, primo tempo, calendario (i minuti dei gol non indicano il marcatore) |
| Etichette italiane, luogo di nascita e coordinate | **Wikidata** in blocco via SPARQL (proprietà P2446 = ID Transfermarkt) | giocatori con valore di mercato rilevante |
| Aneddoti (`content/`) | una fonte citata con frase testuale, **verificata automaticamente** (frase presente nella pagina, oppure query sui dati) | 10 pubblicate, 11 in bozza |

Regole che restano: si scartano i record con campi mancanti o incompleti (es. partite in cui gli eventi-gol non tornano con il risultato); classifiche e insiemi **dichiarano sempre il perimetro** (competizione e stagioni), così le risposte non sono contestabili; nessun dato inventato.

Il "1990" indicato come inizio per le statistiche granulari non è raggiungibile con le fonti gratuite disponibili: il dataset Transfermarkt parte dalla stagione 2012/13. Per il periodo precedente restano i Mondiali (verificati) e i risultati delle nazionali.

**Aggiornamento dei dati (v11.1):** solo a mano, con `pnpm data:sync` (riscarica il dataset se è cambiato e rigenera i pacchetti), in una sessione dedicata. La GitHub Action settimanale `sync-data.yml` è stata **tolta**: il dataset è fermo al **6 luglio 2026** e quella data è scritta nei testi («dati al 6 luglio 2026»), nei limiti dei generatori (trasferimenti fino al 2026-07-06) e in `SNAPSHOT`. Un aggiornamento automatico avrebbe prodotto domande con fatti più recenti della data dichiarata (un «non ha mai segnato» falso dopo un gol di settembre) e avrebbe rimescolato i pacchetti di Asta, Formazione e Giramondo, che la rigenerazione cambia senza motivo. Prima di aggiornare il dataset vanno spostate tutte queste date insieme e ricontrollati i pacchetti.

Contenuti dopo la v2:

| Gioco | Istanze |
|---|---|
| tiro_secco | 8389 |
| prima_pagina | 1681 |
| mercato | 1740 |
| decina | 40 |
| dischetto | 66 |
| formazione | 637 |
| cassaforte | 5520 |
| giramondo | 867 |
| frame | 1212 |
| intruso | 338 |
| asta | 245 |
| filo_rosso | 281 |
| mappamondo | 1221 |
| maglia | 5000 |
| **Totale** | **27237** |

## 0.4 Decisione v3: fonti storiche, domande inedite, notorietà, caricamento a richiesta

**Fonti aggiunte** (tutte gratuite, su GitHub):

| Fonte | Uso | Limiti verificati |
|---|---|---|
| `ewenme/transfers` (Transfermarkt, 1992–2022) | Il Mercato 1992–2011 | serve la nazionalità dai profili salimt: abbinamento nome + anno di nascita, scartati i casi ambigui |
| `salimt/football-datasets` (Transfermarkt) | Il Giramondo (carriere storiche), nazionalità, valore di mercato massimo | presenze stagionali, presenze in Nazionale e compagni di squadra **incompleti** (es. Serie A 1995/96 con 236 gol totali; Baggio, Riva, Meazza, Piola assenti dalle presenze azzurre; nessun dato compagni per Totti/Maldini/Zanetti): **non usati per classifiche** |
| StatsBomb Open Data | finali di Champions 1999–2019, Europei 2020/2024 (fase a eliminazione), Serie A 1986/87 e 2015/16 (big match) | solo le partite pubblicate da StatsBomb |
| `jalapic/engsoccerdata` | calendario Serie A 1929–2011: "unica partita giocata di …" | solo risultati e date |
| `jfjelstul/worldcup` | CT e premi individuali di ogni Mondiale | — |

**Domande inedite.** L'archivio `content/` è stato svuotato. Un filtro (`postprocess.SHOW_FINGERPRINTS`) scarta ogni domanda generata che riproduce i casi già visti negli episodi usati come ispirazione.

**Filtro notorietà.** Un giocatore può essere protagonista di una domanda solo se: valore di mercato massimo ≥ 10 milioni €, oppure ≥ 80 presenze o ≥ 20 gol tra Top 5 campionati e Champions League, oppure ≥ 15 sitelink su Wikidata. Per La Maglia servono anche ≥ 25 partite con quel numero (≥ 10 per i numeri iconici 7, 9, 10, 11, 45, 77, 80, 88, 99); si tengono le 1.200 domande sui giocatori più noti.

**Caricamento a richiesta.** I dati sono in `apps/web/public/data/`: `manifest.json`, `entities.json`, `topics.json`, `teammates.json` e `games/<id>.json`. Lo Schermo scarica all'avvio solo manifest, indice e argomenti; dopo il sorteggio scarica i 5 giochi estratti. Regia e pulsantiere non scaricano dati di gioco (le risposte le giudica il server).

**GitHub Pages.** `.github/workflows/pages.yml` pubblica `apps/web/dist` a ogni push su `main`. Su Pages è disponibile la modalità a schermo singolo; la modalità multi-dispositivo richiede il server locale (WebSocket).

| Gioco | Istanze |
|---|---|
| tiro_secco | 9174 |
| prima_pagina | 1625 |
| mercato | 1401 |
| decina | 39 |
| dischetto | 64 |
| formazione | 751 |
| cassaforte | 5761 |
| giramondo | 1542 |
| frame | 1325 |
| intruso | 316 |
| asta | 241 |
| filo_rosso | 280 |
| mappamondo | 1220 |
| maglia | 1200 |
| **Totale** | **24939** |

## 0.5 Decisione v4: una sola fonte (Transfermarkt)

Decisione del committente (novembre 2026): semplificazione radicale. **Tutti i giochi usano solo il dataset Transfermarkt** `dcaribou/transfermarkt-datasets`. Le fonti di §0.3–§0.4 (openfootball, Wikipedia/Wikidata, StatsBomb, martj42, open-matchday, engsoccerdata, Fjelstul, ewenme, salimt) e l'archivio redazionale `content/` sono stati rimossi. Questa sezione prevale su §0.1–§0.4.

- **Copertura:** stagioni 2012/13–2025/26 di Serie A, Premier League, LaLiga, Bundesliga, Ligue 1, Champions, Europa e Conference League, Coppa Italia e Supercoppe; Mondiali 2006–2026 (gironi 2026); Europei 2008–2024; trasferimenti con cifra (quasi tutti dal 2004). Si perdono gli anni precedenti, la Serie B, le amichevoli e qualificazioni delle Nazionali e la stagione 2026/27 (il dataset si ferma al 6 luglio 2026).
- **Coerenza:** si scartano le partite in cui gli eventi-gol non tornano con il risultato (nel dataset i rigori delle serie finali sono sommati ai gol).
- **Il Mappamondo** è vuoto: Transfermarkt non fornisce coordinate. Il gioco è escluso dal sorteggio finché non si decide una fonte geografica.
- **Filtro notorietà:** valore di mercato massimo ≥ 10 mln € oppure ≥ 80 presenze o ≥ 20 gol tra Top 5 campionati e Champions League (il criterio sui sitelink Wikidata cade con Wikidata).
- **SofaScore:** valutato e scartato. L'API non è pubblica e scaricarla richiederebbe di aggirare la protezione anti-bot. Si potrà integrare solo con una licenza.

| Gioco | Istanze |
|---|---|
| tiro_secco | 1662 |
| prima_pagina | 1242 |
| mercato | 1306 |
| decina | 17 |
| dischetto | 62 |
| formazione | 553 |
| cassaforte | 3892 |
| giramondo | 763 |
| frame | 1064 |
| intruso | 231 |
| asta | 98 |
| filo_rosso | 196 |
| mappamondo | 0 |
| maglia | 1200 |
| **Totale** | **12286** |

---

## 0.6 Decisione v5/v6/v7: 8 giochi, niente argomento, round brevi, stanze senza server

> **v15** (novembre 2026):
> - **Le Statistiche** e **La Stagione dei Campioni** non sono più giochi: la prima era troppo difficile (un nome da scrivere partendo da tre numeri), la seconda aveva buone domande ma non bastava per un gioco intero. Le loro domande sono ora **tre famiglie del Tiro Secco** (§4.1): «Di chi è questa stagione?» (la scheda, ora a quattro risposte e solo con stagioni memorabili), «Stagione dei campioni» e la nuova «Chi ne ha fatti di più?» (gol, assist, gialli). I giochi tornano **10**; §4.12 e §4.13 restano vuoti;
> - il Tiro Secco si sorteggia **per famiglie**: le 4 domande di una partita sono di 4 famiglie diverse (§4.1), al posto del peso fisso del vero o falso;
> - **lancio della moneta animato** all'inizio della partita (§3.2) e **turno ben visibile** (§3.9);
> - Home: il filtro anno non invade più la colonna accanto sui telefoni; i conteggi («5 giochi sorteggiati su 10») si leggono dal catalogo.

> **v14** (novembre 2026), Fase 1 dell'espansione dei minigiochi, tutto sul dataset esistente:
> - tre giochi nuovi: **Le Statistiche** (indovina il calciatore dalla scheda di una sua stagione di campionato, §4.12), **La Stagione dei Campioni** (una competizione, una stagione: campioni, capocannonieri, assist, porte inviolate, club, §4.13) e **Le Bandiere** (la squadra dalle bandiere degli undici titolari, viste per 5 secondi, §4.14). I giochi sono **12**; la Partita Classica ne sorteggia sempre 5 (§5.2); Sfida Rapida e Allenamento li offrono tutti;
> - Tiro Secco: nuova categoria **Trasferimento vero o falso** (§4.1); *Il Mercato* non cambia;
> - **catalogo dei giochi estendibile** in `apps/web/src/rules.ts` (`GAME_CATALOG`: nome, nome breve, colore, regole): menu, selettori, schede di presentazione e barra dei punti leggono da lì; gli id restano quelli di `GAME_IDS` (`packages/protocol`). `tools/shots.mjs` legge gli id dal protocollo;
> - bandiere SVG dal pacchetto open source `flag-icons` (MIT): è un asset grafico, non una fonte di fatti; si copiano solo quelle usate (`tools/flags.mjs`) e non entrano nella precache (§12.7).

> **v13** (novembre 2026): nuovo gioco **Testa a Testa** (§4.11): un duello su una catena di giocatori e una statistica. A turno si dice se lo sfidante ne ha PIÙ o MENO, +1 per risposta giusta; chi sbaglia per primo regala +3 all'avversario. La catena diventa sempre più difficile. I giochi sono **9**; se ne sorteggiano sempre 5 (§5.2).

> **v11** (novembre 2026): *Il Mercato* pesca i trasferimenti di **tutti e cinque i campionati**, rispettando i campionati scelti (cedente o acquirente in quel campionato al momento del trasferimento), e circa **4 su 5 valgono almeno 20 milioni**; quelli più economici sono più rari e solo di giocatori noti (§4.3).

> **v10** (novembre 2026): il **Tiro Secco** cambia il modo di scegliere le opzioni sbagliate, che si scartavano a colpo d'occhio: ora sono **famose quanto la risposta**, sono **«quasi riusciti»** dove i dati lo permettono, e **ogni fatto raro diventa una sola domanda** (§4.1, §4.2). *La Maglia*: una domanda per maglia e al massimo due per giocatore; il motore non chiede due volte della stessa persona nella stessa partita e la fa riposare per 6 partite su quel dispositivo (§4.10, §5.3). La **tastiera di gioco** dice se il nome appena inviato è giusto o sbagliato (§10.4), con una vibrazione (§12.9). Valutata la fonte *GOAL API* (`goal-api.com`, alternativa con licenza a SofaScore): **non adottata per ora**, decisione rimandata. Non ha i voti dei giocatori e la Serie A è coperta molto meno che dal dataset.

> **v8.1** (novembre 2026): nel Tiro Secco le opzioni sbagliate dei giochi di nomi sono **cognomi veri di calciatori** della stessa famiglia (Gallo · Gatto · Cavallo · Leone), non più parole finte; i record usano distrattori **dello stesso ruolo**; nuovo record «subentrato in gol entro 2 minuti» (§4.1, §4.2). Richiesta di usare le API interne di SofaScore aggirando Cloudflare: **non accolta**, resta valida la decisione di §0.5 (servirebbe una licenza).
>
> **v8** (novembre 2026): TRIVELA si **installa come app** a tutto schermo (§12.7); con due telefoni senza Regia «Avanti» e «Prossimo indizio» si decidono **in due** (§12.8); vibrazioni e aree di tocco da 48 px (§12.9); tocchi **3D voxel**: il pulsantone dei telefoni, il pallone delle attese, la coppa del vincitore (§14.2).
>
> **v7** (novembre 2026), decisioni del committente:
> - *L'Anomalia Statistica* non è più un gioco: i suoi record rari sono una famiglia di domande del **Tiro Secco**, insieme ai nuovi **giochi di nomi** (§4.1). Restano **8 giochi**; il sorteggio cambia di conseguenza (§5.2).
> - **Lessico dei cognomi** (`data/trivela_data/lexicon.py`): elenco scritto a mano di parole e del loro significato (animali, personaggi storici, città, colori, mestieri…), più le parole usate come opzioni sbagliate. **Non è una fonte di fatti calcistici**: dice solo che cosa vuol dire una parola; presenze e gol restano calcolati sul dataset. **v7.1**: le opzioni sono cognomi (Gatti · Cani · Topi · Salmoni); quelli sbagliati sono parole che il dataset dimostra non essere il nome di nessun giocatore della competizione (§4.1).
> - *La Formazione* solo su **partite iconiche** (§4.6); nuove Top 10 per *Dal Dischetto* (§4.5).
> - **Timer a scelta** e **tempo extra di 10 secondi** per finire di scrivere (§3.8).
> - **Tastiera di gioco** sui dispositivi touch al posto di quella di sistema (§10.4): sostituisce la barra di scrittura in alto della v5.
> - Home con le impostazioni in vista (§0.7); telefono in orizzontale, aree sicure e rotazione (§12.6).
> - I punti qui sotto che parlano di 9 giochi o dell'Anomalia come gioco sono storici.
>
> **v6.1** (novembre 2026): *L'Anomalia Statistica* ricalibrata su record **davvero rari** (§4.2); corretto il bug della barra superiore con punteggi duplicati (§14.1); animazioni a 60 fps (§14.1).
>
> **v6** (novembre 2026): **Il Frame è stato rimosso del tutto** (dati, generatore, motore, interfaccia, test): restano **9 giochi** (§4). Nuova identità visiva «tramonto pixel» con menu principale rifatto (§0.7), uscite discrete con conferma (§3.7), effetti di «juiciness» (§14.1), telefoni verticali senza scorrimento per le azioni principali (§12.5). I punti che nominano *Il Frame* più sotto sono storici e non più in vigore.
>
> **v5.2** (novembre 2026): nuove modalità **Sfida Rapida** e **Allenamento** (§3.5); il correttore tollera refusi e suoni simili (§10.3); in tutti i giochi una risposta sbagliata compare **in rosso** sullo Schermo (§3.6); musica **ambient** morbida (§13).
>
> **v5.1** (novembre 2026): *Prima Pagina* sostituita da *L'Anomalia Statistica* (§4.2); *Il Frame* rifatto sulla cronologia di partite iconiche, 1 partita a testa (§4.8); *La Maglia* senza numeri banali e con priorità alle anomalie (§4.10); controlli del tempo per la Regia (§12.1); correttore che riconosce il nome di battesimo raro (§10.3).

Decisione del committente (novembre 2026). Questa sezione prevale su tutte le precedenti.

**Giochi e partita**

- **Rimossi**: l'argomento a piacere, *La Cassaforte*, *L'Intruso*, *Il Filo Rosso*, *Il Mappamondo*. *Il Frame* è stato rimosso in v6. Restano 9 giochi (§4); 8 dalla v7.
- Una partita è fatta di **5 giochi sorteggiati su 8** (su 9 fino alla v6); non c'è più un gioco finale fisso. Vince chi ha più punti.
- **Round brevi**: al massimo 2 domande a testa per gioco (Tiro Secco, Anomalia, Maglia); 2 profili per i giochi a prenotazione (Mercato, Giramondo); 2 categorie per l'Asta; **una sola** lista per Decina e Dischetto, una partita per la Formazione, una prima pagina a testa.
- **La Maglia** è capovolta: si mostrano giocatore, squadra e stagione e si risponde con il **numero** (tastierino numerico).
- **Il Giramondo** mostra la carriera in **ordine cronologico**, non più dal club meno noto al più noto. Ogni squadra compare **una volta sola, al primo arrivo**, con l'anno (es. «2019 Real Madrid», «2019 Maiorca», «2020 Villarreal»): i ritorni alla squadra già elencata (fine prestito, secondo periodo) sono omessi, perché nel dataset non c'è l'indicazione del prestito e la sequenza completa («Real Madrid → Maiorca → Real Madrid → Villarreal…») risultava illeggibile. Sullo schermo ogni passaggio è un riquadro con l'anno.
- **Campionati a scelta** (§3.4): all'inizio di sfida, sala d'attesa e torneo si scelgono i campionati da cui pescare le domande.
- **Dal Dischetto**: se più giocatori sono a pari merito all'ultimo posto utile, valgono finché restano posti nella Top 10 (es. 7 nomi a pari merito dal 6° posto: ne valgono 5).
- Nel sorteggio delle domande i **tipi di domanda si alternano** (campionamento uniforme per generatore), così una partita non è dominata dal tipo con più istanze. Eccezione (v11): i generatori del Mercato si pescano con un peso (§4.3).

**Dati**

- Almeno **1000 istanze per gioco** (verificato dai test: `data/tests/test_packs.py`). Stato v7: tiro_secco 3600, mercato 1300, decina 1400, dischetto 1336, formazione 1400, giramondo 1400, asta 1500, maglia 1500 (13.436 in tutto).
- Fonte unica Transfermarkt (§0.5) con uno **strato di fatti verificati**: una partita entra nelle statistiche solo se gli eventi-gol tornano con il risultato (rigori delle serie finali ricalcolati a parte) e, dove serve, se presenze e formazioni sono complete (11 + 11). Classifiche ed elenchi si calcolano solo su finestre (competizione, squadra, stagioni) interamente coperte, e le dichiarano nel titolo.
- **Unica eccezione alla fonte unica**: le **date di nascita degli allenatori**, che Transfermarkt non fornisce nel dataset, vengono da **Wikidata** (CC0; allenatori con identificativo Transfermarkt P2447, abbinati solo per nome esatto e univoco). File versionato: `data/static/managers.json`. Servono alle curiosità del tipo «quale allenatore ha vinto nel giorno del suo compleanno?» e «quali due allenatori nati lo stesso giorno si sono affrontati?».
- 18 tipi di curiosità per il Tiro Secco (compleanni, gemelli di data di nascita, gol e autogol nella stessa partita, rossi lampo, rimonte, gol dalla panchina, omonimi, doppie maglie…), ognuno con distrattori verificati come errati.
- **Un solo nome per persona**: l'indice dei nomi contiene solo persone (giocatori, allenatori, arbitri) con l'identificativo della fonte; i profili doppi (stesso nome e data di nascita) sono fusi. Due persone con nome identico restano distinte e la risposta è accettata se coincide con una qualsiasi di loro.

**Più dispositivi senza server** (sostituisce §12.1–§12.3)

- Basta aprire il sito pubblicato (GitHub Pages) su ogni dispositivo: non c'è alcun server nostro da avviare.
- Lo **Schermo ospita la stanza**: esegue il motore, è l'unico a scaricare domande e soluzioni e a giudicare le risposte. I telefoni mandano intenzioni e ricevono viste già filtrate.
- Due modalità: **senza conduttore** (Schermo + 2 telefoni-pulsantiera) e **con conduttore** (Schermo + 1 telefono-Regia che vede soluzioni e copione e convalida le risposte a voce). Lo Schermo può essere un PC, una TV, un tablet o un telefono in orizzontale.
- Trasporto: i messaggi passano da **relay MQTT pubblici e gratuiti** su WebSocket sicuro (quattro in parallelo, di cui uno sulla porta 443; ne basta uno raggiungibile e i doppioni vengono scartati). Non serve la stessa Wi-Fi. Il contenuto è **cifrato** (AES-GCM) con una chiave derivata dal codice stanza: il relay vede solo byte opachi. I relay sono servizi di terzi senza garanzie: se non sono raggiungibili resta sempre la modalità a schermo singolo. **Da verificare sul campo**: i test automatici usano un relay MQTT locale con lo stesso protocollo, perché l'ambiente di sviluppo non raggiunge quelli pubblici.
- Canali separati: le pulsantiere ricevono solo la vista pubblica (mai le soluzioni); la Regia riceve le soluzioni del solo gioco in corso.
- Codice stanza di **5 lettere** + QR per ruolo. Presenza con battiti periodici; arbitraggio del pulsante su tempi corretti con finestra di 250 ms.
- Il server Node per la rete locale (`apps/realtime`) è stato rimosso.
- **Controlli del tempo per la Regia**: sul telefono del conduttore, sopra la soluzione, ci sono **II PAUSA / PLAY ▶**, **+10 s** e **−10 s**. Solo la Regia può usarli; il comando passa dal relay allo Schermo, che ferma o sposta il conto alla rovescia e rimanda subito la vista (anche alle pulsantiere): il timer sullo Schermo mostra «PAUSA» e il tempo congelato. Meno 10 secondi oltre lo zero fa scadere il tempo. Una nuova domanda azzera sempre il tempo e la pausa. La Regia ha anche un **«Termina partita»** discreto con conferma (§3.7): il comando `end` arriva allo Schermo, che chiude la stanza e torna al menu.
- **Suggerimenti ortografici su tutti i dispositivi**: anche le pulsantiere mostrano il correttore. Per questo scaricano l'**indice dei soli nomi** (`entities.json`: persone, nessuna domanda né soluzione); i file dei giochi restano solo sullo Schermo. La Regia non scrive e non scarica nulla.

**Interfaccia**

- Il palco **riempie sempre lo schermo**: tela virtuale di almeno 1600×900 (più piccola sui telefoni, così testi e pulsanti restano grandi) che si allarga o si alza secondo il formato del dispositivo.
- **Adattamento automatico**: se il contenuto non entra nell'area, viene rimpicciolito quanto basta (e riceve più larghezza). Niente testi o riquadri tagliati.
- Sui dispositivi touch si scrive con la **tastiera del gioco** (§10.4); la barra fissata in alto con la tastiera di sistema, usata fino alla v6, è stata tolta.
- Grafica: stadio notturno animato (stelle, riflettori, pubblico, prato), sprite pixel-art per ogni gioco, tabellone a LED con punteggi animati, sorteggio a carte, coriandoli, lampi verde/rosso, transizioni a scatti. Sempre nel rispetto di `prefers-reduced-motion`.
- I moduli (nuova sfida, sala d'attesa, torneo) sono pagine a scorrimento normale, a due colonne sugli schermi larghi; le schermate dei telefoni seguono §12.5.
- Identità visiva «tramonto pixel» (§0.7) e menu principale rifatto.

### 0.7 Identità visiva e menu principale (v6)

- **Stile «tramonto pixel»**: cielo a fasce viola → magenta → arancio → crema con retinatura (dithering), nuvole e luna in pixel, stelle scintillanti, logo TRIVELA a due strati (riempimento lavanda e ombra 3D). Nessun countdown. Le partite restano nello stadio notturno, con gli stessi colori di accento, così le schermate sembrano un'unica app.
- **Menu principale** da app seria: schermata d'avvio con logo e «PREMI START» (serve il gesto per l'audio); poi un menu a **carte** con icona, titolo e una riga di spiegazione per ogni modalità, in due gruppi: «GIOCA SU QUESTO SCHERMO» (Partita completa, consigliata; Sfida Rapida; Allenamento) e «CON GLI AMICI» (Schermo + telefoni; Torneo tra amici; Entra con codice). Bersagli touch ≥ 48 px, nessun testo tagliato su PC, tablet e telefono (verificato con `tools/shots.mjs`).
- **Home v7**: gerarchia più netta. A sinistra «GIOCA SU QUESTO SCHERMO»: *Partita Classica* in grande, sotto affiancate *Sfida Rapida* e *Allenamento*; a destra «CON GLI AMICI» con tre carte compatte. Sotto, una **barra delle impostazioni** sempre in vista: **TIMER ON/OFF**, **FILTRO ANNO** (tutte le stagioni, oppure dal 2014, 2016, 2018, 2020, 2022, 2024), **Impostazioni** (audio, correttore) e **Fonti dei dati**. Timer e anno sono ricordati sul dispositivo e valgono per ogni partita avviata da lì; le pagine di setup propongono lo stesso anno e lo lasciano cambiare per una sola partita.
- «PREMI START» reagisce al clic e non al primo contatto: sugli schermi touch lo stesso tocco premeva anche la carta del menu che compariva sotto il dito.
- Nessun nome, logo o voce di terzi: tutto il pixel art è disegnato nel codice (invariante 8).

---

## 1. Glossario

- **Partita**: sfida 1v1 composta da 5 giochi sorteggiati tra gli 8 del catalogo.
- **Gioco / Prova**: uno degli 8 mini-giochi del catalogo (§4).
- **Schermo**: dispositivo orizzontale che mostra tabellone, grafiche, timer e punteggi.
- **Regia**: dispositivo verticale del conduttore (Modalità A).
- **Controller**: smartphone personale di uno sfidante (Modalità B a 3 schermi).
- **Grafo**: database canonico dei fatti calcistici verificati (§8.2).
- **Istanza di domanda**: domanda concreta prodotta da un generatore o dalla redazione, con risposta, fonti e metadati.
- **Famiglia di fonti**: gruppo di fonti non indipendenti tra loro (es. Wikipedia + Wikidata = famiglia *Wikimedia*).
- **ANNO**: valore del filtro "Domande sul calcio a partire dall'anno".
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
  - Funziona offline una volta caricati i pacchetti dei giochi sorteggiati.
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
- Dopo la prenotazione: indizi congelati, pulsante avversario spento/grigio, campo di risposta al centro (sui dispositivi touch la scrittura avviene nella barra in alto, §0.6).
- Feedback: flash laterale + `navigator.vibrate` dove disponibile.

---

## 3. Struttura della partita

### 3.1 Setup

1. Modalità e dispositivi (§2), con abbinamento via codice stanza/QR (§12).
2. Nomi dei due giocatori.
3. **Filtro anno**: "Domande sul calcio a partire dall'anno: [ANNO]" (default: nessun filtro). Si applica secondo la tabella §3.3.
4. Sorteggio dei 5 giochi (§5.2), mostrato con carte che si scoprono una alla volta.

### 3.2 Turni

- Gioco 1: inizia chi vince il sorteggio iniziale. Il motore lo sceglie con l'RNG con seme (`state.coin`); lo Schermo lo mostra (v15) con una **moneta in pixel** con una faccia per giocatore (l'iniziale nel suo colore) che sale, gira su se stessa e atterra sulla faccia di chi inizia; sotto compare «MONETA: INIZIA …» e poi «SI PARTE». Solo `transform` e `opacity`; con `prefers-reduced-motion` la moneta è già ferma sulla faccia giusta.
- Dal gioco 2 in poi: **inizia chi è in svantaggio** nel punteggio generale. A parità inizia chi **non** ha iniziato il gioco precedente.

### 3.3 Applicazione del filtro anno

Regola generale: **elenchi e classifiche usano tutte le stagioni e ignorano il filtro**; i giochi su singolo fatto o singola persona lo rispettano.

| Gioco | Filtro | Criterio di ammissibilità |
|---|---|---|
| Tiro Secco | ✅ | Tutti i fatti della domanda hanno data ≥ ANNO (`year_min ≥ ANNO`) |
| Il Mercato | ✅ | Data del trasferimento ≥ ANNO |
| La Formazione | ✅ | Data della partita ≥ ANNO |
| La Maglia | ✅ | Stagione ≥ ANNO |
| Il Giramondo | ✅ | Il giocatore ha almeno un trasferimento ≥ ANNO (la carriera precedente si mostra comunque) |
| La Decina | ❌ | Tutte le stagioni coperte |
| Dal Dischetto | ❌ | Tutte le stagioni coperte |
| L'Asta | ❌ | Tutte le stagioni coperte |
| Testa a Testa | ❌ | Statistiche su finestre complete o su dati anagrafici: come le classifiche |
| Le Bandiere | ✅ | Stagione della partita ≥ ANNO |

"Stagione ≥ ANNO": la stagione 2015/16 vale come 2015. I dati partono dal 2012/13: se il filtro lascia troppe poche domande a un gioco, quel gioco esce dal sorteggio.

### 3.4 Campionati inclusi

- Il setup (schermo singolo, sala d'attesa, torneo) permette di scegliere da quali **campionati** pescare le domande: Serie A (con Coppa Italia e Supercoppa italiana), Premier League, LaLiga, Bundesliga, Ligue 1. Di default sono tutti attivi; ne resta sempre almeno uno. La scelta è ricordata sul dispositivo e, nel torneo, è fissata per tutte le sfide.
- **Sempre incluse**: nazionali, Mondiali, Europei, Champions League, Europa League, Conference League, Supercoppa europea.
- Regola: ogni istanza porta i campionati a cui appartiene (tag `comp:` in `entities`). Un'istanza senza campionato è sempre ammessa; altrimenti basta **uno** dei suoi campionati selezionato (un trasferimento Premier → Serie A esce se è attiva una delle due; una carriera esce se ha toccato un campionato attivo).
- Vale per tutti i giochi, **liste e classifiche comprese** (una Top 10 della Ligue 1 esce solo con la Ligue 1 attiva), a differenza del filtro anno.
- Se i giochi ancora ammissibili sono meno di 5, la partita non parte e lo dice. Con un solo campionato attivo tutti e 8 i giochi hanno abbastanza domande.
- **Serie B e altri campionati**: il dataset che usiamo non ha la Serie B. Gli altri campionati di prima fascia presenti (Eredivisie, Liga Portugal, Süper Lig…) non sono ancora generati: aggiungerli è una decisione futura.

### 3.5 Sfida Rapida e Allenamento

Due formati su **un solo gioco scelto** dall'elenco degli 8, accanto alla partita completa e al torneo.

- **Sfida Rapida (1 contro 1)**: stesse regole e stessi dispositivi della partita classica (schermo singolo, Schermo + pulsantiere, con Regia, filtri anno e campionati). Il gioco scelto si gioca per **3 round a testa**: 6 domande per Tiro Secco e Maglia (a turni alternati), 6 profili per Mercato e Giramondo, 6 categorie per l'Asta; per **Decina, Dischetto, Formazione e Testa a Testa** (un solo elenco o una sola catena per volta) 3 giri consecutivi, ognuno con un elenco o una catena diversi. Chi è in svantaggio inizia ogni giro. Nella sala d'attesa si sceglie il formato e il gioco. Se i filtri lasciano troppe poche domande, la partita non parte e dice cosa allargare.
- **Allenamento (1 giocatore)**: un solo schermo, un solo giocatore, **nessun turno e nessun avversario**. 6 domande (4 profili per Mercato e Giramondo, 3 categorie per l'Asta; un elenco per Decina, Dischetto e Formazione). Differenze: nel Mercato e Giramondo non c'è nessuno da battere sul pulsante e un errore chiude il profilo; nella Decina si hanno 2 errori; nel Dischetto 5 tiri; nell'Asta si dichiara la puntata e basta (niente rilanci), un fallimento non regala punti a nessuno; la Formazione ha una sola squadra. Non c'è vincitore: a fine sessione compaiono i punti e «ANCORA».
- Nel motore: `MatchConfig.rounds` (Sfida Rapida) e `MatchConfig.solo` (Allenamento) con `forcedGames` di un solo gioco; `singleGamePlan` decide i giri e le istanze; il contenuto è per slot, non per gioco.

### 3.6 Risposta sbagliata in rosso

In **tutti i giochi**, quando si risponde in modo errato lo Schermo scrive in **rosso** cosa si è risposto («Anna ha risposto: Galatasaray»; in Allenamento «Hai risposto: …»), perché lo vedano tutti. Vale per le opzioni (Tiro Secco, Anomalia, Frame), i numeri della Maglia, i nomi di Mercato, Giramondo, Decina, Dischetto, Formazione e Asta. Non c'è nulla da mostrare per un tempo scaduto o per un verdetto dato a voce dal conduttore. L'etichetta **ESATTO!** compare solo per una risposta del tutto giusta: la Formazione parziale mostra «3/5 TROVATI».

### 3.7 Uscite discrete (v6)

- **Termina Partita**: nella partita (schermo singolo, Schermo di una stanza, Sfida Rapida, torneo) c'è in un angolo del tabellone una piccola **X** semitrasparente (si accende al passaggio o al tocco). Apre una finestra 8-bit «Sei sicuro di voler terminare la sfida?» con **TERMINA** e **CONTINUA**; la finestra non ferma il gioco sottostante: l'orologio continua finché non si risponde. Confermando si torna al menu; in un torneo la sfida si annulla **senza registrare il risultato**. Nelle stanze, anche la Regia può terminare (§12.1).
- **Torna alla Home**: nella schermata dei risultati e nell'Allenamento compare una piccola icona «casa» in alto, discreta quanto la X, e un pulsante «TORNA ALLA HOME» sotto i risultati.
- Mai pulsanti vistosi che invitino a uscire per sbaglio: la conferma è obbligatoria e `Esc` equivale a CONTINUA.

### 3.8 Timer a scelta e tempo extra per scrivere (v7)

- **Timer ON** (predefinito): ogni risposta ha il suo tempo (§4). Quando il tempo di una risposta **da scrivere** arriva a zero, la manche **non si chiude**: parte un **tempo extra di 10 secondi**, rosso e lampeggiante («TEMPO SCADUTO · FINISCI DI SCRIVERE!»), che serve solo a finire di digitare. La risposta inviata in quei 10 secondi vale come le altre; allo scadere del tempo extra l'errore è definitivo.
  - Vale per: Decina, Dischetto, la risposta dopo la prenotazione in Mercato e Giramondo, Formazione, la prova dell'Asta.
  - **Non** vale dove non c'è niente da scrivere: le quattro opzioni del Tiro Secco, il tastierino della Maglia, l'attesa della prenotazione, e quando un conduttore giudica le risposte a voce.
  - Nel motore: allo scadere di un timer di quei tipi nasce un nuovo timer `grace` (`Timer.grace`), con evento `grace`; il vecchio timer non può più scattare.
- **Timer OFF**: nessun conto alla rovescia. Restano solo le pause dello spettacolo («PRONTI…», l'esito dopo una risposta).
  - **Mercato e Giramondo**: gli indizi non escono da soli; un pulsante **PROSSIMO INDIZIO ▶** li scopre a mano (e i punti scendono). Con tutti gli indizi scoperti diventa **NESSUNO LO SA ▶** e chiude il profilo. Sulle pulsantiere lo può premere chi è ancora in gioco.
  - Chi deve rispondere può rinunciare: **PASSO** (Decina), **NON TIRO** (Dischetto), **NON LO SO** (dopo la prenotazione). Conta come il tempo scaduto. Formazione e Asta hanno già «HO FINITO» e «MI ARRENDO».
  - Nel motore: `MatchConfig.timer === false`; intento `SKIP` (solo del giocatore di turno, solo senza timer).
- L'interruttore è nella Home (§0.7) e vale per schermo singolo, stanze e torneo. La pagina di setup ricorda com'è impostato.

---

### 3.9 Di chi è il turno (v15)

Nei giochi a turni (tutti tranne quelli a prenotazione, Il Mercato e Il Giramondo) lo Schermo dice in quattro modi chi deve rispondere:
- nella barra in alto il giocatore di turno è **acceso** (riquadro e bagliore nel suo colore, «★ TOCCA A TE»), l'altro è **spento** (opacità ridotta);
- il palco ha una **cornice nel colore** del giocatore di turno, più spessa dal suo lato (a sinistra il primo, a destra il secondo, come nella barra);
- il cartellino «◀ TOCCA A …» / «TOCCA A … ▶» è più grande e sta **dal lato** del giocatore;
- quando il turno passa all'altro, una **fascia** «TOCCA A …» attraversa il palco dal lato del nuovo giocatore (1,1 secondi, non blocca i tocchi; spenta con `prefers-reduced-motion`).

## 4. Catalogo dei giochi

I nomi dei giochi sono **provvisori** (§19) e stanno in un solo file (`apps/web/src/rules.ts`). Ogni gioco ha un `id` stabile usato nel codice. Tutte le istanze sono calcolate sul dataset (§0.5, §0.6).

### 4.1 `tiro_secco` — Tiro Secco
- **2 domande a testa** (4 totali), risposta multipla A/B/C/D, a turno alternato. Nessuna possibilità di rubare.
- Timer: **25 s** (20 fino alla v6: le domande sui record sono più lunghe). Punti: **+2** esatta, 0 errata.
- **Sette famiglie** di domande (v15), tutte con distrattori **verificati come errati**; un'etichetta sopra la domanda dice la famiglia (le curiosità non ne hanno):
  1. **Curiosità** "da maniaco" calcolate sui dati (compleanni, rimonte, omonimi, gol dalla panchina…).
  2. **Record rarissimi** (`tag: "record"`, generatori `an_*`): erano il gioco *L'Anomalia Statistica*, vedi §4.2.
  3. **Giochi di nomi** (`tag: "nomi"`, generatori `nomi_*`, `data/trivela_data/gen_nomi.py`): che cosa vuol dire un cognome, **incrociato con statistiche vere**.
  4. **Trasferimento vero o falso** (v14, `tag: "vf"`, generatore `ts_vero_falso`, `data/trivela_data/gen_vf.py`): la scheda mostra `GIOCATORE`, `DA` → `A`, `STAGIONE`; due pulsanti grandi **VERO** / **FALSO** (anche sulle pulsantiere e per la Regia), +2 se esatta.
     - **Veri**: trasferimenti reali del dataset, di giocatori noti (fama ≥ 75), con almeno una delle due squadre in un campionato top in quel momento.
     - **Falsi**: lo stesso trasferimento reale con la squadra di arrivo sostituita da una squadra dello stesso campionato e della stessa stagione, di peso simile, che il giocatore **non ha mai avuto** in tutta la sua storia: nessun trasferimento da o verso di lei, nessuna presenza, nessuna formazione. Un trasferimento non è mai dichiarato falso solo perché manca nei dati. Il Copione dice il trasferimento vero.
     - **Tanti veri quanti falsi** (937 + 937), così «sempre VERO» non paga. Dalla v15 sono una famiglia come le altre nel sorteggio per famiglie (fino alla v14 pesavano come una dozzina di tipi, `GENERATOR_WEIGHTS`).
     - **Variante Prestito / Definitivo: non fatta.** Il dataset non ha un campo esplicito sul tipo di operazione e l'importo non lo prova (un parametro zero non è un prestito).
     - Le 3600 domande della v10 restano identiche; le nuove si aggiungono (Tiro Secco: 5474 nella v14).
  5. **Di chi è questa stagione?** (v15, `tag: "scheda"`, generatore `ts_scheda`, `gen_seasons.py`, `scheda()`): era il gioco *Le Statistiche*. La stagione di campionato di un calciatore come un tabellone arcade (STAGIONE · COMPETIZIONE · «SOLO SERIE A»; PARTITE · GOL · ASSIST; RUOLO, e la nazionalità solo se serve a distinguere), quattro nomi, **+2**.
     - **Solo stagioni memorabili**: almeno 20 presenze e almeno 15 gol, o 10 assist, o 20 tra gol e assist; per i difensori bastano 5 gol, per i centrocampisti 14 tra gol e assist. Una scheda tipo «20 presenze, 0 gol» non ricorda nessuno e non esce. Niente portieri.
     - **Opzioni sbagliate**: giocatori noti dello **stesso reparto** (stessa posizione prima) in quel campionato e in quella stagione, con i numeri **più vicini** (gol, poi assist, poi presenze), mai con gli stessi gol e assist; così non si va per esclusione. Il Copione dice i numeri di tutti e quattro.
     - Restano le regole della v14: stagioni con ogni partita e ogni riga di presenza, gol confermati dagli eventi, una sola squadra, fama ≥ 70, al massimo 2 schede per giocatore, **nessun altro giocatore** di quella stagione con la stessa scheda.
  6. **Stagione dei campioni** (v15, `tag: "campioni"`, generatori `stg_*`, `gen_seasons.py`, `stagione()`): era il gioco *La Stagione dei Campioni*, con le stesse regole (§4.13 della v14, riportate qui): campione (primo per punti calcolati **e** nella classifica registrata all'ultima giornata, altrimenti non esce), capocannoniere (gol verificati), assistman, portiere con più porte inviolate («partita giocata per intero da titolare senza subire gol»), miglior attacco e difesa, e per un club miglior marcatore, più presenze, più assist, posizione finale. Mai un pari merito al primo posto; la Ligue 1 2019/20, interrotta, non ha domande sul campione né sulle classifiche.
  7. **Chi ne ha fatti di più?** (v15, `tag: "confronto"`, generatori `ts_confronto_gol`, `ts_confronto_assist`, `ts_confronto_gialli`, `gen_seasons.py`, `confronto()`): «Premier League 2015/16: quale di questi giocatori ha segnato più gol in campionato?», e lo stesso per assist e **cartellini gialli**.
     - Un campionato e una stagione con le righe di presenza complete; giocatori noti (fama ≥ 70) con almeno 15 presenze, di reparti adatti (attaccanti e centrocampisti per gol e assist, difensori e centrocampisti per i gialli).
     - La risposta è tra i primi della stagione; le altre tre opzioni hanno **valori poco sotto** (entro 6 gol, 4 assist o 4 gialli) e **tutti diversi**: mai un pari merito, mai un distacco enorme.
     - Gialli: un giocatore entra solo se i gialli delle sue righe di presenza tornano, uno per uno, con i cartellini registrati negli eventi di quella stagione.
- **Sorteggio per famiglie (v15)**. Con sette famiglie e generatori molto diversi per numero (35 tipi di curiosità, 2 di schede) il sorteggio per generatore dava quasi sempre curiosità. Ora il motore (`FAMILY_OF`, `sampleVaried` in `match.ts`) pesca **una famiglia alla volta in ordine casuale**: le 4 domande di una partita sono di **4 famiglie diverse** e ogni famiglia esce con la stessa frequenza (circa una domanda su sette), qualunque sia il numero delle sue domande; dentro la famiglia i generatori si alternano. Con i filtri attivi, se restano meno di 4 famiglie, una si ripete.
- **Giochi di nomi (v7.1)**. Le quattro opzioni sono **solo cognomi** della stessa famiglia di parole, e uno solo appartiene davvero a un giocatore che ha fatto la cosa chiesta:
  - «Quale di questi cognomi (tutti nomi di animali) appartiene a un giocatore che ha giocato in Serie A (dal 2013/14 al 2025/26)?» Gatti · Cani · Topi · Salmoni;
  - «Quale di questi cognomi (tutti nomi di mestieri in tedesco) appartiene a un giocatore che ha segnato almeno 30 gol in Bundesliga?» Schmid · Bauer · Klempner · Bergmann.
  Undici famiglie: animali, personaggi storici, **dittatori**, città, colori, mestieri, cibo, piante, titoli nobiliari, parole di chiesa, calendario. Per le famiglie legate a una lingua la domanda dice la lingua («in portoghese») e le opzioni sbagliate sono nella stessa lingua (in italiano anche nello stesso numero: Gatti con Cani, Gallo con Cane).
- **Regole dei giochi di nomi**:
  - la risposta giusta è il **cognome di una sola parola** di un giocatore vero e noto (nome e cognome distinti: niente nomi d'arte come «Ganso» o «Chory Castro»), che combacia con una voce del lessico, accenti compresi;
  - le opzioni sbagliate (v8.1) sono **cognomi veri di calciatori** presenti nel dataset (di qualunque campionato o livello), scritti come li porta il giocatore e della stessa famiglia e lingua della risposta: per «Gatti» in Serie A, «Volpi», «Orsi», «Lupi»; per «Gallo», «Gatto», «Cavallo», «Leone». Il dataset dimostra che **nessun giocatore con quel cognome ha giocato nella competizione**: si controllano tutte le righe (presenze, righe di presenza, formazioni, gol), di tutte le stagioni, e ogni parola del nome. Le parole inventate come «Salmoni» o «Topi» (v7.1) sono state tolte perché svelavano la risposta. Servono tre cognomi così: se mancano, la domanda non viene fatta (oggi circa 270);
  - per i gol una sola persona deve aver raggiunto la soglia (100, 50, 30, 20, 10 o 5), contando solo le stagioni con i gol completi; un'opzione sbagliata può essere anche un cognome vero della stessa famiglia, se tutti quelli che lo portano insieme non arrivano a un quarto della soglia;
  - una domanda per cognome e competizione; lo script dice di chi è il cognome, che cosa significa e perché le altre tre sono sbagliate;
  - i tipi «chi è?», «l'intruso», «più gol», «più presenze» e «chi ha giocato» con nomi completi della v7 sono stati **tolti**: non si capiva che cosa c'entrasse il cognome.
- **Opzioni sbagliate che non si scartano a colpo d'occhio (v10)**. Fino alla v8 le opzioni sbagliate erano le stelle del campionato: la risposta giusta era il nome meno noto (nel 52% dei record e nel 40% delle curiosità), e bastava scegliere «quello che non conosco». Regole valide per tutte le famiglie:
  - **stessa fama della risposta**: tra i candidati verificati come errati si prendono quelli con la fama più vicina a quella della risposta (`TM.near_in_fame`), tutti noti (filtro notorietà); la risposta risulta la più famosa delle quattro, la meno famosa o una di mezzo **con la stessa frequenza** (circa un quarto ciascuna);
  - **«quasi riusciti» per primi**, dove il dato c'è: per i record vedi §4.2; tra le curiosità, per «chi non ha mai segnato» giocatori dello **stesso ruolo** con 1–3 gol, per «chi ha segnato con due squadre» giocatori che **hanno cambiato squadra** quella stagione ma hanno segnato con una sola (solo se i gol di entrambe le squadre sono completi);
  - **nessun nome ripetuto tra le opzioni** («Gourvennec e X» in tre coppie su quattro indicava la risposta);
  - **omonimi**: le opzioni sbagliate sono i cognomi **più comuni** tra gli altri titolari, così «Silva» non è l'unico cognome diffuso;
  - **stadi**: mai lo stadio di una grande squadra tra le opzioni di una piccola; prima gli altri stadi usati da quella squadra, poi quelli dei club non grandi del campionato;
  - **giochi di nomi**: i cognomi sbagliati sono di un **calciatore noto** (supera il filtro notorietà), il più vicino per fama al portatore della risposta, e lo script dice di chi sono («Soria, Valencia e Lucca sono cognomi di calciatori veri (David Soria, Antonio Valencia, Lorenzo Lucca)…»). Le domande scendono da circa 270 a circa 70, ma le quattro opzioni «suonano» tutte;
  - **una domanda per fatto e per cognome**: niente varianti dello stesso fatto con altre opzioni.
- Test: `test_wrong_options_are_not_spotted_by_fame` (ogni posizione della risposta per fama tra il 10% e il 40%), `test_one_question_per_rare_fact`.
- Stato: 7652 domande. Le 3600 della v10 (circa 2470 curiosità, 1060 record, 70 giochi di nomi) e i 1874 vero o falso restano identici; si aggiungono 542 schede, 1200 domande sui campioni e 436 confronti (tetti per famiglia in `generate.py`).

### 4.2 I record rarissimi del Tiro Secco (ex *L'Anomalia Statistica*)
- Fino alla v6 erano un gioco a sé (`anomalia`, +3 a domanda); dalla v7 sono domande del Tiro Secco (+2), generate da `data/trivela_data/gen_anomalie.py`.
- **Distrattori dello stesso ruolo** (v8.1): le tre opzioni sbagliate sono giocatori della stessa età circa e dello **stesso ruolo** della risposta (un attaccante non è mai nascosto tra tre portieri); solo se il ruolo ne ha meno di tre si allarga a tutti i ruoli. Dalla v10 sono **noti quanto la risposta**, non i più famosi (§4.1).
- **«Quasi riusciti» (v10)**: le opzioni sbagliate sono prima di tutto giocatori che **ci sono andati vicino** senza riuscirci, sempre verificati sugli stessi dati:
  - doppietta, tripletta, poker: chi nella sua partita migliore è arrivato a **un gol in meno** (un difensore con una doppietta, per la tripletta);
  - autogol e gol: chi ha segnato **un autogol** in quella competizione, ma mai insieme a un gol;
  - subentrato in gol entro 2 minuti: subentrati che hanno segnato **tra 3 e 15 minuti** dopo l'ingresso;
  - subentrato espulso: subentrati espulsi **più tardi** (fino a 40 minuti dopo l'ingresso); titolare espulso presto: titolari espulsi **entro la mezz'ora**;
  - andata e ritorno con due maglie: giocatori che hanno **cambiato squadra nella stessa stagione** senza incontrare la vecchia;
  - portiere con un assist: portieri con almeno 30 presenze e nessun assist (già dalla v6.1).
- **Nuovo record (v8.1)**: un **subentrato che segna entro 2 minuti dal suo ingresso** (`an_gol_lampo_2`, stesso minuto compreso), dai minuti di sostituzione e gol del dataset; lo script dice al minuto quando è entrato e quando ha segnato.
- **Non fattibili con la fonte attuale**: voti in pagella (SofaScore Rating) e rigori sbagliati in partita. Il dataset non li contiene e la fonte che li ha (SofaScore) non si può usare senza licenza (§0.5, invariante 9).
- **Regola di rarità (v6.1)**: entrano solo eventi che nelle prime cinque leghe europee e in Champions League succedono poche volte l'anno. Sono stati **tolti** i record comuni: un subentrato che segna (anche una doppietta), un difensore con almeno 6 gol in stagione, un attaccante a secco in 25 partite, 15 gol senza rigori, 100 presenze senza espulsioni, 30 partite senza ammonizioni, un gol con due squadre diverse nella stessa stagione, una tripletta di un centrocampista.
- Una sola opzione ha davvero fatto quella cosa; le altre tre sono **giocatori noti** (o partite) per cui il record è falso sugli stessi dati. Tutte e quattro passano il filtro notorietà.
- Tipi di record (13 generatori, `data/trivela_data/gen_anomalie.py`):
  - un **portiere che ha segnato** un gol; un portiere con almeno un **assist**;
  - un **difensore con una tripletta** (almeno tre gol in una partita) o con **una doppietta**;
  - un giocatore **entrato dalla panchina con almeno tre gol** nella stessa partita; un attaccante con **almeno quattro gol** in una partita;
  - un **autogol e un gol per la propria squadra nella stessa partita** (la domanda dice solo «autogol e gol»; lo script riporta i minuti);
  - un **subentrato espulso meno di 5 minuti** dopo l'ingresso (e, con una domanda separata, tra 5 e 9 minuti): lo script dice quanti minuti dopo;
  - un **titolare espulso nei primi 5 minuti** di una partita (e, separata, tra il 6° e il 10°);
  - una partita in cui **una stessa squadra ha chiuso con almeno tre espulsi** (le opzioni sono partite, con stagione; le false hanno al massimo due espulsi per squadra);
  - un giocatore che, **nella stessa stagione e competizione, ha giocato per una squadra all'andata e per l'avversaria al ritorno** (trasferimento tra le due partite).
- **Non fattibile con i dati**: i **rigori sbagliati in partita** non sono nel dataset (Transfermarkt registra solo i tiri delle serie finali), quindi «due rigori sbagliati nella stessa partita» non viene generata: servirebbe una fonte che al momento non è ammessa (SofaScore è scartata, SPEC §0.5).
- **Una domanda per evento (v10)**: fino alla v8 lo stesso evento compariva con terne di distrattori diverse (fino a 6 varianti). Era sempre la stessa domanda: vista una volta, la risposta si ricordava. Ora ogni fatto (giocatore + record + competizione) è **una sola domanda**; per «andata e ritorno» una sola per giocatore e competizione, anche se è successo in più stagioni. I record scendono da 1525 a circa 1060; il Tiro Secco resta a 3600 con più curiosità.
- **Affermazioni «mai» solo dove i dati lo permettono**: i distrattori sono giocatori senza quell'evento in stagioni con dati completi (gol, formazioni o cartellini concordanti tra eventi e righe di presenza) e la finestra «stagioni 2012/13–2025/26» è scritta nella domanda.
- Le istanze portano il campionato (`comp:`), quindi rispettano il filtro campionati (§3.4).
- Test: `test_rare_records_are_part_of_tiro_secco_and_only_genuinely_rare` (solo generatori ammessi, soglie verificate dagli script).

### 4.3 `mercato` — Il Mercato
- **2 trasferimenti**, da indovinare con 6 indizi progressivi: cifra (20), sessione e anno (15), ruolo (10), nazionalità (5), squadra cedente (3), squadra acquirente (2).
- **Quali trasferimenti (v11)**:
  - **campionati**: tutti e cinque, non più solo la Serie A. Un trasferimento entra se la squadra cedente o quella acquirente giocava in uno dei cinque campionati **in quel momento**: la cedente nella stagione che il giocatore lasciava (nella stessa stagione per il mercato di gennaio), l'acquirente in quella in cui arrivava. I tag `comp:` sono quei campionati. Con la sola Serie A selezionata (§3.4) escono solo giocatori ceduti da o a squadre di Serie A. Prima del 2012/13 le partite non sono nel dataset e vale il campionato attuale della squadra;
  - **quanto valgono**: circa **4 trasferimenti su 5 sono da 20 milioni in su** (generatore `mercato`). Quelli più economici (`mercato_minore`, da 1 a 20 milioni) sono più rari e solo di **giocatori noti** (fama almeno 80: Boateng, Thauvin, Muriel, Estupiñán…). La proporzione la tiene il motore, che pesca i due generatori con peso 0,78 e 0,22 (`GENERATOR_WEIGHTS`) qualunque siano i campionati scelti; il confine dei 20 milioni è la cifra mostrata nell'indizio;
  - pacchetto: 1857 trasferimenti (957 da almeno 20 milioni, 900 sotto). Per campionato, da almeno 20 milioni: Premier League 534, Serie A 220, Liga 211, Bundesliga 183, Ligue 1 177.
- Prenotazione col pulsante. **Un solo tentativo per giocatore per profilo.** Chi sbaglia è fuori per quel profilo (nessuna penalità); l'avversario può farsi scoprire gli altri indizi prima di rispondere, prendendo i punti dell'ultimo indizio scoperto.
- Con conduttore: gli indizi li scopre la Regia. Senza: un indizio ogni 8 s; dopo un errore l'avversario li scopre a comando. Tempo di risposta dopo la prenotazione: 10 s (più il tempo extra, §3.8). Con il timer spento gli indizi si scoprono con «PROSSIMO INDIZIO ▶».

### 4.4 `decina` — La Decina
- **Una** categoria con **14–17 risposte valide**. Si devono dire **10 risposte in totale**, una a testa a turno alternato. Timer: 30 s per turno. Punti: **+2** per risposta valida.
- Errore o tempo scaduto: la parola passa all'altro. Ogni giocatore ha **2 errori**: al secondo esce, e l'altro continua da solo. Il gioco termina alla 10ª risposta esatta o quando entrambi sono usciti. Ripetere un nome già detto è un errore.

### 4.5 `dischetto` — Dal Dischetto
- **Una** Top 10 statistica (competizione e stagioni dichiarate nel titolo). Il sistema dichiara il valore del 1° e del 10° posto.
- **5 tiri a testa**, a turno alternato. Timer 30 s a tiro. Punti: **+2** per ogni nome in classifica.
- Pari merito all'ultimo posto utile: i nomi a pari merito valgono finché restano posti nella Top 10.
- Nome fuori classifica, già detto o tempo scaduto = tiro sbagliato.
- **Classifiche aggiunte in v7** (1336 in tutto, 67 generatori):
  - **più espulsi** di un campionato (rossi diretti e doppie ammonizioni). Le espulsioni hanno due registrazioni, gli eventi di gara e le righe di presenza, e circa il 6% degli eventi non trova conferma nell'altra: la classifica esce **solo** dove le due coincidono per tutti i giocatori che possono entrare nei dieci. Oggi: Bundesliga e Champions League; Serie A, Premier, Liga e Ligue 1 no;
  - **più ingressi dalla panchina** di un campionato, in tutto e stagione per stagione (quelli per squadra c'erano già);
  - **più maglie diverse** in un campionato (squadre con almeno una presenza): esce dove i pari merito all'ultimo posto sono al massimo 20, cioè Serie A e Ligue 1; negli altri campionati diventa un insieme per Decina e Asta («almeno N maglie»);
  - **marcatori più anziani e più giovani** di ogni stagione (quelli di sempre c'erano già);
  - **Mondiali ed Europei** conclusi (2006–2022, 2008–2024): migliori marcatori di sempre e di ogni edizione.
- **Non fattibile: «i 10 portieri con più rigori parati»**. Il dataset non registra i rigori parati in partita; registra solo i tiri delle serie finali, senza dire chi era in porta. Ricostruendo il portiere dalle formazioni restano 29 serie tra Champions, Europa League e Supercoppa europea (Mondiali ed Europei non hanno le formazioni): due portieri a 4 parate, due a 3, più di dodici a 2. Non è una classifica giocabile né completa, quindi non viene generata. SofaScore resta esclusa (§0.5).
- Una classifica in cui compare un giocatore che il dataset non conosce per nome viene scartata.

### 4.6 `formazione` — La Formazione
- **Una** partita con i moduli di entrambe le squadre: **6 titolari visibili, 5 oscurati** per squadra (solo giocatori noti di movimento).
- Chi è in svantaggio **sceglie quale squadra completare**; l'avversario completa l'altra. **60 s** a testa.
- Punti: 5/5 = **15**, 4/5 = **10**, 3/5 = **5**, 2/5 = **3**, 1/5 = **2**, 0/5 = **0**.
- **Solo partite iconiche (v7)**, quattro generatori (`formazione_coppa`, `_derby`, `_vetta`, `_punteggio`) che il sorteggio alterna:
  - **coppe: solo dai quarti di finale in poi** (quarti, semifinali, finali) di Champions, Europa e Conference League, Coppa Italia; le Supercoppe, che sono finali. Niente gironi né ottavi;
  - **derby e grandi classiche** dei cinque campionati, da un elenco scritto a mano (`gen_matches.DERBIES`: Inter-Milan, Roma-Lazio, Juventus-Torino, Juventus-Inter, Arsenal-Tottenham, Real Madrid-Barcellona, Bayern-Dortmund, PSG-Marsiglia…);
  - **scontri al vertice**: prima contro seconda in classifica, dalla 10ª giornata, con la classifica ricalcolata sui risultati prima del calcio d'inizio e nessuna terza a pari punti con la seconda;
  - **risultati fuori scala**: almeno 8 gol in tutto o almeno 6 di scarto.
- Il motivo compare accanto alla competizione («Scontro al vertice: prima contro seconda»). Le partite di coppa possono tornare una seconda volta con cinque titolari diversi da trovare.
- **Filtro campionati**: come per ogni gioco (§3.4). Con la sola Serie A escono le coppe europee, la Coppa Italia e le partite iconiche di Serie A.
- **Mondiali ed Europei non ci sono**: per le nazionali il dataset non ha le formazioni con i ruoli, quindi non si può disegnare il campo. Servirebbe un'altra fonte.
- Stato: 1400 partite (su circa 2400 generate).

### 4.7 `giramondo` — Il Giramondo
- **2 carriere**, rivelate in **ordine cronologico** (anno del trasferimento → squadra), in 5 indizi.
- Prenotazione col pulsante, un tentativo per giocatore per profilo (stesse regole del Mercato).
- Punti per indizio: **12 / 9 / 6 / 3 / 1**.

### 4.8 *(libero)*
*Il Frame* è stato rimosso in v6; la numerazione dei giochi successivi resta invariata per non rompere i riferimenti.

### 4.9 `asta` — L'Asta
- **2 categorie** (insiemi come La Decina). Per ognuna: asta a rilanci alternati, puntata da 1 a min(10, dimensione); "passo" assegna l'asta all'altro alla puntata corrente.
- Chi vince l'asta deve dire **tanti nomi validi quanto la puntata** in 60 s.
- Punti: successo **+puntata**; fallimento **+5 all'avversario**.

### 4.10 `maglia` — La Maglia
- **2 domande a testa**: giocatore + squadra + stagione ⇒ **che numero aveva?** Risposta con tastierino numerico. Timer 30 s. Punti: **+3**.
- Solo giocatori con un unico numero in quella stagione e almeno 25 presenze (10 per i numeri iconici, 12 per i numeri fuori ruolo).
- **Niente numeri banali**: mai l'1 di un portiere né il 9 di un attaccante.
- **Priorità alle anomalie**: tre generatori pescati in parti uguali: *fuori ruolo* (un difensore col 10, un portiere con l'8, un attaccante col 4…; ruolo dedotto dalle partite da titolare), *numeri pesanti* (20 e oltre: 21, 22, 45, 77, 99…) e *numeri di rosa* (12–19, con una piccola quota, circa il 2%, di numeri classici).
- **Niente giocatori che tornano sempre (v10)**. Viviano usciva 4 volte in una ventina di partite: aveva 5 domande quasi uguali (il 2 della Sampdoria in quattro stagioni, più la SPAL) tra le sole 45 anomalie di Serie A, che il sorteggio pesca a pari quota con gli altri tipi. Ora:
  - **una domanda per maglia**: stesso giocatore, stessa squadra, stesso numero in più stagioni ⇒ una sola, la stagione con più presenze;
  - **al massimo 2 domande per giocatore** nel pacchetto (prima le fuori ruolo); i giocatori diversi passano da 450 a circa 1070;
  - nel motore, mai due domande sulla **stessa persona** nella stessa partita e **riposo di 6 partite** per le persone già chieste su quel dispositivo (§5.3).

### 4.11 `testa_a_testa` — Testa a Testa (v13)
- **Un duello su una sola catena** per partita (come la lista di Decina e Dischetto). Una statistica, ad esempio «Presenze in Serie A (dal 2013/14 al 2025/26)», e **nove giocatori**: a sinistra quello **IN CAMPO**, con il suo valore; a destra lo **SFIDANTE**, con «???».
- **Come si gioca**:
  - chi è di turno dice se lo sfidante ne ha **PIÙ** o **MENO**;
  - se ha ragione prende **+1**, il valore si scopre, lo sfidante diventa il giocatore in campo e **la palla passa all'avversario**, un passo più difficile;
  - **chi sbaglia per primo** (o lascia scadere il tempo) chiude il duello: l'avversario **vince il duello, +3**;
  - se la catena arriva in fondo senza errori (otto confronti) nessuno vince il duello.
- **Punti**: al massimo 4 confronti giusti + 3 del duello, ma in pratica 3–6 per chi vince e 1–3 per chi perde, come gli altri giochi della sfida. Il piatto «incassa o rilancia» della prima versione è stato tolto: dava troppi punti e si giocava da soli.
- **Tempo**: 12 secondi per scelta. Dopo una risposta giusta, una pausa di 1,8 secondi mostra il valore (il numero sale come un contatore arcade), poi tocca all'altro. Con il timer spento (§3.8) resta solo la pausa.
- **Allenamento**: un punto per confronto giusto, fino al primo errore. **Sfida Rapida**: tre catene, una per round.
- **Grafica**: un'arena da picchiaduro in pixel art: un tabellone luminoso con la statistica, due carte con avatar (lo sfidante incorniciato del colore di chi è di turno), un «VS» con scintille, il timbro ✓/✗ sulla carta. Sotto, la **traccia degli otto passi**: ogni passo si colora di chi ha risposto (azzurro o fucsia) con la freccia giusta, e una striscia dal verde al rosso dice quanto si fa difficile. A fine duello compaiono la catena intera e il vincitore.
- **Telefoni**: PIÙ/MENO stanno sotto il pollice del giocatore di turno, che vede anche il valore in campo e il livello. La Regia ha gli stessi pulsanti e vede la catena intera.
- **Statistiche** (`data/trivela_data/gen_testa.py`), per ciascun campionato top, tra giocatori notevoli con fama ≥ 75 scesi in campo in quel campionato:
  - gol e presenze in campionato, sulla finestra di stagioni complete (dichiarata nel titolo);
  - altezza, valore di mercato più alto in carriera, trasferimento più caro, età al 6 luglio 2026 (PIÙ = più anziano).
- **Regole delle catene**:
  - **difficoltà crescente**: due vicini sono sempre più vicini lungo la catena. In percentuale sul valore più grande, il primo passo va dal 45% in su, l'ultimo tra il 10% e il 15%. Per l'altezza da almeno 10 cm a 2–3 cm, per l'età da almeno 8 anni a 2;
  - mai pareggi, mai tre passi nello stesso verso, mai tutta la catena nello stesso verso: «sempre PIÙ» non è una strategia;
  - giocatori di fama simile al primo (`near_in_fame`); un giocatore in al massimo 4 catene della stessa statistica.
  - Pacchetto: 1200 catene (40 per statistica e campionato).
- **Soluzioni**: Schermo e pulsantiere vedono i valori già confrontati e il nome dello sfidante, mai il suo valore né i giocatori successivi; alla fine si scopre la catena intera.

### 4.12 *(libero: era Le Statistiche, confluito nel Tiro Secco nella v15, §4.1)*

### 4.13 *(libero: era La Stagione dei Campioni, confluito nel Tiro Secco nella v15, §4.1)*

### 4.14 `bandiere` — Le Bandiere (v14)
- **2 formazioni a testa**, a turno. Sul campo in pixel art compaiono le **11 bandiere dei titolari** di una squadra in una partita vera, disposte come hanno giocato (la posizione registrata per ognuno; il modulo, quando è registrato, si vede alla fine). Mai nomi o stemmi in questa fase.
- Le bandiere restano **5 secondi esatti**, poi spariscono; il giocatore di turno sceglie la squadra tra quattro (20 secondi, +2). Alla rivelazione tornano bandiere e nomi, con partita, competizione e data.
- **Timer dei 5 secondi**: è un timer di pausa (`memo`) del motore, separato da quello della risposta. Gira anche con il **timer spento** (§3.8), come «PRONTI…». Il motore resta deterministico: lo Schermo che ospita la partita fa scattare la fine dei 5 secondi con il normale evento `TIMEOUT`, e Regia e pulsantiere seguono lo stato via relay. Durante i 5 secondi i telefoni dicono «GUARDA LO SCHERMO».
- **Dati** (`data/trivela_data/gen_bandiere.py`):
  - partite dei campionati top con le **formazioni complete** (11 + 11), un solo portiere, posizione registrata per tutti e 11, **nazionalità per tutti e 11** con la sua bandiera;
  - squadre note; al massimo 2 formazioni per squadra e stagione, con bandiere diverse;
  - le risposte sbagliate sono squadre dello stesso campionato e della stessa stagione con il **mix di nazionalità più simile**.
  - Pacchetto: 1336 formazioni.
- **Bandiere**: SVG del pacchetto `flag-icons` (MIT), 4:3, nitide su ogni schermo; `tools/flags.mjs` copia in `apps/web/public/flags/` solo le 106 usate (circa 1 MB in tutto). Si scaricano solo quando il gioco è sorteggiato.
- **Soluzioni**: Schermo e telefoni ricevono le bandiere solo durante i 5 secondi, le opzioni solo dopo, nomi e squadra solo alla rivelazione; la Regia vede tutto.

---

## 5. Bilanciamento e sorteggio

### 5.1 Budget punti (massimo teorico per giocatore)

| Gioco | Max a testa | Note |
|---|---|---|
| tiro_secco | 4 | |
| mercato | 40 | 2 profili × 20; tipicamente 5–20 |
| decina | 20 | se l'altro esce subito |
| dischetto | 10 | |
| formazione | 15 | |
| giramondo | 24 | 2 profili × 12 |
| asta | 20 | |
| maglia | 6 | |
| testa_a_testa | 7 | 4 confronti giusti + 3 del duello; in pratica 3–6 |
| bandiere | 4 | 2 formazioni × 2 |

### 5.2 Regole di sorteggio (5 giochi)

- Pool: i 10 giochi, dal catalogo (`GAME_IDS`). Un gioco senza abbastanza domande per i filtri attivi esce dal sorteggio da solo.
- Vincoli:
  - al massimo 1 tra {`mercato`, `giramondo`} (pulsante a indizi progressivi);
  - al massimo **2** tra {`decina`, `dischetto`, `asta`} (elenchi), e **mai Decina e Asta insieme**, perché si giocano sullo stesso tipo di insieme. Con 8 giochi il vecchio limite di 1 avrebbe dato sempre gli stessi cinque;
  - il primo gioco è pescato tra i rapidi {`tiro_secco`, `maglia`};
  - un gioco è escluso se non ha abbastanza istanze ammissibili con il filtro corrente.
- Le domande di ogni gioco sono pescate **alternando i tipi di domanda** (un generatore alla volta).
- Sorteggio deterministico dal seme della partita (riproducibile nei test).

### 5.3 Scelta delle domande e persone già viste (v10)
- Dentro un gioco le domande alternano i generatori (`sampleVaried`), poi:
  - **una persona per partita**: due domande sulla stessa persona (le entità `tm:p:` di una domanda che ne nomina al massimo due; le liste non contano) non escono mai nella stessa partita;
  - **riposo sul dispositivo**: le persone delle ultime **6 partite** (`trivela.people` in `localStorage`, comodità del singolo dispositivo) passano in fondo: escono solo se senza di loro le domande non bastano;
  - le domande già viste su quel dispositivo (`trivela.seen`) restano escluse come prima. Domande e persone si registrano **quando la partita viene creata**, quindi contano anche le partite interrotte.
- Il motore resta deterministico: le persone da far riposare arrivano nella configurazione (`MatchConfig.avoidPeople`).

---

## 6. Torneo

- Da **4 a 12** giocatori. Dispositivo "Direzione Torneo" (qualsiasi ruolo Schermo) gestisce calendario e classifica.
- **Fase 1 — Classifica Generale**
  - ≤ 6 giocatori: girone all'italiana. > 6: abbinamenti svizzeri, K turni (default 3, configurabile), evitando ripetizioni.
  - I **punti segnati in ogni sfida si sommano**. Se il numero di sfide disputate non è uguale per tutti, si ordina per **media punti per sfida**.
  - Spareggi: vittorie → scontro diretto → miglior punteggio in una singola sfida → ordine di iscrizione.
- **Fase 2 — Eliminazione diretta**: i **primi 4** vanno in semifinale (1ª–4ª, 2ª–3ª), poi **finale**. Ogni partita riparte da 0.
- Il filtro anno è fissato a livello di torneo.
- **Nessuna domanda si ripete** in tutto il torneo (insieme delle istanze usate a livello di torneo); inoltre storico per dispositivo delle istanze già viste.
- Persistenza sul dispositivo + esportazione/importazione JSON.
- UI: classifica stile "HI-SCORE" tra una sfida e l'altra.

---

## 7. Argomento libero

**Rimosso con la v5 (§0.6).** Non esistono più l'argomento a piacere né i giochi che lo usavano.

---

## 8. Architettura dati

> **Nota storica.** Le sezioni §8 e §9 descrivono il progetto iniziale (grafo su Postgres, due famiglie di fonti, archivio redazionale) e non sono più in vigore: valgono §0.5 e §0.6. Restano come riferimento per §8.6 (archetipi delle domande "da maniaco") e per le regole sui generatori deterministici.

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

- **Correttore, non completatore**: nessun suggerimento a partire dalle prime lettere (digitando «laut» non compare nulla). Servono almeno **4 lettere**.
- **Tollerante ai refusi e ai suoni**: un suggerimento compare se l'input è a distanza di **Damerau-Levenshtein** (scambi di lettere compresi) entro la tolleranza della lunghezza del nome (1 errore fino a 9 lettere, 2 fino a 13, 3 oltre) **oppure** ha la stessa chiave fonetica («sczesni», «sczesny» e «szczesni» propongono Wojciech Szczęsny; «kvaratskelia» propone Khvicha Kvaratskhelia; «chalanoglu» Hakan Çalhanoğlu). I nomi di 5 lettere o meno vanno scritti per intero («ross» non propone «Rossi»). Mai per fama.
- Si corregge una parola **intera** già digitata: cognome, nome completo o **nome di battesimo raro** (al massimo 8 persone con quel nome nell'indice, di almeno 5 lettere): «lautaro» propone Lautaro Giannetti, Lautaro Martínez e Lautaro Valenti. Un nome di battesimo da solo non è mai una risposta valida e nomi comuni come «marco» non producono suggerimenti.
- Un suggerimento compare solo se l'input è quasi completo: `len(input) ≥ 0.8 × len(candidato)` **e** vale una delle due condizioni di tolleranza qui sopra.
- **Funzione pura** di (testo digitato, indice globale): non riceve la domanda, il contesto, il gioco né il filtro anno.
- Indice globale: tutte le persone, club, città del grafo, di tutte le epoche; scaricato interamente sul client (nessuna query al server).
- Massimo 8 suggerimenti, ordinati per somiglianza e poi alfabeticamente (mai per fama); stile identico per tutti.
- Disattivabile dalle impostazioni.
- **Test obbligatorio in CI**: per un campione di input e un campione di domande diverse, l'output deve essere identico ⇒ informazione reciproca nulla.

### 10.4 Tastiera di gioco (v7)

- Sui dispositivi **touch** i campi delle risposte **non aprono mai la tastiera del sistema** (campo `readonly` con `inputmode="none"`): quella di iOS e Android copriva i suggerimenti del correttore. Si scrive con una **tastiera 8-bit del gioco** (`PixelKeyboard`): lettere, apostrofo, trattino, SPAZIO, CANC, INVIA. La prima lettera di ogni parola diventa maiuscola.
- **Agganciata in basso** dove c'è spazio (tablet, pulsantiere in verticale): il palco o la pagina si accorciano e finiscono dove comincia la tastiera, così tabellone, campo e suggerimenti restano tutti visibili sopra i tasti.
- **Telefono in orizzontale** (altezza sotto i 560 px): il tabellone non starebbe sopra i tasti, quindi la tastiera porta con sé una striscia con **la domanda, il conto alla rovescia, ciò che si sta scrivendo e i suggerimenti** in una riga scorrevole. «▲ TABELLONE» la chiude per guardare lo schermo; toccando il campo si riapre. I pulsanti per passare (§3.8) restano nella striscia.
- I **suggerimenti** stanno sempre sopra i tasti e si toccano senza conflitti. Il correttore non cambia: stessa funzione pura di §10.3.
- Si apre da sola quando tocca scrivere. Una tastiera fisica collegata continua a funzionare; su PC non cambia niente. Il tastierino dei numeri della Maglia era già del gioco.
- I moduli (nomi dei giocatori, anno, codice stanza) usano ancora la tastiera del sistema: lì non ci sono suggerimenti da coprire e servono tutti i caratteri.
- La tastiera sta dentro le aree sicure (§12.6).
- **Esito sulla tastiera (v10)**: sul telefono in orizzontale si vedono solo i tasti e la riga di scrittura, quindi la tastiera stessa dice com'è andato il nome appena inviato: una striscia **verde «✓ GIUSTO»** o **rossa «✗ SBAGLIATO»** con il testo inviato, per 1,6 secondi, in cima alla striscia (in orizzontale) o sopra i tasti (agganciata). Vale per tutti i giochi a risposta scritta (Formazione, Decina, Dischetto, Asta, Mercato, Giramondo), sullo schermo singolo e sulle pulsantiere, dove si vede solo l'esito delle proprie risposte. È la stessa informazione che lo Schermo mostra subito dopo (§3.6), quindi non anticipa nessuna soluzione.

### 10.5 Modalità A

La Regia mostra risposta ufficiale, varianti accettate e fonti; il conduttore valida a voce.

---

## 11. Prima Pagina

**Rimossa con la v5.1** (sostituita da L'Anomalia Statistica, §4.2): niente più testata di fantasia né pagine di quotidiano.

---

## 12. Più dispositivi, abbinamento, orientamento

### 12.1 Stanze senza server

- **Lo Schermo è l'autorità**: `apps/web/src/runtime/roomCore.ts` esegue il motore (`packages/engine`) nel browser dello Schermo, applica i permessi per ruolo, arma i timer e produce le viste. Nessun server nostro.
- I telefoni inviano **intenzioni** (`START`, `BEGIN_GAME`, `NEXT`, `BUZZ`, `REVEAL_CLUE`, `CHOOSE`, `ANSWER`, `VERDICT`, `BID`, `PASS`, `FINISH`) e ricevono **viste filtrate**:
  - canale `pub` (pulsantiere): la stessa vista dello Schermo, **mai le soluzioni prima della rivelazione**;
  - canale `host` (Regia): soluzioni e copione del solo gioco in corso.
- Permessi: la Regia può tutto; le pulsantiere agiscono solo per il proprio giocatore; se c'è una Regia, solo lei fa avanzare il gioco; i `TIMEOUT` li genera solo lo Schermo.
- Trasporto (`transport.ts`, `mqtt.ts`): MQTT 3.1.1 su WebSocket sicuro verso **più relay pubblici gratuiti in parallelo** (deduplica per mittente+sequenza). Payload cifrato AES-GCM con chiave derivata dal codice stanza; il topic è un hash del codice. `?relay=ws://…` usa un relay proprio, `?relay=local` collega le schede dello stesso browser (demo e test).
- Schermo singolo: lo stesso motore gira in locale senza alcuna rete.

### 12.2 Abbinamento

- Lo Schermo crea la stanza: **codice di 5 lettere** (alfabeto senza caratteri ambigui) + **QR per ruolo** (`#/join/ABCDE?r=host|p1|p2`). In alternativa: «ENTRA CON CODICE» sul telefono.
- Sala d'attesa con scelta della modalità (senza conduttore: 2 pulsantiere; con conduttore: Regia) e stato dei dispositivi. La partita parte quando i telefoni richiesti sono collegati.
- Presenza: ogni telefono manda un battito ogni 3 s; dopo 12 s di silenzio è considerato scollegato. Un telefono che si ricollega riceve subito la vista corrente.

### 12.3 Equità del pulsante tra dispositivi

- Sincronizzazione dell'orologio (ping ripetuti, mediana degli scarti) ⇒ ogni telefono conosce lo scarto rispetto allo Schermo.
- Il telefono invia l'istante della pressione già convertito nell'ora dello Schermo.
- Lo Schermo raccoglie le pressioni per **250 ms** dalla prima ricevuta e assegna al tempo più basso.

### 12.4 Orientamento e schermo

- Schermo: orizzontale; sui telefoni in verticale compare l'invito a ruotare. Regia e pulsantiere funzionano in entrambi gli orientamenti.
- Wake Lock API per evitare lo spegnimento.

### 12.5 Telefoni in verticale e schermo largo (v6)

- **Regia e pulsantiere** sono pensate per **telefono verticale**: la pagina (`.phone-shell`) ha un'intestazione compatta (stato, punti, controlli del tempo), un'area centrale e le **azioni principali fissate in basso**, nella zona del pollice. Le quattro opzioni del Tiro Secco e dell'Anomalia, il pulsante PRENOTA e il tastierino non richiedono scorrimento; i bersagli sono alti almeno 56–64 px.
- **Schermo** orizzontale largo: giocatore 1 a sinistra e giocatore 2 a destra con avatar e punteggio, tabellone e contenuto del gioco al centro.
- **Schermo singolo con pulsanti** (prenotazione): pulsanti grandi ai lati, ergonomici per le due mani, area centrale leggibile.
- Tecnica: dimensioni con `clamp()` e **Container Queries** (`container-type: inline-size`) per adattare i componenti al loro contenitore e non solo alla finestra.
- Verifica: `tools/shots.mjs` (PC, tablet, telefono orizzontale) e `tools/e2e.mjs` (opzioni dentro lo schermo senza scorrere, altezza minima dei pulsanti).

### 12.6 Telefono in orizzontale: aree sicure e rotazione (v7)

- L'app è pensata prima di tutto per lo **smartphone in orizzontale**.
- **Aree sicure**: gli inset del dispositivo (`env(safe-area-inset-*)`: notch, Dynamic Island, foro della fotocamera, barra della home) sono variabili CSS (`--sal`, `--sar`, `--sat`, `--sab`). Dentro il palco, che è una tela scalata, vengono moltiplicati per l'inverso della scala (`--inv`): prima valevano meno pixel reali del dovuto. Tabellone, X di uscita, contenuto del gioco, tastiera e pagine dei telefoni restano dentro.
- **Rotazione accidentale**: se durante una partita il telefono finisce in verticale, compare a tutto schermo «Per favore, ruota il dispositivo in orizzontale». Sotto non viene smontato né ridimensionato niente: **punteggi, conto alla rovescia e testo già scritto restano dove sono**, e rigirando il telefono si riprende dallo stesso punto. Il tempo continua a scorrere: la rotazione non è una pausa.
- Verifica in `tools/e2e.mjs` con un telefono touch 844×390 e inset simulati: posizione di tabellone, uscita e tasti; testo e timer dopo la rotazione; durata del tempo extra.

### 12.7 App installabile (v8)

- `vite-plugin-pwa` genera il manifest e il service worker. Aggiunta alla schermata Home, TRIVELA si apre **a tutto schermo** (`display: "fullscreen"`, con `standalone` come ripiego), senza barra degli indirizzi né gesti del browser. Orientamento libero: lo Schermo si usa in orizzontale, Regia e pulsantiere in verticale.
- Icone PNG 192/512, una «maskable» per Android e una per iOS (`tools/icons.mjs` le ridisegna da `icon.svg`); meta tag per iOS (`apple-mobile-web-app-capable`, barra di stato traslucida).
- Il service worker si **aggiorna da solo** (`autoUpdate`): non serve più ricaricare due volte. Mette in cache l'app; i pacchetti delle domande restano a richiesta (§0.4) e vengono conservati solo dopo essere stati usati (rete prima, cache senza rete). I telefoni continuano a non scaricarli.
- (v14) Le bandiere di *Le Bandiere* (`flags/`) non entrano nella precache: si scaricano quando il gioco è sorteggiato e restano in cache (`trivela-flags`, prima la cache).
- Niente pull-to-refresh, rimbalzo, zoom al doppio tocco né menu del tocco lungo (`overscroll-behavior: none`, `touch-action: manipulation`).
- Su Android il menu mostra «▼ INSTALLA L'APP» quando il browser lo permette; le Impostazioni spiegano come aggiungerla alla Home su iPhone (Condividi → Aggiungi alla schermata Home) e su Android.
- Dal browser di un telefono, senza installare, il primo tocco su «PREMI START» chiede lo schermo intero (non su iPhone, dove il browser non lo consente: lì serve l'installazione).

### 12.8 Consenso dei due telefoni (v8)

- Con **due pulsantiere e nessuna Regia**, i pulsanti che fanno avanzare il gioco sono **voti**: SI PARTE, VIA, AVANTI e **PROSSIMO INDIZIO** (timer spento, o dopo l'errore dell'avversario). Il gioco avanza solo quando hanno premuto tutti i giocatori che hanno voce:
  - per AVANTI e simili, i due telefoni collegati;
  - per un indizio, solo chi è ancora in gioco su quel profilo (chi ha sbagliato è fuori e non blocca l'altro).
- Il telefono che ha premuto mostra **«1/2 · IN ATTESA DELL'AVVERSARIO…»** con il pulsante disattivato; l'altro vede «PROSSIMO INDIZIO ▶ · 1/2». Lo Schermo mostra **«AVANTI DAI TELEFONI»** (o «PROSSIMO INDIZIO DAI TELEFONI») con una **spunta verde** per chi ha premuto, e in questa modalità non ha un suo pulsante AVANTI.
- I voti valgono per un solo momento del gioco: se il gioco va avanti da solo (una prenotazione, una risposta, il tempo) quelli a metà vengono annullati. Se un telefono si scollega, il suo voto non serve più. Il comando parte dallo Schermo, che è l'autorità (§12.1): non c'è nessun server.
- Con la Regia decide il conduttore, come prima; sullo schermo singolo i giocatori sono davanti allo stesso dispositivo.
- Nel codice: `RoomCore.vote`, `Votes` nel messaggio `view`; test in `roomCore.test.ts` ed e2e.

### 12.9 Tocco, aree e vibrazioni sul telefono (v8)

- **Aree di tocco da almeno 48×48 pixel reali**. Dentro il palco, che sul telefono è rimpicciolito, le misure si moltiplicano per `--inv` (l'inverso della scala): la X di uscita, i pulsanti piccoli, i suggerimenti. Fuori: la X della Regia, «▲ TABELLONE», i selettori della Home. I tasti della tastiera di gioco hanno un'area invisibile che copre metà dello spazio tra un tasto e l'altro: nessuna zona morta.
- **Vibrazioni** (dove il browser le supporta: Android sì, iPhone no), disattivabili dalle Impostazioni:
  1. **mi prenoto**: un colpo da 50 ms;
  2. **l'avversario si prenota prima di me**: due colpi brevi (30, 50, 30);
  3. **scade il tempo e partono i 10 secondi extra** (§3.8), sul telefono di chi sta scrivendo o sul dispositivo dello schermo singolo: due colpi lunghi (120, 60, 120);
  4. **(v10) esito del nome scritto**, mentre la tastiera è aperta: giusto un colpo breve (25 ms), sbagliato tre colpi (70, 40, 70, 40, 70).

---

## 13. Audio

- **Sblocco**: la schermata "PREMI START" è il gesto che sblocca l'`AudioContext`. Su iOS: Audio Session API impostata su riproduzione + avviso sull'interruttore silenzioso.
- **Musica ambient**: un loop lento e morbido, sintetizzato con la Web Audio API, di otto battute (Am9 – Fmaj7 – Cmaj7 – G6, due battute ciascuno) a **66 BPM**. Solo onde **sine e triangle** (mai square o sawtooth), attacchi e rilasci lunghi, un filtro passa-basso a 1500 Hz sul canale musica, nessun rumore: un tappeto sonoro, non un motivetto. Tre livelli appena percettibili: timer attivo ⇒ 72 BPM e un battito lieve; ultimo gioco ⇒ 78 BPM e un'eco più acuta. Volume predefinito basso (0.3, mix massimo 0.24).
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

### 14.1 «Juiciness» e fluidità (v6, v6.1)

Effetti aggiunti senza toccare le animazioni esistenti; tutti spenti con `prefers-reduced-motion`:

- **Scossa dello schermo** a ogni risposta sbagliata (oltre al rosso di §3.6).
- **Punti volanti**: un «+2» / «+3» in pixel verde (con una scintilla a forma di moneta sul punteggio) sale dal giocatore che segna.
- **Wipe a scacchiera** a pixel tra un gioco e il successivo e verso i risultati.
- **Scanline CRT** leggere (statiche) e elementi di sfondo che scorrono piano (nuvole, stelle, un pallone).

**Fluidità a 60 fps (v6.1)**: le animazioni di movimento (comparsa, scossa, wipe, punti volanti, lucido dei pulsanti) usano solo `transform` e `opacity`, con curve morbide (`cubic-bezier`); lo stile a scatti (`steps()`) resta solo per il lampeggio, le stelle, il cursore e simili. Niente animazioni di `clip-path`, `left/top`, `box-shadow`, né `mix-blend-mode` a schermo intero: i fasci di luce dei riflettori sono immagini già disegnate ruotate con `transform`. Misura: con `requestAnimationFrame` in Chromium senza GPU la schermata di gioco passa da 30 a 60 fps (mediana 16,7 ms, nessun frame sopra i 20 ms).

**Barra superiore (v6.1)**: la barra del tabellone sta sopra il contenuto (`z-index`), ha sfondo pieno e `overflow: hidden`; i nomi lunghi vanno a capo su due righe; il «+N» che sale è disegnato solo dai punti volanti nell'arena. Corretto un bug per cui i riquadri del punteggio si duplicavano nella barra: due chiavi React uguali (due `Date.now()` nello stesso millisecondo) facevano restare vecchi riquadri. Ora le chiavi vengono da un contatore.

### 14.2 Tocchi 3D voxel (v8)

- Pochi elementi in **3D voxel** (cubi a vista, come la pixel art 3D) che non snaturano il 2D: nessuna libreria 3D (Three.js avrebbe pesato più dell'app intera).
  - **Pulsantone dei telefoni**: un blocco a gradini visto dall'alto in prospettiva (CSS 3D: sette strati sovrapposti con il bordo a pixel). Premendolo, la cima e gli strati **scendono lungo l'asse Z**; solo `transform`, 70 ms.
  - **Pallone delle attese** (caricamento, telefoni in attesa della partita o della stanza, Regia, sala d'attesa che si collega): sfera voxel bianca con le pezze nere, che ruota piano.
  - **Coppa del vincitore**: trofeo d'oro voxel con base di legno e due manici, che ruota sotto una **luce che gira** (riflessi che scorrono sull'oro) con un alone che pulsa. In caso di pareggio resta la coppa in pixel art.
- Pallone e coppa sono disegnati da un piccolo motore su canvas (`components/voxel.ts`): solo le facce che toccano il vuoto e girate verso chi guarda, colorate per faccia (luce diffusa più riflesso sull'oro), dalla più lontana alla più vicina. La tela è piccola (52 e 96 pixel) e la pagina la ingrandisce con `image-rendering: pixelated`: i pixel restano netti. Al massimo 30 fotogrammi al secondo; con «riduci animazioni» un solo fotogramma fermo.
- Anteprima: `?voxel` nell'indirizzo mostra coppa e pallone (serve ai controlli visivi).

---

## 15. Stack e struttura del repository

| Strato | Scelta |
|---|---|
| Linguaggi | TypeScript (app, motore, stanze); Python 3.12 (dati e generatori) |
| App | React + Vite, app installabile (`vite-plugin-pwa`, §12.7) pubblicata su GitHub Pages |
| Motore | `packages/engine`: TypeScript puro e deterministico (RNG con seme) |
| Più dispositivi | Nessun server nostro: lo Schermo ospita la stanza, messaggi cifrati via relay MQTT pubblici (§12) |
| Dati | DuckDB sul dataset Transfermarkt; pacchetti JSON statici, uno per gioco, scaricati a richiesta |
| Audio | Web Audio API, tutto sintetizzato |

```
trivela/
├─ apps/web/               # PWA: schermo singolo, Schermo/Regia/pulsantiere, torneo
│  ├─ src/components/      # palco adattivo, tabellone, sprite, campi di testo
│  ├─ src/games/           # viste dei 9 giochi
│  ├─ src/runtime/         # caricamento pacchetti, stanza (roomCore), trasporto MQTT
│  ├─ src/screens/         # nuova sfida, partita, sala d'attesa, telefoni, torneo
│  └─ public/data/         # manifest, indice dei nomi, un pacchetto per gioco (versionati)
├─ packages/
│  ├─ protocol/            # tipi condivisi
│  ├─ engine/              # 9 giochi, sorteggio, torneo
│  ├─ matcher/             # normalizzazione, accettazione, correttore a zero informazione
│  └─ audio/               # musica ed effetti sintetizzati
├─ data/
│  ├─ trivela_data/        # tm_core (strato dei fatti), gen_lists, gen_matches, gen_players, gen_quiz, managers, postprocess, generate, sync
│  ├─ static/managers.json # date di nascita degli allenatori (Wikidata)
│  └─ tests/               # invarianti dei pacchetti (≥ 1000 domande per gioco, ecc.)
└─ tools/                  # e2e.mjs (stanze con relay locale), shots.mjs (controllo visivo)
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

> **Nota storica.** La tabella che segue è la roadmap iniziale; lo stato attuale è descritto in §0.6.

| Milestone | Contenuto | Criteri di accettazione |
|---|---|---|
| **M0 — Fondamenta e dati** | Scaffolding monorepo + CI. Schema del grafo su Postgres. Ingestione livello A (Wikidata, Wikipedia, openfootball, StatsBomb) per la Serie A e le coppe europee. Scelta provider livello B. Regola delle due famiglie. Generatori: `mercato`, `dischetto`, `decina`, `giramondo`, `maglia`. | ≥ 1.000 istanze generate con soli campi `concordant`; report di copertura per anno; revisione a campione senza errori. |
| **M1 — Motore + B1** | `packages/engine` con sorteggio e turni; `tiro_secco` da un primo archivio di ~150 domande pubblicate; matcher + aiuto ortografico; doppio pulsante; UI arcade di base; audio di base; filtro anno. | Partita completa giocabile offline su tablet; test "zero informazione" verde. |
| **M2 — Multi-dispositivo + argomento libero** | Stanze su Durable Objects, QR, rientro, orientamento; Modalità A e B3; `formazione`, `prima_pagina`, `cassaforte`; servizio `topic` con espansione nel grafo. | Serata reale PC + Regia + 2 telefoni; argomenti di prova ("La Juve di Conte 2011/12", "Il Mondiale Under-20 del 2005", "L'Udinese degli anni 2000") generano Prima Pagina e Cassaforte. |
| **M3 — Contenuti su scala** | Pipeline redazionale (estrazione con citazioni, validatore, PR); coda di verifica livello C; estrattori archetipi 1/2/3/5; filtro di curiosità; `frame`, `intruso`, `mappamondo`. | ≥ 1.000 aneddoti pubblicati; ogni gioco del pool ha istanze per ANNO ∈ {1990, 2000, 2010}. |
| **M4 — Completamento** | `asta`, `filo_rosso`; Torneo completo; musica dinamica a livelli; rifinitura PWA; calibrazione difficoltà. | Torneo da 8 giocatori in una serata senza interventi tecnici. |

---

## 19. Questioni aperte

1. Nomi definitivi dei giochi (provvisori: Tiro Secco, L'Anomalia Statistica, Il Mercato, La Decina, Dal Dischetto, La Formazione, Il Giramondo, L'Asta, La Maglia) e della testata della Prima Pagina.
2. Provider Postgres e hosting del servizio `topic`.
3. Provider di livello B.
4. Chi compone la redazione/revisione (autore ≠ revisore).
5. Licenza del progetto (privato/proprietario o open source).
6. Telemetria anonima per la calibrazione della difficoltà: sì/no.
7. Eventuale verifica del marchio "TRIVELA" in caso di pubblicazione sugli store.
