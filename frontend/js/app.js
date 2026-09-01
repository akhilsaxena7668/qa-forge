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
      case 'tags': return `<td class="col-tags">...</td>`; // Simplified for brevity
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
  toast('CSV exported with 14 columns', 'ok');
}
function goExec() { if (curSuiteId) { selExecId = curSuiteId; nav('execute'); } }
function goAutomate() { if (curSuiteId) { autoSelId = curSuiteId; nav('automate'); } }
async function dlSuite() { if (curSuiteId) window.location.href = `/api/suites/${curSuiteId}/download`; }


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

function toggleBfMod(el) {
  document.querySelectorAll('.bfmod').forEach(m => m.classList.remove('active'));
  el.classList.add('active');
}
function getSelectedModule() {
  const active = document.querySelector('.bfmod.active');
  return active ? active.dataset.v : 'ui';
}

async function runBugFormat() {
  const raw = v('bfRawText').trim();
  if (!raw) return toast('Enter bug details first', 'err');
  if (raw.length < 10) return toast('Please provide more detail (min 10 chars)', 'err');

  // Show loading
  document.getElementById('bfLoad').classList.remove('hidden');
  document.getElementById('bfEmpty').style.display = 'none';
  document.getElementById('bfOutput').classList.add('hidden');
  document.getElementById('bfActs').style.display = 'none';

  const msgs = [
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
    const body = {
      raw_text: raw,
      app_type: v('bfAppType'),
      module: getSelectedModule(),
    };
    const env = v('bfEnv').trim();
    if (env) body.environment = env;

    const res = await post('/api/format/bug', body);
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

// ══════════ SEO AUDIT ══════════
async function runSeoAudit() {
  const url = document.getElementById('seoUrlInput').value.trim();
  const depth = document.getElementById('seoDepthSelect').value;
  if (!url) return alert('Please enter a website URL');

  const btn = document.getElementById('seoRunBtn');
  const load = document.getElementById('seoLoad');;
  const out = document.getElementById('seoResults');
  const pdfBtn = document.getElementById('seoPdfBtn');

  btn.disabled = true;
  load.classList.remove('hidden');
  out.classList.add('hidden');
  pdfBtn.classList.add('hidden');

  try {
    const res = await post('/api/audit/seo', { url, depth });
    if (!res || typeof res !== 'object') throw new Error('Server returned empty response');
    try {
      renderSeoResults(res);
    } catch (renderErr) {
      console.error('[SEO] Render error:', renderErr, res);
      out.innerHTML = `<div class="empty-st" style="color:var(--cr)">⚠ Display error: ${renderErr.message}<br><small>Check the browser console for details.</small></div>`;
    }
    out.classList.remove('hidden');
    pdfBtn.classList.remove('hidden');
  } catch (e) {
    console.error('[SEO] Request error:', e);
    alert('SEO Audit failed: ' + (e.message || 'Unknown error. Check the browser console.'));
  } finally {
    btn.disabled = false;
    load.classList.add('hidden');
  }
}

function renderSeoResults(data) {
  const out = document.getElementById('seoResults');
  out.innerHTML = '';
  
  if (!data || !data.executive_summary) {
    out.innerHTML = '<div class="empty-st">Invalid report data generated.</div>';
    return;
  }

  const ex = data.executive_summary;
  
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
        <ul>${(ex.top_critical_issues || []).map(i => `<li>${i}</li>`).join('') || '<li>None</li>'}</ul>
      </div>
      <div class="seo-list-card">
        <h3>Quick Wins</h3>
        <ul>${(ex.top_quick_wins || []).map(i => `<li>${i}</li>`).join('') || '<li>None</li>'}</ul>
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


  phases.forEach(p => {
    const phaseData = data[p.key] || { findings: [] };
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
        <div class="seo-issue-sev"><div class="badge ${badgeClass}">${status}</div></div>
        <div class="seo-issue-desc">
          <p><strong>${checkName}:</strong> ${desc || '<em>No description available.</em>'}</p>
          ${rec && !isPass ? `<div class="seo-issue-rec">💡 ${rec}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    html += `
      <div class="seo-phase">
        <div class="seo-phase-hdr">
          ${p.title}
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
          <ul>${data.actionable_recommendations.map(r => `<li style="margin-bottom:.5rem">${r}</li>`).join('')}</ul>
        </div>
      </div>
    `;
  }

  if (data.pages_scanned && data.pages_scanned.length > 0) {
    let pagesHtml = data.pages_scanned.map(p => {
      let issues = (p.seo_issues || []).map(i => `<li>${i}</li>`).join('');
      let statusColor = p.status_code >= 200 && p.status_code < 300 ? 'var(--ac2)' : (p.status_code >= 400 ? 'var(--cr)' : 'var(--hi)');
      return `
        <tr class="seo-page-row">
          <td><div class="tb-url" title="${p.url}">${p.url}</div></td>
          <td style="color:${statusColor}; font-weight:bold;">${p.status_code}</td>
          <td><div class="tb-title" title="${p.title}">${p.title || 'N/A'}</div></td>
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

function downloadSeoPdf() {
  const element = document.getElementById('seoResults');
  if (!element || element.classList.contains('hidden')) return;
  const opt = {
    margin: 0.5,
    filename: 'QAForge_SEO_Audit.pdf',
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
  };
  html2pdf().set(opt).from(element).save();
}

