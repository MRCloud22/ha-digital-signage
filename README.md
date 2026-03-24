# HA Digital Signage

Digital-Signage-Loesung als Home-Assistant-Add-on mit React-Dashboard, Express/SQLite-Backend und Raspberry-Pi-Player.

## Aktueller Stand

Das Projekt ist inzwischen deutlich naeher an einem Yodeck-aehnlichen Workflow:

- Screen-Pairing mit Live-Heartbeat und Online/Offline-Status
- Screen-Gruppen mit Bulk-Assignment
- direkte Playlist- oder Layout-Zuordnung pro Screen
- Zeitplaene mit Prioritaet, Tagesauswahl, Uhrzeiten und Datumsfenstern
- Layouts mit mehreren Zonen
- Medienbibliothek fuer Bilder, Videos, PDFs, Webseiten und Text-Slides
- serverseitige Playlist-Preview mit aufgeloester Sub-Playlist-Hierarchie
- Proof-of-Play und Player-Logs im Monitoring
- Alert-Center fuer Offline-Screens, stale Agents, Playback-Fehler und fehlgeschlagene Device-Kommandos
- Offline-Caching fuer Runtime, Playlist-Previews und Mediendateien auf dem Pi
- Provisioning-Profile und Installer-Links fuer neue Raspberry Pis
- Device Health fuer Player und Raspberry Pi
- Remote Device Control fuer Reload, Player-Neustart, Volume, Rotation, Reboot, Shutdown und Screenshot-Capture
- OTA fuer Device-Agent und Player-Launcher
- Watchdog-, Recovery- und Health-Policies pro Pi bzw. Provisioning-Profil

## Architektur

- `addon/server`: Express + SQLite API fuer Inhalte, Screens, Scheduling, Monitoring und Provisioning
- `addon/frontend`: React/Vite Dashboard und Player-Oberflaeche
- Raspberry Pi / Browser-Client: laedt `/#/player`, arbeitet mit Socket.IO und faellt bei Netzproblemen auf lokalen Cache zurueck

## Kern-Workflows

### 1. Screen per PIN koppeln

1. `/#/player` auf dem Zielgeraet oeffnen
2. Pairing-Code im Dashboard unter `Screens` bestaetigen
3. Playlist, Layout, Gruppe oder Zeitplaene zuweisen

### 2. Screen per Installer provisionieren

1. Im Dashboard unter `Provisioning` ein Profil anlegen
2. `server_url` auf die direkt vom Pi erreichbare Add-on-URL setzen
3. optional Gruppe, Playlist oder Layout als Startzuweisung hinterlegen
4. Watchdog-, OTA- und Threshold-Policies fuer den Pi definieren
5. Installer-Link oder `curl ... | bash` erzeugen
6. das Pi-Script auf einem frischen Raspberry Pi OS ausfuehren oder die FullPageOS-URL nutzen
7. der Player claimed sich danach automatisch ohne PIN

### 3. Inhalte und Kampagnen pflegen

1. Medien hochladen oder Webseiten/Text-Slides erstellen
2. Playlisten anlegen und Inhalte bzw. Sub-Playlisten zuweisen
3. optional RSS-Ticker konfigurieren
4. Layout oder Einzel-Playlist direkt am Screen oder ueber Gruppen/Schedules ausspielen

### 4. Betrieb und Monitoring

1. `Monitoring` zeigt Alerts, Proof-of-Play, Player-Fehler und Verbindungsereignisse
2. der Player cached Runtime, Previews und Dateien fuer Offline-Betrieb
3. das Dashboard zeigt Online-/Offline-Status und Heartbeats
4. `Screens` enthaelt jetzt Device Management fuer Health, Screenshot-Vorschau, OTA-Kommandos und Recovery-Policies

## Raspberry Pi Setup

Die aktuelle Pi-Anleitung mit Provisioning-Workflow liegt in [Raspberry_Pi_Setup.md](/D:/Users/Andreas/Documents/digital%20signage/Raspberry_Pi_Setup.md).

## Entwicklung

### Frontend

```bash
cd addon/frontend
npm install
npm run lint
npm run build
```

### Server

```bash
cd addon/server
npm install
node index.js
```

## Naechste sinnvolle Ausbaustufen

- Rollen, Benutzer und Audit-Log
- Benachrichtigungsziele fuer Alerts wie Home Assistant, Webhooks oder E-Mail
- tiefere OTA-Stufen fuer Raspberry Pi OS selbst, zum Beispiel Paket-/OS-Upgrades mit Wartungsfenstern
