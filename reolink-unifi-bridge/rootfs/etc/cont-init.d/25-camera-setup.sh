#!/usr/bin/with-contenv bashio
# ==============================================================================
# 25-camera-setup.sh
# Applies per-camera settings via the Reolink HTTP API before services start.
#
# Currently handles:
#   continuous_recording: true  → 24/7 recording schedule (camera always streams)
#   continuous_recording: false → motion-only recording schedule
#
# Requires the camera to be reachable on port 80 (HTTP).
# Silently skips cameras that are not reachable (e.g. cross-VLAN firewall).
# ==============================================================================
set +e

CAMERA_COUNT=$(bashio::config 'cameras | length')

if ! bashio::config.exists 'cameras'; then
    exit 0
fi

# 168 = 7 days × 24 hours. '1' = record all day, '0' = no recording.
TABLE_CONTINUOUS=$(python3 -c "print('1'*168)")
TABLE_MOTION=$(python3 -c "print('0'*168)")

for i in $(seq 0 $((CAMERA_COUNT - 1))); do
    CAM_NAME=$(bashio::config "cameras[${i}].name")

    # Only run if continuous_recording is explicitly set
    if ! bashio::config.exists "cameras[${i}].continuous_recording"; then
        continue
    fi
    CONTINUOUS=$(bashio::config "cameras[${i}].continuous_recording")

    CAM_ADDRESS=""
    if bashio::config.exists "cameras[${i}].address"; then
        CAM_ADDRESS=$(bashio::config "cameras[${i}].address")
    fi

    if [ -z "${CAM_ADDRESS}" ]; then
        bashio::log.warning "  [${CAM_NAME}] continuous_recording set but no address — skipping"
        continue
    fi

    CAM_USER=$(bashio::config "cameras[${i}].username")
    CAM_PASS=$(bashio::config "cameras[${i}].password")

    if bashio::var.true "${CONTINUOUS}"; then
        TABLE="${TABLE_CONTINUOUS}"
        MODE="continuous (24/7)"
    else
        TABLE="${TABLE_MOTION}"
        MODE="motion-only"
    fi

    bashio::log.info "  [${CAM_NAME}] Setting recording mode: ${MODE} on ${CAM_ADDRESS}"

    # Try Reolink HTTP API (SetRec — works on most firmware versions)
    RESP=$(curl -s -m 5 -X POST \
        "http://${CAM_ADDRESS}/api.cgi?cmd=SetRec&user=${CAM_USER}&password=${CAM_PASS}" \
        -H "Content-Type: application/json" \
        -d "[{\"cmd\":\"SetRec\",\"action\":0,\"param\":{\"channel\":0,\"Rec\":{\"schedule\":{\"enable\":1,\"table\":\"${TABLE}\"}}}}]" \
        2>/dev/null)

    if echo "${RESP}" | grep -q '"value":0'; then
        bashio::log.info "  [${CAM_NAME}] Recording mode set: ${MODE} ✓"
        continue
    fi

    # Fallback: newer firmware uses SetRecV20
    RESP=$(curl -s -m 5 -X POST \
        "http://${CAM_ADDRESS}/api.cgi?cmd=SetRecV20&user=${CAM_USER}&password=${CAM_PASS}" \
        -H "Content-Type: application/json" \
        -d "[{\"cmd\":\"SetRecV20\",\"action\":0,\"param\":{\"channel\":0,\"Rec\":{\"schedule\":{\"enable\":1,\"table\":\"${TABLE}\"}}}}]" \
        2>/dev/null)

    if echo "${RESP}" | grep -q '"value":0'; then
        bashio::log.info "  [${CAM_NAME}] Recording mode set (V20 API): ${MODE} ✓"
    else
        bashio::log.warning "  [${CAM_NAME}] Could not set recording mode — camera not reachable on port 80 or API unsupported"
        bashio::log.warning "  [${CAM_NAME}] Set manually in Reolink App: Recording → Schedule → ${MODE}"
    fi
done

exit 0
