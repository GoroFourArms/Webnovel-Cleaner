// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    CPS
// @version      1.0.4
// @description  CPS scanner with FoxReplace rule matching.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==
(function () {
    "use strict";
    const STORE_KEY = "frScanner.settings";
    const FOXREPLACE_STORE_KEY = "WNC_FOXREPLACE_DB_V1";
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
        "Actually",
        "Although",
        "Alright",
        "After",
        "Am",
        "All",
        "And",
        "Are",
        "As",
        "At",
        "Be",
        "Before",
        "Because",
        "Besides",
        "But",
        "By",
        "Can",
        "Could",
        "Did",
        "Does",
        "Even",
        "For",
        "From",
        "Had",
        "Has",
        "Have",
        "Her",
        "Hearing",
        "Here",
        "Him",
        "His",
        "How",
        "However",
        "If",
        "In",
        "I'll",
        "I'm",
        "Into",
        "Involving",
        "Is",
        "It",
        "Its",
        "Just",
        "May",
        "Maybe",
        "Me",
        "Might",
        "Must",
        "My",
        "Not",
        "Of",
        "On",
        "Once",
        "One",
        "Only",
        "Or",
        "Our",
        "Out",
        "Seeing",
        "Sensing",
        "She",
        "Since",
        "Should",
        "So",
        "Some",
        "Take",
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
        "Watching",
        "Was",
        "We",
        "Were",
        "What",
        "When",
        "Whether",
        "Where",
        "Which",
        "While",
        "Who",
        "Why",
        "Will",
        "With",
        "Without",
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
    const TEMPLATES = ["Other", "Korean", "Japanese", "Japanese 2"];
    let candidateSortMode = "count-desc";
    let candidateFilterMode = "all";
    let settings = loadSettings();
    let currentCandidates = [];
    let accumulatedOccurrences = [];
    let observer;
    let observerFlushTimer = null;
    let isScanning = false;
    function loadSettings() {
        const defaults = {
            x: 20,
            y: 20,
            template: "Other",
            edits: {}
        };
        try {
            const saved = GM_getValue(STORE_KEY, {});
            if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
                return defaults;
            }
            return {
                x: Number.isFinite(saved.x) ? saved.x : defaults.x,
                y: Number.isFinite(saved.y) ? saved.y : defaults.y,
                template: TEMPLATES.includes(saved.template) ? saved.template : defaults.template,
                edits:
                    saved.edits && typeof saved.edits === "object" && !Array.isArray(saved.edits)
                        ? { ...saved.edits }
                        : {}
            };
        } catch {
            return defaults;
        }
    }
    function saveSettings() {
        try {
            GM_setValue(STORE_KEY, settings);
        } catch {}
    }
    function isExcluded(element) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) {
            return false;
        }
        if (EXCLUDED_TAGS.has(element.tagName)) {
            return true;
        }
        if (
            element.hidden ||
            element.getAttribute("aria-hidden") === "true" ||
            element.getAttribute("inert") !== null
        ) {
            return true;
        }
        const style = getComputedStyle(element);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.opacity === "0"
        ) {
            return true;
        }
        return false;
    }
    function extractVisibleText(root = null) {
        root = root || document.body || document.documentElement;
        if (!root) {
            return { text: "", segments: [] };
        }
        const runs = [];
        let currentRun = { text: "", segments: [] };
        function finishRun() {
            if (currentRun.text) {
                runs.push(currentRun);
            }
            currentRun = { text: "", segments: [] };
        }
        function appendTextNode(node) {
            const originalText = node.nodeValue || "";
            if (!originalText) return;
            const start = currentRun.text.length;
            currentRun.text += originalText;
            currentRun.segments.push({
                node,
                start,
                end: currentRun.text.length,
                nodeStart: 0,
                nodeEnd: originalText.length,
                textSnapshot: originalText
            });
        }
        function isExcludedElement(element) {
            if (!element || element.nodeType !== Node.ELEMENT_NODE) {
                return false;
            }
            return isExcluded(element) || element.matches(NON_CHAPTER_SELECTOR) || !!element.closest("#" + PANEL_ID);
        }
        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                appendTextNode(node);
                return;
            }
            if (
                node.nodeType !== Node.ELEMENT_NODE &&
                node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE &&
                node.nodeType !== Node.DOCUMENT_NODE
            ) {
                return;
            }
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (isExcludedElement(node)) {
                    finishRun();
                    return;
                }
                if (node.tagName === "BR") {
                    finishRun();
                    return;
                }
            }
            const isBlock = node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(node.tagName);
            if (isBlock) {
                finishRun();
            }
            for (const child of node.childNodes) {
                walk(child);
            }
            if (isBlock) {
                finishRun();
            }
        }
        if (root.nodeType === Node.TEXT_NODE) {
            let parent = root.parentElement;
            let excluded = false;
            while (parent) {
                if (isExcludedElement(parent)) {
                    excluded = true;
                    break;
                }
                parent = parent.parentElement;
            }
            if (!excluded) {
                appendTextNode(root);
            }
        } else {
            walk(root);
        }
        finishRun();
        return {
            text: runs.map((run) => run.text).join("\n"),
            segments: runs
        };
    }
    function normalizeToken(tokenStr, knownTokens) {
        let token = String(tokenStr || "")
            .trim()
            .replace(/[’‘]/g, "'")
            .replace(/\.+$/, "");
        if (/s'$/i.test(token)) {
            token = token.slice(0, -1);
        }
        token = token.replace(/'s$/i, "").replace(/'$/, "");
        if (token.length > 2) {
            if (/(?:ches|shes|xes|zes|sses)$/i.test(token)) {
                const singular = token.slice(0, -2);
                if (knownTokens.has(singular.toLowerCase())) {
                    token = singular;
                }
            } else if (/ies$/i.test(token)) {
                const singular = token.slice(0, -3) + "y";
                if (knownTokens.has(singular.toLowerCase())) {
                    token = singular;
                }
            } else if (/s$/i.test(token) && !/ss$/i.test(token)) {
                const singular = token.slice(0, -1);
                if (knownTokens.has(singular.toLowerCase())) {
                    token = singular;
                }
            }
        }
        return token;
    }
    function buildKnownTokens(occurrences) {
        const knownTokens = new Set();
        for (const occ of occurrences) {
            for (const rawToken of String(occ.phrase || "").split(/\s+/)) {
                let token = rawToken.trim().replace(/[’‘]/g, "'").replace(/\.+$/, "");
                token = token.replace(/'s$/i, "").replace(/'$/, "");
                if (token) {
                    knownTokens.add(token.toLowerCase());
                }
            }
        }
        return knownTokens;
    }
    function extractOccurrences(text, sourceNode = null, options = {}) {
        const occurrences = [];
        const diagnostics = options.diagnostics || null;
        const snapshot = String(text || "");
        const abbreviationPattern = [...ABBREVIATIONS]
            .sort((a, b) => b.length - a.length)
            .map((abbr) => abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
        const tokenPattern = String.raw`(?:(?:${abbreviationPattern})\.(?![A-Za-zÀ-ÖØ-öø-ÿĀ-ž])|(?:${abbreviationPattern})(?![A-Za-zÀ-ÖØ-öø-ÿĀ-ž])|[A-Z](?:\.[A-Z])+\..?|[A-Z]\.|[A-Z]{2,}|[A-ZÀ-ÖØ-ÞĀ-Ž][A-Za-zà-öø-ÿā-ž0-9'’-]*)`;
        const regex = new RegExp(`(${tokenPattern}(?: (?:(?:of(?: the)?) )*${tokenPattern})*)`, "g");
        let match;
        while ((match = regex.exec(snapshot)) !== null) {
            const phrase = match[1].trim();
            const parts = phrase.split(/\s+/);
            let rejectionReason = null;
            for (let i = 0; i < parts.length - 1; i++) {
                if (parts[i].endsWith(".") && !ABBREVIATIONS.has(parts[i].slice(0, -1))) {
                    rejectionReason = "non-abbreviation-period-before-final-token";
                    break;
                }
            }
            if (!rejectionReason && phrase.length <= 1) {
                rejectionReason = "phrase-too-short";
            }
            const occurrence = {
                phrase,
                sourceNode,
                startPos: match.index,
                endPos: match.index + match[1].length,
                accepted: rejectionReason === null,
                rejectionReason,
                textSnapshot: snapshot
            };
            if (occurrence.accepted) {
                occurrences.push(occurrence);
            }
            if (diagnostics) {
                diagnostics.push(occurrence);
            }
        }
        return occurrences;
    }
    function tokenizePhrase(phrase) {
        const expanded = String(phrase || "")
            .replace(/[’‘]/g, "'")
            .replace(/(?:[A-ZĀĒĪŌŪ]\.){2,}/g, (match) => match.replace(/\./g, " ").trim());
        const rawTokens = expanded.replace(/\./g, " ").trim().split(/\s+/).filter(Boolean);
        return rawTokens.map((original) => ({
            original,
            normalized: null,
            filterDecision: null,
            filterReason: null,
            identity: null
        }));
    }
    function normalizeTokens(tokens, knownTokens) {
        return tokens.map((record) => {
            const normalized = normalizeToken(record.original, knownTokens);
            return {
                ...record,
                normalized
            };
        });
    }
    function isContraction(tokenStr) {
        const token = String(tokenStr || "")
            .trim()
            .replace(/[’‘]/g, "'");
        if (/^[a-z]+(?:n't|'m|'re|'ve|'ll|'d)$/i.test(token)) {
            return true;
        }
        if (
            /^(?:he|she|it|that|there|here|what|who|where|when|why|how|let|everyone|everybody|someone|somebody|anyone|anybody|no one|one|whoever|whatever|whichever|nobody|nothing|something|anything|everything)'s$/i.test(
                token
            )
        ) {
            return true;
        }
        return /^(?:y'all|let's|ma'am|o'clock)$/i.test(token);
    }
    function filterTokens(tokens) {
        return tokens.map((record) => {
            const contractionMatch = isContraction(record.original);
            const wordFilterMatch = tokens.length === 1 && WORD_FILTER.has(record.original);
            const allWordsMatch = All_Words.has(record.original);
            let filterReason = null;
            if (contractionMatch) {
                filterReason = "CONTRACTION";
            } else if (wordFilterMatch) {
                filterReason = "WORD_FILTER";
            } else if (allWordsMatch) {
                filterReason = "All_Words";
            }
            return {
                ...record,
                filterDecision: filterReason === null ? "keep" : "filter",
                filterReason
            };
        });
    }
    function meaningfulTokens(phrase, knownTokens) {
        const tokenized = tokenizePhrase(phrase);
        if (!tokenized.length) return [];
        const normalized = normalizeTokens(tokenized, knownTokens);
        const filtered = filterTokens(normalized);
        const kept = filtered.filter((record) => record.filterDecision === "keep" && record.normalized);
        return kept.map((record) => record.normalized);
    }
    function mapOccurrenceToSourceSegments(occurrence, run) {
        const occurrenceStart = occurrence.startPos;
        const occurrenceEnd = occurrence.endPos;
        const sourceSegments = [];
        for (const segment of run.segments) {
            const overlapStart = Math.max(occurrenceStart, segment.start);
            const overlapEnd = Math.min(occurrenceEnd, segment.end);
            if (overlapStart >= overlapEnd) continue;
            const nodeStart = segment.nodeStart + (overlapStart - segment.start);
            const nodeEnd = segment.nodeStart + (overlapEnd - segment.start);
            sourceSegments.push({
                sourceNode: segment.node,
                startPos: nodeStart,
                endPos: nodeEnd,
                textSnapshot: segment.textSnapshot,
                text: segment.textSnapshot.slice(nodeStart, nodeEnd)
            });
        }
        return {
            ...occurrence,
            sourceNode: sourceSegments.length === 1 ? sourceSegments[0].sourceNode : null,
            sourceSegments
        };
    }
    function extractRunOccurrences(run) {
        const runOccurrences = extractOccurrences(run.text, null);
        return runOccurrences.map((occurrence) => ({
            ...mapOccurrenceToSourceSegments(occurrence, run),
            sourceNodes: run.segments.map((segment) => segment.node)
        }));
    }
    function normalizeNameIdentity(phrase) {
        return String(phrase || "")
            .toLowerCase()
            .replace(/[\s-]+/g, "");
    }
    function processCandidates(occurrences) {
        const knownTokens = buildKnownTokens(occurrences);
        const phraseMap = new Map();
        for (const occ of occurrences) {
            const phrase = String(occ.phrase || "").trim();
            if (!phrase) continue;
            const tokens = meaningfulTokens(phrase, knownTokens);
            if (!tokens.length) continue;
            const displayPhrase = tokens.join(" ");
            const identityKey = normalizeNameIdentity(displayPhrase);
            if (!phraseMap.has(identityKey)) {
                phraseMap.set(identityKey, {
                    identity: identityKey,
                    identityKey,
                    phrase: displayPhrase,
                    normalizedTokens: tokens,
                    distinctTokens: new Set(tokens),
                    sourceOccurrences: [],
                    occurrences: 0,
                    firstPos: occ.position ?? occ.startPos ?? 0
                });
            }
            const candidate = phraseMap.get(identityKey);
            candidate.sourceOccurrences.push(occ);
            candidate.occurrences++;
            candidate.firstPos = Math.min(candidate.firstPos, occ.position ?? occ.startPos ?? 0);
            if (
                displayPhrase.includes("-") &&
                (!candidate.phrase.includes("-") || displayPhrase.localeCompare(candidate.phrase) < 0)
            ) {
                candidate.phrase = displayPhrase;
                candidate.normalizedTokens = tokens;
            }
        }
        const candidates = [...phraseMap.values()];
        return sortAndFilterCandidates(calculateCandidateCounts(candidates));
    }
    function calculateCandidateCounts(candidates) {
        for (const cand of candidates) {
            const phraseCount = cand.sourceOccurrences.length;
            cand.occurrences = phraseCount;
            cand.phraseCount = phraseCount;
            cand.maxTokenCount = phraseCount;
            cand.sortedTokenCounts = [phraseCount];
            cand.tokenCountsStr = String(phraseCount);
        }
        return candidates;
    }
    function sortAndFilterCandidates(candidates) {
        candidates.sort((a, b) => b.phraseCount - a.phraseCount || a.firstPos - b.firstPos);
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
                    result.push(initials ? "(?:\\s*\\.\\s*| )" : " ");
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
                const alternative = `(?:${koreanTokens[0]} )?${koreanTokens[1]}`;
                return `${boundaryStart}${alternative}${boundaryEnd}`;
            }
            const prefix = koreanTokens.slice(0, n - 2).join(" ");
            const optionalPrefix = prefix ? `(?:${prefix} )?` : "";
            const optionalSecondToLast = `(?:${koreanTokens[n - 2]} )?`;
            const mainPattern = `${optionalPrefix}${optionalSecondToLast}${koreanTokens[n - 1]}`;
            const isCheolJung = /^(?:Cheol[- ]?jung)$/i.test(cleanToken(tokens[n - 1]));
            const alternatives = [mainPattern];
            if (isCheolJung && n === 4) {
                alternatives.push("Team Leader Kim");
            }
            return `${boundaryStart}(?:${alternatives.join("|")})${boundaryEnd}`;
        }
        if ((template === "Japanese" || template === "Japanese 2") && tokens.length === 2) {
            const first = tokenPattern(tokens[0]);
            const second = tokenPattern(tokens[1]);
            const alternatives = [`${first} ${second}`, `${second} ${first}`];
            if (template === "Japanese 2") {
                alternatives.push(first);
            }
            return `${boundaryStart}(?:${alternatives.join("|")})${boundaryEnd}`;
        }
        return `${boundaryStart}${joinTokens()}${boundaryEnd}`;
    }
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID} {
                width: fit-content;
                max-width: calc(100vw - 24px);
                height: min(850px, calc(100vh - 24px));
                max-height: calc(100vh - 24px);
                position: fixed;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                background: #1c1e22 !important;
                color: #e8eaf0 !important;
                border: 1px solid #45484e;
                border-radius: 6px;
                box-shadow: 0 5px 24px rgba(0, 0, 0, 0.5);
                font: 14px/1 Arial, sans-serif;
                color-scheme: dark;
                overflow: hidden;
                box-sizing: border-box;
            }
            #${PANEL_ID} .fr-candidate-editor {
                width: 180px;
                min-width: 80px;
                max-width: 300px;
                padding: 3px 5px;
                background: #101216;
                color: #fff;
                border: 1px solid #555;
                border-radius: 3px;
                font: inherit;
                font-size: 11px;
            }
            #${PANEL_ID} .fr-regex-preview-row {
                display: flex;
                align-items: center;
                gap: 5px;
                padding: 4px 8px;
                background: #1c1e22;
                border-bottom: 1px solid #45484e;
                flex-shrink: 0;
                min-width: 0;
            }
            #${PANEL_ID} #fr-regex-preview {
                flex: 1;
                min-width: 0;
                width: 100%;
                padding: 3px 5px;
                background: #101216;
                color: #ce9178;
                border: 1px solid #555;
                border-radius: 3px;
                font: 11px ui-monospace, monospace;
            }
            #${PANEL_ID}.fr-minimized .fr-regex-preview-row {
                 display: none;
            }
            #${PANEL_ID}.fr-minimized {
                width: max-content;
                height: auto;
                max-height: none;
            }
            #${PANEL_ID}.fr-minimized #fr-template,
            #${PANEL_ID}.fr-minimized #fr-scan,
            #${PANEL_ID}.fr-minimized #fr-empty,
            #${PANEL_ID}.fr-minimized #fr-tablewrap {
                display: none;
            }
            #${PANEL_ID} * {
                box-sizing: border-box;
            }
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
            #${PANEL_ID} button,
            #${PANEL_ID} select {
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
            #${PANEL_ID} button:hover {
                background: #363940;
            }
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
            #${PANEL_ID} tbody tr {
                height: 30px;
            }
            #${PANEL_ID} tbody td {
                height: 30px;
                padding: 3px 6px;
                box-sizing: border-box;
                vertical-align: middle;
                white-space: nowrap;
            }
            #${PANEL_ID} tbody td.fr-rule-text {
                width: fit-content;
                max-width: 300px;
                white-space: normal;
                overflow-wrap: anywhere;
                text-overflow: clip;
                height: auto;
                vertical-align: top;
            }
            #${PANEL_ID} tbody td button {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                height: 22px;
                min-height: 22px;
                padding: 2px 6px;
                line-height: 1;
                vertical-align: middle;
            }
            #${PANEL_ID} td input {
                display: block;
                field-sizing: content;
                min-width: 200px;
                max-width: 300px;
                background: #101216;
                color: #fff;
                border: 1px solid #555;
                border-radius: 3px;
                padding: 3px 5px;
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
        `;
        document.head.appendChild(style);
    }
    function updateRegexPreview() {
        const editor = document.getElementById("fr-candidate-editor");
        const preview = document.getElementById("fr-regex-preview");
        if (!editor || !preview) return;
        preview.value = editor.value.trim() ? generateRegex(editor.value.trim(), settings.template) : "";
    }
    let foxReplaceDatabase = loadFoxReplaceDatabase();
    let pageMatchedFoxReplaceRules = [];
    function loadFoxReplaceDatabase() {
        try {
            const saved = GM_getValue(FOXREPLACE_STORE_KEY, null);
            return saved && Array.isArray(saved.groups) ? saved : { groups: [] };
        } catch {
            return { groups: [] };
        }
    }
    function validateFoxReplaceJSON(data) {
        if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data.groups)) {
            throw new Error("Invalid FoxReplace JSON: groups array is missing.");
        }
        data.groups.forEach((group, gi) => {
            if (!group || typeof group !== "object" || Array.isArray(group) || !Array.isArray(group.substitutions)) {
                throw new Error(`Invalid FoxReplace group ${gi + 1}: substitutions array is missing.`);
            }
            if (group.enabled !== undefined && typeof group.enabled !== "boolean") {
                throw new Error(`Invalid enabled setting in group ${gi + 1}.`);
            }
            if (group.name !== undefined && typeof group.name !== "string") {
                throw new Error(`Invalid name in group ${gi + 1}.`);
            }
            if (group.title !== undefined && typeof group.title !== "string") {
                throw new Error(`Invalid title in group ${gi + 1}.`);
            }
            if (
                group.urls !== undefined &&
                (!Array.isArray(group.urls) || !group.urls.every((url) => typeof url === "string"))
            ) {
                throw new Error(`Invalid URL patterns in group ${gi + 1}.`);
            }
            group.substitutions.forEach((rule, ri) => {
                if (
                    !rule ||
                    typeof rule !== "object" ||
                    Array.isArray(rule) ||
                    typeof rule.input !== "string" ||
                    !rule.input.length ||
                    typeof rule.output !== "string"
                ) {
                    throw new Error(`Invalid FoxReplace rule ${gi + 1}.${ri + 1}.`);
                }
                if (rule.enabled !== undefined && typeof rule.enabled !== "boolean") {
                    throw new Error(`Invalid enabled setting in rule ${gi + 1}.${ri + 1}.`);
                }
                if (rule.inputType !== undefined && !["text", "wholewords", "regexp"].includes(rule.inputType)) {
                    throw new Error(`Invalid input type in rule ${gi + 1}.${ri + 1}.`);
                }
                if (rule.caseSensitive !== undefined && typeof rule.caseSensitive !== "boolean") {
                    throw new Error(`Invalid case setting in rule ${gi + 1}.${ri + 1}.`);
                }
                if (rule.inputType === "regexp") {
                    try {
                        new RegExp(rule.input, rule.caseSensitive === true ? "g" : "gi");
                    } catch (error) {
                        throw new Error(`Invalid regular expression in rule ${gi + 1}.${ri + 1}: ${error.message}`);
                    }
                }
            });
        });
        return data;
    }
    let foxReplaceFilePicker = null;
    function importFoxReplaceJSON() {
        if (!foxReplaceFilePicker) {
            foxReplaceFilePicker = document.createElement("input");
            foxReplaceFilePicker.type = "file";
            foxReplaceFilePicker.accept = ".json,application/json";
            foxReplaceFilePicker.style.cssText = "position:fixed;left:-10000px;top:0;width:1px;height:1px;opacity:0;";
            foxReplaceFilePicker.addEventListener("change", async () => {
                const file = foxReplaceFilePicker.files?.[0];
                if (!file) return;
                try {
                    const parsed = validateFoxReplaceJSON(JSON.parse(await file.text()));
                    if (typeof GM_setValue !== "function") {
                        throw new Error(
                            "Userscript storage is unavailable. Check that GM_setValue permission is enabled."
                        );
                    }
                    await Promise.resolve(GM_setValue(FOXREPLACE_STORE_KEY, parsed));
                    foxReplaceDatabase = parsed;
                    pageMatchedFoxReplaceRules = getPageMatchedFoxReplaceRules();
                    renderRows();
                    alert(`FoxReplace imported: ${parsed.groups.length} groups.`);
                } catch (error) {
                    alert(`FoxReplace import failed: ${error.message}`);
                    console.error("[WNC] FoxReplace import failed:", error);
                } finally {
                    foxReplaceFilePicker.value = "";
                }
            });
            document.body.appendChild(foxReplaceFilePicker);
        }
        foxReplaceFilePicker.value = "";
        foxReplaceFilePicker.click();
    }
    function foxReplaceURLMatches(pattern, url) {
        const value = String(pattern || "").trim();
        if (!value) return true;
        if (value.startsWith("/")) {
            const lastSlash = value.lastIndexOf("/");
            if (lastSlash > 0) {
                try {
                    return new RegExp(value.slice(1, lastSlash), value.slice(lastSlash + 1)).test(url);
                } catch {
                    return false;
                }
            }
        }
        if (value.includes("*")) {
            const escaped = value
                .split("*")
                .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join(".*");
            try {
                return new RegExp(escaped, "i").test(url);
            } catch {
                return false;
            }
        }
        return url.toLowerCase().includes(value.toLowerCase());
    }
    function compileFoxReplaceRule(rule) {
        const input = rule.input;
        const sensitive = rule.caseSensitive === true;
        if (rule.inputType === "regexp") return new RegExp(input, sensitive ? "g" : "gi");
        const escaped = input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (rule.inputType === "wholewords")
            return new RegExp(
                `(?<![\\p{L}\\p{N}\\p{M}_])(?:${escaped})(?![\\p{L}\\p{N}\\p{M}_])`,
                sensitive ? "gu" : "giu"
            );
        return new RegExp(escaped, sensitive ? "gu" : "giu");
    }
    function getPageMatchedFoxReplaceRules() {
        const pageText = extractVisibleText(document.body).text;
        const rules = [];
        (foxReplaceDatabase.groups || []).forEach((group, groupIndex) => {
            if (!group || group.enabled === false) return;
            const urls = Array.isArray(group.urls) ? group.urls : [];
            if (urls.length && !urls.some((pattern) => foxReplaceURLMatches(pattern, location.href))) return;
            (group.substitutions || []).forEach((rule, ruleIndex) => {
                if (!rule || rule.enabled === false || typeof rule.input !== "string" || !rule.input) return;
                try {
                    const regex = compileFoxReplaceRule({
                        inputType: rule.inputType || "text",
                        input: rule.input,
                        caseSensitive: rule.caseSensitive
                    });
                    regex.lastIndex = 0;
                    const inputMatches = regex.test(pageText);
                    const output = String(rule.output || "");
                    const outputMatches = output
                        ? rule.caseSensitive === true
                            ? pageText.includes(output)
                            : pageText.toLocaleLowerCase().includes(output.toLocaleLowerCase())
                        : false;
                    if (inputMatches || outputMatches)
                        rules.push({
                            group,
                            rule,
                            groupName: group.name || group.title || `Group ${groupIndex + 1}`,
                            groupIndex,
                            ruleIndex
                        });
                } catch (error) {
                    console.warn("[WNC] Invalid FoxReplace rule:", groupIndex, ruleIndex, error);
                }
            });
        });
        return rules;
    }
    function candidateMatchesFoxReplaceValue(candidate, rule, value) {
        const text = String(value || "");
        if (!text) return false;
        const phrase = String(candidate.phrase || "");
        const sensitive = rule.caseSensitive === true;
        if (rule.inputType === "regexp" && value === rule.input) {
            try {
                return new RegExp(text, sensitive ? "u" : "iu").test(phrase);
            } catch {
                return false;
            }
        }
        return sensitive ? phrase === text : phrase.toLocaleLowerCase() === text.toLocaleLowerCase();
    }
    function getCandidateFoxReplaceMatches(candidate) {
        return pageMatchedFoxReplaceRules.filter(
            ({ rule }) =>
                candidateMatchesFoxReplaceValue(candidate, rule, rule.input) ||
                candidateMatchesFoxReplaceValue(candidate, rule, rule.output)
        );
    }
    function renderRows() {
        const tbody = document.getElementById("fr-rows");
        if (!tbody) return;
        let candidates = [...currentCandidates];
        if (candidateFilterMode === "count-2-plus") {
            candidates = candidates.filter((cand) => cand.phraseCount >= 2);
        }
        candidates.sort((a, b) => {
            switch (candidateSortMode) {
                case "count-asc":
                    return a.phraseCount - b.phraseCount;
                case "name-asc":
                    return (settings.edits[a.identityKey] ?? a.phrase).localeCompare(
                        settings.edits[b.identityKey] ?? b.phrase
                    );
                case "count-desc":
                default:
                    return b.phraseCount - a.phraseCount || a.firstPos - b.firstPos;
            }
        });
        tbody.innerHTML = "";
        if (!candidates.length) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:#888;padding:15px;">No candidates found.</td></tr>`;
            return;
        }
        const columns = ["group", "input", "replace", "type", "case"];
        const addCell = (row, value, title = "", className = "") => {
            const td = document.createElement("td");
            td.textContent = value == null || value === "" ? "—" : String(value);
            if (title) td.title = title;
            if (className) td.className = className;
            row.appendChild(td);
        };
        for (const cand of candidates) {
            const name = settings.edits[cand.identityKey] ?? cand.phrase;
            const matches = getCandidateFoxReplaceMatches(cand);
            const ruleRows = matches.length ? matches : [null];
            ruleRows.forEach((match, ruleRowIndex) => {
                const tr = document.createElement("tr");
                if (ruleRowIndex === 0) {
                    addCell(tr, String(cand.firstPos + 1));
                    addCell(tr, String(cand.phraseCount));
                    const nameCell = document.createElement("td");
                    const nameButton = document.createElement("button");
                    nameButton.type = "button";
                    nameButton.textContent = name;
                    nameButton.title = "Load candidate into regex editor and copy name";
                    nameButton.style.cssText =
                        "border:0;background:transparent;color:#8ab4f8;padding:2px 0;text-align:left;max-width:300px;width:100%;white-space:normal;overflow-wrap:anywhere;";
                    nameButton.addEventListener("click", async (event) => {
                        event.stopPropagation();
                        const editor = document.getElementById("fr-candidate-editor");
                        if (editor) {
                            editor.value = name;
                            updateRegexPreview();
                        }
                        try {
                            if (navigator.clipboard?.writeText) {
                                await navigator.clipboard.writeText(name);
                                return;
                            }
                        } catch {}
                        const area = document.createElement("textarea");
                        area.value = name;
                        area.style.position = "fixed";
                        area.style.opacity = "0";
                        document.body.appendChild(area);
                        try {
                            area.select();
                            if (!document.execCommand("copy")) {
                                console.warn("[WNC] Candidate copy failed.");
                            }
                        } catch (error) {
                            console.warn("[WNC] Candidate copy failed:", error);
                        } finally {
                            area.remove();
                        }
                    });
                    nameCell.appendChild(nameButton);
                    tr.appendChild(nameCell);
                } else {
                    addCell(tr, "");
                    addCell(tr, "");
                    addCell(tr, "↳");
                }
                if (match) {
                    const rule = match.rule;
                    const type = rule.inputType === "regexp" ? "Rx" : rule.inputType === "wholewords" ? "Ww" : "Tx";
                    addCell(tr, match.groupName, match.groupName, "fr-rule-text");
                    addCell(tr, rule.input, rule.input, "fr-rule-text");
                    addCell(tr, rule.output, rule.output, "fr-rule-text");
                    addCell(tr, type);
                    addCell(tr, rule.caseSensitive ? "Y" : "N");
                } else {
                    columns.forEach(() => addCell(tr, ""));
                }
                tbody.appendChild(tr);
            });
        }
    }
    function renderAccumulatedScan() {
        currentCandidates = processCandidates(accumulatedOccurrences);
        pageMatchedFoxReplaceRules = getPageMatchedFoxReplaceRules();
        renderRows();
    }
    function runScan() {
        if (isScanning) return;
        isScanning = true;
        try {
            const extracted = extractVisibleText(document.body);
            const runs = extracted.segments;
            const newOccurrences = [];
            let position = 0;
            for (const run of runs) {
                const runNodes = run.segments.map((segment) => segment.node);
                const occurrences = extractRunOccurrences(run);
                for (const occurrence of occurrences) {
                    occurrence.sourceNodes = runNodes;
                    occurrence.position = position++;
                    newOccurrences.push(occurrence);
                }
            }
            accumulatedOccurrences = newOccurrences;
            renderAccumulatedScan();
            startScanObserver();
        } finally {
            isScanning = false;
        }
    }
    function startScanObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (observerFlushTimer !== null) {
            clearTimeout(observerFlushTimer);
            observerFlushTimer = null;
        }
        // A full debounced rescan is safer than trying to reconcile partial
        // runs: removals and visibility/class changes can otherwise leave
        // stale candidates behind when no replacement text run remains.
        observer = new MutationObserver((mutations) => {
            if (!mutations.length) return;
            const relevantMutations = mutations.filter((mutation) => {
                const target = mutation.target;
                const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
                return !element?.closest(`#${PANEL_ID}`);
            });
            if (!relevantMutations.length || observerFlushTimer !== null) {
                return;
            }
            observerFlushTimer = setTimeout(() => {
                observerFlushTimer = null;
                if (!document.getElementById(PANEL_ID) || isScanning) return;
                runScan();
            }, 100);
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true,
            attributes: true,
            attributeFilter: ["hidden", "aria-hidden", "style", "class", "inert"]
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
                <input
                    id="fr-candidate-editor"
                    class="fr-candidate-editor"
                    type="text"
                    placeholder="Select a candidate..."
                    title="Edit candidate name for regex generation"
                />
                <label style="display:flex; align-items:center; gap:4px; margin-left: auto;" title="Template">
                    <span style="font-size:11px;">Tm</span>
                    <select id="fr-template" title="Template">
                        ${TEMPLATES.map(
                            (t) =>
                                `<option value="${t}" ${t === settings.template ? "selected" : ""}>${{ Other: "Ot", Korean: "Kr", Japanese: "Jp", "Japanese 2": "J2" }[t] || t.slice(0, 2)}</option>`
                        ).join("")}
                    </select>
                </label>
                <button id="fr-scan" title="Scan the page">🔍</button>
                <button id="fr-sort-filter" title="Sort and filters">So</button>
                <button id="fr-empty" title="Clear accumulated scan data">🗑</button>
                <button id="fr-minimize" title="Minimize panel">−</button>
                <button id="fr-close" title="Close Panel">×</button>
            </div>
            <div class="fr-regex-preview-row">
                <input
                    id="fr-regex-preview"
                    type="text"
                    readonly
                    placeholder="Generated regex preview"
                    title="Generated regular expression"
                />
                <button id="fr-regex-preview-copy" title="Copy generated regular expression">📋</button>
            </div>
            <div class="fr-tablewrap" id="fr-tablewrap">
                <table id="fr-table">
                   <thead>
    <tr>
        <th>P</th>
        <th>Ct</th>
        <th>Name</th>
        <th>Gr</th>
        <th>In</th>
        <th>Re</th>
        <th>Ty</th>
        <th>Cs</th>
    </tr>
</thead>
                    <tbody id="fr-rows"></tbody>
                </table>
            </div>
        `;
        document.body.appendChild(panel);
        const minimizeButton = panel.querySelector("#fr-minimize");
        minimizeButton.addEventListener("click", () => {
            const minimized = panel.classList.toggle("fr-minimized");
            minimizeButton.textContent = minimized ? "▢" : "—";
            minimizeButton.title = minimized ? "Restore panel" : "Minimize panel";
        });
        panel.querySelector("#fr-scan").addEventListener("click", runScan);
        panel.querySelector("#fr-sort-filter").addEventListener("click", () => {
            const existingMenu = document.getElementById("fr-sort-filter-menu");
            if (existingMenu) {
                existingMenu.remove();
                return;
            }
            const menu = document.createElement("div");
            menu.id = "fr-sort-filter-menu";
            menu.style.cssText = `
        position: absolute;
        top: 36px;
        right: 8px;
        z-index: 10;
        display: flex;
        flex-direction: column;
        gap: 6px;
        padding: 10px;
        background: #292c32;
        border: 1px solid #555;
        border-radius: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,.4);
    `;
            menu.innerHTML = `
        <strong style="font-size:12px;">Sort</strong>
        <button type="button" data-action="count-desc">Count: High to Low</button>
        <button type="button" data-action="count-asc">Count: Low to High</button>
        <button type="button" data-action="name-asc">Name: A to Z</button>
        <hr style="width:100%;border:0;border-top:1px solid #555;">
        <strong style="font-size:12px;">Filters</strong>
        <button type="button" data-action="count-2-plus">Count: 2+</button>
        <button type="button" data-action="show-all">Show All Candidates</button>
        <button type="button" data-action="reset">Reset Sort/Filter</button>
    `;
            panel.appendChild(menu);
            menu.addEventListener("click", (e) => {
                const button = e.target.closest("button[data-action]");
                if (!button) return;
                switch (button.dataset.action) {
                    case "count-desc":
                        candidateSortMode = "count-desc";
                        break;
                    case "count-asc":
                        candidateSortMode = "count-asc";
                        break;
                    case "name-asc":
                        candidateSortMode = "name-asc";
                        break;
                    case "count-2-plus":
                        candidateFilterMode = "count-2-plus";
                        break;
                    case "show-all":
                        candidateFilterMode = "all";
                        break;
                    case "reset":
                        candidateSortMode = "count-desc";
                        candidateFilterMode = "all";
                        break;
                }
                menu.remove();
                renderRows();
            });
        });
        panel.querySelector("#fr-empty").addEventListener("click", () => {
            accumulatedOccurrences = [];
            currentCandidates = [];
            renderRows();
        });
        panel.querySelector("#fr-template").addEventListener("change", (e) => {
            settings.template = e.target.value;
            saveSettings();
            renderRows();
            updateRegexPreview();
        });
        panel.querySelector("#fr-candidate-editor").addEventListener("input", updateRegexPreview);
        panel.querySelector("#fr-regex-preview-copy").addEventListener("click", async () => {
            const preview = panel.querySelector("#fr-regex-preview");
            if (!preview.value) return;
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(preview.value);
                    return;
                }
            } catch {}
            preview.focus();
            preview.select();
            try {
                if (!document.execCommand("copy")) {
                    console.warn("[WNC] Regex copy failed.");
                }
            } finally {
                preview.setSelectionRange(0, 0);
            }
        });
        panel.querySelector("#fr-close").addEventListener("click", () => {
            saveSettings();
            if (observer) {
                observer.disconnect();
                observer = null;
            }
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
        GM_registerMenuCommand("WNC → Import FoxReplace JSON", importFoxReplaceJSON);
    }
})();
