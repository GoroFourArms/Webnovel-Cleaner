// ==UserScript==
// @name         Capital Phrase Scanner
// @namespace    CPS
// @version      1.0
// @description  Scan and count capitalized phrases and generate regex templates.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/refs/heads/main/CPS
// @downloadURL  https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/refs/heads/main/CPS
// @run-at       document-idle
// ==/UserScript==
(function () {
    "use strict";
    const STORE_KEY = "frScanner.settings";
    const PAGE_SCANS_KEY = "frScanner.pageScans.v1";
    function fingerprintText(text) {
        // Deterministic 32-bit FNV-1a hash.
        let hash = 0x811c9dc5;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 0x01000193);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }
    function loadPageScans() {
        try {
            const saved = GM_getValue(PAGE_SCANS_KEY, {});
            return saved && typeof saved === "object" ? saved : {};
        } catch (error) {
            console.error("[FRScanner] Failed to load page scans:", error);
            return {};
        }
    }
    function savePageScans(pageScans) {
        try {
            GM_setValue(PAGE_SCANS_KEY, pageScans);
        } catch (error) {
            console.error("[FRScanner] Failed to save page scans:", error);
        }
    }
    function serializeOccurrences(occurrences) {
        return occurrences.map((occurrence) => ({
            phrase: occurrence.phrase,
            startPos: occurrence.startPos,
            endPos: occurrence.endPos,
            position: occurrence.position,
            accepted: occurrence.accepted,
            rejectionReason: occurrence.rejectionReason,
            textSnapshot: occurrence.textSnapshot
        }));
    }
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
    let settings = loadSettings();
    let highlightedElements = [];
    let highlightedNodeRecords = [];
    let currentCandidates = [];
    let highlightedCandidates = new Set();
    let accumulatedOccurrences = [];
    let nextOccurrencePos = 0;
    let observer = null;
    let isScanning = false;
    let processedNodeText = new Map();
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
            return {
                ...defaults,
                ...saved,
                highlightedAll: false,
                edits: { ...(saved.edits || {}) }
            };
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
        if (!root) return { text: "", segments: [] };
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
        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                appendTextNode(node);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            if (isExcluded(node) || node.matches(NON_CHAPTER_SELECTOR) || node.closest("#" + PANEL_ID)) {
                console.debug("[FRScanner] Excluded element:", {
                    tag: node.tagName,
                    className: typeof node.className === "string" ? node.className : "",
                    id: node.id,
                    text: (node.innerText || node.textContent || "").trim().slice(0, 200),
                    excluded: isExcluded(node),
                    matchesNonChapter: node.matches(NON_CHAPTER_SELECTOR),
                    selector: NON_CHAPTER_SELECTOR
                });
                finishRun();
                return;
            }
            if (node.tagName === "BR") {
                finishRun();
                return;
            }
            const isBlock = BLOCK_TAGS.has(node.tagName);
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
            appendTextNode(root);
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
        // Preserve plural possessive endings until plural normalization.
        if (/s'$/i.test(token)) {
            token = token.slice(0, -1);
        }
        // Remove possessive endings.
        token = token.replace(/'s$/i, "").replace(/'$/, "");
        // Normalize regular plurals only when the singular is known.
        if (token.length > 2) {
            // foxes -> fox; churches -> church; boxes -> box
            if (/(?:ches|shes|xes|zes|sses)$/i.test(token)) {
                const singular = token.slice(0, -2);
                if (knownTokens.has(singular.toLowerCase())) {
                    token = singular;
                }
            }
            // ladies -> lady; stories -> story
            else if (/ies$/i.test(token)) {
                const singular = token.slice(0, -3) + "y";
                if (knownTokens.has(singular.toLowerCase())) {
                    token = singular;
                }
            }
            // boys -> boy; dogs -> dog
            else if (/s$/i.test(token) && !/ss$/i.test(token)) {
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
                // Remove singular possessive endings, but preserve the s
                // in plural possessives such as "dogs'".
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
        // Common contractions that must be removed as whole tokens.
        if (/^[a-z]+(?:n't|'m|'re|'ve|'ll|'d)$/i.test(token)) {
            return true;
        }
        // Common contractions ending in 's.
        // Do not classify every word ending in 's as a contraction,
        // because names such as "Fred's" must survive possessive normalization.
        if (
            /^(?:he|she|it|that|there|here|what|who|where|when|why|how|let|everyone|everybody|someone|somebody|anyone|anybody|no one|one|whoever|whatever|whichever|nobody|nothing|something|anything|everything)'s$/i.test(
                token
            )
        ) {
            return true;
        }
        // Other common fixed contractions.
        return /^(?:y'all|let's|ma'am|o'clock)$/i.test(token);
    }
    function filterTokens(tokens) {
        return tokens.map((record) => {
            const token = record.normalized;
            // Check the original spelling so normalization does not hide
            // contractions such as "he's" by turning them into "he".
            const contractionMatch = isContraction(record.original);
            // Preserve existing filter behavior.
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
    function getOccurrenceSourceSegments(occurrence) {
        if (Array.isArray(occurrence.sourceSegments)) {
            return occurrence.sourceSegments;
        }
        if (occurrence.sourceNode) {
            return [
                {
                    sourceNode: occurrence.sourceNode,
                    startPos: occurrence.startPos,
                    endPos: occurrence.endPos,
                    textSnapshot: occurrence.textSnapshot,
                    text: occurrence.phrase
                }
            ];
        }
        return [];
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
                    firstPos: occ.startPos ?? occ.position ?? 0
                });
            }
            const candidate = phraseMap.get(identityKey);
            candidate.sourceOccurrences.push(occ);
            candidate.occurrences++;
            candidate.firstPos = Math.min(candidate.firstPos, occ.startPos ?? occ.position ?? 0);
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
            // Keep the existing sorting/filtering interface,
            // but make its score the phrase count.
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
            const alternativePrefix = koreanTokens.slice(0, n - 3).join(" ");
            const optionalAlternativePrefix = alternativePrefix ? `(?:${alternativePrefix} )?` : "";
            const alternative = `${optionalAlternativePrefix}${koreanTokens[n - 3]} ${koreanTokens[n - 2]}`;
            return `${boundaryStart}(?:${mainPattern}|${alternative})${boundaryEnd}`;
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
            for (const record of highlightedNodeRecords) {
                const { originalNode, replacementNodes, parent } = record;
                if (!parent || !replacementNodes.length) continue;
                if (!replacementNodes.every((node) => node.parentNode === parent)) continue;
                parent.replaceChild(originalNode, replacementNodes[0]);
                for (const node of replacementNodes.slice(1)) {
                    node.remove();
                }
            }
            highlightedNodeRecords = [];
            highlightedElements = [];
        });
    }
    function applyHighlights() {
        const traceHighlights = true;
        const trace = (...args) => {
            if (traceHighlights) console.debug("[FRScanner Highlight]", ...args);
        };
        clearHighlights();
        if (highlightedCandidates.size === 0 || currentCandidates.length === 0) {
            return;
        }
        const root = document.body;
        if (!root) return;
        const selectedCandidates = currentCandidates.filter((cand) => highlightedCandidates.has(cand.identityKey));
        trace(
            "Candidates selected for highlighting",
            selectedCandidates.map((cand) => ({
                phrase: cand.phrase,
                identityKey: cand.identityKey,
                sourceOccurrenceCount: (cand.sourceOccurrences || []).length
            }))
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
        // Match candidates against combined text runs so names can span
        // adjacent inline elements.
        const individualMatchesByNode = new Map();
        const runs = extractVisibleText(root).segments;
        for (const cand of selectedCandidates) {
            const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
            const regexStr = generateRegex(displayName, settings.template);
            console.debug("[FRScanner Regex Debug]", {
                phrase: cand.phrase,
                identityKey: cand.identityKey,
                displayName,
                regexStr,
                template: settings.template
            });
            if (!regexStr) continue;
            let regex;
            try {
                regex = new RegExp(regexStr, "g");
            } catch (error) {
                console.warn("[FRScanner Highlight] Invalid candidate regex", {
                    phrase: cand.phrase,
                    displayName,
                    regexStr,
                    error
                });
                continue;
            }
            for (const run of runs) {
                regex.lastIndex = 0;
                let match;
                while ((match = regex.exec(run.text)) !== null) {
                    if (!match[0]) {
                        regex.lastIndex++;
                        continue;
                    }
                    if (!individualMatchesByNode.has(run)) {
                        individualMatchesByNode.set(run, []);
                    }
                    individualMatchesByNode.get(run).push({
                        start: match.index,
                        end: match.index + match[0].length,
                        text: match[0],
                        displayName,
                        identityKey: cand.identityKey
                    });
                }
            }
        }
        // Resolve overlaps across complete matches BEFORE mapping them to nodes.
        for (const run of runs) {
            const matches = individualMatchesByNode.get(run);
            if (!matches?.length) continue;
            const seen = new Set();
            const uniqueMatches = matches.filter((match) => {
                const key = `${match.start}:${match.end}:${match.text}`;
                if (seen.has(key)) return false;
                seen.add(key);
                return true;
            });
            uniqueMatches.sort(
                (a, b) => a.start - b.start || b.end - a.end || a.displayName.localeCompare(b.displayName)
            );
            const accepted = [];
            let lastEnd = 0;
            for (const match of uniqueMatches) {
                if (match.start < lastEnd) {
                    trace("Match skipped: overlaps an earlier complete match", {
                        skippedMatch: match,
                        previousMatchEnd: lastEnd,
                        sourceText: run.text
                    });
                    continue;
                }
                accepted.push(match);
                lastEnd = match.end;
            }
            const nodeMatches = new Map();
            for (const match of accepted) {
                const mapped = mapOccurrenceToSourceSegments(
                    {
                        phrase: match.text,
                        startPos: match.start,
                        endPos: match.end,
                        textSnapshot: run.text
                    },
                    run
                );
                for (const segment of mapped.sourceSegments) {
                    if (!nodeMatches.has(segment.sourceNode)) {
                        nodeMatches.set(segment.sourceNode, []);
                    }
                    nodeMatches.get(segment.sourceNode).push({
                        start: segment.startPos,
                        end: segment.endPos,
                        text: segment.text,
                        displayName: match.displayName,
                        identityKey: match.identityKey,
                        completeMatchText: match.text
                    });
                }
            }
            individualMatchesByNode.set(run, nodeMatches);
        }
        withScanObserverPaused(() => {
            for (const node of textNodes) {
                const originalText = node.nodeValue;
                const nodeMatches = [];
                for (const run of runs) {
                    const matchesForRun = individualMatchesByNode.get(run);
                    const matchesForNode = matchesForRun?.get(node);
                    if (matchesForNode) nodeMatches.push(...matchesForNode);
                }
                if (nodeMatches.length === 0) continue;
                // Reject invalid source ranges before attempting overlap resolution.
                const validMatches = nodeMatches.filter((match) => {
                    const valid =
                        Number.isInteger(match.start) &&
                        Number.isInteger(match.end) &&
                        match.start >= 0 &&
                        match.end > match.start &&
                        match.end <= originalText.length &&
                        originalText.slice(match.start, match.end) === match.text;
                    if (!valid) {
                        trace("Match skipped: invalid source range", {
                            match,
                            sourceText: originalText
                        });
                    }
                    return valid;
                });
                // Complete matches have already been deduplicated and overlap-resolved
                // before being mapped to individual text nodes.
                const nonOverlapping = validMatches;
                if (nonOverlapping.length === 0) continue;
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                for (const match of nonOverlapping) {
                    if (match.start > lastIndex) {
                        fragment.appendChild(document.createTextNode(originalText.slice(lastIndex, match.start)));
                    }
                    const span = document.createElement("span");
                    const comparedText = match.completeMatchText ?? match.text;
                    span.className =
                        comparedText !== match.displayName &&
                        comparedText.toLowerCase() === match.displayName.toLowerCase()
                            ? "fr-highlight-mark fr-highlight-case-mismatch"
                            : "fr-highlight-mark";
                    span.textContent = match.text;
                    fragment.appendChild(span);
                    highlightedElements.push(span);
                    trace("Highlight applied", {
                        text: match.text,
                        displayName: match.displayName,
                        identityKey: match.identityKey,
                        start: match.start,
                        end: match.end,
                        className: span.className,
                        sourceText: originalText
                    });
                    lastIndex = match.end;
                }
                if (lastIndex < originalText.length) {
                    fragment.appendChild(document.createTextNode(originalText.slice(lastIndex)));
                }
                if (node.parentNode) {
                    const parent = node.parentNode;
                    const replacementNodes = Array.from(fragment.childNodes);
                    highlightedNodeRecords.push({
                        originalNode: node,
                        replacementNodes,
                        parent
                    });
                    parent.replaceChild(fragment, node);
                }
            }
            trace("Highlighting pass complete", {
                examinedTextNodes: textNodes.length,
                highlightedElements: highlightedElements.length
            });
        });
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
            #${PANEL_ID}.fr-minimized #fr-highlight,
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
    function occurrenceUsesAnyNode(occurrence, nodes) {
        if (nodes.has(occurrence.sourceNode)) return true;
        if (Array.isArray(occurrence.sourceNodes) && occurrence.sourceNodes.some((node) => nodes.has(node))) {
            return true;
        }
        return getOccurrenceSourceSegments(occurrence).some((segment) => nodes.has(segment.sourceNode));
    }
    function reconcileOccurrencesForNodes(nodes) {
        if (!nodes || nodes.size === 0) return;
        accumulatedOccurrences = accumulatedOccurrences.filter(
            (occurrence) => !occurrenceUsesAnyNode(occurrence, nodes)
        );
    }
    function updateRegexPreview() {
        const editor = document.getElementById("fr-candidate-editor");
        const preview = document.getElementById("fr-regex-preview");
        if (!editor || !preview) return;
        preview.value = editor.value.trim() ? generateRegex(editor.value.trim(), settings.template) : "";
    }
    function renderRows() {
        const tbody = document.getElementById("fr-rows");
        if (!tbody) return;
        const candidates = [...currentCandidates];
        tbody.innerHTML = "";
        if (candidates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center;color:#888;padding:15px;">No candidates found.</td></tr>`;
            return;
        }
        candidates.forEach((cand) => {
            const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
            const tr = document.createElement("tr");
            tr.style.cursor = "pointer";
            tr.title = "Select candidate for regex preview";
            tr.addEventListener("click", (e) => {
                if (e.target.closest("input, button, select")) return;
                const editor = document.getElementById("fr-candidate-editor");
                if (!editor) return;
                editor.value = settings.edits[cand.identityKey] ?? cand.phrase;
                updateRegexPreview();
            });
            // Highlight column
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
                saveSettings();
                applyHighlights();
                renderRows();
            });
            tdHighlight.appendChild(btnHighlight);
            // Name column: plain text, not an editing box
            const tdName = document.createElement("td");
            tdName.textContent = displayName;
            tdName.title = displayName;
            // Count column
            const tdCounts = document.createElement("td");
            tdCounts.className = "fr-counts";
            tdCounts.textContent = String(cand.phraseCount);
            const tdAction = document.createElement("td");
            const btnLoad = document.createElement("button");
            btnLoad.textContent = "✎";
            btnLoad.title = "Load Name into Regex Editor";
            btnLoad.addEventListener("click", () => {
                const editor = document.getElementById("fr-candidate-editor");
                if (!editor) return;
                editor.value = settings.edits[cand.identityKey] ?? cand.phrase;
                updateRegexPreview();
            });
            tdAction.appendChild(btnLoad);
            tr.append(tdHighlight, tdName, tdCounts, tdAction);
            tbody.appendChild(tr);
        });
    }
    function renderAccumulatedScan() {
        currentCandidates = processCandidates(accumulatedOccurrences);
        renderRows();
        applyHighlights();
    }
    function runScan() {
        if (isScanning) return;
        isScanning = true;
        try {
            const runs = extractVisibleText(document.body).segments;
            const pageText = runs.map((run) => run.text).join("\n");
            const fingerprint = fingerprintText(pageText);
            const pageUrl = location.href;
            const pageScans = loadPageScans();
            const pageOccurrences = [];
            let position = 0;
            for (const run of runs) {
                for (const occurrence of extractRunOccurrences(run)) {
                    occurrence.position = position++;
                    pageOccurrences.push(occurrence);
                }
            }
            const snapshot = {
                fingerprint,
                occurrences: serializeOccurrences(pageOccurrences)
            };
            pageScans[pageUrl] = snapshot;
            savePageScans(pageScans);
            accumulatedOccurrences = [];
            nextOccurrencePos = 0;
            processedNodeText = new Map();
            for (const occurrence of snapshot.occurrences) {
                accumulatedOccurrences.push({
                    ...occurrence,
                    position: nextOccurrencePos++
                });
            }
            for (const run of runs) {
                for (const segment of run.segments) {
                    processedNodeText.set(segment.node, segment.textSnapshot);
                }
            }
            renderAccumulatedScan();
            startScanObserver();
        } finally {
            isScanning = false;
        }
    }
    function startScanObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            if (isScanning) return;
            const affectedNodes = new Set();
            let structureChanged = false;
            for (const mutation of mutations) {
                const target = mutation.target;
                const targetElement = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
                if (
                    targetElement?.closest(`#${PANEL_ID}`) ||
                    targetElement?.closest(".fr-highlight-mark") ||
                    (mutation.type === "childList" &&
                        [...mutation.addedNodes, ...mutation.removedNodes].some(
                            (node) =>
                                node.nodeType === Node.ELEMENT_NODE &&
                                (node.matches(".fr-highlight-mark") || node.closest(".fr-highlight-mark"))
                        ))
                ) {
                    continue;
                }
                if (mutation.type === "characterData") {
                    affectedNodes.add(target);
                } else if (mutation.type === "childList") {
                    affectedNodes.add(target);
                    structureChanged = true;
                    for (const node of [...mutation.addedNodes, ...mutation.removedNodes]) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            affectedNodes.add(node);
                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
                            let textNode;
                            while ((textNode = walker.nextNode())) {
                                affectedNodes.add(textNode);
                            }
                        }
                    }
                }
            }
            if (affectedNodes.size === 0) return;
            // Remove occurrences tied to removed nodes immediately. Map is iterable so
            // stale snapshots for detached text nodes can also be discarded.
            const liveTextNodes = new Set();
            const liveWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            let liveTextNode;
            while ((liveTextNode = liveWalker.nextNode())) liveTextNodes.add(liveTextNode);
            const removedNodes = new Set(
                [...affectedNodes].filter((node) => node.nodeType === Node.TEXT_NODE && !liveTextNodes.has(node))
            );
            if (removedNodes.size) {
                reconcileOccurrencesForNodes(removedNodes);
                for (const node of removedNodes) processedNodeText.delete(node);
            }
            const runs = extractVisibleText(document.body).segments;
            console.log("[FRScanner] Text runs:", runs.length);
            console.log(
                "[FRScanner] Text preview:",
                runs.map((run) => run.text.slice(0, 150))
            );
            const affectedRuns = runs.filter((run) =>
                run.segments.some((segment) => {
                    if (affectedNodes.has(segment.node) || affectedNodes.has(segment.node.parentElement)) {
                        return true;
                    }
                    for (const affectedNode of affectedNodes) {
                        if (
                            affectedNode.nodeType === Node.ELEMENT_NODE &&
                            (affectedNode.contains(segment.node) || segment.node.parentElement?.contains(affectedNode))
                        ) {
                            return true;
                        }
                    }
                    return false;
                })
            );
            let changed = false;
            for (const run of affectedRuns) {
                const isChanged = run.segments.some(
                    (segment) => processedNodeText.get(segment.node) !== segment.textSnapshot
                );
                // Structural changes can invalidate occurrences even when the
                // surviving text nodes have unchanged snapshots.
                if (!isChanged && !(structureChanged && removedNodes.size > 0)) {
                    continue;
                }
                reconcileOccurrencesForNodes(new Set(run.segments.map((segment) => segment.node)));
                const occurrences = extractRunOccurrences(run);
                for (const occurrence of occurrences) {
                    occurrence.sourceNodes = run.segments.map((segment) => segment.node);
                    occurrence.position = nextOccurrencePos++;
                    accumulatedOccurrences.push(occurrence);
                }
                for (const segment of run.segments) {
                    processedNodeText.set(segment.node, segment.textSnapshot);
                }
                changed = true;
            }
            if (changed) {
                renderAccumulatedScan();
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
                <input
                    id="fr-candidate-editor"
                    class="fr-candidate-editor"
                    type="text"
                    placeholder="Select a candidate..."
                    title="Edit candidate name for regex generation"
                />
                <label style="display:flex; align-items:center; gap:4px; margin-left: auto;">
                    <select id="fr-template">
                        ${TEMPLATES.map(
                            (t) => `<option value="${t}" ${t === settings.template ? "selected" : ""}>${t}</option>`
                        ).join("")}
                    </select>
                </label>
                <button id="fr-scan" title="Scan the page">🔍</button>
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
                            <th>Hi</th>
                            <th>Name</th>
                            <th>Ct</th>
                            <th>Ed</th>
                        </tr>
                    </thead>
                    <tbody id="fr-rows"></tbody>
                </table>
            </div>
        `;
        document.body.appendChild(panel);
        const minimizeButton = panel.querySelector("#fr-minimize");
        const tableWrap = panel.querySelector("#fr-tablewrap");
        minimizeButton.addEventListener("click", () => {
            const minimized = panel.classList.toggle("fr-minimized");
            minimizeButton.textContent = minimized ? "▢" : "—";
            minimizeButton.title = minimized ? "Restore panel" : "Minimize panel";
        });
        panel.querySelector("#fr-scan").addEventListener("click", runScan);
        panel.querySelector("#fr-empty").addEventListener("click", () => {
            clearHighlights();
            accumulatedOccurrences = [];
            nextOccurrencePos = 0;
            processedNodeText = new Map();
            highlightedCandidates.clear();
            const pageScans = loadPageScans();
            delete pageScans[location.href];
            savePageScans(pageScans);
            runScan();
        });
        panel.querySelector("#fr-template").addEventListener("change", (e) => {
            settings.template = e.target.value;
            saveSettings();
            renderRows();
            updateRegexPreview();
            applyHighlights();
        });
        panel.querySelector("#fr-candidate-editor").addEventListener("input", updateRegexPreview);
        panel.querySelector("#fr-regex-preview-copy").addEventListener("click", async () => {
            const preview = panel.querySelector("#fr-regex-preview");
            if (!preview.value) return;
            try {
                await navigator.clipboard.writeText(preview.value);
            } catch (error) {
                preview.focus();
                preview.select();
                document.execCommand("copy");
                preview.setSelectionRange(0, 0);
            }
        });
        panel.querySelector("#fr-close").addEventListener("click", () => {
            clearHighlights();
            highlightedCandidates.clear();
            settings.highlightedAll = false;
            saveSettings();
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
