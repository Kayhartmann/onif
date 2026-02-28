'use strict';

// ─── Helpers ──────────────────────────────────────────────────────────────────
function qs(sel) { return document.querySelector(sel); }

function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
           ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

async function fetchJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

function copyToClipboard(text, btn) {
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

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderServiceChip(id, name, running) {
    const el = qs(`#svc-${id}`);
    if (!el) return;
    el.className = `service-chip ${running ? 'running' : 'stopped'}`;
    el.innerHTML = `<span class="svc-dot"></span><span class="svc-label">${name}</span>`;
}

function renderBatteryBar(level) {
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

function renderCameraCard(cam) {
    const motionClass = cam.motion === 'on' ? 'active' : 'idle';
    const motionLabel = cam.motion === 'on' ? '&#x26A1; Motion Active' :
                        cam.motion === 'off' ? 'Idle' : '—';

    const streamingBadge = cam.streaming
        ? '<span class="status-badge online">Streaming</span>'
        : '';

    return `
        <div class="camera-card">
            <div class="camera-card-header">
                <span class="camera-name">&#x1F4F7; ${escapeHtml(cam.name)}</span>
                ${streamingBadge}
            </div>
            <div class="camera-meta">
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Address</span>
                    <span class="camera-meta-value">${escapeHtml(cam.address)}</span>
                </div>
                <div class="camera-meta-row">
                    <span class="camera-meta-label">ONVIF IP</span>
                    <span class="camera-meta-value">${escapeHtml(cam.onvif_ip)}</span>
                </div>
                ${cam.is_battery_camera ? `
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Battery</span>
                    ${renderBatteryBar(cam.battery)}
                </div>` : ''}
                ${cam.enable_motion ? `
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Motion</span>
                    <span class="motion-indicator ${motionClass}">${motionLabel}</span>
                </div>` : ''}
                ${cam.lastSeen ? `
                <div class="camera-meta-row">
                    <span class="camera-meta-label">Last seen</span>
                    <span class="camera-meta-value">${formatTime(cam.lastSeen)}</span>
                </div>` : ''}
            </div>
        </div>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderMotionEvent(ev) {
    return `
        <div class="motion-event ${ev.state}">
            <span class="motion-event-time">${formatDateTime(ev.time)}</span>
            <span class="motion-event-cam">${escapeHtml(ev.camera)}</span>
            <span class="motion-event-state">${ev.state === 'on' ? '&#x26A1; Motion' : 'Clear'}</span>
        </div>`;
}

function renderStreamGroup(stream) {
    const rows = [
        { label: 'HD', url: stream.high },
        { label: 'SD', url: stream.low },
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
async function updateStatus() {
    try {
        const data = await fetchJSON('/api/status');
        const s = data.services;
        renderServiceChip('mosquitto', 'Mosquitto', s.mosquitto.running);
        renderServiceChip('neolink', 'Neolink', s.neolink.running);
        renderServiceChip('go2rtc', 'go2rtc', s.go2rtc.running);
        renderServiceChip('onvif', 'ONVIF', s.onvif.running);
    } catch (err) {
        console.error('Status fetch error:', err);
    }
}

async function updateCameras() {
    try {
        const cameras = await fetchJSON('/api/cameras');
        const grid = qs('#cameras-grid');
        if (cameras.length === 0) {
            grid.innerHTML = '<div class="empty-state">No cameras configured. Add cameras in the add-on settings.</div>';
            return;
        }
        grid.innerHTML = cameras.map(renderCameraCard).join('');
    } catch (err) {
        qs('#cameras-grid').innerHTML = `<div class="empty-state">Error loading cameras: ${escapeHtml(err.message)}</div>`;
    }
}

async function updateMotion() {
    try {
        const events = await fetchJSON('/api/motion');
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

async function updateStreams() {
    try {
        const streams = await fetchJSON('/api/streams');
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

function updateTimestamp() {
    const el = qs('#last-update');
    if (el) el.textContent = 'Updated: ' + new Date().toLocaleTimeString();
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function refresh() {
    await Promise.allSettled([
        updateStatus(),
        updateCameras(),
        updateMotion(),
        updateStreams(),
    ]);
    updateTimestamp();
}

// Initial load
refresh();

// Auto-refresh every 10 seconds
setInterval(refresh, 10_000);
