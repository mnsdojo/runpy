/* ===== RunPy Renderer — Tauri Edition ===== */
'use strict';

// Use the Tauri global exposed by withGlobalTauri: true
const { invoke } = window.__TAURI__.core;
const { open: openDialog, save: saveDialog } = window.__TAURI__.dialog;
const { listen } = window.__TAURI__.event;
const { readTextFile, writeTextFile } = window.__TAURI__.path; // Simplified for now
const fs = window.__TAURI__.fs; 

console.log('Tauri APIs initialized via global object');

// Wire up events
listen('backend-ready', () => {
  console.log('Backend ready signal received!');
  setStatus('ok', 'ready');
  setTimeout(runCode, 300);
});

listen('backend-error', (event) => {
  setStatus('err', 'offline');
  appendOutput('error', 'BACKEND ERROR', event.payload);
});

const BACKEND_URL = 'http://localhost:5822';
let debounceTimer = null;
let isRunning = false;
let currentFile = null;

// ── CodeMirror ────────────────────────────────────────────────
let cm;
try {
  cm = CodeMirror.fromTextArea(document.getElementById('code-editor'), {
  mode: 'python',
  theme: 'material-darker',
  lineNumbers: true,
  matchBrackets: true,
  autoCloseBrackets: true,
  styleActiveLine: true,
  indentUnit: 4,
  tabSize: 4,
  indentWithTabs: false,
  lineWrapping: false,
  scrollbarStyle: 'native',
  extraKeys: {
    'Tab':         (cm) => cm.execCommand('insertSoftTab'),
    'Ctrl-Enter':  () => runCode(),
    'Cmd-Enter':   () => runCode(),
    'Ctrl-/':      (cm) => cm.execCommand('toggleComment'),
    'Cmd-/':       (cm) => cm.execCommand('toggleComment'),
    'Ctrl-S':      () => saveFile(),
  },
  });
  cm.setSize('100%', '100%');
} catch (e) {
  console.error('CodeMirror failed to initialize:', e);
  // Fallback: use the raw textarea
  cm = {
    getValue: () => document.getElementById('code-editor').value,
    setValue: (val) => document.getElementById('code-editor').value = val,
    on: (evt, cb) => document.getElementById('code-editor').addEventListener('input', cb),
    refresh: () => {},
    setSize: () => {},
  };
}

cm.setValue(`# Welcome to RunPy 🐍
# Code runs automatically as you type!

def greet(name):
    return f"Hello, {name}!"

message = greet("World")
print(message)

numbers = [1, 2, 3, 4, 5]
squares = [x**2 for x in numbers]
print("Squares:", squares)

# Last expression value shown automatically
sum(squares)
`);

// ── Elements ──────────────────────────────────────────────────
const outputContainer    = document.getElementById('output-container');
const variablesContainer = document.getElementById('variables-container');
const internalsContainer = document.getElementById('internals-container');
const statusDot          = document.getElementById('status-dot');
const statusLabel        = document.getElementById('status-label');
const execTimeBadge      = document.getElementById('exec-time');
const filenameDisplay    = document.getElementById('filename-display');
const autoRunToggle      = document.getElementById('toggle-autorun');
const persistentToggle   = document.getElementById('toggle-persistent');

// ── Backend Health ────────────────────────────────────────────
async function checkBackend() {
  try {
    const r = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) { setStatus('ok', 'ready'); return true; }
  } catch {}
  setStatus('err', 'offline');
  return false;
}

function setStatus(type, label) {
  if (!statusDot || !statusLabel) return;
  statusDot.className = `status-dot ${type}`;
  statusLabel.textContent = label;
}

// ── Startup ───────────────────────────────────────────────────
(async () => {
  setStatus('busy', 'connecting...');
  for (let i = 0; i < 40; i++) {
    if (await checkBackend()) { 
      setTimeout(runCode, 400); 
      return; 
    }
    await sleep(500);
  }
  setStatus('err', 'offline — check server.py');
})();

// ── Run Code ──────────────────────────────────────────────────
async function runCode() {
  if (isRunning) return;
  const code = cm.getValue();
  if (!code.trim()) { clearOutput(); return; }

  isRunning = true;
  setStatus('busy', 'running...');
  document.getElementById('btn-run').disabled = true;

  try {
    const res = await fetch(`${BACKEND_URL}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, persistent: persistentToggle.checked }),
      signal: AbortSignal.timeout(30000),
    });
    const data = await res.json();
    renderOutput(data);
    renderVariables(data.variables || {});
    renderInternals(data.internals || "");
    if (data.exec_time !== undefined) execTimeBadge.textContent = `${data.exec_time}ms`;
    setStatus('ok', 'ready');
  } catch (err) {
    appendOutput('error', 'Network Error', err.message);
    setStatus('err', 'error');
  } finally {
    isRunning = false;
    document.getElementById('btn-run').disabled = false;
  }
}

cm.on('change', () => {
  if (!autoRunToggle.checked) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runCode, 800);
});

// ── Output ────────────────────────────────────────────────────
function clearOutput() {
  outputContainer.innerHTML = '';
  internalsContainer.innerHTML = '<p class="empty-hint">Compile code to see its internals flow.</p>';
  execTimeBadge.textContent = '';
}

function formatDis(raw) {
  if (!raw) return "";
  // Split lines and process each
  return raw.split('\n').map(line => {
    if (!line.trim()) return "";
    
    // 1. Handle jump targets and line numbers at start
    // Matches ">>" or numbers at the very beginning
    line = line.replace(/^(\s*)(>>)?\s*(\d+)?/, (match, p1, p2, p3) => {
      let res = p1 || "";
      if (p2) res += `<span class="dis-target">${p2}</span>`;
      if (p3) res += `<span class="dis-line">${p3}</span>`;
      return res;
    });

    // 2. Handle offset and OpCode
    // Matches "  2 STORE_NAME"
    line = line.replace(/(\s+)(\d+)(\s+)([A-Z_0-9]+)/, '$1<span class="dis-offset">$2</span>$3<span class="dis-op">$4</span>');

    // 3. Handle OpCode arguments (the numerical index)
    line = line.replace(/(\s+)(\d+)(\s+)(\()/, '$1<span class="dis-arg">$2</span>$3$4');

    // 4. Handle comments/interpreted values in parentheses
    line = line.replace(/\(([^)]+)\)/g, '<span class="dis-comment">($1)</span>');

    return line;
  }).join('\n');
}

function renderInternals(data) {
  if (!data) {
    internalsContainer.innerHTML = '<p class="empty-hint">No bytecode available.</p>';
    return;
  }
  const formatted = formatDis(esc(data));
  internalsContainer.innerHTML = `
    <div class="internals-view">
      <div class="internals-header">PYTHON BYTECODE (DIS)</div>
      <pre class="internals-body">${formatted}</pre>
    </div>
  `;
}

function renderOutput(data) {
  clearOutput();
  if (data.stdout) appendOutput('stdout', 'STDOUT', data.stdout, `${data.exec_time}ms`);
  if (data.stderr) appendOutput('stderr', 'STDERR', data.stderr);
  if (data.plots && data.plots.length > 0) renderPlots(data.plots);
  if (data.error) {
    const e = data.error;
    let msg = `${e.type}: ${e.message}`;
    if (e.line) msg += `\n  → line ${e.line}`;
    if (e.traceback) msg += '\n\n' + e.traceback;
    appendOutput('error', 'ERROR', msg);
  }
  if (data.has_last_value && data.last_value) appendOutput('value', '▸ RESULT', data.last_value);
  if (!data.stdout && !data.stderr && !data.error && !data.has_last_value)
    appendOutput('info', 'INFO', '(no output)');
}

function appendOutput(type, label, content, time) {
  const block = document.createElement('div');
  block.className = `output-block ${type}`;
  block.innerHTML = `
    <div class="output-block-header">
      <span>${label}</span>
      ${time ? `<span class="output-time">${time}</span>` : ''}
    </div>
    <div class="output-block-body"></div>
  `;
  block.querySelector('.output-block-body').textContent = content;
  outputContainer.appendChild(block);
  outputContainer.scrollTop = outputContainer.scrollHeight;
}

function renderPlots(plots) {
  plots.forEach((b64, i) => {
    const block = document.createElement('div');
    block.className = `output-block plot`;
    block.innerHTML = `
      <div class="output-block-header">
        <span>PLOT #${i+1}</span>
      </div>
      <div class="output-block-body plot-body">
        <img src="data:image/png;base64,${b64}" alt="Generated Plot" />
      </div>
    `;
    outputContainer.appendChild(block);
  });
}

// ── Variables ─────────────────────────────────────────────────
function renderVariables(vars) {
  variablesContainer.innerHTML = '';
  const keys = Object.keys(vars);
  if (!keys.length) {
    variablesContainer.innerHTML = '<p class="empty-hint">No variables yet. Run some code!</p>';
    return;
  }
  keys.forEach(name => {
    const { type, repr } = vars[name];
    const row = document.createElement('div');
    row.className = 'var-row';
    row.innerHTML = `
      <span class="var-name">${esc(name)}</span>
      <span class="var-type">${esc(type)}</span>
      <span class="var-repr">${esc(repr)}</span>
    `;
    variablesContainer.appendChild(row);
  });
}

// ── Tabs ──────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${tab}`).classList.add('active');
  });
});

// ── Toolbar ───────────────────────────────────────────────────
document.getElementById('btn-run').addEventListener('click', runCode);

document.getElementById('btn-clear-output').addEventListener('click', () => {
  clearOutput();
  variablesContainer.innerHTML = '<p class="empty-hint">No variables yet.</p>';
});

document.getElementById('btn-reset').addEventListener('click', async () => {
  await fetch(`${BACKEND_URL}/reset`, { method: 'POST' });
  clearOutput();
  variablesContainer.innerHTML = '<p class="empty-hint">Environment reset!</p>';
  setStatus('ok', 'env reset');
  setTimeout(() => setStatus('ok', 'ready'), 1500);
});

document.getElementById('btn-new').addEventListener('click', () => {
  if (confirm('New file? Unsaved changes will be lost.')) {
    cm.setValue('');
    currentFile = null;
    filenameDisplay.textContent = 'untitled.py';
    clearOutput();
  }
});

document.getElementById('btn-save').addEventListener('click', saveFile);
document.getElementById('btn-open').addEventListener('click', openFile);

async function saveFile() {
  try {
    const filePath = await saveDialog({
      title: 'Save Python File',
      defaultPath: currentFile || 'script.py',
      filters: [{ name: 'Python', extensions: ['py'] }],
    });
    if (filePath) {
      await fs.writeTextFile(filePath, cm.getValue());
      currentFile = filePath;
      filenameDisplay.textContent = filePath.split(/[\\/]/).pop();
    }
  } catch (e) {
    console.error('Save error:', e);
  }
}

async function openFile() {
  try {
    const filePath = await openDialog({
      title: 'Open Python File',
      filters: [{ name: 'Python', extensions: ['py'] }],
      multiple: false,
    });
    if (filePath) {
      const content = await fs.readTextFile(filePath);
      cm.setValue(content);
      currentFile = filePath;
      filenameDisplay.textContent = filePath.split(/[\\/]/).pop();
    }
  } catch (e) {
    console.error('Open error:', e);
  }
}

// ── pip install modal ─────────────────────────────────────────
const installModal  = document.getElementById('install-modal');
const overlay       = document.getElementById('overlay');
const installInput  = document.getElementById('install-input');
const installOutput = document.getElementById('install-output');
const doInstallBtn  = document.getElementById('btn-do-install');

document.getElementById('btn-install').addEventListener('click', () => {
  installModal.classList.remove('hidden');
  overlay.classList.remove('hidden');
  installInput.value = '';
  installOutput.className = 'install-log hidden';
  installInput.focus();
});

document.getElementById('modal-close').addEventListener('click', closeModal);
overlay.addEventListener('click', closeModal);
function closeModal() {
  installModal.classList.add('hidden');
  overlay.classList.add('hidden');
}

doInstallBtn.addEventListener('click', async () => {
  const pkgs = installInput.value.trim();
  if (!pkgs) return;
  doInstallBtn.disabled = true;
  doInstallBtn.textContent = 'Installing...';
  installOutput.className = 'install-log';
  installOutput.textContent = `Installing ${pkgs}...`;
  try {
    const res = await fetch(`${BACKEND_URL}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packages: pkgs }),
      signal: AbortSignal.timeout(120000),
    });
    const data = await res.json();
    installOutput.textContent = data.output;
    installOutput.className = `install-log ${data.ok ? 'ok' : 'err'}`;
  } catch (err) {
    installOutput.textContent = `Error: ${err.message}`;
    installOutput.className = 'install-log err';
  } finally {
    doInstallBtn.disabled = false;
    doInstallBtn.textContent = 'Install';
  }
});

installInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') doInstallBtn.click();
  if (e.key === 'Escape') closeModal();
});

// ── Resize Handle ─────────────────────────────────────────────
const handle     = document.getElementById('resize-handle');
const editorPane = document.getElementById('editor-pane');
let dragging = false, startX = 0, startW = 0;

handle.addEventListener('mousedown', e => {
  dragging = true; startX = e.clientX; startW = editorPane.offsetWidth;
  handle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', e => {
  if (!dragging) return;
  const w = Math.max(280, Math.min(startW + (e.clientX - startX), window.innerWidth - 280));
  editorPane.style.width = w + 'px';
  cm.refresh();
});
document.addEventListener('mouseup', () => {
  if (!dragging) return;
  dragging = false;
  handle.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

// ── Utils ─────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
