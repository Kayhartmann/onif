#!/usr/bin/with-contenv bashio
# ==============================================================================
# 40-onvif-config.sh
# Generates ONVIF server configuration from HA add-on options
# ==============================================================================
set -e

bashio::log.info "Generating ONVIF server configuration..."

GO2RTC_PORT=$(bashio::config 'go2rtc_port')
CONFIG_FILE="/data/onvif-server.json"
CAMERA_COUNT=$(bashio::config 'cameras | length')

# Build camera array for ONVIF server JSON config
CAMERAS_JSON="["
FIRST=true

if bashio::config.exists 'cameras'; then
    for i in $(seq 0 $((CAMERA_COUNT - 1))); do
        CAM_NAME=$(bashio::config "cameras[${i}].name")
        ONVIF_IP=$(bashio::config "cameras[${i}].onvif_ip")
        ONVIF_MAC=$(bashio::config "cameras[${i}].onvif_mac")
        HIGH_W=$(bashio::config "cameras[${i}].stream_high_width")
        HIGH_H=$(bashio::config "cameras[${i}].stream_high_height")
        HIGH_FPS=$(bashio::config "cameras[${i}].stream_high_fps")
        LOW_W=$(bashio::config "cameras[${i}].stream_low_width")
        LOW_H=$(bashio::config "cameras[${i}].stream_low_height")
        LOW_FPS=$(bashio::config "cameras[${i}].stream_low_fps")

        bashio::log.info "  Configuring ONVIF camera: ${CAM_NAME} (IP: ${ONVIF_IP}, MAC: ${ONVIF_MAC})"

        if bashio::var.false "${FIRST}"; then
            CAMERAS_JSON="${CAMERAS_JSON},"
        fi
        FIRST=false

        CAMERAS_JSON="${CAMERAS_JSON}
    {
      \"name\": \"${CAM_NAME}\",
      \"ipAddress\": \"${ONVIF_IP}\",
      \"macAddress\": \"${ONVIF_MAC}\",
      \"highQualityStreamUrl\": \"rtsp://127.0.0.1:${GO2RTC_PORT}/${CAM_NAME}\",
      \"lowQualityStreamUrl\": \"rtsp://127.0.0.1:${GO2RTC_PORT}/${CAM_NAME}_sub\",
      \"highQualityWidth\": ${HIGH_W},
      \"highQualityHeight\": ${HIGH_H},
      \"highQualityFps\": ${HIGH_FPS},
      \"lowQualityWidth\": ${LOW_W},
      \"lowQualityHeight\": ${LOW_H},
      \"lowQualityFps\": ${LOW_FPS},
      \"onvifPort\": 8080
    }"
    done
fi

CAMERAS_JSON="${CAMERAS_JSON}
]"

cat > "${CONFIG_FILE}" << EOF
{
  "cameras": ${CAMERAS_JSON}
}
EOF

bashio::log.info "ONVIF configuration written to ${CONFIG_FILE}"
