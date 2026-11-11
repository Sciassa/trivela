# CLAUDE.md — Istruzioni operative per TRIVELA

TRIVELA è un quiz calcistico arcade 1v1 multi-dispositivo. **`SPEC.md` è la fonte di verità**: leggila prima di lavorare su un'area e aggiornala nello stesso commit quando una decisione cambia. Se codice e SPEC divergono, vale la SPEC finché l'utente non decide diversamente.

## Lingue

- Codice, identificatori, nomi di file, commenti tecnici: **inglese**.
- Testi dell'interfaccia, contenuti, documentazione (`SPEC.md`, `README.md`, questo file): **italiano**.
- Gli `id` dei giochi sono quelli di SPEC §4 (`tiro_secco`, `prima_pagina`, `mercato`, `decina`, `dischetto`, `formazione`, `cassaforte`, `giramondo`, `frame`, `intruso`, `asta`, `filo_rosso`, `mappamondo`, `maglia`). I nomi visualizzati stanno in un unico file di traduzioni, perché alcuni sono ancora provvisori.

## Invarianti non negoziabili

Ogni modifica deve rispettarle. Se una richiesta le viola, fermati e chiedi.

1. **Nessun fatto non verificato.** Un campo del grafo è usabile in una domanda solo se è `concordant` (≥ 2 famiglie di fonti indipendenti, SPEC §8.3). Wikipedia e Wikidata sono **una sola** famiglia.
2. **Nessun LLM a runtime per produrre fatti o testi mostrati ai giocatori.** L'LLM è ammesso solo nella pipeline redazionale offline (estrazione con citazioni) e, nel servizio `topic`, per **scegliere tra ID candidati** del nostro indice con output validato.
3. **Niente contestazioni.** Non aggiungere pulsanti "contesta", "segnala errore", override tra giocatori o alias appresi dagli utenti. Gli alias arrivano solo da fonti.
4. **Aiuto ortografico a zero informazione** (SPEC §10.3): correttore e non completatore, funzione pura di (testo digitato, indice globale). Non passargli mai la domanda, il gioco, il contesto o il filtro anno. Il test di proprietà in CI non va mai indebolito né saltato.
5. **Le soluzioni non arrivano mai alla vista `screen` prima della rivelazione.** Le viste sono filtrate per ruolo nel server; anche la Prima Pagina riceve solo segnaposto a fasce.
6. **Filtro anno** secondo la tabella SPEC §3.3: elenchi/classifiche (`decina`, `dischetto`, `asta`) e argomento libero (`prima_pagina`, `cassaforte`) lo ignorano.
7. **Argomento libero davvero libero**: niente menu o liste di argomenti. Si rifiuta solo un testo che non corrisponde ad alcuna entità calcistica.
8. **Identità originale**: nessun nome, logo o voce di trasmissioni, conduttori o persone reali usati come branding; nessuna testata giornalistica reale (la Prima Pagina usa una testata di fantasia). Nessun box "pagelle".
9. **Fonti nel rispetto dei termini**: mai scraper massivi di siti che lo vietano (Transfermarkt, Sky Sport, FBref, UEFA.com, ecc. sono fonti di **verifica puntuale**, livello C). Ogni connettore documenta la licenza in `data/ingest/<fonte>/LICENSE.md`.
10. **Motore deterministico**: `packages/engine` è TypeScript puro, senza accesso a orologio, rete, DOM o `Math.random` (usa l'RNG con seme). Lo stesso motore gira nel browser (B1 offline) e nel Durable Object.

## Struttura

Vedi SPEC §15. In breve: `apps/web` (PWA), `apps/realtime` (Worker + Durable Objects), `packages/{engine,matcher,ui-arcade,audio,protocol}`, `data/` (Python: ingest, graph, generators, packs, notebooks), `services/topic`, `content/` (YAML redazionali), `tools/review`.

## Comandi

Lo scaffolding nasce in M0: quando un comando esiste davvero, aggiorna questa sezione.

- JS (pnpm workspaces): `pnpm install` · `pnpm dev` · `pnpm lint` · `pnpm typecheck` · `pnpm test`
- E2E Playwright: `pnpm e2e -- --trace off` (attiva le trace solo per diagnosticare un test che fallisce)
- Python (`uv`): `uv sync` · `uv run pytest` · `uv run ruff check`
- Contenuti: `pnpm content:validate` (validatore YAML + controlli sulle fonti)

## Convenzioni di sviluppo

- TypeScript `strict`; niente `any` non motivato. Tipi condivisi tra client e server solo in `packages/protocol`.
- Ogni gioco nel motore espone: stato iniziale, reducer delle intenzioni, calcolo dei punti, condizione di chiusura, selettori di vista per ruolo. Ogni regola di SPEC §4 ha almeno un test.
- Generatori Python: ogni istanza porta `fact_ids`, fonti, `year_min`/`year_max`, `snapshot_date`; l'ID è l'hash di `generator_id` + parametri (stabile).
- Il Copione delle istanze generate nasce **solo da template** sui fatti dell'istanza.
- Statistiche cumulative: sempre con definizione e data di aggiornamento visibili.
- UI: canvas virtuale 1600×900 scalato per lo Schermo; variabili CSS per i colori; rispettare `prefers-reduced-motion`; target touch ≥ 48 px.
- Audio: solo lo Schermo riproduce suoni; nessun autoplay prima del gesto "PREMI START".

## Test e definizione di "fatto"

Una modifica è finita quando:
- lint, typecheck e test passano (`pnpm test`, `uv run pytest` dove pertinente);
- le regole di gioco toccate hanno test aggiornati;
- per il realtime, il test e2e multi-contesto copre il flusso e verifica che la vista `screen` non contenga soluzioni;
- per i dati, nessuna istanza usa campi non `concordant`;
- `SPEC.md` è aggiornata se è cambiato un comportamento.

## Git

- Messaggi di commit in inglese, all'imperativo, con prefisso convenzionale (`feat:`, `fix:`, `data:`, `content:`, `docs:`, `test:`, `chore:`).
- Un branch per attività; niente push diretti su `main` dopo il commit iniziale.
- Non committare segreti: chiavi API e credenziali solo nei secret della piattaforma (Cloudflare, servizio topic, CI).
