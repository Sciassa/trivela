# TRIVELA

Quiz calcistico arcade **1 contro 1** per veri maniaci del calcio: pixel art anni '80, musica chiptune generata in tempo reale, 14 mini-giochi, tornei tra amici. Si gioca su 1, 2, 3 o 4 schermi: con un conduttore che usa il telefono come Regia, oppure in modalità automatica con le pulsantiere.

Ogni domanda nasce da fatti confermati da **almeno due famiglie di fonti indipendenti e gratuite** (openfootball, Wikipedia/Wikidata, StatsBomb Open Data). Se le fonti non concordano, il dato non entra nel gioco. Niente contestazioni, niente dati inventati.

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

I pacchetti di domande sono già in `apps/web/public/packs/`. Per rigenerarli dalle fonti (richiede rete; Wikipedia e Wikidata limitano le richieste, quindi la prima volta servono decine di minuti):

```bash
pnpm data:build
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
