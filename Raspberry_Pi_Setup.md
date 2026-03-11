# Digital Signage Client (Raspberry Pi Setup)

Diese Anleitung beschreibt, wie ein Raspberry Pi konfiguriert wird, um automatisch die Digital Signage Player Web-App im Kiosk-Modus zu starten.

## Voraussetzungen
* Ein Raspberry Pi (Empfohlen: Pi 3 B+ oder Pi 4)
* Eine SD-Karte mit **Raspberry Pi OS (mit Desktop)** (nicht "Lite", da ein Webbrowser benötigt wird).

## Schritt 1: SD-Karte flashen & config.txt erstellen
1. Flashe das Raspberry Pi OS mit dem [Raspberry Pi Imager](https://www.raspberrypi.com/software/).
2. **WICHTIG:** Bevor du die SD-Karte in den Pi steckst, navigiere in das `bootfs` Laufwerk (die SD-Karte) an deinem Computer.
3. Erstelle dort eine neue Datei namens **`digital_signage_url.txt`**.
4. Schreibe die IP-Adresse oder Domain deines Home Assistant Servers inkl. Port `9999` und `/#/player` Pfad in diese Datei.
5. **WICHTIG:** Nutze das Format `http://IP-ADRESSE:9999/#/player`
    * Beispiel Lokal: `http://192.168.1.65:9999/#/player`
    * Beispiel Extern: `https://signage.deinedomain.de/#/player` (falls über Proxy freigegeben)
6. Speichere die Datei und stecke die SD-Karte in den Raspberry Pi.

## Schritt 2: Kiosk-Modus einrichten
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
