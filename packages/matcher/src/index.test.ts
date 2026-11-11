import { describe, expect, it } from "vitest";
import type { EntityRecord } from "@trivela/protocol";
import {
  buildIndex,
  editDistance,
  haversineKm,
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
  { id: "c1", kind: "city", name: "Torino", aliases: ["Turin"], fame: 50 },
];
const index = buildIndex(entities, 10);

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
    expect(judgeText("Turin", { kind: "entity", ids: ["c1"], display: "Torino" }, index)).toBe(true);
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
    const inputs = ["Calhanolgu", "Szczesni", "Odegard", "Kvaratskhelja", "Bjelanovich", "Maldin", "Turino"];
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

describe("geo", () => {
  it("computes great-circle distances", () => {
    expect(Math.round(haversineKm(45.4642, 9.19, 41.9028, 12.4964))).toBeGreaterThan(470);
    expect(Math.round(haversineKm(45.4642, 9.19, 41.9028, 12.4964))).toBeLessThan(490);
  });
});
