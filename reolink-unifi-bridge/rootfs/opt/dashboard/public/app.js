'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function qs (sel) { return document.querySelector(sel); }

function formatTime (iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime (iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
           ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function fetchJSON (url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res.json();
}

// ─── Base URL for HA Ingress compatibility ─────────────────────────────────────
// fetch('/api/...') would resolve to the HA host root (wrong).
// fetch('api/...')  resolves relative to the ingress page URL (correct).
function apiUrl (path) {
  // Ensure trailing slash on base, then append path without leading slash
  const base = window.location.pathname.replace(/\/?$/, '/');
  return base + path;
}

function copyToClipboard (text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  }).catch(() => {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  });
}

// ─── Copy button event delegation ────────────────────────────────────────────
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  copyToClipboard(btn.dataset.copy || '', btn);
});

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderServiceChip (id, name, running, port) {
  const el = qs(`#svc-${id}`);
  if (!el) return;
  el.className = `service-chip ${running ? 'running' : 'stopped'}`;
  const portHtml = port ? `<span class="svc-port">:${port}</span>` : '';
  el.innerHTML = `<span class="svc-dot"></span><span class="svc-label">${name}${portHtml}</span>`;
}

function renderServiceDetails (services) {
  const grid = qs('#service-details-grid');
  if (!grid) return;

  const items = [
    {
      id: 'neolink',
      name: 'Neolink',
      desc: 'Reolink RTSP Bridge',
      running: services.neolink.running,
      details: [`RTSP Port: ${services.neolink.port}`]
    },
    {
      id: 'go2rtc',
      name: 'go2rtc',
      desc: 'RTSP Proxy & Transcoder',
      running: services.go2rtc.running,
      details: [
        `RTSP Port: ${services.go2rtc.port}`,
        `API Port: ${services.go2rtc.api_port} ${services.go2rtc.api_running ? '✓' : '✗'}`
      ]
    },
    {
      id: 'onvif',
      name: 'ONVIF Server',
      desc: 'Virtuelle ONVIF Kameras',
      running: services.onvif.running,
      details: [`Ports ab: ${services.onvif.port}`]
    },
    {
      id: 'mqtt',
      name: 'MQTT Broker',
      desc: 'HA MQTT (Motion/Battery)',
      running: services.mqtt.running,
      details: ['via Home Assistant']
    }
  ];

  grid.innerHTML = items.map(item => `
    <div class="service-detail-card ${item.running ? 'running' : 'stopped'}">
      <div class="sdc-header">
        <span class="sdc-dot"></span>
        <span class="sdc-name">${item.name}</span>
        <span class="sdc-status">${item.running ? 'Online' : 'Offline'}</span>
      </div>
      <div class="sdc-desc">${item.desc}</div>
      ${item.details.map(d => `<div class="sdc-detail">${d}</div>`).join('')}
    </div>
  `).join('');
}

function renderCredentials (credentials) {
  if (!credentials) return;
  const usernameEl = qs('#cred-username');
  const passwordEl = qs('#cred-password');
  const copyUser = qs('#copy-username');
  const copyPass = qs('#copy-password');
  if (usernameEl) usernameEl.textContent = credentials.username || 'admin';
  if (passwordEl) passwordEl.textContent = credentials.password || 'admin';
  if (copyUser) copyUser.dataset.copy = credentials.username || 'admin';
  if (copyPass) copyPass.dataset.copy = credentials.password || 'admin';
}

function renderBatteryBar (level) {
  if (level === null || level === undefined) return '<span class="camera-meta-value">—</span>';
  const cls = level >= 60 ? 'high' : level >= 30 ? 'medium' : 'low';
  return `
        <div class="battery-bar-wrap">
            <div class="battery-bar">
                <div class="battery-fill ${cls}" style="width:${level}%"></div>
            </div>
            <span class="camera-meta-value">${level}%</span>
        </div>`;
}

function renderCameraCard (cam) {
  const motionClass = cam.motion === 'on' ? 'active' : 'idle';
  const motionLabel = cam.motion === 'on'
    ? '&#x26A1; Motion Active'
    : cam.motion === 'off' ? 'Idle' : '—';

  const streamingBadge = cam.streaming
    ? '<span class="status-badge online">Streaming</span>'
    : '';

  const ipModeBadge = cam.ip_mode === 'dhcp'
    ? '<span class="ip-mode-badge dhcp">DHCP</span>'
    : '<span class="ip-mode-badge static">Static</span>';

  // For DHCP: show actual assigned IP (may differ from any configured value)
  const onvifIpDisplay = cam.onvif_ip
    ? escapeHtml(cam.onvif_ip)
    : '<span class="waiting">waiting for lease…</span>';

  // Build ONVIF URL row (only if IP is known)
  const onvifUrlHtml = cam.onvif_url
    ? `
        <div class="url-block">
            <div class="url-row">
                <span class="url-label">ONVIF</span>
                <span class="url-text" title="${escapeHtml(cam.onvif_url)}">${escapeHtml(cam.onvif_url)}</span>
                <button class="copy-btn" data-copy="${escapeHtml(cam.onvif_url)}">Copy</button>
            </div>
            <div class="url-row">
                <span class="url-label">RTSP HD</span>
                <span class="url-text" title="${escapeHtml(cam.streams.high)}">${escapeHtml(cam.streams.high)}</span>
                <button class="copy-btn" data-copy="${escapeHtml(cam.streams.high)}">Copy</button>
            </div>
            <div class="url-row">
                <span class="url-label">RTSP SD</span>
                <span class="url-text" title="${escapeHtml(cam.streams.low)}">${escapeHtml(cam.streams.low)}</span>
                <button class="copy-btn" data-copy="${escapeHtml(cam.streams.low)}">Copy</button>
            </div>
        </div>`
    : '';

  return `
        <div class="camera-card">
            <div class="camera-card-header">
                <span class="camera-name">&#x1F4F7; ${escapeHtml(cam.name)}</span>
                <div class="camera-header-badges">
                    ${ipModeBadge}
                    ${streamingBadge}
                </div>
            </div>
            <div class="camera-meta">
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Camera IP</span>
                    <span class="camera-meta-value">${cam.address ? escapeHtml(cam.address) : '<span class="waiting">UID-based</span>'}</span>
                </div>
                <div class="camera-meta-row">
                    <span class="camera-meta-label">ONVIF IP</span>
                    <span class="camera-meta-value">${onvifIpDisplay}</span>
                </div>
                ${cam.is_battery
? `
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Battery</span>
                    ${renderBatteryBar(cam.battery)}
                </div>`
: ''}
                ${cam.enable_motion
? `
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Motion</span>
                    <span class="motion-indicator ${motionClass}">${motionLabel}</span>
                </div>`
: ''}
                ${cam.lastSeen
? `
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Last seen</span>
                    <span class="camera-meta-value">${formatTime(cam.lastSeen)}</span>
                </div>`
: ''}
            </div>
            ${onvifUrlHtml}
        </div>`;
}

function escapeHtml (str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderMotionEvent (ev) {
  return `
        <div class="motion-event ${ev.state}">
            <span class="motion-event-time">${formatDateTime(ev.time)}</span>
            <span class="motion-event-cam">${escapeHtml(ev.camera)}</span>
            <span class="motion-event-state">${ev.state === 'on' ? '&#x26A1; Motion' : 'Clear'}</span>
        </div>`;
}

function renderStreamGroup (stream) {
  const rows = [
    { label: 'HD', url: stream.high },
    { label: 'SD', url: stream.low }
  ].map(({ label, url }) => `
        <div class="stream-url-row">
            <span class="stream-label">${label}</span>
            <span class="stream-url" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
            <button class="copy-btn" onclick="copyToClipboard('${escapeHtml(url)}', this)">Copy</button>
        </div>`).join('');

  return `
        <div class="stream-group">
            <div class="stream-group-name">&#x1F4F9; ${escapeHtml(stream.name)}</div>
            ${rows}
        </div>`;
}

// ─── Update functions ─────────────────────────────────────────────────────────
async function updateStatus () {
  try {
    const data = await fetchJSON(apiUrl('api/status'));
    const s = data.services;
    renderServiceChip('mqtt', 'MQTT', s.mqtt.running);
    renderServiceChip('neolink', 'Neolink', s.neolink.running, s.neolink.port);
    renderServiceChip('go2rtc', 'go2rtc', s.go2rtc.running, s.go2rtc.port);
    renderServiceChip('onvif', 'ONVIF', s.onvif.running, s.onvif.port);
    renderServiceDetails(s);
    renderCredentials(data.onvif_credentials);
  } catch (err) {
    console.error('Status fetch error:', err);
  }
}

async function updateCameras () {
  try {
    const cameras = await fetchJSON(apiUrl('api/cameras'));
    const grid = qs('#cameras-grid');
    if (cameras.length === 0) {
      grid.innerHTML = '<div class="empty-state">No cameras configured. Add cameras in the add-on settings.</div>';
      return;
    }
    grid.innerHTML = cameras.map(renderCameraCard).join('');
  } catch (err) {
    if (qs('#cameras-grid')) qs('#cameras-grid').innerHTML = `<div class="empty-state">Error loading cameras: ${escapeHtml(err.message)}</div>`;
  }
}

async function updateMotion () {
  try {
    const events = await fetchJSON(apiUrl('api/motion'));
    const log = qs('#motion-log');
    const count = qs('#motion-count');
    if (count) count.textContent = events.length;
    if (events.length === 0) {
      log.innerHTML = '<div class="empty-state">No motion events yet.</div>';
      return;
    }
    log.innerHTML = events.map(renderMotionEvent).join('');
  } catch (err) {
    console.error('Motion fetch error:', err);
  }
}

async function updateStreams () {
  try {
    const streams = await fetchJSON(apiUrl('api/streams'));
    const list = qs('#streams-list');
    if (streams.length === 0) {
      list.innerHTML = '<div class="empty-state">No cameras configured.</div>';
      return;
    }
    list.innerHTML = streams.map(renderStreamGroup).join('');
  } catch (err) {
    qs('#streams-list').innerHTML = `<div class="empty-state">Error: ${escapeHtml(err.message)}</div>`;
  }
}

async function updateConfig () {
  try {
    const cfg = await fetchJSON(apiUrl('api/config'));
    const grid = qs('#config-grid');
    if (!grid) return;

    const rows = [
      { label: 'Host Interface', value: cfg.host_interface },
      { label: 'Neolink Port', value: cfg.neolink_port },
      { label: 'go2rtc Port', value: cfg.go2rtc_port },
      { label: 'Log Level', value: cfg.log_level },
      { label: 'ONVIF Username', value: cfg.onvif_username },
      { label: 'ONVIF Password', value: cfg.onvif_password ? '••••••' : '(nicht gesetzt)' }
    ];

    const rowsHtml = rows.map(r => `
      <div class="cfg-row">
        <span class="cfg-label">${escapeHtml(r.label)}</span>
        <span class="cfg-value">${escapeHtml(String(r.value))}</span>
      </div>`).join('');

    const camsHtml = (cfg.cameras || []).map(cam => `
      <div class="cfg-cam">
        <div class="cfg-cam-name">&#x1F4F7; ${escapeHtml(cam.name)}</div>
        <div class="cfg-cam-details">
          <span>${escapeHtml(cam.address || cam.uid || 'UID-based')}</span>
          <span>ONVIF :${cam.onvif_port}</span>
          <span>HD: ${escapeHtml(cam.stream_high)}</span>
          <span>SD: ${escapeHtml(cam.stream_low)}</span>
        </div>
      </div>`).join('');

    grid.innerHTML = `
      <div class="cfg-section">
        <div class="cfg-section-title">Allgemein</div>
        ${rowsHtml}
      </div>
      <div class="cfg-section">
        <div class="cfg-section-title">Kameras (${(cfg.cameras || []).length})</div>
        ${camsHtml || '<div class="empty-state">Keine Kameras konfiguriert.</div>'}
      </div>`;
  } catch (err) {
    console.error('Config fetch error:', err);
  }
}

async function updateLogs () {
  try {
    const logs = await fetchJSON(apiUrl('api/logs') + '?limit=50');
    const panel = qs('#log-panel');
    const count = qs('#log-count');
    if (!panel) return;
    if (count) count.textContent = logs.length;
    if (logs.length === 0) {
      panel.innerHTML = '<div class="empty-state">Keine Log-Einträge.</div>';
      return;
    }
    panel.innerHTML = logs.map(e => `
      <div class="log-line log-${escapeHtml(e.level)}">
        <span class="log-time">${formatTime(e.time)}</span>
        <span class="log-lvl">${escapeHtml(e.level.toUpperCase())}</span>
        <span class="log-msg">${escapeHtml(e.msg)}</span>
      </div>`).join('');
  } catch (err) {
    console.error('Log fetch error:', err);
  }
}

function updateTimestamp () {
  const el = qs('#last-update');
  if (el) el.textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function refresh () {
  await Promise.allSettled([
    updateStatus(),
    updateCameras(),
    updateMotion(),
    updateStreams(),
    updateConfig(),
    updateLogs()
  ]);
  updateTimestamp();
}

// Initial load
refresh();

// Auto-refresh every 10 seconds
setInterval(refresh, 10_000);
