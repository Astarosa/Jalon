import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import type { Platform } from "./index";

/** Sous Windows (WebView2), les protocoles personnalisés sont servis en http://<schéma>.localhost/ */
const base = () =>
  navigator.userAgent.includes("Windows") ? "http://chantier.localhost/" : "chantier://localhost/";

export function tauriPlatform(): Platform {
  return {
    kind: "tauri",
    call: (cmd, args = {}) => invoke("cmd", { name: cmd, args }),
    callBin: (cmd, bytes, args = {}) =>
      invoke("cmd_bin", bytes, {
        headers: { "x-cmd": cmd, "x-args": encodeURIComponent(JSON.stringify(args)) },
      }),
    fileUrl: (sha) => `${base()}f/${sha}`,
    tileUrl: (pvid, z, x, y, rev) => `${base()}t/${pvid}/${z}/${x}/${y}.webp${rev ? `?v=${rev}` : ""}`,
    async pickFolder(title) {
      const r = await open({ directory: true, multiple: false, title });
      return typeof r === "string" ? r : null;
    },
    async saveAs(bytes, defaultName, filterName, ext) {
      const path = await save({ defaultPath: defaultName, filters: [{ name: filterName, extensions: [ext] }] });
      if (!path) return null;
      await invoke("write_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
      return path;
    },
    openPath: (p) => openPath(p),
    revealPath: (p) => revealItemInDir(p),
  };
}
