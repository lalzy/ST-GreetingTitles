// Greeting Titles – SillyTavern side.
// • Title fields in ST's own character editor (first message + Alternate Greetings popup)
// • Title bar + pick-by-title menu on the chat's greeting
// • Optional CharacterLibrary integration (titles in CL's Edit/Details views) – no CL source edits
// Every part can be switched off in Extensions → Greeting Titles.
import './core.js';

const Core = globalThis.GreetingTitlesCore;
const BASE = new URL('.', import.meta.url).href;
const VERSION = '1.1.0';
const MODULE = 'greeting_titles';

const DEFAULTS = {
    stEditor: true,       // title fields in ST's character editor
    chatBar: true,        // title bar on the greeting in chat
    chatPicker: true,     // click the bar to pick a greeting
    barUntitled: false,   // show bar/picker even for characters without titles
    clIntegration: true,  // inject into CharacterLibrary
};

const ctx = () => SillyTavern.getContext();

function settings() {
    const all = ctx().extensionSettings;
    all[MODULE] = Object.assign({}, DEFAULTS, all[MODULE] || {});
    return all[MODULE];
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage (ST side)
// ST's character editor saves the whole card from character.json_data, so titles must be put
// there immediately (not only on the server) or the next editor save would drop them.
// ─────────────────────────────────────────────────────────────────────────────
const pushTimers = new Map();

function setTitlesLocal(chid, obj) {
    const char = ctx().characters[chid];
    if (!char) return;
    char.data = char.data || {};
    char.data.extensions = char.data.extensions || {};
    char.data.extensions[Core.KEY] = obj;
    if (char.json_data) {
        try {
            const j = JSON.parse(char.json_data);
            j.data = j.data || {};
            j.data.extensions = j.data.extensions || {};
            j.data.extensions[Core.KEY] = obj;
            char.json_data = JSON.stringify(j);
            if (Number(chid) === Number(ctx().characterId)) {
                const hidden = document.getElementById('character_json_data');
                if (hidden) hidden.value = char.json_data;
            }
        } catch { /* leave json_data alone if unparsable */ }
    }
}

function saveTitles(chid, obj) {
    setTitlesLocal(chid, obj);
    clearTimeout(pushTimers.get(chid));
    pushTimers.set(chid, setTimeout(() => {
        pushTimers.delete(chid);
        // persists via merge-attributes (and repeats the local update, harmless)
        ctx().writeExtensionField(chid, Core.KEY, ctx().characters[chid]?.data?.extensions?.[Core.KEY] ?? obj)
            .then(() => scheduleRefresh())
            .catch(e => console.error('[GreetingTitles] save failed', e));
    }, 400));
    scheduleRefresh();
}

/** chid of the character open in ST's editor panel, or null (none / create mode). */
function editorChid() {
    if (ctx().menuType === 'create') return null;
    const chid = $('.open_alternate_greetings').data('chid');
    if (chid === undefined || chid === null || Number(chid) < 0 || !ctx().characters[chid]) return null;
    return Number(chid);
}

// ─────────────────────────────────────────────────────────────────────────────
// ST character editor: first message title
// ─────────────────────────────────────────────────────────────────────────────
function ensureMainInput() {
    let input = document.getElementById('gtitles_main_input');
    if (input) return input;
    const fm = document.getElementById('firstmessage_textarea');
    if (!fm) return null;
    input = document.createElement('input');
    input.type = 'text';
    input.id = 'gtitles_main_input';
    input.className = 'text_pole gtitles-title-input';
    input.placeholder = 'First message title (optional)';
    input.autocomplete = 'off';
    // no `name` attribute: keeps it out of ST's form data
    fm.parentNode.insertBefore(input, fm);
    input.addEventListener('input', () => {
        const chid = editorChid();
        if (chid === null) return;
        const char = ctx().characters[chid];
        const alts = Core.resolve(char);
        saveTitles(chid, Core.build(input.value, char.data?.alternate_greetings ?? [], alts.alts));
    });
    return input;
}

function refreshMainInput() {
    const input = document.getElementById('gtitles_main_input');
    if (!settings().stEditor) { input?.remove(); return; }
    const el = input || ensureMainInput();
    if (!el) return;
    const chid = editorChid();
    el.style.display = chid === null ? 'none' : '';
    if (chid !== null && document.activeElement !== el) el.value = Core.resolve(ctx().characters[chid]).main;
}

// ─────────────────────────────────────────────────────────────────────────────
// ST character editor: Alternate Greetings popup
// ─────────────────────────────────────────────────────────────────────────────
function blocks(root) {
    return [...root.querySelectorAll('.alternate_greetings_list .alternate_greeting')]
        .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
}

function setSummaryTitle(block, title) {
    const strong = block.querySelector('summary strong');
    if (!strong) return;
    let span = strong.querySelector('.gtitles-sum');
    if (!span) { span = document.createElement('span'); span.className = 'gtitles-sum'; strong.appendChild(span); }
    span.textContent = title ? ` · ${title}` : '';
}

function decorateBlock(block, title) {
    if (block.querySelector('.gtitles-alt-input')) return;
    const ta = block.querySelector('.alternate_greeting_text');
    if (!ta) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'text_pole gtitles-title-input gtitles-alt-input';
    input.placeholder = 'Title (optional)';
    input.autocomplete = 'off';
    input.value = title || '';
    ta.parentNode.insertBefore(input, ta);
    setSummaryTitle(block, input.value);
}

function writeFromPopup(root, chid) {
    const bs = blocks(root);
    if (!bs.length && !root.isConnected) return;
    const texts = bs.map(b => b.querySelector('.alternate_greeting_text')?.value ?? '');
    const titles = bs.map(b => b.querySelector('.gtitles-alt-input')?.value ?? '');
    const main = Core.resolve(ctx().characters[chid]).main;
    saveTitles(chid, Core.build(main, texts, titles));
}

function attachToPopup(root) {
    if (root.dataset.gtitles) return;
    const chid = editorChid();
    if (chid === null || !settings().stEditor) return;
    root.dataset.gtitles = '1';

    const decorateAll = () => {
        const bs = blocks(root);
        const texts = bs.map(b => b.querySelector('.alternate_greeting_text')?.value ?? '');
        const r = Core.resolve(ctx().characters[chid], texts);
        bs.forEach((b, i) => decorateBlock(b, r.alts[i]));
    };
    decorateAll();

    const list = root.querySelector('.alternate_greetings_list');
    if (list) new MutationObserver(decorateAll).observe(list, { childList: true }); // "+" adds a block

    root.addEventListener('input', (e) => {
        const t = e.target;
        if (t.classList?.contains('gtitles-alt-input')) {
            setSummaryTitle(t.closest('.alternate_greeting'), t.value);
            writeFromPopup(root, chid);
        } else if (t.classList?.contains('alternate_greeting_text')) {
            writeFromPopup(root, chid); // keeps hashes current
        }
    });

    // ST swaps the two textareas' values on move; swap our titles the same way (same bounds rules).
    root.addEventListener('click', (e) => {
        const up = e.target.closest?.('.move_up_alternate_greeting');
        const down = e.target.closest?.('.move_down_alternate_greeting');
        if (!up && !down) return;
        const block = e.target.closest('.alternate_greeting');
        const bs = blocks(root);
        const index = Number(block.dataset.index);
        const newIndex = index + (up ? -1 : 1);
        if (newIndex < 0 || newIndex >= bs.length) return;
        const other = root.querySelector(`.alternate_greeting[data-index="${newIndex}"]`);
        const a = block.querySelector('.gtitles-alt-input'), b = other?.querySelector('.gtitles-alt-input');
        if (!a || !b) return;
        [a.value, b.value] = [b.value, a.value];
        setSummaryTitle(block, a.value);
        setSummaryTitle(other, b.value);
        setTimeout(() => writeFromPopup(root, chid), 0); // after ST swapped the texts
    }, true);
}

function watchForGreetingsPopup() {
    const scan = (node) => {
        if (!(node instanceof HTMLElement)) return;
        const root = node.matches('.alternate_grettings') ? node : node.querySelector?.('.alternate_grettings');
        if (root) attachToPopup(root);
    };
    new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true });
}

// ─────────────────────────────────────────────────────────────────────────────
// CharacterLibrary injection
// ─────────────────────────────────────────────────────────────────────────────
const tracked = new Set();
const CL_URL = /CharacterLibrary[^?#]*\/app\/library\.html/i;

const origOpen = window.open;
window.open = function (url, ...rest) {
    const win = origOpen.call(this, url, ...rest);
    try { if (win && CL_URL.test(String(url ?? ''))) tracked.add(win); } catch { /* ignore */ }
    return win;
};

function loadScript(doc, src) {
    return new Promise((resolve, reject) => {
        const s = doc.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('load failed: ' + src));
        doc.head.appendChild(s);
    });
}

async function injectInto(win) {
    win.__gtInjectTried = true;
    const doc = win.document;
    if (!win.GreetingTitlesCore) await loadScript(doc, `${BASE}core.js?v=${VERSION}`);
    await loadScript(doc, `${BASE}cl.js?v=${VERSION}`);
}

function pollCL() {
    if (!settings().clIntegration) return;
    const frame = document.getElementById('charlib-embedded-iframe');
    if (frame?.contentWindow) tracked.add(frame.contentWindow);
    for (const win of tracked) {
        try {
            if (win.closed) { tracked.delete(win); continue; }
            const doc = win.document;
            if (!CL_URL.test(win.location.pathname)) continue;
            if (doc.readyState !== 'complete' || win.__gtInjectTried) continue;
            if (typeof win.populateAltGreetingsEditor !== 'function') continue;
            injectInto(win).catch(e => console.warn('[GreetingTitles] CL injection failed', e));
        } catch { /* cross-origin / navigating */ }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat: title bar + picker on the greeting message
// ─────────────────────────────────────────────────────────────────────────────
function preview(text) {
    const t = Core.norm(text).replace(/\s+/g, ' ');
    return t.length > 70 ? t.slice(0, 70) + '…' : t;
}

function currentChar() {
    const c = ctx();
    if (c.groupId) return null;
    return c.characters?.[c.characterId] ?? null;
}

function removeUi() {
    document.querySelectorAll('.gtitles-bar, .gtitles-menu').forEach(e => e.remove());
}

function closeMenu() {
    document.querySelectorAll('.gtitles-menu').forEach(e => e.remove());
}

function refresh() {
    try {
        refreshMainInput();
        const s = settings();
        const c = ctx();
        const char = currentChar();
        const mes0 = c.chat?.[0];
        const el = document.querySelector('#chat .mes[mesid="0"]');
        if (!s.chatBar || !char || !mes0 || mes0.is_user || mes0.is_system || !el) { removeUi(); return; }

        const entries = Core.list(char);
        if (!s.barUntitled && !entries.some(e => e.title)) { removeUi(); return; }
        if (entries.length === 0) { removeUi(); return; }

        const swipeId = Number(mes0.swipe_id ?? 0);
        const cur = entries[swipeId];
        const canPick = s.chatPicker && c.chat.length === 1 && entries.length > 1;

        let bar = el.querySelector('.gtitles-bar');
        if (!bar) {
            const text = el.querySelector('.mes_block .mes_text');
            if (!text) return;
            bar = document.createElement('div');
            bar.className = 'gtitles-bar';
            text.parentNode.insertBefore(bar, text);
            bar.addEventListener('click', onBarClick);
        }
        const label = cur?.title || `Greeting #${swipeId + 1}`;
        bar.classList.toggle('gtitles-pickable', canPick);
        bar.title = canPick ? 'Pick greeting' : (s.chatPicker ? 'Greeting (pick is only possible before the first reply)' : 'Greeting');
        bar.innerHTML = `<i class="fa-solid fa-tag"></i><span class="gtitles-label">${esc(label)}</span>` +
            `<span class="gtitles-count">${swipeId + 1}/${entries.length}</span>` +
            (canPick ? '<i class="fa-solid fa-chevron-down gtitles-chev"></i>' : '');
        if (!canPick) closeMenu();
    } catch (e) {
        console.error('[GreetingTitles] refresh failed', e);
    }
}

function onBarClick(ev) {
    ev.stopPropagation();
    const bar = ev.currentTarget;
    if (!bar.classList.contains('gtitles-pickable')) return;
    if (bar.parentNode.querySelector('.gtitles-menu')) { closeMenu(); return; }

    const c = ctx();
    const char = currentChar();
    if (!char) return;
    const entries = Core.list(char);
    const cur = Number(c.chat?.[0]?.swipe_id ?? 0);

    const menu = document.createElement('div');
    menu.className = 'gtitles-menu';
    menu.innerHTML = entries.map(e => `
        <div class="gtitles-item${e.swipeId === cur ? ' gtitles-active' : ''}" data-swipe="${e.swipeId}">
          <span class="gtitles-num">${e.swipeId + 1}</span>
          <span class="gtitles-item-text">${e.title ? `<b>${esc(e.title)}</b>` : `<i>${esc(preview(e.text)) || '(empty)'}</i>`}</span>
        </div>`).join('');
    menu.addEventListener('click', (e) => {
        e.stopPropagation();
        const item = e.target.closest('.gtitles-item');
        if (!item) return;
        closeMenu();
        goTo(Number(item.dataset.swipe));
    });
    bar.parentNode.insertBefore(menu, bar.nextSibling);
}

async function goTo(target) {
    const c = ctx();
    const mes0 = c.chat?.[0];
    if (!mes0 || c.chat.length !== 1) return;
    const cur = Number(mes0.swipe_id ?? 0);
    if (target === cur) return;
    if (typeof c.swipe?.to !== 'function') { toastr.warning('Update SillyTavern to use the greeting picker.'); return; }
    if (c.swipe.state?.() && c.swipe.state() !== 'none') return;
    if (document.getElementById('mes_stop')?.style.display === 'flex') return; // generating
    await c.swipe.to(null, target > cur ? 'right' : 'left', {
        source: 'swipe_picker', forceMesId: 0, forceSwipeId: target, message: mes0,
    });
    refresh();
}

let refreshTimer = null;
function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings panel
// ─────────────────────────────────────────────────────────────────────────────
function addSettingsUi() {
    const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!host || document.getElementById('gtitles_settings')) return;
    const s = settings();
    const opt = (key, label, hint = '') => `
      <label class="checkbox_label" title="${esc(hint)}">
        <input type="checkbox" data-gt-opt="${key}" ${s[key] ? 'checked' : ''}><span>${label}</span>
      </label>`;
    host.insertAdjacentHTML('beforeend', `
      <div id="gtitles_settings" class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Greeting Titles</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          ${opt('stEditor', 'Title fields in the character editor', 'First message + Alternate Greetings popup')}
          ${opt('chatBar', 'Show greeting title in chat')}
          ${opt('chatPicker', 'Click the title to pick a greeting', 'Only before the first reply')}
          ${opt('barUntitled', 'Also for characters without titles', 'Shows "Greeting #n" and a text preview in the picker')}
          ${opt('clIntegration', 'CharacterLibrary integration', 'Takes effect next time CharacterLibrary is opened')}
        </div>
      </div>`);
    host.querySelectorAll('[data-gt-opt]').forEach(cb => cb.addEventListener('change', () => {
        settings()[cb.dataset.gtOpt] = cb.checked;
        ctx().saveSettingsDebounced();
        scheduleRefresh();
    }));
}

(function init() {
    const { eventSource, event_types: E } = ctx();
    settings();
    addSettingsUi();
    [E.CHAT_CHANGED, E.CHAT_CREATED, E.MESSAGE_SWIPED, E.CHARACTER_MESSAGE_RENDERED, E.USER_MESSAGE_RENDERED,
        E.MESSAGE_DELETED, E.MESSAGE_UPDATED, E.MESSAGE_SENT, E.MORE_MESSAGES_LOADED, E.CHARACTER_EDITED,
        E.CHARACTER_EDITOR_OPENED, E.CHARACTER_PAGE_LOADED]
        .filter(Boolean).forEach(ev => eventSource.on(ev, scheduleRefresh));
    // switching to "create character" doesn't emit an event
    document.addEventListener('click', (e) => { if (e.target.closest?.('#rm_button_create')) setTimeout(refreshMainInput, 100); }, true);

    const chat = document.getElementById('chat');
    if (chat) new MutationObserver(scheduleRefresh).observe(chat, { childList: true });
    document.addEventListener('click', (e) => { if (!e.target.closest?.('.gtitles-menu, .gtitles-bar')) closeMenu(); });

    watchForGreetingsPopup();
    setInterval(pollCL, 1000);

    globalThis.GreetingTitles = { refresh };
    scheduleRefresh();
})();
