// ==UserScript==
// @name         FRScanner
// @namespace    fr-scanner
// @version      4.4
// @description  Full spec-compliant FR Scanner 2 with menu command opening, max token count sorting, 5% max token count hiding, and specialized Korean regex template logic.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/FRScanner.js
// @downloadURL  https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/FRScanner.js
// @run-at       document-idle
// ==/UserScript==
(function () {
    "use strict";
    const STORE_KEY = "frScanner.settings.v4.2";
    const PANEL_ID = "fr-scanner-panel";
    const STYLE_ID = "fr-scanner-style";
    const EXCLUDED_TAGS = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "TEMPLATE",
        "SVG",
        "CANVAS",
        "IFRAME",
        "NAV",
        "FOOTER",
        "HEADER",
        "ASIDE",
        "BUTTON",
        "INPUT",
        "TEXTAREA",
        "SELECT",
        "OPTION"
    ]);
    const BLOCK_TAGS = new Set([
        "ADDRESS",
        "ARTICLE",
        "BLOCKQUOTE",
        "BR",
        "DD",
        "DIV",
        "DL",
        "DT",
        "FIGCAPTION",
        "FIGURE",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "MAIN",
        "P",
        "PRE",
        "SECTION",
        "TD",
        "TH",
        "TR"
    ]);
    const NON_CHAPTER_SELECTOR = [
        "script",
        "style",
        "noscript",
        "nav",
        "footer",
        "aside",
        "form",
        "button",
        "input",
        "select",
        "textarea",
        '[role="navigation"]',
        '[role="menu"]',
        '[role="dialog"]',
        ".comments",
        "#comments",
        ".comment-section",
        ".chapter-nav",
        ".chapter-navigation",
        ".pagination",
        ".advertisement",
        ".ads"
    ].join(",");
    const WORD_FILTER = new Set(["An", "Do", "Ha", "He", "Ho", "I", "No", "Oh", "So", "You"]);
    const All_Words = new Set([
        "A",
        "And",
        "Are",
        "As",
        "At",
        "Be",
        "But",
        "By",
        "Can",
        "Could",
        "Did",
        "Does",
        "For",
        "From",
        "Had",
        "Has",
        "Have",
        "Her",
        "Here",
        "Him",
        "His",
        "How",
        "If",
        "In",
        "I'm",
        "Into",
        "Is",
        "It",
        "Its",
        "Just",
        "May",
        "Me",
        "Might",
        "Must",
        "My",
        "Not",
        "Of",
        "On",
        "Once",
        "One",
        "Or",
        "Our",
        "Out",
        "Seeing",
        "She",
        "Should",
        "So",
        "Some",
        "That",
        "The",
        "Their",
        "Them",
        "Then",
        "There",
        "These",
        "They",
        "This",
        "Those",
        "Though",
        "Through",
        "To",
        "Too",
        "Up",
        "Us",
        "Was",
        "We",
        "Were",
        "What",
        "When",
        "Where",
        "Which",
        "While",
        "Who",
        "Why",
        "Will",
        "With",
        "Would",
        "Yes",
        "Yet",
        "You",
        "Your"
    ]);
    const ABBREVIATIONS = new Set([
        "Mr",
        "Mrs",
        "Ms",
        "Dr",
        "Prof",
        "Sr",
        "Jr",
        "St",
        "Rev",
        "Hon",
        "Gen",
        "Col",
        "Lt",
        "Sgt"
    ]);
    const TEMPLATES = ["Other", "Korean", "Japanese"];
    let settings = loadSettings();
    let highlightedElements = [];
    let currentCandidates = [];
    let highlightedCandidates = new Set();
    let accumulatedOccurrences = [];
    let nextOccurrencePos = 0;
    let observer = null;
    let processedNodeText = new WeakMap();
    function loadSettings() {
        const defaults = {
            x: 20,
            y: 20,
            template: "Other",
            edits: {},
            highlightedAll: false
        };
        try {
            const saved = GM_getValue(STORE_KEY, {});
            return { ...defaults, ...saved, edits: { ...(saved.edits || {}) } };
        } catch (_) {
            return defaults;
        }
    }
    function saveSettings() {
        try {
            GM_setValue(STORE_KEY, settings);
        } catch (_) {}
    }
    function isExcluded(element) {
        if (!element || element.nodeType !== 1) return false;
        if (EXCLUDED_TAGS.has(element.tagName)) return true;
        if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
        return false;
    }
    function extractVisibleText(root = null) {
        root = root || document.body || document.documentElement;
        if (!root) return "";
        const pieces = [];
        const blockSelector = [...BLOCK_TAGS].filter((tag) => tag !== "BR").join(",");
        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                const text = node.nodeValue
                    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, " ")
                    .replace(/\s+/g, " ")
                    .trim();
                if (text) pieces.push({ text, separator: " " });
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE && node !== root) return;
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (
                    node.nodeType === Node.ELEMENT_NODE &&
                    (isExcluded(node) || node.matches(NON_CHAPTER_SELECTOR) || node.closest("#" + PANEL_ID))
                ) {
                    return;
                }
                if (node.tagName === "BR") {
                    if (pieces.length) pieces[pieces.length - 1].separator = "\n";
                    return;
                }
                const isBlock = node.matches(blockSelector);
                if (isBlock && pieces.length) {
                    pieces[pieces.length - 1].separator = "\n";
                }
                for (const child of node.childNodes) walk(child);
                if (isBlock && pieces.length) {
                    pieces[pieces.length - 1].separator = "\n";
                }
                return;
            }
            for (const child of node.childNodes || []) walk(child);
        }
        walk(root);
        let result = "";
        for (const piece of pieces) {
            if (result) result += piece.separator || " ";
            result += piece.text;
        }
        return result.trim();
    }
    function normalizeToken(tokenStr, knownTokens) {
        let token = String(tokenStr || "")
            .trim()
            .replace(/[’‘]/g, "'");
        token = token.replace(/'s$/i, "").replace(/s'$/i, "s").replace(/'$/, "");
        token = token.replace(/\.+$/, "");
        if (token.length > 1 && /s$/i.test(token) && knownTokens.has(token.slice(0, -1).toLowerCase())) {
            return token.slice(0, -1);
        }
        return token;
    }
    function extractOccurrences(text) {
        const occurrences = [];
        const abbreviationPattern = [...ABBREVIATIONS]
            .sort((a, b) => b.length - a.length)
            .map((abbr) => abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
        const tokenPattern = String.raw`(?:${abbreviationPattern}\.?|[A-ZĀĒĪŌŪ]\.(?:[A-ZĀĒĪŌŪ]\.)+|[A-ZĀĒĪŌŪ]\.|[A-ZĀĒĪŌŪ]{2,}|[A-ZĀĒĪŌŪ][A-Za-zĀĒĪŌŪāēīōū0-9'’-]*)`;
        const regex = new RegExp(`(${tokenPattern}(?:\\s+${tokenPattern})*)`, "g");
        let match;
        while ((match = regex.exec(String(text || ""))) !== null) {
            const phrase = match[1].trim();
            const parts = phrase.split(/\s+/);
            let valid = true;
            for (let i = 0; i < parts.length - 1; i++) {
                if (parts[i].endsWith(".") && !ABBREVIATIONS.has(parts[i].slice(0, -1))) {
                    valid = false;
                    break;
                }
            }
            if (valid && phrase.length > 1) {
                occurrences.push({
                    phrase,
                    startPos: match.index
                });
            }
        }
        return occurrences;
    }
    function meaningfulTokens(phrase, knownTokens) {
        const expanded = String(phrase || "")
            .replace(/[’‘]/g, "'")
            .replace(/(?:[A-ZĀĒĪŌŪ]\.){2,}/g, (match) => match.replace(/\./g, " ").trim());
        const rawTokens = expanded.replace(/\./g, " ").trim().split(/\s+/).filter(Boolean);
        if (!rawTokens.length) return [];
        const filteredTokens = rawTokens.filter((token) => {
            const word = token.toLowerCase().replace(/^./, (c) => c.toUpperCase());
            if (rawTokens.length === 1 && WORD_FILTER.has(word)) return false;
            return !All_Words.has(word);
        });
        return filteredTokens.map((token) => normalizeToken(token, knownTokens)).map((token) => token.toLowerCase());
    }
    function processCandidates(occurrences) {
        const knownTokens = new Set();
        for (const occ of occurrences) {
            for (const token of occ.phrase.split(/\s+/)) {
                const normalized = token
                    .replace(/[’‘]/g, "'")
                    .replace(/(?:'s|s')$/i, "")
                    .replace(/'$/, "")
                    .replace(/\.+$/, "");
                knownTokens.add(normalized.toLowerCase());
            }
        }
        const rawMap = new Map();
        for (const occ of occurrences) {
            const phrase = occ.phrase.trim();
            const tokens = meaningfulTokens(phrase, knownTokens);
            if (!tokens.length) continue;
            const identity = [...tokens].sort().join("|");
            if (!rawMap.has(identity)) {
                rawMap.set(identity, {
                    identity,
                    variants: new Map(),
                    firstPos: occ.startPos,
                    normalizedTokens: tokens,
                    distinctTokens: new Set(tokens)
                });
            }
            const cand = rawMap.get(identity);
            cand.firstPos = Math.min(cand.firstPos, occ.startPos);
            const orderKey = tokens.join("|");
            if (!cand.variants.has(phrase)) {
                cand.variants.set(phrase, {
                    phrase,
                    orderKey,
                    count: 0,
                    firstPos: occ.startPos,
                    length: phrase.length
                });
            }
            const variant = cand.variants.get(phrase);
            variant.count++;
            variant.firstPos = Math.min(variant.firstPos, occ.startPos);
        }
        let candidates = [...rawMap.values()].map((cand) => {
            const orderCounts = new Map();
            for (const variant of cand.variants.values()) {
                const order = orderCounts.get(variant.orderKey) || {
                    count: 0,
                    firstPos: variant.firstPos
                };
                order.count += variant.count;
                order.firstPos = Math.min(order.firstPos, variant.firstPos);
                orderCounts.set(variant.orderKey, order);
            }
            const winningOrder = [...orderCounts.entries()].sort(
                (a, b) => b[1].count - a[1].count || a[1].firstPos - b[1].firstPos
            )[0]?.[0];
            const representative = [...cand.variants.values()]
                .filter((variant) => variant.orderKey === winningOrder)
                .sort((a, b) => a.length - b.length || b.count - a.count || a.firstPos - b.firstPos)[0];
            cand.phrase = representative?.phrase || "";
            cand.normalizedTokens = meaningfulTokens(cand.phrase, knownTokens);
            cand.distinctTokens = new Set(cand.normalizedTokens);
            cand.occurrences = [...cand.variants.values()].reduce((sum, variant) => sum + variant.count, 0);
            cand.orderVariants = [...cand.variants.values()]
                .filter((variant) => variant.orderKey === winningOrder)
                .map((variant) => variant.phrase);
            return cand;
        });
        // Merge candidates sharing exactly one token at different positions.
        let merged = true;
        while (merged) {
            merged = false;
            outer: for (let i = 0; i < candidates.length; i++) {
                for (let j = i + 1; j < candidates.length; j++) {
                    const a = candidates[i];
                    const b = candidates[j];
                    const shared = [...a.distinctTokens].filter((token) => b.distinctTokens.has(token));
                    if (shared.length !== 1) continue;
                    const token = shared[0];
                    if (candidates.filter((cand) => cand.distinctTokens.has(token)).length !== 2) continue;
                    if (a.normalizedTokens.indexOf(token) === b.normalizedTokens.indexOf(token)) continue;
                    const variants = new Map();
                    for (const source of [a.variants, b.variants]) {
                        for (const [phrase, variant] of source) {
                            const existing = variants.get(phrase);
                            if (existing) {
                                existing.count += variant.count;
                                existing.firstPos = Math.min(existing.firstPos, variant.firstPos);
                            } else {
                                variants.set(phrase, { ...variant });
                            }
                        }
                    }
                    const combinedTokens = [...new Set([...a.normalizedTokens, ...b.normalizedTokens])];
                    const combined = {
                        ...a,
                        variants,
                        normalizedTokens: combinedTokens,
                        distinctTokens: new Set(combinedTokens),
                        occurrences: a.occurrences + b.occurrences,
                        firstPos: Math.min(a.firstPos, b.firstPos),
                        orderVariants: [...new Set([...a.orderVariants, ...b.orderVariants])]
                    };
                    const representative = [...variants.values()].sort(
                        (x, y) => x.length - y.length || y.count - x.count || x.firstPos - y.firstPos
                    )[0];
                    if (representative) combined.phrase = representative.phrase;
                    candidates.splice(j, 1);
                    candidates.splice(i, 1, combined);
                    merged = true;
                    break outer;
                }
            }
        }
        // Remove candidates whose distinct token sets are strict subsets of others.
        candidates = candidates.filter(
            (cand) =>
                !candidates.some(
                    (other) =>
                        other !== cand &&
                        other.distinctTokens.size > cand.distinctTokens.size &&
                        [...cand.distinctTokens].every((token) => other.distinctTokens.has(token))
                )
        );
        // Calculate token counts only after candidate processing.
        const tokenFreqs = new Map();
        for (const cand of candidates) {
            for (const token of cand.distinctTokens) {
                const key = token.toLowerCase();
                tokenFreqs.set(key, (tokenFreqs.get(key) || 0) + cand.occurrences);
            }
        }
        let globalMaxScore = 0;
        for (const cand of candidates) {
            cand.maxTokenCount = Math.max(
                0,
                ...[...cand.distinctTokens].map((token) => tokenFreqs.get(token.toLowerCase()) || 0)
            );
            globalMaxScore = Math.max(globalMaxScore, cand.maxTokenCount);
        }
        if (globalMaxScore > 0) {
            candidates = candidates.filter((cand) => cand.maxTokenCount > globalMaxScore * 0.05);
        }
        candidates.sort((a, b) => b.maxTokenCount - a.maxTokenCount || a.firstPos - b.firstPos);
        for (const cand of candidates) {
            cand.identityKey = [...cand.distinctTokens]
                .map((token) => token.toLowerCase())
                .sort()
                .join("|");
            cand.tokenCountsStr = [...new Set(cand.normalizedTokens.map((token) => token.toLowerCase()))]
                .map((token) => tokenFreqs.get(token) || 0)
                .join(",");
        }
        return candidates;
    }
    function generateRegex(phrase, template) {
        const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const boundaryStart = "(?<![a-z])";
        const boundaryEnd = "(?![a-z])";
        const tokens = phrase.trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return "";
        const cleanToken = (token) => token.replace(/[’‘]/g, "'").replace(/(?:'s|s')$/i, "");
        const tokenPattern = (token) => {
            const clean = cleanToken(token);
            const base = clean.replace(/\.+$/, "");
            if (ABBREVIATIONS.has(base)) {
                return escapeRegex(base) + "\\.?";
            }
            if (/^[A-ZĀĒĪŌŪ]$/.test(base)) {
                return escapeRegex(base) + "\\.?";
            }
            return escapeRegex(base);
        };
        const joinTokens = () => {
            const result = [];
            for (let i = 0; i < tokens.length; i++) {
                result.push(tokenPattern(tokens[i]));
                if (i < tokens.length - 1) {
                    const a = cleanToken(tokens[i]).replace(/\.+$/, "");
                    const b = cleanToken(tokens[i + 1]).replace(/\.+$/, "");
                    const initials = /^[A-ZĀĒĪŌŪ]$/.test(a) && /^[A-ZĀĒĪŌŪ]$/.test(b);
                    result.push(initials ? "(?:\\s*\\.\\s*|\\s+)" : "\\s+");
                }
            }
            return result.join("");
        };
        if (template === "Korean") {
            if (!phrase.includes("-")) {
                return `${boundaryStart}${joinTokens()}${boundaryEnd}`;
            }
            const koreanTokens = tokens.map((token) =>
                escapeRegex(cleanToken(token).replace(/\.+$/, "")).replace(/-/g, "[- ]?")
            );
            const n = koreanTokens.length;
            if (n === 1) {
                return `${boundaryStart}${koreanTokens[0]}${boundaryEnd}`;
            }
            if (n === 2) {
                return `${boundaryStart}(?:${koreanTokens[0]} )?${koreanTokens[1]}${boundaryEnd}`;
            }
            const first = koreanTokens[0];
            const remaining = koreanTokens.slice(1);
            const optionalSuffix = remaining
                .slice(0, -1)
                .map((token) => `(?:${token} )?`)
                .join("");
            const mainPattern = `${first} ${optionalSuffix}${remaining[remaining.length - 1]}`;
            const alternative = remaining.join(" ");
            return `${boundaryStart}(?:${mainPattern}|${alternative})${boundaryEnd}`;
        }
        if (template === "Japanese" && tokens.length >= 2) {
            const last = tokens.length - 1;
            const first = tokenPattern(tokens[last - 1]);
            const second = tokenPattern(tokens[last]);
            const prefix = tokens.slice(0, -2).map(tokenPattern);
            const optionalPrefix = prefix.length ? `(?:${prefix.join("\\s+")}\\s+)?` : "";
            const a = cleanToken(tokens[last - 1]).replace(/\.+$/, "");
            const b = cleanToken(tokens[last]).replace(/\.+$/, "");
            const separator = /^[A-ZĀĒĪŌŪ]$/.test(a) && /^[A-ZĀĒĪŌŪ]$/.test(b) ? "(?:\\s*\\.\\s*|\\s+)" : "\\s+";
            return `${boundaryStart}${optionalPrefix}(?:${first}${separator}${second}|${second}${separator}${first})${boundaryEnd}`;
        }
        return `${boundaryStart}${joinTokens()}${boundaryEnd}`;
    }
    function withScanObserverPaused(callback) {
        const wasObserving = !!observer;
        if (wasObserving) observer.disconnect();
        try {
            callback();
        } finally {
            if (wasObserving && document.body) {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            }
        }
    }
    function clearHighlights() {
        withScanObserverPaused(() => {
            document.querySelectorAll(".fr-highlight-mark").forEach((mark) => {
                mark.replaceWith(document.createTextNode(mark.textContent || ""));
            });
            highlightedElements = [];
        });
    }
    function applyHighlights() {
        clearHighlights();
        if ((!settings.highlightedAll && highlightedCandidates.size === 0) || currentCandidates.length === 0) {
            return;
        }
        const root = document.body;
        if (!root) return;
        const selectedCandidates = currentCandidates.filter(
            (cand) => settings.highlightedAll || highlightedCandidates.has(cand.identityKey)
        );
        const textNodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || !node.nodeValue.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest("#" + PANEL_ID)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest([...EXCLUDED_TAGS].map((tag) => tag.toLowerCase()).join(","))) {
                    return NodeFilter.FILTER_REJECT;
                }
                let current = parent;
                while (current && current !== root) {
                    if (current.hidden || current.getAttribute("aria-hidden") === "true") {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const style = getComputedStyle(current);
                    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                        return NodeFilter.FILTER_REJECT;
                    }
                    current = current.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }
        withScanObserverPaused(() => {
            for (const node of textNodes) {
                const originalText = node.nodeValue;
                const matches = [];
                for (const cand of selectedCandidates) {
                    const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
                    if (!displayName) continue;
                    const regex = new RegExp(generateRegex(displayName, settings.template), "gi");
                    let match;
                    while ((match = regex.exec(originalText)) !== null) {
                        matches.push({
                            start: match.index,
                            end: regex.lastIndex,
                            text: match[0],
                            displayName
                        });
                        if (match[0].length === 0) {
                            regex.lastIndex++;
                        }
                    }
                }
                if (matches.length === 0) continue;
                matches.sort((a, b) => a.start - b.start || b.end - a.end);
                const nonOverlapping = [];
                let lastEnd = 0;
                for (const match of matches) {
                    if (match.start < lastEnd) continue;
                    nonOverlapping.push(match);
                    lastEnd = match.end;
                }
                if (nonOverlapping.length === 0) continue;
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                for (const match of nonOverlapping) {
                    if (match.start > lastIndex) {
                        fragment.appendChild(document.createTextNode(originalText.slice(lastIndex, match.start)));
                    }
                    const span = document.createElement("span");
                    span.className =
                        match.text !== match.displayName && match.text.toLowerCase() === match.displayName.toLowerCase()
                            ? "fr-highlight-mark fr-highlight-case-mismatch"
                            : "fr-highlight-mark";
                    span.textContent = match.text;
                    fragment.appendChild(span);
                    highlightedElements.push(span);
                    lastIndex = match.end;
                }
                if (lastIndex < originalText.length) {
                    fragment.appendChild(document.createTextNode(originalText.slice(lastIndex)));
                }
                if (node.parentNode) {
                    node.parentNode.replaceChild(fragment, node);
                }
            }
            initializeTextSnapshots(root);
        });
    }
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID} {
               width: min(1100px, calc(100vw - 24px));
max-width: calc(100vw - 24px);
height: min(850px, calc(100vh - 24px));
max-height: calc(100vh - 24px);
                position: fixed;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                background: #1c1e22;
                color: #e8eaf0;
                border: 1px solid #45484e;
                border-radius: 6px;
                box-shadow: 0 5px 24px rgba(0, 0, 0, 0.5);
                font: 12px/1.4 Arial, sans-serif;
                overflow: hidden;
                box-sizing: border-box;
            }
            #${PANEL_ID} * { box-sizing: border-box; }
            #${PANEL_ID} .fr-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    background: #292c32;
    border-bottom: 1px solid #45484e;
    cursor: move;
    user-select: none;
    flex-shrink: 0;
    min-height: 34px;
    overflow: visible;
    white-space: nowrap;
}
            #${PANEL_ID} .fr-title {
                font-weight: bold;
                color: #e8eaf0;
                margin-right: 4px;
            }
            #${PANEL_ID} button, #${PANEL_ID} select {
                font: inherit;
                font-size: 11px;
                line-height: 1;
                padding: 2px 6px;
                background: #101216;
                color: #fff;
                border: 1px solid #555;
                border-radius: 3px;
                cursor: pointer;
            }
            #${PANEL_ID} button:hover { background: #363940; }
            #${PANEL_ID} .fr-tablewrap {
    overflow-x: auto;
    overflow-y: auto;
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
    background: #1c1e22;
    scrollbar-gutter: stable;
}
            #${PANEL_ID} table {
    border-collapse: collapse;
    width: max-content;
    min-width: 0;
    table-layout: auto;
}
            #${PANEL_ID} th {
                position: sticky;
                top: 0;
                background: #25282e;
                color: #e8eaf0;
                border-bottom: 1px solid #363940;
                padding: 4px 6px;
                font-weight: bold;
                text-align: left;
                z-index: 1;
                white-space: nowrap;
            }
            #${PANEL_ID} td {
                border-bottom: 1px solid #363940;
                padding: 3px 6px;
                text-align: left;
                vertical-align: middle;
            }
            #${PANEL_ID} td input {
                width: auto;
                min-width: 0;
                max-width: 100%;
                box-sizing: border-box;
                background: #101216;
                color: #fff;
                border: 1px solid #555;
                border-radius: 3px;
                padding: 2px 4px;
                font: inherit;
            }
             #${PANEL_ID} th,
            #${PANEL_ID} td {
                width: fit-content;
                max-width: 600px;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #${PANEL_ID} .fr-regex {
                font-family: ui-monospace, monospace;
                font-size: 11px;
                color: #ce9178;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 600px;
            }
            .fr-highlight-mark {
                background-color: rgba(255, 235, 59, 0.35) !important;
                border-bottom: 1px dashed #ffeb3b !important;
            }
            .fr-highlight-case-mismatch {
              background-color: rgba(255, 152, 0, 0.4) !important;
             border-bottom: 1px dashed #ff9800 !important;
}
        `;
        document.head.appendChild(style);
    }
    function initializeTextSnapshots(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (
                !parent ||
                parent.closest(`#${PANEL_ID}`) ||
                parent.closest(".fr-highlight-mark") ||
                isExcluded(parent) ||
                parent.closest(NON_CHAPTER_SELECTOR)
            ) {
                continue;
            }
            if (!processedNodeText.has(node)) {
                processedNodeText.set(node, node.textContent || "");
            }
        }
    }
    function addOccurrences(occurrences) {
        for (const occ of occurrences) {
            accumulatedOccurrences.push({
                ...occ,
                startPos: nextOccurrencePos++
            });
        }
    }
    function appendNewOccurrences(text, sourceNode = null) {
        const value = String(text || "");
        if (!sourceNode) {
            if (value.trim()) addOccurrences(extractOccurrences(value));
            return;
        }
        const previous = processedNodeText.get(sourceNode);
        if (previous === value) return;
        processedNodeText.set(sourceNode, value);
        const oldCounts = new Map();
        if (previous) {
            for (const occ of extractOccurrences(previous)) {
                oldCounts.set(occ.phrase, (oldCounts.get(occ.phrase) || 0) + 1);
            }
        }
        const newCounts = new Map();
        if (value.trim()) {
            for (const occ of extractOccurrences(value)) {
                newCounts.set(occ.phrase, (newCounts.get(occ.phrase) || 0) + 1);
            }
        }
        const additions = [];
        for (const [phrase, count] of newCounts) {
            const extra = count - (oldCounts.get(phrase) || 0);
            for (let i = 0; i < extra; i++) {
                additions.push({ phrase, startPos: 0 });
            }
        }
        addOccurrences(additions);
    }
    function renderRows() {
        const tbody = document.getElementById("fr-rows");
        if (!tbody) return;
        tbody.innerHTML = "";
        if (currentCandidates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888; padding: 15px;">No candidates found.</td></tr>`;
            return;
        }
        currentCandidates.forEach((cand) => {
            const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
            const regexStr = generateRegex(displayName, settings.template);
            const tr = document.createElement("tr");
            // Name Cell (Editable)
            const tdName = document.createElement("td");
            const input = document.createElement("input");
            input.type = "text";
            input.value = displayName;
            input.addEventListener("change", (e) => {
                settings.edits[cand.identityKey] = e.target.value.trim();
                saveSettings();
                renderRows();
                applyHighlights();
            });
            tdName.appendChild(input);
            // Counts Cell
            const tdCounts = document.createElement("td");
            tdCounts.className = "fr-counts";
            tdCounts.textContent = cand.tokenCountsStr.split(",").slice(0, 4).join(",");
            // Regex Cell
            const tdRegex = document.createElement("td");
            tdRegex.className = "fr-regex";
            tdRegex.textContent = regexStr;
            tdRegex.title = regexStr;
            // Action Cell
            const tdAction = document.createElement("td");
            const btnCopy = document.createElement("button");
            btnCopy.textContent = "📋";
            btnCopy.title = "Copy Regular Expression";
            btnCopy.addEventListener("click", () => {
                navigator.clipboard.writeText(regexStr);
            });
            tdAction.appendChild(btnCopy);
            const tdHighlight = document.createElement("td");
            const btnHighlight = document.createElement("button");
            btnHighlight.textContent = highlightedCandidates.has(cand.identityKey) ? "🔆" : "🔍";
            btnHighlight.title = "Toggle Highlight for This Candidate";
            btnHighlight.addEventListener("click", () => {
                if (highlightedCandidates.has(cand.identityKey)) {
                    highlightedCandidates.delete(cand.identityKey);
                } else {
                    highlightedCandidates.add(cand.identityKey);
                }
                applyHighlights();
                renderRows();
            });
            tdHighlight.appendChild(btnHighlight);
            tr.append(tdHighlight, tdName, tdCounts, tdRegex, tdAction);
            tbody.appendChild(tr);
        });
    }
    function renderAccumulatedScan() {
        currentCandidates = processCandidates(accumulatedOccurrences);
        renderRows();
        applyHighlights();
    }
    function runScan() {
        clearHighlights();
        if (accumulatedOccurrences.length === 0) {
            nextOccurrencePos = 0;
            processedNodeText = new WeakMap();
            const text = extractVisibleText(document.body);
            addOccurrences(extractOccurrences(text));
            initializeTextSnapshots(document.body);
        } else {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let node;
            while ((node = walker.nextNode())) {
                const parent = node.parentElement;
                if (
                    !parent ||
                    parent.closest(`#${PANEL_ID}`) ||
                    parent.closest(".fr-highlight-mark") ||
                    isExcluded(parent) ||
                    parent.closest(NON_CHAPTER_SELECTOR)
                ) {
                    continue;
                }
                if (!processedNodeText.has(node)) {
                    appendNewOccurrences(node.textContent || "", node);
                }
            }
        }
        renderAccumulatedScan();
        startScanObserver();
    }
    function startScanObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            const addedRoots = new Set();
            const changedTexts = new Set();
            for (const mutation of mutations) {
                const target = mutation.target;
                const targetElement = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
                if (targetElement?.closest(`#${PANEL_ID}`) || targetElement?.closest(".fr-highlight-mark")) {
                    continue;
                }
                if (mutation.type === "childList") {
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            if (
                                node.id !== PANEL_ID &&
                                !node.closest(`#${PANEL_ID}`) &&
                                !node.closest(".fr-highlight-mark")
                            ) {
                                addedRoots.add(node);
                            }
                        } else if (node.nodeType === Node.TEXT_NODE) {
                            changedTexts.add(node);
                        }
                    }
                } else if (mutation.type === "characterData") {
                    changedTexts.add(target);
                }
            }
            const roots = [...addedRoots].filter(
                (node) => ![...addedRoots].some((other) => other !== node && other.contains(node))
            );
            for (const root of roots) {
                if (
                    !root.isConnected ||
                    isExcluded(root) ||
                    root.matches(NON_CHAPTER_SELECTOR) ||
                    root.closest(`#${PANEL_ID}`)
                ) {
                    continue;
                }
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                const textNodes = [];
                if (root.nodeType === Node.TEXT_NODE) {
                    textNodes.push(root);
                } else {
                    let node;
                    while ((node = walker.nextNode())) {
                        textNodes.push(node);
                    }
                }
                for (const node of textNodes) {
                    if (processedNodeText.has(node)) continue;
                    const parent = node.parentElement;
                    if (
                        !parent ||
                        parent.closest(`#${PANEL_ID}`) ||
                        parent.closest(".fr-highlight-mark") ||
                        isExcluded(parent) ||
                        parent.closest(NON_CHAPTER_SELECTOR)
                    ) {
                        continue;
                    }
                    appendNewOccurrences(node.textContent || "", node);
                }
            }
            for (const node of changedTexts) {
                if (!node.isConnected || processedNodeText.has(node) === false) {
                    continue;
                }
                const parent = node.parentElement;
                if (
                    !parent ||
                    parent.closest(`#${PANEL_ID}`) ||
                    parent.closest(".fr-highlight-mark") ||
                    isExcluded(parent) ||
                    parent.closest(NON_CHAPTER_SELECTOR)
                ) {
                    continue;
                }
                if (
                    roots.some((root) => root === node || (root.nodeType === Node.ELEMENT_NODE && root.contains(node)))
                ) {
                    continue;
                }
                appendNewOccurrences(node.textContent || "", node);
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;
        ensureStyle();
        const panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.style.left = `${Math.max(0, settings.x)}px`;
        panel.style.top = `${Math.max(0, settings.y)}px`;
        panel.innerHTML = `
            <div class="fr-head">
                <label style="display:flex; align-items:center; gap:4px; margin-left: auto;">
                    <select id="fr-template">
                        ${TEMPLATES.map((t) => `<option value="${t}" ${t === settings.template ? "selected" : ""}>${t}</option>`).join("")}
                    </select>
                </label>
                <button id="fr-scan" title="Scan the page">Scan</button>
                <button id="fr-empty" title="Clear accumulated scan data">Empty</button>
                <button id="fr-highlight" title="Toggle Highlight All">Highlight All: Off</button>
                <button id="fr-minimize" title="Minimize panel">−</button>
                <button id="fr-close" title="Close Panel">×</button>
            </div>
            <div class="fr-tablewrap" id="fr-tablewrap">
                <table id="fr-table">
                    <thead>
                <tr>
                   <th>Hi</th>
                      <th>Name</th>
                      <th>Ct</th>
                   <th>Regex</th>
                   <th>RC</th>
                </tr>
                    </thead>
                    <tbody id="fr-rows"></tbody>
                </table>
            </div>
        `;
        const highlightAllButton = panel.querySelector("#fr-highlight");
        function updateHighlightAllButton() {
            highlightAllButton.textContent = `Highlight All: ${settings.highlightedAll ? "On" : "Off"}`;
            highlightAllButton.setAttribute("aria-pressed", String(settings.highlightedAll));
        }
        updateHighlightAllButton();
        document.body.appendChild(panel);
        const minimizeButton = panel.querySelector("#fr-minimize");
        const tableWrap = panel.querySelector("#fr-tablewrap");
        minimizeButton.addEventListener("click", () => {
            const minimized = tableWrap.hidden;
            tableWrap.hidden = !minimized;
            minimizeButton.textContent = minimized ? "−" : "+";
            minimizeButton.title = minimized ? "Minimize panel" : "Restore panel";
        });
        panel.querySelector("#fr-scan").addEventListener("click", runScan);
        document.getElementById("fr-empty").addEventListener("click", () => {
            accumulatedOccurrences = [];
            nextOccurrencePos = 0;
            processedNodeText = new WeakMap();
            initializeTextSnapshots(document.body);
            clearHighlights();
            renderAccumulatedScan();
        });
        panel.querySelector("#fr-highlight").addEventListener("click", () => {
            settings.highlightedAll = !settings.highlightedAll;
            saveSettings();
            updateHighlightAllButton();
            applyHighlights();
        });
        panel.querySelector("#fr-template").addEventListener("change", (e) => {
            settings.template = e.target.value;
            saveSettings();
            renderRows();
            applyHighlights();
        });
        panel.querySelector("#fr-close").addEventListener("click", () => {
            clearHighlights();
            panel.remove();
        });
        makeDraggable(panel, panel.querySelector(".fr-head"));
        runScan();
    }
    function makeDraggable(panel, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        let activePointerId = null;
        function stopDragging() {
            if (!isDragging) return;
            isDragging = false;
            activePointerId = null;
            settings.x = panel.offsetLeft;
            settings.y = panel.offsetTop;
            saveSettings();
        }
        handle.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button, select, input, label")) return;
            if (e.button !== 0) return;
            isDragging = true;
            activePointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = panel.offsetLeft;
            initialTop = panel.offsetTop;
            e.preventDefault();
            panel.setPointerCapture(e.pointerId);
        });
        panel.addEventListener("pointermove", (e) => {
            if (!isDragging || e.pointerId !== activePointerId) return;
            panel.style.left = `${Math.max(0, initialLeft + e.clientX - startX)}px`;
            panel.style.top = `${Math.max(0, initialTop + e.clientY - startY)}px`;
        });
        panel.addEventListener("pointerup", (e) => {
            if (e.pointerId !== activePointerId) return;
            stopDragging();
            if (panel.hasPointerCapture(e.pointerId)) {
                panel.releasePointerCapture(e.pointerId);
            }
        });
        panel.addEventListener("pointercancel", stopDragging);
        panel.addEventListener("lostpointercapture", stopDragging);
        window.addEventListener("blur", stopDragging);
    }
    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Open", createPanel);
    }
})();
