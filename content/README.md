# Archivio redazionale

Domande scritte a mano (aneddoti, citazioni, curiosità: archetipi 4 e 6 della SPEC).
Un file JSON per domanda in `content/questions/`. Entrano nei pacchetti solo con
`"status": "published"` e se superano il validatore:

```bash
pnpm content:validate
```

Regole (SPEC §8.3, §9):

- ogni affermazione in `claims` ha almeno **due fonti di famiglie diverse**, ciascuna con URL e citazione breve;
- la risposta deve comparire nelle citazioni;
- il Copione (`script`) usa solo fatti presenti nelle `claims`;
- `reviewer` deve essere diverso da `author`.

Esempio di struttura (valori fittizi):

```json
{
  "id": "q-000001",
  "game": ["tiro_secco"],
  "archetype": 4,
  "status": "draft",
  "difficulty": 2,
  "question": "<testo>",
  "options": ["<A>", "<B>", "<C>", "<D>"],
  "correct": 0,
  "answer": "<risposta>",
  "year_min": 2006,
  "year_max": 2006,
  "entities": ["wc:2006"],
  "script": "<copione>",
  "claims": [
    {
      "text": "<affermazione>",
      "sources": [
        { "family": "wikimedia", "url": "<url>", "quote": "<citazione>" },
        { "family": "<altra famiglia>", "url": "<url>", "quote": "<citazione>" }
      ]
    }
  ],
  "author": "<nome>",
  "reviewer": "<nome>"
}
```
