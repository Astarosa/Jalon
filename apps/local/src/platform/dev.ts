import type { Platform } from "./index";

/** Transport HTTP vers le serveur de développement (proxy Vite : /api, /bin, /asset). */
export function devPlatform(): Platform {
  const call = async (cmd: string, args: Record<string, unknown> = {}) => {
    const r = await fetch(`/api/${cmd}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  };
  return {
    kind: "dev",
    call,
    async callBin(cmd, bytes, args = {}) {
      const q = new URLSearchParams(args).toString();
      const r = await fetch(`/bin/${cmd}?${q}`, { method: "POST", body: bytes as BodyInit });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    fileUrl: (sha) => `/asset/f/${sha}`,
    tileUrl: (pvid, z, x, y, rev) => `/asset/t/${pvid}/${z}/${x}/${y}.webp${rev ? `?v=${rev}` : ""}`,
    async pickFolder(title) {
      return window.prompt(`${title}\n(mode développement : saisir un chemin)`) || null;
    },
    async saveAs(bytes, defaultName) {
      const url = URL.createObjectURL(new Blob([bytes as BlobPart]));
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return defaultName;
    },
    async openPath(p) {
      console.info("ouvrir", p);
    },
    async revealPath(p) {
      console.info("afficher", p);
    },
  };
}
