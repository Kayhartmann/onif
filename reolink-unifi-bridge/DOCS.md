# Reolink → UniFi Protect Bridge — Documentation

This add-on bridges Reolink cameras (which use the proprietary Baichuan protocol) to
UniFi Protect using ONVIF. It combines three services into one:

| Component | Role |
|---|---|
| **Neolink** | Translates Reolink Baichuan → RTSP |
| **go2rtc** | RTSP proxy / restreamer (stable multiplexed connections) |
| **ONVIF Server** | Exposes virtual ONVIF cameras so UniFi Protect can adopt them |

## Quick Start

1. **Install** the add-on from this repository.
2. **Configure** cameras in the add-on configuration UI (no YAML files to edit).
3. **Start** the add-on and open the dashboard via the sidebar panel.
4. **Add** each camera's `onvif_ip` as a DHCP reservation on your router.
5. **Adopt** cameras in UniFi Protect → Cameras → Add Camera → ONVIF.

---

## Prerequisites

### DHCP Reservations

Each camera needs two IP addresses:

| Address | Purpose |
|---|---|
| **Camera IP** (`address`) | The real Reolink camera. Reserve in your router DHCP so it never changes. |
| **ONVIF IP** (`onvif_ip`) | A virtual IP this add-on creates via MacVLAN. UniFi Protect connects to this. |

The ONVIF IPs must be:
- On the same subnet as your host (`eth0`)
- Not assigned to any real device
- Reserved in your DHCP server (or outside the DHCP range)

### MacVLAN Explanation

MacVLAN creates virtual network interfaces on the host. Each one has its own IP
and MAC address and appears as a separate device on your LAN — this is how UniFi
Protect sees each camera as an independent ONVIF device.

The add-on automatically creates these interfaces on startup using the `onvif_mac`
and `onvif_ip` values you configure.

> **Note:** MacVLAN requires the `privileged: true` flag in the add-on config
> (already set). Your host network interface name must match `host_interface`
> (check with `ip link show` on the host).

---

## Camera Configuration

Each camera entry in the add-on settings:

```
name:              frontdoor          # Unique short name
address:           192.168.1.100      # Real camera IP
username:          admin
password:          yourpassword
is_battery_camera: false              # Enable for battery cams
enable_motion:     true               # MQTT motion events
enable_battery:    false              # MQTT battery level
enable_preview:    false              # MQTT preview images
onvif_ip:          192.168.1.201     # Virtual ONVIF IP
onvif_mac:         02:00:00:00:01:01 # Virtual MAC (must be unique)
stream_high_width:  2560
stream_high_height: 1440
stream_high_fps:    15
stream_low_width:   640
stream_low_height:  360
stream_low_fps:     7
```

---

## UniFi Protect Adoption

1. Open UniFi Protect → **Cameras** → **+ Add Camera**
2. Select **ONVIF Camera**
3. Enter the `onvif_ip` of your camera
4. Use username/password from your camera config
5. Protect will detect the camera streams automatically

> If the camera doesn't appear, verify: the ONVIF IP is reachable from the
> UniFi Protect machine, the add-on is running, and the MacVLAN interface exists
> (`ip link show | grep onvif`).

---

## MQTT / Motion Detection

When `enable_motion: true`, Neolink publishes to these MQTT topics (internal broker):

```
neolink/{camera_name}/status/motion         → "on" or "off"
neolink/{camera_name}/status/battery_level  → percentage (0–100)
```

The dashboard automatically publishes **Home Assistant auto-discovery** payloads so
your cameras appear as entities:

- `binary_sensor.{name}_motion` — Motion sensor
- `sensor.{name}_battery` — Battery level (for battery cameras)

These entities will appear in HA without any manual YAML configuration.

### Connecting to Your Own MQTT Broker

The internal Mosquitto broker is only accessible within the container. If you
want to forward events to an external MQTT broker (e.g. Mosquitto HA add-on),
you can bridge the topics using the Mosquitto bridge feature (advanced — not
required for basic HA integration since auto-discovery works via the internal broker).

---

## Battery Camera Tips

For battery-powered Reolink cameras, enable `is_battery_camera: true`:

- **`idle_disconnect: true`** — Neolink disconnects from the camera when it's idle,
  allowing the camera to sleep and saving battery.
- **Pause on client** — The RTSP stream is paused when no client is connected.
- **Pause on motion** — The stream activates when motion is detected, then stops.

> **Important:** With battery cameras, streams will not be available 24/7.
> UniFi Protect may show them as offline between events. This is normal.

---

## RTSP Stream URLs

Once running, streams are accessible at (replace `[HOST]` with your HA host IP):

| Stream | URL |
|---|---|
| High quality (via go2rtc) | `rtsp://[HOST]:18554/{camera_name}` |
| Low quality (via go2rtc) | `rtsp://[HOST]:18554/{camera_name}_sub` |
| High quality (direct Neolink) | `rtsp://[HOST]:8554/{camera_name}/main` |
| Low quality (direct Neolink) | `rtsp://[HOST]:8554/{camera_name}/sub` |

These URLs are also shown in the dashboard, one-click copyable.

---

## Troubleshooting

### Camera not connecting
- Verify the camera IP is correct and reachable: `ping 192.168.1.100`
- Check the username/password are correct (test in Reolink app)
- Try `discovery: local` explicitly in camera settings
- Check the add-on logs for Neolink error messages

### ONVIF not detected by UniFi Protect
- Confirm the MacVLAN interface exists: check add-on logs for "MacVLAN ready"
- Verify the ONVIF IP is on the same subnet as the Protect machine
- Check `host_interface` matches the actual interface: `ip link show` on host
- Try pinging the ONVIF IP from the UniFi machine

### Dashboard shows service as offline
- Wait 30–60 seconds after start — services start sequentially
- Check add-on logs for error messages
- If Neolink fails: verify camera credentials and network connectivity
- If go2rtc fails: check port conflicts (default 18554)

### Motion detection not working
- Ensure `enable_motion: true` for the camera
- Battery cameras: motion events only trigger when camera is awake
- Check add-on logs for MQTT connection messages

### MacVLAN creation fails
- The host must support MacVLAN (most Linux hosts do, but some VMs/containers don't)
- Ensure `privileged: true` is set (it is by default in this add-on)
- Virtual machines may need promiscuous mode enabled on the virtual NIC
- On Proxmox: enable the "Promiscuous Mode" option on the VM's network bridge

---

## Ports Reference

| Port | Service | Direction |
|---|---|---|
| 8554 | Neolink RTSP | Internal + configurable |
| 18554 | go2rtc RTSP | External (clients connect here) |
| 1883 | Mosquitto MQTT | Internal only |
| 1984 | go2rtc API | Internal only |
| 8080 | ONVIF (per camera) | External (UniFi Protect) |
| 8099 | Dashboard (Ingress) | HA Ingress only |

---

## Support

- [GitHub Issues](https://github.com/Kayhartmann/onif/issues)
- [Neolink Documentation](https://github.com/QuantumEntangledAndy/neolink)
- [go2rtc Documentation](https://github.com/AlexxIT/go2rtc)
- [ONVIF Server](https://github.com/daniela-hase/onvif-server)
