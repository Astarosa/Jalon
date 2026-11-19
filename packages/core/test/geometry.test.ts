import { describe, it, expect } from "vitest";
import {
  calibrateTwoPoints, calibrateRatio, parseRatio, measure, calibrationAt, similarityFromPairs,
  applySimilarity, transferPoint, mppFromNumberFormats, niceScaleBar, ratioFromMpp, controlErrorPct, nextIndice,
  SnapIndex, formatLength, formatArea,
} from "../src";

const A1 = { w: 2384, h: 1684 }; // A1 paysage en points

describe("étalonnage", () => {
  it("deux points : tient compte des dimensions non carrées", () => {
    // 1000 pt horizontalement = 10 m
    const mpp = calibrateTwoPoints({ x: 0, y: 0.5 }, { x: 1000 / A1.w, y: 0.5 }, A1, 10);
    expect(mpp).toBeCloseTo(0.01, 9);
    // même longueur relative en vertical ≠ même distance
    const r = measure("distance", [{ x: 0.1, y: 0 }, { x: 0.1, y: 1000 / A1.h }], A1, [{ id: "p", zone: null, metres_par_point: mpp }]);
    expect(r.valeur).toBeCloseTo(10, 6);
  });
  it("ratio 1/100 ≈ 3,528 cm par point", () => {
    expect(calibrateRatio(100)).toBeCloseTo(0.035277777, 6);
    expect(ratioFromMpp(calibrateRatio(50))).toBeCloseTo(50, 9);
  });
  it("lecture des échelles", () => {
    expect(parseRatio("1/100")).toBe(100);
    expect(parseRatio("1:50")).toBe(50);
    expect(parseRatio(" 200 ")).toBe(200);
    expect(parseRatio("1/2,5")).toBe(2.5);
    expect(parseRatio("abc")).toBeNull();
  });
  it("contrôle", () => expect(controlErrorPct(10.1, 10)).toBeCloseTo(1, 9));
});

describe("zones", () => {
  const page = { id: "page", zone: null, metres_par_point: 0.0353 };
  const detail = { id: "det", zone: { x0: 0.6, y0: 0.6, x1: 0.9, y1: 0.9 }, metres_par_point: 0.007 };
  const inner = { id: "in", zone: { x0: 0.7, y0: 0.7, x1: 0.8, y1: 0.8 }, metres_par_point: 0.001 };
  it("choisit la plus petite zone contenant le point", () => {
    expect(calibrationAt({ x: 0.1, y: 0.1 }, [page, detail, inner])?.id).toBe("page");
    expect(calibrationAt({ x: 0.65, y: 0.65 }, [page, detail, inner])?.id).toBe("det");
    expect(calibrationAt({ x: 0.75, y: 0.75 }, [page, detail, inner])?.id).toBe("in");
  });
  it("sans étalonnage de page : rien hors zone", () => {
    expect(calibrationAt({ x: 0.1, y: 0.1 }, [detail])).toBeUndefined();
  });
  it("signale les mesures à cheval", () => {
    const r = measure("distance", [{ x: 0.5, y: 0.5 }, { x: 0.65, y: 0.65 }], A1, [page, detail]);
    expect(r.zonesMelangees).toBe(true);
    expect(r.calibration?.id).toBe("page");
  });
});

describe("mesures", () => {
  const cal = [{ id: "p", zone: null, metres_par_point: 0.01 }];
  const sq = (s: number) => [
    { x: 0, y: 0 }, { x: s / A1.w, y: 0 }, { x: s / A1.w, y: s / A1.h }, { x: 0, y: s / A1.h },
  ];
  it("surface et périmètre", () => {
    const r = measure("surface", sq(500), A1, cal);
    expect(r.valeur).toBeCloseTo(25, 6);
    expect(r.perimetre).toBeCloseTo(20, 6);
  });
  it("polyligne", () => {
    expect(measure("polyligne", sq(500).slice(0, 3), A1, cal).valeur).toBeCloseTo(10, 6);
  });
  it("format français", () => {
    expect(formatLength(3.2)).toBe("3,20 m");
    expect(formatLength(0.456)).toBe("45,6 cm");
    expect(formatArea(12.345)).toMatch(/^12,3[45] m²$/);
  });
  it("barre d'échelle ronde", () => {
    const b = niceScaleBar(0.05, 140); // 7 m max
    expect(b.metres).toBe(5);
    expect(b.px).toBeCloseTo(100, 9);
  });
});

describe("recalage entre indices", () => {
  it("similitude exacte sur les deux paires", () => {
    const t = similarityFromPairs({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 25 });
    const p = applySimilarity(t, { x: 10, y: 0 });
    expect(p.x).toBeCloseTo(5, 9);
    expect(p.y).toBeCloseTo(25, 9);
    const q = applySimilarity(t, { x: 5, y: 0 });
    expect(q.x).toBeCloseTo(5, 9);
    expect(q.y).toBeCloseTo(15, 9);
  });
  it("sans recalage : même position relative", () => {
    expect(transferPoint({ x: 0.3, y: 0.4 }, A1, { w: 100, h: 100 })).toEqual({ x: 0.3, y: 0.4 });
  });
});

describe("échelle PDF", () => {
  it("dictionnaire /Measure en mètres", () => {
    // 1/100 : 1 pt papier = 0,0353 m réels
    expect(mppFromNumberFormats([{ U: "m", C: 0.035277778 }])).toBeCloseTo(0.035277778, 9);
    expect(mppFromNumberFormats([{ U: "cm", C: 3.5277778 }])).toBeCloseTo(0.035277778, 9);
    expect(mppFromNumberFormats([{ U: "ft", C: 1 }, { U: "in", C: 12 }])).toBeCloseTo(0.3048, 9);
    expect(mppFromNumberFormats([{ U: "furlong", C: 1 }])).toBeNull();
  });
});

describe("statuts", () => {
  it("retard seulement tant que l'entreprise doit agir", async () => {
    const { isEnRetard } = await import("../src");
    const d = new Date("2026-11-20T12:00:00");
    for (const st of ["ouvert", "transmis", "fabrication", "pret_a_poser"]) expect(isEnRetard({ echeance: "2026-11-01", statut: st }, d)).toBe(true);
    for (const st of ["pose", "leve", "clos"]) expect(isEnRetard({ echeance: "2026-11-01", statut: st }, d)).toBe(false);
  });
});

describe("divers", () => {
  it("indices", () => {
    expect(nextIndice("A")).toBe("B");
    expect(nextIndice("Z")).toBe("AA");
    expect(nextIndice("B2")).toBe("B3");
    expect(nextIndice(null)).toBe("A");
  });
  it("accrochage", () => {
    const s = new SnapIndex(10);
    s.add(100, 100);
    s.add(103, 100);
    s.add(100, 100);
    expect(s.size).toBe(2);
    expect(s.nearest(102.4, 100, 5)).toEqual({ x: 103, y: 100 });
    expect(s.nearest(150, 150, 5)).toBeNull();
  });
});
