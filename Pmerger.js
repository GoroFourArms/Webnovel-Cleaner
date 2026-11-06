// ==UserScript==
// @name         pMerger & Webnovel Cleaner Combined
// @namespace    Violentmonkey Scripts
// @version      3.3.0
// @description  Webnovel text cleaner with TTS period-to-comma smoothing, per-site config, conservative dialogue-aware paragraph merging, undo, and dark UI
// @match        https://wtr-lab.com/*
// @match        https://novelspyramid.com/*
// @match        https://fenrirealm.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// ==/UserScript==
(function () {
    "use strict";
    let originalNodeMap = new WeakMap();
    const modifiedContainers = new Set();
    const currentDomain = location.hostname.replace(/^www\./, "");
    function getConfigKey() {
        return `pMergerConfig_${currentDomain}`;
    }
    function loadConfig() {
        const saved = GM_getValue(getConfigKey(), null);
        return (
            saved || {
                maxSentences: 5,
                customReaderSelector: "",
                customJunkSelectors: ".c8a3f0aa4229c, .banner-container",
                customJunkKeywords:
                    "table of contents, previous chapter, next chapter, bookmark, report error, comments, login, register"
            }
        );
    }
    let userConfig = loadConfig();
    function saveConfig() {
        GM_setValue(getConfigKey(), userConfig);
    }
    const patterns = [
        /\b(?:hearing this|hearing that|hearing the words|hearing this,)\b\s*/gi,
        /\b(?:nodded in agreement|shook his head|shook her head|smiled and said|said with a smile)\b\s*/gi,
        /\b(?:definitely|downright|incredibly|obviously|utterly|abruptly|accidentally|aggressively|anxiously|crazily|cynically|daringly|defensively|deliberately)\b\s*/gi,
        /\b(?:desperately|dreadfully|eagerly|elegantly|emptily|endlessly|faintly|fiercely|flusteredly|foolishly|formally|frantically|frighteningly|furiously|gloomily|gratefully|greedily|grimly|haughtily|helplessly|hesitatingly|hopelessly|horribly|hurriedly|impatiently|inadvertently|indifferently|indignantly|innocently|inquisitively|intently|intimately|ironically|joyfully)\b\s*/gi,
        /\b(?:knowingly|lazily|loosely|lovingly|mercilessly|miserably|mockingly|mysteriously|nonchalantly|obediently|obliquely|painfully|perilously|persistently|playfully|pleasantly|powerfully|precisely|promptly|proudly|quaintly|queasily|recklessly|reluctantly|remarkably|repeatedly|resignedly)\b\s*/gi,
        /\b(?:respectfully|rightfully|scarcely|sensibly|severely|shakily|silently|sincerely|sleepily|solemnly|speedily|stealthily|sternly|stiffly|subconsciously|successfully|surprisingly|suspiciously|sympathetically|tensely|terrifyingly|thoughtfully|triumphantly|truthfully|unconsciously|uncontrollably|unexpectedly|captivatingly|crossly|curvaceously|delightedly|disappointingly|formidably|irritably|proactively|relentlessly|resentfully|skeptically|straightforwardly|unhesitatingly|unquestionably|unwillingly|warily)\b\s*/gi,
        /(?:it had to be said|no sooner said than done|no matter what|once and for all|put simply|simply put|there was no need to|to be safe|to say the least|without a doubt|would be a simple matter|all of a sudden|at that moment|without warning|as if it were the most natural thing|caught off guard|drop out of thin air|in a flash|in an inopportune moment|in the blink of an eye|no sooner had he spoken|out of thin air|paid no attention to|to top it off|under normal circumstances|without another thought|without a trace)\s*/gi
    ];
    function cleanTextNode(node) {
        let val = node.nodeValue;
        let changed = false;
        for (let i = 0; i < patterns.length; i++) {
            if (patterns[i].test(val)) {
                val = val.replace(patterns[i], "");
                changed = true;
            }
        }
        // Smooth interior sentence-ending periods for TTS.
        let smoothedVal = val.replace(/\.(?=\s+[A-Z“"‘'„«「『])/g, ",");
        if (smoothedVal !== val) {
            val = smoothedVal;
            changed = true;
        }
        if (changed) {
            val = val.replace(/\s+([,.;?!])/g, "$1").replace(/ {2,}/g, " ");
            node.nodeValue = val;
        }
    }
    function scanAndCleanText(targetContainer) {
        const walker = document.createTreeWalker(targetContainer, NodeFilter.SHOW_TEXT, {
            acceptNode: (node) => {
                const tag = node.parentNode ? node.parentNode.tagName : "";
                if (["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "CODE"].includes(tag)) {
                    return NodeFilter.FILTER_REJECT;
                }
                return node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
            }
        });
        while (walker.nextNode()) {
            cleanTextNode(walker.currentNode);
        }
    }
    GM_addStyle(`
    #pmerger-settings-overlay {
        position: fixed;
        top: 0; left: 0; width: 100vw; height: 100vh;
        background: rgba(0, 0, 0, 0.75);
        backdrop-filter: blur(3px);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    #pmerger-settings-panel {
        background: #18191a;
        color: #e4e6eb;
        width: 480px;
        max-width: 90vw;
        border-radius: 12px;
        border: 1px solid #38393b;
        box-shadow: 0 12px 32px rgba(0,0,0,0.6);
        padding: 24px;
        box-sizing: border-box;
    }
    #pmerger-settings-panel h2 {
        margin: 0 0 4px 0;
        font-size: 1.25rem;
        color: #ffffff;
    }
    #pmerger-site-tag {
        font-size: 0.8rem;
        color: #2d88ff;
        margin-bottom: 16px;
        border-bottom: 1px solid #2f3032;
        padding-bottom: 10px;
        display: block;
    }
    #pmerger-settings-panel label {
        display: block;
        margin-bottom: 14px;
        font-size: 0.9rem;
        color: #b0b3b8;
    }
    #pmerger-settings-panel input,
    #pmerger-settings-panel textarea {
        width: 100%;
        background: #242526;
        border: 1px solid #3a3b3c;
        color: #e4e6eb;
        padding: 8px 12px;
        border-radius: 6px;
        margin-top: 6px;
        box-sizing: border-box;
        font-size: 0.9rem;
        outline: none;
        transition: border-color 0.2s;
    }
    #pmerger-settings-panel input:focus,
    #pmerger-settings-panel textarea:focus {
        border-color: #2d88ff;
    }
    #pmerger-settings-panel textarea {
        resize: vertical;
        height: 60px;
    }
    .pmerger-btn-group {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
    }
    .pmerger-btn {
        background: #2d3035;
        color: #e4e6eb;
        border: none;
        padding: 8px 16px;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.9rem;
        transition: background 0.2s;
    }
    .pmerger-btn:hover { background: #3a3d44; }
    .pmerger-btn.primary {
        background: #2d88ff;
        color: #ffffff;
    }
    .pmerger-btn.primary:hover { background: #1a73e8; }
    #pmerger-toast {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #2d88ff;
        color: #ffffff;
        padding: 10px 18px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.4);
        z-index: 999998;
        font-size: 0.9rem;
        font-weight: 600;
        animation: pmergerFadeIn 0.3s ease;
    }
    @keyframes pmergerFadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
    }
`);
    function showToast(message) {
        let existing = document.getElementById("pmerger-toast");
        if (existing) existing.remove();
        const toast = document.createElement("div");
        toast.id = "pmerger-toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 2500);
    }
    function showSettingsUI() {
        if (document.getElementById("pmerger-settings-overlay")) return;
        const overlay = document.createElement("div");
        overlay.id = "pmerger-settings-overlay";
        overlay.innerHTML = `
        <div id="pmerger-settings-panel">
            <h2>⚙ pMerger Settings</h2>
            <span id="pmerger-site-tag">Configuring site: <strong>${currentDomain}</strong></span>
            <label>
                Max Merged Sentences (Hard Cap: 5):
                <input type="number" id="pmerger-max-sentences" value="${Math.min(userConfig.maxSentences, 5)}" min="1" max="5">
            </label>
            <label>
                Custom Reader Selector (CSS Selector, optional):
                <input type="text" id="pmerger-reader-selector" value="${userConfig.customReaderSelector}" placeholder="e.g. .reading-content or #chapter-content">
            </label>
            <label>
                Custom Junk Selectors (CSS, comma-separated):
                <input type="text" id="pmerger-junk-selectors" value="${userConfig.customJunkSelectors}">
            </label>
            <label>
                Junk Keywords to Filter Out (comma-separated):
                <textarea id="pmerger-junk-keywords">${userConfig.customJunkKeywords}</textarea>
            </label>
            <div class="pmerger-btn-group">
                <button class="pmerger-btn" id="pmerger-cancel">Cancel</button>
                <button class="pmerger-btn primary" id="pmerger-save">Save & Apply</button>
            </div>
        </div>
    `;
        document.body.appendChild(overlay);
        document.getElementById("pmerger-cancel").onclick = () => overlay.remove();
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };
        document.getElementById("pmerger-save").onclick = () => {
            let parsedVal = parseInt(document.getElementById("pmerger-max-sentences").value, 10) || 5;
            userConfig.maxSentences = Math.min(parsedVal, 5);
            userConfig.customReaderSelector = document.getElementById("pmerger-reader-selector").value.trim();
            userConfig.customJunkSelectors = document.getElementById("pmerger-junk-selectors").value.trim();
            userConfig.customJunkKeywords = document.getElementById("pmerger-junk-keywords").value.trim();
            saveConfig();
            overlay.remove();
            processManualReader(true);
        };
    }
    function normalizeText(text) {
        return String(text || "")
            .replace(/\u00a0/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }
    function getElementText(element) {
        if (!element) return "";
        return normalizeText(element.textContent || "");
    }
    function isMeaningfulText(text) {
        return typeof text === "string" && text.trim().length > 1;
    }
    function countSentences(text) {
        if (!isMeaningfulText(text)) return 0;
        const normalized = normalizeText(text);
        const matches = normalized.match(/[.!?]+(?:["'”’»」』)\]]*)?(?=\s|$)/g);
        return matches ? matches.length : 1;
    }
    function getBlockType(text) {
        if (!isMeaningfulText(text)) return "empty";
        const val = text.trim();
        // Treat blocks beginning with quotation marks as dialogue.
        if (/^[“"‘'„«「『]/.test(val)) return "dialogue";
        // Mixed narration and dialogue are treated as boundaries.
        if (/[“‘「『][^”’」』]*[”’」』]/.test(val)) return "mixed";
        return "narration";
    }
    function isHeaderOrTitle(element, text) {
        const tag = element.tagName ? element.tagName.toLowerCase() : "";
        if (["h1", "h2", "h3", "h4"].includes(tag)) return true;
        const lowerTxt = text.toLowerCase();
        if (/^chapter\s+\d+/i.test(lowerTxt) || /^volume\s+\d+/i.test(lowerTxt)) return true;
        if (element.classList && Array.from(element.classList).some((c) => c.includes("title") || c.includes("header")))
            return true;
        return false;
    }
    function isJunkElement(element) {
        const text = getElementText(element).toLowerCase();
        const tag = element.tagName ? element.tagName.toLowerCase() : "";
        if (["script", "style", "nav", "header", "footer", "aside", "form"].includes(tag)) {
            return true;
        }
        if (isHeaderOrTitle(element, text)) return true;
        const keywords = userConfig.customJunkKeywords
            .split(",")
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean);
        return keywords.some((kw) => text === kw || (text.length < 40 && text.includes(kw)));
    }
    function findBestReadingRoot() {
        if (userConfig.customReaderSelector) {
            try {
                const customEl = document.querySelector(userConfig.customReaderSelector);
                if (customEl) return customEl;
            } catch (e) {
                console.error("[pMerger] Invalid custom reader selector:", e);
            }
        }
        const prioritySelectors = [
            "#reader-area",
            ".chapter-view",
            ".reader-area",
            "div.chapter-container",
            ".chapter-content",
            ".reading-content",
            "article",
            "main",
            "[role='main']"
        ];
        for (const sel of prioritySelectors) {
            const el = document.querySelector(sel);
            if (el && el.querySelectorAll("p, div").length > 3) {
                return el;
            }
        }
        const candidates = Array.from(document.querySelectorAll("div"));
        let bestContainer = document.body;
        let maxParagraphs = 0;
        for (const el of candidates) {
            const paragraphs = el.querySelectorAll("p");
            if (paragraphs.length > maxParagraphs) {
                maxParagraphs = paragraphs.length;
                bestContainer = el;
            }
        }
        return bestContainer;
    }
    function processManualReader(manualTrigger = false) {
        const root = findBestReadingRoot();
        if (!root) return false;
        if (!originalNodeMap.has(root)) {
            originalNodeMap.set(root, root.cloneNode(true));
        }
        // Remove only empty wrappers.
        root.querySelectorAll("p, div, span").forEach((el) => {
            if (!el.textContent.trim() && el.children.length === 0) {
                el.remove();
            }
        });
        scanAndCleanText(root);
        if (userConfig.customJunkSelectors) {
            try {
                root.querySelectorAll(userConfig.customJunkSelectors).forEach((el) => el.remove());
            } catch (e) {
                console.error("[pMerger] Invalid custom junk selector:", e);
            }
        }
        root.querySelectorAll("script, style").forEach((el) => el.remove());
        // Select paragraph-like elements while avoiding parent containers.
        const selector = "p, div.reader-paragraph, .chapter-view p, #reader-area p, .reader-area p, div, span";
        const elements = Array.from(root.querySelectorAll(selector));
        const blocks = elements.filter((el) => {
            const text = getElementText(el);
            if (!isMeaningfulText(text) || text.length < 3 || isJunkElement(el)) {
                return false;
            }
            if (el.closest("script, style, textarea, input, code, nav, header, footer, aside, form")) {
                return false;
            }
            return !Array.from(el.children).some((child) =>
                /^(P|DIV|ARTICLE|SECTION|BLOCKQUOTE|UL|OL|LI)$/.test(child.tagName)
            );
        });
        // Remove nested duplicates while retaining document order.
        const uniqueBlocks = blocks.filter((el) => !blocks.some((other) => other !== el && other.contains(el)));
        if (uniqueBlocks.length < 2) return false;
        let changed = false;
        let currentGroup = [];
        let currentSentenceCount = 0;
        const sentenceCap = Math.max(1, Math.min(Number(userConfig.maxSentences) || 5, 5));
        const flushGroup = () => {
            if (currentGroup.length > 1) {
                executeMerge(currentGroup);
                changed = true;
            }
            currentGroup = [];
            currentSentenceCount = 0;
        };
        for (const block of uniqueBlocks) {
            const text = getElementText(block);
            const type = getBlockType(text);
            const sentenceCount = Math.max(1, countSentences(text));
            // Dialogue and mixed blocks are hard boundaries.
            // Never guess whether consecutive dialogue belongs to the same speaker.
            if (type !== "narration") {
                flushGroup();
                continue;
            }
            if (sentenceCount > sentenceCap) {
                flushGroup();
                continue;
            }
            if (currentGroup.length && currentSentenceCount + sentenceCount > sentenceCap) {
                flushGroup();
            }
            currentGroup.push(block);
            currentSentenceCount += sentenceCount;
        }
        flushGroup();
        if (changed) {
            modifiedContainers.add(root);
            if (manualTrigger) {
                showToast(`pMerger (${currentDomain}): Paragraphs merged successfully!`);
            }
        } else if (manualTrigger) {
            showToast("pMerger: No safe paragraph merges found.");
        }
        return changed;
    }
    function executeMerge(group) {
        const target = group[0];
        for (let i = 1; i < group.length; i++) {
            const source = group[i];
            if (!source.isConnected) continue;
            const targetText = target.textContent || "";
            if (targetText.length > 0 && !/\s$/.test(targetText)) {
                target.appendChild(document.createTextNode(" "));
            }
            while (source.firstChild) {
                target.appendChild(source.firstChild);
            }
            source.remove();
        }
    }
    GM_registerMenuCommand("▶ Apply pMerger & Cleaner Now", () => {
        const success = processManualReader(true);
        if (!success) {
            showToast("pMerger: No mergeable text blocks found.");
        }
    });
    GM_registerMenuCommand("↺ Undo pMerger Changes", () => {
        let restoredCount = 0;
        for (const container of modifiedContainers) {
            if (originalNodeMap.has(container) && container.isConnected) {
                const originalClone = originalNodeMap.get(container);
                container.parentNode.replaceChild(originalClone, container);
                originalNodeMap.set(originalClone, originalClone.cloneNode(true));
                restoredCount++;
            }
        }
        modifiedContainers.clear();
        showToast(`pMerger: Restored ${restoredCount} containers.`);
    });
    GM_registerMenuCommand("⚙ Configure Custom Junk & Rules", () => {
        showSettingsUI();
    });
    const observer = new MutationObserver(() => {
        scanAndCleanText(document.body);
    });
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    scanAndCleanText(document.body);
})();
