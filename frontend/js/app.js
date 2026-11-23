/**
 * QAForge App JS v5.1
 * KEY FIXES:
 * 1. Focus areas FILTER the AI prompt — only selected categories are generated
 * 2. Real automation scripts (Playwright/Selenium/Cypress/Pytest/Jest/Postman)
 * 3. Test case format add/edit/customize with modal
 * 4. Config tab sidebar layout
 */

// ═══════ STATE ═══════
let curModel = 'flash';
let curSuiteId = null;
let selExecId = null;
let autoSelId = null;
let lastRunId = null;
let curScanRes = null;
let curScanId = null;
let pollTimer = null;
let currentView = 'columns';
let allTests = [];
let sortCol = 'id';
let sortDir = 1;
let hiddenCols = new Set();
let curFw = 'playwright';
let curLang = 'javascript';
let curFormat = 'detailed';
let curDepth = 'quick';
let curScanDepth = 'quick';
let generatedFiles = {};
let activeCodeFile = 'main';
let formatTemplates = [];
let editingFmtIdx = null;
let genMode = 'single'; // single | swarm

// Field config: which fields are active
let activeFields = {
  id: true, name: true, scenario: true, category: true, priority: true, severity: true,
  preconditions: true, test_input: true, steps: true, expected_result: true,
  actual_result: true, status: true, browser: true, screen: true, created_by: true,
  tags: false
};

// ═══════ INIT ═══════
document.addEventListener('DOMContentLoaded', () => {
  loadSavedPrefs();
  checkHealth();
  loadStats();
  setupChips();
  setupDrag();
  setupPrioHints();
  initFormatTemplates();
  renderFieldPills();
  updateFocusNote();
  updateLangOpts();

  // Vercel-specific UI Hiding
  const isVercel = window.location.hostname.endsWith('vercel.app') || window.location.hostname.includes('vercel');
  if (isVercel) {
    // Hide navbar buttons
    document.querySelectorAll('.ntab[data-p="execute"], .ntab[data-p="automate"], .ntab[data-p="reports"]').forEach(el => el.style.display = 'none');
    // Hide buttons in generate page (the output panels)
    document.querySelectorAll('.bsm-a, .bsm-auto').forEach(el => el.style.display = 'none');
    // Hide automate button on landing/home page
    document.querySelectorAll('button[onclick="nav(\'automate\')"]').forEach(el => el.style.display = 'none');
    // Hide automation config tab in Settings sidebar
    document.querySelectorAll('.csb-item[data-tab="automation"]').forEach(el => el.style.display = 'none');
    // Hide Step 4 in setup guide
    document.querySelectorAll('.sg').forEach(el => {
      if (el.textContent.includes('Generate & Automate')) {
        el.style.display = 'none';
      }
    });
  }

  handleHashNavigation();
  window.addEventListener('hashchange', handleHashNavigation);
  setInterval(checkHealth, 20000);
});

// ═══════ PREFS ═══════
function loadSavedPrefs() {
  const theme = localStorage.getItem('qaf-theme') || 'ice';
  const font = localStorage.getItem('qaf-font') || 'jetbrains';
  const density = localStorage.getItem('qaf-density') || 'normal';
  applyTheme(theme); applyFont(font); applyDensity(density);
  document.querySelectorAll('.theme-card').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  document.querySelectorAll('.font-card').forEach(b => b.classList.toggle('active', b.dataset.font === font));
  document.querySelectorAll('.den-btn').forEach(b => b.classList.toggle('active', b.dataset.d === density));
  const saved = localStorage.getItem('qaf-formats');
  if (saved) formatTemplates = JSON.parse(saved);
}

// ═══════ THEME / FONT / DENSITY ═══════
function setTheme(btn, theme) {
  document.querySelectorAll('.theme-card').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); applyTheme(theme);
  localStorage.setItem('qaf-theme', theme);
}
function applyTheme(t) { document.body.setAttribute('data-theme', t); }

function setFont(btn, font) {
  document.querySelectorAll('.font-card').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); applyFont(font);
  localStorage.setItem('qaf-font', font);
}
function applyFont(f) { document.body.setAttribute('data-font', f); }

function setDensity(btn, d) {
  document.querySelectorAll('.den-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); applyDensity(d);
  localStorage.setItem('qaf-density', d);
}
function applyDensity(d) { document.body.setAttribute('data-density', d); }

function setDepth(btn) {
  const row = btn.closest('.depth-row');
  if (row) {
    row.querySelectorAll('.dep').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  }
  const val = btn.dataset.d;
  if (btn.closest('#p-bugscan')) {
    curScanDepth = val;
  } else {
    curDepth = val;
  }
}

// ═══════ NAV ═══════
function nav(page) {
  const isVercel = window.location.hostname.endsWith('vercel.app') || window.location.hostname.includes('vercel');
  if (isVercel && ['execute', 'automate', 'reports'].includes(page)) {
    nav('generate');
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.ntab').forEach(b => b.classList.remove('active'));
  document.getElementById(`p-${page}`)?.classList.add('active');
  document.querySelector(`[data-p="${page}"]`)?.classList.add('active');
  window.scrollTo({ top: 0, behavior: 'instant' });

  if (window.location.hash !== `#${page}`) {
    history.pushState(null, null, `#${page}`);
  }

  if (page === 'execute') loadSuiteList();
  if (page === 'automate') { loadAutoSuiteList(); updateLangOpts(); }
  if (page === 'reports') loadReportList();
  if (page === 'apitest') { if (typeof initApiTester === 'function') initApiTester(); }
  if (page === 'perftest') { if (typeof initPerfTester === 'function') initPerfTester(); }
  if (page === 'seoaudit') { if (typeof initSeoAudit === 'function') initSeoAudit(); }
  if (page === 'settings') { loadCfgUI(); renderFmtTemplateList(); }
}

function handleHashNavigation() {
  const hash = window.location.hash.slice(1);
  if (hash) {
    let validPages = ['home', 'generate', 'bugscan', 'bugformat', 'seoaudit', 'apitest', 'perftest', 'execute', 'automate', 'reports', 'settings'];
    const isVercel = window.location.hostname.endsWith('vercel.app') || window.location.hostname.includes('vercel');
    if (isVercel) {
      validPages = validPages.filter(p => !['execute', 'automate', 'reports'].includes(p));
    }
    if (validPages.includes(hash)) {
      nav(hash);
    } else if (isVercel && ['execute', 'automate', 'reports'].includes(hash)) {
      nav('generate');
    }
  }
}

// Config sidebar tab switcher
function switchCfgTab(btn, tab) {
  document.querySelectorAll('.csb-item').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.cfg-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`cfg-${tab}`)?.classList.add('active');
}

// ═══════ HEALTH ═══════
async function checkHealth() {
  try {
    const d = await get('/api/health');
    const dot = document.getElementById('apiDot');
    const lbl = document.getElementById('apiLbl');
    dot.className = d.api_connected ? 'api-dot on' : 'api-dot';
    lbl.textContent = d.api_connected ? `${d.keys_configured} KEY${d.keys_configured !== 1 ? 'S' : ''} · ONLINE` : 'NO KEY';
    renderModelChain(d.model_status, 'mcpList');
    setText('hs6', Object.values(d.model_status || {}).filter(m => m.has_key && !m.quota_exhausted).length);
  } catch {
    document.getElementById('apiDot').className = 'api-dot';
    document.getElementById('apiLbl').textContent = 'OFFLINE';
  }
}
function renderModelChain(status, elId) {
  const el = document.getElementById(elId); if (!el || !status) return;
  const colors = { flash: 'var(--ac)', pro: 'var(--ac4)', flash15: 'var(--ac2)', flash_exp: 'var(--hi)' };
  el.innerHTML = Object.entries(status).map(([k, m]) => {
    const cls = !m.has_key ? 'mc-dot' : m.quota_exhausted ? 'mc-dot mc-err' : 'mc-dot mc-ok';
    const sc = !m.has_key ? 'nokey' : m.quota_exhausted ? 'quota' : 'ok';
    const st = !m.has_key ? 'no key' : m.quota_exhausted ? 'quota hit' : 'ready';
    return `<div class="mc-row">
      <span class="${cls}" style="${m.has_key && !m.quota_exhausted ? `background:${colors[k]};box-shadow:0 0 6px ${colors[k]}` : ''}"></span>
      <span class="mc-name">Slot ${m.slot} — ${m.name}</span>
      <span class="mc-status ${sc}">${st}</span>
    </div>`;
  }).join('');
}

async function loadStats() {
  try {
    const [suites, results, scans] = await Promise.all([
      get('/api/suites'), get('/api/results'), get('/api/scans').catch(() => [])
    ]);
    const total = suites.reduce((s, x) => s + (x.tests?.length || 0), 0);
    const done = results.filter(r => r.status === 'completed');
    const rate = done.length ? Math.round(done.reduce((s, r) => s + (r.summary?.pass_rate || 0), 0) / done.length) : null;
    setText('hs1', suites.length); setText('hs2', total); setText('hs3', results.length);
    setText('hs4', scans.length); setText('hs5', rate != null ? `${rate}%` : '—');
  } catch { }
}

// ═══════ CHIPS ═══════
function setupChips() {
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => c.classList.toggle('on')));
}
function getChips(id) {
  return [...document.querySelectorAll(`#${id} .chip.on`)].map(c => c.dataset.v);
}

// ═══════ FOCUS AREAS — KEY FEATURE ═══════
function toggleFocus(card) {
  card.classList.toggle('active');
  updateFocusNote();
}
function selectAllFocus() {
  document.querySelectorAll('.fc').forEach(c => c.classList.add('active'));
  updateFocusNote();
}
function clearAllFocus() {
  document.querySelectorAll('.fc').forEach(c => c.classList.remove('active'));
  updateFocusNote();
}
function getFocusAreas() {
  if (genMode === 'swarm') {
    return [...document.querySelectorAll('#swarmBlock .sc-agt.active')].map(c => c.dataset.v);
  }
  return [...document.querySelectorAll('#focusBlock .fc.active')].map(c => c.dataset.v);
}
function updateFocusNote() {
  const sel = getFocusAreas();
  const note = document.getElementById('focusNote');
  if (!note) return;
  if (genMode === 'swarm') {
    note.textContent = sel.length ? `${sel.length} of 5 agents selected for concurrent swarm generation` : '⚠ Select at least one Swarm Agent';
    note.style.color = sel.length ? '' : 'var(--cr)';
    return;
  }
  if (sel.length === 0) {
    note.textContent = '⚠ No focus areas selected — please select at least one';
    note.style.color = 'var(--cr)';
  } else {
    note.textContent = `${sel.length} of 10 selected — AI will generate ONLY: ${sel.join(', ')}`;
    note.style.color = '';
  }
}
function setGenMode(el) {
  document.querySelectorAll('[data-mode]').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  genMode = el.dataset.mode;
  document.getElementById('focusBlock').style.display = genMode === 'single' ? '' : 'none';
  document.getElementById('swarmBlock').style.display = genMode === 'swarm' ? '' : 'none';
  document.getElementById('modelBlock').style.display = genMode === 'single' ? '' : 'none';
  updateFocusNote();
}

// ═══════ BUILD FOCUS-FILTERED PROMPT INSTRUCTION ═══════
function buildFocusInstruction() {
  const areas = getFocusAreas();
  if (!areas.length) return '';
  const labels = {
    ui: 'UI/UX (layout, visual design, interactions, responsiveness)',
    positive_testing: 'Happy Path (standard user flows, successful scenarios)',
    negative_testing: 'Negative (invalid inputs,negative logic and inputs, boundary values, error states, edge cases,negative scenarios)',
    functionality: 'Functionality (core features, business logic, CRUD operations,website functionality)',
    security: 'Security (authentication, authorization, XSS, injection, CSRF)',
    performance: 'Performance (load time, stress, concurrent users, memory)',
    accessibility: 'Accessibility (WCAG 2.1, ARIA, keyboard navigation, screen readers)',
    api: 'API/Backend (endpoints, HTTP methods, request/response, status codes)',
    regression: 'Regression (existing feature validation after changes)',
    integration: 'Integration (cross-system flows, third-party services, data sync)'
  };
  const selected = areas.map(a => labels[a] || a).join('\n  - ');
  return `\n\nIMPORTANT — ONLY generate test cases for these SPECIFIC focus areas (do NOT include other categories):\n  - ${selected}\n\nEach test case's "category" field MUST match one of these focus areas: ${areas.join(', ')}. Reject all other categories.`;
}

// ═══════ TEST FORMAT ═══════
function setFormat(el) {
  document.querySelectorAll('.fmt-tab').forEach(o => o.classList.remove('active'));
  el.classList.add('active');
  curFormat = el.dataset.fmt;
}
function getFormatConfig() {
  return { format: curFormat, fields: Object.keys(activeFields).filter(k => activeFields[k]) };
}

function renderFieldPills() {
  const el = document.getElementById('fieldPills'); if (!el) return;
  const allFields = ['id', 'name', 'description', 'priority', 'category', 'steps', 'expected_result', 'preconditions', 'tags', 'automation_steps'];
  el.innerHTML = allFields.map(f => `
    <span class="pill ${activeFields[f] ? 'on' : ''}" onclick="toggleFieldPill(this,'${f}')">${f.replace(/_/g, ' ')}</span>
  `).join('');
}
function toggleFieldPill(el, field) {
  el.classList.toggle('on');
  activeFields[field] = el.classList.contains('on');
}

// ═══════ FORMAT EDITOR MODAL ═══════
function initFormatTemplates() {
  if (!formatTemplates.length) {
    formatTemplates = [
      { name: 'Detailed (Default)', base: 'detailed', fields: ['id', 'name', 'description', 'priority', 'category', 'steps', 'expected_result'], instructions: '' },
      { name: 'BDD / Gherkin', base: 'bdd', fields: ['id', 'name', 'priority', 'steps', 'expected_result', 'tags'], instructions: 'Format steps as Given/When/Then Gherkin syntax.' },
      { name: 'Exploratory Charter', base: 'exploratory', fields: ['name', 'description', 'priority', 'steps'], instructions: 'Write as exploratory test charters with mission statement.' },
      { name: 'Quick Checklist', base: 'checklist', fields: ['id', 'name', 'priority'], instructions: 'Generate short checklist items, no detailed steps.' }
    ];
    saveFormatTemplates();
  }
}
function saveFormatTemplates() {
  localStorage.setItem('qaf-formats', JSON.stringify(formatTemplates));
}
function renderFmtTemplateList() {
  const el = document.getElementById('formatTemplateList'); if (!el) return;
  el.innerHTML = formatTemplates.map((t, i) => `
    <div class="fmt-tmpl">
      <div>
        <div class="fmt-tmpl-name">${t.name}</div>
        <div class="fmt-tmpl-base">${t.base} · ${t.fields.length} fields</div>
      </div>
      <div class="fmt-tmpl-actions">
        <button class="tiny-btn" onclick="openFormatEditor(${i})">✏ EDIT</button>
        <button class="tiny-btn" style="color:var(--cr)" onclick="deleteFmt(${i})">✕</button>
      </div>
    </div>
  `).join('');
}
function openFormatEditor(idx = null, isNew = false) {
  editingFmtIdx = idx;
  const modal = document.getElementById('fmtModal');
  modal.classList.remove('hidden');
  const t = (idx !== null && !isNew) ? formatTemplates[idx] : { name: '', base: 'detailed', fields: ['id', 'name', 'priority', 'steps', 'expected_result'], instructions: '' };
  document.getElementById('fmtName').value = t.name;
  document.getElementById('fmtBase').value = t.base;
  document.getElementById('fmtInstructions').value = t.instructions || '';
  // Render checkboxes
  const allF = ['id', 'name', 'description', 'priority', 'category', 'steps', 'expected_result', 'preconditions', 'tags', 'automation_steps', 'test_data', 'environment'];
  document.getElementById('fmtFieldList').innerHTML = allF.map(f => `
    <label class="opt-chk">
      <input type="checkbox" data-field="${f}" ${t.fields.includes(f) ? 'checked' : ''} onchange="updateFmtPreview()"/>
      <span>${f.replace(/_/g, ' ')}</span>
    </label>
  `).join('');
  updateFmtPreview();
}
function updateFmtPreview() {
  const base = document.getElementById('fmtBase')?.value || 'detailed';
  const checked = [...document.querySelectorAll('#fmtFieldList input:checked')].map(i => i.dataset.field);
  const samples = {
    id: 'TC-001', name: 'Login with valid credentials', description: 'Verify user can login successfully',
    priority: 'HIGH', category: 'functional', steps: '1. Navigate to login page\n   2. Enter valid email & password\n   3. Click Login',
    expected_result: 'User is redirected to dashboard', preconditions: 'User account exists',
    tags: 'auth, smoke', automation_steps: 'page.fill("#email", user.email)',
    test_data: 'email: test@qa.com, pass: Test123!', environment: 'Staging'
  };
  const bddSample = base === 'bdd' ? `<div class="fp-field"><span class="fp-label">GIVEN</span><span class="fp-val">the user is on the login page</span></div>
<div class="fp-field"><span class="fp-label">WHEN</span><span class="fp-val">they enter valid credentials</span></div>
<div class="fp-field"><span class="fp-label">THEN</span><span class="fp-val">they should be redirected to dashboard</span></div>` : '';
  const preview = document.getElementById('fmtPreview'); if (!preview) return;
  preview.innerHTML = checked.map(f => `
    <div class="fp-field"><span class="fp-label">${f.toUpperCase().replace(/_/g, ' ')}</span><span class="fp-val">${samples[f] || '—'}</span></div>
  `).join('') + bddSample;
}
function closeFmtModal(e) {
  if (e && e.target !== document.getElementById('fmtModal')) return;
  document.getElementById('fmtModal').classList.add('hidden');
}
function saveFmtTemplate() {
  const name = document.getElementById('fmtName').value.trim();
  const base = document.getElementById('fmtBase').value;
  const fields = [...document.querySelectorAll('#fmtFieldList input:checked')].map(i => i.dataset.field);
  const instr = document.getElementById('fmtInstructions').value.trim();
  if (!name) return toast('Enter a format name', 'err');
  if (!fields.length) return toast('Select at least one field', 'err');
  const t = { name, base, fields, instructions: instr };
  if (editingFmtIdx !== null) formatTemplates[editingFmtIdx] = t;
  else formatTemplates.push(t);
  saveFormatTemplates();
  renderFmtTemplateList();
  document.getElementById('fmtModal').classList.add('hidden');
  toast(`Format "${name}" saved`, 'ok');
}
function deleteFmt(idx) {
  formatTemplates.splice(idx, 1);
  saveFormatTemplates();
  renderFmtTemplateList();
  toast('Format deleted', 'inf');
}

// ═══════ RANGE CONFIG ═══════
function applyPreset(btn) {
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const min = parseInt(btn.dataset.min), max = parseInt(btn.dataset.max);
  if (btn.dataset.min === '0') return;
  setRV('min', min); setRV('max', max);
}
function setRV(w, val) {
  val = Math.max(1, Math.min(100, val));
  const C = w.charAt(0).toUpperCase() + w.slice(1);
  document.getElementById(`slider${C}`).value = val;
  document.getElementById(`num${C}`).value = val;
  document.getElementById(`rd${C}`).textContent = val;
  updatePrioHint();
}
function syncRange(w, val) {
  val = Math.max(1, Math.min(100, parseInt(val) || 1));
  if (w === 'min' && val > parseInt(document.getElementById('numMax').value)) setRV('max', val);
  if (w === 'max' && val < parseInt(document.getElementById('numMin').value)) setRV('min', val);
  setRV(w, val);
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('active'));
  document.querySelector('.preset[data-min="0"]')?.classList.add('active');
}
function getRangeConfig() {
  const min = parseInt(document.getElementById('numMin').value) || 5;
  const max = parseInt(document.getElementById('numMax').value) || 10;
  const rc = { min_tests: min, max_tests: max };
  if (document.getElementById('prioDist').checked) {
    const c = parseInt(document.getElementById('prioC').value) || 0;
    const h = parseInt(document.getElementById('prioH').value) || 0;
    const m = parseInt(document.getElementById('prioM').value) || 0;
    const l = parseInt(document.getElementById('prioL').value) || 0;
    if (c) rc.critical_count = c; if (h) rc.high_count = h; if (m) rc.medium_count = m; if (l) rc.low_count = l;
  }
  return rc;
}
function togglePrioDist(cb) { document.getElementById('prioInputs').classList.toggle('hidden', !cb.checked); }
function setupPrioHints() {
  document.querySelectorAll('#prioInputs input').forEach(i => i.addEventListener('input', updatePrioHint));
}
function updatePrioHint() {
  const hint = document.getElementById('piHint'); if (!hint) return;
  const total = ['prioC', 'prioH', 'prioM', 'prioL'].reduce((s, id) => s + (parseInt(document.getElementById(id)?.value) || 0), 0);
  const max = parseInt(document.getElementById('numMax').value) || 10;
  hint.textContent = `Total: ${total} / ${max} target`;
  hint.className = `pi-hint${total > max ? ' warn' : ''}`;
}

// ═══════ MODEL ═══════
function pickModel(btn, key) {
  document.querySelectorAll('.msb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); curModel = key;
}

// ═══════ INPUT TABS ═══════
function stab(tab, btn) {
  document.querySelectorAll('.ibody').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.itab').forEach(b => b.classList.remove('active'));
  document.getElementById(`t-${tab}`)?.classList.add('active');
  btn.classList.add('active');
}

// ═══════ FILE DRAG ═══════
function setupDrag() {
  ['imgZone', 'vidZone', 'docZone'].forEach(id => {
    const z = document.getElementById(id); if (!z) return;
    z.addEventListener('dragover', e => { e.preventDefault(); z.style.borderColor = 'var(--ac)'; }, { passive: false });
    z.addEventListener('dragleave', () => z.style.borderColor = '');
    z.addEventListener('drop', e => {
      e.preventDefault(); z.style.borderColor = '';
      const f = e.dataTransfer.files[0]; if (!f) return;
      const inp = z.querySelector('input[type=file]');
      if (inp) { const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; inp.dispatchEvent(new Event('change')); }
    });
  });
}
function prevImg(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    document.getElementById('imgPrev').innerHTML = `<img src="${ev.target.result}"/><div style="font-family:var(--fm);font-size:.55rem;color:var(--t3);margin-top:3px">${f.name}</div>`;
    document.getElementById('imgZone').style.display = 'none';
  };
  r.readAsDataURL(f);
}
function prevVid(e) {
  const f = e.target.files[0]; if (!f) return;
  document.getElementById('vidPrev').innerHTML = `<video src="${URL.createObjectURL(f)}" controls></video><div style="font-family:var(--fm);font-size:.55rem;color:var(--t3);margin-top:3px">${f.name}</div>`;
}

// ═══════ GENERATE — FOCUS AWARE ═══════
function validateFocus() {
  const areas = getFocusAreas();
  if (!areas.length) { toast('Select at least one focus area', 'err'); return false; }
  return true;
}
function showLoading(msg, rangeText) {
  document.getElementById('genLoad').classList.remove('hidden');
  document.getElementById('genEmpty').style.display = 'none';
  document.getElementById('tableView').classList.add('hidden');
  document.getElementById('rowView').classList.add('hidden');
  document.getElementById('colFilterBar').classList.add('hidden');
  document.getElementById('suiteMetaBar').classList.add('hidden');
  document.getElementById('rpActs').style.display = 'none';
  setText('lTxt', msg); setText('lRange', rangeText);
  const msgs = ['Analyzing structure…', 'Mapping selected focus areas…', 'Generating test scenarios…', 'Writing test steps…', 'Applying constraints…', 'Finalizing suite…'];
  let i = 0;
  const iv = setInterval(() => {
    if (document.getElementById('genLoad').classList.contains('hidden')) return clearInterval(iv);
    setText('lSub', msgs[i++ % msgs.length]);
  }, 1100);
}
function hideLoading() { document.getElementById('genLoad').classList.add('hidden'); }
function showEmpty() { document.getElementById('genEmpty').style.display = ''; }

// Build extra payload including focus-filtered instruction
function buildExtra() {
  return {
    focus_areas: getFocusAreas(),
    format_config: getFormatConfig(),
    is_multi_agent: genMode === 'swarm',
    agents: genMode === 'swarm' ? getFocusAreas() : [],
    depth: curDepth
  };
}

async function genUrl() {
  if (!validateFocus()) return;
  const url = v('gUrl').trim(); if (!url) return toast('Enter a URL', 'err');
  const rc = getRangeConfig();
  showLoading(`Generating from URL — focus: ${getFocusAreas().join(', ')}`, `Range: ${rc.min_tests}–${rc.max_tests} tests`);
  try {
    const s = await post('/api/generate/url', { url, model: curModel, app_type: v('gUrlType'), description: v('gUrlDesc'), range_config: rc, ...buildExtra() });
    showSuite(s); loadStats();
  } catch (e) { toast(e.message, 'err'); hideLoading(); showEmpty(); }
}
async function genImage() {
  if (!validateFocus()) return;
  const f = document.getElementById('imgFile').files[0]; if (!f) return toast('Upload an image', 'err');
  const rc = getRangeConfig();
  showLoading(genMode === 'swarm' ? `Swarm analyzing screenshot — ${getFocusAreas().length} agents` : `Analyzing screenshot — focus: ${getFocusAreas().join(', ')}`, `Range: ${rc.min_tests}–${rc.max_tests} tests`);
  try {
    const fd = new FormData();
    fd.append('file', f); fd.append('app_type', v('gImgType')); fd.append('description', v('gImgDesc'));
    fd.append('focus_areas', getFocusAreas().join(','));
    fd.append('min_tests', rc.min_tests); fd.append('max_tests', rc.max_tests);
    if (genMode === 'swarm') {
      fd.append('is_multi_agent', 'true');
      fd.append('agents', getFocusAreas().join(','));
    }
    fd.append('depth', curDepth);
    const s = await postForm('/api/generate/image', fd);
    showSuite(s); loadStats();
  } catch (e) { toast(e.message, 'err'); hideLoading(); showEmpty(); }
}
async function genVideo() {
  if (!validateFocus()) return;
  const f = document.getElementById('vidFile').files[0]; if (!f) return toast('Upload a video', 'err');
  const rc = getRangeConfig();
  showLoading(genMode === 'swarm' ? `Swarm analyzing video — ${getFocusAreas().length} agents` : 'Analyzing video…', `Range: ${rc.min_tests}–${rc.max_tests} tests`);
  try {
    const fd = new FormData();
    fd.append('file', f); fd.append('app_type', v('gVidType')); fd.append('description', v('gVidDesc'));
    fd.append('focus_areas', getFocusAreas().join(','));
    fd.append('min_tests', rc.min_tests); fd.append('max_tests', rc.max_tests);
    if (genMode === 'swarm') {
      fd.append('is_multi_agent', 'true');
      fd.append('agents', getFocusAreas().join(','));
    }
    fd.append('depth', curDepth);
    const s = await postForm('/api/generate/video', fd);
    showSuite(s); loadStats();
  } catch (e) { toast(e.message, 'err'); hideLoading(); showEmpty(); }
}
async function genText() {
  if (!validateFocus()) return;
  const desc = v('gTxtDesc').trim(); if (!desc) return toast('Describe your app', 'err');
  const rc = getRangeConfig();
  showLoading(`Deep analysis — focus: ${getFocusAreas().join(', ')}`, `Range: ${rc.min_tests}–${rc.max_tests} tests`);
  try {
    const s = await post('/api/generate/text', { description: desc, model: curModel, app_type: v('gTxtType'), range_config: rc, ...buildExtra() });
    showSuite(s); loadStats();
  } catch (e) { toast(e.message, 'err'); hideLoading(); showEmpty(); }
}

// ═══════ DOC UPLOAD PREVIEW ═══════
function prevDoc(e) {
  const f = e.target.files[0]; if (!f) return;
  const ext = f.name.split('.').pop().toUpperCase();
  const icons = { PDF: '📕', DOC: '📘', DOCX: '📘', PPT: '📙', PPTX: '📙', TXT: '📃', MD: '📃', CSV: '📊' };
  const icon = icons[ext] || '📄';
  const size = f.size < 1024 * 1024 ? `${(f.size/1024).toFixed(1)} KB` : `${(f.size/1024/1024).toFixed(1)} MB`;
  document.getElementById('docPrev').innerHTML =
    `<div style="display:flex;align-items:center;gap:.5rem;padding:.5rem;background:var(--bg3);border:1px solid var(--b);margin-top:.4rem;font-family:var(--fm);">
       <span style="font-size:1.4rem">${icon}</span>
       <div><div style="font-size:.75rem;color:var(--t1);font-weight:600">${f.name}</div>
       <div style="font-size:.6rem;color:var(--t3)">${ext} · ${size}</div></div>
     </div>`;
  document.getElementById('docZone').style.display = 'none';
}

async function genDoc() {
  if (!validateFocus()) return;
  const f = document.getElementById('docFile').files[0];
  if (!f) return toast('Upload a requirements document', 'err');
  const rc = getRangeConfig();
  showLoading(`Parsing document — focus: ${getFocusAreas().join(', ')}`, `Range: ${rc.min_tests}–${rc.max_tests} tests`);
  try {
    const fd = new FormData();
    fd.append('file', f);
    fd.append('app_type', v('gDocType'));
    fd.append('description', v('gDocDesc'));
    fd.append('focus_areas', getFocusAreas().join(','));
    fd.append('min_tests', rc.min_tests);
    fd.append('max_tests', rc.max_tests);
    if (genMode === 'swarm') {
      fd.append('is_multi_agent', 'true');
      fd.append('agents', getFocusAreas().join(','));
    }
    fd.append('depth', curDepth);
    const s = await postForm('/api/generate/document', fd);
    showSuite(s); loadStats();
  } catch (e) { toast(e.message, 'err'); hideLoading(); showEmpty(); }
}


// ═══════ SUITE DISPLAY ═══════
function showSuite(suite) {
  curSuiteId = suite.id;
  allTests = suite.tests || [];
  hideLoading();
  document.getElementById('genEmpty').style.display = 'none';
  document.getElementById('rpActs').style.display = 'flex';
  const cnt = document.getElementById('rpCount');
  cnt.textContent = `${allTests.length} tests`; cnt.classList.remove('hidden');
  const rng = document.getElementById('rpRange');
  if (suite.range_min && suite.range_max) { rng.textContent = `range ${suite.range_min}–${suite.range_max}`; rng.classList.remove('hidden'); }
  const mb = document.getElementById('suiteMetaBar');
  mb.innerHTML = `<div class="smb"><b>Suite</b>${suite.name}</div><div class="smb"><b>App</b>${(suite.app_type || '').toUpperCase()}</div><div class="smb"><b>Tests</b>${allTests.length}</div><div class="smb"><b>Model</b>${suite.model_used}</div><div class="smb"><b>Generated</b>${suite.created_at?.slice(0, 16) || ''}</div>`;
  mb.classList.remove('hidden');
  document.getElementById('colFilterBar').classList.remove('hidden');
  renderCurrentView();
  toast(`✓ Generated ${allTests.length} tests — focus: ${getFocusAreas().slice(0, 3).join(', ')}${getFocusAreas().length > 3 ? '…' : ''}`, 'ok');
}
function setView(view, btn) {
  currentView = view;
  document.querySelectorAll('.vb').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCurrentView();
}
function renderCurrentView() {
  const tv = document.getElementById('tableView'), rv = document.getElementById('rowView');
  if (currentView === 'columns') { tv.classList.remove('hidden'); rv.classList.add('hidden'); renderTable(filterTests()); }
  else { rv.classList.remove('hidden'); tv.classList.add('hidden'); renderRows(filterTests()); }
}
function filterTests() {
  const prio = v('filterPrio'), cat = v('filterCat'), search = v('filterSearch').toLowerCase();
  return allTests.filter(t =>
    (!prio || t.priority === prio) &&
    (!cat || t.category === cat) &&
    (!search || t.name?.toLowerCase().includes(search) || t.description?.toLowerCase().includes(search) || t.id?.toLowerCase().includes(search))
  );
}
function filterTable() { renderCurrentView(); }
function toggleCol(cb) { const col = cb.dataset.col; cb.checked ? hiddenCols.delete(col) : hiddenCols.add(col); renderCurrentView(); }

// ═══════ TABLE ═══════
const COLS = [
  { id: 'id', label: 'Test Case ID', cls: 'col-id', sortable: true },
  { id: 'category', label: 'Category', cls: 'col-category', sortable: true },
  { id: 'test_input', label: 'Input', cls: 'col-input', sortable: true },
  { id: 'steps', label: 'Test steps', cls: 'col-steps', sortable: false },
  { id: 'name', label: 'Scenario Title', cls: 'col-name', sortable: true },
  { id: 'scenario', label: 'Scenario', cls: 'col-scenario', sortable: true },
  { id: 'preconditions', label: 'Pre-Condition', cls: 'col-preconditions', sortable: false },
  { id: 'expected', label: 'Expected Result', cls: 'col-expected', sortable: false },
  { id: 'actual', label: 'Actual Result', cls: 'col-actual', sortable: false },
  { id: 'browser', label: 'Browser', cls: 'col-browser', sortable: true },
  { id: 'screen', label: 'Screen', cls: 'col-screen', sortable: true },
  { id: 'status', label: 'Status', cls: 'col-status', sortable: true },
  { id: 'priority', label: 'Priority', cls: 'col-priority', sortable: true },
  { id: 'severity', label: 'Severity', cls: 'col-severity', sortable: true },
  { id: 'created_by', label: 'Created By', cls: 'col-creator', sortable: true },
  { id: 'tags', label: 'Tags', cls: 'col-tags', sortable: false },
];
function visCols() { return COLS.filter(c => !hiddenCols.has(c.id)); }
function sortTests(tests) {
  return [...tests].sort((a, b) => {
    let av = a[sortCol] || '', bv = b[sortCol] || '';
    if (sortCol === 'priority') { const o = { critical: 0, high: 1, medium: 2, low: 3 }; av = o[av] ?? 4; bv = o[bv] ?? 4; }
    return (av < bv ? -1 : av > bv ? 1 : 0) * sortDir;
  });
}
function renderTable(tests) {
  const cols = visCols(), sorted = sortTests(tests);
  document.getElementById('tcHead').innerHTML = `<tr>${cols.map(c => `<th class="${c.cls}${sortCol === c.id ? ' sorted' : ''}" ${c.sortable ? `onclick="doSort('${c.id}')"` : ''}>${c.label}${sortCol === c.id ? `<span style="margin-left:4px">${sortDir === 1 ? '↑' : '↓'}</span>` : ''}</th>`).join('')}</tr>`;
  document.getElementById('tcBody').innerHTML = sorted.map(t => `<tr>${cols.map(c => {
    switch (c.id) {
      case 'id': return `<td class="col-id"><span class="code-sm">${t.id}</span></td>`;
      case 'name': return `<td class="col-name"><strong style="font-size:.78rem">${t.name}</strong></td>`;
      case 'scenario': return `<td class="col-scenario"><div style="font-family:var(--fm);font-size:.57rem;color:var(--t2);line-height:1.4">${(t.scenario || t.description || '').slice(0, 75)}${((t.scenario || t.description)?.length || 0) > 75 ? '…' : ''}</div></td>`;
      case 'category': return `<td class="col-category"><span class="cat-chip cat-${t.category || 'functional'}">${t.category || 'functional'}</span></td>`;
      case 'priority': return `<td class="col-priority prio-${t.priority}">${(t.priority || '').toUpperCase()}</td>`;
      case 'severity': return `<td class="col-severity sev-${t.severity || 'major'}">${(t.severity || 'MAJOR').toUpperCase()}</td>`;
      case 'preconditions': return `<td class="col-preconditions"><div class="pre-cell">${(t.preconditions || []).map(p => `<div class="pre-item">${p}</div>`).join('') || '<span style="color:var(--t3);font-size:.58rem">—</span>'}</div></td>`;
      case 'test_input': return `<td class="col-input"><div style="font-family:var(--fm);font-size:.65rem;color:var(--hi);background:rgba(255,107,53,.05);padding:2px 4px;border-radius:2px">${t.test_input || '—'}</div></td>`;
      case 'steps': {
        const steps = t.steps || [], show = steps.slice(0, 3), more = steps.length - 3;
        return `<td class="col-steps"><div class="steps-cell">${show.map(s => `<div class="sc-step"><span class="sc-step-n">${s.step}</span><span>${s.action}</span><span class="sc-step-e">→ ${s.expected}</span></div>`).join('')}${more > 0 ? `<button class="steps-more" onclick="expandSteps('exp-${t.id}',event)">+${more} more</button>` : ''}</div></td>`;
      }
      case 'expected': return `<td class="col-expected"><span style="font-family:var(--fm);font-size:0.83rem;color:var(--t);line-height:1.5">${t.expected_result || '—'}</span></td>`;
      case 'actual': return `<td class="col-actual"><span style="font-family:var(--fm);font-size:0.75rem;color:var(--t2)">${t.actual_result || '—'}</span></td>`;
      case 'status': return `<td class="col-status"><span class="status-badge st-${t.status || 'pending'}">${(t.status || 'pending').toUpperCase()}</span></td>`;
      case 'browser': return `<td class="col-browser"><span style="font-size:.65rem;color:var(--t3)">${t.browser || '—'}</span></td>`;
      case 'screen': return `<td class="col-screen"><span style="font-size:.65rem;color:var(--t3)">${t.screen || '—'}</span></td>`;
      case 'created_by': return `<td class="col-creator"><span style="font-family:var(--fm);font-size:.55rem;color:var(--t2)">${t.created_by || 'AI Engine'}</span></td>`;
      case 'tags': return `<td class="col-tags"><div class="tags-cell">${(t.tags || []).map(g => `<span class="tag-c">${g}</span>`).join('') || '—'}</div></td>`;
      default: return '<td>—</td>';
    }
  }).join('')}</tr>`).join('');
}
function expandSteps(id, e) {
  const btn = e.target; const cell = btn.closest('.steps-cell'); const t = allTests.find(x => `exp-${x.id}` === id);
  if (!t) return;
  cell.innerHTML = t.steps.map(s => `<div class="sc-step"><span class="sc-step-n">${s.step}</span><span>${s.action}</span><span class="sc-step-e">→ ${s.expected}</span></div>`).join('');
}
function doSort(col) {
  sortDir = sortCol === col ? sortDir * -1 : 1;
  sortCol = col;
  renderCurrentView();
}

// ═══════ CARD VIEW ═══════
function renderRows(tests) {
  document.getElementById('rowList').innerHTML = tests.map(t => `
    <div class="rv-card prio-${t.priority}">
      <div class="rv-hdr" onclick="this.nextElementSibling.classList.toggle('open')">
        <span class="rv-id">${t.id}</span>
        <span class="rv-name">${t.name}</span>
        <div class="rv-badges"><span class="bdg bdg-${t.category}">${t.category}</span><span class="bdg bdg-${t.priority}">${t.priority}</span></div>
      </div>
      <div class="rv-body">
        <div class="rv-desc">${t.description || ''}</div>
        ${t.preconditions?.length ? `<div style="font-family:var(--fm);font-size:.55rem;color:var(--t3);margin:.35rem 0 .18rem">PRE: ${t.preconditions.join(' · ')}</div>` : ''}
        <ul class="rv-steps">${(t.steps || []).map(s => `<li class="rv-step"><span class="rvs-n">${s.step}</span><span>${s.action}</span><span class="rvs-e">→ ${s.expected}</span></li>`).join('')}</ul>
        <div style="font-family:var(--fm);font-size:.59rem;color:var(--ac2);margin-top:.35rem">✓ ${t.expected_result || ''}</div>
        ${t.tags?.length ? `<div style="font-family:var(--fm);font-size:.53rem;color:var(--t3);margin-top:.28rem">tags: ${t.tags.join(', ')}</div>` : ''}
      </div>
    </div>`).join('');
}

// ═══════ EXPORT ═══════
function exportCsv() {
  if (!allTests.length) return toast('No tests to export', 'err');
  const headers = ['Test Case ID', 'Category', 'Input', 'Test steps', 'Scenario Title', 'Scenario', 'Pre-Condition', 'Expected Result', 'Actual Result', 'Browser', 'Screen', 'Status', 'Priority', 'Severity', 'Created By', 'Tags'];
  const rows = allTests.map(t => [
    t.id,
    t.category,
    t.test_input,
    (t.steps || []).map(s => `${s.step}. ${s.action}`).join(' | '),
    t.name,
    t.scenario || t.description,
    (t.preconditions || []).join(' | '),
    t.expected_result,
    t.actual_result,
    t.browser,
    t.screen,
    t.status,
    t.priority,
    t.severity,
    t.created_by,
    (t.tags || []).join(', ')
  ].map(x => `"${(x || '').toString().replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `qaforge-suite-${Date.now()}.csv`; a.click();
  toast(`CSV exported with ${headers.length} columns`, 'ok');
}
function goExec() { if (curSuiteId) { selExecId = curSuiteId; nav('execute'); } }
function goAutomate() { if (curSuiteId) { autoSelId = curSuiteId; nav('automate'); } }
async function dlSuite() { if (curSuiteId) window.location.href = `/api/suites/${curSuiteId}/download`; }

// ═══════ EXECUTE ═══════
async function loadSuiteList() {
  try {
    const suites = await get('/api/suites'), el = document.getElementById('suiteList');
    if (!suites.length) { el.innerHTML = '<div class="empty-sm">Generate a suite first.</div>'; return; }
    el.innerHTML = suites.map(s => `<div class="suite-card${s.id === selExecId ? ' sel' : ''}" onclick="selSuite(this,'${s.id}')"><div class="sc-name">${_escapeHtml(s.name)}${s.range_max ? `<span class="sc-range">${s.range_min}–${s.range_max}</span>` : ''}</div><div class="sc-meta">${s.tests?.length || 0} tests · ${_escapeHtml(s.app_type?.toUpperCase() || '')} · ${_escapeHtml(s.model_used || 'Gemini')}</div></div>`).join('');
    if (selExecId) document.getElementById('execCfg').style.display = 'flex';
  } catch (err) {
    console.error('[Execute] Failed to load suites:', err);
  }
}
function selSuite(el, id) { document.querySelectorAll('.suite-card').forEach(c => c.classList.remove('sel')); el.classList.add('sel'); selExecId = id; document.getElementById('execCfg').style.display = 'flex'; }
async function runSuite() {
  if (!selExecId) return toast('Select a suite', 'err');
  document.getElementById('execLive').classList.remove('hidden');
  document.getElementById('execIdle').style.display = 'none';
  document.getElementById('liveFeed').innerHTML = '';
  document.getElementById('runSummary').classList.add('hidden');
  document.getElementById('runDls').classList.add('hidden');
  document.getElementById('runFill').style.width = '0%';
  document.getElementById('runPct').textContent = '0%';
  try {
    const r = await post(`/api/execute/${selExecId}`, { environment: v('execEnv'), base_url: v('execUrl') || null });
    lastRunId = r.run_id; pollRun(r.run_id);
  } catch (e) { toast(e.message, 'err'); }
}
function pollRun(runId) {
  if (pollTimer) clearInterval(pollTimer); let last = 0;
  pollTimer = setInterval(async () => {
    try {
      const r = await get(`/api/results/${runId}`);
      document.getElementById('runFill').style.width = r.progress + '%';
      document.getElementById('runPct').textContent = r.progress + '%';
      document.getElementById('runInfo').textContent = `Run ${runId.slice(0, 8)} · ${r.environment?.toUpperCase()} · ${r.status.toUpperCase()}`;
      for (let i = last; i < r.tests.length; i++) {
        const t = r.tests[i], p = t.status === 'pass', row = document.createElement('div');
        row.className = `fi-row ${p ? 'pass' : 'fail'}`;
        row.innerHTML = `<span class="fi-ico">${p ? '✓' : '✗'}</span><span class="fi-name">${_escapeHtml(t.test_id)} — ${_escapeHtml(t.test_name)}</span><span class="fi-dur">${t.duration_ms}ms</span>`;
        document.getElementById('liveFeed').appendChild(row);
        row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
      last = r.tests.length;
      if (r.status === 'completed') {
        clearInterval(pollTimer); const s = r.summary;
        document.getElementById('runSummary').innerHTML = `<div><div class="rs-num">${s.total}</div><div class="rs-lbl">Total</div></div><div><div class="rs-num c-pass">${s.passed}</div><div class="rs-lbl">Passed</div></div><div><div class="rs-num c-fail">${s.failed}</div><div class="rs-lbl">Failed</div></div><div><div class="rs-num c-rate">${s.pass_rate}%</div><div class="rs-lbl">Pass Rate</div></div>`;
        document.getElementById('runSummary').classList.remove('hidden');
        document.getElementById('runDls').classList.remove('hidden');
        toast(`Done: ${s.passed}/${s.total} passed (${s.pass_rate}%)`, s.pass_rate >= 80 ? 'ok' : 'warn');
        loadStats(); loadReportList();
      }
    } catch { clearInterval(pollTimer); }
  }, 700);
}
async function dlReport(fmt) { if (!lastRunId) return toast('No run yet', 'err'); try { const r = await post(`/api/reports/${lastRunId}?fmt=${fmt}`); window.location.href = `/api/reports/download/${r.filename}`; } catch (e) { toast(e.message, 'err'); } }

// ═══════ AUTOMATE — REAL SCRIPTS ═══════
function pickFw(btn) {
  document.querySelectorAll('.fw').forEach(b => b.classList.remove('active'));
  btn.classList.add('active'); curFw = btn.dataset.fw;
  updateLangOpts();
}
function updateLangOpts() {
  const map = { playwright: ['javascript', 'typescript', 'python'], selenium: ['python', 'java', 'csharp'], cypress: ['javascript', 'typescript'], pytest: ['python'], jest: ['javascript', 'typescript'], postman: ['json'] };
  const langs = map[curFw] || ['javascript'];
  document.getElementById('langOpts').innerHTML = langs.map((l, i) => `<button class="msb${i === 0 ? ' active' : ''}" data-l="${l}" onclick="pickLang(this)">${l.charAt(0).toUpperCase() + l.slice(1)}</button>`).join('');
  curLang = langs[0];
}
function pickLang(btn) { document.querySelectorAll('#langOpts .msb').forEach(b => b.classList.remove('active')); btn.classList.add('active'); curLang = btn.dataset.l; }

async function loadAutoSuiteList() {
  try {
    const suites = await get('/api/suites'), el = document.getElementById('autoSuiteList');
    if (!suites.length) { el.innerHTML = '<div class="empty-sm">Generate a suite first.</div>'; return; }
    el.innerHTML = suites.map(s => `<div class="suite-card${s.id === autoSelId ? ' sel' : ''}" onclick="selAutoSuite(this,'${s.id}')"><div class="sc-name">${s.name}</div><div class="sc-meta">${s.tests?.length || 0} tests · ${s.app_type?.toUpperCase()}</div></div>`).join('');
  } catch { }
}
function selAutoSuite(el, id) { document.querySelectorAll('#autoSuiteList .suite-card').forEach(c => c.classList.remove('sel')); el.classList.add('sel'); autoSelId = id; }

async function generateScript() {
  if (!autoSelId) return toast('Select a suite first', 'err');
  document.getElementById('autoLoad').classList.remove('hidden');
  document.getElementById('autoEmpty').style.display = 'none';
  document.getElementById('autoOut').classList.add('hidden');
  try {
    let suite;
    try { const suites = await get('/api/suites'); suite = suites.find(s => s.id === autoSelId); } catch { }
    const tests = suite?.tests || allTests || [];
    const opts = {
      framework: curFw, language: curLang,
      base_url: v('autoBaseUrl') || 'https://yourapp.com',
      pom: document.getElementById('optPOM')?.checked,
      retry: document.getElementById('optRetry')?.checked,
      screenshot: document.getElementById('optScreenshot')?.checked,
      parallel: document.getElementById('optParallel')?.checked,
      reporter: document.getElementById('optReporter')?.checked,
      ci: document.getElementById('optCI')?.checked
    };
    generatedFiles = buildAllFiles(tests, opts);
    activeCodeFile = 'main';
    showGeneratedScript(opts, tests.length);
  } catch (e) { toast(e.message, 'err'); }
  finally { document.getElementById('autoLoad').classList.add('hidden'); }
}

// ═══════ REAL SCRIPT GENERATORS ═══════
function buildAllFiles(tests, opts) {
  const files = {};
  const fw = opts.framework, lang = opts.language, url = opts.base_url;
  switch (fw) {
    case 'playwright': files.main = buildPlaywright(tests, opts); files.pom = buildPlaywrightPOM(opts); files.config = buildPlaywrightConfig(opts); break;
    case 'selenium': files.main = buildSelenium(tests, opts); files.pom = buildSeleniumPOM(opts); files.config = buildSeleniumConfig(opts); break;
    case 'cypress': files.main = buildCypress(tests, opts); files.pom = buildCypressPOM(opts); files.config = buildCypressConfig(opts); break;
    case 'pytest': files.main = buildPytest(tests, opts); files.pom = buildPytestPOM(opts); files.config = buildPytestConfig(opts); break;
    case 'jest': files.main = buildJest(tests, opts); files.pom = buildJestPOM(opts); files.config = buildJestConfig(opts); break;
    case 'postman': files.main = buildPostman(tests, opts); files.pom = '// N/A for Postman'; files.config = '// Use Postman environments'; break;
  }
  if (opts.ci) files.ci = buildCI(opts);
  return files;
}

function buildPlaywright(tests, opts) {
  const ts = opts.language === 'typescript';
  const imp = ts ? `import { test, expect, Page } from '@playwright/test';\n${opts.pom ? "import { AppPage } from './pages/AppPage';" : ''}` : `const { test, expect } = require('@playwright/test');\n${opts.pom ? "const { AppPage } = require('./pages/AppPage');" : ''}`;
  const testCases = tests.map(t => {
    const steps = (t.steps || []).map(s => {
      const action = s.action.toLowerCase();
      if (action.includes('click')) return `  await page.click('/* selector for: ${s.action} */');`;
      if (action.includes('enter') || action.includes('type') || action.includes('fill'))
        return `  await page.fill('/* input selector */', '/* test value */');`;
      if (action.includes('navigate') || action.includes('go to') || action.includes('open'))
        return `  await page.goto('${opts.base_url}');`;
      if (action.includes('verify') || action.includes('check') || action.includes('assert'))
        return `  await expect(page.locator('/* element */')).toBeVisible();`;
      if (action.includes('wait')) return `  await page.waitForLoadState('networkidle');`;
      return `  // Step ${s.step}: ${s.action}`;
    }).join('\n');
    return `test('${t.name}', async ({ page }${ts ? ': { page: Page }' : ''}) => {\n  // Priority: ${t.priority?.toUpperCase()} | Category: ${t.category}\n  // ${t.description || ''}\n${opts.pom ? `  const app = new AppPage(page);\n  await app.goto();\n` : `  await page.goto('${opts.base_url}');\n`}${steps}\n\n  // Expected: ${t.expected_result}\n  await expect(page).toHaveURL(/.+/);\n});`;
  }).join('\n\n');
  return `${imp}\n\ntest.describe('QAForge Test Suite', () => {\n  test.beforeEach(async ({ page }) => {\n    await page.goto('${opts.base_url}');\n  });\n\n${testCases.split('\n').map(l => '  ' + l).join('\n')}\n});\n`;
}

function buildPlaywrightPOM(opts) {
  const ts = opts.language === 'typescript';
  return ts
    ? `import { Page, Locator } from '@playwright/test';\n\nexport class AppPage {\n  readonly page: Page;\n  readonly heading: Locator;\n  readonly submitBtn: Locator;\n\n  constructor(page: Page) {\n    this.page = page;\n    this.heading = page.locator('h1');\n    this.submitBtn = page.locator('button[type="submit"]');\n  }\n\n  async goto() {\n    await this.page.goto('${opts.base_url}');\n  }\n\n  async getTitle(): Promise<string> {\n    return await this.page.title();\n  }\n}\n`
    : `class AppPage {\n  constructor(page) {\n    this.page = page;\n    this.heading = page.locator('h1');\n    this.submitBtn = page.locator('button[type="submit"]');\n  }\n\n  async goto() {\n    await this.page.goto('${opts.base_url}');\n  }\n\n  async getTitle() {\n    return await this.page.title();\n  }\n}\n\nmodule.exports = { AppPage };\n`;
}

function buildPlaywrightConfig(opts) {
  const ts = opts.language === 'typescript';
  return `${ts ? 'import { defineConfig } from' : 'const { defineConfig } ='} ${ts ? '' : 'require('}@playwright/test${ts ? ';' : ');'}\n\nexport default defineConfig({\n  testDir: './tests',\n  timeout: 30000,\n  retries: ${opts.retry ? 3 : 0},\n  ${opts.parallel ? 'workers: 4,' : 'workers: 1,'}\n  reporter: [${opts.reporter ? "['html', { open: 'never' }]" : "['line']"}],\n  use: {\n    baseURL: '${opts.base_url}',\n    screenshot: '${opts.screenshot ? 'on' : 'off'}',\n    trace: 'retain-on-failure',\n    headless: true,\n  },\n  projects: [\n    { name: 'chromium', use: { browserName: 'chromium' } },\n    { name: 'firefox',  use: { browserName: 'firefox'  } },\n  ],\n});\n`;
}

function buildSelenium(tests, opts) {
  if (opts.language === 'java') {
    const cases = tests.map(t => `    @Test\n    public void test${t.id?.replace(/-/g, '') || 'Case'}() {\n        // ${t.name}\n        // Priority: ${t.priority?.toUpperCase()} | Category: ${t.category}\n        driver.get("${opts.base_url}");\n${(t.steps || []).map(s => `        // ${s.step}. ${s.action}`).join('\n')}\n        // Expected: ${t.expected_result}\n        Assert.assertTrue(driver.getTitle().length() > 0);\n    }`).join('\n\n');
    return `import org.openqa.selenium.*;\nimport org.openqa.selenium.chrome.ChromeDriver;\nimport org.testng.Assert;\nimport org.testng.annotations.*;\n\npublic class QAForgeTestSuite {\n    private WebDriver driver;\n\n    @BeforeClass\n    public void setUp() {\n        System.setProperty("webdriver.chrome.driver", "path/to/chromedriver");\n        driver = new ChromeDriver();\n        driver.manage().window().maximize();\n    }\n\n${cases}\n\n    @AfterClass\n    public void tearDown() {\n        if (driver != null) driver.quit();\n    }\n}\n`;
  }
  const cases = tests.map(t => `def test_${(t.id || 'case').replace(/-/g, '_')}(self):\n        """${t.name}\n        Priority: ${t.priority?.toUpperCase()} | Category: ${t.category}\n        """\n        self.driver.get("${opts.base_url}")\n${(t.steps || []).map(s => `        # ${s.step}. ${s.action}`).join('\n')}\n        # Expected: ${t.expected_result}\n        self.assertIn("${opts.base_url.split('//')[1]?.split('/')[0]}", self.driver.current_url)`).join('\n\n    ');
  return `import unittest\nfrom selenium import webdriver\nfrom selenium.webdriver.common.by import By\nfrom selenium.webdriver.support.ui import WebDriverWait\nfrom selenium.webdriver.support import expected_conditions as EC\n${opts.pom ? "from pages.app_page import AppPage\n" : ""}\nclass QAForgeTestSuite(unittest.TestCase):\n    @classmethod\n    def setUpClass(cls):\n        cls.driver = webdriver.Chrome()\n        cls.driver.maximize_window()\n        cls.wait = WebDriverWait(cls.driver, 10)\n${opts.pom ? "        cls.app = AppPage(cls.driver)\n" : ""}\n    def tearDown(self):\n        pass  # Screenshot on failure handled by hooks\n\n    @classmethod\n    def tearDownClass(cls):\n        cls.driver.quit()\n\n    def ${cases}\n\nif __name__ == '__main__':\n    unittest.main()\n`;
}

function buildSeleniumPOM(opts) {
  return `from selenium.webdriver.common.by import By\nfrom selenium.webdriver.support.ui import WebDriverWait\nfrom selenium.webdriver.support import expected_conditions as EC\n\n\nclass AppPage:\n    URL = "${opts.base_url}"\n\n    def __init__(self, driver):\n        self.driver = driver\n        self.wait = WebDriverWait(driver, 10)\n\n    def goto(self):\n        self.driver.get(self.URL)\n        return self\n\n    def get_title(self):\n        return self.driver.title\n\n    def click(self, locator):\n        el = self.wait.until(EC.element_to_be_clickable(locator))\n        el.click()\n        return self\n\n    def fill(self, locator, value):\n        el = self.wait.until(EC.visibility_of_element_located(locator))\n        el.clear()\n        el.send_keys(value)\n        return self\n`;
}

function buildSeleniumConfig(opts) {
  return `# pytest.ini / setup.cfg\n[pytest]\ntestpaths = tests\naddopts = -v --tb=short${opts.reporter ? ' --html=report.html' : ''}${opts.parallel ? ' -n auto' : ''}\n\n# conftest.py\nimport pytest\nfrom selenium import webdriver\n\n@pytest.fixture(scope="session")\ndef driver():\n    options = webdriver.ChromeOptions()\n    options.add_argument("--headless")\n    driver = webdriver.Chrome(options=options)\n    yield driver\n    driver.quit()\n`;
}

function buildCypress(tests, opts) {
  const ts = opts.language === 'typescript';
  const cases = tests.map(t => `  it('${t.name}', () => {\n    // Priority: ${t.priority?.toUpperCase()} | Category: ${t.category}\n    // ${t.description || ''}\n${(t.steps || []).map(s => {
    const a = s.action.toLowerCase();
    if (a.includes('click')) return `    cy.get('/* selector */').click();`;
    if (a.includes('type') || a.includes('fill') || a.includes('enter')) return `    cy.get('/* input */').type('/* value */');`;
    if (a.includes('visit') || a.includes('navigate') || a.includes('open')) return `    cy.visit('${opts.base_url}');`;
    if (a.includes('verify') || a.includes('assert') || a.includes('check')) return `    cy.get('/* element */').should('be.visible');`;
    return `    // ${s.step}. ${s.action}`;
  }).join('\n')}\n\n    // Expected: ${t.expected_result}\n  });`).join('\n\n');
  return `${ts ? '/// <reference types="cypress" />\n' : ''}\ndescribe('QAForge Test Suite', () => {\n  beforeEach(() => {\n    cy.visit('${opts.base_url}');\n  });\n\n${cases}\n});\n`;
}

function buildCypressPOM(opts) {
  return `// cypress/support/pages/AppPage.${opts.language === 'typescript' ? 'ts' : 'js'}\nexport class AppPage {\n  visit() {\n    cy.visit('${opts.base_url}');\n    return this;\n  }\n\n  getHeading() {\n    return cy.get('h1');\n  }\n\n  clickSubmit() {\n    cy.get('button[type="submit"]').click();\n    return this;\n  }\n\n  fillInput(selector, value) {\n    cy.get(selector).clear().type(value);\n    return this;\n  }\n}\n`;
}

function buildCypressConfig(opts) {
  return `// cypress.config.${opts.language === 'typescript' ? 'ts' : 'js'}\nimport { defineConfig } from 'cypress';\n\nexport default defineConfig({\n  e2e: {\n    baseUrl: '${opts.base_url}',\n    viewportWidth: 1280,\n    viewportHeight: 720,\n    video: true,\n    screenshotsFolder: 'cypress/screenshots',\n    retries: { runMode: ${opts.retry ? 3 : 0}, openMode: 0 },\n    setupNodeEvents(on, config) {\n      // implement node event listeners here\n    },\n  },\n});\n`;
}

function buildPytest(tests, opts) {
  const cases = tests.map(t => `@pytest.mark.${t.priority?.toLowerCase() || 'medium'}\ndef test_${(t.id || 'case').replace(/-/g, '_')}(client):\n    """\n    ${t.name}\n    Priority: ${t.priority?.toUpperCase()} | Category: ${t.category}\n    ${t.description || ''}\n    """\n${(t.steps || []).map(s => `    # Step ${s.step}: ${s.action}\n    # Expected: ${s.expected}`).join('\n')}\n\n    # Final assertion: ${t.expected_result}\n    assert True  # Replace with real assertion`).join('\n\n\n');
  return `import pytest\nimport requests\n${opts.pom ? "from helpers.app_client import AppClient\n" : ""}\nBASE_URL = "${opts.base_url}"\n\n\n@pytest.fixture(scope="module")\ndef client():\n${opts.pom ? "    return AppClient(BASE_URL)\n" : "    session = requests.Session()\n    session.headers.update({'Content-Type': 'application/json'})\n    yield session\n    session.close()\n"}\n\n${cases}\n`;
}

function buildPytestPOM(opts) {
  return `# helpers/app_client.py\nimport requests\n\n\nclass AppClient:\n    def __init__(self, base_url: str):\n        self.base_url = base_url\n        self.session = requests.Session()\n        self.session.headers.update({'Content-Type': 'application/json'})\n\n    def get(self, endpoint: str, **kwargs):\n        return self.session.get(f"{self.base_url}{endpoint}", **kwargs)\n\n    def post(self, endpoint: str, data=None, **kwargs):\n        return self.session.post(f"{self.base_url}{endpoint}", json=data, **kwargs)\n\n    def put(self, endpoint: str, data=None, **kwargs):\n        return self.session.put(f"{self.base_url}{endpoint}", json=data, **kwargs)\n\n    def delete(self, endpoint: str, **kwargs):\n        return self.session.delete(f"{self.base_url}{endpoint}", **kwargs)\n\n    def login(self, email: str, password: str):\n        resp = self.post('/auth/login', {'email': email, 'password': password})\n        if resp.status_code == 200:\n            token = resp.json().get('token')\n            self.session.headers.update({'Authorization': f'Bearer {token}'})\n        return resp\n`;
}

function buildPytestConfig(opts) {
  return `# pytest.ini\n[pytest]\ntestpaths = tests\naddopts = -v --tb=short${opts.reporter ? ' --html=reports/report.html --self-contained-html' : ''}${opts.parallel ? ' -n auto' : ''}\nmarkers =\n    critical: Critical priority tests\n    high: High priority tests\n    medium: Medium priority tests\n    low: Low priority tests\n    smoke: Smoke tests\n\n# conftest.py\nimport pytest\n\ndef pytest_configure(config):\n    """Register custom markers."""\n    pass\n\n@pytest.fixture(autouse=True)\ndef test_setup_teardown(request):\n    """Global test setup/teardown."""\n    yield\n    # Teardown here if needed\n`;
}

function buildJest(tests, opts) {
  const ts = opts.language === 'typescript';
  const cases = tests.map(t => `test('${t.name}', async () => {\n  // Priority: ${t.priority?.toUpperCase()} | Category: ${t.category}\n  // ${t.description || ''}\n${(t.steps || []).map(s => `  // Step ${s.step}: ${s.action}`).join('\n')}\n\n  // Expected: ${t.expected_result}\n  expect(true).toBe(true); // Replace with real assertions\n});`).join('\n\n');
  return `${ts ? "import axios from 'axios';\n" : "const axios = require('axios');\n"}\nconst BASE_URL = '${opts.base_url}';\n\ndescribe('QAForge Test Suite', () => {\n  let token${ts ? ': string' : ''};\n\n  beforeAll(async () => {\n    // Setup: authenticate if needed\n    // const res = await axios.post(\`\${BASE_URL}/auth/login\`, { email: 'test@qa.com', password: 'Test123!' });\n    // token = res.data.token;\n  });\n\n  beforeEach(() => {\n    axios.defaults.baseURL = BASE_URL;\n    // if (token) axios.defaults.headers.common['Authorization'] = \`Bearer \${token}\`;\n  });\n\n${cases.split('\n').map(l => '  ' + l).join('\n')}\n});\n`;
}

function buildJestPOM(opts) {
  const ts = opts.language === 'typescript';
  return `${ts ? "import axios, { AxiosInstance } from 'axios';\n\nexport class ApiClient {\n  private client: AxiosInstance;\n\n  constructor(baseURL: string) {\n    this.client = axios.create({ baseURL, timeout: 10000 });\n  }\n\n  async get(path: string) {\n    return this.client.get(path);\n  }\n\n  async post(path: string, data: any) {\n    return this.client.post(path, data);\n  }\n\n  async setAuth(token: string) {\n    this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`;\n  }\n}" : "const axios = require('axios');\n\nclass ApiClient {\n  constructor(baseURL) {\n    this.client = axios.create({ baseURL, timeout: 10000 });\n  }\n\n  async get(path) { return this.client.get(path); }\n  async post(path, data) { return this.client.post(path, data); }\n  setAuth(token) { this.client.defaults.headers.common['Authorization'] = `Bearer ${token}`; }\n}\n\nmodule.exports = { ApiClient };"}`;
}

function buildJestConfig(opts) {
  return `// jest.config.${opts.language === 'typescript' ? 'ts' : 'js'}\nmodule.exports = {\n  testEnvironment: 'node',\n  testMatch: ['**/*.test.${opts.language === 'typescript' ? 'ts' : 'js'}'],\n  ${opts.language === 'typescript' ? "transform: { '^.+\\\\.tsx?$': 'ts-jest' }," : ''}\n  testTimeout: 30000,\n  ${opts.reporter ? "reporters: ['default', ['jest-html-reporter', { pageTitle: 'QAForge Report', outputPath: 'reports/test-report.html' }]]," : ''}\n  setupFilesAfterFramework: ['./jest.setup.${opts.language === 'typescript' ? 'ts' : 'js'}'],\n  ${opts.parallel ? '' : 'maxWorkers: 1,'}\n};\n`;
}

function buildPostman(tests, opts) {
  const collection = {
    info: { name: "QAForge Test Suite", description: "Generated by QAForge v5", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    variable: [{ key: "baseUrl", value: opts.base_url }],
    item: tests.map(t => ({
      name: t.name,
      request: {
        method: t.category === 'api' ? "POST" : "GET",
        header: [{ key: "Content-Type", value: "application/json" }],
        url: { raw: "{{baseUrl}}/", host: ["{{baseUrl}}"], path: [""] }
      },
      event: [{
        listen: "test",
        script: {
          type: "text/javascript",
          exec: [
            `// ${t.name}`,
            `// Priority: ${t.priority?.toUpperCase()} | Category: ${t.category}`,
            `// ${t.description || ''}`,
            "",
            `pm.test("${t.name}", function() {`,
            `    // ${t.expected_result}`,
            `    pm.response.to.have.status(200);`,
            `});`,
            "",
            ...(t.steps || []).map(s => `// Step ${s.step}: ${s.action}`),
          ]
        }
      }]
    }))
  };
  return JSON.stringify(collection, null, 2);
}

function buildCI(opts) {
  if (['playwright', 'cypress'].includes(opts.framework)) {
    return `# .github/workflows/tests.yml\nname: QAForge Tests\n\non:\n  push:\n    branches: [main, develop]\n  pull_request:\n    branches: [main]\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-node@v4\n        with:\n          node-version: '20'\n      - name: Install dependencies\n        run: npm ci\n      - name: Install ${opts.framework}\n        run: ${opts.framework === 'playwright' ? 'npx playwright install --with-deps' : 'npx cypress install'}\n      - name: Run tests\n        run: ${opts.framework === 'playwright' ? 'npx playwright test' : 'npx cypress run'}\n      - name: Upload report\n        uses: actions/upload-artifact@v4\n        if: always()\n        with:\n          name: test-report\n          path: ${opts.framework === 'playwright' ? 'playwright-report/' : 'cypress/reports/'}\n`;
  }
  return `# .github/workflows/tests.yml\nname: QAForge Tests\n\non: [push, pull_request]\n\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4\n      - uses: actions/setup-python@v5\n        with:\n          python-version: '3.11'\n      - name: Install dependencies\n        run: pip install -r requirements.txt\n      - name: Run tests\n        run: pytest tests/ -v${opts.reporter ? ' --html=report.html' : ''}\n      - name: Upload report\n        uses: actions/upload-artifact@v4\n        if: always()\n        with:\n          name: test-report\n          path: report.html\n`;
}

function showGeneratedScript(opts, testCount) {
  document.getElementById('autoOut').classList.remove('hidden');
  document.getElementById('autoEmpty').style.display = 'none';
  document.getElementById('autoActs').style.display = 'flex';
  const meta = document.getElementById('scriptMeta');
  meta.innerHTML = `<span>Framework: <b style="color:var(--ac4)">${opts.framework}</b></span><span>Language: <b style="color:var(--ac)">${opts.language}</b></span><span>Tests: <b style="color:var(--ac2)">${testCount}</b></span>`;
  const tabs = document.getElementById('codeTabs');
  tabs.style.display = 'flex';
  document.getElementById('ciTab').style.display = opts.ci ? 'block' : 'none';
  document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
  document.querySelector('.code-tab[data-file="main"]')?.classList.add('active');
  document.getElementById('codeView').textContent = generatedFiles.main || '';
  document.getElementById('demoOut').classList.add('hidden');
  toast(`✓ ${opts.framework} script generated — ${testCount} tests`, 'ok');
}
function switchCodeTab(btn) {
  document.querySelectorAll('.code-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active'); activeCodeFile = btn.dataset.file;
  document.getElementById('codeView').textContent = generatedFiles[activeCodeFile] || '// Not available for this framework';
}
function copyScript() {
  const code = document.getElementById('codeView').textContent;
  if (!code) return;
  navigator.clipboard.writeText(code).then(() => toast('Copied to clipboard!', 'ok')).catch(() => toast('Copy failed', 'err'));
}
function dlScript() {
  const code = document.getElementById('codeView').textContent; if (!code) return;
  const extMap = { playwright: 'spec.js', selenium: 'test.py', cypress: 'spec.js', pytest: 'test_suite.py', jest: 'test.js', postman: 'collection.json' };
  const fileNames = { main: 'test_main', pom: 'page_objects', config: `${curFw}.config`, ci: 'ci.yml' };
  const ext = activeCodeFile === 'ci' ? 'yml' : (activeCodeFile === 'config' ? (curLang === 'python' ? 'ini' : 'js') : (extMap[curFw] || 'js'));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([code], { type: 'text/plain' }));
  a.download = `qaforge-${fileNames[activeCodeFile] || activeCodeFile}-${Date.now()}.${ext}`;
  a.click(); toast('Downloaded', 'ok');
}
function demoRun() {
  if (!generatedFiles.main) return toast('Generate a script first', 'err');
  const out = document.getElementById('demoOut');
  out.classList.remove('hidden'); out.textContent = '';
  const lines = [
    `$ npx ${curFw} test`, ``, `  Environment: ${v('autoBaseUrl') || 'https://yourapp.com'}`,
    `  Framework:   ${curFw} (${curLang})`,
    `  Reporter:    ${document.getElementById('optReporter')?.checked ? 'html' : 'console'}`, ``,
    ...allTests.slice(0, 8).map((t, i) => `  ✓ [${(Math.floor(Math.random() * 600) + 150).toString().padStart(4, '0')}ms] ${t.name}`),
    ``, `  ${allTests.slice(0, 8).length} passed (${(allTests.slice(0, 8).length * 350 / 1000).toFixed(1)}s)`,
    `  HTML Report: ./reports/index.html`, ``, `  ✓ All tests passed`
  ];
  let i = 0;
  const iv = setInterval(() => {
    if (i >= lines.length) { clearInterval(iv); return; }
    out.textContent += lines[i] + '\n'; out.scrollTop = out.scrollHeight; i++;
  }, 100);
}

// ═══════ REPORTS ═══════
async function loadReportList() {
  try {
    const results = await get('/api/results'), el = document.getElementById('reportList');
    if (!results.length) { el.innerHTML = '<div class="empty-sm">No runs yet.</div>'; return; }
    el.innerHTML = [...results].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).map(r => {
      const s = r.summary || {}, rate = s.pass_rate || 0, rc = rate >= 90 ? 'g' : rate >= 70 ? 'o' : 'r';
      return `<div class="report-card${r.run_id === lastRunId ? ' sel' : ''}" onclick="showDetail('${r.run_id}')"><span class="rc-i">${r.status === 'completed' ? '📊' : '⏳'}</span><div class="rc-info"><div class="rc-title">${r.suite_name || 'Run'}</div><div class="rc-meta">${r.run_id.slice(0, 10)} · ${r.environment?.toUpperCase() || ''} · ${r.started_at?.slice(0, 16) || ''}</div></div>${r.status === 'completed' ? `<div class="rc-rate ${rc}">${rate}%</div>` : '<div class="rc-rate" style="color:var(--cm)">…</div>'}</div>`;
    }).join('');
  } catch { }
}
async function showDetail(runId) {
  try {
    const r = await get(`/api/results/${runId}`), s = r.summary || {};
    document.getElementById('reportDetail').style.display = 'flex';
    document.getElementById('rdBody').innerHTML = `
      <div class="ds-grid"><div class="ds-box"><div class="ds-n">${s.total || 0}</div><div class="ds-l">Total</div></div><div class="ds-box"><div class="ds-n" style="color:var(--ac2)">${s.passed || 0}</div><div class="ds-l">Passed</div></div><div class="ds-box"><div class="ds-n" style="color:var(--cr)">${s.failed || 0}</div><div class="ds-l">Failed</div></div><div class="ds-box"><div class="ds-n" style="color:var(--ac)">${s.pass_rate || 0}%</div><div class="ds-l">Rate</div></div></div>
      <div class="sec-lbl" style="margin-top:.8rem">DETAILS</div>
      <div style="font-family:var(--fm);font-size:.61rem;color:var(--t2);line-height:1.8;margin-top:.3rem">Run: ${r.run_id}<br/>Suite: ${r.suite_name || '—'}<br/>Env: ${r.environment?.toUpperCase()}<br/>Started: ${r.started_at?.slice(0, 19)}</div>
      <div style="display:flex;flex-direction:column;gap:4px;margin-top:.8rem">
        <div class="sec-lbl">DOWNLOAD</div>
        <button class="bsm" onclick="dlById('${runId}','html')">⬇ HTML</button>
        <button class="bsm bsm-g" onclick="dlById('${runId}','excel')">⬇ EXCEL + CHARTS</button>
        <button class="bsm" onclick="dlById('${runId}','json')">⬇ JSON</button>
      </div>`;
  } catch (e) { toast(e.message, 'err'); }
}
async function dlById(runId, fmt) { try { const r = await post(`/api/reports/${runId}?fmt=${fmt}`); window.location.href = `/api/reports/download/${r.filename}`; } catch (e) { toast(e.message, 'err'); } }
function closeDetail() { document.getElementById('reportDetail').style.display = 'none'; }

// ═══════ SETTINGS ═══════
async function loadCfgUI() {
  try {
    const cfg = await get('/api/config');
    for (let i = 1; i <= 4; i++) { const el = document.getElementById(`k${i}`); if (el) el.placeholder = cfg[`api_key_${i}`] ? `${cfg[`api_key_${i}`]} (set)` : 'Not configured'; }
    if (cfg.model_status) {
      document.getElementById('cfgChain').innerHTML = Object.entries(cfg.model_status).map(([k, m]) => `<div class="chain-item" style="border-left-color:${k === 'flash' ? '#00e5ff' : k === 'pro' ? '#bf5fff' : k === 'flash15' ? '#39ff14' : '#ff6b35'}"><div class="ci-name">${m.name}</div><div class="ci-use">Slot ${m.slot} · ${m.model_id}</div><div class="ci-st ${!m.has_key ? 'nokey' : m.quota_exhausted ? 'quota' : 'ok'}">${!m.has_key ? '⚠ No key' : m.quota_exhausted ? '✗ Quota' : '✓ Ready'}</div></div>`).join('');
    }
  } catch { }
}
async function saveCfg() {
  const payload = {};
  for (let i = 1; i <= 4; i++) { const val = document.getElementById(`k${i}`)?.value.trim(); if (val && !val.includes('••')) payload[`api_key_${i}`] = val; }
  payload.default_model = v('cfgModel');
  try { const r = await post('/api/config', payload); showCfgMsg(`Saved! ${r.keys_configured} key(s). ${r.api_connected ? '✓ Online' : '⚠ Add a key'}`, true); for (let i = 1; i <= 4; i++) { const el = document.getElementById(`k${i}`); if (el) el.value = ''; } checkHealth(); setTimeout(loadCfgUI, 500); }
  catch (e) { showCfgMsg(e.message, false); }
}
async function resetQuota() { try { await post('/api/quota/reset'); toast('Quota flags reset', 'inf'); checkHealth(); loadCfgUI(); } catch (e) { toast(e.message, 'err'); } }
function showCfgMsg(msg, ok) { const el = document.getElementById('cfgMsg'); el.textContent = msg; el.className = `cfg-msg ${ok ? 'ok' : 'err'}`; setTimeout(() => el.className = 'cfg-msg hidden', 5000); }
function toggleEye(id) { const el = document.getElementById(id); el.type = el.type === 'password' ? 'text' : 'password'; }

// ═══════ UTILS ═══════
async function get(url) { const r = await fetch(url); if (!r.ok) { const e = await r.json().catch(() => ({ detail: 'Error' })); throw new Error(e.detail || `HTTP ${r.status}`); } return r.json(); }
async function post(url, body = null) { const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : null }); if (!r.ok) { const e = await r.json().catch(() => ({ detail: 'Error' })); throw new Error(e.detail || `HTTP ${r.status}`); } return r.json(); }
async function postForm(url, fd) { const r = await fetch(url, { method: 'POST', body: fd }); if (!r.ok) { const e = await r.json().catch(() => ({ detail: 'Upload failed' })); throw new Error(e.detail || `HTTP ${r.status}`); } return r.json(); }
function v(id) { return document.getElementById(id)?.value || ''; }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
function toast(msg, type = 'inf') { const t = document.getElementById('toast'); t.textContent = msg; t.className = `toast ${type}`; clearTimeout(t._t); t._t = setTimeout(() => t.className = 'toast hidden', 3500); }

// ═══════ BUG SCANNER ═══════
async function runBugScan() {
  const desc = v('scanDesc').trim();
  const appType = v('scanType');
  const url = v('scanUrl').trim();
  const cats = [...document.querySelectorAll('#scan-cats .chip.on')].map(c => c.dataset.v);

  // Show loading state
  document.getElementById('scanLoad').classList.remove('hidden');
  document.getElementById('scanEmpty').style.display = 'none';
  document.getElementById('scanOut').classList.add('hidden');
  document.getElementById('srActs').style.display = 'none';

  try {
    const res = await post('/api/scan/bugs', {
      app_type: appType,
      description: desc || null,
      url: url || null,
      depth: curScanDepth,
      categories: cats
    });

    curScanRes = res;
    curScanId = res.scan_id;

    document.getElementById('scanLoad').classList.add('hidden');
    showScanResults(res);
  } catch (e) {
    document.getElementById('scanLoad').classList.add('hidden');
    document.getElementById('scanEmpty').style.display = '';
    toast(e.message, 'err');
  }
}

function showScanResults(res) {
  document.getElementById('scanOut').classList.remove('hidden');
  document.getElementById('srActs').style.display = 'flex';

  // 1. Render Summary
  const riskColor = getRiskColor(res.risk_level);
  document.getElementById('scanSummary').innerHTML = `
    <div class="ss-box">
      <div class="ss-n" style="color:${riskColor}">${(res.risk_level || 'low').toUpperCase()}</div>
      <div class="ss-l">RISK LEVEL</div>
    </div>
    <div class="ss-box">
      <div class="ss-n">${res.total_issues || res.bugs?.length || 0}</div>
      <div class="ss-l">TOTAL ISSUES</div>
    </div>
    <div class="ss-box">
      <div class="ss-n" style="font-size:1.1rem; padding-top:0.4rem;">${(res.depth || 'standard').toUpperCase()}</div>
      <div class="ss-l">DEPTH</div>
    </div>
    <div class="ss-box" style="flex: 1; text-align: left; min-width: 200px;">
      <div class="ss-l" style="margin-top: 0;">SUMMARY</div>
      <div style="font-size: 0.8rem; line-height: 1.4; color: var(--t2); margin-top: 4px;">${res.summary || 'No summary provided.'}</div>
    </div>
  `;

  // 2. Render Filters
  const categories = ['all', ...new Set((res.bugs || []).map(b => (b.category || 'other').toLowerCase()))];
  document.getElementById('bugFilters').innerHTML = categories.map(cat => {
    return `<button class="bfilt ${cat === 'all' ? 'on' : ''}" onclick="filterBugs('${cat}', this)">${cat.toUpperCase()}</button>`;
  }).join('');

  // 3. Render Bugs List
  const bugList = document.getElementById('bugList');
  if (res.bugs && res.bugs.length) {
    bugList.innerHTML = res.bugs.map(bug => {
      const bugColor = getRiskColor(bug.severity);
      const stepsHtml = bug.steps_to_reproduce && bug.steps_to_reproduce.length
        ? `<div class="bug-field" style="flex-direction:column; gap:4px; margin-top:0.5rem;">
             <span class="bf-lbl">STEPS TO REPRODUCE:</span>
             <div style="padding-left: 10px;">
               ${bug.steps_to_reproduce.map((step, idx) => `<div style="margin-bottom:2px;">${idx + 1}. ${step}</div>`).join('')}
             </div>
           </div>`
        : '';

      return `
        <div class="bug-item sev-${(bug.severity || 'low').toLowerCase()}" data-category="${(bug.category || 'other').toLowerCase()}" onclick="toggleBugDetail(this)">
          <div class="bug-top">
            <span class="bug-id">${bug.id || 'BUG'}</span>
            <span class="bug-title">${bug.title || 'Untitled Bug'}</span>
            <span class="bug-prio" style="font-family:var(--fm); font-size:0.7rem; color:${bugColor}; font-weight:bold;">${(bug.severity || 'low').toUpperCase()}</span>
          </div>
          <div class="bug-desc">${bug.description || 'No description provided.'}</div>
          <div class="bug-detail" onclick="event.stopPropagation()">
            ${bug.location ? `<div class="bug-field"><span class="bf-lbl">LOCATION:</span><span>${bug.location}</span></div>` : ''}
            ${bug.impact ? `<div class="bug-field"><span class="bf-lbl">IMPACT:</span><span>${bug.impact}</span></div>` : ''}
            ${bug.cwe ? `<div class="bug-field"><span class="bf-lbl">CWE:</span><span class="cwe">${bug.cwe}</span></div>` : ''}
            ${stepsHtml}
            ${bug.fix_suggestion ? `
              <div class="fix-box">
                <div class="fix-lbl">FIX SUGGESTION</div>
                <div class="fix-txt">${bug.fix_suggestion}</div>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  } else {
    bugList.innerHTML = '<div class="empty-sm">No issues detected.</div>';
  }

  // 4. Render Recommendations
  const recsContainer = document.getElementById('scanRecs');
  if (res.recommendations && res.recommendations.length) {
    recsContainer.innerHTML = `
      <div class="recs-title">RECOMMENDATIONS</div>
      <ul class="rec-list">
        ${res.recommendations.map(rec => `<li class="rec-item">${rec}</li>`).join('')}
      </ul>
    `;
    recsContainer.style.display = 'block';
  } else {
    recsContainer.style.display = 'none';
  }

  toast('✓ Bug scan completed successfully!', 'ok');
}

function getRiskColor(level) {
  const colors = { critical: 'var(--cr)', high: 'var(--ch)', medium: 'var(--cm)', low: 'var(--t3)', info: 'var(--t2)' };
  return colors[(level || '').toLowerCase()] || 'var(--t2)';
}

function filterBugs(category, btn) {
  const container = btn.closest('.bug-filters');
  if (container) {
    container.querySelectorAll('.bfilt').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  }

  const bugItems = document.querySelectorAll('.bug-item');
  bugItems.forEach(item => {
    const itemCat = item.dataset.category;
    if (category === 'all' || itemCat === category) {
      item.style.display = 'block';
    } else {
      item.style.display = 'none';
    }
  });
}

function toggleBugDetail(el) {
  const detail = el.querySelector('.bug-detail');
  if (detail) {
    detail.classList.toggle('open');
  }
}

function dlScan() {
  if (!curScanId) return toast('No scan to download', 'err');
  window.location.href = `/api/scans/${curScanId}/download`;
}

// ═══════ BUG REPORT GENERATOR ═══════
let lastBugReport = null;
let bfImageFile   = null;   // holds the current File/Blob to be submitted
let bfActiveTab   = 'paste'; // paste | upload | text

function toggleBfMod(el) {
  document.querySelectorAll('.bfmod').forEach(m => m.classList.remove('active'));
  el.classList.add('active');
}
function getSelectedModule() {
  const active = document.querySelector('.bfmod.active');
  return active ? active.dataset.v : 'ui';
}

// ── Tab switching ────────────────────────────────────────────────────────────
function switchBfTab(btn, tab) {
  bfActiveTab = tab;
  document.querySelectorAll('.bfin-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.bfin-panel').forEach(p => {
    p.classList.toggle('active', p.id === `bfin-${tab}`);
    p.classList.toggle('hidden', p.id !== `bfin-${tab}`);
  });

  // Move the shared image preview into the active panel
  const preview = document.getElementById('bfImagePreview');
  if (tab === 'paste') {
    document.getElementById('bfin-paste').appendChild(preview);
  } else if (tab === 'upload') {
    document.getElementById('bfin-upload').appendChild(preview);
  }

  // Show supplementary text field only when an image is attached and we're on paste/upload
  _syncExtraDesc();
}

function _syncExtraDesc() {
  const extra = document.getElementById('bfExtraDesc');
  if (bfImageFile && bfActiveTab !== 'text') {
    extra.classList.remove('hidden');
  } else {
    extra.classList.add('hidden');
  }
}

// ── Image preview helper ─────────────────────────────────────────────────────
function _showBfImagePreview(file) {
  bfImageFile = file;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('bfPreviewImg').src = e.target.result;
    document.getElementById('bfImagePreview').classList.remove('hidden');
    // Collapse the drop-zone visual cue
    const zone = document.getElementById('bfin-paste').querySelector('.bfin-drop-zone');
    if (zone) zone.style.display = 'none';
    // For upload tab, hide the drop zone there too
    const uploadZone = document.getElementById('bfin-upload').querySelector('.bfin-drop-zone');
    if (uploadZone) uploadZone.style.display = 'none';
    _syncExtraDesc();
    toast('📎 Screenshot attached — ready to generate report', 'ok');
  };
  reader.readAsDataURL(file);
}

function removeBfImage() {
  bfImageFile = null;
  document.getElementById('bfPreviewImg').src = '';
  document.getElementById('bfImagePreview').classList.add('hidden');
  // Restore drop zones
  document.querySelectorAll('.bfin-drop-zone').forEach(z => z.style.display = '');
  document.getElementById('bfImageInput').value = '';
  _syncExtraDesc();
}

// ── Paste handler ────────────────────────────────────────────────────────────
function handleBfPaste(e) {
  const items = (e.clipboardData || e.originalEvent && e.originalEvent.clipboardData).items;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      _showBfImagePreview(item.getAsFile());
      return;
    }
  }
  toast('No image found in clipboard — try Ctrl+C on a screenshot first', 'err');
}

// ── Drag-and-drop handler ────────────────────────────────────────────────────
function handleBfDrop(e) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('image/')) {
    _showBfImagePreview(file);
    // Switch to the paste panel so the preview is visible
    if (bfActiveTab !== 'paste' && bfActiveTab !== 'upload') {
      const pasteBtn = document.querySelector('.bfin-tab[data-tab="paste"]');
      if (pasteBtn) switchBfTab(pasteBtn, 'paste');
    }
  } else {
    toast('Please drop an image file', 'err');
  }
}

// ── File input handler ───────────────────────────────────────────────────────
function handleBfFileInput(input) {
  const file = input.files[0];
  if (file && file.type.startsWith('image/')) {
    _showBfImagePreview(file);
  } else {
    toast('Please select an image file', 'err');
  }
}

// ── Global paste listener (works anywhere on Bug Report page) ─────────────────
document.addEventListener('paste', e => {
  // Only intercept when we are on the bugformat page
  const page = document.getElementById('p-bugformat');
  if (!page || !page.classList.contains('active')) return;
  // Don't steal paste from text inputs
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  const items = (e.clipboardData || {}).items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      // Switch to paste tab if not already there
      if (bfActiveTab !== 'paste') {
        const btn = document.querySelector('.bfin-tab[data-tab="paste"]');
        if (btn) switchBfTab(btn, 'paste');
      }
      _showBfImagePreview(item.getAsFile());
      return;
    }
  }
});

// ── Main generate function ───────────────────────────────────────────────────
async function runBugFormat() {
  // Determine what inputs are available
  const raw = (document.getElementById('bfRawText').value || '').trim();
  const extraText = (document.getElementById('bfExtraText').value || '').trim();
  const hasImage = !!bfImageFile;
  const hasText  = raw.length >= 5 || extraText.length >= 5;

  if (!hasImage && !hasText) {
    return toast('Please paste/upload a screenshot OR enter a bug description', 'err');
  }
  if (!hasImage && raw.length < 10) {
    return toast('Please provide more detail (min 10 chars) or attach a screenshot', 'err');
  }

  // Show loading
  document.getElementById('bfLoad').classList.remove('hidden');
  document.getElementById('bfEmpty').style.display = 'none';
  document.getElementById('bfOutput').classList.add('hidden');
  document.getElementById('bfActs').style.display = 'none';

  const msgs = hasImage ? [
    'Analysing screenshot…',
    'Extracting visible bug evidence…',
    'Identifying error messages & UI issues…',
    'Inferring reproduction steps from image…',
    'Determining severity & priority…',
    'Structuring for Jira / Azure DevOps…',
    'Generating professional bug report…'
  ] : [
    'Analyzing raw bug statement…',
    'Fixing grammar & spelling…',
    'Converting to professional QA language…',
    'Inferring reproduction steps…',
    'Determining severity & priority…',
    'Structuring for Jira / Azure DevOps…',
    'Generating professional bug report…'
  ];

  let i = 0;
  const iv = setInterval(() => {
    if (document.getElementById('bfLoad').classList.contains('hidden')) return clearInterval(iv);
    document.getElementById('bfLoadSub').textContent = msgs[i++ % msgs.length];
  }, 1100);

  try {
    let res;

    if (hasImage) {
      // ── Image (+ optional text) path ──
      const combined = [raw, extraText].filter(Boolean).join('\n\n');
      const fd = new FormData();
      fd.append('raw_text',    combined);
      fd.append('app_type',    document.getElementById('bfAppType').value);
      fd.append('module',      getSelectedModule());
      const env = document.getElementById('bfEnv').value.trim();
      if (env) fd.append('environment', env);
      fd.append('image', bfImageFile, bfImageFile.name || 'screenshot.png');

      const r = await fetch('/api/format/bug/image', { method: 'POST', body: fd });
      if (!r.ok) {
        const err = await r.json().catch(() => ({ detail: r.statusText }));
        throw new Error(err.detail || 'Server error');
      }
      res = await r.json();
    } else {
      // ── Text-only path (original behaviour unchanged) ──
      const body = {
        raw_text: raw,
        app_type: document.getElementById('bfAppType').value,
        module:   getSelectedModule(),
      };
      const env = document.getElementById('bfEnv').value.trim();
      if (env) body.environment = env;
      res = await post('/api/format/bug', body);
    }

    lastBugReport = res;
    clearInterval(iv);
    document.getElementById('bfLoad').classList.add('hidden');
    showBugReport(res);

    // Show Regenerate button
    document.getElementById('bfRegenBtn').style.display = '';
  } catch (e) {
    clearInterval(iv);
    document.getElementById('bfLoad').classList.add('hidden');
    document.getElementById('bfEmpty').style.display = '';
    toast(e.message, 'err');
  }
}


function showBugReport(r) {
  document.getElementById('bfOutput').classList.remove('hidden');
  document.getElementById('bfActs').style.display = 'flex';

  // Severity colors
  const sevColors = {
    critical: 'var(--cr)', high: 'var(--ch)', medium: 'var(--cm)', low: 'var(--t3)'
  };
  const sevColor = sevColors[(r.severity || '').toLowerCase()] || 'var(--t2)';

  // Header badges
  document.getElementById('bfHeaderRow').innerHTML = `
    <div class="bugfmt-badge-row">
      <span class="bugfmt-id">${r.bug_id || 'BUG-001'}</span>
      <span class="bugfmt-sev" style="border-color:${sevColor};color:${sevColor}">${(r.severity || 'medium').toUpperCase()}</span>
      <span class="bugfmt-prio">${r.priority || 'P2'}</span>
      <span class="bugfmt-model">AI: ${r.model_used || 'Gemini'}</span>
    </div>
  `;

  // Build report sections — Severity & Priority first, then Title, Description, Steps, Expected, Actual
  const sections = [
    { label: 'SEVERITY', value: (r.severity || 'Medium').toUpperCase(), cls: 'bugfmt-sev-val', sevLevel: r.severity },
    { label: 'PRIORITY', value: r.priority || 'P2', cls: 'bugfmt-prio-val' },
    { label: 'BUG TITLE', value: r.bug_title, cls: 'bugfmt-title-val' },
    { label: 'BUG DESCRIPTION', value: r.bug_description, cls: 'bugfmt-desc-val' },
    { label: 'STEPS TO REPRODUCE', value: r.steps_to_reproduce, type: 'steps' },
    { label: 'EXPECTED RESULTS', value: r.expected_results, cls: 'bugfmt-expected' },
    { label: 'ACTUAL RESULTS', value: r.actual_results, cls: 'bugfmt-actual' },
  ];

  // Optional sections
  if (r.environment) sections.push({ label: 'ENVIRONMENT', value: r.environment, cls: 'bugfmt-env-val' });
  if (r.additional_notes) sections.push({ label: 'ADDITIONAL NOTES', value: r.additional_notes, cls: 'bugfmt-notes-val' });

  document.getElementById('bfReport').innerHTML = sections.map(s => {
    if (s.type === 'steps') {
      const steps = Array.isArray(s.value) ? s.value : [s.value];
      return `<div class="bugfmt-section">
        <div class="bugfmt-label">${s.label}</div>
        <div class="bugfmt-steps">${steps.map((st, i) => `<div class="bugfmt-step"><span class="bugfmt-step-n">${i + 1}</span><span class="bugfmt-step-text">${st}</span></div>`).join('')}</div>
      </div>`;
    }
    // Severity field with color
    if (s.sevLevel) {
      const sc = sevColors[(s.sevLevel || '').toLowerCase()] || 'var(--t2)';
      return `<div class="bugfmt-section bugfmt-inline-row">
        <div class="bugfmt-label">${s.label}</div>
        <div class="${s.cls}" style="color:${sc};font-weight:700">${s.value}</div>
      </div>`;
    }
    return `<div class="bugfmt-section">
      <div class="bugfmt-label">${s.label}</div>
      <div class="${s.cls || 'bugfmt-val'}">${s.value || '—'}</div>
    </div>`;
  }).join('');

  toast('✓ Professional bug report generated — ready to copy!', 'ok');
}

function copyBugReport() {
  if (!lastBugReport) return toast('No report to copy', 'err');
  const r = lastBugReport;
  const steps = Array.isArray(r.steps_to_reproduce) ? r.steps_to_reproduce.map((s, i) => `${i + 1}. ${s}`).join('\n') : r.steps_to_reproduce;
  const text = `Severity: ${(r.severity || 'Medium').toUpperCase()}
Priority: ${r.priority || 'P2'}

Bug Title: ${r.bug_title}

Bug Description:
${r.bug_description}

Steps to Reproduce:
${steps}

Expected Results:
${r.expected_results}

Actual Results:
${r.actual_results}${r.environment ? `\n\nEnvironment:\n${r.environment}` : ''}${r.additional_notes ? `\n\nAdditional Notes:\n${r.additional_notes}` : ''}`;

  navigator.clipboard.writeText(text).then(() => {
    toast('✓ Bug report copied to clipboard — paste into Jira, Azure DevOps, or any tracker!', 'ok');
    // Brief visual feedback on copy buttons
    document.querySelectorAll('.bugfmt-copy-big, .bugfmt-copy-main').forEach(btn => {
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      btn.style.background = 'var(--ac2)';
      btn.style.color = '#000';
      setTimeout(() => { btn.textContent = orig; btn.style.background = ''; btn.style.color = ''; }, 1500);
    });
  });
}

function downloadBugReport() {
  if (!lastBugReport) return toast('No report to download', 'err');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(lastBugReport, null, 2)], { type: 'application/json' }));
  a.download = `qaforge-bug-${lastBugReport.bug_id || 'report'}-${Date.now()}.json`;
  a.click();
  toast('Bug report downloaded as JSON', 'ok');
}

// ══════════ SEO, AEO & GEO AUDIT ══════════
window.activeSeoScan = null;
window.lastSeoAuditResult = null;
window.activeAeoScan = null;
window.lastAeoAuditResult = null;

function switchSeoSubtab(subtab) {
  const btnSeo = document.getElementById('subtabSeo');
  const btnAeo = document.getElementById('subtabAeoGeo');
  const pnlSeo = document.getElementById('seoSectionPanel');
  const pnlAeo = document.getElementById('aeoSectionPanel');

  const seoUrl = document.getElementById('seoUrlInput');
  const aeoUrl = document.getElementById('aeoUrlInput');

  if (subtab === 'aeo_geo') {
    if (btnSeo) btnSeo.classList.remove('active');
    if (btnAeo) btnAeo.classList.add('active');
    if (pnlSeo) pnlSeo.classList.add('hidden');
    if (pnlAeo) pnlAeo.classList.remove('hidden');

    if (seoUrl && aeoUrl && !aeoUrl.value && seoUrl.value) {
      aeoUrl.value = seoUrl.value;
    }
    initAeoGeoAudit();
  } else {
    if (btnAeo) btnAeo.classList.remove('active');
    if (btnSeo) btnSeo.classList.add('active');
    if (pnlAeo) pnlAeo.classList.add('hidden');
    if (pnlSeo) pnlSeo.classList.remove('hidden');

    if (seoUrl && aeoUrl && !seoUrl.value && aeoUrl.value) {
      seoUrl.value = aeoUrl.value;
    }
    initSeoAuditInternal();
  }
}

function initSeoAudit() {
  const aeoPanel = document.getElementById('aeoSectionPanel');
  if (aeoPanel && !aeoPanel.classList.contains('hidden')) {
    initAeoGeoAudit();
    return;
  }
  initSeoAuditInternal();
}

function initSeoAuditInternal() {
  const savedActive = window.activeSeoScan || JSON.parse(sessionStorage.getItem('qaforge_active_seo') || 'null');
  const btn = document.getElementById('seoRunBtn');
  const load = document.getElementById('seoLoad');
  const out = document.getElementById('seoResults');
  const pdfBtn = document.getElementById('seoPdfBtn');

  if (savedActive && window.activeSeoScan) {
    // Audit is currently in progress
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ SCANNING…'; }
    if (load) load.classList.remove('hidden');
    if (out) out.classList.add('hidden');
    if (pdfBtn) pdfBtn.classList.add('hidden');
    const input = document.getElementById('seoUrlInput');
    if (input && savedActive.url && !input.value) input.value = savedActive.url;
  } else if (window.lastSeoAuditResult) {
    if (out && (!out.innerHTML.trim() || out.classList.contains('hidden'))) {
      renderSeoResults(window.lastSeoAuditResult);
      out.classList.remove('hidden');
      if (pdfBtn) pdfBtn.classList.remove('hidden');
      if (load) load.classList.add('hidden');
    }
  } else {
    const cached = sessionStorage.getItem('qaforge_last_seo_res');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        window.lastSeoAuditResult = parsed;
        if (out && (!out.innerHTML.trim() || out.classList.contains('hidden'))) {
          renderSeoResults(parsed);
          out.classList.remove('hidden');
          if (pdfBtn) pdfBtn.classList.remove('hidden');
          if (load) load.classList.add('hidden');
        }
      } catch (_) {}
    }
  }
}

function initAeoGeoAudit() {
  const out = document.getElementById('aeoResults');
  const pdfBtn = document.getElementById('aeoPdfBtn');
  const load = document.getElementById('aeoLoad');
  const btn = document.getElementById('aeoRunBtn');

  if (window.activeAeoScan) {
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ AUDITING AI SIGNALS…'; }
    if (load) load.classList.remove('hidden');
    if (out) out.classList.add('hidden');
    if (pdfBtn) pdfBtn.classList.add('hidden');
  } else if (window.lastAeoAuditResult) {
    if (out && (!out.innerHTML.trim() || out.classList.contains('hidden'))) {
      renderAeoGeoResults(window.lastAeoAuditResult);
      out.classList.remove('hidden');
      if (pdfBtn) pdfBtn.classList.remove('hidden');
      if (load) load.classList.add('hidden');
    }
  } else {
    const cached = sessionStorage.getItem('qaforge_last_aeo_res');
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        window.lastAeoAuditResult = parsed;
        if (out && (!out.innerHTML.trim() || out.classList.contains('hidden'))) {
          renderAeoGeoResults(parsed);
          out.classList.remove('hidden');
          if (pdfBtn) pdfBtn.classList.remove('hidden');
          if (load) load.classList.add('hidden');
        }
      } catch (_) {}
    }
  }
}

async function runAeoGeoAudit() {
  let url = document.getElementById('aeoUrlInput').value.trim();
  const query = document.getElementById('aeoQueryInput').value.trim();
  if (!url) return alert('Please enter a website URL');

  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
    document.getElementById('aeoUrlInput').value = url;
  }

  const btn = document.getElementById('aeoRunBtn');
  const load = document.getElementById('aeoLoad');
  const out = document.getElementById('aeoResults');
  const pdfBtn = document.getElementById('aeoPdfBtn');

  // Clear any stray overlays
  document.querySelectorAll('.html2pdf__overlay').forEach(el => el.remove());

  btn.disabled = true;
  const origBtnText = 'RUN AEO & GEO SCAN';
  btn.innerHTML = '⏳ AUDITING AI SIGNALS…';
  load.classList.remove('hidden');
  out.classList.add('hidden');
  if (pdfBtn) pdfBtn.classList.add('hidden');

  window.activeAeoScan = { url, query, startTime: Date.now() };

  try {
    let res = null;
    try {
      res = await post('/api/audit/aeo-geo', { url, target_query: query });
    } catch (fetchErr) {
      console.warn('[AEO/GEO] Direct connection interrupted, polling status...', fetchErr);
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(r => setTimeout(r, 2500));
        try {
          const st = await fetch(`/api/audit/aeo-geo/status?url=${encodeURIComponent(url)}&target_query=${encodeURIComponent(query)}`).then(r => r.json());
          if (st && st.status === 'completed' && st.result) {
            res = st.result;
            break;
          } else if (st && st.status === 'failed') {
            throw new Error(st.error || 'AEO/GEO scan failed on server');
          }
        } catch (pollErr) {
          if (attempt > 35) throw pollErr;
        }
      }
      if (!res) throw fetchErr;
    }

    if (!res || typeof res !== 'object') throw new Error('Server returned empty response');

    window.lastAeoAuditResult = res;
    try { sessionStorage.setItem('qaforge_last_aeo_res', JSON.stringify(res)); } catch (_) {}

    renderAeoGeoResults(res);
    out.classList.remove('hidden');
    if (pdfBtn) pdfBtn.classList.remove('hidden');
    toast(`✓ AEO & GEO scan for ${url} completed!`, 'ok');
  } catch (e) {
    console.error('[AEO/GEO] Scan error:', e);
    out.innerHTML = `
      <div class="empty-st" style="padding:2.5rem; text-align:center;">
        <div style="font-size:1.3rem; margin-bottom:0.5rem; color:var(--cr);">⚠ Scan Interrupted</div>
        <p style="color:var(--t2); margin-bottom:1.2rem;">${_escapeHtml(e.message || 'The AEO/GEO scan was disrupted.')}</p>
        <button class="btn-primary" onclick="runAeoGeoAudit()">Retry AEO/GEO Scan</button>
      </div>`;
    out.classList.remove('hidden');
    toast('AEO/GEO Audit error: ' + (e.message || 'Scan disrupted'), 'err');
  } finally {
    window.activeAeoScan = null;
    btn.disabled = false;
    btn.innerHTML = origBtnText;
    load.classList.add('hidden');
  }
}

async function runSeoAudit() {
  const url = document.getElementById('seoUrlInput').value.trim();
  const depth = document.getElementById('seoDepthSelect').value;
  if (!url) return alert('Please enter a website URL');

  const btn = document.getElementById('seoRunBtn');
  const load = document.getElementById('seoLoad');
  const out = document.getElementById('seoResults');
  const pdfBtn = document.getElementById('seoPdfBtn');
  const seoTab = document.querySelector('[data-p="seoaudit"]');

  // Immediately remove any dangling overlay left by html2pdf
  document.querySelectorAll('.html2pdf__overlay').forEach(el => el.remove());

  window.activeSeoScan = { url, depth, startTime: Date.now() };
  try { sessionStorage.setItem('qaforge_active_seo', JSON.stringify(window.activeSeoScan)); } catch (_) {}

  btn.disabled = true;
  const origBtnText = 'RUN SCAN';
  btn.innerHTML = '⏳ SCANNING…';
  load.classList.remove('hidden');
  out.classList.add('hidden');
  pdfBtn.classList.add('hidden');
  if (seoTab) seoTab.setAttribute('data-scanning', 'true');

  try {
    let res = null;
    try {
      res = await post('/api/audit/seo', { url, depth });
    } catch (fetchErr) {
      console.warn('[SEO] Direct connection interrupted, polling server background scan...', fetchErr);
      // If browser tab throttling or network interrupted the HTTP connection,
      // poll the server status because the server scan task continues running in background
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise(r => setTimeout(r, 2500));
        try {
          const st = await fetch(`/api/audit/seo/status?url=${encodeURIComponent(url)}&depth=${depth}`).then(r => r.json());
          if (st && st.status === 'completed' && st.result) {
            res = st.result;
            break;
          } else if (st && st.status === 'failed') {
            throw new Error(st.error || 'Scan failed on server');
          }
        } catch (pollErr) {
          if (attempt > 35) throw pollErr;
        }
      }
      if (!res) throw fetchErr;
    }

    if (!res || typeof res !== 'object') throw new Error('Server returned empty response');

    window.lastSeoAuditResult = res;
    try { sessionStorage.setItem('qaforge_last_seo_res', JSON.stringify(res)); } catch (_) {}

    try {
      renderSeoResults(res);
    } catch (renderErr) {
      console.error('[SEO] Render error:', renderErr, res);
      out.innerHTML = `<div class="empty-st" style="color:var(--cr)">⚠ Display error: ${renderErr.message}<br><small>Check the browser console for details.</small></div>`;
    }
    out.classList.remove('hidden');
    pdfBtn.classList.remove('hidden');

    // If user is currently on another tab/task, notify them nicely
    const curActive = document.querySelector('.page.active');
    if (curActive && curActive.id !== 'p-seoaudit') {
      toast(`✓ SEO Audit for ${url} completed!`, 'ok');
    }
  } catch (e) {
    console.error('[SEO] Scan error:', e);
    out.innerHTML = `
      <div class="empty-st" style="padding:2.5rem; text-align:center;">
        <div style="font-size:1.3rem; margin-bottom:0.5rem; color:var(--cr);">⚠ Scan Interrupted</div>
        <p style="color:var(--t2); margin-bottom:1.2rem;">${_escapeHtml(e.message || 'The scan was disrupted.')}</p>
        <button class="btn-primary" onclick="runSeoAudit()">Retry Scan</button>
      </div>`;
    out.classList.remove('hidden');
    toast('SEO Audit error: ' + (e.message || 'Scan disrupted'), 'err');
  } finally {
    window.activeSeoScan = null;
    try { sessionStorage.removeItem('qaforge_active_seo'); } catch (_) {}
    if (seoTab) seoTab.removeAttribute('data-scanning');
    btn.disabled = false;
    btn.innerHTML = origBtnText;
    load.classList.add('hidden');
    document.querySelectorAll('.html2pdf__overlay').forEach(el => el.remove());
  }
}

// Check server status when returning to the tab from background
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && window.activeSeoScan) {
    const scan = window.activeSeoScan;
    fetch(`/api/audit/seo/status?url=${encodeURIComponent(scan.url)}&depth=${scan.depth}`)
      .then(r => r.json())
      .then(st => {
        if (st && st.status === 'completed' && st.result) {
          window.activeSeoScan = null;
          try { sessionStorage.removeItem('qaforge_active_seo'); } catch (_) {}
          window.lastSeoAuditResult = st.result;
          try { sessionStorage.setItem('qaforge_last_seo_res', JSON.stringify(st.result)); } catch (_) {}
          renderSeoResults(st.result);
          const out = document.getElementById('seoResults');
          const load = document.getElementById('seoLoad');
          const btn = document.getElementById('seoRunBtn');
          const pdfBtn = document.getElementById('seoPdfBtn');
          const seoTab = document.querySelector('[data-p="seoaudit"]');
          if (out) out.classList.remove('hidden');
          if (load) load.classList.add('hidden');
          if (pdfBtn) pdfBtn.classList.remove('hidden');
          if (btn) { btn.disabled = false; btn.innerHTML = 'RUN SCAN'; }
          if (seoTab) seoTab.removeAttribute('data-scanning');
          toast(`✓ SEO Audit for ${scan.url} ready!`, 'ok');
        }
      })
      .catch(() => {});
  }
});

function _seoVal(val, fallback) {
  if (val === null || val === undefined) return `<em class="seo-missing">Missing</em>`;
  if (val === '') return `<em class="seo-empty">Empty (present but empty)</em>`;
  return `<span class="seo-val-text">${String(val).replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
}
function _seoIssueList(issues) {
  if (!issues || !issues.length) return `<span class="seo-ok">✓ No issues</span>`;
  return issues.map(i => {
    const prefix = i.split(':')[0];
    const cls = prefix.includes('MISSING') ? 'seo-issue-missing' :
                prefix.includes('MULTIPLE') ? 'seo-issue-mult' :
                prefix.includes('EMPTY') ? 'seo-issue-empty' :
                prefix.includes('TOO_') ? 'seo-issue-length' : 'seo-issue-warn';
    return `<span class="seo-issue-tag ${cls}">${i.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</span>`;
  }).join('');
}

function _escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const seoTableState = {
  seoImagesTableBody: { filter: 'all', query: '' },
  seoLinksTableBody: { filter: 'all', query: '' }
};

window.applySeoTableFilters = function(targetTbodyId) {
  const tbody = document.getElementById(targetTbodyId);
  if (!tbody) return;
  const state = seoTableState[targetTbodyId] || { filter: 'all', query: '' };
  const rows = tbody.querySelectorAll('.seo-data-row');
  let visibleCount = 0;
  const q = (state.query || '').toLowerCase().trim();

  rows.forEach(r => {
    let matchFilter = true;
    if (state.filter && state.filter !== 'all') {
      const filters = (r.getAttribute('data-filter') || '').split(' ');
      matchFilter = filters.includes(state.filter);
    }

    let matchQuery = true;
    if (q) {
      const aHref = r.querySelector('a')?.getAttribute('href') || '';
      const aTitle = r.querySelector('a')?.getAttribute('title') || '';
      const imgSrc = r.querySelector('img')?.getAttribute('src') || '';
      const fullSearchable = (r.textContent + ' ' + aHref + ' ' + aTitle + ' ' + imgSrc).toLowerCase();
      matchQuery = fullSearchable.includes(q);
    }

    const show = matchFilter && matchQuery;
    r.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });

  const countElId = targetTbodyId === 'seoImagesTableBody' ? 'seoImagesCount' : 'seoLinksCount';
  const countEl = document.getElementById(countElId);
  if (countEl) {
    countEl.textContent = `Showing ${visibleCount} of ${rows.length}`;
  }
};

window.filterSeoTable = function(targetTbodyId, filterKey, btnEl) {
  if (!seoTableState[targetTbodyId]) seoTableState[targetTbodyId] = { filter: 'all', query: '' };
  seoTableState[targetTbodyId].filter = filterKey || 'all';

  if (btnEl && btnEl.parentElement) {
    btnEl.parentElement.querySelectorAll('.seo-filter-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }
  applySeoTableFilters(targetTbodyId);
};

window.searchSeoTable = function(targetTbodyId, query) {
  if (!seoTableState[targetTbodyId]) seoTableState[targetTbodyId] = { filter: 'all', query: '' };
  seoTableState[targetTbodyId].query = query || '';
  applySeoTableFilters(targetTbodyId);
};

let seoFindingsFilterState = { filter: 'all', query: '' };

window.filterSeoFindings = function(filterType, btnEl) {
  if (filterType !== undefined) {
    seoFindingsFilterState.filter = filterType;
    if (btnEl && btnEl.parentElement) {
      btnEl.parentElement.querySelectorAll('.seo-filter-btn').forEach(b => b.classList.remove('active'));
      btnEl.classList.add('active');
    }
  }

  const searchInput = document.getElementById('seoFindingsSearch');
  const q = searchInput ? searchInput.value.toLowerCase().trim() : '';
  seoFindingsFilterState.query = q;

  const currentFilter = seoFindingsFilterState.filter;
  const phases = document.querySelectorAll('.seo-phase-findings');
  let totalIssues = 0;
  let visibleIssues = 0;

  phases.forEach(phase => {
    const issues = phase.querySelectorAll('.seo-issue');
    let phaseVisibleCount = 0;

    issues.forEach(issue => {
      totalIssues++;
      const statusBadge = issue.querySelector('.badge');
      const statusText = statusBadge ? statusBadge.textContent.toUpperCase().trim() : '';
      const isPass = statusText === 'PASS';
      const isFail = statusText === 'FAIL';
      const sevClass = statusBadge ? statusBadge.className : '';
      const isCriticalOrHigh = sevClass.includes('sev-critical') || sevClass.includes('sev-high');

      let matchFilter = true;
      if (currentFilter === 'fail') matchFilter = isFail || !isPass;
      else if (currentFilter === 'pass') matchFilter = isPass;
      else if (currentFilter === 'critical') matchFilter = isCriticalOrHigh;

      let matchQuery = true;
      if (q) {
        matchQuery = issue.textContent.toLowerCase().includes(q);
      }

      const show = matchFilter && matchQuery;
      issue.style.display = show ? '' : 'none';
      if (show) {
        visibleIssues++;
        phaseVisibleCount++;
      }
    });

    phase.style.display = phaseVisibleCount > 0 ? '' : 'none';
  });

  const countEl = document.getElementById('seoFindingsCount');
  if (countEl) {
    countEl.textContent = `Showing ${visibleIssues} of ${totalIssues} checks`;
  }
};

window.toggleSeoSection = function(sectionId, headerEl) {
  const el = document.getElementById(sectionId);
  if (!el) return;
  const isHidden = el.classList.contains('hidden');
  if (isHidden) {
    el.classList.remove('hidden');
    if (headerEl) headerEl.classList.add('open');
  } else {
    el.classList.add('hidden');
    if (headerEl) headerEl.classList.remove('open');
  }
};

window.openSeoInspector = function(cardId, bodyId) {
  const card = document.getElementById(cardId);
  const body = document.getElementById(bodyId);
  if (body && body.classList.contains('hidden')) {
    body.classList.remove('hidden');
    const hdr = card ? card.querySelector('.seo-inspector-hdr') : null;
    if (hdr) hdr.classList.add('open');
  }
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
};

function _renderImagesTable(images) {
  if (!images || !images.length) {
    return `<div class="empty-st" style="padding:1.5rem;text-align:center;">No images detected on this page.</div>`;
  }
  const rows = images.map((img, idx) => {
    const src = img.abs_src || img.src || '';
    const isMissingAlt = !img.alt_present;
    const isEmptyAlt = img.alt_present && img.alt === "";
    const isMissingTitle = !img.title_present;
    const isEmptyTitle = img.title_present && img.title === "";

    let altDisplay = '';
    if (isMissingAlt) {
      altDisplay = '<span class="seo-issue-tag seo-issue-missing">MISSING ALT</span>';
    } else if (isEmptyAlt) {
      altDisplay = '<span class="seo-issue-tag seo-issue-empty">EMPTY (alt="")</span>';
    } else {
      altDisplay = `<span class="seo-val-text font-mono" style="font-size:0.75rem;">${_escapeHtml(img.alt)}</span>`;
    }

    let titleDisplay = '';
    if (isMissingTitle) {
      titleDisplay = '<span class="seo-issue-tag seo-issue-missing">MISSING TITLE</span>';
    } else if (isEmptyTitle) {
      titleDisplay = '<span class="seo-issue-tag seo-issue-empty">EMPTY (title="")</span>';
    } else {
      titleDisplay = `<span class="seo-val-text font-mono" style="font-size:0.75rem;">${_escapeHtml(img.title)}</span>`;
    }

    const dims = (img.width && img.height) 
      ? `<span class="font-mono">${img.width}×${img.height}</span>` 
      : '<span class="seo-issue-tag seo-issue-warn">Unset</span>';

    const filterFlags = [];
    if (isMissingAlt) filterFlags.push('missing-alt');
    if (isEmptyAlt) filterFlags.push('empty-alt');
    if (isMissingTitle) filterFlags.push('missing-title');
    if (img.issues && img.issues.length) filterFlags.push('issues');
    if (!isMissingAlt && !isMissingTitle && !isEmptyAlt) filterFlags.push('valid');

    return `
      <tr class="seo-data-row" data-filter="${filterFlags.join(' ')}">
        <td style="width:30px;font-family:var(--font-mono);color:var(--t3);text-align:center;">${idx + 1}</td>
        <td style="width:50px;">
          <div class="seo-img-thumb-wrap">
            <img src="${_escapeHtml(src)}" class="seo-img-thumb" loading="lazy" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=\\'font-size:0.65rem;color:var(--t3)\\'>[N/A]</span>'" alt="${_escapeHtml(img.alt||'')}">
          </div>
        </td>
        <td style="max-width:240px;word-break:break-all;">
          <a href="${_escapeHtml(src)}" target="_blank" rel="noopener" class="tb-url" title="${_escapeHtml(src)}">${_escapeHtml(src.length > 55 ? src.substring(0, 52) + '...' : src)}</a>
        </td>
        <td>${altDisplay}</td>
        <td>${titleDisplay}</td>
        <td style="white-space:nowrap;font-size:0.75rem;">${dims}</td>
        <td>${_seoIssueList(img.issues)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="seo-table-scroll">
      <table class="seo-inspector-table">
        <thead>
          <tr>
            <th style="width:30px;text-align:center;">#</th>
            <th style="width:50px;">Preview</th>
            <th>Source URL (src)</th>
            <th>ALT Attribute</th>
            <th>TITLE Attribute</th>
            <th>Dimensions</th>
            <th>Issues Detected</th>
          </tr>
        </thead>
        <tbody id="seoImagesTableBody">
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function _renderLinksTable(links) {
  if (!links || !links.length) {
    return `<div class="empty-st" style="padding:1.5rem;text-align:center;">No links evaluated on this page.</div>`;
  }
  const rows = links.map((l, idx) => {
    const href = l.abs_href || l.href || '';
    const isMissingTitle = !l.title_present;
    const isEmptyTitle = l.title_present && l.title === "";

    let titleDisplay = '';
    if (isMissingTitle) {
      titleDisplay = '<span class="seo-issue-tag seo-issue-missing">MISSING TITLE</span>';
    } else if (isEmptyTitle) {
      titleDisplay = '<span class="seo-issue-tag seo-issue-empty">EMPTY (title="")</span>';
    } else {
      titleDisplay = `<span class="seo-val-text font-mono" style="font-size:0.75rem;">${_escapeHtml(l.title)}</span>`;
    }

    let anchorDisplay = '';
    if (!l.anchor_text && !l.has_img) {
      anchorDisplay = '<span class="seo-issue-tag seo-issue-missing">EMPTY ANCHOR</span>';
    } else {
      anchorDisplay = `<span class="seo-val-text">${_escapeHtml(l.anchor_text || '')}</span>`;
    }

    let imgAltDisplay = '<span style="color:var(--t3);font-size:0.75rem;">— (Text link)</span>';
    if (l.has_img) {
      if (!l.img_alt_present) {
        imgAltDisplay = '<span class="seo-issue-tag seo-issue-missing">INNER IMG MISSING ALT</span>';
      } else if (l.img_alt === '') {
        imgAltDisplay = '<span class="seo-issue-tag seo-issue-empty">INNER IMG EMPTY (alt="")</span>';
      } else {
        imgAltDisplay = `<span class="seo-val-text font-mono" style="font-size:0.75rem;">🖼 ${_escapeHtml(l.img_alt)}</span>`;
      }
    }

    const typeBadge = l.is_internal 
      ? '<span class="seo-link-type-badge seo-link-internal">Internal</span>' 
      : '<span class="seo-link-type-badge seo-link-external">External</span>';
    const relBadges = (l.rel || []).map(r => `<span class="seo-issue-tag" style="background:var(--s);border:1px solid var(--b);">${_escapeHtml(r)}</span>`).join(' ');

    const filterFlags = [];
    if (isMissingTitle) filterFlags.push('missing-title');
    if (l.has_img && (!l.img_alt_present || l.img_alt === '')) filterFlags.push('missing-alt');
    if (!l.anchor_text && !l.has_img) filterFlags.push('empty-anchor');
    if (l.is_internal) filterFlags.push('internal');
    if (!l.is_internal) filterFlags.push('external');
    if (l.issues && l.issues.length) filterFlags.push('issues');

    return `
      <tr class="seo-data-row" data-filter="${filterFlags.join(' ')}">
        <td style="width:30px;font-family:var(--font-mono);color:var(--t3);text-align:center;">${idx + 1}</td>
        <td style="white-space:nowrap;">${typeBadge} ${relBadges}</td>
        <td style="max-width:240px;word-break:break-all;">
          <a href="${_escapeHtml(href)}" target="_blank" rel="noopener" class="tb-url" title="${_escapeHtml(href)}">${_escapeHtml(href.length > 55 ? href.substring(0, 52) + '...' : href)}</a>
        </td>
        <td>${anchorDisplay}</td>
        <td>${titleDisplay}</td>
        <td>${imgAltDisplay}</td>
        <td>${_seoIssueList(l.issues)}</td>
      </tr>
    `;
  }).join('');

  return `
    <div class="seo-table-scroll">
      <table class="seo-inspector-table">
        <thead>
          <tr>
            <th style="width:30px;text-align:center;">#</th>
            <th>Type & Rel</th>
            <th>Target URL (href)</th>
            <th>Anchor Text</th>
            <th>TITLE Attribute</th>
            <th>Image Link ALT</th>
            <th>Issues</th>
          </tr>
        </thead>
        <tbody id="seoLinksTableBody">
          ${rows}
        </tbody>
      </table>
    </div>
  `;
}

function _formatSeoItem(item) {
  if (!item) return '';
  if (typeof item === 'string') return _escapeHtml(item);
  if (typeof item === 'object') {
    const prio = item.priority ? `<span class="badge ${item.priority.toLowerCase() === 'critical' ? 'sev-critical' : item.priority.toLowerCase() === 'high' ? 'sev-high' : 'sev-medium'}" style="margin-right:0.4rem; padding: 2px 6px; font-size: 0.7rem; border-radius: 3px;">${_escapeHtml(item.priority)}</span>` : '';
    const cat = item.category ? `<span style="color:var(--t3); font-size:0.8rem; margin-right:0.4rem;">[${_escapeHtml(item.category)}]</span>` : '';
    const title = (item.issue || item.check_name || item.title) ? `<strong>${_escapeHtml(item.issue || item.check_name || item.title)}:</strong> ` : '';
    const desc = _escapeHtml(item.action || item.recommendation || item.description || item.detail || JSON.stringify(item));
    return `${prio}${cat}${title}${desc}`;
  }
  return _escapeHtml(String(item));
}

function renderSeoResults(data) {
  const out = document.getElementById('seoResults');
  out.innerHTML = '';
  
  if (!data || typeof data !== 'object') {
    out.innerHTML = `
      <div class="empty-st" style="padding:2.5rem; text-align:center;">
        <div style="font-size:1.4rem; margin-bottom:0.5rem; color:var(--cr);">⚠ Scan Incomplete</div>
        <p style="color:var(--t2); margin-bottom:1.2rem;">The server could not return report data. Please check the URL and run the scan again.</p>
        <button class="btn-primary" onclick="runSeoAudit()">Run Scan Again</button>
      </div>`;
    return;
  }

  // Synthesize executive_summary if missing or incomplete
  if (!data.executive_summary || typeof data.executive_summary !== 'object') {
    const findings = [];
    const phasesSrc = (data.phases && typeof data.phases === 'object') ? { ...data.phases, ...data } : data;
    Object.values(phasesSrc).forEach(ph => {
      if (ph && Array.isArray(ph.findings)) findings.push(...ph.findings);
    });
    const totalChecks = findings.length;
    const passedChecks = findings.filter(f => (f.status || '').toLowerCase() === 'pass').length;
    const healthScore = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 70;
    data.executive_summary = {
      overall_health_score: healthScore,
      technical_seo_score: healthScore,
      performance_score: healthScore,
      csp_security_score: healthScore,
      accessibility_score: healthScore,
      top_critical_issues: findings.filter(f => (f.status || '').toLowerCase() === 'fail' && (f.severity || '').toLowerCase() === 'critical').map(f => f.description || f.check_name).slice(0, 3),
      top_high_priority_issues: findings.filter(f => (f.status || '').toLowerCase() === 'fail' && (f.severity || '').toLowerCase() === 'high').map(f => f.description || f.check_name).slice(0, 3),
      top_quick_wins: findings.filter(f => (f.status || '').toLowerCase() === 'fail').map(f => f.recommendation || f.check_name).filter(Boolean).slice(0, 3),
      positive_findings: findings.filter(f => (f.status || '').toLowerCase() === 'pass').map(f => f.description || f.check_name).slice(0, 3),
      risks: [],
      recommended_roadmap: { immediate: [], short_term: [], long_term: [] }
    };
  }

  const ex = data.executive_summary;
  ex.overall_health_score = Number(ex.overall_health_score) || 0;
  ex.technical_seo_score = Number(ex.technical_seo_score) || ex.overall_health_score;
  ex.performance_score = Number(ex.performance_score) || ex.overall_health_score;
  ex.csp_security_score = Number(ex.csp_security_score) || ex.overall_health_score;
  ex.accessibility_score = Number(ex.accessibility_score) || ex.overall_health_score;
  
  let html = `
    <div class="seo-exec-summary">
      <div class="seo-score-card">
        <h3>Overall Health</h3>
        <div class="seo-score-val ${ex.overall_health_score >= 80 ? 'score-high' : ex.overall_health_score >= 50 ? 'score-med' : 'score-low'}">${ex.overall_health_score || 0}</div>
      </div>
      <div class="seo-score-card">
        <h3>Technical SEO</h3>
        <div class="seo-score-val ${ex.technical_seo_score >= 80 ? 'score-high' : ex.technical_seo_score >= 50 ? 'score-med' : 'score-low'}">${ex.technical_seo_score || 0}</div>
      </div>
      <div class="seo-score-card">
        <h3>Performance</h3>
        <div class="seo-score-val ${ex.performance_score >= 80 ? 'score-high' : ex.performance_score >= 50 ? 'score-med' : 'score-low'}">${ex.performance_score || 0}</div>
      </div>
      <div class="seo-score-card">
        <h3>Security/CSP</h3>
        <div class="seo-score-val ${ex.csp_security_score >= 80 ? 'score-high' : ex.csp_security_score >= 50 ? 'score-med' : 'score-low'}">${ex.csp_security_score || 0}</div>
      </div>
      <div class="seo-score-card">
        <h3>Accessibility</h3>
        <div class="seo-score-val ${ex.accessibility_score >= 80 ? 'score-high' : ex.accessibility_score >= 50 ? 'score-med' : 'score-low'}">${ex.accessibility_score || 0}</div>
      </div>
    </div>
    
    <div class="seo-lists">
      <div class="seo-list-card">
        <h3>Critical Issues</h3>
        <ul>${(ex.top_critical_issues || []).map(i => `<li>${_formatSeoItem(i)}</li>`).join('') || '<li>None</li>'}</ul>
      </div>
      <div class="seo-list-card">
        <h3>Quick Wins</h3>
        <ul>${(ex.top_quick_wins || []).map(i => `<li>${_formatSeoItem(i)}</li>`).join('') || '<li>None</li>'}</ul>
      </div>
    </div>
  `;

  const phases = [
    { key: 'technical_seo',          title: 'Technical SEO' },
    { key: 'on_page_seo',            title: 'On-Page SEO' },
    { key: 'url_audit',              title: 'URL Audit' },
    { key: 'internal_external_links',title: 'Internal & External Links' },
    { key: 'image_seo',              title: 'Image SEO' },
    { key: 'performance',            title: 'Performance & Core Web Vitals' },
    { key: 'mobile_seo',             title: 'Mobile SEO' },
    { key: 'accessibility',          title: 'Accessibility (WCAG)' },
    { key: 'structured_data',        title: 'Structured Data & Schema' },
    { key: 'javascript_seo',         title: 'JavaScript SEO' },
    { key: 'robots_sitemap',         title: 'Robots.txt & Sitemap' },
    { key: 'csp_audit',              title: 'Content Security Policy (CSP)' },
    { key: 'security_headers',       title: 'Security Headers' },
    { key: 'https_mixed_content',    title: 'HTTPS & Mixed Content' },
    { key: 'content_quality',        title: 'Content Quality' },
  ];

  const phasesSource = (data.phases && typeof data.phases === 'object') ? { ...data.phases, ...data } : data;

  phases.forEach(p => {
    const phaseData = phasesSource[p.key] || { findings: [] };
    const findings = Array.isArray(phaseData.findings) ? phaseData.findings : [];
    if (findings.length === 0) return;

    let passCount = findings.filter(f => (f.status || '').toLowerCase() === 'pass').length;
    let failCount = findings.length - passCount;

    let issuesHtml = findings.map(f => {
      if (!f || typeof f !== 'object') return '';
      const status = (f.status || 'Unknown').toUpperCase();
      const isPass = status === 'PASS';
      const sev = (f.severity || (isPass ? 'N/A' : 'low')).toLowerCase();
      const badgeClass = isPass ? 'sev-pass' : `sev-${sev}`;
      const checkName = f.check_name || f.issue_id || 'Check';
      const desc = f.description || '';
      const rec = f.recommendation || '';

      return `
      <div class="seo-issue">
        <div class="seo-issue-sev"><div class="badge ${badgeClass}">${_escapeHtml(status)}</div></div>
        <div class="seo-issue-desc">
          <p><strong>${_escapeHtml(checkName)}:</strong> ${_escapeHtml(desc) || '<em>No description available.</em>'}</p>
          ${rec && !isPass ? `<div class="seo-issue-rec">💡 ${_escapeHtml(rec)}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    html += `
      <div class="seo-phase">
        <div class="seo-phase-hdr">
          ${_escapeHtml(p.title)}
          <span style="font-size:0.75rem; font-weight:400; margin-left:auto; display:flex; gap:0.5rem;">
            <span style="color:var(--ac2)">✓ ${passCount} Pass</span>
            <span style="color:var(--cr)">✗ ${failCount} Fail</span>
          </span>
        </div>
        <div class="seo-phase-body" style="padding:0">${issuesHtml}</div>
      </div>
    `;
  });

  if (data.actionable_recommendations && data.actionable_recommendations.length > 0) {
    html += `
      <div class="seo-phase">
        <div class="seo-phase-hdr">Actionable Recommendations</div>
        <div class="seo-phase-body">
          <ul>${data.actionable_recommendations.map(r => `<li style="margin-bottom:.5rem">${_formatSeoItem(r)}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  }

  if (data.pages_scanned && data.pages_scanned.length > 0) {
    let pagesHtml = data.pages_scanned.map(p => {
      let issues = (p.seo_issues || []).map(i => `<li>${_escapeHtml(i)}</li>`).join('');
      let statusColor = p.status_code >= 200 && p.status_code < 300 ? 'var(--ac2)' : (p.status_code >= 400 ? 'var(--cr)' : 'var(--hi)');
      return `
        <tr class="seo-page-row">
          <td><div class="tb-url" title="${_escapeHtml(p.url)}">${_escapeHtml(p.url)}</div></td>
          <td style="color:${statusColor}; font-weight:bold;">${p.status_code}</td>
          <td><div class="tb-title" title="${_escapeHtml(p.title)}">${_escapeHtml(p.title || 'N/A')}</div></td>
          <td><ul style="margin:0; padding-left:1rem; font-size:0.8rem; color:var(--t2)">${issues || '<li>None</li>'}</ul></td>
        </tr>
      `;
    }).join('');

    html += `
      <div class="seo-phase" style="margin-top: 1rem;">
        <div class="seo-phase-hdr">Pages Scanned (${data.pages_scanned.length})</div>
        <div class="seo-phase-body" style="padding:0; overflow-x:auto;">
          <table class="seo-pages-table">
            <thead>
              <tr>
                <th style="width:30%">URL</th>
                <th style="width:10%">Status</th>
                <th style="width:25%">Title</th>
                <th style="width:35%">Detected Issues</th>
              </tr>
            </thead>
            <tbody>
              ${pagesHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  out.innerHTML = html;
}

async function ensurePdfLibraries() {
  if (!window.html2canvas) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  if (!window.jspdf && !window.jsPDF) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
}

async function downloadSeoPdf() {
  const element = document.getElementById('seoResults');
  if (!element || element.classList.contains('hidden')) return;

  const btn = document.getElementById('seoPdfBtn');
  const origText = btn ? btn.innerHTML : '⬇ DOWNLOAD PDF';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Generating PDF…';
  }

  // Remove any stale overlay
  document.querySelectorAll('.html2pdf__overlay').forEach(el => el.remove());

  try {
    await ensurePdfLibraries();
    const jsPdfConstructor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPdfConstructor || !window.html2canvas) {
      throw new Error('PDF export libraries failed to initialize.');
    }

    const bgColor = window.getComputedStyle(element).backgroundColor || '#0b0f19';

    // Capture the SEO results DOM in full fidelity with modern html2canvas
    const canvas = await window.html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: bgColor
    });

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Unable to render report canvas.');
    }

    const pdf = new jsPdfConstructor('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8; // 8mm margins
    const contentWidth = pageWidth - (margin * 2);
    const contentHeight = pageHeight - (margin * 2);

    // Calculate slice dimensions in canvas pixel space
    const pxPerMm = canvas.width / contentWidth;
    const sliceHeightPx = Math.floor(contentHeight * pxPerMm);

    let currentY = 0;
    let pageIndex = 0;

    while (currentY < canvas.height) {
      if (pageIndex > 0) pdf.addPage();

      const remainingHeight = canvas.height - currentY;
      const thisSliceHeightPx = Math.min(sliceHeightPx, remainingHeight);
      const thisSliceHeightMm = thisSliceHeightPx / pxPerMm;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = thisSliceHeightPx;
      const sCtx = sliceCanvas.getContext('2d');

      sCtx.fillStyle = bgColor;
      sCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);

      sCtx.drawImage(
        canvas,
        0, currentY, canvas.width, thisSliceHeightPx,
        0, 0, canvas.width, thisSliceHeightPx
      );

      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(sliceData, 'JPEG', margin, margin, contentWidth, thisSliceHeightMm);

      currentY += thisSliceHeightPx;
      pageIndex++;
    }

    const filename = `QAForge_SEO_Audit_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(filename);
    if (typeof toast === 'function') toast('✓ PDF downloaded successfully!', 'ok');
  } catch (err) {
    console.error('[SEO PDF] Export failed:', err);
    alert('Failed to generate PDF: ' + (err.message || 'Unknown error'));
  } finally {
    document.querySelectorAll('.html2pdf__overlay').forEach(e => e.remove());
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
}

// ══════════ AEO & GEO AUDIT RENDERING ══════════
function renderAeoGeoResults(data) {
  const out = document.getElementById('aeoResults');
  if (!out) return;
  if (!data || typeof data !== 'object') {
    out.innerHTML = `
      <div class="empty-st" style="padding:2.5rem; text-align:center;">
        <div style="font-size:1.4rem; margin-bottom:0.5rem; color:var(--cr);">⚠ Scan Incomplete</div>
        <p style="color:var(--t2); margin-bottom:1.2rem;">The server could not return AEO/GEO report data. Please check the URL and run the scan again.</p>
        <button class="btn-primary" onclick="runAeoGeoAudit()">Run Scan Again</button>
      </div>`;
    return;
  }

  const scores = data.scores || {};
  const overall = Number(scores.overall_ai_score) || 0;
  const botAcc = Number(scores.bot_accessibility_score) || 0;
  const dirAns = Number(scores.direct_answer_score) || 0;
  const genCit = Number(scores.generative_citation_score) || 0;

  const readiness = data.readiness || {};
  const sig = data.raw_signals || {};
  const bots = Array.isArray(sig.ai_bots) ? sig.ai_bots : Object.values(sig.ai_bots || {});
  const fixes = data.actionable_fixes || [];
  const queryOpps = data.query_opportunities || [];
  const contentGaps = data.content_gaps || [];
  const directAnswers = sig.direct_answers || [];
  const statsList = sig.statistics_found || sig.facts_and_stats || [];
  const schemas = sig.schemas || {};
  const hasFaq = schemas.has_faq || sig.has_faq_schema || false;
  const hasOrg = schemas.has_org || sig.has_org_schema || false;
  const sameAsList = schemas.same_as || [];
  const hasSameAs = (sameAsList && sameAsList.length > 0) || sig.has_same_as || false;

  function scoreClass(val) {
    return val >= 80 ? 'score-high' : val >= 50 ? 'score-med' : 'score-low';
  }

  function readinessValClass(val) {
    const v = (val || '').toLowerCase();
    if (v === 'high') return 'val-high';
    if (v === 'low') return 'val-low';
    return 'val-mod';
  }

  function botBadge(status) {
    const s = (status || '').toLowerCase();
    if (s === 'allowed') return '<span class="badge sev-low" style="background:#059669;color:#fff;font-weight:700">ALLOWED</span>';
    if (s === 'blocked') return '<span class="badge sev-critical" style="background:#dc2626;color:#fff;font-weight:700">BLOCKED</span>';
    return '<span class="badge" style="background:#2563eb;color:#fff;font-weight:700">DEFAULT ALLOWED</span>';
  }

  let html = `
    <!-- Top Metadata Header -->
    <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1.25rem; padding-bottom:0.75rem; border-bottom:1px solid var(--b);">
      <div>
        <div style="font-size:0.78rem; text-transform:uppercase; color:var(--t3); letter-spacing:0.5px;">Audited URL for Generative & Answer Engine Optimization</div>
        <div style="font-size:1.15rem; font-weight:700; color:var(--t); word-break:break-all;">${_escapeHtml(data.url)}</div>
        ${data.target_query ? `<div style="font-size:0.85rem; color:var(--ac); margin-top:2px;">🎯 Target Topic / Brand Focus: <strong>${_escapeHtml(data.target_query)}</strong></div>` : ''}
      </div>
      <div style="text-align:right;">
        <span class="badge sev-low" style="font-size:0.75rem; font-family:var(--fm);">${_escapeHtml(data.model_used || 'Gemini 2.5 Flash')}</span>
        <div style="font-size:0.72rem; color:var(--t3); margin-top:3px;">${new Date(data.scanned_at || Date.now()).toLocaleTimeString()}</div>
      </div>
    </div>

    <!-- Executive AI Scores -->
    <div class="seo-exec-summary">
      <div class="seo-score-card">
        <h3>Overall AI Visibility</h3>
        <div class="seo-score-val ${scoreClass(overall)}">${overall}</div>
      </div>
      <div class="seo-score-card">
        <h3>AI Bot Access</h3>
        <div class="seo-score-val ${scoreClass(botAcc)}">${botAcc}</div>
      </div>
      <div class="seo-score-card">
        <h3>Direct Answer</h3>
        <div class="seo-score-val ${scoreClass(dirAns)}">${dirAns}</div>
      </div>
      <div class="seo-score-card">
        <h3>Generative Authority</h3>
        <div class="seo-score-val ${scoreClass(genCit)}">${genCit}</div>
      </div>
    </div>

    <!-- Engine Readiness Status Row -->
    <div class="aeo-readiness-row">
      <div class="aeo-readiness-badge">
        <span class="aeo-readiness-label">Google AI Overviews</span>
        <span class="aeo-readiness-val ${readinessValClass(readiness.ai_overviews)}">${_escapeHtml(readiness.ai_overviews || 'Moderate')}</span>
      </div>
      <div class="aeo-readiness-badge">
        <span class="aeo-readiness-label">ChatGPT Search</span>
        <span class="aeo-readiness-val ${readinessValClass(readiness.chatgpt_search)}">${_escapeHtml(readiness.chatgpt_search || 'Moderate')}</span>
      </div>
      <div class="aeo-readiness-badge">
        <span class="aeo-readiness-label">Perplexity Citations</span>
        <span class="aeo-readiness-val ${readinessValClass(readiness.perplexity)}">${_escapeHtml(readiness.perplexity || 'Moderate')}</span>
      </div>
      <div class="aeo-readiness-badge">
        <span class="aeo-readiness-label">Voice / Siri / Alexa</span>
        <span class="aeo-readiness-val ${readinessValClass(readiness.voice_search)}">${_escapeHtml(readiness.voice_search || 'Moderate')}</span>
      </div>
    </div>

    <!-- Simulated AI Overview & Synthesis -->
    <div class="aeo-snippet-card">
      <div class="aeo-snippet-header">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z"/></svg>
        <span>Simulated Generative AI Overview & Citation Snippet</span>
      </div>
      <div class="aeo-snippet-body">
        ${_escapeHtml(data.simulated_ai_snippet || 'No simulated snippet available.')}
      </div>
      <div style="font-size:0.72rem; color:var(--t3); margin-top:0.6rem; font-style:italic;">
        Simulated output showing how leading LLMs (Google Gemini Search, Perplexity, and ChatGPT Search) summarize and cite this page based on parsed entity data, headings, and direct answer blocks.
      </div>
    </div>

    <!-- AI Conversational Query Opportunities & Gaps -->
    <div class="seo-lists" style="margin-bottom:1.5rem">
      <div class="seo-list-card">
        <h3>🎯 Winnable Conversational Queries (AEO Opportunities)</h3>
        <ul style="padding-left:1.2rem; margin-top:0.5rem;">
          ${queryOpps.length > 0 ? queryOpps.map(q => `<li style="margin-bottom:0.4rem; color:var(--t)"><strong>${_escapeHtml(q)}</strong></li>`).join('') : '<li style="color:var(--t3)">No conversational query suggestions identified.</li>'}
        </ul>
      </div>
      <div class="seo-list-card">
        <h3>⚠ Content & Authority Gaps for Generative Engines</h3>
        <ul style="padding-left:1.2rem; margin-top:0.5rem;">
          ${contentGaps.length > 0 ? contentGaps.map(g => `<li style="margin-bottom:0.4rem; color:var(--t2)">${_escapeHtml(g)}</li>`).join('') : '<li style="color:var(--t3)">No critical generative gaps found.</li>'}
        </ul>
      </div>
    </div>

    <!-- AI Crawlers in robots.txt -->
    <div class="seo-phase" style="margin-bottom:1.5rem">
      <div class="seo-phase-hdr" style="display:flex; justify-content:space-between; align-items:center;">
        <span>🤖 AI Crawler Permissions (robots.txt Deep Verification)</span>
        <span style="font-size:0.8rem; font-weight:600; color:var(--ac);">${sig.ai_bots_summary ? `${sig.ai_bots_summary.allowed} of ${sig.ai_bots_summary.total} Allowed` : ''}</span>
      </div>
      <div class="seo-phase-body">
        <p style="font-size:0.82rem; color:var(--t2); margin-bottom:1rem;">
          Generative AI models and autonomous search agents rely on their dedicated crawlers to index and synthesize your site in real-time answers.
        </p>
        <div class="aeo-bots-grid">
          ${bots.map(b => `
            <div class="aeo-bot-card">
              <div class="aeo-bot-head">
                <div>
                  <div class="aeo-bot-name">${_escapeHtml(b.name)}</div>
                  <div class="aeo-bot-company">${_escapeHtml(b.company)}</div>
                </div>
                <div>${botBadge(b.status)}</div>
              </div>
              <div class="aeo-bot-purpose">${_escapeHtml(b.purpose)}</div>
              <div class="aeo-bot-rule">Rule: ${_escapeHtml(b.rule || 'None declared')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Direct Answer Candidate Blocks & Structured Signals -->
    <div class="seo-phase" style="margin-bottom:1.5rem">
      <div class="seo-phase-hdr">
        <span>⚡ Direct Answer Extraction & Fact Density Signals</span>
      </div>
      <div class="seo-phase-body">
        <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:0.75rem; margin-bottom:1rem;">
          <div style="background:var(--bg2); border:1px solid var(--b); border-radius:6px; padding:0.75rem;">
            <div style="font-size:0.72rem; color:var(--t3); text-transform:uppercase;">FAQ Schema</div>
            <div style="font-size:1.1rem; font-weight:700; color:${hasFaq ? 'var(--ac2)' : 'var(--cr)'}">${hasFaq ? '✓ Detected' : '✗ Missing'}</div>
          </div>
          <div style="background:var(--bg2); border:1px solid var(--b); border-radius:6px; padding:0.75rem;">
            <div style="font-size:0.72rem; color:var(--t3); text-transform:uppercase;">Organization / Entity Schema</div>
            <div style="font-size:1.1rem; font-weight:700; color:${hasOrg ? 'var(--ac2)' : 'var(--hi)'}">${hasOrg ? '✓ Detected' : '⚠ Missing'}</div>
          </div>
          <div style="background:var(--bg2); border:1px solid var(--b); border-radius:6px; padding:0.75rem;">
            <div style="font-size:0.72rem; color:var(--t3); text-transform:uppercase;">sameAs Entity Links (Wikidata/Social)</div>
            <div style="font-size:1.1rem; font-weight:700; color:${hasSameAs ? 'var(--ac2)' : 'var(--t3)'}">${hasSameAs ? `✓ ${sameAsList.length || 1} Linked` : 'None'}</div>
          </div>
          <div style="background:var(--bg2); border:1px solid var(--b); border-radius:6px; padding:0.75rem;">
            <div style="font-size:0.72rem; color:var(--t3); text-transform:uppercase;">Empirical Facts & Numbers</div>
            <div style="font-size:1.1rem; font-weight:700; color:var(--ac)">${statsList.length} extracted</div>
          </div>
        </div>

        <h4 style="font-size:0.85rem; font-weight:700; margin-bottom:0.6rem; color:var(--t)">Extracted Direct Answer Blocks (40–75 words)</h4>
        ${directAnswers.length > 0 ? `
          <div class="aeo-answers-list">
            ${directAnswers.slice(0, 5).map(da => `
              <div class="aeo-answer-item">
                <div class="aeo-answer-heading">${_escapeHtml(da.heading || 'Direct Content Block')}</div>
                <div class="aeo-answer-text">${_escapeHtml(da.text)}</div>
                <div class="aeo-answer-meta">${da.word_count} words · Optimal length for Google AI Overviews and Voice Readout</div>
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="font-size:0.82rem; color:var(--t3); padding:0.75rem; background:var(--bg2); border-radius:6px;">
            No direct answer paragraph blocks (40–70 words under clear H2/H3 question headings) were identified on this page. Adding concise answer summaries immediately after headings will dramatically improve AI citation rates.
          </div>
        `}
      </div>
    </div>

    <!-- Actionable Priorities -->
    <div class="seo-phase" style="margin-bottom:1.5rem">
      <div class="seo-phase-hdr">
        <span>🚀 Prioritized Fixes for Generative & Answer Optimization</span>
      </div>
      <div class="seo-phase-body">
        <div style="display:flex; flex-direction:column; gap:0.75rem;">
          ${fixes.map(f => `
            <div style="background:var(--bg2); border:1px solid var(--b); border-radius:8px; padding:0.9rem;">
              <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.35rem;">
                <span class="badge ${f.priority && f.priority.toLowerCase() === 'high' ? 'sev-critical' : 'sev-medium'}" style="font-size:0.7rem; padding:2px 6px;">${_escapeHtml(f.priority || 'MEDIUM')}</span>
                <span style="font-size:0.75rem; color:var(--t3); font-weight:600;">[${_escapeHtml(f.category || 'General')}]</span>
                <strong style="font-size:0.9rem; color:var(--t);">${_escapeHtml(f.title)}</strong>
              </div>
              <div style="font-size:0.82rem; color:var(--t2); line-height:1.5;">${_escapeHtml(f.recommendation)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>

    <!-- Recommended Schema.org JSON-LD -->
    ${data.recommended_schema_snippet ? `
      <div class="seo-phase">
        <div class="seo-phase-hdr" style="display:flex; justify-content:space-between; align-items:center;">
          <span>📋 Recommended Structured Data (Copy-Ready JSON-LD)</span>
          <button class="btn-ghost" style="padding:4px 10px; font-size:0.75rem;" onclick="copyAeoSchema()">📋 COPY SCHEMA</button>
        </div>
        <div class="seo-phase-body">
          <p style="font-size:0.82rem; color:var(--t2); margin-bottom:0.75rem;">
            Embed this customized Schema.org JSON-LD inside your <code>&lt;head&gt;</code> tag to give AI bots clear semantic facts, FAQ answers, and entity relationships.
          </p>
          <pre id="aeoSchemaCode" class="aeo-code-block">${_escapeHtml(data.recommended_schema_snippet)}</pre>
        </div>
      </div>
    ` : ''}
  `;

  out.innerHTML = html;
}

function copyAeoSchema() {
  const codeEl = document.getElementById('aeoSchemaCode');
  if (!codeEl) return;
  const text = codeEl.innerText || codeEl.textContent;
  navigator.clipboard.writeText(text).then(() => {
    if (typeof toast === 'function') toast('✓ Schema JSON-LD copied to clipboard!', 'ok');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    if (typeof toast === 'function') toast('✓ Schema JSON-LD copied to clipboard!', 'ok');
  });
}

async function downloadAeoPdf() {
  const element = document.getElementById('aeoResults');
  if (!element || element.classList.contains('hidden')) return;

  const btn = document.getElementById('aeoPdfBtn');
  const origText = btn ? btn.innerHTML : '⬇ DOWNLOAD REPORT';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⏳ Generating PDF…';
  }

  document.querySelectorAll('.html2pdf__overlay').forEach(el => el.remove());

  try {
    await ensurePdfLibraries();
    const jsPdfConstructor = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
    if (!jsPdfConstructor || !window.html2canvas) {
      throw new Error('PDF export libraries failed to initialize.');
    }

    const bgColor = window.getComputedStyle(element).backgroundColor || '#0b0f19';

    const canvas = await window.html2canvas(element, {
      scale: 1.5,
      useCORS: true,
      logging: false,
      backgroundColor: bgColor
    });

    if (!canvas || canvas.width === 0 || canvas.height === 0) {
      throw new Error('Unable to render report canvas.');
    }

    const pdf = new jsPdfConstructor('p', 'mm', 'a4');
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 8;
    const contentWidth = pageWidth - (margin * 2);
    const contentHeight = pageHeight - (margin * 2);

    const pxPerMm = canvas.width / contentWidth;
    const sliceHeightPx = Math.floor(contentHeight * pxPerMm);

    let currentY = 0;
    let pageIndex = 0;

    while (currentY < canvas.height) {
      if (pageIndex > 0) pdf.addPage();

      const remainingHeight = canvas.height - currentY;
      const thisSliceHeightPx = Math.min(sliceHeightPx, remainingHeight);
      const thisSliceHeightMm = thisSliceHeightPx / pxPerMm;

      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = thisSliceHeightPx;
      const sCtx = sliceCanvas.getContext('2d');

      sCtx.fillStyle = bgColor;
      sCtx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);

      sCtx.drawImage(
        canvas,
        0, currentY, canvas.width, thisSliceHeightPx,
        0, 0, canvas.width, thisSliceHeightPx
      );

      const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.95);
      pdf.addImage(sliceData, 'JPEG', margin, margin, contentWidth, thisSliceHeightMm);

      currentY += thisSliceHeightPx;
      pageIndex++;
    }

    const filename = `QAForge_AEO_GEO_Audit_${new Date().toISOString().slice(0, 10)}.pdf`;
    pdf.save(filename);
    if (typeof toast === 'function') toast('✓ AEO/GEO PDF report downloaded!', 'ok');
  } catch (err) {
    console.error('[AEO PDF] Export failed:', err);
    alert('Failed to generate PDF: ' + (err.message || 'Unknown error'));
  } finally {
    document.querySelectorAll('.html2pdf__overlay').forEach(e => e.remove());
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  }
}


