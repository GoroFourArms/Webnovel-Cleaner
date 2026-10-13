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
    const WORD_FILTER = new Set([
        "An",
        "Do",
        "Ha",
        "He",
        "Ho",
        "I",
        "No",
        "Oh",
        "So",
        "You"
    ]);
    const HIGH_FREQUENCY_CAPITAL_WORDS = new Set([
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
    function loadSettings() {
        const defaults = {
            x: 20,
            y: 20,
            width: 560,
            height: 380,
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
        if (element.hidden || element.getAttribute("aria-hidden") === "true")
            return true;
        const style = getComputedStyle(element);
        if (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.opacity === "0"
        )
            return true;
        return false;
    }
    function findDeepestChapterContainer(root = document) {
        const matches = new Set();
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
                        matches.add(el);
                    }
                });
            } catch (_) {}
        }
        const deepest = [...matches].filter(
            (el) =>
                ![...matches].some(
                    (other) => other !== el && el.contains(other)
                )
        );
        if (!deepest.length) return null;
        return deepest
            .map((element) => ({
                element,
                length: (element.innerText || "").trim().length
            }))
            .sort((a, b) => b.length - a.length)[0].element;
    }
    function extractVisibleText() {
        const page = document.body || document.documentElement;
        if (!page) return "";
        const root = findDeepestChapterContainer() || page;
        const pieces = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const element = node.parentElement;
                if (!node.nodeValue?.trim() || !element)
                    return NodeFilter.FILTER_REJECT;
                if (element.closest("#" + PANEL_ID))
                    return NodeFilter.FILTER_REJECT;
                let current = element;
                while (current && current !== root.parentElement) {
                    if (
                        isExcluded(current) ||
                        current.matches?.(NON_CHAPTER_SELECTOR)
                    )
                        return NodeFilter.FILTER_REJECT;
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
            const block = node.parentElement?.closest(
                [...BLOCK_TAGS].join(",")
            );
            pieces.push({ text, block });
        }
        let result = "";
        let prevBlock = null;
        for (const piece of pieces) {
            if (result)
                result += piece.block && piece.block !== prevBlock ? "\n" : " ";
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
        return t.toLowerCase();
    }
    function extractOccurrences(text) {
        const occurrences = [];
        const regex = /\b([A-Z][a-z]*(?:\.\s+[A-Z][a-z]*|\s+[A-Z][a-z]*)*)\b/g;
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
    function processCandidates(occurrences) {
        const rawMap = new Map();
        occurrences.forEach((occ) => {
            const phrase = occ.phrase;
            const rawTokens = phrase.split(/\s+/);
            const normTokens = rawTokens.map(normalizeToken);
            if (
                rawTokens.length === 1 &&
                (WORD_FILTER.has(phrase) ||
                    HIGH_FREQUENCY_CAPITAL_WORDS.has(phrase))
            )
                return;
            if (!rawMap.has(phrase)) {
                rawMap.set(phrase, {
                    phrase: phrase,
                    normalizedTokens: normTokens,
                    distinctTokens: new Set(normTokens),
                    occurrences: 0,
                    firstPos: occ.startPos
                });
            }
            const cand = rawMap.get(phrase);
            cand.occurrences++;
            if (occ.startPos < cand.firstPos) {
                cand.firstPos = occ.startPos;
            }
        });
        let candidates = Array.from(rawMap.values());
        // Set-based Duplicate Resolution
        const deduplicatedMap = new Map();
        candidates.forEach((cand) => {
            const distinctKey = Array.from(cand.distinctTokens)
                .sort()
                .join("|");
            if (!deduplicatedMap.has(distinctKey)) {
                deduplicatedMap.set(distinctKey, cand);
            } else {
                const existing = deduplicatedMap.get(distinctKey);
                if (
                    cand.occurrences > existing.occurrences ||
                    (cand.occurrences === existing.occurrences &&
                        cand.firstPos < existing.firstPos)
                ) {
                    deduplicatedMap.set(distinctKey, cand);
                }
            }
        });
        candidates = Array.from(deduplicatedMap.values());
        // Strict Redundancy Removal
        candidates = candidates.filter((c, idx, arr) => {
            for (let other of arr) {
                if (other === c) continue;
                const isSubset = Array.from(c.distinctTokens).every((t) =>
                    other.distinctTokens.has(t)
                );
                const isStrict =
                    other.distinctTokens.size > c.distinctTokens.size;
                if (isSubset && isStrict) return false;
            }
            return true;
        });
        // Compute Token Frequencies & Max Token Count for Each Candidate
        const tokenFreqs = new Map();
        candidates.forEach((c) => {
            c.distinctTokens.forEach((t) => {
                tokenFreqs.set(t, (tokenFreqs.get(t) || 0) + c.occurrences);
            });
        });
        let globalMaxScore = 0;
        candidates.forEach((c) => {
            let maxTokenCount = 0;
            c.distinctTokens.forEach((t) => {
                const freq = tokenFreqs.get(t) || 0;
                if (freq > maxTokenCount) maxTokenCount = freq;
            });
            c.maxTokenCount = maxTokenCount;
            if (maxTokenCount > globalMaxScore) globalMaxScore = maxTokenCount;
        });
        // Hide candidates with max token count <= 5% of global maximum candidate maxTokenCount
        if (globalMaxScore > 0) {
            const threshold = 0.05 * globalMaxScore;
            candidates = candidates.filter((c) => c.maxTokenCount > threshold);
        }
        // Sort by MAX TOKEN COUNT (Descending), tie-breaker by First Occurrence Position (Ascending)
        candidates.sort((a, b) => {
            if (b.maxTokenCount !== a.maxTokenCount)
                return b.maxTokenCount - a.maxTokenCount;
            return a.firstPos - b.firstPos;
        });
        candidates.forEach((c) => {
            c.identityKey = Array.from(c.distinctTokens).sort().join("|");
            c.tokenCountsStr = c.normalizedTokens
                .map((t) => tokenFreqs.get(t) || 0)
                .join(",");
        });
        return candidates;
    }
    // --- Specialized Regex Template Rules ---
    function generateRegex(phrase, template) {
        const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (template === "Korean") {
            if (!phrase.includes("-")) {
                // No hyphen -> treat using standard "Other" pattern rules
                return `(?<![a-z])${escapeRegex(phrase)}(?![a-z])`;
            }
            // Hyphen is replaced by [ -]?
            const phraseWithHyphensEscaped = phrase
                .split("-")
                .map(escapeRegex)
                .join("[ -]?");
            const tokens = phraseWithHyphensEscaped
                .split(/\s+/)
                .filter(Boolean);
            const n = tokens.length;
            if (n === 1) {
                return `(?<![a-z])${tokens[0]}(?![a-z])`;
            }
            const firstToken = tokens[0];
            const secondToRight = tokens[n - 2];
            const lastToken = tokens[n - 1];
            let corePattern = "";
            if (n === 2) {
                // 2 tokens: First + (?: SecondToRight)? + Last
                // Note: when n=2, firstToken === secondToRight, so we frame secondToRight optional
                corePattern = `${firstToken} (?:${secondToRight} )?${lastToken}`;
            } else if (n === 3) {
                // 3 tokens: First + (?: ThirdToRight)? + (?: SecondToRight)? + Last
                const thirdToRight = tokens[n - 3];
                corePattern = `${firstToken} (?:${thirdToRight} )?(?:${secondToRight} )?${lastToken}`;
            } else {
                // > 3 tokens: Include internal tokens between First and ThirdToRight
                const thirdToRight = tokens[n - 3];
                const middle = tokens.slice(1, n - 3).join(" ");
                const midPrefix = middle ? `${middle} ` : "";
                corePattern = `${firstToken} ${midPrefix}(?:${thirdToRight} )?(?:${secondToRight} )?${lastToken}`;
            }
            // Add additional alternative branch: | followed by thirdToRight and secondToRight (if thirdToRight exists)
            if (n >= 3) {
                const thirdToRight = tokens[n - 3];
                corePattern += `|${thirdToRight} ${secondToRight}`;
            }
            return `(?<![a-z])(?:${corePattern})(?![a-z])`;
        }
        if (template === "Japanese" && parts.length >= 2) {
            const prefix = parts.slice(0, -2).map(escape).join("\\s+");
            const first = escape(parts[parts.length - 2]);
            const second = escape(parts[parts.length - 1]);
            const optionalPrefix = prefix ? `(?:${prefix}\\s+)?` : "";
            return `(?<![a-z])${optionalPrefix}(?:${first}\\s+${second}|${second}\\s+${first})(?![a-z])`;
        }
        // Default 'Other' template
        return `(?<![a-z])${escapeRegex(phrase)}(?![a-z])`;
    }
    // --- DOM Highlighting Engine ---
    function clearHighlights() {
        highlightedElements.forEach((el) => {
            const parent = el.parentNode;
            if (parent) {
                parent.replaceChild(
                    document.createTextNode(el.textContent),
                    el
                );
                parent.normalize();
            }
        });
        highlightedElements = [];
    }
    function applyHighlights() {
        clearHighlights();
        if (!settings.highlightedAll || currentCandidates.length === 0) return;
        const bodyWalker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    if (
                        node.parentNode &&
                        EXCLUDED_TAGS.has(node.parentNode.tagName)
                    )
                        return NodeFilter.FILTER_REJECT;
                    if (
                        node.parentElement &&
                        node.parentElement.closest("#" + PANEL_ID)
                    )
                        return NodeFilter.FILTER_REJECT;
                    return node.nodeValue.trim().length > 0
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_REJECT;
                }
            }
        );
        const textNodes = [];
        while (bodyWalker.nextNode()) textNodes.push(bodyWalker.currentNode);
        currentCandidates.forEach((cand) => {
            const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
            const patternStr = generateRegex(displayName, settings.template);
            const regex = new RegExp(patternStr, "gi");
            textNodes.forEach((node) => {
                const text = node.nodeValue;
                regex.lastIndex = 0;
                if (!regex.test(text)) return;
                const frag = document.createDocumentFragment();
                let lastIdx = 0;
                let match;
                regex.lastIndex = 0;
                while ((match = regex.exec(text)) !== null) {
                    const matchStart = match.index;
                    const matchEnd = regex.lastIndex;
                    if (matchStart > lastIdx) {
                        frag.appendChild(
                            document.createTextNode(
                                text.slice(lastIdx, matchStart)
                            )
                        );
                    }
                    const span = document.createElement("span");
                    span.className = "fr-highlight-mark";
                    span.textContent = match[0];
                    frag.appendChild(span);
                    highlightedElements.push(span);
                    lastIdx = matchEnd;
                    if (match[0].length === 0) regex.lastIndex++;
                }
                if (lastIdx < text.length) {
                    frag.appendChild(
                        document.createTextNode(text.slice(lastIdx))
                    );
                }
                if (node.parentNode) {
                    node.parentNode.replaceChild(frag, node);
                }
            });
        });
    }
    // --- Styling & UI ---
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID} {
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
                line-height: 1.2;
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
                width: 100%;
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
            #${PANEL_ID} .fr-regex {
                font-family: ui-monospace, monospace;
                font-size: 11px;
                color: #ce9178;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 220px;
            }
            .fr-highlight-mark {
                background-color: rgba(255, 235, 59, 0.35) !important;
                border-bottom: 1px dashed #ffeb3b !important;
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
        panel.style.width = `${Math.max(520, settings.width)}px`;
        panel.style.height = `${Math.max(260, settings.height)}px`;
        panel.innerHTML = `
            <div class="fr-head">
                <span class="fr-title">FR Scanner 2</span>
                <label style="display:flex; align-items:center; gap:4px; margin-left: auto;">
                    Template:
                    <select id="fr-template">
                        ${TEMPLATES.map((t) => `<option value="${t}" ${t === settings.template ? "selected" : ""}>${t}</option>`).join("")}
                    </select>
                </label>
                <button id="fr-scan" title="Rescan Page">Rescan</button>
                <button id="fr-highlight" title="Toggle Highlight All">Highlight All</button>
                <button id="fr-close" title="Close Panel">×</button>
            </div>
            <div class="fr-tablewrap" id="fr-tablewrap">
                <table id="fr-table">
                    <thead>
                        <tr>
                            <th style="width: 35%;">Name</th>
                            <th style="width: 15%;">Counts</th>
                            <th style="width: 38%;">Regex</th>
                            <th style="width: 12%;">Action</th>
                        </tr>
                    </thead>
                    <tbody id="fr-rows"></tbody>
                </table>
            </div>
        `;
        document.body.appendChild(panel);
        panel.querySelector("#fr-scan").addEventListener("click", runScan);
        panel.querySelector("#fr-highlight").addEventListener("click", () => {
            settings.highlightedAll = !settings.highlightedAll;
            saveSettings();
            if (settings.highlightedAll) {
                applyHighlights();
            } else {
                clearHighlights();
            }
        });
        panel.querySelector("#fr-template").addEventListener("change", (e) => {
            settings.template = e.target.value;
            saveSettings();
            renderRows();
            if (settings.highlightedAll) applyHighlights();
        });
        panel.querySelector("#fr-close").addEventListener("click", () => {
            clearHighlights();
            panel.remove();
        });
        makeDraggable(panel, panel.querySelector(".fr-head"));
        runScan();
    }
    function makeDraggable(panel, handle) {
        let isDragging = false,
            startX,
            startY,
            initialLeft,
            initialTop;
        handle.addEventListener("pointerdown", (e) => {
            if (
                e.target.tagName === "SELECT" ||
                e.target.tagName === "BUTTON" ||
                e.target.tagName === "INPUT"
            )
                return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = panel.offsetLeft;
            initialTop = panel.offsetTop;
            panel.setPointerCapture(e.pointerId);
        });
        handle.addEventListener("pointermove", (e) => {
            if (!isDragging) return;
            panel.style.left = `${initialLeft + (e.clientX - startX)}px`;
            panel.style.top = `${initialTop + (e.clientY - startY)}px`;
        });
        handle.addEventListener("pointerup", (e) => {
            if (isDragging) {
                isDragging = false;
                settings.x = panel.offsetLeft;
                settings.y = panel.offsetTop;
                saveSettings();
                panel.releasePointerCapture(e.pointerId);
            }
        });
    }
    function runScan() {
        clearHighlights();
        const text = extractVisibleText();
        const occurrences = extractOccurrences(text);
        currentCandidates = processCandidates(occurrences);
        renderRows();
        if (settings.highlightedAll) {
            applyHighlights();
        }
    }
    function renderRows() {
        const tbody = document.getElementById("fr-rows");
        if (!tbody) return;
        tbody.innerHTML = "";
        if (currentCandidates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #888; padding: 15px;">No candidates found.</td></tr>`;
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
                if (settings.highlightedAll) applyHighlights();
            });
            tdName.appendChild(input);
            // Counts Cell
            const tdCounts = document.createElement("td");
            tdCounts.className = "fr-counts";
            tdCounts.textContent = cand.tokenCountsStr;
            // Regex Cell
            const tdRegex = document.createElement("td");
            tdRegex.className = "fr-regex";
            tdRegex.textContent = regexStr;
            tdRegex.title = regexStr;
            // Action Cell
            const tdAction = document.createElement("td");
            const btnCopy = document.createElement("button");
            btnCopy.textContent = "Copy";
            btnCopy.title = "Copy Regular Expression";
            btnCopy.addEventListener("click", () => {
                navigator.clipboard.writeText(regexStr);
            });
            tdAction.appendChild(btnCopy);
            tr.append(tdName, tdCounts, tdRegex, tdAction);
            tbody.appendChild(tr);
        });
    }
    // Register Menu Command to Trigger Panel Opening
    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Open FR Scanner 2", createPanel);
    }
})();
