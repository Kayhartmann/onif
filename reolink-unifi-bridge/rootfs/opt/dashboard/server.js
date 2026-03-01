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
const GO2RTC_API_PORT = 1984;
const OPTIONS_FILE = process.env.OPTIONS_FILE || '/data/options.json';
const IP_MAP_FILE = '/tmp/camera-ips.json';

// ─── State ─────────────────────────────────────────────────────────────────────
/** @type {Array<{time: string, camera: string, state: 'on'|'off'}>} */
const motionEvents = [];
const MAX_MOTION_EVENTS = 50;

/** @type {Record<string, {battery: number|null, motion: 'on'|'off'|'unknown', lastSeen: string|null}>} */
const cameraState = {};

// ─── Load options ──────────────────────────────────────────────────────────────
function loadOptions () {
  try {
    const raw = fs.readFileSync(OPTIONS_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`[dashboard] Failed to read options file: ${err.message}`);
    return { cameras: [], neolink_port: NEOLINK_PORT, go2rtc_port: GO2RTC_PORT };
  }
}

let options = loadOptions();

// ─── Load MQTT config (written by 10-mqtt-config.sh from HA supervisor) ──────
function loadMqttConfig () {
  try {
    const cfg = JSON.parse(fs.readFileSync('/tmp/mqtt.json', 'utf8'));
    return cfg.available === false ? null : cfg;
  } catch {
    return null;
  }
}

// ─── Load IP map (written by 50-macvlan-setup.sh after DHCP/static assignment) ─
function loadIpMap () {
  try {
    const raw = fs.readFileSync(IP_MAP_FILE, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

// ─── TCP Port check helper ─────────────────────────────────────────────────────
function checkPort (host, port, timeoutMs = 2000) {
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
async function fetchGo2rtcStreams () {
  try {
    const http = require('http');
    return await new Promise((resolve, reject) => {
      const req = http.get(
        { host: '127.0.0.1', port: 1984, path: '/api/streams', timeout: 2000 },
        (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch { resolve({}); }
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
function startMqttClient () {
  const mqttCfg = loadMqttConfig();
  if (!mqttCfg) {
    console.log('[dashboard] MQTT not available – motion/battery features disabled');
    return null;
  }

  const protocol = mqttCfg.ssl ? 'mqtts' : 'mqtt';
  const brokerUrl = `${protocol}://${mqttCfg.host}:${mqttCfg.port}`;
  console.log(`[dashboard] Connecting to MQTT broker: ${brokerUrl}`);

  const client = mqtt.connect(brokerUrl, {
    clientId: 'reolink-dashboard',
    username: mqttCfg.username || undefined,
    password: mqttCfg.password || undefined,
    reconnectPeriod: 5000,
    connectTimeout: 10000
  });

  client.on('connect', () => {
    console.log(`[dashboard] MQTT connected to ${mqttCfg.host}:${mqttCfg.port}`);
    client.subscribe('neolink/+/status/motion');
    client.subscribe('neolink/+/status/battery_level');

    options = loadOptions();
    const cameras = options.cameras || [];
    cameras.forEach((cam) => {
      publishAutoDiscovery(client, cam);
    });
  });

  client.on('message', (topic, message) => {
    const payload = message.toString();

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

function publishAutoDiscovery (client, cam) {
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
        model: 'IP Camera'
      }
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
        model: 'IP Camera'
      }
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
  const [neolinkUp, go2rtcUp] = await Promise.all([
    checkPort('127.0.0.1', NEOLINK_PORT),
    checkPort('127.0.0.1', GO2RTC_PORT)
  ]);

  // MQTT: check live client connection state
  const mqttConnected = mqttClient !== null && mqttClient.connected === true;

  // ONVIF: check if port 8001 (first camera's ONVIF port) is reachable
  const cameras = (options.cameras || []);
  const ipMap = loadIpMap();
  let onvifUp = false;
  if (cameras.length > 0) {
    const firstCam = cameras[0];
    const actualIp = ipMap[firstCam.name] || firstCam.onvif_ip || '127.0.0.1';
    onvifUp = await checkPort(actualIp, 8001);
  }

  // Also check go2rtc API
  const go2rtcApiUp = await checkPort('127.0.0.1', GO2RTC_API_PORT);

  // Load ONVIF credentials from options
  const onvifUsername = options.onvif_username || 'admin';
  const onvifPassword = options.onvif_password || 'admin';

  res.json({
    services: {
      mqtt: { running: mqttConnected },
      neolink: { running: neolinkUp, port: NEOLINK_PORT },
      go2rtc: { running: go2rtcUp, port: GO2RTC_PORT, api_port: GO2RTC_API_PORT, api_running: go2rtcApiUp },
      onvif: { running: onvifUp, port: 8001 },
      dashboard: { running: true, port: PORT }
    },
    onvif_credentials: {
      username: onvifUsername,
      password: onvifPassword
    },
    timestamp: new Date().toISOString()
  });
});

// ── GET /api/cameras ────────────────────────────────────────────────────────
app.get('/api/cameras', async (req, res) => {
  options = loadOptions();
  const cameras = options.cameras || [];
  const ipMap = loadIpMap();

  const go2rtcStreams = await fetchGo2rtcStreams();

  const result = await Promise.all(cameras.map(async (cam, index) => {
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
      onvif_port: 8001 + index,
      onvif_url: actualIp ? `http://${actualIp}:${8001 + index}` : null,
      streams: {
        high: `rtsp://[HOST]:${GO2RTC_PORT}/${cam.name}`,
        low: `rtsp://[HOST]:${GO2RTC_PORT}/${cam.name}_sub`
      }
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
    neolink_low: `rtsp://[HOST]:${NEOLINK_PORT}/${cam.name}/sub`
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
  if (mqttClient) mqttClient.end();
  process.exit(0);
});
