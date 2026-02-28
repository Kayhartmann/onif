#!/usr/bin/with-contenv bashio
# ==============================================================================
# 40-onvif-config.sh — MOVED to 60-onvif-config.sh
# ONVIF server config now runs AFTER 50-macvlan-setup.sh so that
# DHCP-assigned IPs are already written to /tmp/camera-ips.json.
# ==============================================================================
bashio::log.debug "ONVIF config deferred — see 60-onvif-config.sh"
