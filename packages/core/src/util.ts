export const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

export const nowIso = (): string => new Date().toISOString();
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function formatDateFr(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T12:00:00") : new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", withTime
    ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Indice suivant : A → B, Z → AA, 1 → 2, B2 → B3. */
export function nextIndice(prev: string | null | undefined): string {
  if (!prev) return "A";
  const m = prev.match(/^(.*?)(\d+)$/);
  if (m) return m[1] + String(parseInt(m[2], 10) + 1);
  const s = prev.toUpperCase();
  if (/^[A-Z]+$/.test(s)) {
    const chars = s.split("");
    let i = chars.length - 1;
    while (i >= 0) {
      if (chars[i] !== "Z") {
        chars[i] = String.fromCharCode(chars[i].charCodeAt(0) + 1);
        return chars.join("");
      }
      chars[i] = "A";
      i--;
    }
    return "A" + chars.join("");
  }
  return prev + "'";
}

export function safeFileName(s: string): string {
  return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/\s+/g, " ").trim().slice(0, 120) || "fichier";
}
