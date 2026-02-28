#!/usr/bin/with-contenv bashio
# ==============================================================================
# 50-macvlan-setup.sh
# Sets up MacVLAN interfaces for ONVIF virtual cameras.
# Supports DHCP (ip_mode=dhcp) and static IP (ip_mode=static).
#
# Writes /tmp/camera-ips.json with the actual assigned IPs so that
# 60-onvif-config.sh can build the ONVIF server config after IPs are known.
#
# Errors are logged but do NOT stop the add-on.
# ==============================================================================

# bashio sets -eo pipefail — disable so pipeline failures don't abort the add-on
set +e

HOST_IFACE=$(bashio::config 'host_interface')
CAMERA_COUNT=$(bashio::config 'cameras | length')
IP_MAP_FILE="/tmp/camera-ips.json"

bashio::log.info "Setting up MacVLAN interfaces on ${HOST_IFACE}..."

# Initialise the IP map JSON
echo "{}" > "${IP_MAP_FILE}"

if ! bashio::config.exists 'cameras'; then
    bashio::log.info "No cameras configured, skipping MacVLAN setup."
    exit 0
fi

# Determine host subnet prefix length once (default /24)
PREFIX_LEN="24"
HOST_NETWORK=$(ip route 2>/dev/null | grep "${HOST_IFACE}" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+/[0-9]+' | head -1 || true)
if [ -n "${HOST_NETWORK}" ]; then
    PREFIX_LEN=$(echo "${HOST_NETWORK}" | cut -d'/' -f2)
    bashio::log.info "Detected subnet prefix /${PREFIX_LEN} from route ${HOST_NETWORK}"
else
    bashio::log.info "Could not detect subnet prefix, using default /24"
fi

for i in $(seq 0 $((CAMERA_COUNT - 1))); do
    CAM_NAME=$(bashio::config "cameras[${i}].name")
    IP_MODE=$(bashio::config "cameras[${i}].ip_mode")
    ONVIF_MAC=$(bashio::config "cameras[${i}].onvif_mac")

    # Interface name: max 15 chars — "onvif-" (6) + first 9 chars of cam name
    IFACE_NAME="onvif-${CAM_NAME:0:9}"

    bashio::log.info "  Camera [${CAM_NAME}] — mode: ${IP_MODE}, MAC: ${ONVIF_MAC}"

    # ── Remove existing interface (idempotent) ──────────────────────────────
    ip link del "${IFACE_NAME}" 2>/dev/null || true

    # ── Create MacVLAN interface ────────────────────────────────────────────
    if ! ip link add "${IFACE_NAME}" \
            link "${HOST_IFACE}" \
            address "${ONVIF_MAC}" \
            type macvlan mode bridge 2>&1; then
        bashio::log.warning "    Failed to create MacVLAN ${IFACE_NAME} — skipping"
        continue
    fi

    # ── Bring interface up ──────────────────────────────────────────────────
    if ! ip link set "${IFACE_NAME}" up 2>&1; then
        bashio::log.warning "    Failed to bring up ${IFACE_NAME} — skipping"
        ip link del "${IFACE_NAME}" 2>/dev/null || true
        continue
    fi

    # ── Assign IP — DHCP or Static ─────────────────────────────────────────
    ASSIGNED_IP=""

    if [ "${IP_MODE}" = "dhcp" ]; then
        bashio::log.info "    Running DHCP on ${IFACE_NAME}..."

        if udhcpc \
                -i "${IFACE_NAME}" \
                -s /usr/bin/udhcpc-onvif-script \
                -n -q -t 10 -T 3 2>/dev/null; then

            ASSIGNED_IP=$(ip addr show dev "${IFACE_NAME}" 2>/dev/null \
                          | grep -oE 'inet [0-9.]+' | head -1 | cut -d' ' -f2 || true)

            if [ -n "${ASSIGNED_IP}" ]; then
                bashio::log.info "    DHCP lease obtained: ${ASSIGNED_IP} on ${IFACE_NAME}"
            else
                bashio::log.warning "    DHCP ran but no IP visible on ${IFACE_NAME}"
            fi
        else
            bashio::log.warning "    DHCP failed on ${IFACE_NAME} — interface will have no IP"
        fi

    else
        # Static IP mode — onvif_ip is required
        if ! bashio::config.exists "cameras[${i}].onvif_ip"; then
            bashio::log.error "    ip_mode=static but onvif_ip not set for camera [${CAM_NAME}] — skipping"
            ip link del "${IFACE_NAME}" 2>/dev/null || true
            continue
        fi

        ONVIF_IP=$(bashio::config "cameras[${i}].onvif_ip")

        if ! ip addr add "${ONVIF_IP}/${PREFIX_LEN}" dev "${IFACE_NAME}" 2>&1; then
            bashio::log.warning "    Failed to assign static IP ${ONVIF_IP} to ${IFACE_NAME} — skipping"
            ip link del "${IFACE_NAME}" 2>/dev/null || true
            continue
        fi

        ASSIGNED_IP="${ONVIF_IP}"
        bashio::log.info "    Static IP assigned: ${ASSIGNED_IP}/${PREFIX_LEN} on ${IFACE_NAME}"
    fi

    # ── Write actual IP into the shared JSON map ────────────────────────────
    if [ -n "${ASSIGNED_IP}" ]; then
        CURRENT=$(cat "${IP_MAP_FILE}")
        NEW_CONTENT=$(python3 -c "
import json, sys
data = json.loads(sys.argv[1])
data[sys.argv[2]] = sys.argv[3]
print(json.dumps(data))
" "${CURRENT}" "${CAM_NAME}" "${ASSIGNED_IP}" 2>/dev/null) || true
        if [ -n "${NEW_CONTENT}" ]; then
            echo "${NEW_CONTENT}" > "${IP_MAP_FILE}"
        fi
    fi
done

bashio::log.info "MacVLAN setup complete. IP map written to ${IP_MAP_FILE}"
exit 0
