# TRIVELA

Quiz calcistico arcade **1 contro 1** per veri maniaci del calcio: pixel art anni '80, musica chiptune generata in tempo reale, 10 mini-giochi, tornei tra amici.

Si gioca aprendo il sito, senza installare né avviare nulla:

**https://sciassa.github.io/trivela/**

- **Un solo schermo**: tablet, PC o telefono in orizzontale; ci si passa il dispositivo.
- **Schermo + 2 telefoni** (senza conduttore): ogni giocatore usa il proprio telefono come pulsantiera e tastiera.
- **Schermo + 1 telefono** (con conduttore): il conduttore vede soluzioni e copione sul telefono e convalida le risposte date a voce.
- **Sfida Rapida**: due giocatori, un solo gioco a scelta, 3 round a testa (anche con i telefoni).
- **Allenamento**: da solo, un gioco a scelta, nessun avversario.
- **Torneo** da 4 a 12 giocatori con classifica, semifinali e finale.

Per le modalità con i telefoni: sullo schermo principale scegli *Schermo + telefoni*, poi inquadra il QR con ogni telefono (oppure apri lo stesso sito sul telefono, tocca *Entra con codice* e scrivi il codice di 5 lettere). Non serve la stessa Wi-Fi: basta internet su ogni dispositivo. Lo schermo principale può essere anche un telefono in orizzontale.

Ogni partita sorteggia 5 giochi su 10; ogni gioco dura al massimo 2 domande a testa. Tutte le domande (oltre 14.000, almeno 1000 per gioco) sono calcolate sul dataset pubblico di Transfermarkt (`dcaribou/transfermarkt-datasets`): stagioni 2012/13–2025/26 dei principali campionati e coppe, Mondiali dal 2006, Europei dal 2008 e trasferimenti. Niente domande inventate né prese dalla TV, e solo su giocatori noti.

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
