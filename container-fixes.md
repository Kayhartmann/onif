# Container-Fixes (direkt angewendet, noch nicht im Repo)

Stand: 2026-03-01

## Fix 1 — ONVIF YAML: `undefined` statt Zahlen

**Problem:** Kameras ohne explizite `stream_*`-Werte in options.json → JavaScript `undefined` wird als String in YAML geschrieben → onvif-server liefert `NaN` in ONVIF-Responses → UniFi Protect bekommt falsche Auflösung/FPS.

**Ursache:** `60-onvif-config.sh` Zeilen wie:
```js
yaml += `      width: ${camera.stream_high_width}\n`;  // → "width: undefined"
```

**Fix in `60-onvif-config.sh`:** Hilfsfunktion `val(v, default)`:
```js
function val(v, def) { return (v !== undefined && v !== null) ? v : def; }

const highW   = val(camera.stream_high_width,   1920);
const highH   = val(camera.stream_high_height,  1080);
const highFps = val(camera.stream_high_fps,       15);
const highBr  = val(camera.stream_high_bitrate, 4096);
const lowW    = val(camera.stream_low_width,     640);
const lowH    = val(camera.stream_low_height,    360);
const lowFps  = val(camera.stream_low_fps,         7);
const lowBr   = val(camera.stream_low_bitrate,   512);
```

**Defaults:** 1920×1080@15fps/4096kbps (high), 640×360@7fps/512kbps (low)

**Direkt gefixt:** `/data/onvif.yaml` mit korrekten Werten überschrieben + Script patched.

---

## Fix 2 — go2rtc i/o Timeout: Kamera ohne Sub-Stream

**Problem:** Reolink Argus Pro (Akkukamera "Garten") hat **keinen Sub-Stream** via Neolink/Baichuan. Neolink meldet nur `/Garten/main*` als verfügbar, nicht `/Garten/sub`. go2rtc timeout-Fehler:
```
error="read tcp 127.0.0.1:39052->127.0.0.1:8554: i/o timeout" url=rtsp://127.0.0.1:8554/Garten/sub
```

**Erkennung:** In Neolink-Logs:
- `neu` (E1, Kabel): `Avaliable at /neu/main, ... /neu/sub, ...` ✓
- `Garten` (Argus Pro, Akku): `Avaliable at /Garten/main, ...` — **kein /sub** ✗

**Fix in `30-go2rtc-config.sh`:** Neues optionales Kamera-Feld `has_substream` (default: `true`).
Bei `false` wird `camera_sub` auf `camera/main` umgeleitet:
```bash
HAS_SUB=$(bashio::config "cameras[${i}].has_substream" 2>/dev/null || echo "true")
if [ "${HAS_SUB}" = "true" ]; then
    SUB_PATH="${CAM_NAME}/sub"
else
    SUB_PATH="${CAM_NAME}/main"   # Fallback: kein Sub-Stream → Main als Sub
fi
```

**Direkt gefixt:** `/data/go2rtc/go2rtc.yaml` mit `Garten_sub → Garten/main`.

**Für Repo:** `config.yaml` Schema um `has_substream: bool?` erweitern + 30-go2rtc-config.sh anpassen.

---

## Fix 3 — GStreamer `textoverlay` (bekanntes Problem, nicht fixbar)

**Problem:** Neolink (compiled binary) versucht GStreamer `textoverlay` für Kamera-Name-Overlay zu nutzen. Das `libgstpango.so` Plugin fehlt im Container (nicht im HA Base Image enthalten, kein Internet-Zugang für apt).

```
ERROR GST_PIPELINE: no element "textoverlay"
WARN  rtspmediafactory: recoverable parsing error: no element "textoverlay"
```

**Auswirkung:** Kein Text-Overlay auf dem Stream (Kameraname/Timestamp). Stream selbst funktioniert.

**Status:** "recoverable" — Stream läuft ohne Overlay. Nicht weiter fixbar ohne neolink-Rebuild mit eigenem GStreamer. Kein Handlungsbedarf.

---

## Geänderte Dateien im Container

| Datei | Änderung |
|---|---|
| `/data/onvif.yaml` | `undefined` → echte Werte (1920×1080@15, 640×360@7) |
| `/data/go2rtc/go2rtc.yaml` | `Garten_sub` → `Garten/main` |
| `/etc/cont-init.d/30-go2rtc-config.sh` | `has_substream`-Option |
| `/etc/cont-init.d/60-onvif-config.sh` | `val()`-Defaults für stream_* |

## TODO für Repo (nach Container-Validierung)

- [ ] `rootfs/etc/cont-init.d/30-go2rtc-config.sh` — has_substream Logik
- [ ] `rootfs/etc/cont-init.d/60-onvif-config.sh` — val()-Defaults
- [ ] `reolink-unifi-bridge/config.yaml` — Schema: `has_substream: bool?` in cameras
- [ ] Version auf 1.0.25 bumpen
