/**
 * QAForge API Tester — Built-in Postman-like REST Client
 */

// ═══════ STATE ═══════
let apiMethod = 'GET';
let apiHeaders = [{ key: 'Content-Type', value: 'application/json', enabled: true }];
let apiParams = [{ key: '', value: '', enabled: true }];
let apiBodyType = 'json';
let apiAuthType = 'none';
let apiCollections = JSON.parse(localStorage.getItem('qaf-api-collections') || '[]');
let apiHistory = JSON.parse(localStorage.getItem('qaf-api-history') || '[]');
let apiEnvironments = JSON.parse(localStorage.getItem('qaf-api-envs') || '[{"name":"Default","vars":{"baseUrl":"http://localhost:8000"},"active":true}]');
let apiActiveEnv = apiEnvironments.find(e => e.active) || apiEnvironments[0];
let lastApiResponse = null;

// ═══════ COOKIE JAR (per-domain) ═══════
let cookieJar = JSON.parse(localStorage.getItem('qaf-api-cookies') || '{}');
if (!cookieJar) cookieJar = {};
// Format: { "api.example.com": { "session": { value, path, expires, httpOnly, secure, sameSite } } }

let xsrfConfig = JSON.parse(localStorage.getItem('qaf-api-xsrf') || '{"enabled":true,"cookieName":"XSRF-TOKEN","headerName":"X-XSRF-TOKEN"}');
if (!xsrfConfig) xsrfConfig = { enabled: true, cookieName: 'XSRF-TOKEN', headerName: 'X-XSRF-TOKEN' };

function saveCookieJar() { localStorage.setItem('qaf-api-cookies', JSON.stringify(cookieJar)); }
function saveXsrfConfig() { localStorage.setItem('qaf-api-xsrf', JSON.stringify(xsrfConfig)); }

function _getDomain(urlStr) {
  try { return new URL(urlStr, window.location.origin).hostname; } catch { return 'localhost'; }
}

function getCookiesForDomain(domain) { return cookieJar[domain] || {}; }

function setCookieForDomain(domain, name, value, attrs) {
  if (!cookieJar[domain]) cookieJar[domain] = {};
  cookieJar[domain][name] = { value, ...(attrs || {}) };
  saveCookieJar();
}

function deleteCookieForDomain(domain, name) {
  if (cookieJar[domain]) { delete cookieJar[domain][name]; if (!Object.keys(cookieJar[domain]).length) delete cookieJar[domain]; }
  saveCookieJar();
}

function clearCookiesForDomain(domain) { delete cookieJar[domain]; saveCookieJar(); }

function updateCookieValue(domain, name, newValue) {
  if (cookieJar[domain] && cookieJar[domain][name]) {
    cookieJar[domain][name].value = newValue;
    saveCookieJar();
  }
}

function buildCookieHeader(domain) {
  const cookies = getCookiesForDomain(domain);
  const now = Date.now();
  const parts = [];
  for (const [name, c] of Object.entries(cookies)) {
    if (c.expires && new Date(c.expires).getTime() < now) { delete cookies[name]; continue; }
    parts.push(`${name}=${c.value}`);
  }
  saveCookieJar();
  return parts.length ? parts.join('; ') : null;
}

function parseSetCookieHeader(setCookieStr, domain) {
  const parts = setCookieStr.split(';').map(s => s.trim());
  if (!parts.length) return;
  const [first, ...rest] = parts;
  const eqIdx = first.indexOf('=');
  if (eqIdx < 0) return;
  const name = first.slice(0, eqIdx).trim();
  const value = first.slice(eqIdx + 1).trim();
  const attrs = {};
  for (const attr of rest) {
    const [ak, av] = attr.split('=').map(s => s.trim());
    const key = ak.toLowerCase();
    if (key === 'path') attrs.path = av || '/';
    else if (key === 'expires') attrs.expires = av;
    else if (key === 'max-age') attrs.maxAge = av;
    else if (key === 'domain') attrs.domain = av;
    else if (key === 'samesite') attrs.sameSite = av;
    else if (key === 'secure') attrs.secure = true;
    else if (key === 'httponly') attrs.httpOnly = true;
  }
  setCookieForDomain(attrs.domain || domain, name, value, attrs);
}

function getXsrfToken(domain) {
  if (!xsrfConfig.enabled) return null;
  const cookies = getCookiesForDomain(domain);
  const names = [xsrfConfig.cookieName, 'XSRF-TOKEN', 'csrf-token', '_csrf', 'csrftoken'];
  for (const n of names) { if (cookies[n]) return cookies[n].value; }
  return null;
}

// ═══════ INIT ═══════
function initApiTester() {
  renderApiHeaders();
  renderApiParams();
  renderApiCollections();
  renderApiHistory();
  renderApiEnvVars();
  renderCookieJar();
  renderXsrfConfig();
}

// ═══════ METHOD ═══════
function setApiMethod(btn, method) {
  apiMethod = method;
  document.querySelectorAll('.api-method-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const bodyTabs = document.getElementById('apiBodyTab');
  if (bodyTabs) bodyTabs.style.display = ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'none' : '';
}

// ═══════ HEADERS ═══════
function renderApiHeaders() {
  const el = document.getElementById('apiHeaderRows');
  if (!el) return;
  el.innerHTML = apiHeaders.map((h, i) => `
    <div class="kv-row">
      <label class="kv-chk"><input type="checkbox" ${h.enabled ? 'checked' : ''} onchange="apiHeaders[${i}].enabled=this.checked"/></label>
      <input class="kv-key" placeholder="Header name" value="${esc(h.key)}" oninput="apiHeaders[${i}].key=this.value"/>
      <input class="kv-val" placeholder="Value" value="${esc(h.value)}" oninput="apiHeaders[${i}].value=this.value"/>
      <button class="kv-del" onclick="apiHeaders.splice(${i},1);renderApiHeaders()">✕</button>
    </div>
  `).join('');
}
function addApiHeader() { apiHeaders.push({ key: '', value: '', enabled: true }); renderApiHeaders(); }

// ═══════ PARAMS ═══════
function renderApiParams() {
  const el = document.getElementById('apiParamRows');
  if (!el) return;
  el.innerHTML = apiParams.map((p, i) => `
    <div class="kv-row">
      <label class="kv-chk"><input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="apiParams[${i}].enabled=this.checked"/></label>
      <input class="kv-key" placeholder="Key" value="${esc(p.key)}" oninput="apiParams[${i}].key=this.value;syncParamsToUrl()"/>
      <input class="kv-val" placeholder="Value" value="${esc(p.value)}" oninput="apiParams[${i}].value=this.value;syncParamsToUrl()"/>
      <button class="kv-del" onclick="apiParams.splice(${i},1);renderApiParams();syncParamsToUrl()">✕</button>
    </div>
  `).join('');
}
function addApiParam() { apiParams.push({ key: '', value: '', enabled: true }); renderApiParams(); }

function syncParamsToUrl() {
  const urlEl = document.getElementById('apiUrl');
  if (!urlEl) return;
  let base = urlEl.value.split('?')[0];
  const active = apiParams.filter(p => p.enabled && p.key);
  if (active.length) base += '?' + active.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  urlEl.value = base;
}

// ═══════ ENVIRONMENT VARIABLES ═══════
function interpolateEnv(str) {
  if (!apiActiveEnv || !str) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => apiActiveEnv.vars[k] || `{{${k}}}`);
}

function renderApiEnvVars() {
  const el = document.getElementById('apiEnvList');
  if (!el || !apiActiveEnv) return;
  const vars = apiActiveEnv.vars || {};
  el.innerHTML = Object.entries(vars).map(([k, v], i) => `
    <div class="kv-row">
      <input class="kv-key" value="${esc(k)}" oninput="renameEnvVar('${esc(k)}',this.value)"/>
      <input class="kv-val" value="${esc(v)}" oninput="apiActiveEnv.vars['${esc(k)}']=this.value;saveEnvs()"/>
      <button class="kv-del" onclick="delete apiActiveEnv.vars['${esc(k)}'];saveEnvs();renderApiEnvVars()">✕</button>
    </div>
  `).join('') || '<div class="api-empty-hint">No variables defined</div>';
}

function addEnvVar() {
  if (!apiActiveEnv) return;
  const name = `var_${Object.keys(apiActiveEnv.vars).length + 1}`;
  apiActiveEnv.vars[name] = '';
  saveEnvs();
  renderApiEnvVars();
}

function renameEnvVar(oldKey, newKey) {
  if (!newKey || oldKey === newKey) return;
  const val = apiActiveEnv.vars[oldKey];
  delete apiActiveEnv.vars[oldKey];
  apiActiveEnv.vars[newKey] = val;
  saveEnvs();
}

function saveEnvs() {
  localStorage.setItem('qaf-api-envs', JSON.stringify(apiEnvironments));
}

function selectApiEnv(name) {
  apiEnvironments.forEach(e => e.active = e.name === name);
  apiActiveEnv = apiEnvironments.find(e => e.active) || apiEnvironments[0];
  saveEnvs();
  renderApiEnvVars();
  document.querySelectorAll('.api-env-opt').forEach(b => b.classList.toggle('active', b.dataset.env === name));
}

function addApiEnv() {
  const name = prompt('Environment name:');
  if (!name) return;
  apiEnvironments.push({ name, vars: {}, active: false });
  saveEnvs();
  renderApiEnvSelector();
}

function renderApiEnvSelector() {
  const el = document.getElementById('apiEnvSelector');
  if (!el) return;
  el.innerHTML = apiEnvironments.map(e => `
    <button class="api-env-opt ${e.active ? 'active' : ''}" data-env="${esc(e.name)}" onclick="selectApiEnv('${esc(e.name)}')">${esc(e.name)}</button>
  `).join('') + `<button class="api-env-opt api-env-add" onclick="addApiEnv()">+ Add</button>`;
}

// ═══════ SEND REQUEST ═══════
function _isExternalUrl(url) {
  try {
    const u = new URL(url, window.location.origin);
    return u.origin !== window.location.origin;
  } catch { return false; }
}

async function _sendViaProxy(url, method, headers, body, startTime) {
  const proxyRes = await fetch('/api/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, method, headers, body: body || null }),
  });
  if (!proxyRes.ok) {
    const errText = await proxyRes.text().catch(() => 'Proxy request failed');
    throw new Error(`Proxy error (${proxyRes.status}): ${errText}`);
  }
  return await proxyRes.json();
}

async function sendApiRequest() {
  const urlRaw = document.getElementById('apiUrl')?.value?.trim();
  if (!urlRaw) return toast('Enter a URL', 'err');

  const url = interpolateEnv(urlRaw);
  const domain = _getDomain(url);
  const resPanel = document.getElementById('apiResPanel');
  const loading = document.getElementById('apiResLoading');
  const empty = document.getElementById('apiResEmpty');
  const output = document.getElementById('apiResOutput');

  if (resPanel) resPanel.classList.remove('hidden');
  if (loading) loading.classList.remove('hidden');
  if (empty) empty.classList.add('hidden');
  if (output) output.classList.add('hidden');

  // Build headers
  const headers = {};
  apiHeaders.filter(h => h.enabled && h.key).forEach(h => {
    headers[interpolateEnv(h.key)] = interpolateEnv(h.value);
  });

  // Auth
  const authToken = document.getElementById('apiAuthToken')?.value?.trim();
  const authUser = document.getElementById('apiAuthUser')?.value?.trim();
  const authPass = document.getElementById('apiAuthPass')?.value?.trim();
  const authKeyName = document.getElementById('apiAuthKeyName')?.value?.trim();
  const authKeyVal = document.getElementById('apiAuthKeyValue')?.value?.trim();

  if (apiAuthType === 'bearer' && authToken) {
    headers['Authorization'] = `Bearer ${interpolateEnv(authToken)}`;
  } else if (apiAuthType === 'basic' && authUser) {
    headers['Authorization'] = `Basic ${btoa(interpolateEnv(authUser) + ':' + interpolateEnv(authPass || ''))}`;
  } else if (apiAuthType === 'apikey' && authKeyName && authKeyVal) {
    headers[interpolateEnv(authKeyName)] = interpolateEnv(authKeyVal);
  }

  // ── Attach cookies from jar ──
  const cookieStr = buildCookieHeader(domain);
  if (cookieStr) headers['Cookie'] = cookieStr;

  // ── XSRF token auto-injection ──
  if (!['GET', 'HEAD', 'OPTIONS'].includes(apiMethod)) {
    const xsrfToken = getXsrfToken(domain);
    if (xsrfToken && !headers[xsrfConfig.headerName]) {
      headers[xsrfConfig.headerName] = xsrfToken;
    }
  }

  // Body
  let body = undefined;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(apiMethod)) {
    if (apiBodyType === 'json') {
      body = document.getElementById('apiBodyJson')?.value?.trim();
      if (body) body = interpolateEnv(body);
    } else if (apiBodyType === 'raw') {
      body = document.getElementById('apiBodyRaw')?.value?.trim();
      if (body) body = interpolateEnv(body);
    } else if (apiBodyType === 'form') {
      const formData = document.getElementById('apiBodyForm')?.value?.trim();
      if (formData) body = interpolateEnv(formData);
    }
  }

  // ── Pre-request script with full pm context ──
  const preScript = document.getElementById('apiPreScript')?.value?.trim();
  if (preScript) {
    const pm = _buildPmContext(null, domain);
    try { new Function('pm', 'headers', 'body', preScript)(pm, headers, body); }
    catch (e) { console.warn('Pre-request script error:', e); }
  }

  const startTime = performance.now();
  const isExternal = _isExternalUrl(url);

  try {
    // ── External URLs: use backend proxy to avoid CORS issues ──
    if (isExternal) {
      let proxyData;
      try {
        proxyData = await _sendViaProxy(url, apiMethod, headers, body, startTime);
      } catch (proxyErr) {
        toast('Proxy unavailable. Trying direct request…', 'inf');
        try {
          const directRes = await fetch(url, {
            method: apiMethod, headers, body: body || undefined, mode: 'cors', credentials: 'omit',
          });
          const elapsed = performance.now() - startTime;
          const resHeaders = {};
          directRes.headers.forEach((v, k) => { resHeaders[k] = v; });
          let resBody;
          const ct = directRes.headers.get('content-type') || '';
          resBody = ct.includes('json') ? await directRes.json() : await directRes.text();
          const result = { status: directRes.status, statusText: directRes.statusText, headers: resHeaders, body: resBody, size: JSON.stringify(resBody).length, time: Math.round(elapsed), url, method: apiMethod };
          _processCookiesFromResponse(result, domain);
          showApiResponse(result, elapsed, url, false);
          const testScript = document.getElementById('apiTestScript')?.value?.trim();
          if (testScript) runApiTests(testScript, result);
          _saveHistory(urlRaw);
          return;
        } catch (directErr) {
          throw new Error(`Both proxy and direct request failed.\nProxy: ${proxyErr.message}\nDirect: ${directErr.message}`);
        }
      }
      // Process Set-Cookie from proxy response
      if (proxyData.set_cookies) {
        proxyData.set_cookies.forEach(sc => parseSetCookieHeader(sc, domain));
      }
      _processCookiesFromResponse(proxyData, domain);
      showApiResponse(proxyData, performance.now() - startTime, url, true);
      const testScript = document.getElementById('apiTestScript')?.value?.trim();
      if (testScript) runApiTests(testScript, proxyData);
      _saveHistory(urlRaw);
      renderCookieJar();
      return;
    }

    // ── Same-origin URLs: direct fetch ──
    const response = await fetch(url, { method: apiMethod, headers, body: body || undefined });
    const elapsed = performance.now() - startTime;
    const resHeaders = {};
    response.headers.forEach((v, k) => { resHeaders[k] = v; });
    let resBody;
    const ct = response.headers.get('content-type') || '';
    resBody = ct.includes('json') ? await response.json() : await response.text();
    const result = { status: response.status, statusText: response.statusText, headers: resHeaders, body: resBody, size: JSON.stringify(resBody).length, time: Math.round(elapsed), url, method: apiMethod };

    _processCookiesFromResponse(result, domain);
    showApiResponse(result, elapsed, url, false);

    const testScript = document.getElementById('apiTestScript')?.value?.trim();
    if (testScript) runApiTests(testScript, result);

  } catch (e) {
    if (loading) loading.classList.add('hidden');
    if (output) { output.classList.remove('hidden'); }
    document.getElementById('apiResBody').innerHTML = `<div class="api-error">❌ Request Failed<br><span>${esc(e.message)}</span></div>`;
    document.getElementById('apiResStatus').innerHTML = `<span class="api-status-badge st-err">ERROR</span>`;
    document.getElementById('apiResTime').textContent = '';
    document.getElementById('apiResSize').textContent = '';
  }

  _saveHistory(urlRaw);
  renderCookieJar();
}

// Extract Set-Cookie from response headers (for same-origin / direct requests)
function _processCookiesFromResponse(result, domain) {
  if (!result.headers) return;
  for (const [k, v] of Object.entries(result.headers)) {
    if (k.toLowerCase() === 'set-cookie') {
      // Could be a single value or comma-separated (rare)
      parseSetCookieHeader(v, domain);
    }
  }
}

function _saveHistory(urlRaw) {
  apiHistory.unshift({
    method: apiMethod, url: urlRaw, time: new Date().toISOString(),
    status: lastApiResponse?.status || 0,
  });
  if (apiHistory.length > 100) apiHistory = apiHistory.slice(0, 100);
  localStorage.setItem('qaf-api-history', JSON.stringify(apiHistory));
  renderApiHistory();
}

function showApiResponse(result, elapsed, url, isProxy) {
  lastApiResponse = result;
  const loading = document.getElementById('apiResLoading');
  const output = document.getElementById('apiResOutput');
  if (loading) loading.classList.add('hidden');
  if (output) output.classList.remove('hidden');

  const genBtn = document.getElementById('apiGenBtn');
  if (genBtn) genBtn.style.display = 'inline-flex';

  // Status badge
  const sc = result.status;
  const scCls = sc >= 200 && sc < 300 ? 'st-ok' : sc >= 300 && sc < 400 ? 'st-warn' : 'st-err';
  document.getElementById('apiResStatus').innerHTML = `<span class="api-status-badge ${scCls}">${sc} ${result.statusText || ''}</span>${isProxy ? '<span class="api-proxy-tag">PROXY</span>' : ''}`;
  document.getElementById('apiResTime').textContent = `${Math.round(elapsed)} ms`;

  const sizeBytes = result.size || 0;
  document.getElementById('apiResSize').textContent = sizeBytes > 1024 ? `${(sizeBytes / 1024).toFixed(1)} KB` : `${sizeBytes} B`;

  // Body
  const bodyEl = document.getElementById('apiResBody');
  if (typeof result.body === 'object') {
    bodyEl.innerHTML = `<pre class="api-json">${syntaxHighlight(JSON.stringify(result.body, null, 2))}</pre>`;
  } else {
    bodyEl.innerHTML = `<pre class="api-raw">${esc(String(result.body))}</pre>`;
  }

  // Headers
  const headEl = document.getElementById('apiResHeaders');
  if (result.headers && typeof result.headers === 'object') {
    headEl.innerHTML = Object.entries(result.headers).map(([k, v]) =>
      `<div class="api-res-hdr"><span class="api-res-hdr-k">${esc(k)}</span><span class="api-res-hdr-v">${esc(v)}</span></div>`
    ).join('');
  } else {
    headEl.innerHTML = '<div class="api-empty-hint">No headers available</div>';
  }

  switchApiResTab(document.querySelector('.api-res-tab.active') || document.querySelector('.api-res-tab'), 'body');
}

// ═══════ JSON SYNTAX HIGHLIGHT ═══════
function syntaxHighlight(json) {
  return json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/("(\\u[\da-fA-F]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, m => {
      let cls = 'api-hl-num';
      if (/^"/.test(m)) { cls = /:$/.test(m) ? 'api-hl-key' : 'api-hl-str'; }
      else if (/true|false/.test(m)) cls = 'api-hl-bool';
      else if (/null/.test(m)) cls = 'api-hl-null';
      return `<span class="${cls}">${m}</span>`;
    });
}

// ═══════ PM CONTEXT BUILDER (shared by pre-request & test scripts) ═══════
function _buildPmContext(response, domain) {
  const pm = {
    environment: {
      get: (key) => apiActiveEnv?.vars?.[key] || null,
      set: (key, value) => {
        if (!apiActiveEnv) return;
        apiActiveEnv.vars[key] = String(value);
        saveEnvs();
        renderApiEnvVars();
      },
      unset: (key) => {
        if (!apiActiveEnv) return;
        delete apiActiveEnv.vars[key];
        saveEnvs();
        renderApiEnvVars();
      },
      toObject: () => ({ ...(apiActiveEnv?.vars || {}) }),
    },
    cookies: {
      get: (name) => { const c = getCookiesForDomain(domain); return c[name]?.value || null; },
      set: (name, value) => { setCookieForDomain(domain, name, value, {}); },
      clear: () => { clearCookiesForDomain(domain); },
      has: (name) => { const c = getCookiesForDomain(domain); return !!c[name]; },
      toObject: () => {
        const c = getCookiesForDomain(domain); const out = {};
        for (const [k, v] of Object.entries(c)) out[k] = v.value;
        return out;
      },
    },
    test: (name, fn) => {
      // Only used in test scripts; overridden in runApiTests
    },
    expect: (val) => ({
      to: {
        equal: (exp) => { if (val !== exp) throw new Error(`Expected ${exp}, got ${val}`); },
        include: (exp) => { if (!String(val).includes(exp)) throw new Error(`Expected to include "${exp}"`); },
        be: { above: (n) => { if (val <= n) throw new Error(`Expected > ${n}, got ${val}`); } },
        have: {
          status: (s) => { if (response?.status !== s) throw new Error(`Expected status ${s}, got ${response?.status}`); },
          property: (p) => { if (!(p in val)) throw new Error(`Missing property "${p}"`); },
        }
      }
    }),
  };
  if (response) {
    pm.response = {
      status: response.status,
      body: response.body,
      headers: response.headers,
      json: () => typeof response.body === 'object' ? response.body : JSON.parse(response.body),
    };
  }
  return pm;
}

// ═══════ TEST SCRIPTS ═══════
function runApiTests(script, response) {
  const urlRaw = document.getElementById('apiUrl')?.value?.trim() || '';
  const domain = _getDomain(interpolateEnv(urlRaw));
  const testResults = [];
  const pm = _buildPmContext(response, domain);

  // Override test() to collect results
  pm.test = (name, fn) => {
    try { fn(); testResults.push({ name, pass: true }); }
    catch (e) { testResults.push({ name, pass: false, error: e.message }); }
  };

  try { new Function('pm', script)(pm); }
  catch (e) { testResults.push({ name: 'Script Error', pass: false, error: e.message }); }

  const el = document.getElementById('apiTestResults');
  if (el) {
    el.innerHTML = testResults.map(t => `
      <div class="api-test-row ${t.pass ? 'pass' : 'fail'}">
        <span class="api-test-icon">${t.pass ? '✓' : '✗'}</span>
        <span class="api-test-name">${esc(t.name)}</span>
        ${t.error ? `<span class="api-test-err">${esc(t.error)}</span>` : ''}
      </div>
    `).join('');
    el.classList.remove('hidden');
  }
  renderCookieJar();
}

// ═══════ COLLECTIONS ═══════
function saveToCollection() {
  const url = document.getElementById('apiUrl')?.value?.trim();
  if (!url) return toast('Enter a URL first', 'err');

  const name = prompt('Request name:', `${apiMethod} ${url.split('?')[0].split('/').pop() || 'request'}`);
  if (!name) return;

  let colName = 'Default';
  if (apiCollections.length > 0) {
    colName = prompt('Collection name:', apiCollections[0]?.name || 'Default') || 'Default';
  }

  let col = apiCollections.find(c => c.name === colName);
  if (!col) {
    col = { name: colName, requests: [] };
    apiCollections.push(col);
  }

  col.requests.push({
    name, method: apiMethod, url,
    headers: [...apiHeaders],
    params: [...apiParams],
    bodyType: apiBodyType,
    body: document.getElementById('apiBodyJson')?.value || '',
    authType: apiAuthType,
  });

  localStorage.setItem('qaf-api-collections', JSON.stringify(apiCollections));
  renderApiCollections();
  toast(`Saved "${name}" to ${colName}`, 'ok');
}

function renderApiCollections() {
  const el = document.getElementById('apiCollectionList');
  if (!el) return;
  if (!apiCollections.length) {
    el.innerHTML = '<div class="api-empty-hint">No saved collections</div>';
    return;
  }
  el.innerHTML = apiCollections.map((col, ci) => `
    <div class="api-col-group">
      <div class="api-col-hdr" onclick="this.nextElementSibling.classList.toggle('open')">
        <span class="api-col-icon">📁</span>
        <span class="api-col-name">${esc(col.name)}</span>
        <span class="api-col-count">${col.requests.length}</span>
        <button class="kv-del" onclick="event.stopPropagation();apiCollections.splice(${ci},1);localStorage.setItem('qaf-api-collections',JSON.stringify(apiCollections));renderApiCollections()">✕</button>
      </div>
      <div class="api-col-body">
        ${col.requests.map((r, ri) => `
          <div class="api-col-req" onclick="loadSavedRequest(${ci},${ri})">
            <span class="api-method-tag m-${r.method.toLowerCase()}">${r.method}</span>
            <span class="api-col-req-name">${esc(r.name)}</span>
            <button class="kv-del" onclick="event.stopPropagation();apiCollections[${ci}].requests.splice(${ri},1);localStorage.setItem('qaf-api-collections',JSON.stringify(apiCollections));renderApiCollections()">✕</button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function loadSavedRequest(ci, ri) {
  const r = apiCollections[ci]?.requests[ri];
  if (!r) return;
  document.getElementById('apiUrl').value = r.url || '';
  apiMethod = r.method || 'GET';
  document.querySelectorAll('.api-method-btn').forEach(b => b.classList.toggle('active', b.dataset.method === apiMethod));
  apiHeaders = (r.headers || []).map(h => ({ ...h }));
  apiParams = (r.params || []).map(p => ({ ...p }));
  apiBodyType = r.bodyType || 'json';
  if (r.body && document.getElementById('apiBodyJson')) document.getElementById('apiBodyJson').value = r.body;
  apiAuthType = r.authType || 'none';
  renderApiHeaders();
  renderApiParams();
  setApiBodyType(document.querySelector(`[data-bodytype="${apiBodyType}"]`) || document.querySelector('[data-bodytype="json"]'), apiBodyType);
  toast(`Loaded: ${r.name}`, 'ok');
}

function exportCollections() {
  if (!apiCollections.length) return toast('No collections to export', 'err');
  const blob = new Blob([JSON.stringify(apiCollections, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `qaforge-api-collections-${Date.now()}.json`;
  a.click();
  toast('Collections exported', 'ok');
}

function importCollections() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (Array.isArray(data)) {
        apiCollections = [...apiCollections, ...data];
      } else if (data.info && data.item) {
        // Postman collection format
        const col = { name: data.info.name || 'Imported', requests: [] };
        data.item.forEach(item => {
          col.requests.push({
            name: item.name,
            method: item.request?.method || 'GET',
            url: typeof item.request?.url === 'string' ? item.request.url : item.request?.url?.raw || '',
            headers: (item.request?.header || []).map(h => ({ key: h.key, value: h.value, enabled: !h.disabled })),
            params: [],
            bodyType: 'json',
            body: item.request?.body?.raw || '',
            authType: 'none',
          });
        });
        apiCollections.push(col);
      }
      localStorage.setItem('qaf-api-collections', JSON.stringify(apiCollections));
      renderApiCollections();
      toast(`Imported ${apiCollections.length} collections`, 'ok');
    } catch (err) {
      toast('Invalid collection file', 'err');
    }
  };
  input.click();
}

// ═══════ HISTORY ═══════
function renderApiHistory() {
  const el = document.getElementById('apiHistoryList');
  if (!el) return;
  if (!apiHistory.length) {
    el.innerHTML = '<div class="api-empty-hint">No request history</div>';
    return;
  }
  el.innerHTML = apiHistory.slice(0, 30).map((h, i) => `
    <div class="api-hist-row" onclick="document.getElementById('apiUrl').value='${esc(h.url)}';setApiMethodByName('${h.method}')">
      <span class="api-method-tag m-${h.method.toLowerCase()}">${h.method}</span>
      <span class="api-hist-url">${esc(h.url.length > 50 ? h.url.slice(0, 50) + '…' : h.url)}</span>
      <span class="api-hist-status ${h.status >= 200 && h.status < 300 ? 'st-ok' : h.status ? 'st-err' : ''}">${h.status || '—'}</span>
      <span class="api-hist-time">${timeAgo(h.time)}</span>
    </div>
  `).join('');
}

function clearApiHistory() {
  apiHistory = [];
  localStorage.setItem('qaf-api-history', JSON.stringify(apiHistory));
  renderApiHistory();
  toast('History cleared', 'inf');
}

function setApiMethodByName(method) {
  apiMethod = method;
  document.querySelectorAll('.api-method-btn').forEach(b => b.classList.toggle('active', b.dataset.method === method));
}

// ═══════ TAB SWITCHING ═══════
function switchApiReqTab(btn, tab) {
  document.querySelectorAll('.api-req-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.api-req-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`apiPane-${tab}`)?.classList.add('active');
}

function switchApiResTab(btn, tab) {
  if (!btn) return;
  document.querySelectorAll('.api-res-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.api-res-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`apiResPane-${tab}`)?.classList.add('active');
}

function setApiBodyType(btn, type) {
  if (!btn) return;
  apiBodyType = type;
  document.querySelectorAll('.api-body-type').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.api-body-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`apiBody-${type}`)?.classList.add('active');
}

function setApiAuth(btn, type) {
  apiAuthType = type;
  document.querySelectorAll('.api-auth-type').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.api-auth-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`apiAuth-${type}`)?.classList.add('active');
}

function switchApiSideTab(btn, tab) {
  document.querySelectorAll('.api-side-tab').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.api-side-pane').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`apiSide-${tab}`)?.classList.add('active');
}

// ═══════ HELPERS ═══════
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60000) return 'now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

// ═══════ GENERATE TESTS FROM API ═══════
async function generateTestsFromApi() {
  if (!lastApiResponse) return toast('No response to analyze', 'err');

  const btn = document.getElementById('apiGenBtn');
  const oldText = btn.innerHTML;
  btn.innerHTML = '<span class="load-spin"></span> GENERATING…';
  btn.disabled = true;

  try {
    const urlRaw = document.getElementById('apiUrl')?.value?.trim();
    const url = interpolateEnv(urlRaw);
    
    // Build request headers
    const reqHeaders = {};
    apiHeaders.filter(h => h.enabled && h.key).forEach(h => {
      reqHeaders[interpolateEnv(h.key)] = interpolateEnv(h.value);
    });

    // Build request body
    let reqBody = undefined;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(apiMethod)) {
      if (apiBodyType === 'json') reqBody = document.getElementById('apiBodyJson')?.value;
      else if (apiBodyType === 'raw') reqBody = document.getElementById('apiBodyRaw')?.value;
      else if (apiBodyType === 'form') reqBody = document.getElementById('apiBodyForm')?.value;
    }

    const payload = {
      url: url,
      method: apiMethod,
      request_headers: reqHeaders,
      request_body: reqBody || null,
      response_status: lastApiResponse.status,
      response_headers: lastApiResponse.headers || {},
      response_body: lastApiResponse.body || null,
      focus_areas: ["api", "security", "negative", "functional"],
      depth: "standard"
    };

    const res = await fetch('/api/generate/api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Generation failed');
    const suite = await res.json();

    toast('Tests generated successfully!', 'ok');
    
    // Switch to Generate page and show the result
    nav('generate');
    if (typeof showSuite === 'function') {
      showSuite(suite);
    } else {
      // Fallback: if showSuite is not global, just alert the user
      console.log('Generated Suite:', suite);
      toast('Suite generated. Check console for details.', 'inf');
    }

  } catch (err) {
    console.error(err);
    toast('Error generating tests: ' + err.message, 'err');
  } finally {
    btn.innerHTML = oldText;
    btn.disabled = false;
  }
}

function toggleApiSidebar() {
  const sidebar = document.querySelector('.api-sidebar');
  const overlay = document.getElementById('apiSideOverlay');
  if (sidebar) {
    const isOpen = sidebar.classList.toggle('mobile-open');
    if (overlay) overlay.classList.toggle('active', isOpen);
    if (isOpen && window.innerWidth <= 1024) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }
}

// ═══════ COOKIE JAR UI ═══════
function renderCookieJar() {
  const el = document.getElementById('apiCookieList');
  if (!el) return;
  const domains = Object.keys(cookieJar);
  if (!domains.length) {
    el.innerHTML = '<div class="api-empty-hint">No cookies stored. Cookies will appear here after requests.</div>';
    return;
  }
  el.innerHTML = domains.map(domain => {
    const cookies = cookieJar[domain];
    const entries = Object.entries(cookies);
    return `<div class="api-col-group">
      <div class="api-col-hdr" onclick="this.nextElementSibling.classList.toggle('open')">
        <span class="api-col-icon">🍪</span>
        <span class="api-col-name">${esc(domain)}</span>
        <span class="api-col-count">${entries.length}</span>
        <button class="kv-del" onclick="event.stopPropagation();clearCookiesForDomain('${esc(domain)}');renderCookieJar()">✕</button>
      </div>
      <div class="api-col-body open">${entries.map(([name, c]) => `
        <div class="api-cookie-row">
          <div class="api-cookie-info">
            <span class="api-cookie-name">${esc(name)}</span>
            <input class="api-cookie-input" value="${esc(c.value)}" onchange="updateCookieValue('${esc(domain)}', '${esc(name)}', this.value)" spellcheck="false" title="${esc(c.value)}" placeholder="Cookie value" />
            <span class="api-cookie-attrs">${c.httpOnly ? '🔒HttpOnly ' : ''}${c.secure ? '🛡Secure ' : ''}${c.sameSite ? 'SameSite=' + c.sameSite : ''}</span>
          </div>
          <button class="kv-del" onclick="event.stopPropagation();deleteCookieForDomain('${esc(domain)}','${esc(name)}');renderCookieJar()">✕</button>
        </div>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function addManualCookie() {
  const domain = prompt('Domain (e.g. api.example.com):');
  if (!domain) return;
  const name = prompt('Cookie name:');
  if (!name) return;
  const value = prompt('Cookie value:');
  if (value === null) return;
  setCookieForDomain(domain, name, value, {});
  renderCookieJar();
  toast(`Cookie "${name}" added for ${domain}`, 'ok');
}

function clearAllCookies() {
  if (!confirm('Clear ALL cookies from the jar?')) return;
  cookieJar = {};
  saveCookieJar();
  renderCookieJar();
  toast('All cookies cleared', 'inf');
}

// ═══════ XSRF CONFIG UI ═══════
function renderXsrfConfig() {
  const el = document.getElementById('apiXsrfConfig');
  if (!el) return;
  el.innerHTML = `
    <div class="api-xsrf-toggle">
      <label class="kv-chk"><input type="checkbox" ${xsrfConfig.enabled ? 'checked' : ''} onchange="xsrfConfig.enabled=this.checked;saveXsrfConfig()"/></label>
      <span class="api-xsrf-label">Auto-attach XSRF token</span>
    </div>
    <div class="api-xsrf-fields" style="${xsrfConfig.enabled ? '' : 'opacity:0.4;pointer-events:none'}">
      <div class="kv-row">
        <span class="api-xsrf-hint">Cookie name:</span>
        <input class="kv-key" value="${esc(xsrfConfig.cookieName)}" oninput="xsrfConfig.cookieName=this.value;saveXsrfConfig()" placeholder="XSRF-TOKEN"/>
      </div>
      <div class="kv-row">
        <span class="api-xsrf-hint">Header name:</span>
        <input class="kv-key" value="${esc(xsrfConfig.headerName)}" oninput="xsrfConfig.headerName=this.value;saveXsrfConfig()" placeholder="X-XSRF-TOKEN"/>
      </div>
    </div>
  `;
}
