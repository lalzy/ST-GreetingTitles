// Greeting Titles – CharacterLibrary integration.
// Injected as a classic <script> into CL's library.html by the ST side (index.js).
// CL's app/library.js is a classic script, so its top-level functions are properties of `window`
// and its top-level `let`s (activeChar, pendingUpdates) are visible here by name. We wrap a few
// functions; CL's own files are never modified.
/* global activeChar, pendingUpdates */
(function () {
    'use strict';
    if (window.__greetingTitlesCL) return;
    const Core = window.GreetingTitlesCore;
    if (!Core) { console.warn('[GreetingTitles] core missing'); return; }

    const REQUIRED = ['populateEditPane', 'populateAltGreetingsEditor', 'addAltGreetingField', 'collectEditValues',
        'generateChangesDiff', 'showSaveConfirmation', 'paintModalHeavyContent', 'openAltGreetingsFullscreen', 'openGreetingsModal'];
    const missing = REQUIRED.filter(n => typeof window[n] !== 'function');
    if (missing.length) {
        console.warn('[GreetingTitles] CharacterLibrary changed; missing hooks:', missing.join(', '), '- titles inside CL disabled.');
        return;
    }
    window.__greetingTitlesCL = true;

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const getActive = () => { try { return activeChar; } catch { return null; } };

    // ── styles ──────────────────────────────────────────────────────────────
    const style = document.createElement('style');
    style.textContent = `
      .gt-title-input{width:100%;margin:0 0 4px 0;font-weight:600;padding:4px 8px !important;min-height:0 !important;}
      .gt-alt-wrap{flex:1;display:flex;flex-direction:column;min-width:0;}
      .gt-badge{color:var(--accent);font-weight:700;}
      .gt-main-title{margin:0 0 6px 0;font-weight:700;color:var(--accent);}
      .gt-num-title{margin-left:6px;font-weight:600;}
    `;
    document.head.appendChild(style);

    // ── Edit tab: main greeting title ───────────────────────────────────────
    function ensureMainInput() {
        let input = document.getElementById('gtMainTitle');
        if (input) return input;
        const fm = document.getElementById('editFirstMes');
        if (!fm) return null;
        input = document.createElement('input');
        input.type = 'text';
        input.id = 'gtMainTitle';
        input.className = 'glass-input gt-title-input';
        input.placeholder = 'Title for the first message (optional)';
        input.autocomplete = 'off';
        fm.parentNode.insertBefore(input, fm);
        return input;
    }

    // ── Edit tab: alt greeting rows ─────────────────────────────────────────
    // `source` = titles to hand out when rows are (re)built; `snapshot` = live state of the rows.
    let snapshot = [];   // [{hash, title}]
    let source = [];
    let sourceUsed = new Set();
    let baseline = null; // stored object at load time, for dirty check
    let migrateGT = false;

    function container() { return document.getElementById('altGreetingsEditContainer'); }

    function readRows() {
        const c = container();
        if (!c) return [];
        return [...c.querySelectorAll('.alt-greeting-item')].map(row => ({
            text: row.querySelector('.alt-greeting-input')?.value ?? '',
            title: row.querySelector('.gt-title-input')?.value ?? '',
        }));
    }

    function takeSnapshot() {
        snapshot = readRows().map(r => ({ hash: Core.hash(r.text), title: Core.cleanTitle(r.title) }));
    }

    function pickTitle(value, idx) {
        if (!Core.norm(value)) return '';
        let j = source.findIndex((e, k) => !sourceUsed.has(k) && e.hash === Core.hash(value));
        if (j === -1 && source[idx] && !sourceUsed.has(idx)) j = idx; // edited in place
        if (j === -1) return '';
        sourceUsed.add(j);
        return source[j].title;
    }

    function decorateRow(row, title) {
        if (row.querySelector('.gt-title-input')) return;
        const ta = row.querySelector('.alt-greeting-input');
        if (!ta) return;
        const wrap = document.createElement('div');
        wrap.className = 'gt-alt-wrap';
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'glass-input gt-title-input';
        input.placeholder = 'Title (optional)';
        input.autocomplete = 'off';
        input.value = title || '';
        input.readOnly = ta.readOnly; // CL locks fields via readOnly
        ta.parentNode.insertBefore(wrap, ta);
        wrap.appendChild(input);
        wrap.appendChild(ta);
    }

    const origAdd = window.addAltGreetingField;
    window.addAltGreetingField = function (cont, value = '', index = null) {
        const c = cont || container();
        const ret = origAdd.apply(this, arguments);
        try {
            if (c && c.id === 'altGreetingsEditContainer') {
                const rows = c.querySelectorAll('.alt-greeting-item');
                if (rows.length === 1) { source = snapshot.slice(); sourceUsed = new Set(); } // a (re)build starts
                const row = rows[rows.length - 1];
                if (row) decorateRow(row, pickTitle(value, index ?? rows.length - 1));
                takeSnapshot();
            }
        } catch (e) { console.error('[GreetingTitles] addAltGreetingField hook', e); }
        return ret;
    };

    const origPopulateAlts = window.populateAltGreetingsEditor;
    window.populateAltGreetingsEditor = function (greetings) {
        try {
            const list = Array.isArray(greetings) ? greetings : [];
            const r = Core.resolve(getActive(), list.map(g => g || ''));
            snapshot = list.map((g, i) => ({ hash: Core.hash(g), title: r.alts[i] }));
            // Called on load and on Cancel: both mean "show what's stored".
            const input = ensureMainInput();
            if (input) input.value = r.main;
            populateGen++;
        } catch (e) { console.error('[GreetingTitles] populate hook', e); }
        return origPopulateAlts.apply(this, arguments);
    };
    let populateGen = 0;

    document.addEventListener('input', (e) => {
        const t = e.target;
        if (t && t.closest && t.closest('#altGreetingsEditContainer')) takeSnapshot();
    }, true);

    // Current editor state → stored object (same skip-empty rule CL uses for alternate_greetings).
    function currentTitles() {
        const rows = readRows().filter(r => r.text.trim());
        const main = document.getElementById('gtMainTitle')?.value ?? '';
        return Core.build(main, rows.map(r => r.text), rows.map(r => r.title));
    }

    const origPopulatePane = window.populateEditPane;
    window.populateEditPane = async function () {
        const genBefore = populateGen;
        const ret = await origPopulatePane.apply(this, arguments);
        try {
            // populateEditPane returns early when already populated; only (re)baseline on a real load.
            if (populateGen !== genBefore) {
                const input = ensureMainInput();
                if (input) input.readOnly = !!document.getElementById('editFirstMes')?.readOnly;
                const r = Core.resolve(getActive());
                baseline = currentTitles();
                // Titles read from Greeting Tools get written in our format whenever this card is next saved.
                migrateGT = r.source === 'greeting_tools';
            }
        } catch (e) { console.error('[GreetingTitles] populateEditPane hook', e); }
        return ret;
    };

    function titlesDirty(now) {
        if (!baseline) return Core.hasAny(now);
        if (!Core.hasAny(now) && !Core.hasAny(baseline)) return false;
        return JSON.stringify(now) !== JSON.stringify(baseline);
    }

    function titleLines(obj) {
        if (!obj) return '(none)';
        const lines = [];
        if (obj.main) lines.push(`First message: ${obj.main}`);
        obj.alts.forEach((a, i) => { if (a.title) lines.push(`#${i + 1}: ${a.title}`); });
        return lines.join('\n') || '(none)';
    }

    const origCollect = window.collectEditValues;
    window.collectEditValues = function () {
        const v = origCollect.apply(this, arguments);
        try { v.__greetingTitles = currentTitles(); } catch (e) { console.error('[GreetingTitles] collect hook', e); }
        return v;
    };

    const origDiff = window.generateChangesDiff;
    window.generateChangesDiff = function (original, current) {
        const changes = origDiff.apply(this, arguments);
        try {
            const now = current?.__greetingTitles;
            if (now && titlesDirty(now)) {
                const oldL = titleLines(baseline), newL = titleLines(now);
                if (oldL !== newL) changes.push({ field: 'Greeting Titles', old: oldL, new: newL });
                else if (!changes.length) changes.push({ field: 'Greeting Titles', old: oldL, new: newL + '\n(re-linked to edited greetings)' });
            }
        } catch (e) { console.error('[GreetingTitles] diff hook', e); }
        return changes;
    };

    const origConfirm = window.showSaveConfirmation;
    window.showSaveConfirmation = function () {
        const ret = origConfirm.apply(this, arguments);
        try {
            const now = currentTitles();
            // pendingUpdates is CL's top-level `let`; it is set only when the confirm dialog opened.
            if (pendingUpdates && (titlesDirty(now) || (migrateGT && Core.hasAny(now)))) {
                pendingUpdates['extensions.' + Core.KEY] = now;
                pendingTitleWrite = now;
            }
        } catch (e) { console.error('[GreetingTitles] confirm hook', e); }
        return ret;
    };
    let pendingTitleWrite = null;

    // After a successful CL save, refresh our baseline and poke ST so its chat label updates.
    // (performSave is bound as onclick at CL startup, so we hook the primitive it calls by name.)
    if (typeof window.writeCardFields === 'function') {
        const origWrite = window.writeCardFields;
        window.writeCardFields = async function (char, updates) {
            const ours = updates && Object.prototype.hasOwnProperty.call(updates, 'extensions.' + Core.KEY) ? updates['extensions.' + Core.KEY] : null;
            const ret = await origWrite.apply(this, arguments);
            try {
                if (ours && ret?.ok) {
                    if (ours === pendingTitleWrite) { baseline = ours; pendingTitleWrite = null; migrateGT = false; }
                    syncToST(char);
                }
            } catch (e) { console.error('[GreetingTitles] write hook', e); }
            return ret;
        };
    }

    function syncToST(char) {
        try {
            const host = window.opener && !window.opener.closed ? window.opener : (window.parent !== window ? window.parent : null);
            const ctx = host?.SillyTavern?.getContext?.();
            const idx = ctx?.characters?.findIndex(c => c.avatar === char.avatar) ?? -1;
            const value = JSON.parse(JSON.stringify(char.data.extensions[Core.KEY]));
            // writeExtensionField also updates ST's cached json_data, which ST's own editor saves from.
            // Without that, the next save in ST's character panel would write the old titles back.
            if (idx !== -1 && typeof ctx.writeExtensionField === 'function') ctx.writeExtensionField(idx, Core.KEY, value);
            host?.GreetingTitles?.refresh?.();
        } catch { /* ST window not reachable; it will pick titles up on next load */ }
    }

    // ── Details tab ─────────────────────────────────────────────────────────
    const origPaint = window.paintModalHeavyContent;
    window.paintModalHeavyContent = function (char) {
        const ret = origPaint.apply(this, arguments);
        try { decorateDetails(char); } catch (e) { console.error('[GreetingTitles] details hook', e); }
        return ret;
    };

    function decorateDetails(char) {
        const r = Core.resolve(char);
        const fm = document.getElementById('modalFirstMes');
        let badge = document.getElementById('gtMainTitleBadge');
        if (fm) {
            if (!badge) {
                badge = document.createElement('div');
                badge.id = 'gtMainTitleBadge';
                badge.className = 'gt-main-title';
                fm.parentNode.insertBefore(badge, fm);
            }
            badge.textContent = r.main;
            badge.style.display = r.main ? '' : 'none';
        }
        const list = document.getElementById('modalAltGreetings');
        if (list) {
            [...list.children].forEach((item, i) => {
                const strong = item.querySelector('strong');
                if (strong) strong.innerHTML = `#${i + 1}${r.alts[i] ? ` · <span class="gt-badge">${esc(r.alts[i])}</span>` : ''}:`;
            });
        }
    }

    // ── Fullscreen alt greeting viewer ──────────────────────────────────────
    const origFull = window.openAltGreetingsFullscreen;
    window.openAltGreetingsFullscreen = function (greetings) {
        const ret = origFull.apply(this, arguments);
        try {
            const r = Core.resolve(getActive(), Array.isArray(greetings) ? greetings : []);
            const modal = document.getElementById('altGreetingsFullscreenModal');
            r.alts.forEach((title, i) => {
                if (!title || !modal) return;
                const label = modal.querySelector(`.greeting-card[data-greeting-index="${i}"] .greeting-label`);
                if (label) label.textContent = title;
                const nav = modal.querySelector(`.greeting-nav-btn[data-index="${i}"]`);
                if (nav) nav.title = `#${i + 1}: ${title}`;
            });
        } catch (e) { console.error('[GreetingTitles] fullscreen hook', e); }
        return ret;
    };

    // ── Expanded greetings editor (display titles; editing stays in the Edit tab) ─
    const origExpand = window.openGreetingsModal;
    window.openGreetingsModal = function () {
        const rowsBefore = readRows();
        const ret = origExpand.apply(this, arguments);
        try {
            const main = document.getElementById('gtMainTitle')?.value;
            const modal = document.getElementById('greetingsExpandModal');
            if (modal) {
                modal.querySelectorAll('.expanded-greeting-item').forEach((item, i) => {
                    const t = Core.cleanTitle(rowsBefore[i]?.title);
                    const num = item.querySelector('.expanded-greeting-num');
                    if (t && num && !num.querySelector('.gt-num-title')) num.insertAdjacentHTML('beforeend', `<span class="gt-num-title">· ${esc(t)}</span>`);
                });
                const fmArea = document.getElementById('expandedFirstMes');
                if (main && fmArea && !document.getElementById('gtExpandedMain')) {
                    fmArea.insertAdjacentHTML('beforebegin', `<div id="gtExpandedMain" class="gt-main-title">${esc(main)}</div>`);
                }
            }
        } catch (e) { console.error('[GreetingTitles] expand hook', e); }
        return ret;
    };

    // If a character modal is already open when we get injected, decorate it now.
    try {
        const c = getActive();
        if (c) {
            decorateDetails(c);
            const rows = [...(container()?.querySelectorAll('.alt-greeting-item') ?? [])];
            if (rows.length && !rows[0].querySelector('.gt-title-input')) {
                const r = Core.resolve(c, rows.map(row => row.querySelector('.alt-greeting-input')?.value ?? ''));
                rows.forEach((row, i) => decorateRow(row, r.alts[i]));
                const input = ensureMainInput();
                if (input) { input.value = r.main; input.readOnly = !!document.getElementById('editFirstMes')?.readOnly; }
                takeSnapshot();
                baseline = currentTitles();
                migrateGT = r.source === 'greeting_tools';
            }
        }
    } catch (e) { console.error('[GreetingTitles] late init', e); }
    ensureMainInput();
    console.log('[GreetingTitles] CharacterLibrary integration active');
})();
