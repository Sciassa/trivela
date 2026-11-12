# TRIVELA

Quiz calcistico arcade **1 contro 1** per veri maniaci del calcio: pixel art anni '80, musica chiptune generata in tempo reale, 14 mini-giochi, tornei tra amici. Si gioca su 1, 2, 3 o 4 schermi: con un conduttore che usa il telefono come Regia, oppure in modalità automatica con le pulsantiere.

Ogni domanda è calcolata su un'unica fonte uniforme, il dataset pubblico di Transfermarkt (`dcaribou/transfermarkt-datasets`): stagioni 2012/13–2025/26 dei principali campionati e coppe, Mondiali dal 2006, Europei dal 2008 e trasferimenti. Niente domande inventate né prese dalla TV, e solo su giocatori noti.

- [`SPEC.md`](SPEC.md): specifica di prodotto e architettura (fonte di verità; vedi §0.1 per le decisioni della v1)
- [`CLAUDE.md`](CLAUDE.md): istruzioni operative per lo sviluppo

## Giocare

Requisiti: Node 22 e pnpm.

```bash
pnpm install
```

**Schermo singolo** (tablet, PC o telefono in orizzontale), anche offline una volta caricata:

```bash
pnpm dev
```

**Più dispositivi** (Schermo + Regia e/o pulsantiere sulla stessa Wi-Fi), con il server gratuito sul PC:

```bash
pnpm build
```

```bash
pnpm server
```

Il server stampa l'indirizzo da aprire (es. `http://192.168.1.10:8787`). Sullo Schermo scegli *Sfida · più schermi*: compaiono i QR per Regia e pulsantiere.

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
