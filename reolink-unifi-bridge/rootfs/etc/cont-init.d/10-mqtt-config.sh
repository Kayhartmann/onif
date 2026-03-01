#!/usr/bin/with-contenv bashio
# ==============================================================================
# 10-mqtt-config.sh
# Determines MQTT broker configuration.
#
# Priority:
#   1. Manual config: mqtt_host set in add-on options → use those values
#   2. Auto-discovery: bashio::services.mqtt via HA supervisor (Mosquitto Add-on)
#   3. Not available → disable MQTT features
#
# Writes /tmp/mqtt.json (for Node.js) and /tmp/mqtt.env (for bash).
# ==============================================================================
set -e

bashio::log.info "Configuring MQTT broker connection..."

MQTT_HOST_MANUAL=""
MQTT_PORT_MANUAL=1883

# ── Check for manual MQTT configuration ─────────────────────────────────────
if bashio::config.exists 'mqtt_host'; then
    MQTT_HOST_MANUAL=$(bashio::config 'mqtt_host' || echo "")
fi
if bashio::config.exists 'mqtt_port'; then
    MQTT_PORT_MANUAL=$(bashio::config 'mqtt_port' || echo "1883")
fi

if [ -n "${MQTT_HOST_MANUAL}" ]; then
    bashio::log.info "Using manual MQTT configuration: ${MQTT_HOST_MANUAL}:${MQTT_PORT_MANUAL}"

    # JSON for Node.js services
    cat > /tmp/mqtt.json << EOF
{
  "available": true,
  "source": "manual",
  "host": "${MQTT_HOST_MANUAL}",
  "port": ${MQTT_PORT_MANUAL},
  "username": "",
  "password": "",
  "ssl": false
}
EOF

    # Shell env-vars for bash scripts
    cat > /tmp/mqtt.env << EOF
MQTT_AVAILABLE=true
MQTT_SOURCE=manual
MQTT_HOST="${MQTT_HOST_MANUAL}"
MQTT_PORT="${MQTT_PORT_MANUAL}"
MQTT_USER=""
MQTT_PASS=""
MQTT_SSL=false
EOF

    bashio::log.info "MQTT (manual) written to /tmp/mqtt.json"
    exit 0
fi

# ── Try auto-discovery via HA supervisor ─────────────────────────────────────
bashio::log.info "No manual MQTT config — checking HA supervisor (Mosquitto Add-on)..."

if ! bashio::services.mqtt; then
    bashio::log.warning "No MQTT broker available."
    bashio::log.warning "To enable motion/battery: install Mosquitto Add-on OR set mqtt_host in add-on config."
    printf '{"available":false,"source":"none"}' > /tmp/mqtt.json
    printf 'MQTT_AVAILABLE=false\nMQTT_SOURCE=none\n' > /tmp/mqtt.env
    exit 0
fi

MQTT_HOST=$(bashio::services.mqtt host)
MQTT_PORT=$(bashio::services.mqtt port)
MQTT_USER=$(bashio::services.mqtt username)
MQTT_PASS=$(bashio::services.mqtt password)
MQTT_SSL=$(bashio::services.mqtt ssl)

bashio::log.info "MQTT auto-discovered: ${MQTT_HOST}:${MQTT_PORT} ssl=${MQTT_SSL}"

# JSON for Node.js services
cat > /tmp/mqtt.json << EOF
{
  "available": true,
  "source": "auto",
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
MQTT_SOURCE=auto
MQTT_HOST="${MQTT_HOST}"
MQTT_PORT="${MQTT_PORT}"
MQTT_USER="${MQTT_USER}"
MQTT_PASS="${MQTT_PASS}"
MQTT_SSL="${MQTT_SSL}"
EOF

bashio::log.info "MQTT credentials written to /tmp/mqtt.json"
