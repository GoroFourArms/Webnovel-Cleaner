// ==UserScript==
// @name         FR Scanner Pro
// @namespace    fr-scanner
// @version      4.3.0
// @description  Full spec-compliant FR Scanner 2 with menu command opening, max token count sorting, 5% max token count hiding, and specialized Korean regex template logic.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
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
    const CHAPTER_CONTAINER_SELECTORS = [
        "#ac-r-body",
        "#chapter-content",
        "#chapterContent",
        "#chapter-body",
        "#chapterBody",
        "#content_read",
        "#read-content",
        "#reader-content",
        "#reading-content",
        "#book-content",
        "#novel-content",
        "#text-content",
        "#story-content",
        "#article-content",
        "#main-content",
        ".hentry",
        ".chapter-content",
        ".chapter__content",
        ".chapter-body",
        ".chapter-text",
        ".chapter-inner",
        ".reading-content",
        ".reader-content",
        ".read-content",
        ".text-content",
        ".story-content",
        ".book-content",
        ".novel-content",
        ".entry-content",
        ".article-content",
        ".post-content",
        ".prose",
        "article",
        "main"
    ];
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
    let activeChapterRoot = null;
    function loadSettings() {
        const defaults = {
            x: 20,
            y: 20,
            width: 900,
            height: 450,
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
    // --- Smart Chapter Extraction & Text Reconstruction ---
    function isExcluded(element) {
        if (!element || element.nodeType !== 1) return false;
        if (EXCLUDED_TAGS.has(element.tagName)) return true;
        if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
        return false;
    }
    function findDeepestChapterContainer(root = document) {
        const matches = new Map();
        for (const selector of CHAPTER_CONTAINER_SELECTORS) {
            try {
                root.querySelectorAll(selector).forEach((el) => {
                    if (
                        el.isConnected &&
                        !el.closest("#" + PANEL_ID) &&
                        !el.closest(NON_CHAPTER_SELECTOR) &&
                        !isExcluded(el) &&
                        el.getClientRects().length
                    ) {
                        if (!matches.has(el)) matches.set(el, selector);
                    }
                });
            } catch (_) {}
        }
        const deepest = [...matches.keys()].filter(
            (el) => ![...matches.keys()].some((other) => other !== el && el.contains(other))
        );
        if (!deepest.length) return null;
        const element = deepest
            .map((element) => ({
                element,
                length: (element.innerText || "").trim().length
            }))
            .sort((a, b) => b.length - a.length)[0].element;
        return {
            element,
            selector: matches.get(element)
        };
    }
    function extractVisibleText(root = null) {
        root = root || document.body || document.documentElement;
        if (!root) return "";
        const pieces = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const element = node.parentElement;
                if (!node.nodeValue?.trim() || !element) return NodeFilter.FILTER_REJECT;
                if (element.closest("#" + PANEL_ID)) return NodeFilter.FILTER_REJECT;
                let current = element;
                while (current && current !== root.parentElement) {
                    if (isExcluded(current) || current.matches?.(NON_CHAPTER_SELECTOR)) return NodeFilter.FILTER_REJECT;
                    if (current === root) break;
                    current = current.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        let node;
        while ((node = walker.nextNode())) {
            const text = node.nodeValue
                .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            if (!text) continue;
            const block = node.parentElement?.closest([...BLOCK_TAGS].join(","));
            pieces.push({ text, block });
        }
        let result = "";
        let prevBlock = null;
        for (const piece of pieces) {
            if (result) result += piece.block && piece.block !== prevBlock ? "\n" : " ";
            result += piece.text;
            prevBlock = piece.block;
        }
        return result.trim();
    }
    // --- Normalization & Extraction Pipeline ---
    function normalizeToken(tokenStr) {
        let t = tokenStr.trim();
        t = t.replace(/(?:'s|s')$/i, "");
        if (t.endsWith("es") && t.length > 3) {
            t = t.slice(0, -2);
        } else if (t.endsWith("s") && t.length > 2 && !t.endsWith("ss")) {
            t = t.slice(0, -1);
        }
        return t;
    }
    function extractOccurrences(text) {
        const occurrences = [];
        const regex =
            /((?:[A-ZĀĒĪŌŪ](?:\.[A-ZĀĒĪŌŪ])+\.?|[A-ZĀĒĪŌŪ]\.|[A-ZĀĒĪŌŪ]{2,}|[A-ZĀĒĪŌŪ][A-Za-zĀĒĪŌŪāēīōū0-9'’-]*)(?:\s+(?:[A-ZĀĒĪŌŪ](?:\.[A-ZĀĒĪŌŪ])+\.?|[A-ZĀĒĪŌŪ]\.|[A-ZĀĒĪŌŪ]{2,}|[A-ZĀĒĪŌŪ][A-Za-zĀĒĪŌŪāēīōū0-9'’-]*))*)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            const phrase = match[1].trim();
            const startPos = match.index;
            const parts = phrase.split(/\s+/);
            let valid = true;
            for (let i = 0; i < parts.length - 1; i++) {
                if (parts[i].endsWith(".")) {
                    if (!ABBREVIATIONS.has(parts[i].slice(0, -1))) {
                        valid = false;
                        break;
                    }
                }
            }
            if (valid && phrase.length > 1) {
                occurrences.push({ phrase, startPos });
            }
        }
        return occurrences;
    }
    function meaningfulTokens(phrase) {
        const rawTokens = phrase.trim().split(/\s+/).filter(Boolean);
        if (rawTokens.length === 0) return [];
        const lastIndex = rawTokens.length - 1;
        rawTokens[lastIndex] = normalizeToken(rawTokens[lastIndex]);
        return rawTokens.filter((token, index) => {
            if (rawTokens.length === 1 && WORD_FILTER.has(token)) {
                return false;
            }
            return !All_Words.has(token);
        });
    }
    function processCandidates(occurrences) {
        const rawMap = new Map();
        occurrences.forEach((occ) => {
            const phrase = occ.phrase;
            const caseKey = phrase.toLowerCase();
            const normTokens = meaningfulTokens(phrase);
            if (normTokens.length === 0) return;
            if (!rawMap.has(caseKey)) {
                rawMap.set(caseKey, {
                    phrase,
                    caseKey,
                    normalizedTokens: normTokens,
                    distinctTokens: new Set(normTokens),
                    occurrences: 0,
                    firstPos: occ.startPos,
                    spellingCounts: new Map()
                });
            }
            const cand = rawMap.get(caseKey);
            cand.occurrences++;
            cand.firstPos = Math.min(cand.firstPos, occ.startPos);
            const spelling = cand.spellingCounts.get(phrase);
            if (spelling) {
                spelling.count++;
                spelling.firstPos = Math.min(spelling.firstPos, occ.startPos);
            } else {
                cand.spellingCounts.set(phrase, {
                    count: 1,
                    firstPos: occ.startPos
                });
            }
        });
        let candidates = Array.from(rawMap.values());
        candidates.forEach((cand) => {
            let delegate = null;
            for (const [phrase, data] of cand.spellingCounts) {
                if (
                    !delegate ||
                    data.count > delegate.count ||
                    (data.count === delegate.count && data.firstPos < delegate.firstPos)
                ) {
                    delegate = {
                        phrase,
                        count: data.count,
                        firstPos: data.firstPos
                    };
                }
            }
            if (delegate) cand.phrase = delegate.phrase;
        });
        // Remove duplicate candidates with identical token sets.
        const deduplicatedMap = new Map();
        candidates.forEach((cand) => {
            const distinctKey = Array.from(cand.distinctTokens).sort().join("|");
            const existing = deduplicatedMap.get(distinctKey);
            if (
                !existing ||
                cand.occurrences > existing.occurrences ||
                (cand.occurrences === existing.occurrences && cand.firstPos < existing.firstPos)
            ) {
                deduplicatedMap.set(distinctKey, cand);
            }
        });
        candidates = Array.from(deduplicatedMap.values());
        // Remove candidates whose distinct token sets are strict subsets of others.
        candidates = candidates.filter((cand) => {
            for (const other of candidates) {
                if (other === cand) continue;
                if (other.distinctTokens.size <= cand.distinctTokens.size) continue;
                const isSubset = Array.from(cand.distinctTokens).every((token) => other.distinctTokens.has(token));
                if (isSubset) return false;
            }
            return true;
        });
        // Count each token's frequency across the remaining candidates.
        const tokenFreqs = new Map();
        candidates.forEach((cand) => {
            cand.distinctTokens.forEach((token) => {
                tokenFreqs.set(token, (tokenFreqs.get(token) || 0) + cand.occurrences);
            });
        });
        let globalMaxScore = 0;
        candidates.forEach((cand) => {
            cand.maxTokenCount = Math.max(0, ...Array.from(cand.distinctTokens, (token) => tokenFreqs.get(token) || 0));
            globalMaxScore = Math.max(globalMaxScore, cand.maxTokenCount);
        });
        // Hide candidates at or below 5% of the global maximum.
        if (globalMaxScore > 0) {
            const threshold = globalMaxScore * 0.05;
            candidates = candidates.filter((cand) => cand.maxTokenCount > threshold);
        }
        // Sort by maximum token frequency, then first occurrence.
        candidates.sort((a, b) => b.maxTokenCount - a.maxTokenCount || a.firstPos - b.firstPos);
        candidates.forEach((cand) => {
            cand.identityKey = Array.from(cand.distinctTokens).sort().join("|");
            cand.tokenCountsStr = cand.normalizedTokens.map((token) => tokenFreqs.get(token) || 0).join(",");
        });
        return candidates;
    }
    // --- Specialized Regex Template Rules ---
    function generateRegex(phrase, template) {
        const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const boundaryStart = "(?<![a-z])";
        const boundaryEnd = "(?![a-z])";
        if (template === "Korean") {
            if (!phrase.includes("-")) {
                return `${boundaryStart}${escapeRegex(phrase)}${boundaryEnd}`;
            }
            const tokens = phrase.trim().split(" ").filter(Boolean);
            if (!tokens.length) return "";
            const patterns = tokens.map((token) => escapeRegex(token).replace(/-/g, "[- ]?"));
            const n = patterns.length;
            if (n === 1) {
                return `${boundaryStart}${patterns[0]}${boundaryEnd}`;
            }
            const variants = new Set();
            variants.add(patterns.join(" "));
            variants.add(
                patterns
                    .slice(0, -2)
                    .concat([patterns[n - 1], patterns[n - 2]])
                    .join(" ")
            );
            if (n >= 3) {
                variants.add([...patterns.slice(0, -3), patterns[n - 2], patterns[n - 1]].join(" "));
                variants.add([...patterns.slice(0, -3), patterns[n - 1], patterns[n - 2]].join(" "));
            }
            return `${boundaryStart}(?:${[...variants].filter(Boolean).join("|")})${boundaryEnd}`;
        }
        if (template === "Japanese") {
            const parts = phrase.trim().split(" ").filter(Boolean);
            if (parts.length < 2) {
                return `${boundaryStart}${escapeRegex(phrase)}${boundaryEnd}`;
            }
            const escaped = parts.map(escapeRegex);
            const first = escaped[escaped.length - 2];
            const second = escaped[escaped.length - 1];
            const prefix = escaped.slice(0, -2).join(" ");
            const optionalPrefix = prefix ? `(?:${prefix} )?` : "";
            return `${boundaryStart}${optionalPrefix}(?:${first} ${second}|${second} ${first})${boundaryEnd}`;
        }
        return `${boundaryStart}${escapeRegex(phrase)}${boundaryEnd}`;
    }
    // --- DOM Highlighting Engine ---
    function clearHighlights() {
        highlightedElements.forEach((el) => {
            const parent = el.parentNode;
            if (parent) {
                parent.replaceChild(document.createTextNode(el.textContent), el);
                parent.normalize();
            }
        });
        highlightedElements = [];
    }
    function applyHighlights() {
        clearHighlights();
        if ((!settings.highlightedAll && highlightedCandidates.size === 0) || currentCandidates.length === 0) {
            return;
        }
        const root = activeChapterRoot?.isConnected ? activeChapterRoot : document.body;
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
    }
    // --- Styling & UI ---
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID} {
                width: fit-content;
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
                overflow: auto;
                flex: 1 1 auto;
                background: #1c1e22;
            }
            #${PANEL_ID} table {
                border-collapse: collapse;
                width: max-content;
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
                width: 100%;
                background: #101216;
                color: #fff;
                border: 1px solid #555;
                border-radius: 3px;
                padding: 2px 4px;
                font: inherit;
            }
            #${PANEL_ID} .fr-counts {
                color: #9cdcfe;
                font-family: monospace;
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
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;
        ensureStyle();
        const panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.style.left = `${Math.max(0, settings.x)}px`;
        panel.style.top = `${Math.max(0, settings.y)}px`;
        panel.style.height = `${Math.max(260, settings.height)}px`;
        panel.style.setProperty("--fr-panel-width", `${Math.max(320, settings.width)}px`);
        panel.innerHTML = `
            <div class="fr-head">
                <span id="fr-chapter-selector" title="Matched chapter container"></span>
                <label style="display:flex; align-items:center; gap:4px; margin-left: auto;">
                    <select id="fr-template">
                        ${TEMPLATES.map((t) => `<option value="${t}" ${t === settings.template ? "selected" : ""}>${t}</option>`).join("")}
                    </select>
                </label>
                <button id="fr-scan" title="Rescan Page">Rescan</button>
                <button id="fr-highlight" title="Toggle Highlight All">Highlight All: Off</button>
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
        panel.querySelector("#fr-scan").addEventListener("click", runScan);
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
    function runScan() {
        clearHighlights();
        const match = findDeepestChapterContainer();
        activeChapterRoot = match?.element ?? document.body;
        const text = extractVisibleText(activeChapterRoot);
        const selectorDisplay = document.getElementById("fr-chapter-selector");
        if (selectorDisplay) {
            selectorDisplay.textContent = match?.selector ?? "";
        }
        const occurrences = extractOccurrences(text);
        currentCandidates = processCandidates(occurrences);
        renderRows();
        applyHighlights();
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
    // Register Menu Command to Trigger Panel Opening
    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Open FR Scanner 2", createPanel);
    }
})();
