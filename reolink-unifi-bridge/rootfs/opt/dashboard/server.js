'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const net = require('net');
const mqtt = require('mqtt');

// ─── Configuration from environment ───────────────────────────────────────────
const PORT = parseInt(process.env.DASHBOARD_PORT || '8099', 10);
const NEOLINK_PORT = parseInt(process.env.NEOLINK_PORT || '8554', 10);
const GO2RTC_PORT = parseInt(process.env.GO2RTC_PORT || '18554', 10);
const MQTT_HOST = process.env.MQTT_HOST || '127.0.0.1';
const MQTT_PORT = parseInt(process.env.MQTT_PORT || '1883', 10);
const OPTIONS_FILE = process.env.OPTIONS_FILE || '/data/options.json';
const IP_MAP_FILE = '/tmp/camera-ips.json';

// ─── State ─────────────────────────────────────────────────────────────────────
/** @type {Array<{time: string, camera: string, state: 'on'|'off'}>} */
const motionEvents = [];
const MAX_MOTION_EVENTS = 50;

/** @type {Record<string, {battery: number|null, motion: 'on'|'off'|'unknown', lastSeen: string|null}>} */
const cameraState = {};

// ─── Load options ──────────────────────────────────────────────────────────────
function loadOptions() {
    try {
        const raw = fs.readFileSync(OPTIONS_FILE, 'utf8');
        return JSON.parse(raw);
    } catch (err) {
        console.error(`[dashboard] Failed to read options file: ${err.message}`);
        return { cameras: [], neolink_port: NEOLINK_PORT, go2rtc_port: GO2RTC_PORT };
    }
}

let options = loadOptions();

// ─── Load IP map (written by 50-macvlan-setup.sh after DHCP/static assignment) ─
function loadIpMap() {
    try {
        const raw = fs.readFileSync(IP_MAP_FILE, 'utf8');
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

// ─── TCP Port check helper ─────────────────────────────────────────────────────
function checkPort(host, port, timeoutMs = 2000) {
    return new Promise((resolve) => {
        const sock = new net.Socket();
        let resolved = false;

        const done = (result) => {
            if (resolved) return;
            resolved = true;
            sock.destroy();
            resolve(result);
        };

        sock.setTimeout(timeoutMs);
        sock.on('connect', () => done(true));
        sock.on('timeout', () => done(false));
        sock.on('error', () => done(false));
        sock.connect(port, host);
    });
}

// ─── go2rtc stream status ──────────────────────────────────────────────────────
async function fetchGo2rtcStreams() {
    try {
        const http = require('http');
        return await new Promise((resolve, reject) => {
            const req = http.get(
                { host: '127.0.0.1', port: 1984, path: '/api/streams', timeout: 2000 },
                (res) => {
                    let data = '';
                    res.on('data', (chunk) => { data += chunk; });
                    res.on('end', () => {
                        try { resolve(JSON.parse(data)); }
                        catch { resolve({}); }
                    });
                }
            );
            req.on('error', () => resolve({}));
            req.on('timeout', () => { req.destroy(); resolve({}); });
        });
    } catch {
        return {};
    }
}

// ─── MQTT Client ──────────────────────────────────────────────────────────────
function startMqttClient() {
    const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT}`, {
        clientId: 'reolink-dashboard',
        reconnectPeriod: 5000,
        connectTimeout: 10000,
    });

    client.on('connect', () => {
        console.log('[dashboard] MQTT connected');

        // Subscribe to all neolink topics
        client.subscribe('neolink/+/status/motion');
        client.subscribe('neolink/+/status/battery_level');

        // Publish HA auto-discovery for each camera
        options = loadOptions();
        const cameras = options.cameras || [];
        cameras.forEach((cam) => {
            publishAutoDiscovery(client, cam);
        });
    });

    client.on('message', (topic, message) => {
        const payload = message.toString();

        // Motion: neolink/{camera}/status/motion
        const motionMatch = topic.match(/^neolink\/(.+)\/status\/motion$/);
        if (motionMatch) {
            const camName = motionMatch[1];
            if (!cameraState[camName]) cameraState[camName] = { battery: null, motion: 'unknown', lastSeen: null };
            cameraState[camName].motion = payload === 'on' ? 'on' : 'off';
            cameraState[camName].lastSeen = new Date().toISOString();

            if (payload === 'on') {
                motionEvents.unshift({ time: new Date().toISOString(), camera: camName, state: 'on' });
                if (motionEvents.length > MAX_MOTION_EVENTS) motionEvents.pop();
            }
            return;
        }

        // Battery: neolink/{camera}/status/battery_level
        const batteryMatch = topic.match(/^neolink\/(.+)\/status\/battery_level$/);
        if (batteryMatch) {
            const camName = batteryMatch[1];
            if (!cameraState[camName]) cameraState[camName] = { battery: null, motion: 'unknown', lastSeen: null };
            const level = parseInt(payload, 10);
            cameraState[camName].battery = isNaN(level) ? null : level;
            cameraState[camName].lastSeen = new Date().toISOString();
        }
    });

    client.on('error', (err) => {
        console.error(`[dashboard] MQTT error: ${err.message}`);
    });

    return client;
}

function publishAutoDiscovery(client, cam) {
    const name = cam.name;

    // Motion binary sensor
    if (cam.enable_motion) {
        const motionConfig = {
            name: `${name} Motion`,
            state_topic: `neolink/${name}/status/motion`,
            payload_on: 'on',
            payload_off: 'off',
            device_class: 'motion',
            unique_id: `reolink_${name}_motion`,
            device: {
                identifiers: [`reolink_${name}`],
                name: `Reolink ${name}`,
                manufacturer: 'Reolink',
                model: 'IP Camera',
            },
        };
        client.publish(
            `homeassistant/binary_sensor/${name}_motion/config`,
            JSON.stringify(motionConfig),
            { retain: true }
        );
        console.log(`[dashboard] Published HA auto-discovery for motion: ${name}`);
    }

    // Battery sensor
    if (cam.enable_battery) {
        const batteryConfig = {
            name: `${name} Battery`,
            state_topic: `neolink/${name}/status/battery_level`,
            unit_of_measurement: '%',
            device_class: 'battery',
            unique_id: `reolink_${name}_battery`,
            device: {
                identifiers: [`reolink_${name}`],
                name: `Reolink ${name}`,
                manufacturer: 'Reolink',
                model: 'IP Camera',
            },
        };
        client.publish(
            `homeassistant/sensor/${name}_battery/config`,
            JSON.stringify(batteryConfig),
            { retain: true }
        );
        console.log(`[dashboard] Published HA auto-discovery for battery: ${name}`);
    }
}

// ─── Express App ───────────────────────────────────────────────────────────────
const app = express();

// Respect HA Ingress path prefix
app.use((req, _res, next) => {
    req.ingressPath = req.headers['x-ingress-path'] || '';
    next();
});

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/status ─────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
    const [mosquittoUp, neolinkUp, go2rtcUp] = await Promise.all([
        checkPort('127.0.0.1', MQTT_PORT),
        checkPort('127.0.0.1', NEOLINK_PORT),
        checkPort('127.0.0.1', GO2RTC_PORT),
    ]);

    // ONVIF: check if port 8001 (first camera's ONVIF port) is reachable
    // daniela-hase/onvif-server assigns ports starting at 8001 per camera
    const cameras = (options.cameras || []);
    const ipMap = loadIpMap();
    let onvifUp = false;
    if (cameras.length > 0) {
        const firstCam = cameras[0];
        const actualIp = ipMap[firstCam.name] || firstCam.onvif_ip || '127.0.0.1';
        onvifUp = await checkPort(actualIp, 8001);
    }

    res.json({
        services: {
            mosquitto: { running: mosquittoUp, port: MQTT_PORT },
            neolink: { running: neolinkUp, port: NEOLINK_PORT },
            go2rtc: { running: go2rtcUp, port: GO2RTC_PORT },
            onvif: { running: onvifUp, port: 8080 },
            dashboard: { running: true, port: PORT },
        },
        timestamp: new Date().toISOString(),
    });
});

// ── GET /api/cameras ────────────────────────────────────────────────────────
app.get('/api/cameras', async (req, res) => {
    options = loadOptions();
    const cameras = options.cameras || [];
    const ipMap = loadIpMap();

    const go2rtcStreams = await fetchGo2rtcStreams();

    const result = await Promise.all(cameras.map(async (cam) => {
        const state = cameraState[cam.name] || { battery: null, motion: 'unknown', lastSeen: null };

        // Check if go2rtc has an active client for this stream
        const streamInfo = go2rtcStreams[cam.name] || null;
        const hasClients = streamInfo
            ? (Array.isArray(streamInfo.clients) && streamInfo.clients.length > 0)
            : false;

        // Actual IP: from the map for DHCP cameras, or the configured static IP
        const actualIp = ipMap[cam.name] || cam.onvif_ip || null;
        const ipMode = cam.ip_mode || 'static';

        return {
            name: cam.name,
            address: cam.address,
            ip_mode: ipMode,
            onvif_ip: actualIp,
            onvif_ip_configured: cam.onvif_ip || null,
            is_battery_camera: cam.is_battery_camera,
            enable_motion: cam.enable_motion,
            enable_battery: cam.enable_battery,
            battery: state.battery,
            motion: state.motion,
            lastSeen: state.lastSeen,
            streaming: hasClients,
            streams: {
                high: `rtsp://[HOST]:${GO2RTC_PORT}/${cam.name}`,
                low: `rtsp://[HOST]:${GO2RTC_PORT}/${cam.name}_sub`,
            },
        };
    }));

    res.json(result);
});

// ── GET /api/motion ─────────────────────────────────────────────────────────
app.get('/api/motion', (req, res) => {
    res.json(motionEvents.slice(0, 50));
});

// ── GET /api/streams ────────────────────────────────────────────────────────
app.get('/api/streams', (req, res) => {
    options = loadOptions();
    const cameras = options.cameras || [];
    const result = cameras.map((cam) => ({
        name: cam.name,
        high: `rtsp://[HOST]:${GO2RTC_PORT}/${cam.name}`,
        low: `rtsp://[HOST]:${GO2RTC_PORT}/${cam.name}_sub`,
        neolink_high: `rtsp://[HOST]:${NEOLINK_PORT}/${cam.name}/main`,
        neolink_low: `rtsp://[HOST]:${NEOLINK_PORT}/${cam.name}/sub`,
    }));
    res.json(result);
});

// ─── Start ────────────────────────────────────────────────────────────────────
const mqttClient = startMqttClient();

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[dashboard] Reolink Bridge Dashboard running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('[dashboard] Shutting down...');
    mqttClient.end();
    process.exit(0);
});
