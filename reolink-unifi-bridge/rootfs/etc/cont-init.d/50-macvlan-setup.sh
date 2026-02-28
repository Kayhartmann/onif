#!/usr/bin/with-contenv bashio
# ==============================================================================
# 50-macvlan-setup.sh
# Sets up MacVLAN interfaces for ONVIF camera virtual IPs
# Errors are logged but do NOT stop the add-on (|| true).
# ==============================================================================

HOST_IFACE=$(bashio::config 'host_interface')
CAMERA_COUNT=$(bashio::config 'cameras | length')

bashio::log.info "Setting up MacVLAN interfaces on ${HOST_IFACE}..."

if ! bashio::config.exists 'cameras'; then
    bashio::log.info "No cameras configured, skipping MacVLAN setup."
    exit 0
fi

for i in $(seq 0 $((CAMERA_COUNT - 1))); do
    CAM_NAME=$(bashio::config "cameras[${i}].name")
    ONVIF_IP=$(bashio::config "cameras[${i}].onvif_ip")
    ONVIF_MAC=$(bashio::config "cameras[${i}].onvif_mac")

    # Interface name max 15 chars: "onvif-" (6) + first 9 chars of name
    IFACE_NAME="onvif-${CAM_NAME:0:9}"

    bashio::log.info "  Setting up MacVLAN: ${IFACE_NAME} (IP: ${ONVIF_IP}, MAC: ${ONVIF_MAC})"

    # Remove existing interface if present (idempotent)
    ip link del "${IFACE_NAME}" 2>/dev/null || true

    # Create macvlan interface
    if ! ip link add "${IFACE_NAME}" \
        link "${HOST_IFACE}" \
        address "${ONVIF_MAC}" \
        type macvlan mode bridge 2>&1; then
        bashio::log.warning "  Failed to create MacVLAN interface ${IFACE_NAME} - skipping"
        continue
    fi

    # Bring interface up
    if ! ip link set "${IFACE_NAME}" up 2>&1; then
        bashio::log.warning "  Failed to bring up ${IFACE_NAME} - skipping"
        ip link del "${IFACE_NAME}" 2>/dev/null || true
        continue
    fi

    # Extract subnet from existing routes to determine prefix length
    # Default to /24 which is standard for home networks
    PREFIX_LEN="24"
    HOST_NETWORK=$(ip route | grep "${HOST_IFACE}" | grep -oP '\d+\.\d+\.\d+\.\d+/\d+' | head -1)
    if [ -n "${HOST_NETWORK}" ]; then
        PREFIX_LEN=$(echo "${HOST_NETWORK}" | cut -d'/' -f2)
    fi

    # Assign IP address
    if ! ip addr add "${ONVIF_IP}/${PREFIX_LEN}" dev "${IFACE_NAME}" 2>&1; then
        bashio::log.warning "  Failed to assign IP ${ONVIF_IP} to ${IFACE_NAME} - skipping"
        ip link del "${IFACE_NAME}" 2>/dev/null || true
        continue
    fi

    bashio::log.info "  MacVLAN ${IFACE_NAME} ready: ${ONVIF_IP}/${PREFIX_LEN}"
done

bashio::log.info "MacVLAN setup complete."
