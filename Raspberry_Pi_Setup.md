# Digital Signage Client (Raspberry Pi Setup)

Diese Anleitung beschreibt, wie ein Raspberry Pi konfiguriert wird, um automatisch die Digital Signage Player Web-App im Kiosk-Modus zu starten.

## Voraussetzungen
* Ein Raspberry Pi (Empfohlen: Pi 3 B+ oder Pi 4)
* Eine SD-Karte (mind. 8GB)
* **Zwei Wege zur Installation:**
    1. **Der schnelle Weg:** Nutze **FullPageOS** (vorkonfigurierter Kiosk-Modus).
    2. **Der manuelle Weg:** Nutze das Standard **Raspberry Pi OS** (falls du mehr Kontrolle brauchst).

---

## Option A: Der schnelle Weg (FullPageOS) – EMPFOHLEN
FullPageOS ist ein minimales System, das direkt in einen Webbrowser bootet.

1. Öffne den **Raspberry Pi Imager**.
2. Klicke auf **"OS wählen"** -> **"Other specific-purpose OS"** -> **"FullPageOS"**.
3. Wähle deine SD-Karte und klicke auf **"Schreiben"**.
4. **WICHTIG:** Bevor du die Karte in den Pi steckst, navigiere am PC in das `bootfs` Laufwerk (die SD-Karte).
5. Suche die Datei **`fullpageos.txt`** und öffne sie.
6. Ersetze den Inhalt durch deine Add-on URL:
   `http://192.168.1.65:9999/#/player`
7. Speichere die Datei, stecke die Karte in den Pi und starte ihn.
8. Fahre fort mit **Schritt 3 (Pairing)**.

---

## Option B: Der manuelle Weg (Standard RPi OS)
Falls du FullPageOS nicht nutzen möchtest, kannst du ein Standard-System aufsetzen:

### Schritt 1: SD-Karte flashen & URL hinterlegen
1. Flashe **Raspberry Pi OS (mit Desktop)** via Imager.
2. Erstelle auf der SD-Karte (`bootfs`) eine Datei namens **`digital_signage_url.txt`**.
3. Schreibe die IP deines Servers rein: `http://192.168.1.65:9999/#/player`
4. Stecke die Karte in den Pi.

### Schritt 2: Kiosk-Modus manuell einrichten
Starte den Raspberry Pi. Öffne ein Terminal und folge diesen Schritten:

1. **Abhängigkeiten installieren:**
   ```bash
   sudo apt update
   sudo apt install -y chromium-browser xdotool unclutter
   ```

2. **Autostart-Skript anlegen:**
   Erstelle eine Datei für den automatischen Start:
   ```bash
   mkdir -p ~/.config/lxsession/LXDE-pi
   nano ~/.config/lxsession/LXDE-pi/autostart
   ```

3. **Inhalt der Autostart-Datei:**
   Füge den folgenden Code ein. Dieses Skript liest die URL von der SD-Karte und startet Chromium im Kiosk-Modus.

   ```bash
   @lxpanel --profile LXDE-pi
   @pcmanfm --desktop --profile LXDE-pi
   @xscreensaver -no-splash
   
   # Mauszeiger verstecken
   @unclutter -idle 0.1 -root

   # Bildschirmschoner deaktivieren
   @xset s off
   @xset -dpms
   @xset s noblank

   # Chromium im Kiosk-Modus starten (URL aus der boot-Partition lesen)
   @bash -c "URL=\$(cat /boot/firmware/digital_signage_url.txt || cat /boot/digital_signage_url.txt); chromium-browser --kiosk --noerrdialogs --disable-infobars --check-for-update-interval=31536000 \$URL"
   ```

4. **Speichern und Neustarten:**
   Speichere die Datei (`Strg+O`, `Enter`, `Strg+X`) und starte den Raspberry Pi neu:
   ```bash
   sudo reboot
   ```

## Schritt 3: Pairing im Dashboard
1. Nach dem Neustart öffnet der Raspberry Pi den Browser.
2. Da er noch nicht authentifiziert ist, wird ein **6-stelliger PIN** auf dem Bildschirm angezeigt.
3. Öffne das Home Assistant Add-on Dashboard (`dein-ha-login.local:8123/digital-signage`).
4. Klicke bei "Screens" auf "Neuen Screen koppeln" und gib die PIN ein.
5. Der Raspberry Pi verbindet sich nun dauerhaft via WebSockets und wartet auf eine Playlist!
