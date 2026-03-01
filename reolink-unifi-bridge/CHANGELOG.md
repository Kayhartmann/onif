# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.11] - 2026-03-01

### Changed
- Dashboard: camera cards now show ONVIF URL and RTSP stream URLs with copy buttons
- Dashboard: ONVIF port derived automatically (8001 + camera index)

## [1.0.0] - 2024-01-01

### Added
- Initial release of Reolink → UniFi Protect Bridge
- Integrated Neolink (Reolink Baichuan → RTSP)
- Integrated go2rtc (RTSP proxy/restreamer)
- Integrated ONVIF Server (virtual cameras for UniFi Protect)
- Internal Mosquitto MQTT broker for motion events
- Web-based status dashboard via HA Ingress
- Battery camera optimizations (idle_disconnect, pause on client/motion)
- MQTT motion detection and battery monitoring
- Home Assistant auto-discovery for motion binary sensors and battery sensors
- MacVLAN setup for ONVIF virtual IPs
- Multi-architecture support (amd64, aarch64, armhf, armv7)
- GitHub Actions CI/CD workflows for automated builds and releases
- Zero-config setup — all configuration via HA Add-on UI
