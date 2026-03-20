# HA Digital Signage

Home-Assistant-Add-on fuer Digital Signage mit Raspberry-Pi-Clients.

## Was neu ist

Diese Ausbaustufe schiebt das Projekt deutlich naeher an Yodeck-artige Workflows:

- Screen-Pairing mit Live-Heartbeat und Online/Offline-Status
- Default-Zuordnung pro Screen fuer Playlist oder Layout
- Zeitplaene pro Screen mit Prioritaet, Tagesauswahl, Uhrzeiten und Datumsfenstern
- Layouts mit mehreren Zonen
- Medienbibliothek fuer Bilder, Videos, PDFs, Webseiten und Text-Slides
- Playlist-Preview mit serverseitig aufgeloester Sub-Playlist-Hierarchie
- RSS-Ticker pro Playlist
- Player-Runtime ueber zentrale API statt verteilter Client-Logik

## Architektur

- `addon/server`: Express + SQLite API fuer Inhalte, Screens, Scheduling und Runtime
- `addon/frontend`: React/Vite Dashboard und Player-Oberflaeche
- Raspberry Pi / Browser-Client: laedt `/#/player`, koppelt sich per PIN und erhaelt Runtime-Updates via Socket.IO

## Kern-Workflows

### 1. Screen koppeln

1. `/#/player` auf dem Zielgeraet oeffnen
2. Pairing-Code im Dashboard unter `Screens` eingeben
3. Basis-Zuordnung oder Zeitplaene hinterlegen

### 2. Inhalte anlegen

1. Medien hochladen oder Webseiten/Text-Slides erstellen
2. Playlist anlegen
3. Inhalte direkt oder als Sub-Playlisten in die Playlist ziehen
4. Optional RSS-Ticker konfigurieren

### 3. Layout oder Zeitplan zuweisen

1. Entweder ein Layout mit Zonen bauen
2. Oder eine einzelne Playlist zuweisen
3. Fuer Yodeck-aehnliche Rotationen: Zeitplaene direkt am Screen pflegen

## Entwicklung

### Frontend

```bash
cd addon/frontend
npm install
npm run build
```

### Server

```bash
cd addon/server
npm install
node index.js
```

## Naechste sinnvolle Ausbaustufen

- Screen-Gruppen und Bulk-Assignment
- Proof-of-Play / Playback-Logs
- Offline-Caching fuer Raspberry Pis
- Remote Reboot / Screenshot / Device Diagnostics
- Rollen / Multi-User / Freigaben
