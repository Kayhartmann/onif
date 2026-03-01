#!/usr/bin/with-contenv bashio
# ==============================================================================
# 05-port-selection.sh
# Auto-selects free ports for all services.
# Reads configured (preferred) ports from options.json, checks if they are
# free on the host (host_network: true), and picks the next available port
# if the preferred one is already in use.
#
# Writes /tmp/actual-ports.json — all subsequent scripts read from this file.
# ==============================================================================
set -e

bashio::log.info "Checking port availability and selecting free ports..."

OPTIONS_FILE="/data/options.json"
ACTUAL_PORTS_FILE="/tmp/actual-ports.json"
MAX_TRIES=20

# ── Find a free TCP port starting from a given base ─────────────────────────
# Usage: find_free_port BASE_PORT [MAX_TRIES]
# Returns: the first free port >= BASE_PORT, or base+MAX_TRIES on failure
find_free_port() {
    local port="$1"
    local max="${2:-${MAX_TRIES}}"
    local tries=0
    while [ "${tries}" -lt "${max}" ]; do
        if ! (echo >/dev/tcp/127.0.0.1/"${port}") 2>/dev/null; then
            echo "${port}"
            return 0
        fi
        bashio::log.warning "  Port ${port} is in use, trying $((port + 1))..."
        port=$((port + 1))
        tries=$((tries + 1))
    done
    # If all attempts failed, return the last tried port (best effort)
    echo "${port}"
}

# ── Read preferred ports from options.json (with defaults) ──────────────────
NEOLINK_PREFERRED=$(bashio::config 'neolink_port' 2>/dev/null || echo "8554")
GO2RTC_PREFERRED=$(bashio::config 'go2rtc_port'   2>/dev/null || echo "18554")
GO2RTC_API_PREFERRED=1984
ONVIF_BASE_PREFERRED=8001
DASHBOARD_PREFERRED=8099

# ── Select actual free ports ─────────────────────────────────────────────────
bashio::log.info "  Checking Neolink RTSP port (preferred: ${NEOLINK_PREFERRED})..."
NEOLINK_PORT=$(find_free_port "${NEOLINK_PREFERRED}")

bashio::log.info "  Checking go2rtc RTSP port (preferred: ${GO2RTC_PREFERRED})..."
GO2RTC_RTSP_PORT=$(find_free_port "${GO2RTC_PREFERRED}")

bashio::log.info "  Checking go2rtc API port (preferred: ${GO2RTC_API_PREFERRED})..."
GO2RTC_API_PORT=$(find_free_port "${GO2RTC_API_PREFERRED}")

bashio::log.info "  Checking ONVIF base port (preferred: ${ONVIF_BASE_PREFERRED})..."
# ONVIF needs one port per camera — check enough range
CAMERA_COUNT=$(bashio::config 'cameras | length' 2>/dev/null || echo "0")
ONVIF_BASE_PORT=$(find_free_port "${ONVIF_BASE_PREFERRED}")

bashio::log.info "  Checking Dashboard port (preferred: ${DASHBOARD_PREFERRED})..."
DASHBOARD_PORT=$(find_free_port "${DASHBOARD_PREFERRED}")

# ── Log any changes ──────────────────────────────────────────────────────────
[ "${NEOLINK_PORT}"    != "${NEOLINK_PREFERRED}"     ] && \
    bashio::log.warning "Neolink RTSP: ${NEOLINK_PREFERRED} → ${NEOLINK_PORT} (auto-selected)"
[ "${GO2RTC_RTSP_PORT}" != "${GO2RTC_PREFERRED}"     ] && \
    bashio::log.warning "go2rtc RTSP:  ${GO2RTC_PREFERRED} → ${GO2RTC_RTSP_PORT} (auto-selected)"
[ "${GO2RTC_API_PORT}"  != "${GO2RTC_API_PREFERRED}" ] && \
    bashio::log.warning "go2rtc API:   ${GO2RTC_API_PREFERRED} → ${GO2RTC_API_PORT} (auto-selected)"
[ "${ONVIF_BASE_PORT}"  != "${ONVIF_BASE_PREFERRED}" ] && \
    bashio::log.warning "ONVIF base:   ${ONVIF_BASE_PREFERRED} → ${ONVIF_BASE_PORT} (auto-selected)"
[ "${DASHBOARD_PORT}"   != "${DASHBOARD_PREFERRED}"  ] && \
    bashio::log.warning "Dashboard:    ${DASHBOARD_PREFERRED} → ${DASHBOARD_PORT} (auto-selected)"

# ── Write actual-ports.json ──────────────────────────────────────────────────
cat > "${ACTUAL_PORTS_FILE}" << EOF
{
  "neolink":       ${NEOLINK_PORT},
  "go2rtc_rtsp":   ${GO2RTC_RTSP_PORT},
  "go2rtc_api":    ${GO2RTC_API_PORT},
  "onvif_base":    ${ONVIF_BASE_PORT},
  "dashboard":     ${DASHBOARD_PORT}
}
EOF

bashio::log.info "Port selection complete:"
bashio::log.info "  Neolink RTSP : ${NEOLINK_PORT}"
bashio::log.info "  go2rtc RTSP  : ${GO2RTC_RTSP_PORT}"
bashio::log.info "  go2rtc API   : ${GO2RTC_API_PORT}"
bashio::log.info "  ONVIF base   : ${ONVIF_BASE_PORT}"
bashio::log.info "  Dashboard    : ${DASHBOARD_PORT}"
bashio::log.info "Written to ${ACTUAL_PORTS_FILE}"
