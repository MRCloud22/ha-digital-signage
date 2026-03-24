# Raspberry Pi Setup

Diese Anleitung beschreibt den aktuellen Provisioning-Workflow fuer neue Raspberry Pis.

## Voraussetzungen

- Raspberry Pi 3 B+, Pi 4 oder neuer
- SD-Karte mit mindestens 8 GB
- eine direkt vom Pi erreichbare Server-URL des Add-ons, zum Beispiel `http://192.168.1.65:9999`
- optional ein vorbereitetes Provisioning-Profil im Dashboard unter `Provisioning`

Wichtig: Fuer den Pi muss die `server_url` direkt erreichbar sein. In vielen Setups ist das die Home-Assistant-IP plus Add-on-Port und nicht die normale Home-Assistant-Frontend-URL.

## Option A: Provisioning mit Raspberry Pi OS

Das ist der bevorzugte Weg fuer normale Raspberry Pi OS Installationen.

### 1. Provisioning-Profil anlegen

1. Oeffne das Dashboard und gehe auf `Provisioning`.
2. Lege ein neues Profil an.
3. Setze `server_url` auf die vom Pi erreichbare Add-on-URL.
4. Hinterlege optional:
   - `Default Screen Name`
   - `Screen Gruppe`
   - Start-Playlist oder Start-Layout
   - Screen Notes
   - Watchdog-, OTA- und Threshold-Policy fuer den Pi
5. Speichere das Profil.

### 2. Installer erzeugen

1. Waehle das Profil aus.
2. Erzeuge einen neuen Installer.
3. Kopiere entweder:
   - `Install Command`
   - oder `Installer URL`

Beispiel:

```bash
curl -fsSL 'http://192.168.1.65:9999/api/provisioning/install/DEIN_TOKEN.sh' | bash
```

### 3. Raspberry Pi OS installieren

1. Flashe `Raspberry Pi OS (Desktop)` mit dem Raspberry Pi Imager.
2. Starte den Pi und melde dich an.
3. Oeffne ein Terminal.
4. Fuehre den erzeugten Install-Command aus.
5. Starte den Pi neu:

```bash
sudo reboot
```

### 4. Ergebnis

Nach dem Neustart passiert Folgendes automatisch:

- Chromium wird im Kiosk-Modus eingerichtet
- der Player startet ueber Autostart
- ein Device-Agent als systemd-Service wird installiert
- das Geraet claimed sich ueber den einmaligen Provisioning-Link
- der neue Screen taucht direkt im Dashboard auf, ohne PIN-Pairing
- Remote Device Control, Pi-Health und Screenshot-Capture sind danach im Screen-Dashboard verfuegbar
- OTA fuer Device-Agent und Launcher ist danach im Screen-Dashboard verfuegbar
- Watchdog und Recovery laufen nach der ersten Synchronisation automatisch nach der hinterlegten Policy

## Option B: FullPageOS

Wenn du FullPageOS nutzen willst, kannst du statt des Scripts direkt den erzeugten `FullPageOS URL` verwenden.

### 1. FullPageOS flashen

1. Oeffne den Raspberry Pi Imager.
2. Waehle `Other specific-purpose OS` -> `FullPageOS`.
3. Schreibe das Image auf die SD-Karte.

### 2. Start-URL setzen

1. Oeffne nach dem Flashen die Boot-Partition.
2. Bearbeite `fullpageos.txt`.
3. Trage dort den `FullPageOS URL` aus dem Dashboard ein.

Beispiel:

```text
http://192.168.1.65:9999/#/player?provisioning=DEIN_TOKEN
```

### 3. Pi starten

Beim ersten Start oeffnet FullPageOS direkt den Player. Der Provisioning-Link wird automatisch eingelost und der Screen erscheint im Dashboard.

## Fallback: klassisches PIN-Pairing

Falls du keinen Installer nutzen willst, kannst du weiterhin manuell koppeln:

1. Oeffne `/#/player` auf dem Pi.
2. Warte auf den Pairing-Code.
3. Gehe im Dashboard zu `Screens`.
4. Bestaetige dort den Code.

## Hinweise fuer den Betrieb

- Ein Installer-Link ist einmalig und kann nach erfolgreichem Claim nicht erneut verwendet werden.
- Abgelaufene oder bereits verbrauchte Installer liefern keinen neuen Screen mehr.
- Bei Netzwerkproblemen kann der Player spaeter trotzdem mit lokalem Offline-Cache weiterlaufen, sobald er einmal erfolgreich synchronisiert wurde.
- Remote-Kommandos wie Reboot, Browser-Neustart, Rotation, Systemlautstaerke und Screenshot-Capture funktionieren nur mit dem Raspberry-Pi-OS-Installer inklusive Agent, nicht mit reinem FullPageOS-Link.
- OTA im aktuellen Stand aktualisiert Device-Agent und Launcher der Signage-App. Vollstaendige OS-/Paket-Upgrades sind noch nicht Teil des Workflows.
