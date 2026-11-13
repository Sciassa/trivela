import { describe, expect, it } from "vitest";
import type { EntityRecord } from "@trivela/protocol";
import {
  buildIndex,
  editDistance,
  judgeInSet,
  judgeText,
  normalize,
  resolve,
  suggest,
} from "./index";

const P = (id: string, name: string, fame: number, family?: string, aliases: string[] = []): EntityRecord => ({
  id,
  kind: "person",
  name,
  aliases,
  fame,
  family,
});

const entities: EntityRecord[] = [
  P("p1", "Wojciech Szczęsny", 40, "Szczęsny"),
  P("p2", "Hakan Çalhanoğlu", 50, "Çalhanoğlu"),
  P("p3", "Khvicha Kvaratskhelia", 60, "Kvaratskhelia", ["Kvara"]),
  P("p4", "Boško Janković", 5, "Janković"),
  P("p5", "Filippo Inzaghi", 80, "Inzaghi", ["Pippo Inzaghi"]),
  P("p6", "Simone Inzaghi", 70, "Inzaghi"),
  P("p7", "Gladstone Pereira", 3, "Pereira", ["Gladstone"]),
  P("p8", "Paolo Maldini", 90, "Maldini"),
  P("p9", "Cesare Maldini", 40, "Maldini"),
  P("p10", "Nikola Bjelanović", 2, "Bjelanović"),
  P("p11", "Martin Ødegaard", 50, "Ødegaard"),
  P("l1", "Lautaro Martínez", 85, "Martínez"),
  P("l2", "Lautaro Valenti", 40, "Valenti"),
  P("l3", "Lautaro Giannetti", 35, "Giannetti"),
  P("c1", "Marco Rossi", 10, "Rossi"),
  P("c2", "Marco Bianchi", 10, "Bianchi"),
  P("c3", "Marco Verdi", 10, "Verdi"),
  P("c4", "Marco Neri", 10, "Neri"),
  P("c5", "Marco Gialli", 10, "Gialli"),
  P("c6", "Marco Blu", 10, "Blu"),
  P("c7", "Marco Viola", 10, "Viola"),
  P("c8", "Marco Rosa", 10, "Rosa"),
  P("c9", "Marco Grigi", 10, "Grigi"),
  P("m1", "Thiago Motta", 70, "Motta"),
  P("m2", "Thiago Motta", 55, "Motta"),
];
const index = buildIndex(entities, 10);

it("a whole first name points to the people who have it, but a prefix suggests nothing", () => {
  const names = suggest("lautaro", index).map((x) => x.name);
  expect(names).toEqual(["Lautaro Giannetti", "Lautaro Martínez", "Lautaro Valenti"]);
  expect(suggest("Lautaro", index)).toEqual(suggest("lautaro", index)); // case does not matter
  expect(suggest("laut", index)).toEqual([]);
  expect(suggest("lauta", index)).toEqual([]);
  expect(suggest("lautarro", index).map((x) => x.name)).toContain("Lautaro Martínez"); // typo
  expect(suggest("marco", index)).toEqual([]); // too many people called Marco: it would point nowhere
});

it("tolerates the typos of hard names, by closeness and never by fame", () => {
  // spelling slips and sound-alikes of complex names
  for (const typed of ["sczesni", "sczesny", "Szczesni", "SZCZESNY"]) expect(suggest(typed, index).map((x) => x.name)).toContain("Wojciech Szczęsny");
  for (const typed of ["kvaratskelia", "kvaratskhelya", "Kvaratskelya"]) expect(suggest(typed, index).map((x) => x.name)).toContain("Khvicha Kvaratskhelia");
  expect(suggest("chalanoglu", index).map((x) => x.name)).toContain("Hakan Çalhanoğlu");
  // still no completion from the first letters: nothing below four letters, nothing for a prefix
  for (const typed of ["s", "sc", "scz", "szcz", "sczes", "kvar", "hak"]) expect(suggest(typed, index)).toEqual([]);
  // short names must be typed in full
  const rossi = buildIndex([P("r1", "Mario Rossi", 99, "Rossi")]);
  expect(suggest("ross", rossi)).toEqual([]);
  expect(suggest("rosi", rossi)).toEqual([]);
  expect(suggest("rossy", rossi).map((x) => x.name)).toEqual(["Mario Rossi"]);
});

it("orders by closeness then alphabetically, at most eight, whatever the fame", () => {
  const many = buildIndex(
    Array.from({ length: 12 }, (_, i) => P(`b${i}`, `Nome${String.fromCharCode(97 + i)} Bellini`, i === 11 ? 100 : 1, "Bellini")),
  );
  const out = suggest("belini", many);
  expect(out.length).toBe(8);
  expect(out.map((x) => x.name)).toEqual([...out.map((x) => x.name)].sort((a, b) => a.localeCompare(b, "it"))); // equal closeness: alphabetical
  expect(out.map((x) => x.name)).not.toContain("Nomel Bellini"); // the famous one gets no priority
  const mixed = buildIndex([P("m1", "Anna Marchetti", 1, "Marchetti"), P("m2", "Luca Marchesi", 100, "Marchesi")]);
  expect(suggest("marchetty", mixed).map((x) => x.name)[0]).toBe("Anna Marchetti"); // closer beats famous
});

it("a first name alone is never an answer", () => {
  expect(resolve("Lautaro", index)).toEqual({ status: "none" });
  expect(judgeText("Lautaro", { kind: "entity", ids: ["l1"], display: "Lautaro Martínez" }, index)).toBe(false);
});

it("suggests one entry per person even when two profiles share a name", () => {
  expect(suggest("Thiago Mota", index).map((s) => s.name)).toEqual(["Thiago Motta"]);
});

describe("normalize", () => {
  it("strips diacritics and special letters", () => {
    expect(normalize("Szczęsny")).toBe("szczesny");
    expect(normalize("Çalhanoğlu")).toBe("calhanoglu");
    expect(normalize("Ødegaard")).toBe("odegaard");
    expect(normalize("  D'Ambrosio! ")).toBe("dambrosio");
  });
});

describe("editDistance", () => {
  it("counts transpositions as one edit", () => {
    expect(editDistance("inzaghi", "inzagih")).toBe(1);
    expect(editDistance("abc", "abc")).toBe(0);
  });
});

describe("resolve", () => {
  it("accepts surnames with typos", () => {
    expect(resolve("Calanoglu", index)).toMatchObject({ status: "ok", id: "p2" });
    expect(resolve("Kvaratskelia", index)).toMatchObject({ status: "ok", id: "p3" });
    expect(resolve("Sczesny", index)).toMatchObject({ status: "ok", id: "p1" });
    expect(resolve("Bjelanovic", index)).toMatchObject({ status: "ok", id: "p10" });
    expect(resolve("Kvara", index)).toMatchObject({ status: "ok", id: "p3" });
  });

  it("requires the first name for ambiguous famous surnames, whatever the question", () => {
    expect(resolve("Inzaghi", index)).toEqual({ status: "ambiguous_surname" });
    expect(resolve("Maldini", index)).toEqual({ status: "ambiguous_surname" });
    expect(resolve("Simone Inzaghi", index)).toMatchObject({ status: "ok", id: "p6" });
    expect(resolve("Pippo Inzaghi", index)).toMatchObject({ status: "ok", id: "p5" });
  });

  it("rejects unrelated text", () => {
    expect(resolve("Pizza Margherita", index)).toEqual({ status: "none" });
  });
});

describe("judge", () => {
  it("judges entity answers through the global index", () => {
    expect(judgeText("calhanoglu", { kind: "entity", ids: ["p2"], display: "Çalhanoğlu" }, index)).toBe(true);
    expect(judgeText("Szczesny", { kind: "entity", ids: ["p2"], display: "Çalhanoğlu" }, index)).toBe(false);
    // two people with exactly the same name (player and manager): either is accepted
    expect(judgeText("Thiago Motta", { kind: "entity", ids: ["m2"], display: "Thiago Motta" }, index)).toBe(true);
    expect(judgeText("7", { kind: "number", value: 7, display: "7" }, index)).toBe(true);
    expect(judgeText("3", { kind: "number", value: 3, display: "3" }, index)).toBe(true);
  });

  it("matches inside closed sets", () => {
    const set = [
      { id: "p2", name: "Hakan Çalhanoğlu" },
      { id: "p3", name: "Khvicha Kvaratskhelia" },
    ];
    expect(judgeInSet("kvara", set, index)?.id).toBe("p3");
    expect(judgeInSet("Maldini", set, index)).toBeNull();
  });
});

describe("speller: zero information", () => {
  it("never completes from the first letters", () => {
    expect(suggest("Gla", index)).toEqual([]);
    expect(suggest("Glads", index)).toEqual([]);
    expect(suggest("Kvar", index)).toEqual([]);
  });

  it("corrects a name already typed almost entirely", () => {
    expect(suggest("Calhanolgu", index).map((s) => s.name)).toContain("Hakan Çalhanoğlu");
    expect(suggest("Gladstonne", index).map((s) => s.name)).toContain("Gladstone Pereira");
  });

  it("is a pure function of the typed text and the global index", () => {
    // The signature has no slot for the question/context: verify arity and determinism.
    expect(suggest.length).toBe(2);
    const inputs = ["Calhanolgu", "Szczesni", "Odegard", "Kvaratskhelja", "Bjelanovich", "Maldin", "Tiago Motta"];
    const first = inputs.map((t) => suggest(t, index));
    // Simulate other activity (judging other questions) between calls.
    judgeText("Maldini", { kind: "entity", ids: ["p8"], display: "Maldini" }, index);
    resolve("Inzaghi", index);
    const second = inputs.map((t) => suggest(t, index));
    expect(second).toEqual(first);
  });

  it("orders by similarity then alphabetically, never by fame", () => {
    const twins = buildIndex([P("a", "Marco Rossi", 1), P("b", "Mario Rossi", 99)]);
    const out = suggest("Marc Rossi", twins).map((s) => s.name);
    expect(out[0]).toBe("Marco Rossi");
  });
});
