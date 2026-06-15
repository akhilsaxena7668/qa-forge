/**
 * QAForge Performance Tester v1.0
 * Browser-based HTTP load/stress testing engine
 */

// ═══════ PROFILES ═══════
const PERF_PROFILES = {
  smoke:   { users: 2,   requests: 10,  rampUp: 0,  timeout: 10, label: 'Smoke Test' },
  load:    { users: 10,  requests: 50,  rampUp: 5,  timeout: 15, label: 'Load Test' },
  stress:  { users: 50,  requests: 200, rampUp: 10, timeout: 20, label: 'Stress Test' },
  spike:   { users: 100, requests: 500, rampUp: 2,  timeout: 30, label: 'Spike Test' },
  custom:  { users: 5,   requests: 25,  rampUp: 3,  timeout: 15, label: 'Custom' }
};

// ═══════ STATE ═══════
let perfState = {
  running: false,
  aborted: false,
  profile: 'smoke',
  method: 'GET',
  results: [],
  startTime: 0,
  completed: 0,
  failed: 0,
  totalTarget: 0,
  chartTimer: null,
  history: []
};

// ═══════ INIT ═══════
function initPerfTester() {
  loadPerfHistory();
  renderPerfHistory();
  setPerfProfile(document.querySelector('.perf-prof.active') || document.querySelector('.perf-prof'));
}

// ═══════ PROFILE SELECTION ═══════
function setPerfProfile(btn) {
  if (!btn) return;
  document.querySelectorAll('.perf-prof').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  perfState.profile = btn.dataset.prof;
  const p = PERF_PROFILES[perfState.profile];
  if (perfState.profile !== 'custom') {
    document.getElementById('perfUsers').value = p.users;
    document.getElementById('perfUsersNum').value = p.users;
    document.getElementById('perfReqs').value = p.requests;
    document.getElementById('perfReqsNum').value = p.requests;
    document.getElementById('perfRamp').value = p.rampUp;
    document.getElementById('perfRampNum').value = p.rampUp;
    document.getElementById('perfTimeout').value = p.timeout;
    document.getElementById('perfTimeoutNum').value = p.timeout;
  }
}

function syncPerfSlider(sliderId, numId) {
  const s = document.getElementById(sliderId);
  const n = document.getElementById(numId);
  if (s && n) { n.value = s.value; }
  // Switch to custom
  document.querySelectorAll('.perf-prof').forEach(b => b.classList.remove('active'));
  document.querySelector('.perf-prof[data-prof="custom"]')?.classList.add('active');
  perfState.profile = 'custom';
}

function syncPerfNum(numId, sliderId) {
  const n = document.getElementById(numId);
  const s = document.getElementById(sliderId);
  if (n && s) { s.value = n.value; }
  document.querySelectorAll('.perf-prof').forEach(b => b.classList.remove('active'));
  document.querySelector('.perf-prof[data-prof="custom"]')?.classList.add('active');
  perfState.profile = 'custom';
}

function setPerfMethod(btn) {
  document.querySelectorAll('.perf-method-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  perfState.method = btn.dataset.method;
  const bodySection = document.getElementById('perfBodySection');
  if (bodySection) {
    bodySection.style.display = ['POST','PUT','PATCH'].includes(perfState.method) ? '' : 'none';
  }
}

// ═══════ RUN TEST ═══════
async function runPerfTest() {
  const url = document.getElementById('perfUrl')?.value?.trim();
  if (!url) return toast('Enter a target URL', 'err');
  if (perfState.running) return toast('Test already running', 'err');

  const users = parseInt(document.getElementById('perfUsers').value) || 5;
  const totalReqs = parseInt(document.getElementById('perfReqs').value) || 25;
  const rampUp = parseInt(document.getElementById('perfRamp').value) || 0;
  const timeout = parseInt(document.getElementById('perfTimeout').value) || 15;
  const method = perfState.method;
  const headersRaw = document.getElementById('perfHeaders')?.value?.trim() || '';
  const body = document.getElementById('perfBody')?.value?.trim() || '';

  // Parse headers
  const headers = {};
  if (headersRaw) {
    headersRaw.split('\n').forEach(line => {
      const idx = line.indexOf(':');
      if (idx > 0) headers[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    });
  }

  // Reset state
  perfState.running = true;
  perfState.aborted = false;
  perfState.results = [];
  perfState.completed = 0;
  perfState.failed = 0;
  perfState.totalTarget = totalReqs;
  perfState.startTime = performance.now();

  // UI updates
  document.getElementById('perfRunBtn').style.display = 'none';
  document.getElementById('perfAbortBtn').style.display = '';
  document.getElementById('perfEmpty').style.display = 'none';
  document.getElementById('perfDashboard').classList.remove('hidden');
  document.getElementById('perfExportBtns').style.display = 'none';
  resetPerfStats();

  // Start chart updates
  perfState.chartTimer = setInterval(() => {
    updatePerfStats();
    drawPerfTimeline();
    drawPerfHistogram();
  }, 400);

  // Worker pool
  let sent = 0;
  const activeSlots = new Set();

  const sendOne = async () => {
    if (perfState.aborted || sent >= totalReqs) return;
    const reqIdx = sent++;
    const reqStart = performance.now();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout * 1000);

      const proxyPayload = { url, method, headers, body: body || null };
      const res = await fetch('/api/proxy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      const data = await res.json();
      const latency = performance.now() - reqStart;
      const status = data.status || (res.ok ? 200 : 500);

      perfState.results.push({
        index: reqIdx,
        status,
        latency: Math.round(latency),
        size: data.size || 0,
        timestamp: performance.now() - perfState.startTime,
        error: null
      });
      perfState.completed++;
    } catch (err) {
      const latency = performance.now() - reqStart;
      perfState.results.push({
        index: reqIdx,
        status: 0,
        latency: Math.round(latency),
        size: 0,
        timestamp: performance.now() - perfState.startTime,
        error: err.name === 'AbortError' ? 'Timeout' : err.message
      });
      perfState.failed++;
      perfState.completed++;
    }
  };

  // Ramp-up logic
  const rampIntervalMs = rampUp > 0 ? (rampUp * 1000) / users : 0;
  let currentConcurrency = rampUp > 0 ? 1 : users;

  const runPool = () => {
    return new Promise(resolve => {
      let inFlight = 0;
      let rampIdx = rampUp > 0 ? 1 : users;
      let rampTimer = null;

      if (rampUp > 0 && users > 1) {
        rampTimer = setInterval(() => {
          if (rampIdx < users) {
            rampIdx++;
            currentConcurrency = rampIdx;
            // Launch new slot
            launchSlot();
          } else {
            clearInterval(rampTimer);
          }
        }, rampIntervalMs);
      }

      function launchSlot() {
        if (perfState.aborted) return checkDone();
        if (sent >= totalReqs && inFlight === 0) return checkDone();
        if (sent >= totalReqs) return;

        inFlight++;
        sendOne().then(() => {
          inFlight--;
          if (!perfState.aborted && sent < totalReqs) {
            launchSlot();
          } else {
            checkDone();
          }
        });
      }

      function checkDone() {
        if (inFlight <= 0 && (sent >= totalReqs || perfState.aborted)) {
          if (rampTimer) clearInterval(rampTimer);
          resolve();
        }
      }

      // Initial launch
      for (let i = 0; i < currentConcurrency && i < totalReqs; i++) {
        launchSlot();
      }
    });
  };

  await runPool();

  // Done
  clearInterval(perfState.chartTimer);
  perfState.running = false;
  document.getElementById('perfRunBtn').style.display = '';
  document.getElementById('perfAbortBtn').style.display = 'none';
  document.getElementById('perfExportBtns').style.display = 'flex';

  // Final update
  updatePerfStats();
  drawPerfTimeline();
  drawPerfHistogram();
  drawStatusBreakdown();

  // Save to history
  savePerfResult(url, method, users, totalReqs);
  toast(perfState.aborted ? 'Test aborted' : `Done: ${perfState.completed} requests completed`, perfState.aborted ? 'warn' : 'ok');
}

function abortPerfTest() {
  perfState.aborted = true;
  toast('Aborting test...', 'warn');
}

// ═══════ METRICS ═══════
function calcMetrics() {
  const r = perfState.results;
  if (!r.length) return null;

  const latencies = r.map(x => x.latency).sort((a, b) => a - b);
  const successful = r.filter(x => x.status >= 200 && x.status < 400);
  const errors = r.filter(x => x.status === 0 || x.status >= 400);
  const elapsed = (performance.now() - perfState.startTime) / 1000;

  const pct = (arr, p) => {
    const idx = Math.ceil(arr.length * p / 100) - 1;
    return arr[Math.max(0, idx)] || 0;
  };

  return {
    total: r.length,
    success: successful.length,
    errors: errors.length,
    errorRate: r.length ? ((errors.length / r.length) * 100).toFixed(1) : '0.0',
    avg: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    min: latencies[0] || 0,
    max: latencies[latencies.length - 1] || 0,
    p50: Math.round(pct(latencies, 50)),
    p95: Math.round(pct(latencies, 95)),
    p99: Math.round(pct(latencies, 99)),
    rps: elapsed > 0 ? (r.length / elapsed).toFixed(1) : '0.0',
    elapsed: elapsed.toFixed(1),
    totalSize: r.reduce((a, x) => a + (x.size || 0), 0)
  };
}

function resetPerfStats() {
  ['perfStatTotal','perfStatSuccess','perfStatFailed','perfStatAvg','perfStatP95','perfStatP99','perfStatMin','perfStatMax','perfStatRps','perfStatErr'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = '—';
  });
  const prog = document.getElementById('perfProgressFill');
  if (prog) prog.style.width = '0%';
  document.getElementById('perfProgressPct')?.setAttribute('data-pct', '0%');

  // Clear canvases
  ['perfTimelineCanvas','perfHistCanvas'].forEach(id => {
    const c = document.getElementById(id);
    if (c) { const ctx = c.getContext('2d'); ctx.clearRect(0, 0, c.width, c.height); }
  });
  const sb = document.getElementById('perfStatusBreakdown');
  if (sb) sb.innerHTML = '';
}

function updatePerfStats() {
  const m = calcMetrics();
  if (!m) return;

  const pct = perfState.totalTarget > 0 ? Math.round((m.total / perfState.totalTarget) * 100) : 0;
  const prog = document.getElementById('perfProgressFill');
  if (prog) prog.style.width = pct + '%';
  const pctEl = document.getElementById('perfProgressPct');
  if (pctEl) pctEl.textContent = pct + '%';

  setText2('perfStatTotal', m.total);
  setText2('perfStatSuccess', m.success);
  setText2('perfStatFailed', m.errors);
  setText2('perfStatAvg', m.avg + 'ms');
  setText2('perfStatP95', m.p95 + 'ms');
  setText2('perfStatP99', m.p99 + 'ms');
  setText2('perfStatMin', m.min + 'ms');
  setText2('perfStatMax', m.max + 'ms');
  setText2('perfStatRps', m.rps);
  setText2('perfStatErr', m.errorRate + '%');
}

function setText2(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

// ═══════ CHARTS ═══════
function drawPerfTimeline() {
  const canvas = document.getElementById('perfTimelineCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 200 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '200px';
  ctx.scale(dpr, dpr);

  const W = rect.width, H = 200;
  const r = perfState.results;
  if (!r.length) return;

  // Background
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg3').trim() || '#27272a';
  ctx.fillRect(0, 0, W, H);

  // Grid
  const maxT = Math.max(...r.map(x => x.timestamp)) || 1;
  const maxL = Math.max(...r.map(x => x.latency), 100);
  const padL = 50, padR = 10, padT = 15, padB = 25;
  const plotW = W - padL - padR, plotH = H - padT - padB;

  ctx.strokeStyle = getComputedStyle(document.body).getPropertyValue('--b').trim() || '#3f3f46';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH / 4) * i;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--t3').trim() || '#64748b';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxL - (maxL / 4) * i) + 'ms', padL - 5, y + 4);
  }

  // Axis label
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--t3').trim();
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Time →', W / 2, H - 3);

  // Points
  const acColor = getComputedStyle(document.body).getPropertyValue('--ac').trim() || '#3b82f6';
  const errColor = getComputedStyle(document.body).getPropertyValue('--cr').trim() || '#ef4444';
  const warnColor = getComputedStyle(document.body).getPropertyValue('--cm').trim() || '#eab308';

  r.forEach(pt => {
    const x = padL + (pt.timestamp / maxT) * plotW;
    const y = padT + plotH - (pt.latency / maxL) * plotH;
    const isErr = pt.status === 0 || pt.status >= 400;
    const isSlow = pt.latency > maxL * 0.8;

    ctx.beginPath();
    ctx.arc(x, y, isErr ? 4 : 3, 0, Math.PI * 2);
    ctx.fillStyle = isErr ? errColor : isSlow ? warnColor : acColor;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

function drawPerfHistogram() {
  const canvas = document.getElementById('perfHistCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 180 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '180px';
  ctx.scale(dpr, dpr);

  const W = rect.width, H = 180;
  const r = perfState.results;
  if (!r.length) return;

  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--bg3').trim() || '#27272a';
  ctx.fillRect(0, 0, W, H);

  // Buckets
  const buckets = [
    { label: '0-50', min: 0, max: 50, count: 0 },
    { label: '50-100', min: 50, max: 100, count: 0 },
    { label: '100-200', min: 100, max: 200, count: 0 },
    { label: '200-500', min: 200, max: 500, count: 0 },
    { label: '500-1k', min: 500, max: 1000, count: 0 },
    { label: '1k-2k', min: 1000, max: 2000, count: 0 },
    { label: '2k-5k', min: 2000, max: 5000, count: 0 },
    { label: '5k+', min: 5000, max: Infinity, count: 0 }
  ];

  r.forEach(pt => {
    for (const b of buckets) {
      if (pt.latency >= b.min && pt.latency < b.max) { b.count++; break; }
    }
  });

  const maxCount = Math.max(...buckets.map(b => b.count), 1);
  const padL = 40, padR = 10, padT = 15, padB = 30;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const barW = plotW / buckets.length - 4;

  const acColor = getComputedStyle(document.body).getPropertyValue('--ac').trim() || '#3b82f6';
  const ac4Color = getComputedStyle(document.body).getPropertyValue('--ac4').trim() || '#8b5cf6';

  buckets.forEach((b, i) => {
    const x = padL + i * (plotW / buckets.length) + 2;
    const barH = (b.count / maxCount) * plotH;
    const y = padT + plotH - barH;

    const grad = ctx.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, acColor);
    grad.addColorStop(1, ac4Color);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);

    // Label
    ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--t3').trim() || '#64748b';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(b.label, x + barW / 2, H - 8);

    // Count on top
    if (b.count > 0) {
      ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--t2').trim() || '#94a3b8';
      ctx.font = '10px monospace';
      ctx.fillText(b.count, x + barW / 2, y - 4);
    }
  });

  // Y axis
  ctx.fillStyle = getComputedStyle(document.body).getPropertyValue('--t3').trim();
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  ctx.save();
  ctx.translate(10, H / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Count', 0, 0);
  ctx.restore();

  ctx.textAlign = 'center';
  ctx.fillText('Latency (ms)', W / 2, H - 1);
}

function drawStatusBreakdown() {
  const el = document.getElementById('perfStatusBreakdown');
  if (!el) return;
  const r = perfState.results;
  if (!r.length) { el.innerHTML = ''; return; }

  const codes = {};
  r.forEach(pt => {
    const key = pt.status === 0 ? 'ERR' : pt.status.toString();
    codes[key] = (codes[key] || 0) + 1;
  });

  const colors = {
    '200': 'var(--ac2)', '201': 'var(--ac2)', '204': 'var(--ac2)',
    '301': 'var(--cm)', '302': 'var(--cm)', '304': 'var(--cm)',
    '400': 'var(--ch)', '401': 'var(--ch)', '403': 'var(--ch)', '404': 'var(--ch)',
    '500': 'var(--cr)', '502': 'var(--cr)', '503': 'var(--cr)', 'ERR': 'var(--cr)'
  };

  const total = r.length;
  el.innerHTML = Object.entries(codes).sort((a, b) => b[1] - a[1]).map(([code, count]) => {
    const pct = ((count / total) * 100).toFixed(1);
    const color = colors[code] || (parseInt(code) < 300 ? 'var(--ac2)' : parseInt(code) < 400 ? 'var(--cm)' : 'var(--cr)');
    return `<div class="perf-status-row">
      <span class="perf-status-code" style="color:${color}">${code}</span>
      <div class="perf-status-track"><div class="perf-status-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="perf-status-count">${count} (${pct}%)</span>
    </div>`;
  }).join('');
}

// ═══════ EXPORT ═══════
function exportPerfJson() {
  const m = calcMetrics();
  const data = {
    timestamp: new Date().toISOString(),
    config: {
      url: document.getElementById('perfUrl')?.value,
      method: perfState.method,
      users: document.getElementById('perfUsers')?.value,
      totalRequests: document.getElementById('perfReqs')?.value,
      rampUp: document.getElementById('perfRamp')?.value,
      profile: perfState.profile
    },
    metrics: m,
    results: perfState.results
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `qaforge-perf-${Date.now()}.json`;
  a.click();
  toast('Performance results exported', 'ok');
}

function exportPerfChart() {
  const tCanvas = document.getElementById('perfTimelineCanvas');
  const hCanvas = document.getElementById('perfHistCanvas');
  if (!tCanvas || !hCanvas) return toast('No charts to export', 'err');
  
  const m = calcMetrics();
  if (!m) return toast('No data to export', 'err');

  const dpr = window.devicePixelRatio || 1;
  const padding = 40 * dpr;
  const headerHeight = 200 * dpr;
  const gap = 30 * dpr;
  
  const width = Math.max(tCanvas.width, hCanvas.width) + padding * 2;
  const height = tCanvas.height + hCanvas.height + headerHeight + gap + padding * 2;
  
  if (width <= padding * 2 || height <= headerHeight + padding * 2) {
    return toast('Charts are not fully rendered yet', 'warn');
  }

  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  
  const styleSource = document.documentElement;
  
  // Colors
  const bgColor = getComputedStyle(styleSource).getPropertyValue('--bg').trim() || '#09090b';
  const cardBg = getComputedStyle(styleSource).getPropertyValue('--bg3').trim() || '#27272a';
  const tColor = getComputedStyle(styleSource).getPropertyValue('--t').trim() || '#f8fafc';
  const t2Color = getComputedStyle(styleSource).getPropertyValue('--t2').trim() || '#94a3b8';
  const acColor = getComputedStyle(styleSource).getPropertyValue('--ac').trim() || '#3b82f6';
  const ac2Color = getComputedStyle(styleSource).getPropertyValue('--ac2').trim() || '#10b981';
  const crColor = getComputedStyle(styleSource).getPropertyValue('--cr').trim() || '#ef4444';
  
  // Base Background
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, width, height);
  
  // Header Panel
  ctx.fillStyle = cardBg;
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(padding, padding, width - padding * 2, headerHeight - padding, 16 * dpr);
  } else {
    ctx.fillRect(padding, padding, width - padding * 2, headerHeight - padding);
  }
  ctx.fill();
  
  // Header Title
  ctx.fillStyle = acColor;
  ctx.font = `bold ${28 * dpr}px Inter, sans-serif`;
  ctx.fillText('QAForge Performance Report', padding + 24 * dpr, padding + 44 * dpr);
  
  // Meta details
  ctx.fillStyle = tColor;
  ctx.font = `bold ${16 * dpr}px JetBrains Mono, monospace`;
  const url = document.getElementById('perfUrl')?.value || 'N/A';
  ctx.fillText(`Target: ${url}`, padding + 24 * dpr, padding + 76 * dpr);
  
  ctx.fillStyle = t2Color;
  ctx.font = `${14 * dpr}px JetBrains Mono, monospace`;
  const pUsers = document.getElementById('perfUsers')?.value || 0;
  ctx.fillText(`Profile: ${perfState.profile.toUpperCase()}  |  Requests: ${perfState.totalTarget}  |  Concurrency: ${pUsers}`, padding + 24 * dpr, padding + 104 * dpr);
  
  // Metrics Grid
  const metY = padding + 144 * dpr;
  const metX = padding + 24 * dpr;
  const drawMetric = (label, val, x, color = tColor) => {
    ctx.fillStyle = t2Color;
    ctx.font = `${12 * dpr}px Inter, sans-serif`;
    ctx.fillText(label, x, metY);
    ctx.fillStyle = color;
    ctx.font = `bold ${22 * dpr}px JetBrains Mono, monospace`;
    ctx.fillText(val, x, metY + 28 * dpr);
  };
  
  drawMetric('AVERAGE', `${m.avg}ms`, metX);
  drawMetric('P95', `${m.p95}ms`, metX + 160 * dpr);
  drawMetric('MIN / MAX', `${m.min} / ${m.max}ms`, metX + 320 * dpr);
  drawMetric('RPS', m.rps, metX + 540 * dpr);
  drawMetric('ERRORS', `${m.errorRate}%`, metX + 680 * dpr, m.errorRate > 0 ? crColor : ac2Color);
  
  // Draw Timeline
  let currentY = headerHeight + padding + 10 * dpr;
  ctx.fillStyle = tColor;
  ctx.font = `bold ${18 * dpr}px Inter, sans-serif`;
  ctx.fillText('Latency Timeline', padding, currentY);
  currentY += 20 * dpr;
  ctx.drawImage(tCanvas, padding, currentY);
  
  // Draw Histogram
  currentY += tCanvas.height + gap;
  ctx.fillStyle = tColor;
  ctx.fillText('Latency Distribution', padding, currentY);
  currentY += 20 * dpr;
  ctx.drawImage(hCanvas, padding, currentY);
  
  // Download using toBlob
  c.toBlob((blob) => {
    if (!blob) return toast('Failed to generate image blob', 'err');
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = `qaforge-perf-chart-${Date.now()}.png`;
    document.body.appendChild(a); // Required for Firefox/Safari
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
    toast('Attractive Chart exported as PNG', 'ok');
  }, 'image/png');
}


// ═══════ HISTORY ═══════
function savePerfResult(url, method, users, totalReqs) {
  const m = calcMetrics();
  if (!m) return;
  const entry = {
    id: Date.now().toString(36),
    date: new Date().toISOString(),
    url, method, users, totalReqs,
    profile: perfState.profile,
    metrics: m,
    aborted: perfState.aborted
  };
  perfState.history.unshift(entry);
  if (perfState.history.length > 20) perfState.history = perfState.history.slice(0, 20);
  localStorage.setItem('qaf-perf-history', JSON.stringify(perfState.history));
  renderPerfHistory();
}

function loadPerfHistory() {
  try {
    const saved = localStorage.getItem('qaf-perf-history');
    if (saved) perfState.history = JSON.parse(saved);
  } catch { perfState.history = []; }
}

function renderPerfHistory() {
  const el = document.getElementById('perfHistoryList');
  if (!el) return;
  if (!perfState.history.length) {
    el.innerHTML = '<div class="empty-sm">No past runs yet.</div>';
    return;
  }
  el.innerHTML = perfState.history.map(h => {
    const m = h.metrics;
    const rateColor = parseFloat(m.errorRate) > 10 ? 'var(--cr)' : parseFloat(m.errorRate) > 0 ? 'var(--cm)' : 'var(--ac2)';
    return `<div class="perf-hist-card">
      <div class="perf-hist-top">
        <span class="perf-hist-method m-${h.method?.toLowerCase()}">${h.method}</span>
        <span class="perf-hist-url">${h.url?.length > 40 ? h.url.slice(0, 40) + '…' : h.url}</span>
      </div>
      <div class="perf-hist-meta">
        <span>${h.profile?.toUpperCase()}</span>
        <span>${h.users}u / ${h.totalReqs}req</span>
        <span>${new Date(h.date).toLocaleDateString()}</span>
      </div>
      <div class="perf-hist-stats">
        <span>Avg: <b>${m.avg}ms</b></span>
        <span>P95: <b>${m.p95}ms</b></span>
        <span>RPS: <b>${m.rps}</b></span>
        <span style="color:${rateColor}">Err: <b>${m.errorRate}%</b></span>
      </div>
    </div>`;
  }).join('');
}

function clearPerfHistory() {
  if (!confirm('Clear all performance test history?')) return;
  perfState.history = [];
  localStorage.removeItem('qaf-perf-history');
  renderPerfHistory();
  toast('History cleared', 'inf');
}
