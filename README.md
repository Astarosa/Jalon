# Jalon — suivi de chantier, édition locale

**Jalon** est une application Windows de suivi de chantier pour **un conducteur de travaux**. Tout est stocké sur le PC et l'application fonctionne sans réseau ni serveur.

Elle sert de solution d'attente avant le produit collaboratif (multi-utilisateurs, mobile, synchronisation). Ce dépôt est organisé pour que ce futur produit reprenne directement le cœur, l'interface et le format de données.

## Fonctions

| Domaine | Ce que fait l'application |
|---|---|
| Chantiers | Création avec lots types, archivage, tableau de bord (points, non clos, retards) |
| Lots et entreprises | Carnet d'entreprises global, affectation entreprise ↔ lot par chantier, couleurs de lots |
| Plans PDF | Import multi-pages, découpage en tuiles (affichage fluide des A0), **indices de plan** (A, B…) |
| Échelle | Lecture automatique de l'échelle intégrée au PDF (`/VP /Measure`), **saisie « 1/100 »**, **étalonnage sur deux points** avec loupe, **mesure de contrôle** et écart en % |
| Zones d'étalonnage | Plusieurs échelles sur une même page (détail au 1/20, coupe…) : la plus petite zone contenant le point s'applique |
| Accrochage | Les clics s'aimantent aux extrémités et milieux des traits vectoriels du PDF |
| Mesures | Distance, longueur cumulée, surface + périmètre ; libellé, couleur (palette ou personnalisée : teinte, hexadécimal, RVB), notes, rattachement à un point ; recalcul automatique si l'étalonnage change |
| Points | Réserves, observations, tâches ; statuts *Ouvert → Transmis → Envoyé en fabrication → Prêt à poser → Posé → Levé → Contrôlé/clos* ; lot, entreprise, priorité, échéance, localisation ; historique et commentaires ; déplacement de l'épingle par glisser |
| Photos | Import par glisser-déposer, date EXIF, **annotation** (flèche, cercle, rectangle, trait, main levée, texte) |
| Checklists | Modèles réutilisables, à ajouter à un point ou à une visite (conforme / non conforme / sans objet + note) |
| Visites | Visite « en cours » qui rattache automatiquement les points créés ou modifiés pendant la tournée |
| Nouvel indice | Report des points (et mesures) sur l'indice suivant, à position identique ou **recalé sur deux repères** (similitude) ; étalonnage repris si le format est identique |
| Rapports PDF | Points à traiter **par entreprise** (extrait de plan localisé + photos), **compte rendu de visite**, **état du chantier** ; mesures tracées sur les extraits et section « Mesures » (vue nette du plan par zone d'échelle + tableau avec notes) |
| Exports | Excel (points, mesures, visites) ; **export complet .zip** (données + plans + photos), réimportable sur un autre poste |
| Mises à jour | Vérification au lancement, téléchargement et installation signés en un clic (voir plus bas) |
| Sauvegardes | Automatiques (intervalle réglable + à la fermeture), manuelles, rotation, **restauration** avec sauvegarde de sécurité préalable |

## Organisation du code

```
crates/store        Moteur local en Rust : SQLite, fichiers rangés par SHA-256, tuiles, sauvegardes (testé)
crates/devserver    Le même moteur exposé en HTTP, pour développer et tester l'interface dans un navigateur
packages/core       TypeScript pur : schéma Drizzle, migrations, géométrie (étalonnage, zones, mesures, recalage),
                    référentiels métier, format d'export (testé) — réutilisable par le produit collaboratif
packages/ui         Design system + composants partagés : visionneuse de plan (Leaflet), annotation photo (Konva)
apps/local          L'application : écrans, accès aux données, PDF (pdf.js), rapports (react-pdf), exports
apps/local/src-tauri  Couche Tauri (fenêtre, commandes, protocole chantier://, sauvegarde à la fermeture)
```

Règles de données partagées avec le futur produit : identifiants UUID, `created_at` / `updated_at` / `deleted_at` (suppression logique), coordonnées de plan relatives (0 à 1), fichiers identifiés par leur empreinte SHA-256.

## Construire l'installeur Windows

### Option 1 — GitHub Actions (aucune installation)
Poussez le dépôt sur GitHub : le workflow `.github/workflows/build-windows.yml` produit l'installeur `Jalon_1.2.0_x64-setup.exe`, téléchargeable dans les *artefacts* du job. Un tag `v1.0.0` le publie aussi en *release*.

### Option 2 — sur un PC Windows
Prérequis (une seule fois) :
1. [Node.js 22 LTS](https://nodejs.org)
2. [Rust](https://rustup.rs) (toolchain `stable-x86_64-pc-windows-msvc`)
3. *Microsoft C++ Build Tools* (charge de travail « Développement Desktop en C++ »)
4. WebView2 : déjà présent sur Windows 10/11

```powershell
npm install
npm run tauri build -- --bundles nsis
# -> apps\local\src-tauri\target\release\bundle\nsis\Jalon_1.2.0_x64-setup.exe
```

L'installeur s'installe **pour l'utilisateur, sans droits administrateur**. Sans certificat de signature, Windows SmartScreen affiche un avertissement au premier lancement (« Informations complémentaires » → « Exécuter quand même »).

Pour développer sous Windows avec rechargement à chaud : `npm run tauri dev`.

## Mises à jour automatiques

Au lancement, Jalon consulte `https://github.com/Astarosa/Jalon/releases/latest/download/latest.json`. Si une version plus récente existe, une carte propose de la **télécharger et l'installer**. Les données sont sauvegardées avant l'installation, puis l'application redémarre. Le bouton *Réglages → À propos → Rechercher une mise à jour* lance la même vérification à la demande. La version est affichée sous la forme `version (build)`, où le build est le numéro d'exécution GitHub Actions.

Les mises à jour sont **signées** : l'application refuse tout fichier dont la signature ne correspond pas à la clé publique intégrée au build.

### Mise en place (une seule fois)

1. Générer la paire de clés sur votre PC (un mot de passe est demandé) :
   ```powershell
   npx tauri signer generate -w "$env:USERPROFILE\.tauri\jalon.key"
   ```
   Deux fichiers sont créés : `jalon.key` (clé **privée**) et `jalon.key.pub` (clé publique).
2. Sur GitHub, dans *Settings → Secrets and variables → Actions* :
   - onglet **Secrets**, *New repository secret* :
     - `TAURI_SIGNING_PRIVATE_KEY` = contenu complet de `jalon.key` ;
     - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = le mot de passe choisi ;
   - onglet **Variables**, *New repository variable* :
     - `TAURI_UPDATER_PUBKEY` = contenu de `jalon.key.pub`.
3. Rendre le dépôt **public** (*Settings → General → Danger Zone → Change visibility*). Le fichier `latest.json` et les installeurs doivent être téléchargeables sans compte.
4. Conserver `jalon.key` et son mot de passe en lieu sûr (gestionnaire de mots de passe). **Si la clé est perdue, les postes installés ne peuvent plus être mis à jour automatiquement** : il faudra réinstaller à la main une version signée avec une nouvelle clé.

### Publier une version

```bash
npm run version:set -- 1.3.0                        # met à jour tauri.conf.json, Cargo.toml, package.json
git commit -am "Version 1.3.0"
git tag -a v1.3.0 -m "Nouveautés affichées dans l'application"
git push origin main v1.3.0
```

Le workflow vérifie que le tag correspond à la version, construit l'installeur, le **signe** et publie la *release* avec `latest.json`. Le message du tag devient la note de version affichée dans l'application. Les push sur `main` sans tag produisent seulement un installeur de test (artefact).

## Développer dans un navigateur (toutes plateformes)

```bash
npm install
cargo run -p chantier-devserver -- ./.dev-config   # moteur local sur 127.0.0.1:1421
npm run dev                                       # interface sur http://127.0.0.1:1420
```
En mode navigateur, le choix d'un dossier se fait par une saisie de chemin et les fichiers exportés sont téléchargés.

## Tests

```bash
npm test          # géométrie, étalonnage, zones, recalage, schéma ↔ migrations (vitest) + moteur Rust (cargo test)
npm run typecheck
```

## Données sur le disque

```
<dossier de données>\
  data.sqlite                 base (mode WAL)
  fichiers\ab\cd\<sha256>     PDF, photos, vignettes, rendus annotés
  tuiles\<version>\<z>\…      tuiles des plans (régénérées automatiquement si absentes)
  rapports\<chantier>\…       PDF et Excel générés
<dossier de données> - sauvegardes\   (par défaut ; à placer de préférence sur un autre disque)
  sauvegardes\<date>_<type>\data.sqlite + meta.json
  fichiers\…                  réservoir incrémental des fichiers
```

**Ne pas placer le dossier de données dans un dossier OneDrive/SharePoint synchronisé**, car la synchronisation pendant l'écriture peut corrompre la base. Il faut y placer uniquement les **sauvegardes** (Réglages → Dossier de sauvegarde).

## Plans ArchiCAD : conseils

- Exporter depuis la **mise en page**, à 100 %, au format papier réel (A0, A1…). L'échelle saisie (« 1/100 ») est alors exacte. Une mesure de contrôle sur une cote connue la confirme.
- Si le PDF contient des cadres de mesure (`/VP`), l'application crée automatiquement l'étalonnage de page et une zone par vue.
- Pour un détail à une autre échelle sur la même feuille, tracer une **zone d'étalonnage** autour de la vue.
- L'aimant (accrochage) est plus précis sur les PDF vectoriels. Il est inopérant sur un plan scanné.

## Format d'export

`chantier.json` (format `jalon/chantier`, version 1, schéma Zod dans `packages/core/src/exportFormat.ts`) + `fichiers/<sha256>`. À l'import, une ligne existante n'est remplacée que si celle du fichier est plus récente (`updated_at`). Ce format sert aussi de point d'entrée pour la migration vers le produit collaboratif.

## Nom

*Jalon* : le piquet du géomètre, et l'étape d'un projet. Cette édition locale prépare **Jalon Équipe**, le futur produit collaboratif (multi-utilisateurs, mobile, synchronisation).
