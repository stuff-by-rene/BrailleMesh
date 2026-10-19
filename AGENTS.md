# AGENTS.md — BumpMesh Braille (Braille-Erweiterung für BumpMesh)

Was die Braille-Erweiterung kann, wie sie aufgebaut ist und worauf man beim
Ändern achten muss. Das zugrunde liegende BumpMesh (Textur-Verdrängung) ist
unverändert — die Braille-Funktion ist ein **eigener Bereich** daneben.

## Was das Tool macht

BumpMesh verwandelt 3D-Modelle (STL, OBJ, 3MF, STEP) in Verdrängungs-Meshes:
eine Höhenkarte wird aufs Netz projiziert und als echtes Relief ausgetragen.
Der **Braille-Modus** ergänzt genau dafür gedachte Beschriftung:

- Textbausteine („Wort1“, „Wort2“, …) in einem **Pool** anlegen.
- Bausteine **per Drag & Drop** aus dem Pool auf eine Fläche des Modells
  ziehen (oder „Auf Modell platzieren“ → Fläche anklicken).
- Jeder Baustein hat **eigene Parameter** (Marburg-Medium-Defaults aus
  `Exportierte Parameter.csv`); Regler-Änderungen wirken auf **alle**
  Platzierungen des Bausteins gleichzeitig.
- **Lokal anpassen** → der Baustein wird als **neuer Baustein** in den Pool
  kopiert und nur die gewählte Platzierung gehört ihm.
- Die **Nutzungsliste** zeigt pro Baustein, wie oft und wo er platziert ist;
  ein Klick auf eine Platzierung **schwenkt die Kamera** dorthin.
- Platzierte Blöcke lassen sich im Viewer **greifen und verschieben**,
  per Regler **drehen** und über die Liste **löschen**.
- Zwei Einsatz-Varianten pro Baustein:
  1. **Auf das Netz** — Punkte stehen erhaben auf der Oberfläche.
  2. **Ins Netz eingebettet** — EIN gerader Taschenrahmen um den ganzen
     Block; Standard-Taschentiefe = Punkthöhe, dann sind die Punktoberkanten
     **bündig** mit der Oberfläche.
- Optionale **Schwarzschrift-Beschriftung** (für Sehende) unter jeder
  Braille-Zeile, graviert oder erhaben.

Alles läuft lokal im Browser (WebGL + Web Worker), es wird nichts hochgeladen.

## Braille als eigenes Teil (Slicer)

- **Export STL / 3MF** (klassisch): das Braille-Relief wird wie eine Textur
  in die Oberfläche eingebacken — ein Körper.
- **Export 3MF (Braille als Teil)**: eine 3MF mit **einem Volume pro
  Baustein** — Grundkörper + jeder Pool-Baustein als eigener Festkörper
  (`js/brailleSolid.js`: pro Punkt Kugelkappe + Verankerungs-Skirt, das
  leicht in den Körper reicht). Im Slicer (PrusaSlicer/Bambu/Orca) als ein
  Objekt mit trennbaren, pro Wort einfärbbaren Volumes („Split to objects“).
  Bei „eingebettet“ bekommt der Grundkörper **nur die Taschen** eingebacken
  (Pockets-only-Karte), die Punkte füllen sie bündig; der Skirt reicht unter
  den Taschenboden für die Verankerung.

## Parameter (CSV-Defaults, pro Baustein)

DotDiameter 1,6 · DotSpacing 2,5 · CellSpacing 6 · WordSpacing 8
(2 mm + CellSpacing) · RowSpacing 10 (4 × DotSpacing) · DotHeight 0,5 ·
DotRounding 0,75 · DistanceRecessCellValue 3 (→ Taschenrand) ·
Taschentiefe 0,5 (= DotHeight → bündig). Abgeleitet laut CSV:
DistanceRecessCell = Wert + DotDiameter/2; RecessWidth/RecessHeight6/4/8Dots
beschreiben die ein-Zell-Taschenmaße, im Tool wird EIN Rahmen um den Block
mit DistanceRecessCell als Rand verwendet (User-Entscheidung).

## Braille-Sprachen

DE Vollschrift · DE Kurzschrift (vereinfacht) · EN UEB Grade 1 · EN UEB
Grade 2 (vereinfacht) · FR · ES · IT · PT — jeweils Grade 1 unkontrahiert;
Kurzschrift/Grade 2 sind **vereinfachte** Sätze (gängige Wortzeichen +
Gruppenzeichen mit einfachen Positionsregeln, keine amtlichen Regelwerke).
Tabellen stehen in `js/braille.js` und sind dot-verifiziert gegen UEB (ICEB),
französisches Braille und die Vergleichstabelle der Wikipedia (ES/IT/PT).
Neue Sprache = neuen Eintrag in `TABLES` + `BRAILLE_LANGUAGES` ergänzen.

## Architektur

```
index.html            Modus-Umschalter (Textur/Braille) + Braille-Sektion (#sec-braille)
style.css             Braille-UI-Styles (body.braille-mode blendet die Textur-Sektionen aus)
js/main.js            Braille-State, Pool-/Editor-UI, Platzierung, Kamera-Schwenk,
                      Undo/Session/Projekt-Integration, Export-Anbindung
js/braille.js         Übersetzung (8 Systeme) + Tiefenkarten-Rasterung (mm-genau)
js/brailleBlocks.js   Block-Mathematik: Frame, Anker, Off-Flags, Pseudo-Layer, Atlas-Packing
js/brailleSolid.js    Festkörper der Punkte für den „eigenes Teil“-Export
js/previewMaterial.js Shader: Blöcke als eigene Uniform-Familie (Atlas-Sampler,
                      block-lokale UV, Anker × Content-Rect, Cover-Compositing)
js/displacement.js    CPU-Pfad: _blockSample (block-lokal, geklemmte Bilinear)
js/exporter.js        export3MFVolumes — Multi-Volume-3MF (Root-Objekt + Komponenten)
```

Datenmodell: Pool-Block `{ id, label, text, params, placements[] }`;
Platzierung `{ center[3], normal[3], rotation }`. Die Tiefenkarte wird aus
`params` + `text` erzeugt und gecacht (`_brailleMapKey`); alle Platzierungen
eines Blocks teilen sie. Im Shader adressiert jede Platzierung die Karte des
Blocks über ihren eigenen Frame (bis zu `MAX_PREVIEW_BLOCKS` = 8 gleichzeitig
sichtbar; der Export nimmt alle).

## Konventionen / Stolperfallen

- **TDZ**: `wireEvents()` läuft früh — alles, was dabei angefasst wird, muss
  als `function` (gehoisted) oder vorher deklariert sein.
- **GLSL in Template-Literals**: KEINE Backticks in Kommentaren innerhalb der
  Shader-Strings (beendet das Literal). Nach Shader-Änderungen die App im
  Browser öffnen — ein Kompilierfehler macht das Mesh unsichtbar, ohne dass
  die App crasht.
- **i18n**: jedes neue `t('key')` braucht den Key in `de.js` UND `en.js`.
- **Version bumpen** (`js/version.js`) bei jedem sichtbaren Stand.
- **Undo/Session/Projekt**: Braille-State hängt in `_brailleSnapshot` /
  `_restoreBrailleSnapshot` und muss in `_captureUndoSnapshot`,
  `_undoSnapshotsEqual`, `getSettingsSnapshot` und `applySettingsSnapshot`
  mitgeführt werden (ist verdrahtet).
- **Modellwechsel**: Platzierungen hängen an der Mesh-Geometrie — bei neuem
  Modell/Bake werden sie geleert (`_brailleClearPlacements`), der Pool bleibt.
- **Pool-/Platzierungslisten sind DELEGIERT** (Listener am Container, nicht an
  Zeilen): Zeilen werden bei fast jeder Zustandsänderung neu gebaut — eigene
  Zeilen-Listener würden zwischen mousedown und mouseup zerstört und den
  Klick verschlucken (Auswahl-Wechsel funktionierte nicht mehr). Zeilen
  tragen `data-block-id` / `data-pl-idx`; Klick auf den Platzierungs-Zähler
  wählt den Block und scrollt zur Platzierungsliste.
- **Platzierungen haben Namen** (`pl.name`, Standard = Block-Label, dedupliziert
  mit „ 2“, „ 3“ …), im Platzierungsliste-Feld umbenennbar; Snapshot/Restore
  führt den Namen mit.
- **Standort-Info**: jede Platzierungszeile zeigt Seite (dominante Normalen-
  achse: Ober-/Unter-/linke/rechte/Vorder-/Rückseite) + Abstand des Reliefs
  (Map-contentRect, rotationsberücksichtigt) zu den Flächenkanten — berechnet
  in `_placementFaceInfo` im kanonischen Flächenframe (`blockFrame(n, 0)`).
- **Position editierbar** (`br-pos-left`/`br-pos-bottom`, `_moveBraillePlacement`):
  mm von links/unten, verschiebt entlang der Flächenebene (Normalen-Offset
  bleibt), klemmt das Relief auf die Fläche, solange es hineinpasst.
- **Rotation normalisiert** (`_normDeg`): Platzierungs-Rotation wird immer als
  -180…180 gespeichert (Slider zentriert, Null in der Mitte, beidseitig
  eintippbar); Session-Restore normalisiert alte 0-360-Werte.
- **Blockwechsel im Platzier-Modus** schaltet den Platzier-Modus nicht aus —
  der nächste Modellklick platziert den neu gewählten Block.
- **Map-Cache (`_brailleMapFor`)**: Key = `_brailleBlockKey` = Parameter **UND
  Text** (`|t=…`). Ohne Text im Key teilen sich Blöcke mit gleichen Parametern
  einen Cache-Eintrag und das Modell rendert für beide den zuerst generierten
  Text. Auch die Atlas-Signatur (`_ensureBlockAtlas`) nutzt `_brailleBlockKey`,
  sonst bleibt der Atlas nach einer Textänderung stehen.
- **Off-Plane-Band**: das Block-Relief gilt nur nahe der Platzierungs-Ebene —
  `|nd| <= max(blockTolerance+1, mapAmp+1.5)` in **beiden** Pfaden konsistent:
  Shader `blockGreyAt` (previewMaterial.js) und CPU `_blockSample`
  (displacement.js). Ohne Band bekommt jede parallele, gleichnormierte Fläche
  innerhalb des Block-Fußabdrucks (Stufen, Senkungen, Innenböden) das Relief
  ebenfalls — die Platzierung erscheint doppelt. Das Band muss die Tiefe
  vertiefter Taschen (≈ Map-Amplitude) und die Krümmungssagitta innerhalb des
  Anker-Bereichs abdecken.
- **Info-Icons (i)**: eigene `<span class="br-info">`-Elemente neben den
  Braille-Labels (CSS-Kreis, kein Font-Glyph — das alte trailing „ⓘ" im
  Labeltext lief unter dem Slider unter). Text via `data-i18n-tip`
  (`braille.tt.*`) → `dataset.tip` + `title` (i18n.js); eine geteilte Bubble
  (`.br-info-bubble`, fixed positioniert) zeigt ihn bei Hover **und** Klick,
  Klick woanders/Escape schließt. Braille-Labels sind `flex: 0 0 auto`
  (content-sized) statt der app-weiten 80px-Basis.
- **Schwarzschrift** lebt im Tiefenfeld (`depth`), nicht nur auf dem Canvas —
  CPU-Pfad, Shader-Maske und Content-Rect lesen alle aus `depth`; die Caption
  wird vor der Amplituden-/Content-Rect-Berechnung gemergt.
- **Punktqualität**: `_effectiveRefineLength()` verengt die Subdivisions-
  kantenlänge auf ~dotDiameter/8, solange Blöcke platziert sind (Export,
  Bake und 3D-Preview nutzen sie). Decimation sperrt Blockflächen
  (`hardFaces`), damit Punkte nicht kollabieren.
- **Platzieren** schaltet die 3D-Preview aus (Raycast braucht die
  Basisoberfläche, nicht die verdrängte).
- **Worker**: Block-Layer laufen strukturgeklont in den Export-Worker
  (`settings.block` = Deskriptor, plain data) — keine THREE/DOM-Objekte in
  Block-Layern ablegen.

## Tests

```
node tests/braille.test.mjs          Übersetzung, Frame-Mathe, Off-Flags,
                                     CPU-Verdrängung (erhaben/vertieft),
                                     Festkörper-Ladenschluss, Multi-Volume-3MF
node tests/zipStream.test.mjs        Streaming-ZIP
node tests/paintTree.test.mjs        Farbmasken
node tests/exportStreaming.test.mjs  3MF-Formatdetails
npm test                             alle zusammen
```

Dev-Server: `python -m http.server 8791` im Projektordner → http://localhost:8791
