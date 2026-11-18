// Génère trois plans PDF de test (A1, bâtiment 20 x 12 m au 1/100 + détail au 1/20) :
// indice A, indice B décalé (test du recalage) et une version avec échelle intégrée (/VP /Measure).
// Usage : node scripts/generer-plans-test.mjs
import { PDFDocument, rgb, StandardFonts, PDFName, PDFString } from "pdf-lib";
import fs from "fs";
const PT_PER_M_100 = 72 / 0.0254 / 100; // points papier par mètre réel au 1/100
const PT_PER_M_20 = 72 / 0.0254 / 20;

async function make(file, { shift = 0, withVP = false, indice = "A" }) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([2384, 1684]); // A1 paysage
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const H = 1684;
  // repère : origine haut-gauche du bâtiment
  const ox = 300 + shift, oy = 300 + shift;
  const k = PT_PER_M_100;
  const P = (x, y) => ({ x: ox + x * k, y: H - (oy + y * k) });
  const line = (a, b, w = 1.2) => page.drawLine({ start: P(...a), end: P(...b), thickness: w, color: rgb(0.1, 0.1, 0.1) });
  // murs extérieurs 20 m x 12 m (double trait 20 cm)
  const rect = (x0, y0, x1, y1, w) => { line([x0, y0], [x1, y0], w); line([x1, y0], [x1, y1], w); line([x1, y1], [x0, y1], w); line([x0, y1], [x0, y0], w); };
  rect(0, 0, 20, 12, 1.5); rect(0.2, 0.2, 19.8, 11.8, 1);
  // cloisons
  line([8, 0.2], [8, 11.8]); line([8, 6], [19.8, 6]); line([14, 6], [14, 11.8]);
  // cote 20,00
  line([0, -1], [20, -1], 0.6); line([0, -1.3], [0, -0.7], 0.6); line([20, -1.3], [20, -0.7], 0.6);
  page.drawText("20,00", { x: P(10, -1.2).x - 12, y: P(10, -1.2).y, size: 10, font });
  line([-1, 0], [-1, 12], 0.6); page.drawText("12,00", { x: P(-1.6, 6).x, y: P(-1.6, 6).y, size: 10, font });
  page.drawText(`PLAN RDC - Ech. 1/100 - Indice ${indice}`, { x: 300, y: 120, size: 22, font });
  page.drawText("Sejour", { x: P(3, 6).x, y: P(3, 6).y, size: 12, font });
  page.drawText("Chambre 1", { x: P(10, 3).x, y: P(10, 3).y, size: 12, font });
  // hachures pour charger le plan
  for (let i = 0; i < 40; i++) line([0.2 + i * 0.2, 11.8], [0.2 + i * 0.2 + 0.1, 11.6], 0.3);
  // vue de détail au 1/20 : carré de 2 m x 2 m
  const dx = 1450, dy = 300, kd = PT_PER_M_20;
  const Q = (x, y) => ({ x: dx + x * kd, y: H - (dy + y * kd) });
  const dl = (a, b, w = 1.2) => page.drawLine({ start: Q(...a), end: Q(...b), thickness: w, color: rgb(0.1, 0.1, 0.1) });
  dl([0, 0], [2, 0]); dl([2, 0], [2, 2]); dl([2, 2], [0, 2]); dl([0, 2], [0, 0]); dl([0, 1], [2, 1], 0.6);
  page.drawText("DETAIL A - Ech. 1/20", { x: dx, y: H - (dy - 40), size: 16, font });
  page.drawRectangle({ x: dx - 30, y: H - (dy + 2 * kd + 30), width: 2 * kd + 60, height: 2 * kd + 90, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.5 });
  if (withVP) {
    const ctx = doc.context;
    const vp = (bbox, name, C) => ctx.obj({
      Type: "Viewport", BBox: bbox, Name: PDFString.of(name),
      Measure: ctx.obj({ Type: "Measure", Subtype: "RL", R: PDFString.of(name), X: [ctx.obj({ Type: "NumberFormat", U: PDFString.of("m"), C })] , D: [ctx.obj({ Type: "NumberFormat", U: PDFString.of("m"), C: 1 })], A: [ctx.obj({ Type: "NumberFormat", U: PDFString.of("m2"), C: 1 })] }),
    });
    page.node.set(PDFName.of("VP"), ctx.obj([
      vp([0, 0, 2384, 1684], "Plan 1/100", 0.0254 / 72 * 100),
      vp([dx - 30, H - (dy + 2 * kd + 30), dx + 2 * kd + 30, H - (dy - 60)], "Detail A 1/20", 0.0254 / 72 * 20),
    ]));
  }
  fs.writeFileSync(file, await doc.save());
}
await make("./plan-RDC-indA.pdf", {});
await make("./plan-RDC-indB-decale.pdf", { shift: 40, indice: "B" });
await make("./plan-RDC-avec-echelle.pdf", { withVP: true });
console.log("ok");
