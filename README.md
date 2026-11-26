# TRIVELA

Quiz calcistico arcade **1 contro 1** per veri maniaci del calcio: pixel art anni '80, musica chiptune generata in tempo reale, 12 mini-giochi (due visivi: Indovina lo Stemma e Indovina la Figurina, con le figurine pixel dei giocatori), tornei tra amici.

Si gioca aprendo il sito, senza installare né avviare nulla. Per giocare a tutto schermo sul telefono, aggiungilo alla schermata Home (iPhone: Condividi → «Aggiungi alla schermata Home»; Android: «Installa app»): si apre come un'app, senza barre del browser.

**https://sciassa.github.io/trivela/**

- **Un solo schermo**: tablet, PC o telefono in orizzontale; ci si passa il dispositivo.
- **Schermo + 2 telefoni** (senza conduttore): ogni giocatore usa il proprio telefono come pulsantiera e tastiera. «Avanti» e «Prossimo indizio» si premono in due: nessuno salta un indizio da solo.
- **Schermo + 1 telefono** (con conduttore): il conduttore vede soluzioni e copione sul telefono e convalida le risposte date a voce.
- **Sfida Rapida**: due giocatori, un solo gioco a scelta, 3 round a testa (anche con i telefoni).
- **Allenamento**: da solo, un gioco a scelta, nessun avversario.
- **Torneo** da 4 a 12 giocatori con classifica, semifinali e finale.

Per le modalità con i telefoni: sullo schermo principale scegli *Schermo + telefoni*, poi inquadra il QR con ogni telefono (oppure apri lo stesso sito sul telefono, tocca *Entra con codice* e scrivi il codice di 5 lettere). Non serve la stessa Wi-Fi: basta internet su ogni dispositivo. Lo schermo principale può essere anche un telefono in orizzontale.

Ogni partita sorteggia 5 giochi su 12; ogni gioco dura al massimo 2 domande a testa. Dalla schermata iniziale si scelgono il **timer** (acceso, con 10 secondi extra per finire di scrivere, oppure spento) e il **filtro anno**. Sui telefoni e sui tablet si scrive con la tastiera del gioco. Tutte le domande (oltre 20.000, almeno 1000 per gioco; i due giochi visivi ne hanno quante ne permettono stemmi e foto con licenza) sono calcolate sul dataset pubblico di Transfermarkt (`dcaribou/transfermarkt-datasets`): stagioni 2012/13–2025/26 dei principali campionati e coppe, Mondiali dal 2006, Europei dal 2008 e trasferimenti. Niente domande inventate né prese dalla TV, e solo su giocatori noti. Stemmi e foto vengono solo da Wikimedia Commons con licenza libera verificata file per file (CC0, pubblico dominio, CC BY, CC BY-SA): autori e licenze sono nella pagina «Fonti dei dati».

- [`SPEC.md`](SPEC.md): specifica di prodotto e architettura (fonte di verità; §0.6 per le decisioni correnti)
- [`CLAUDE.md`](CLAUDE.md): istruzioni operative per lo sviluppo

## Come funziona il collegamento senza server

Lo schermo principale ospita la partita ed è l'unico a scaricare domande e soluzioni. I telefoni scambiano con lui piccoli messaggi cifrati attraverso relay MQTT pubblici e gratuiti (più di uno in parallelo). Sono servizi di terzi senza garanzie: se un giorno non fossero raggiungibili, la modalità a un solo schermo funziona comunque.

## Sviluppo

Requisiti: Node 22 e pnpm.

```bash
pnpm install
```

```bash
pnpm dev
```

## Dati

I dati delle domande sono già in `apps/web/public/data/` (un file per gioco, scaricato solo quando il gioco viene sorteggiato). Per aggiornarli (scarica il dataset da circa 210 MB solo se è cambiato, poi rigenera in meno di un minuto):

```bash
pnpm data:sync
```

Stemmi e foto (Indovina lo Stemma, Indovina la Figurina) arrivano da Wikidata e Wikimedia Commons con una pipeline a parte, da lanciare a mano. Il primo comando scarica a lotti, rispettando i limiti di Wikimedia, e riprende da dove si era fermato; il secondo lavora offline.

```bash
cd data && uv run python -m trivela_data.assets fetch --download 300
```

```bash
cd data && uv run python -m trivela_data.assets build
```

Poi `pnpm data:generate` e `node tools/flags.mjs`.

## Test

```bash
pnpm test
```

```bash
pnpm build && pnpm e2e
```

```bash
cd data && uv run pytest
```
