#!/usr/bin/with-contenv bashio
# ==============================================================================
# 60-onvif-config.sh
# Generates /data/onvif.yaml for daniela-hase/onvif-server.
#
# Format matches the working hassio-onvif-server (Kayhartmann):
#   node /app/main.js /data/onvif.yaml
#
# Runs AFTER 50-macvlan-setup.sh — the onvif-server discovers each camera's
# IP from its MAC address on the MacVLAN interface, so no explicit IP is
# needed in the YAML config.
#
# UUIDs are persisted to /data/uuids.json so UniFi Protect retains adoption.
# ==============================================================================
set -e

bashio::log.info "Generating ONVIF server configuration (YAML)..."

CONFIG_FILE="/data/onvif.yaml"

# Generate the YAML config using an inline Node.js script
# (Node is available in the container; avoids complex bash YAML generation)
node - << NODEJS
'use strict';
const fs     = require('fs');
const crypto = require('crypto');

// Read actual ports selected by 05-port-selection.sh
const actualPorts = JSON.parse(fs.readFileSync('/tmp/actual-ports.json', 'utf8'));
const GO2RTC_PORT = actualPorts.go2rtc_rtsp;
const ONVIF_BASE  = actualPorts.onvif_base;

const OPTIONS_FILE = '/data/options.json';
const UUID_FILE    = '/data/uuids.json';
const CONFIG_FILE  = '/data/onvif.yaml';

// Load HA add-on options
const options = JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
const cameras = options.cameras || [];

// Load or create persisted UUIDs (stable across restarts — UniFi Protect needs this)
let uuids = {};
if (fs.existsSync(UUID_FILE)) {
    try {
        uuids = JSON.parse(fs.readFileSync(UUID_FILE, 'utf8'));
    } catch (e) {
        console.warn('[onvif-config] Could not parse uuids.json — regenerating UUIDs.');
    }
}

// Auto-generate a deterministic MAC from camera name (same algorithm as 50-macvlan-setup.sh)
function autoMac(name) {
    const hash = crypto.createHash('md5').update(name).digest('hex');
    return ['02', hash.substr(0, 2), hash.substr(2, 2), hash.substr(4, 2), hash.substr(6, 2), hash.substr(8, 2)].join(':');
}

let yaml = 'onvif:\n';

cameras.forEach((camera, index) => {
    const name    = camera.name;
    const mac     = camera.onvif_mac || autoMac(name);
    const onvifPort  = ONVIF_BASE + index;
    const rtspFwdPort   = onvifPort + 100;
    const snapshotPort  = onvifPort + 200;

    // Assign and persist UUID
    if (!uuids[name]) {
        uuids[name] = crypto.randomUUID();
        console.log(\`[onvif-config] Generated UUID for "\${name}": \${uuids[name]}\`);
    }

    // High quality stream path on go2rtc
    const highPath = '/' + name;
    const lowPath  = '/' + name + '_sub';

    yaml += \`  - mac: \${mac}\n\`;
    yaml += \`    ports:\n\`;
    yaml += \`      server: \${onvifPort}\n\`;
    yaml += \`      rtsp: \${rtspFwdPort}\n\`;
    yaml += \`      snapshot: \${snapshotPort}\n\`;
    yaml += \`    name: \${name}\n\`;
    yaml += \`    uuid: \${uuids[name]}\n\`;
    yaml += \`    highQuality:\n\`;
    yaml += \`      rtsp: \${highPath}\n\`;
    yaml += \`      width: \${camera.stream_high_width}\n\`;
    yaml += \`      height: \${camera.stream_high_height}\n\`;
    yaml += \`      framerate: \${camera.stream_high_fps}\n\`;
    yaml += \`      bitrate: \${camera.stream_high_bitrate || 4096}\n\`;
    yaml += \`      quality: 4\n\`;
    yaml += \`    lowQuality:\n\`;
    yaml += \`      rtsp: \${lowPath}\n\`;
    yaml += \`      width: \${camera.stream_low_width}\n\`;
    yaml += \`      height: \${camera.stream_low_height}\n\`;
    yaml += \`      framerate: \${camera.stream_low_fps}\n\`;
    yaml += \`      bitrate: \${camera.stream_low_bitrate || 512}\n\`;
    yaml += \`      quality: 1\n\`;
    yaml += \`    target:\n\`;
    yaml += \`      hostname: 127.0.0.1\n\`;
    yaml += \`      ports:\n\`;
    yaml += \`        rtsp: \${GO2RTC_PORT}\n\`;
    yaml += \`        snapshot: 80\n\`;

    console.log(\`[onvif-config] Camera "\${name}": ONVIF=\${onvifPort}, MAC=\${mac}\`);
});

// Persist UUIDs so UniFi Protect keeps adopted cameras after restarts
fs.writeFileSync(UUID_FILE, JSON.stringify(uuids, null, 2));
console.log(\`[onvif-config] UUIDs saved to \${UUID_FILE}\`);

fs.writeFileSync(CONFIG_FILE, yaml);
console.log(\`[onvif-config] Config written to \${CONFIG_FILE} (\${cameras.length} camera(s))\`);
NODEJS

bashio::log.info "ONVIF configuration written to ${CONFIG_FILE}"
