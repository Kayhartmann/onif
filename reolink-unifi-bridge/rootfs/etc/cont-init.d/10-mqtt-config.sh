#!/usr/bin/with-contenv bashio
# ==============================================================================
# 10-mqtt-config.sh
# Configures Mosquitto MQTT broker for internal use
# ==============================================================================
set -e

bashio::log.info "Configuring internal MQTT broker (Mosquitto)..."

# Ensure mosquitto directories exist
mkdir -p /var/lib/mosquitto /etc/mosquitto/conf.d

# Write main mosquitto config
cat > /etc/mosquitto/mosquitto.conf << 'EOF'
# Reolink UniFi Bridge - Internal Mosquitto Config
pid_file /var/run/mosquitto.pid
persistence true
persistence_location /var/lib/mosquitto/

log_dest stdout
log_type error
log_type warning
log_type notice
log_type information
log_timestamp true

include_dir /etc/mosquitto/conf.d
EOF

# Write listener config
cat > /etc/mosquitto/conf.d/local.conf << 'EOF'
# Only listen on localhost - not exposed externally
listener 1883 127.0.0.1
allow_anonymous true
EOF

# Ensure proper ownership
chown -R mosquitto:mosquitto /var/lib/mosquitto 2>/dev/null || true
chown mosquitto:mosquitto /etc/mosquitto/mosquitto.conf 2>/dev/null || true

bashio::log.info "MQTT broker configured on 127.0.0.1:1883"
