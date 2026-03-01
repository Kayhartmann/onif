#!/usr/bin/with-contenv bashio
# ==============================================================================
# 10-mqtt-config.sh
# Reads MQTT broker credentials from the HA supervisor (services: mqtt:need)
# and writes them to /tmp/mqtt.json (for Node.js) and /tmp/mqtt.env (for bash).
# ==============================================================================
set -e

bashio::log.info "Reading MQTT broker credentials from Home Assistant supervisor..."

# Check if MQTT service is available
if ! bashio::services.mqtt; then
    bashio::log.warning "No MQTT broker available – MQTT features (motion, battery) will be disabled."
    printf '{"available":false}' > /tmp/mqtt.json
    printf 'MQTT_AVAILABLE=false\n' > /tmp/mqtt.env
    exit 0
fi

MQTT_HOST=$(bashio::services.mqtt host)
MQTT_PORT=$(bashio::services.mqtt port)
MQTT_USER=$(bashio::services.mqtt username)
MQTT_PASS=$(bashio::services.mqtt password)
MQTT_SSL=$(bashio::services.mqtt ssl)

bashio::log.info "MQTT broker: ${MQTT_HOST}:${MQTT_PORT} ssl=${MQTT_SSL}"

# JSON for Node.js services
cat > /tmp/mqtt.json << EOF
{
  "available": true,
  "host": "${MQTT_HOST}",
  "port": ${MQTT_PORT},
  "username": "${MQTT_USER}",
  "password": "${MQTT_PASS}",
  "ssl": ${MQTT_SSL}
}
EOF

# Shell env-vars for bash scripts
cat > /tmp/mqtt.env << EOF
MQTT_AVAILABLE=true
MQTT_HOST="${MQTT_HOST}"
MQTT_PORT="${MQTT_PORT}"
MQTT_USER="${MQTT_USER}"
MQTT_PASS="${MQTT_PASS}"
MQTT_SSL="${MQTT_SSL}"
EOF

bashio::log.info "MQTT credentials written to /tmp/mqtt.json"
