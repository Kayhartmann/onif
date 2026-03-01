'use strict';

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const net     = require('net');
const os      = require('os');
const mqtt    = require('mqtt');

// ─── Configuration ─────────────────────────────────────────────────────────────
const OPTIONS_FILE      = process.env.OPTIONS_FILE || '/data/options.json';
const ACTUAL_PORTS_FILE = '/tmp/actual-ports.json';
const IP_MAP_FILE       = '/tmp/camera-ips.json';

function loadActualPorts () {
  try { return JSON.parse(fs.readFileSync(ACTUAL_PORTS_FILE, 'utf8')); }
  catch { return { neolink: 8554, go2rtc_rtsp: 18554, go2rtc_api: 1984, onvif_base: 8001, dashboard: 8099 }; }
}

// Live port values — re-read on each status call so hot-changes are visible
let _ports      = loadActualPorts();
const PORT      = _ports.dashboard  || parseInt(process.env.DASHBOARD_PORT || '8099', 10);
let NEOLINK_PORT  = _ports.neolink     || 8554;
let GO2RTC_PORT   = _ports.go2rtc_rtsp || 18554;
let GO2RTC_API    = _ports.go2rtc_api  || 1984;
let ONVIF_BASE    = _ports.onvif_base  || 8001;

// ─── In-memory log buffer ──────────────────────────────────────────────────────
const logBuffer = [];
const MAX_LOG   = 200;

function addLog (level, msg) {
  logBuffer.unshift({ time: new Date().toISOString(), level, msg });
  if (logBuffer.length > MAX_LOG) logBuffer.pop();
}

const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);
console.log   = (...a) => { _log(...a);   addLog('info',  a.join(' ')); };
console.warn  = (...a) => { _warn(...a);  addLog('warn',  a.join(' ')); };
console.error = (...a) => { _error(...a); addLog('error', a.join(' ')); };

// ─── State ─────────────────────────────────────────────────────────────────────
const motionEvents    = [];
const MAX_MOTION      = 50;
const cameraState     = {};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function loadOptions () {
  try {
    return JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8'));
  } catch (err) {
    console.error(`[dashboard] Failed to read options: ${err.message}`);
    return { cameras: [] };
  }
}

let options = loadOptions();

function loadMqttConfig () {
  try {
    const cfg = JSON.parse(fs.readFileSync('/tmp/mqtt.json', 'utf8'));
    return cfg.available === false ? null : cfg;
  } catch { return null; }
}

function loadIpMap () {
  try { return JSON.parse(fs.readFileSync(IP_MAP_FILE, 'utf8')); }
  catch { return {}; }
}

function detectHostIp () {
  const ifaceName = options.host_interface || 'eth0';
  const ifaces    = os.networkInterfaces();
  // Try configured interface first
  const addrs = ifaces[ifaceName] || [];
  const primary = addrs.find(a => a.family === 'IPv4' && !a.internal);
  if (primary) return primary.address;
  // Fallback: first non-loopback, non-macvlan IPv4
  for (const [name, list] of Object.entries(ifaces)) {
    if (name === 'lo' || name.startsWith('onvif-') || name.startsWith('macvlan')) continue;
    const addr = (list || []).find(a => a.family === 'IPv4' && !a.internal);
    if (addr) return addr.address;
  }
  return '127.0.0.1';
}

function checkPort (host, port, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (r) => { if (!done) { done = true; sock.destroy(); resolve(r); } };
    sock.setTimeout(timeoutMs);
    sock.on('connect', () => finish(true));
    sock.on('timeout', () => finish(false));
    sock.on('error',   () => finish(false));
    sock.connect(port, host);
  });
}

async function fetchGo2rtcStreams () {
  try {
    const http = require('http');
    return await new Promise((resolve) => {
      const req = http.get(
        { host: '127.0.0.1', port: GO2RTC_API, path: '/api/streams', timeout: 2000 },
        (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
        }
      );
      req.on('error',   () => resolve({}));
      req.on('timeout', () => { req.destroy(); resolve({}); });
    });
  } catch { return {}; }
}

// ─── MQTT ─────────────────────────────────────────────────────────────────────
function publishAutoDiscovery (client, cam) {
  if (cam.enable_motion) {
    client.publish(`homeassistant/binary_sensor/${cam.name}_motion/config`, JSON.stringify({
      name: `${cam.name} Motion`, state_topic: `neolink/${cam.name}/status/motion`,
      payload_on: 'on', payload_off: 'off', device_class: 'motion',
      unique_id: `reolink_${cam.name}_motion`,
      device: { identifiers: [`reolink_${cam.name}`], name: `Reolink ${cam.name}`, manufacturer: 'Reolink', model: 'IP Camera' }
    }), { retain: true });
  }
  if (cam.enable_battery) {
    client.publish(`homeassistant/sensor/${cam.name}_battery/config`, JSON.stringify({
      name: `${cam.name} Battery`, state_topic: `neolink/${cam.name}/status/battery_level`,
      unit_of_measurement: '%', device_class: 'battery',
      unique_id: `reolink_${cam.name}_battery`,
      device: { identifiers: [`reolink_${cam.name}`], name: `Reolink ${cam.name}`, manufacturer: 'Reolink', model: 'IP Camera' }
    }), { retain: true });
  }
}

function startMqttClient () {
  const cfg = loadMqttConfig();
  if (!cfg) { console.log('[dashboard] MQTT not available – motion/battery disabled'); return null; }

  const url    = `${cfg.ssl ? 'mqtts' : 'mqtt'}://${cfg.host}:${cfg.port}`;
  console.log(`[dashboard] Connecting to MQTT: ${url}`);
  const client = mqtt.connect(url, {
    clientId: 'reolink-dashboard',
    username: cfg.username || undefined,
    password: cfg.password || undefined,
    reconnectPeriod: 5000,
    connectTimeout:  10000
  });

  client.on('connect', () => {
    console.log(`[dashboard] MQTT connected to ${cfg.host}:${cfg.port}`);
    client.subscribe('neolink/+/status/motion');
    client.subscribe('neolink/+/status/battery_level');
    options = loadOptions();
    (options.cameras || []).forEach(cam => publishAutoDiscovery(client, cam));
  });

  client.on('message', (topic, message) => {
    const payload  = message.toString();
    const mMotion  = topic.match(/^neolink\/(.+)\/status\/motion$/);
    const mBattery = topic.match(/^neolink\/(.+)\/status\/battery_level$/);

    if (mMotion) {
      const name = mMotion[1];
      if (!cameraState[name]) cameraState[name] = { battery: null, motion: 'unknown', lastSeen: null };
      cameraState[name].motion   = payload === 'on' ? 'on' : 'off';
      cameraState[name].lastSeen = new Date().toISOString();
      if (payload === 'on') {
        motionEvents.unshift({ time: new Date().toISOString(), camera: name, state: 'on' });
        if (motionEvents.length > MAX_MOTION) motionEvents.pop();
        console.log(`[dashboard] Motion ON: ${name}`);
      }
    } else if (mBattery) {
      const name  = mBattery[1];
      if (!cameraState[name]) cameraState[name] = { battery: null, motion: 'unknown', lastSeen: null };
      const level = parseInt(payload, 10);
      cameraState[name].battery  = isNaN(level) ? null : level;
      cameraState[name].lastSeen = new Date().toISOString();
    }
  });

  client.on('error', err => console.error(`[dashboard] MQTT error: ${err.message}`));
  return client;
}

// ─── Express ──────────────────────────────────────────────────────────────────
const app = express();

// HA Ingress path prefix stripping
app.use((req, _res, next) => {
  const p = req.headers['x-ingress-path'];
  if (p && req.url.startsWith(p)) req.url = req.url.slice(p.length) || '/';
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// ── GET /api/status ──────────────────────────────────────────────────────────
app.get('/api/status', async (req, res) => {
  options = loadOptions();
  const hostIp = detectHostIp();

  // Refresh actual ports (may have been written after server started)
  _ports = loadActualPorts();
  NEOLINK_PORT = _ports.neolink     || NEOLINK_PORT;
  GO2RTC_PORT  = _ports.go2rtc_rtsp || GO2RTC_PORT;
  GO2RTC_API   = _ports.go2rtc_api  || GO2RTC_API;
  ONVIF_BASE   = _ports.onvif_base  || ONVIF_BASE;

  const [neolinkUp, go2rtcUp, go2rtcApiUp] = await Promise.all([
    checkPort('127.0.0.1', NEOLINK_PORT),
    checkPort('127.0.0.1', GO2RTC_PORT),
    checkPort('127.0.0.1', GO2RTC_API)
  ]);

  const mqttConnected = mqttClient !== null && mqttClient.connected === true;
  const mqttInfo      = loadMqttConfig();

  const cameras = options.cameras || [];
  const ipMap   = loadIpMap();
  let onvifUp   = false;
  if (cameras.length > 0) {
    const ip = ipMap[cameras[0].name] || cameras[0].onvif_ip || null;
    if (ip) onvifUp = await checkPort(ip, ONVIF_BASE);
  }

  res.json({
    host_ip: hostIp,
    services: {
      mqtt: {
        running:   mqttConnected,
        auto:      true,
        host:      mqttInfo ? mqttInfo.host : null,
        port:      mqttInfo ? mqttInfo.port : null,
        ssl:       mqttInfo ? mqttInfo.ssl  : false,
        available: mqttInfo !== null
      },
      neolink:   { running: neolinkUp,    port: NEOLINK_PORT },
      go2rtc:    { running: go2rtcUp,     port: GO2RTC_PORT, api_port: GO2RTC_API, api_running: go2rtcApiUp },
      onvif:     { running: onvifUp,      port: ONVIF_BASE },
      dashboard: { running: true,         port: PORT }
    },
    onvif_credentials: {
      username: options.onvif_username || 'admin',
      password: options.onvif_password || 'admin'
    },
    timestamp: new Date().toISOString()
  });
});

// ── GET /api/cameras ─────────────────────────────────────────────────────────
app.get('/api/cameras', async (req, res) => {
  options = loadOptions();
  const hostIp  = detectHostIp();
  const cameras = options.cameras || [];
  const ipMap   = loadIpMap();
  const streams = await fetchGo2rtcStreams();

  const result = await Promise.all(cameras.map(async (cam, index) => {
    const state     = cameraState[cam.name] || { battery: null, motion: 'unknown', lastSeen: null };
    const info      = streams[cam.name] || null;
    const streaming = info ? (Array.isArray(info.clients) && info.clients.length > 0) : false;
    const actualIp  = ipMap[cam.name] || cam.onvif_ip || null;
    const onvifPort = 8001 + index;

    return {
      name:           cam.name,
      address:        cam.address   || null,
      ip_mode:        cam.ip_mode   || 'static',
      onvif_ip:       actualIp,
      is_battery:     cam.is_battery_camera || false,
      enable_motion:  cam.enable_motion     || false,
      enable_battery: cam.enable_battery    || false,
      battery:        state.battery,
      motion:         state.motion,
      lastSeen:       state.lastSeen,
      streaming,
      onvif_port:     onvifPort,
      onvif_url:      actualIp ? `http://${actualIp}:${onvifPort}` : null,
      streams: {
        high: `rtsp://${hostIp}:${GO2RTC_PORT}/${cam.name}`,
        low:  `rtsp://${hostIp}:${GO2RTC_PORT}/${cam.name}_sub`
      }
    };
  }));

  res.json(result);
});

// ── GET /api/streams ─────────────────────────────────────────────────────────
app.get('/api/streams', (req, res) => {
  options = loadOptions();
  const hostIp  = detectHostIp();
  const cameras = options.cameras || [];
  res.json(cameras.map(cam => ({
    name:         cam.name,
    high:         `rtsp://${hostIp}:${GO2RTC_PORT}/${cam.name}`,
    low:          `rtsp://${hostIp}:${GO2RTC_PORT}/${cam.name}_sub`,
    neolink_high: `rtsp://${hostIp}:${NEOLINK_PORT}/${cam.name}/main`,
    neolink_low:  `rtsp://${hostIp}:${NEOLINK_PORT}/${cam.name}/sub`
  })));
});

// ── GET /api/motion ──────────────────────────────────────────────────────────
app.get('/api/motion', (_req, res) => {
  res.json(motionEvents.slice(0, MAX_MOTION));
});

// ── GET /api/config ──────────────────────────────────────────────────────────
app.get('/api/config', (_req, res) => {
  options = loadOptions();
  const cameras = (options.cameras || []).map((cam, i) => ({
    name:           cam.name,
    address:        cam.address   || null,
    uid:            cam.uid       || null,
    ip_mode:        cam.ip_mode   || 'static',
    onvif_ip:       cam.onvif_ip  || null,
    onvif_mac:      cam.onvif_mac || null,
    onvif_port:     8001 + i,
    stream_high:    `${cam.stream_high_width || '–'}x${cam.stream_high_height || '–'} @${cam.stream_high_fps || '–'}fps ${cam.stream_high_bitrate || '–'}kbps`,
    stream_low:     `${cam.stream_low_width  || '–'}x${cam.stream_low_height  || '–'} @${cam.stream_low_fps  || '–'}fps ${cam.stream_low_bitrate  || '–'}kbps`,
    is_battery:     cam.is_battery_camera || false,
    enable_motion:  cam.enable_motion     || false,
    enable_battery: cam.enable_battery    || false
  }));

  res.json({
    host_interface:        options.host_interface || 'eth0',
    neolink_port:          options.neolink_port   || NEOLINK_PORT,
    go2rtc_port:           options.go2rtc_port    || GO2RTC_PORT,
    log_level:             options.log_level      || 'info',
    onvif_username:        options.onvif_username || 'admin',
    onvif_password:        options.onvif_password || 'admin',
    neolink_rtsp_password: '***',
    cameras
  });
});

// ── GET /api/logs ────────────────────────────────────────────────────────────
app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '100', 10), MAX_LOG);
  res.json(logBuffer.slice(0, limit));
});

// ─── Start ────────────────────────────────────────────────────────────────────
const mqttClient = startMqttClient();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[dashboard] Reolink Bridge Dashboard running on port ${PORT}`);
});

process.on('SIGTERM', () => {
  console.log('[dashboard] Shutting down');
  if (mqttClient) mqttClient.end();
  process.exit(0);
});
