// ==UserScript==
// @name         pMerger
// @namespace    pMerger
// @version      2.2.3
// @description  Clean and merge webnovel chapter text for TTS with advanced element/container consumption, ID preservation, and status diagnostics
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// ==/UserScript==
(function () {
    "use strict";
    const DEFAULT_CONFIG = {
        sites: {}
    };
    const MAX_MERGED_SENTENCES = 5;
    let originalChapterHTML = new WeakMap();
    const modifiedContainers = new Set();
    const processingContainers = new WeakSet();
    const pendingChapterTimers = new Map();
    let observer = null;
    let urlWatcher = null;
    let lastUrl = location.href;
    let processingGeneration = 0;
    let menuCommandsRegistered = false;
    const MENU_IDS = {
        apply: null,
        undo: null,
        settings: null
    };

    function loadConfig() {
        const saved = GM_getValue("pMergerConfig", null);
        if (!saved || typeof saved !== "object") {
            return { sites: {} };
        }
        return {
            sites: saved.sites && typeof saved.sites === "object" ? saved.sites : {}
        };
    }
    function saveConfig(newConfig) {
        GM_setValue("pMergerConfig", newConfig);
    }
    let config = loadConfig();
    function getCurrentConfig() {
        return config;
    }
    function getDomain() {
        return location.hostname.replace(/^www\./i, "").toLowerCase();
    }
    function getCurrentSite() {
        const domain = getDomain();
        if (config.sites && config.sites[domain]) {
            return config.sites[domain];
        }
        return null;
    }
    function addDefaultSite(sites, domain, urlPatterns, chapterContainer, junkSelector = "") {
        if (sites[domain]) {
            return;
        }
        sites[domain] = {
            enabled: false,
            urlPatterns: Array.isArray(urlPatterns) ? urlPatterns : [urlPatterns],
            chapterSelector: chapterContainer,
            junkSelector
        };
    }
    function loadDefaultSites() {
        const sites = config.sites || {};
        addDefaultSite(sites, "wtr-lab.com", "/en/novel/*/tts*", "div.chapter-container", "");
        addDefaultSite(sites, "kari-studio.com", "/chapter-*", "article.small.single", "");
        addDefaultSite(sites, "dreamy-translations.com", "/novel/*/chapter/*", "article.chapter-content", "");
        config.sites = sites;
        saveConfig(config);
    }
    loadDefaultSites();

    function wildcardToRegExp(pattern) {
        const escaped = String(pattern)
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*");
        return new RegExp("^" + escaped + "$", "i");
    }
    function urlMatchesPattern(pattern) {
        if (!pattern) return false;
        const path = location.pathname + location.search;
        return wildcardToRegExp(pattern).test(path);
    }
    function isChapterPage(requireEnabled = true) {
        const site = getCurrentSite();
        if (!site) return false;
        if (requireEnabled && site.enabled !== true) return false;
        const patterns = Array.isArray(site.urlPatterns) ? site.urlPatterns : [];
        if (patterns.length === 0) return true;
        return patterns.some(urlMatchesPattern);
    }
    function isElement(node) {
        return node && node.nodeType === 1;
    }
    function isTextNode(node) {
        return node && node.nodeType === 3;
    }
    function safeQuery(root, selector) {
        if (!root || !selector) return null;
        try {
            return root.querySelector(selector);
        } catch {
            return null;
        }
    }
    function safeQueryAll(root, selector) {
        if (!root || !selector) return [];
        try {
            return Array.from(root.querySelectorAll(selector));
        } catch {
            return [];
        }
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
        return typeof text === "string" && text.trim().length > 0;
    }
    function hasDirectText(element) {
        if (!element) return false;
        for (const node of element.childNodes) {
            if (isTextNode(node) && node.nodeValue && node.nodeValue.trim()) {
                return true;
            }
        }
        return false;
    }
    function getElementTag(element) {
        return element && element.tagName ? element.tagName.toLowerCase() : "";
    }
    function countSentences(text) {
        if (!isMeaningfulText(text)) return 0;
        const normalized = String(text)
            .replace(/\u00a0/g, " ")
            .trim();
        const matches = normalized.match(/[.!?]+(?=(?:["'”’»」』)]*)?(?:\s|$))/g);
        return matches ? matches.length : 0;
    }

    const INLINE_TAGS = new Set([
        "span",
        "a",
        "b",
        "strong",
        "i",
        "em",
        "u",
        "s",
        "small",
        "mark",
        "sub",
        "sup",
        "code",
        "abbr",
        "cite",
        "q",
        "label",
        "ruby",
        "rt",
        "rp",
        "time",
        "kbd",
        "samp",
        "var",
        "wbr"
    ]);
    const BLOCK_TAGS = new Set([
        "address",
        "article",
        "aside",
        "blockquote",
        "div",
        "dl",
        "dt",
        "dd",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "ul"
    ]);

    function isInlineElement(element) {
        return INLINE_TAGS.has(getElementTag(element));
    }
    function isBlockElement(element) {
        return BLOCK_TAGS.has(getElementTag(element));
    }
    function isHardBoundary(element) {
        if (!element) return false;
        const tag = getElementTag(element);
        if (tag === "hr" || /^h[1-6]$/.test(tag)) return true;
        return [
            "img",
            "picture",
            "video",
            "audio",
            "table",
            "ul",
            "ol",
            "li",
            "dl",
            "dt",
            "dd",
            "figure",
            "blockquote",
            "pre",
            "nav",
            "header",
            "footer",
            "aside",
            "form",
            "fieldset"
        ].includes(tag);
    }
    function isSceneBreakText(text) {
        if (!isMeaningfulText(text)) return false;
        const value = text.trim().replace(/\s+/g, "");
        if (!value) return false;
        return (
            /^~{2,}$/.test(value) ||
            /^-{3,}$/.test(value) ||
            /^_{3,}$/.test(value) ||
            /^\*{2,}$/.test(value) ||
            /^•{2,}$/.test(value) ||
            /^·{2,}$/.test(value)
        );
    }
    function isSceneBreakElement(element) {
        if (!element) return false;
        if (getElementTag(element) === "hr") return true;
        return isSceneBreakText(getElementText(element));
    }
    function getNavigationReplacement(element) {
        if (!element) return null;
        const tag = getElementTag(element);
        if (tag !== "a" && tag !== "button" && element.getAttribute("role") !== "button") return null;
        const text = getElementText(element).toLowerCase();
        if (!text) return null;
        if (/^(next|next chapter|next ch\.?|chapter next)\b/.test(text)) return "~~>";
        if (/^(previous|prev|previous chapter|prev chapter|prev\.? ch\.?|previous ch\.?)\b/.test(text)) return "<~~";
        if (/\b(table of contents|toc|contents|index|all chapters?)\b/.test(text)) return "~~|~~";
        return null;
    }
    function isNavigationElement(element) {
        return getNavigationReplacement(element) !== null;
    }
    function looksLikeDialogue(text) {
        if (!isMeaningfulText(text)) return false;
        const value = text.trim();
        if (/^[“"‘']/.test(value)) return true;
        if (/^[—–]\S/.test(value)) return true;
        return false;
    }
    function getOrderValue(element) {
        if (!element) return null;
        const explicitAttributes = ["data-order", "data-index", "data-number", "data-sequence", "data-seq"];
        for (const attribute of explicitAttributes) {
            const value = element.getAttribute(attribute);
            if (value !== null && value.trim() !== "") {
                const number = Number(value);
                if (Number.isFinite(number)) return number;
            }
        }
        return null;
    }

    const BLOCK_TYPES = {
        TEXT: "TEXT",
        SCENE_BREAK: "SCENE_BREAK",
        NAVIGATION: "NAVIGATION",
        JUNK: "JUNK",
        UNKNOWN: "UNKNOWN"
    };

    function isTextBlockCandidate(element, chapter) {
        if (!isElement(element) || !element.isConnected || element === chapter) return false;
        const text = getElementText(element);
        if (!isMeaningfulText(text)) return false;
        if (isNavigationElement(element) || isSceneBreakElement(element) || isHardBoundary(element)) return false;
        if (isInlineElement(element)) return false;
        const childBlocks = Array.from(element.children).filter((child) => isBlockElement(child));
        if (childBlocks.length > 0) return false;
        if (hasDirectText(element)) return true;
        const children = Array.from(element.children);
        if (children.length > 0 && children.every((child) => isInlineElement(child))) return true;
        return false;
    }
    function findTextBlocks(chapter) {
        if (!chapter || !chapter.isConnected) return [];
        const allElements = safeQueryAll(chapter, "*");
        const candidates = [];
        for (const element of allElements) {
            if (isTextBlockCandidate(element, chapter)) {
                candidates.push(element);
            }
        }
        return candidates.filter(
            (candidate) => !candidates.some((other) => other !== candidate && candidate.contains(other))
        );
    }
    function keepDeepestElements(elements) {
        const unique = [...new Set(elements)];
        return unique.filter((element) => !unique.some((other) => other !== element && element.contains(other)));
    }
    function findSceneBreaks(chapter) {
        const elements = safeQueryAll(chapter, "*");
        return keepDeepestElements(elements.filter(isSceneBreakElement));
    }
    function findNavigationElements(chapter) {
        const elements = safeQueryAll(chapter, 'a, button, [role="button"]');
        return keepDeepestElements(elements.filter(isNavigationElement));
    }
    function createAnalyzedBlock(element, type) {
        const text = normalizeText(element.textContent || "");
        return {
            element,
            type,
            text,
            sentenceCount: type === BLOCK_TYPES.TEXT ? countSentences(text) : 0,
            dialogue: type === BLOCK_TYPES.TEXT ? looksLikeDialogue(text) : false,
            order: type === BLOCK_TYPES.TEXT ? getOrderValue(element) : null
        };
    }
    function analyzeChapter(chapter, site) {
        const blocks = [];
        const sceneElements = findSceneBreaks(chapter);
        const navigationElements = findNavigationElements(chapter);
        for (const element of sceneElements) {
            blocks.push(createAnalyzedBlock(element, BLOCK_TYPES.SCENE_BREAK));
        }
        for (const element of navigationElements) {
            blocks.push(createAnalyzedBlock(element, BLOCK_TYPES.NAVIGATION));
        }
        const textElements = findTextBlocks(chapter);
        for (const element of textElements) {
            if (sceneElements.some((scene) => scene === element || scene.contains(element) || element.contains(scene)))
                continue;
            if (navigationElements.some((nav) => nav === element || nav.contains(element) || element.contains(nav)))
                continue;
            blocks.push(createAnalyzedBlock(element, BLOCK_TYPES.TEXT));
        }
        blocks.sort((a, b) => {
            const position = a.element.compareDocumentPosition(b.element);
            if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
            if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
            return 0;
        });
        return { chapter, site, blocks };
    }
    function removeConfiguredJunk(chapter, site) {
        if (!chapter || !site || !site.junkSelector) return false;
        let changed = false;
        let elements = [];
        try {
            elements = safeQueryAll(chapter, site.junkSelector);
        } catch (error) {
            console.warn("[pMerger] Invalid junk selector:", site.junkSelector, error);
            return false;
        }
        for (const element of elements) {
            if (element === chapter || !element.isConnected) continue;
            element.remove();
            changed = true;
        }
        return changed;
    }

    /*
     * ---------------------------------------------------------
     * TEXT CONTAINER NORMALIZATION & CONSUMPTION (ID + Tag Conversion)
     * ---------------------------------------------------------
     */
    function copyAttributes(source, target) {
        if (!source || !target || source === target) return false;
        let changed = false;

        if (source.hasAttribute("id") && !target.hasAttribute("id")) {
            target.setAttribute("id", source.getAttribute("id"));
            changed = true;
        }

        for (const attribute of Array.from(source.attributes)) {
            if (attribute.name === "id") continue;
            if (attribute.name === "class") {
                const classes = attribute.value.split(/\s+/).filter(Boolean);
                for (const className of classes) {
                    if (!target.classList.contains(className)) {
                        target.classList.add(className);
                        changed = true;
                    }
                }
                continue;
            }
            if (!target.hasAttribute(attribute.name)) {
                target.setAttribute(attribute.name, attribute.value);
                changed = true;
            }
        }
        return changed;
    }

    function convertToParagraph(element) {
        if (!element) return null;
        if (getElementTag(element) === "p") return element;

        const paragraph = document.createElement("p");
        for (const attribute of Array.from(element.attributes)) {
            paragraph.setAttribute(attribute.name, attribute.value);
        }
        while (element.firstChild) {
            paragraph.appendChild(element.firstChild);
        }
        element.replaceWith(paragraph);
        return paragraph;
    }

    function normalizeTextContainers(chapter) {
        if (!chapter || !chapter.isConnected) return false;
        let changed = false;
        let stats = { consumedSingleChild: 0, consumedParent: 0, convertedToP: 0 };

        const allElements = safeQueryAll(chapter, "*");

        for (const el of allElements) {
            if (!el.isConnected || el === chapter) continue;

            const parent = el.parentElement;
            const children = Array.from(el.children);

            if (children.length === 1 && !hasDirectText(el)) {
                const soleChild = children[0];
                copyAttributes(el, soleChild);
                el.replaceWith(soleChild);
                stats.consumedSingleChild++;
                changed = true;
                continue;
            }

            if (parent && parent !== chapter && isMeaningfulText(getElementText(el))) {
                const sameTagSiblings = Array.from(parent.children).filter(
                    (sibling) => getElementTag(sibling) === getElementTag(el)
                );
                if (sameTagSiblings.length === 1) {
                    copyAttributes(parent, el);
                    parent.replaceWith(el);
                    stats.consumedParent++;
                    changed = true;
                }
            }
        }

        const candidateBlocks = safeQueryAll(
            chapter,
            "div, article div, section div, span.paragraph, article p, section p"
        );
        for (const block of candidateBlocks) {
            if (!block.isConnected || block === chapter) continue;
            if (isMeaningfulText(getElementText(block)) && getElementTag(block) !== "p") {
                const hasMajorBlocks = Array.from(block.children).some((c) =>
                    ["article", "section", "table"].includes(getElementTag(c))
                );
                if (!hasMajorBlocks) {
                    convertToParagraph(block);
                    stats.convertedToP++;
                    changed = true;
                }
            }
        }

        console.group("[pMerger Status Check]");
        console.log("Chapter Container:", chapter);
        console.log("Normalization Status: Success");
        console.log("Stats:", stats);
        console.groupEnd();

        return changed;
    }

    /*
     * ---------------------------------------------------------
     * MERGE & FINALIZE LOGIC
     * ---------------------------------------------------------
     */
    function isStructuralBoundary(block) {
        if (!block || block.type !== BLOCK_TYPES.TEXT) return true;
        const element = block.element;
        if (!element || !element.isConnected) return true;
        return isHardBoundary(element);
    }
    function areAdjacentTextBlocks(first, second) {
        if (!first || !second || first === second || !first.isConnected || !second.isConnected) return false;
        const position = first.compareDocumentPosition(second);
        if (!(position & Node.DOCUMENT_POSITION_FOLLOWING)) return false;
        const range = document.createRange();
        try {
            range.setStartAfter(first);
            range.setEndBefore(second);
        } catch {
            return false;
        }
        const fragment = range.cloneContents();
        if (fragment.textContent.replace(/\s+/g, "").length > 0) return false;
        let sibling = first.nextElementSibling;
        while (sibling && sibling !== second) {
            if (isSceneBreakElement(sibling) || isNavigationElement(sibling) || isHardBoundary(sibling)) return false;
            if (normalizeText(sibling.textContent || "")) return false;
            sibling = sibling.nextElementSibling;
        }
        return sibling === second;
    }
    function canMergeBlocks(previous, current, sentenceCount) {
        if (!previous || !current || previous.type !== BLOCK_TYPES.TEXT || current.type !== BLOCK_TYPES.TEXT)
            return false;
        if (isStructuralBoundary(previous) || isStructuralBoundary(current)) return false;
        if (!areAdjacentTextBlocks(previous.element, current.element)) return false;
        if (previous.dialogue && current.dialogue) return false;
        return sentenceCount + current.sentenceCount <= MAX_MERGED_SENTENCES;
    }
    function buildMergeGroups(analysis) {
        const groups = [];
        let currentGroup = [];
        let sentenceCount = 0;
        for (const block of analysis.blocks) {
            if (block.type !== BLOCK_TYPES.TEXT) {
                if (currentGroup.length > 1) groups.push(currentGroup);
                currentGroup = [];
                sentenceCount = 0;
                continue;
            }
            if (currentGroup.length === 0) {
                currentGroup = [block];
                sentenceCount = block.sentenceCount;
                continue;
            }
            const previous = currentGroup[currentGroup.length - 1];
            if (canMergeBlocks(previous, block, sentenceCount)) {
                currentGroup.push(block);
                sentenceCount += block.sentenceCount;
            } else {
                if (currentGroup.length > 1) groups.push(currentGroup);
                currentGroup = [block];
                sentenceCount = block.sentenceCount;
            }
        }
        if (currentGroup.length > 1) groups.push(currentGroup);
        return groups;
    }
    function createMergePlan(analysis) {
        const groups = buildMergeGroups(analysis);
        const operations = [];
        for (const group of groups) {
            if (group.length < 2) continue;
            operations.push({
                target: group[0].element,
                sources: group.slice(1).map((block) => block.element)
            });
        }
        return operations;
    }
    function appendBlockContents(target, source) {
        if (!target || !source || target === source) return;
        while (source.firstChild) {
            target.appendChild(source.firstChild);
        }
    }
    function addMergeSeparator(target) {
        if (!target) return;
        const lastChild = target.lastChild;
        if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
            if (/\s$/.test(lastChild.nodeValue || "")) return;
        }
        target.appendChild(document.createTextNode(" "));
    }
    function mergeOperation(operation) {
        if (!operation || !operation.target || !operation.target.isConnected) return false;
        const target = operation.target;
        let changed = false;
        for (const source of operation.sources || []) {
            if (!source || source === target || !source.isConnected) continue;
            addMergeSeparator(target);
            appendBlockContents(target, source);
            source.setAttribute("data-pmerger-empty", "true");
            changed = true;
        }
        return changed;
    }
    function applyMergePlan(plan) {
        let changed = false;
        for (const operation of plan) {
            if (mergeOperation(operation)) changed = true;
        }
        return changed;
    }
    function applyNavigationReplacements(analysis) {
        let changed = false;
        for (const block of analysis.blocks) {
            if (block.type !== BLOCK_TYPES.NAVIGATION) continue;
            const element = block.element;
            if (!element || !element.isConnected) continue;
            const text = normalizeText(element.textContent || "").toLowerCase();
            let replacement = null;
            if (/^(next|next chapter|next page|forward|continue|older|older chapter)$/.test(text)) replacement = "~~>";
            else if (/^(previous|prev|previous chapter|previous page|back|backward|newer|newer chapter)$/.test(text))
                replacement = "<~~";
            else if (/^(toc|contents|table of contents|index|all chapters|all chapter|chapters)$/.test(text))
                replacement = "~~|~~";
            if (!replacement || normalizeText(element.textContent || "") === replacement) continue;
            element.textContent = replacement;
            changed = true;
        }
        return changed;
    }
    function normalizeSceneBreaks(analysis) {
        let changed = false;
        for (const block of analysis.blocks) {
            if (block.type !== BLOCK_TYPES.SCENE_BREAK) continue;
            const element = block.element;
            if (!element || !element.isConnected) continue;
            const text = normalizeText(element.textContent || "");
            if (element.tagName === "HR") {
                const replacement = document.createElement("p");
                for (const attribute of [...element.attributes]) {
                    replacement.setAttribute(attribute.name, attribute.value);
                }
                replacement.textContent = text || "***";
                element.replaceWith(replacement);
                changed = true;
                continue;
            }
            if (text !== "***") {
                element.textContent = "***";
                changed = true;
            }
        }
        return changed;
    }
    function isLikelySequence(value) {
        if (value === null || value === undefined || value === "") return false;
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 && number < 100000;
    }
    function formatOrderNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return String(Math.round(number));
    }
    function reindexOrderMetadata(chapter) {
        if (!chapter) return false;
        const elements = safeQueryAll(
            chapter,
            "[data-order], [data-index], [data-number], [data-sequence], [data-seq]"
        );
        const entries = [];
        for (const element of elements) {
            const value = getOrderValue(element);
            if (!isLikelySequence(value)) continue;
            entries.push({ element, value: Number(value) });
        }
        entries.sort((a, b) => a.value - b.value);
        let changed = false;
        entries.forEach((entry, index) => {
            const formatted = formatOrderNumber(index);
            if (formatted === null) return;
            const element = entry.element;
            const attributes = ["data-order", "data-index", "data-number", "data-sequence", "data-seq"];
            for (const attribute of attributes) {
                if (element.hasAttribute(attribute)) {
                    if (element.getAttribute(attribute) !== formatted) {
                        element.setAttribute(attribute, formatted);
                        changed = true;
                    }
                    break;
                }
            }
        });
        return changed;
    }
    function removeEmptyElements(chapter) {
        if (!chapter) return false;
        const elements = safeQueryAll(chapter, '[data-pmerger-empty="true"]');
        let changed = false;
        for (const element of elements) {
            if (element === chapter || !element.isConnected) continue;
            element.remove();
            changed = true;
        }
        return changed;
    }
    function cleanupTextNodes(chapter) {
        if (!chapter) return false;
        const walker = document.createTreeWalker(chapter, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            nodes.push(node);
        }
        let changed = false;
        for (const textNode of nodes) {
            const parent = textNode.parentElement;
            if (parent && parent.closest("pre, code, textarea")) continue;
            const original = textNode.nodeValue || "";
            const cleaned = original.replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ");
            if (cleaned !== original) {
                textNode.nodeValue = cleaned;
                changed = true;
            }
        }
        return changed;
    }
    function finalizeChapter(chapter) {
        if (!chapter || !chapter.isConnected) return false;
        let changed = false;
        if (removeEmptyElements(chapter)) changed = true;
        if (cleanupTextNodes(chapter)) changed = true;
        if (reindexOrderMetadata(chapter)) changed = true;
        return changed;
    }
    function processChapter(chapter, site) {
        if (!chapter || !chapter.isConnected || !site) return false;
        let changed = false;
        if (removeConfiguredJunk(chapter, site)) changed = true;
        if (normalizeTextContainers(chapter)) changed = true;
        let analysis = analyzeChapter(chapter, site);
        if (applyNavigationReplacements(analysis)) changed = true;
        if (normalizeSceneBreaks(analysis)) changed = true;
        if (changed) analysis = analyzeChapter(chapter, site);
        const plan = createMergePlan(analysis);
        if (applyMergePlan(plan)) changed = true;
        return changed;
    }
    function processAllChapters(root = document) {
        const site = getCurrentSite();
        if (!site || !site.enabled) return;
        const selector = site.chapterSelector;
        if (!selector) return;
        let chapters = [];
        try {
            if (root instanceof Element && root.matches(selector)) chapters.push(root);
            chapters.push(...safeQueryAll(root, selector));
        } catch (error) {
            console.warn("[pMerger] Invalid chapter selector:", selector, error);
            return;
        }
        chapters = [...new Set(chapters)];
        for (const chapter of chapters) {
            if (!chapter || !chapter.isConnected || processingContainers.has(chapter)) continue;
            if (!originalChapterHTML.has(chapter)) {
                originalChapterHTML.set(chapter, chapter.innerHTML);
            }
            processingContainers.add(chapter);
            try {
                const changed = processChapter(chapter, site);
                if (changed) {
                    modifiedContainers.add(chapter);
                    finalizeChapter(chapter);
                }
            } catch (error) {
                console.error("[pMerger] Chapter processing failed:", error);
            } finally {
                processingContainers.delete(chapter);
            }
        }
    }
    function findChapterForNode(node) {
        if (!node) return null;
        const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
        if (!element) return null;
        const site = getCurrentSite();
        if (!site || !site.chapterSelector) return null;
        try {
            return element.closest(site.chapterSelector);
        } catch {
            return null;
        }
    }
    function scheduleChapterProcessing(chapter) {
        if (!chapter || !chapter.isConnected) return;
        const generation = processingGeneration;
        const existing = pendingChapterTimers.get(chapter);
        if (existing) clearTimeout(existing);
        const timer = setTimeout(() => {
            pendingChapterTimers.delete(chapter);
            if (generation !== processingGeneration || !isChapterPage()) return;
            processAllChapters(chapter.parentElement || document);
        }, 150);
        pendingChapterTimers.set(chapter, timer);
    }
    function handleAddedNode(node) {
        if (!node) return;
        const chapter = findChapterForNode(node);
        if (chapter) scheduleChapterProcessing(chapter);
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        const site = getCurrentSite();
        if (!site || !site.chapterSelector) return;
        let chapters = [];
        try {
            chapters = safeQueryAll(node, site.chapterSelector);
            if (node.matches(site.chapterSelector)) chapters.push(node);
        } catch {
            return;
        }
        for (const newChapter of [...new Set(chapters)]) {
            scheduleChapterProcessing(newChapter);
        }
    }
    function handleMutations(mutations) {
        if (!isChapterPage()) return;
        for (const mutation of mutations) {
            if (mutation.type !== "childList") continue;
            for (const node of mutation.addedNodes) handleAddedNode(node);
            if (mutation.removedNodes.length) {
                const chapter = findChapterForNode(mutation.target);
                if (chapter) scheduleChapterProcessing(chapter);
            }
        }
    }
    function checkForUrlChange() {
        const currentUrl = location.href;
        if (currentUrl === lastUrl) return;
        lastUrl = currentUrl;
        processingGeneration++;
        for (const timer of pendingChapterTimers.values()) clearTimeout(timer);
        pendingChapterTimers.clear();
        const generation = processingGeneration;
        setTimeout(() => {
            if (generation !== processingGeneration || location.href !== currentUrl) return;
            if (isChapterPage()) processAllChapters();
        }, 100);
    }
    function startCleaner() {
        stopCleaner();
        const site = getCurrentSite();
        if (!site || !site.enabled) return;
        processAllChapters();
        const target = document.body || document.documentElement;
        if (!target) return;
        observer = new MutationObserver(handleMutations);
        observer.observe(target, { childList: true, subtree: true });
        urlWatcher = setInterval(checkForUrlChange, 500);
    }
    function stopCleaner() {
        processingGeneration++;
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (urlWatcher) {
            clearInterval(urlWatcher);
            urlWatcher = null;
        }
        for (const timer of pendingChapterTimers.values()) clearTimeout(timer);
        pendingChapterTimers.clear();
    }
    function applyCurrentPage() {
        stopCleaner();
        if (!isChapterPage(false)) return;
        processAllChapters();
        const site = getCurrentSite();
        if (site && site.enabled) startCleaner();
    }
    function undoCurrentPage() {
        stopCleaner();
        for (const chapter of modifiedContainers) {
            if (!chapter.isConnected) continue;
            const original = originalChapterHTML.get(chapter);
            if (original === undefined) continue;
            chapter.innerHTML = original;
        }
        originalChapterHTML = new WeakMap();
        modifiedContainers.clear();
        const site = getCurrentSite();
        if (site && site.enabled) startCleaner();
    }

    let settingsOverlay = null;
    function closeSettings() {
        if (settingsOverlay) {
            settingsOverlay.remove();
            settingsOverlay = null;
        }
    }
    function openSettings() {
        closeSettings();
        const currentDomain = getDomain();
        const sites = config.sites || {};
        const existingSite = sites[currentDomain] || {
            enabled: false,
            urlPatterns: [],
            chapterSelector: "",
            junkSelector: ""
        };
        const overlay = document.createElement("div");
        overlay.id = "pmerger-settings-overlay";
        overlay.innerHTML = `
            <div class="pmerger-settings-box">
                <div class="pmerger-settings-header">
                    <strong>pMerger Settings</strong>
                    <button type="button" data-pmerger-close>×</button>
                </div>
                <div class="pmerger-site-name">${currentDomain}</div>
                <div class="pmerger-settings-section">
                    <label class="pmerger-enabled-row">
                        <input type="checkbox" data-site-enabled ${existingSite.enabled === true ? "checked" : ""}>
                        Enabled
                    </label>
                    <label>
                        URL patterns
                        <textarea data-site-patterns rows="4"></textarea>
                    </label>
                    <label>
                        Chapter selector
                        <input type="text" data-site-selector>
                    </label>
                    <label>
                        Junk selector
                        <input type="text" data-site-junk>
                    </label>
                </div>
                <div class="pmerger-settings-actions">
                    <button type="button" data-pmerger-save>Save</button>
                    <button type="button" data-pmerger-cancel>Cancel</button>
                </div>
            </div>
        `;
        GM_addStyle(`
            #pmerger-settings-overlay {
                position: fixed; inset: 0; z-index: 2147483647;
                background: rgba(0, 0, 0, 0.75); display: flex;
                align-items: center; justify-content: center; padding: 20px;
                box-sizing: border-box; font-family: Arial, sans-serif;
            }
            .pmerger-settings-box {
                width: min(600px, 100%); max-height: 90vh; overflow-y: auto;
                background: #181818; color: #eeeeee; border: 1px solid #333333;
                border-radius: 10px; padding: 20px; box-sizing: border-box;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
            }
            .pmerger-settings-header {
                display: flex; align-items: center; justify-content: space-between;
                gap: 15px; margin-bottom: 20px; font-size: 20px;
            }
            .pmerger-settings-header button {
                border: 0; background: transparent; color: #eeeeee;
                font-size: 28px; cursor: pointer; line-height: 1;
            }
            .pmerger-site-name {
                font-size: 18px; font-weight: bold; color: #ffffff; margin-bottom: 20px;
            }
            .pmerger-settings-section { margin-bottom: 20px; }
            .pmerger-settings-section label { display: block; margin-bottom: 15px; }
            .pmerger-enabled-row { display: flex !important; align-items: center; gap: 8px; font-weight: bold; }
            .pmerger-settings-section input[type="text"],
            .pmerger-settings-section textarea {
                width: 100%; box-sizing: border-box; margin-top: 6px; padding: 9px;
                background: #222222; color: #eeeeee; border: 1px solid #444444;
                border-radius: 5px; font: inherit;
            }
            .pmerger-settings-section textarea { resize: vertical; }
            .pmerger-settings-actions { display: flex; gap: 10px; justify-content: flex-end; }
            .pmerger-settings-actions button {
                padding: 9px 18px; cursor: pointer; border: 1px solid #444444;
                border-radius: 5px; background: #292929; color: #eeeeee;
            }
            .pmerger-settings-actions button:hover { background: #333333; }
        `);
        document.body.appendChild(overlay);
        settingsOverlay = overlay;
        overlay.querySelector("[data-site-patterns]").value = Array.isArray(existingSite.urlPatterns)
            ? existingSite.urlPatterns.join("\n")
            : "";
        overlay.querySelector("[data-site-selector]").value = existingSite.chapterSelector || "";
        overlay.querySelector("[data-site-junk]").value = existingSite.junkSelector || "";
        overlay.querySelector("[data-pmerger-close]").addEventListener("click", closeSettings);
        overlay.querySelector("[data-pmerger-cancel]").addEventListener("click", closeSettings);
        overlay.querySelector("[data-pmerger-save]").addEventListener("click", () => {
            const enabled = overlay.querySelector("[data-site-enabled]").checked;
            const patternsText = overlay.querySelector("[data-site-patterns]").value;
            const chapterSelector = overlay.querySelector("[data-site-selector]").value.trim();
            const junkSelector = overlay.querySelector("[data-site-junk]").value.trim();
            const urlPatterns = patternsText
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean);
            const updatedSites = { ...(config.sites || {}) };
            updatedSites[currentDomain] = { enabled, urlPatterns, chapterSelector, junkSelector };
            config = { sites: updatedSites };
            saveConfig(config);
            closeSettings();
            applyCurrentPage();
        });
    }

    function registerMenuCommands() {
        if (menuCommandsRegistered) return;
        menuCommandsRegistered = true;
        GM_registerMenuCommand("pMerger: Apply", applyCurrentPage, MENU_IDS.apply);
        GM_registerMenuCommand("pMerger: Undo", undoCurrentPage, MENU_IDS.undo);
        GM_registerMenuCommand("pMerger: Settings", openSettings, MENU_IDS.settings);
    }
    function initialize() {
        lastUrl = location.href;
        registerMenuCommands();
        const site = getCurrentSite();
        if (site && site.enabled) {
            startCleaner();
        }
    }
    initialize();
})();
