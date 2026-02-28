# Reolink UniFi Bridge — Home Assistant Add-on Repository

Dieses Repository enthält zwei Home Assistant Add-ons, die zusammen eine vollständige Brücke zwischen **Reolink-Kameras** und **UniFi Protect** aufbauen.

---

## Schnellstart — Repository in Home Assistant hinzufügen

[![Add Repository](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif)

Oder manuell:

> **Einstellungen → Add-ons → Add-on Store → ⋮ → Repositorys**
> URL: `https://github.com/Kayhartmann/onif`

---

## Enthaltene Add-ons

| Add-on | Beschreibung |
|--------|--------------|
| [Reolink → UniFi Protect Bridge](#1-reolink--unifi-protect-bridge) | Komplettlösung: Reolink-Protokoll → ONVIF-Brücke mit Dashboard |
| [ONVIF Server](#2-onvif-server) | Standalone ONVIF-Server für beliebige RTSP-Streams |

---

## 1. Reolink → UniFi Protect Bridge

[![Install Add-on](https://my.home-assistant.io/badges/supervisor_addon.svg)](https://my.home-assistant.io/redirect/supervisor_addon/?addon=reolink_unifi_bridge&repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif)

Übersetzt das proprietäre Reolink-Baichuan-Protokoll in ONVIF, sodass UniFi Protect Reolink-Kameras als native Geräte erkennt und adoptiert.

### Architektur

```
Reolink-Kamera
    │  (Baichuan-Protokoll)
    ▼
┌─────────────┐
│   Neolink   │  Port 8554  →  RTSP-Stream
└─────────────┘
    │
    ▼
┌─────────────┐
│   go2rtc    │  Port 18554  →  RTSP-Proxy (stabile Verbindungen)
└─────────────┘
    │
    ▼
┌───────────────┐
│  ONVIF-Server │  Ports 8001–8009  →  Virtuelle ONVIF-Kamera (MacVLAN)
└───────────────┘
    │
    ▼
UniFi Protect  ←  adoptiert Kamera als ONVIF-Gerät

MQTT (intern)  →  Home Assistant: Bewegung, Batterie, Vorschau
Dashboard      →  Port 8099 (Ingress)  →  Status-Übersicht
```

### Funktionen

#### Kamera-Verbindung & Protokoll
- Reolink Baichuan → RTSP-Übersetzung via **Neolink**
- Unterstützte Verbindungstypen: `local`, `remote`, `map` (P2P), `relay`
- UID-basierte Verbindung für Remote-/Relay-Kameras
- Unterstützung für Multi-Kanal-NVRs

#### RTSP-Streaming
- Dual-Stream: Main (hohe Qualität) + Sub (niedrige Qualität)
- Stream-Stabilisierung via **go2rtc** (multiplexed)
- Direkter RTSP-Zugriff auf Port 8554 (Neolink) oder 18554 (go2rtc)

#### ONVIF-Integration
- **MacVLAN**-Interfaces mit dedizierter MAC-Adresse pro Kamera
- IP-Zuweisung: DHCP oder statisch konfigurierbar
- UUID-Persistenz (`uuids.json`) — UniFi Protect behält adoptierte Kameras nach Neustart
- Ports pro Kamera: `8001+n` (ONVIF), `8101+n` (RTSP), `8201+n` (Snapshot)

#### Bewegungserkennung & MQTT
- Echtzeit-Bewegungserkennung → MQTT-Topics
- Batteriestand-Monitoring (Akku-Kameras)
- Vorschaubilder bei Bewegung
- Home Assistant Auto-Discovery: Entitäten erscheinen automatisch
  - `binary_sensor.<name>_motion`
  - `sensor.<name>_battery`

#### Akku-Kamera-Optimierungen
- `idle_disconnect` — Verbindungstrennung im Ruhezustand
- `pause on client` — Stream pausiert ohne aktiven Empfänger
- `pause on motion` — Stream pausiert bis Bewegung erkannt wird

#### Web-Dashboard (Port 8099)
- Echtzeit-Servicestatus aller Komponenten
- Kameraliste mit Status (Bewegung, Batterie)
- RTSP-URLs mit Kopier-Funktion
- Bewegungsprotokoll (letzte 50 Ereignisse)
- Auto-Refresh alle 10 Sekunden

### Ports & Dienste

| Port | Dienst | Richtung | Beschreibung |
|------|--------|----------|--------------|
| 8554 | Neolink | intern | RTSP von Reolink-Kamera |
| 18554 | go2rtc | extern | RTSP-Proxy für Clients |
| 8001–8009 | ONVIF-Server | extern | Virtuelle ONVIF-Kameras |
| 1883 | Mosquitto | intern (localhost) | MQTT-Broker |
| 1984 | go2rtc API | intern (localhost) | Management-API |
| 8099 | Dashboard | Ingress | Web-Statusseite |

### Konfiguration

```yaml
host_interface: eth0          # Netzwerkinterface des Hosts (z. B. eth0, ens3)
neolink_port: 8554            # Neolink RTSP-Port
go2rtc_port: 18554            # go2rtc RTSP-Port
log_level: info               # Loglevel: error | warn | info | debug

cameras:
  - name: Eingang             # Eindeutiger Name (alphanumerisch + _)
    address: 192.168.1.100    # IP der echten Reolink-Kamera
    username: admin
    password: mein_passwort
    # uid: "ABC123"           # Optional: UID für Remote/Relay
    # channel: 0              # Optional: Kanal für NVR
    # discovery: local        # Optional: local | remote | map | relay

    is_battery_camera: false  # Akku-Kamera-Optimierungen aktivieren
    enable_motion: true       # Bewegungserkennung → MQTT
    enable_battery: false     # Batteriestand → MQTT
    enable_preview: false     # Vorschaubilder → MQTT

    ip_mode: static           # dhcp | static
    onvif_ip: 192.168.1.201   # Virtuelle ONVIF-IP (bei static)
    onvif_mac: "02:00:00:00:01:01"  # Eindeutige virtuelle MAC-Adresse

    stream_high_width: 2560
    stream_high_height: 1440
    stream_high_fps: 15
    stream_high_bitrate: 4096

    stream_low_width: 640
    stream_low_height: 360
    stream_low_fps: 7
    stream_low_bitrate: 512
```

### Beispiel-Einrichtung (2 Kameras)

```yaml
host_interface: eth0
neolink_port: 8554
go2rtc_port: 18554
log_level: info

cameras:
  - name: Eingang
    address: 192.168.1.101
    username: admin
    password: geheim123
    enable_motion: true
    ip_mode: static
    onvif_ip: 192.168.1.201
    onvif_mac: "02:00:00:00:01:01"
    stream_high_width: 2560
    stream_high_height: 1440
    stream_high_fps: 15
    stream_high_bitrate: 4096
    stream_low_width: 640
    stream_low_height: 360
    stream_low_fps: 7
    stream_low_bitrate: 512

  - name: Garten
    address: 192.168.1.102
    username: admin
    password: geheim456
    enable_motion: true
    is_battery_camera: true
    ip_mode: static
    onvif_ip: 192.168.1.202
    onvif_mac: "02:00:00:00:01:02"
    stream_high_width: 1920
    stream_high_height: 1080
    stream_high_fps: 15
    stream_high_bitrate: 2048
    stream_low_width: 640
    stream_low_height: 360
    stream_low_fps: 7
    stream_low_bitrate: 512
```

### Einrichtungsschritte

#### 1. Router konfigurieren

Für jede Kamera wird eine **virtuelle IP** benötigt, die außerhalb des DHCP-Bereichs liegt.

| Router | Einstellung |
|--------|-------------|
| **Fritzbox** | Heimnetz → Netzwerk → IPv4-Adressen → DHCP-Pool auf `.200` begrenzen |
| **UniFi/UDM** | Networks → LAN → DHCP Range → End auf `.200` setzen |
| **OpenWRT** | Network → Interfaces → DHCP Server → Limit auf 200 Adressen |

#### 2. Add-on installieren

[![Install Add-on](https://my.home-assistant.io/badges/supervisor_addon.svg)](https://my.home-assistant.io/redirect/supervisor_addon/?addon=reolink_unifi_bridge&repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif)

#### 3. Add-on konfigurieren & starten

> Add-on öffnen → **Konfiguration** → YAML einfügen → **Speichern** → **Starten**

#### 4. Kamera in UniFi Protect adoptieren

1. UniFi Protect öffnen → **Kameras → Kamera hinzufügen → ONVIF-Gerät**
2. IP: `onvif_ip` der Kamera (z. B. `192.168.1.201`)
3. Port: `8001` (erste Kamera), `8002` (zweite Kamera), ...
4. Benutzername/Passwort: beliebig (virtuelle Geräte benötigen keine Auth)
5. Kamera wird automatisch als ONVIF-Gerät adoptiert

#### 5. Home Assistant MQTT-Integration prüfen

[![MQTT Integration](https://my.home-assistant.io/badges/integration.svg)](https://my.home-assistant.io/redirect/integration/?domain=mqtt)

Bewegungssensoren und Batterie-Entitäten erscheinen automatisch nach dem Start.

---

## 2. ONVIF Server

[![Install Add-on](https://my.home-assistant.io/badges/supervisor_addon.svg)](https://my.home-assistant.io/redirect/supervisor_addon/?addon=onvif_server&repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif)

Standalone ONVIF-Server, der beliebige RTSP-Streams als virtuelle ONVIF-Kameras für UniFi Protect bereitstellt.

### Funktionen

- Wandelt RTSP-Streams in ONVIF-konforme virtuelle Kameras um
- MacVLAN-Interfaces mit statischer IP pro Kamera
- WS-Discovery (UDP Multicast Port 3702) für automatische Geräteerkennung
- UUID-Persistenz über Neustarts
- Dual-Quality-Profile (High/Low) aus demselben Stream
- RTSP-Passthrough-Proxy
- HTTP-Snapshot-Endpunkt pro Kamera

### Ports pro Kamera

| Zweck | Port |
|-------|------|
| ONVIF HTTP | `port` (z. B. 8001) |
| RTSP-Passthrough | `port + 100` (z. B. 8101) |
| Snapshot HTTP | `port + 200` (z. B. 8201) |

### Konfiguration

```yaml
cameras:
  - name: Garten
    rtsp_url: "rtsp://user:pass@192.168.1.100:8556/Garten"
    port: 8001
    width: 1920
    height: 1080
    fps: 15
    bitrate: 2048
```

### Beispiel-Einrichtung (2 Kameras von go2rtc)

```yaml
cameras:
  - name: Eingang
    rtsp_url: "rtsp://admin:passwort@10.10.9.33:8556/Eingang"
    port: 8001
    width: 2560
    height: 1440
    fps: 15
    bitrate: 4096

  - name: Garten
    rtsp_url: "rtsp://admin:passwort@10.10.9.33:8556/Garten"
    port: 8002
    width: 1920
    height: 1080
    fps: 15
    bitrate: 2048
```

### Einrichtungsschritte

#### 1. Router — DHCP-Pool einschränken

IPs `.241`, `.242`, `.243` (usw.) müssen außerhalb des DHCP-Bereichs liegen. Begrenze den Pool auf `.240`.

#### 2. Add-on installieren & konfigurieren

[![Install Add-on](https://my.home-assistant.io/badges/supervisor_addon.svg)](https://my.home-assistant.io/redirect/supervisor_addon/?addon=onvif_server&repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif)

> Konfiguration einfügen → Speichern → Starten

#### 3. Kamera in UniFi Protect hinzufügen

**Option A — Manuell:**
1. UniFi Protect → **Kameras → Kamera hinzufügen → ONVIF-Gerät**
2. IP: Host-IP (z. B. `10.10.9.33`)
3. Port: konfigurierter Port (z. B. `8001`)

**Option B — Auto-Discovery:**
> UniFi Protect erkennt die virtuellen Kameras automatisch per WS-Discovery im gleichen Netzwerk.

---

## MQTT-Topics (Reolink Bridge)

| Topic | Wert | Beschreibung |
|-------|------|--------------|
| `neolink/<name>/status/motion` | `on` / `off` | Bewegungsstatus |
| `neolink/<name>/status/battery_level` | `0`–`100` | Batteriestand in % |
| `homeassistant/binary_sensor/<name>_motion/config` | JSON | HA Auto-Discovery |
| `homeassistant/sensor/<name>_battery/config` | JSON | HA Auto-Discovery |

---

## Unterstützte Architekturen

| Add-on | amd64 | aarch64 | armv7 | armhf |
|--------|-------|---------|-------|-------|
| Reolink Bridge | ✅ | ✅ | ✅ | ✅ |
| ONVIF Server | ✅ | ✅ | ✅ | — |

---

## Schnelllinks

| Aktion | Link |
|--------|------|
| Repository hinzufügen | [![Add Repository](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif) |
| Reolink Bridge installieren | [![Install](https://my.home-assistant.io/badges/supervisor_addon.svg)](https://my.home-assistant.io/redirect/supervisor_addon/?addon=reolink_unifi_bridge&repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif) |
| ONVIF Server installieren | [![Install](https://my.home-assistant.io/badges/supervisor_addon.svg)](https://my.home-assistant.io/redirect/supervisor_addon/?addon=onvif_server&repository_url=https%3A%2F%2Fgithub.com%2FKayhartmann%2Fonif) |
| MQTT-Integration öffnen | [![MQTT](https://my.home-assistant.io/badges/integration.svg)](https://my.home-assistant.io/redirect/integration/?domain=mqtt) |
| Add-on Store öffnen | [![Add-on Store](https://my.home-assistant.io/badges/supervisor_store.svg)](https://my.home-assistant.io/redirect/supervisor_store/) |

---

## Reolink UID finden

Die UID wird für Remote- oder Relay-Verbindungen benötigt (wenn Kamera nicht im lokalen Netz erreichbar ist):

1. Reolink App öffnen → Kamera auswählen → **Einstellungen → Geräte-Info**
2. Die UID beginnt mit `XXXXXXXXXXXXXXXX` (16 Zeichen, alphanumerisch)
3. In der Konfiguration unter `uid:` eintragen

---

## MacVLAN — warum notwendig?

UniFi Protect erwartet, dass jede Kamera eine **eigene IP-Adresse** im Netzwerk hat. Da Reolink-Kameras kein ONVIF sprechen, erstellt das Add-on virtuelle Netzwerkinterfaces (MacVLAN), die für UniFi Protect wie echte Geräte aussehen. Jedes virtuelle Interface bekommt eine eigene MAC-Adresse und IP — genau wie eine physische Kamera.

**Voraussetzungen:**
- Der Host-Rechner (HA) muss am selben physischen Netzwerk hängen wie UniFi Protect
- Keine WLAN-Brücken (MacVLAN funktioniert nur über kabelgebundene Interfaces oder bestimmte WLAN-Treiber)
- `host_interface` muss der tatsächliche Interface-Name sein (z. B. `eth0`, `enp3s0`) — prüfen mit `ip link show`

---

## Häufige Probleme

**MacVLAN-Interface wird nicht erstellt**
→ Prüfe, ob `host_interface` dem tatsächlichen Interface-Namen entspricht (`ip link show`)

**UniFi Protect findet Kamera nicht**
→ ONVIF-IP muss im gleichen Subnetz wie der HA-Host und UniFi sein

**RTSP-Stream nicht verfügbar**
→ Kamera-IP und Zugangsdaten in der Konfiguration prüfen; Dashboard auf Port 8099 öffnen

**Kamera nach Neustart nicht mehr in UniFi Protect**
→ UUID-Persistenz ist aktiv — UUIDs werden in `/data/uuids.json` gespeichert. Nur bei vollständigem Datenverlust muss die Kamera neu adoptiert werden.

---

## Maintainer

**Kayhartmann** — [GitHub](https://github.com/Kayhartmann)

Basiert auf:
- [neolink](https://github.com/thirtythreeforty/neolink) — Reolink-Protokoll-Übersetzer
- [go2rtc](https://github.com/AlexxIT/go2rtc) — RTSP-Proxy
- [daniela-hase/onvif-server](https://github.com/daniela-hase/onvif-server) — ONVIF-Server
