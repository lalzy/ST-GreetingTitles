// Greeting Titles – SillyTavern side.
// 1) Shows the title of the current greeting on the chat's first message, with a pick-by-title menu.
// 2) Injects titles editing/display into CharacterLibrary's page (tab or embedded) – no CL source edits.
import './core.js';

const Core = globalThis.GreetingTitlesCore;
const BASE = new URL('.', import.meta.url).href;
const VERSION = '1.0.0';

const ctx = () => SillyTavern.getContext();

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
    const frame = document.getElementById('charlib-embedded-iframe');
    if (frame?.contentWindow) tracked.add(frame.contentWindow);
    for (const win of tracked) {
        try {
            if (win.closed) { tracked.delete(win); continue; }
            const doc = win.document;
            if (!CL_URL.test(win.location.pathname)) continue;
            if (doc.readyState !== 'complete' || win.__gtInjectTried) continue;
            if (typeof win.populateAltGreetingsEditor !== 'function') continue; // library.js not ready yet
            injectInto(win).catch(e => console.warn('[GreetingTitles] CL injection failed', e));
        } catch { /* cross-origin / navigating – try again next tick */ }
    }
}
setInterval(pollCL, 1000);

// ─────────────────────────────────────────────────────────────────────────────
// Chat: title bar + picker on the greeting message
// ─────────────────────────────────────────────────────────────────────────────
function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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
        const c = ctx();
        const char = currentChar();
        const mes0 = c.chat?.[0];
        const el = document.querySelector('#chat .mes[mesid="0"]');
        if (!char || !mes0 || mes0.is_user || mes0.is_system || !el) { removeUi(); return; }

        const entries = Core.list(char);
        if (!entries.some(e => e.title)) { removeUi(); return; } // no titles on this card: stay invisible

        const swipeId = Number(mes0.swipe_id ?? 0);
        const cur = entries[swipeId];
        const canPick = c.chat.length === 1 && entries.length > 1;

        let bar = el.querySelector('.gtitles-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'gtitles-bar';
            const text = el.querySelector('.mes_block .mes_text');
            if (!text) return;
            text.parentNode.insertBefore(bar, text);
            bar.addEventListener('click', onBarClick);
        }
        const label = cur ? (cur.title || `Greeting #${swipeId + 1}`) : `Greeting #${swipeId + 1}`;
        bar.classList.toggle('gtitles-pickable', canPick);
        bar.title = canPick ? 'Pick greeting' : 'Greeting (pick is only possible before the first reply)';
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

(function init() {
    const { eventSource, event_types: E } = ctx();
    [E.CHAT_CHANGED, E.CHAT_CREATED, E.MESSAGE_SWIPED, E.CHARACTER_MESSAGE_RENDERED, E.USER_MESSAGE_RENDERED,
        E.MESSAGE_DELETED, E.MESSAGE_UPDATED, E.MESSAGE_SENT, E.MORE_MESSAGES_LOADED, E.CHARACTER_EDITED]
        .filter(Boolean).forEach(ev => eventSource.on(ev, scheduleRefresh));

    const chat = document.getElementById('chat');
    if (chat) new MutationObserver(scheduleRefresh).observe(chat, { childList: true });
    document.addEventListener('click', (e) => { if (!e.target.closest?.('.gtitles-menu, .gtitles-bar')) closeMenu(); });

    globalThis.GreetingTitles = { refresh };
    scheduleRefresh();
})();
