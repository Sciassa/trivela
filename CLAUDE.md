# CLAUDE.md — Istruzioni operative per TRIVELA

TRIVELA è un quiz calcistico arcade 1v1 multi-dispositivo. **`SPEC.md` è la fonte di verità**: leggila prima di lavorare su un'area e aggiornala nello stesso commit quando una decisione cambia. Se codice e SPEC divergono, vale la SPEC finché l'utente non decide diversamente.

## Lingue

- Codice, identificatori, nomi di file, commenti tecnici: **inglese**.
- Testi dell'interfaccia, contenuti, documentazione (`SPEC.md`, `README.md`, questo file): **italiano**.
- Gli `id` dei giochi sono quelli di SPEC §4 (`tiro_secco`, `anomalia`, `mercato`, `decina`, `dischetto`, `formazione`, `giramondo`, `frame`, `asta`, `maglia`). I nomi visualizzati stanno in un unico file (`apps/web/src/rules.ts`), perché alcuni sono ancora provvisori.

## Invarianti non negoziabili

Ogni modifica deve rispettarle. Se una richiesta le viola, fermati e chiedi.

1. **Nessun fatto non verificato, una sola fonte.** Tutti i dati vengono dal dataset Transfermarkt `dcaribou/transfermarkt-datasets` (SPEC §0.5): stagioni 2012/13–2025/26, Mondiali dal 2006, Europei dal 2008, trasferimenti. Unica eccezione registrata (SPEC §0.6): le date di nascita degli allenatori, da Wikidata. Non aggiungere altre fonti senza una decisione dell'utente registrata nella SPEC. Si scartano i record con campi mancanti o incoerenti (es. partite in cui gli eventi-gol non tornano con il risultato). Classifiche e insiemi si calcolano solo su finestre interamente coperte e dichiarano sempre competizione e stagioni.
2. **Nessun LLM** (vincolo "tutto gratis", SPEC §0.1): né in gioco né nella pipeline. Testi e Copioni nascono da template sui fatti dell'istanza.
3. **Niente contestazioni.** Non aggiungere pulsanti "contesta", "segnala errore", override tra giocatori o alias appresi dagli utenti. Gli alias arrivano solo da fonti.
4. **Aiuto ortografico a zero informazione** (SPEC §10.3): correttore e non completatore, funzione pura di (testo digitato, indice globale). Niente suggerimenti per prefisso («laut»), niente ordinamento per fama: se serve cambiare questa regola chiedi all'utente. Non passargli mai la domanda, il gioco, il contesto o il filtro anno. Il test di proprietà in CI non va mai indebolito né saltato.
5. **Le soluzioni non arrivano mai allo Schermo né alle pulsantiere prima della rivelazione.** Le viste sono filtrate per ruolo (`viewFor`, `RoomCore`): solo il canale della Regia porta le soluzioni, e solo del gioco in corso.
6. **Filtro anno** secondo la tabella SPEC §3.3: elenchi e classifiche (`decina`, `dischetto`, `asta`) lo ignorano.
   **Filtro campionati** (SPEC §3.4): vale per tutti i giochi, liste comprese; nazionali e grandi tornei sono sempre inclusi. Ogni istanza deve portare il tag `comp:` del suo campionato (lo verifica `test_league_tags`).
7. **Niente argomento a piacere** (rimosso, SPEC §0.6): non reintrodurre menu o campi di argomento.
8. **Identità originale**: nessun nome, logo o voce di trasmissioni, conduttori o persone reali usati come branding; Nessun box "pagelle".
9. **Fonti nel rispetto dei termini**: mai scraper verso siti che lo vietano. I dati Transfermarkt arrivano solo dal dataset pubblicato, mai dal sito. Niente crawler che aggirano protezioni anti-bot (es. SofaScore): servirebbe una licenza.
10. **Motore deterministico**: `packages/engine` è TypeScript puro, senza accesso a orologio, rete, DOM o `Math.random` (usa l'RNG con seme). Lo stesso motore gira nello schermo singolo e nello Schermo che ospita una stanza.
11. **Domande inedite e su giocatori noti** (SPEC §0.4): mai riproporre i casi degli episodi usati come ispirazione (`postprocess.SHOW_FINGERPRINTS`); un giocatore è protagonista solo se supera il filtro notorietà. Non indebolire questi filtri.
12. **Caricamento a richiesta**: i telefoni (Regia, pulsantiere) non scaricano mai i pacchetti dei giochi (domande e soluzioni); lo Schermo scarica solo i giochi sorteggiati. Le pulsantiere scaricano solo l'indice dei nomi, perché il correttore ortografico deve funzionare su ogni dispositivo che scrive (SPEC §10.3); la Regia non scarica nulla.
13. **Almeno 1000 domande per gioco** e **round brevi** (SPEC §0.6): al massimo 2 domande a testa per gioco (1 partita a testa per Il Frame), una sola lista per Decina e Dischetto. `data/tests/test_packs.py` verifica i conteggi.
14. **Nessun server nostro per le stanze** (SPEC §12): lo Schermo è l'autorità, i messaggi passano cifrati da relay pubblici. Non reintrodurre un backend senza una decisione dell'utente.
15. **Niente tagliato a schermo**: il contenuto di gioco sta dentro il palco adattivo e il componente `Fit`; ogni nuova schermata va controllata con `tools/shots.mjs` su PC, tablet e telefono orizzontale.

## Struttura

- `apps/web`: PWA React. `src/components` (palco adattivo `Stage`, `Fit`, tabellone, sprite, campi di testo), `src/games/GameView.tsx` (i 10 giochi), `src/screens` (nuova sfida, partita, sala d'attesa e telefoni, torneo), `src/runtime` (`packs` caricamento a richiesta, `roomCore` autorità della stanza, `transport` + `mqtt` relay cifrato, `room` hook React).
- `packages/protocol` (tipi condivisi), `packages/engine` (10 giochi, sorteggio, torneo), `packages/matcher` (normalizzazione, accettazione, correttore), `packages/audio` (musica ed effetti sintetizzati).
- `data/trivela_data`: `tm_core` (strato dei fatti verificati e grammatica italiana), `gen_lists` (classifiche e insiemi), `gen_matches` (formazione), `gen_frame` (partite iconiche), `gen_anomalie` (record bizzarri), `gen_players` (mercato, giramondo, maglia), `gen_quiz` (curiosità del Tiro Secco), `managers` (date di nascita degli allenatori da Wikidata), `postprocess` (domande inedite, notorietà), `generate` (scrive `apps/web/public/data/`), `sync` (riscarica il dataset se è cambiato e rigenera).
- `tools/e2e.mjs` (test end-to-end, stanze comprese, con un relay MQTT locale), `tools/shots.mjs` (screenshot di tutti i giochi a più formati).

## Comandi

- JS (pnpm workspaces): `pnpm install` · `pnpm dev` (app su Vite) · `pnpm typecheck` · `pnpm test` · `pnpm build` · `pnpm e2e` (dopo `pnpm build`) · `node tools/shots.mjs` (dopo `pnpm build`)
- Pubblicazione: GitHub Pages da `main` (`.github/workflows/pages.yml`). Tutte le modalità funzionano dal sito pubblicato.
- Dati (Python 3.12+ con `uv`, dipendenza: `duckdb`): `pnpm data:sync` (scarica il dataset solo se è cambiato e rigenera) · `pnpm data:generate` (solo rigenerazione, circa 20 secondi). I file in `apps/web/public/data/` vanno committati.
- Test dati: `cd data && uv run pytest`
- Il dataset scaricato sta in `data/cache/tm/` (non versionato).

## Convenzioni di sviluppo

- TypeScript `strict`; niente `any` non motivato. Tipi condivisi tra client e server solo in `packages/protocol`.
- Ogni gioco nel motore espone: stato iniziale, reducer delle intenzioni, calcolo dei punti, condizione di chiusura, selettori di vista per ruolo. Ogni regola di SPEC §4 ha almeno un test.
- Generatori Python: ogni istanza porta `fact_ids`, fonti, `year_min`/`year_max`, `snapshot_date`; l'ID è l'hash di `generator_id` + parametri (stabile).
- Il Copione delle istanze generate nasce **solo da template** sui fatti dell'istanza.
- Statistiche cumulative: sempre con definizione e data di aggiornamento visibili.
- UI: palco che riempie sempre lo schermo (tela virtuale di almeno 1600×900, ridotta sui telefoni), contenuto di gioco dentro `Fit`; moduli e telefoni come pagine a scorrimento (`Page`); variabili CSS per i colori; rispettare `prefers-reduced-motion`; target touch ≥ 48 px.
- Audio: solo lo Schermo riproduce suoni; nessun autoplay prima del gesto "PREMI START".

## Test e definizione di "fatto"

Una modifica è finita quando:
- lint, typecheck e test passano (`pnpm test`, `uv run pytest` dove pertinente);
- le regole di gioco toccate hanno test aggiornati;
- per le stanze, `pnpm e2e` copre Schermo + pulsantiere e Schermo + Regia e verifica che Schermo e pulsantiere non ricevano soluzioni;
- per l'interfaccia, gli screenshot di `tools/shots.mjs` non mostrano testi o riquadri tagliati;
- per i dati, nessuna istanza usa campi mancanti o incoerenti e i filtri di `postprocess` restano attivi;
- `SPEC.md` è aggiornata se è cambiato un comportamento.

## Git

- Messaggi di commit in inglese, all'imperativo, con prefisso convenzionale (`feat:`, `fix:`, `data:`, `content:`, `docs:`, `test:`, `chore:`).
- Un branch per attività; niente push diretti su `main` dopo il commit iniziale.
- Non committare segreti: chiavi API e credenziali solo nei secret della piattaforma (CI).
