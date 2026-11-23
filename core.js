// Greeting Titles – shared core (plain script; runs in ST and inside CharacterLibrary's page).
// Storage: character.data.extensions.greeting_titles = { v: 1, main: "Title", alts: [{ title, hash }] }
// `alts` is aligned with data.alternate_greetings at save time; `hash` lets titles follow their
// greeting if something else (ST editor, other tools) deletes/reorders greetings later.
(function (root) {
    'use strict';

    const KEY = 'greeting_titles';

    function norm(s) {
        return String(s ?? '').replace(/\r\n/g, '\n').trim();
    }

    // FNV-1a 32-bit of normalized text, base36.
    function hash(s) {
        const t = norm(s);
        let h = 0x811c9dc5;
        for (let i = 0; i < t.length; i++) {
            h ^= t.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h.toString(36);
    }

    function cleanTitle(t) {
        return String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    }

    function getData(char) {
        return char?.data ?? char ?? {};
    }

    function getAltTexts(char) {
        const d = getData(char);
        const a = d.alternate_greetings ?? char?.alternate_greetings;
        return Array.isArray(a) ? a : [];
    }

    function getFirstMes(char) {
        const d = getData(char);
        return d.first_mes ?? char?.first_mes ?? '';
    }

    /**
     * Match stored alt entries ({title, hash}) to a list of current greeting texts.
     * 1) same index + same hash  2) same hash anywhere (moved)  3) same index, if that stored
     * entry's greeting no longer exists anywhere (edited in place).
     * @returns {string[]} titles aligned with `texts`
     */
    function matchAlts(stored, texts) {
        const out = texts.map(() => '');
        if (!Array.isArray(stored) || stored.length === 0) return out;
        const hashes = texts.map(hash);
        const present = new Set(hashes);
        const used = new Set();
        const done = new Set();

        hashes.forEach((h, i) => {
            const e = stored[i];
            if (e && e.hash === h) { out[i] = cleanTitle(e.title); used.add(i); done.add(i); }
        });
        hashes.forEach((h, i) => {
            if (done.has(i)) return;
            const j = stored.findIndex((e, k) => !used.has(k) && e && e.hash === h);
            if (j !== -1) { out[i] = cleanTitle(stored[j].title); used.add(j); done.add(i); }
        });
        hashes.forEach((h, i) => {
            if (done.has(i)) return;
            const e = stored[i];
            if (e && !used.has(i) && !present.has(e.hash) && norm(texts[i])) {
                out[i] = cleanTitle(e.title); used.add(i); done.add(i);
            }
        });
        return out;
    }

    /**
     * Resolve titles for a character.
     * @param {object} char ST character object (or CL char)
     * @param {string[]} [texts] greeting texts to resolve against (defaults to the card's)
     * @returns {{ main: string, alts: string[], source: 'own'|'greeting_tools'|'none' }}
     */
    function resolve(char, texts) {
        const alts = Array.isArray(texts) ? texts : getAltTexts(char);
        const ext = getData(char).extensions ?? {};
        const own = ext[KEY];
        if (own && typeof own === 'object') {
            return { main: cleanTitle(own.main), alts: matchAlts(own.alts, alts), source: 'own' };
        }
        // Read-only fallback: titles made with the "Greeting Tools" extension.
        const gt = ext.greeting_tools;
        if (gt && typeof gt === 'object') {
            const byIndex = (i) => {
                const id = gt.indexMap?.[i];
                return cleanTitle(id ? gt.greetings?.[id]?.title : '');
            };
            const original = getAltTexts(char);
            // GT keys by index of the card's current list; only trust it for those exact texts.
            const stored = original.map((t, i) => ({ title: byIndex(i), hash: hash(t) }));
            return { main: cleanTitle(gt.mainGreeting?.title), alts: matchAlts(stored, alts), source: 'greeting_tools' };
        }
        return { main: '', alts: alts.map(() => ''), source: 'none' };
    }

    /** Build the object to store. `altTexts` must be exactly what will be saved as alternate_greetings. */
    function build(mainTitle, altTexts, altTitles) {
        return {
            v: 1,
            main: cleanTitle(mainTitle),
            alts: altTexts.map((t, i) => ({ title: cleanTitle(altTitles[i]), hash: hash(t) })),
        };
    }

    function hasAny(obj) {
        return !!(obj && (obj.main || (obj.alts || []).some(a => a && a.title)));
    }

    /**
     * Title for a swipe of ST's greeting message (chat[0]).
     * ST builds swipes as [first_mes, ...alternate_greetings], dropping first_mes when it's empty.
     * @returns {{ index: number, title: string, isMain: boolean } | null}
     */
    function forSwipe(char, swipeId) {
        const r = resolve(char);
        const shift = norm(getFirstMes(char)) ? 0 : 1;
        const g = Number(swipeId ?? 0) + shift; // 0 = main, k = alt k-1
        if (g === 0) return { index: 0, title: r.main, isMain: true };
        if (g - 1 < r.alts.length) return { index: g, title: r.alts[g - 1], isMain: false };
        return null;
    }

    /** List of greetings in swipe order: [{ swipeId, title, text, isMain }] */
    function list(char) {
        const r = resolve(char);
        const out = [];
        const first = getFirstMes(char);
        if (norm(first)) out.push({ title: r.main, text: first, isMain: true });
        getAltTexts(char).forEach((t, i) => out.push({ title: r.alts[i], text: t, isMain: false, altIndex: i }));
        return out.map((e, swipeId) => ({ ...e, swipeId }));
    }

    root.GreetingTitlesCore = { KEY, norm, hash, cleanTitle, matchAlts, resolve, build, hasAny, forSwipe, list };
})(typeof globalThis !== 'undefined' ? globalThis : window);
