declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;

/** Version de l'application (tauri.conf.json). */
export const APP_VERSION: string = __APP_VERSION__;
/** Numéro de build (numéro d'exécution de la CI GitHub), « dev » en local. */
export const APP_BUILD: string = __APP_BUILD__;
/** Affichage « version (build) ». */
export const VERSION_LABEL = `${APP_VERSION} (${APP_BUILD})`;
