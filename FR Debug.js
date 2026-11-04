// ==UserScript==
// @name         FR Debug
// @namespace    https://github.com/FRDebug
// @version      2.0.0
// @description  Independently analyze FoxReplace rules against the current page.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
(function () {
    "use strict";
    const STORAGE = {
        settings: "FR_DEBUG_SETTINGS_V2",
        database: "FR_DEBUG_DATABASE_V2",
        lastImport: "FR_DEBUG_LAST_IMPORT_V2"
    };
    const DEFAULT_SETTINGS = {
        width: 900,
        height: 600,
        left: 60,
        top: 60,
        columnWidths: {},
        minimized: false
    };
    const EMPTY_DATABASE = {
        format: "foxreplace",
        version: null,
        groups: []
    };
    const state = {
        settings: { ...DEFAULT_SETTINGS },
        database: cloneJSON(EMPTY_DATABASE),
        pageText: "",
        matchingRules: [],
        groupMatches: [],
        conflicts: [],
        ruleErrors: [],
        imported: false,
        activeTab: "all",
        gridSearch: "",
        gridFilters: {},
        gridSort: {
            column: "group",
            direction: "asc"
        },
        selectedRows: new Set(),
        lastSelectedRow: null,
        collapsedGroups: new Set(),
        panel: null,
        status: "Import a FoxReplace JSON file to begin.",
        lastAnalysis: null
    };
    function cloneJSON(value) {
        return JSON.parse(JSON.stringify(value));
    }
    function storageGet(key, fallback) {
        try {
            if (typeof GM_getValue === "function") {
                const value = GM_getValue(key, fallback);
                return value === undefined ? fallback : value;
            }
        } catch (error) {
            console.warn("[FR Debug] Storage read failed:", error);
        }
        return fallback;
    }
    function storageSet(key, value) {
        try {
            if (typeof GM_setValue === "function") {
                GM_setValue(key, value);
            }
        } catch (error) {
            console.warn("[FR Debug] Storage write failed:", error);
        }
    }
    function loadSettings() {
        const saved = storageGet(STORAGE.settings, {});
        const settings = saved && typeof saved === "object" ? saved : {};
        const validNumber = (value, fallback, min, max) => {
            const number = Number(value);
            if (!Number.isFinite(number)) return fallback;
            return Math.min(max, Math.max(min, number));
        };
        state.settings = {
            ...DEFAULT_SETTINGS,
            ...settings,
            width: validNumber(settings.width, DEFAULT_SETTINGS.width, 420, 10000),
            height: validNumber(settings.height, DEFAULT_SETTINGS.height, 220, 10000),
            left: validNumber(settings.left, DEFAULT_SETTINGS.left, 0, 10000),
            top: validNumber(settings.top, DEFAULT_SETTINGS.top, 0, 10000),
            minimized: settings.minimized === true,
            columnWidths: {
                ...DEFAULT_SETTINGS.columnWidths,
                ...(settings.columnWidths && typeof settings.columnWidths === "object" ? settings.columnWidths : {})
            }
        };
    }
    function saveSettings() {
        storageSet(STORAGE.settings, state.settings);
    }
    function loadDatabase() {
        const saved = storageGet(STORAGE.database, null);
        if (saved && typeof saved === "object" && Array.isArray(saved.groups)) {
            state.database = saved;
            state.imported = true;
            state.status = `Loaded ${saved.groups.length} saved FoxReplace groups.`;
        }
    }
    function saveDatabase() {
        storageSet(STORAGE.database, state.database);
    }
    function getGroupName(group, index) {
        if (typeof group.name === "string" && group.name.trim()) {
            return group.name.trim();
        }
        if (typeof group.title === "string" && group.title.trim()) {
            return group.title.trim();
        }
        return `Group ${index + 1}`;
    }
    function ruleText(rule) {
        return typeof rule.input === "string" ? rule.input : "";
    }
    function normalizeImportedRule(sourceRule, groupIndex, ruleIndex) {
        if (!sourceRule || typeof sourceRule !== "object") {
            return {
                original: sourceRule,
                input: "",
                output: "",
                inputType: "text",
                outputType: "text",
                caseSensitive: false,
                enabled: true,
                valid: false,
                errors: ["Rule is not a valid object."],
                sourceGroupIndex: groupIndex,
                sourceRuleIndex: ruleIndex
            };
        }
        const input = typeof sourceRule.input === "string" ? sourceRule.input : "";
        const output = typeof sourceRule.output === "string" ? sourceRule.output : "";
        const inputType = typeof sourceRule.inputType === "string" ? sourceRule.inputType : "text";
        const outputType = typeof sourceRule.outputType === "string" ? sourceRule.outputType : "text";
        const errors = [];
        if (!input.trim()) {
            errors.push("Search input is empty.");
        }
        if (!["text", "regexp", "wholewords"].includes(inputType)) {
            errors.push(`Unsupported input type: ${inputType}`);
        }
        return {
            original: sourceRule,
            input,
            output,
            inputType,
            outputType,
            caseSensitive: sourceRule.caseSensitive === true,
            enabled: sourceRule.enabled !== false,
            valid: errors.length === 0,
            errors,
            sourceGroupIndex: groupIndex,
            sourceRuleIndex: ruleIndex
        };
    }
    function normalizeImportedGroup(sourceGroup, groupIndex) {
        if (!sourceGroup || typeof sourceGroup !== "object" || Array.isArray(sourceGroup)) {
            throw new Error(`Group ${groupIndex + 1} is not a valid object.`);
        }
        if (!Array.isArray(sourceGroup.substitutions)) {
            throw new Error(`Group ${groupIndex + 1} does not contain a substitutions array.`);
        }
        const rules = sourceGroup.substitutions.map((rule, ruleIndex) =>
            normalizeImportedRule(rule, groupIndex, ruleIndex)
        );
        return {
            original: cloneJSON(sourceGroup),
            name: getGroupName(sourceGroup, groupIndex),
            urls: Array.isArray(sourceGroup.urls) ? sourceGroup.urls.slice() : [],
            enabled: sourceGroup.enabled !== false,
            // Preserve FoxReplace settings exactly.
            html: sourceGroup.html ?? "none",
            mode: sourceGroup.mode ?? "auto&manual",
            rules,
            sourceGroupIndex: groupIndex
        };
    }
    function extractRulesFromJSON(parsed) {
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("The JSON root must be an object.");
        }
        if (!Array.isArray(parsed.groups)) {
            throw new Error("This file does not contain a FoxReplace groups array.");
        }
        if (parsed.groups.length === 0) {
            throw new Error("The FoxReplace file contains no groups.");
        }
        return {
            format: "foxreplace",
            version: parsed.version ?? null,
            original: cloneJSON(parsed),
            groups: parsed.groups.map((group, index) => normalizeImportedGroup(group, index))
        };
    }
    function importFoxReplaceJSON(jsonText) {
        let parsed;
        try {
            parsed = JSON.parse(jsonText);
        } catch (error) {
            throw new Error(`Invalid JSON: ${error.message}`);
        }
        // Build and validate the new database before replacing the old one.
        const newDatabase = extractRulesFromJSON(parsed);
        const totalRules = newDatabase.groups.reduce((total, group) => total + group.rules.length, 0);
        const invalidRules = newDatabase.groups.reduce(
            (total, group) => total + group.rules.filter((rule) => !rule.valid).length,
            0
        );
        state.database = newDatabase;
        state.imported = true;
        state.matchingRules = [];
        state.groupMatches = [];
        state.conflicts = [];
        state.ruleErrors = [];
        state.collapsedGroups.clear();
        saveDatabase();
        storageSet(STORAGE.lastImport, Date.now());
        state.status =
            `Imported ${newDatabase.groups.length} groups and ${totalRules} rules. ` +
            `${invalidRules} invalid rules retained for inspection.`;
        return {
            groups: newDatabase.groups.length,
            rules: totalRules,
            invalidRules
        };
    }
    const EXCLUDED_TAGS = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "TEMPLATE",
        "NAV",
        "HEADER",
        "FOOTER",
        "ASIDE",
        "FORM",
        "BUTTON",
        "INPUT",
        "SELECT",
        "TEXTAREA",
        "IFRAME",
        "OBJECT",
        "EMBED",
        "SVG",
        "CANVAS"
    ]);
    const BLOCK_TAGS = new Set([
        "ADDRESS",
        "ARTICLE",
        "BLOCKQUOTE",
        "DIV",
        "DL",
        "DT",
        "DD",
        "FIELDSET",
        "FIGCAPTION",
        "FIGURE",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "HR",
        "LI",
        "MAIN",
        "OL",
        "P",
        "PRE",
        "SECTION",
        "TABLE",
        "TBODY",
        "THEAD",
        "TR",
        "TD",
        "TH",
        "UL"
    ]);
    function isExcludedElement(element) {
        if (!(element instanceof Element)) return false;
        if (EXCLUDED_TAGS.has(element.tagName)) return true;
        if (element.id === "fr-debug-panel" || element.id === "fr-scanner-panel") {
            return true;
        }
        if (element.closest("#fr-debug-panel, #fr-scanner-panel, " + "[data-fr-debug], [data-fr-scanner]")) {
            return true;
        }
        if (
            element.matches(
                '[hidden], [aria-hidden="true"], ' + '[role="navigation"], [role="banner"], [role="contentinfo"]'
            )
        ) {
            return true;
        }
        const classAndId = `${element.id} ${element.className || ""}`.toLowerCase();
        if (/\b(advertisement|advert|adsbygoogle|cookie-banner|cookie-consent)\b/.test(classAndId)) {
            return true;
        }
        const style = window.getComputedStyle(element);
        return (
            style.display === "none" ||
            style.visibility === "hidden" ||
            style.visibility === "collapse" ||
            style.contentVisibility === "hidden"
        );
    }
    function extractPageText() {
        if (!document.body) return "";
        const chunks = [];
        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                chunks.push(node.nodeValue || "");
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const element = node;
            if (isExcludedElement(element)) return;
            const isBlock = BLOCK_TAGS.has(element.tagName);
            if (isBlock) chunks.push("\n");
            for (const child of element.childNodes) {
                walk(child);
            }
            if (isBlock) chunks.push("\n");
        }
        walk(document.body);
        return chunks
            .join("")
            .replace(/\u00a0/g, " ")
            .replace(/[ \t\f\v]+/g, " ")
            .replace(/ *\n */g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }
    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function compileRuleRegex(rule) {
        const input = ruleText(rule);
        if (!input) {
            throw new Error("Search input is empty.");
        }
        let source;
        let flags;
        switch (rule.inputType) {
            case "regexp":
                // Preserve FoxReplace regular-expression syntax.
                source = input;
                flags = rule.caseSensitive ? "g" : "gi";
                break;
            case "wholewords":
                source = `(?<![\\p{L}\\p{N}\\p{M}_])(?:${escapeRegExp(input)})(?![\\p{L}\\p{N}\\p{M}_])`;
                flags = rule.caseSensitive ? "gu" : "giu";
                break;
            case "text":
                source = escapeRegExp(input);
                flags = rule.caseSensitive ? "gu" : "giu";
                break;
            default:
                throw new Error(`Unsupported input type: ${rule.inputType}`);
        }
        return new RegExp(source, flags);
    }
    function findRuleMatches(pageText, regex, rule) {
        const text = String(pageText || "");
        const matches = [];
        if (!(regex instanceof RegExp)) {
            throw new Error("Invalid compiled rule expression.");
        }
        regex.lastIndex = 0;
        let match;
        while ((match = regex.exec(text)) !== null) {
            matches.push({
                index: match.index,
                length: match[0].length,
                text: match[0]
            });
            if (match[0].length === 0) {
                // Stop if the empty match occurred at the end of the text.
                if (regex.lastIndex >= text.length) break;
                // Advance by one Unicode code point to prevent an infinite loop.
                const codePoint = text.codePointAt(regex.lastIndex);
                regex.lastIndex += codePoint > 0xffff ? 2 : 1;
            }
        }
        regex.lastIndex = 0;
        return matches;
    }
    function matchPageRules(pageText, eligibleGroups) {
        const matches = [];
        const errors = [];
        eligibleGroups.forEach((group, eligibleGroupIndex) => {
            if (!group || group.enabled === false) return;
            const groupIndex = Number.isInteger(group.sourceGroupIndex) ? group.sourceGroupIndex : eligibleGroupIndex;
            const groupName = group.name || `Group ${groupIndex + 1}`;
            (group.rules || []).forEach((rule, ruleIndex) => {
                if (!rule || rule.enabled === false) return;
                const search = ruleText(rule);
                if (rule.valid === false) {
                    errors.push({
                        groupIndex,
                        ruleIndex,
                        groupName,
                        search,
                        message:
                            Array.isArray(rule.errors) && rule.errors.length
                                ? rule.errors.join(" ")
                                : "Invalid imported rule."
                    });
                    return;
                }
                try {
                    const regex = compileRuleRegex(rule);
                    const ruleMatches = findRuleMatches(pageText, regex, rule);
                    if (ruleMatches.length) {
                        matches.push({
                            groupIndex,
                            ruleIndex,
                            groupName,
                            group,
                            rule,
                            search,
                            replacement: rule.output,
                            inputType: rule.inputType,
                            outputType: rule.outputType,
                            caseSensitive: rule.caseSensitive,
                            sourceGroupIndex: groupIndex,
                            sourceRuleIndex: Number.isInteger(rule.sourceRuleIndex) ? rule.sourceRuleIndex : ruleIndex,
                            matches: ruleMatches,
                            matchCount: ruleMatches.length
                        });
                    }
                } catch (error) {
                    errors.push({
                        groupIndex,
                        ruleIndex,
                        groupName,
                        search,
                        message: error.message || String(error)
                    });
                }
            });
        });
        return { matches, errors };
    }
    function buildGroupMatches(matchedRules) {
        const groups = new Map();
        matchedRules.forEach((match) => {
            const key = match.groupIndex;
            if (!groups.has(key)) {
                groups.set(key, {
                    groupIndex: key,
                    sourceGroupIndex: match.sourceGroupIndex,
                    name: match.groupName,
                    group: match.group,
                    rules: []
                });
            }
            groups.get(key).rules.push(match);
        });
        return Array.from(groups.values())
            .sort((a, b) => a.groupIndex - b.groupIndex)
            .map((group) => ({
                ...group,
                rules: group.rules.sort((a, b) => a.ruleIndex - b.ruleIndex)
            }));
    }
    function normalizeConflictText(value) {
        return (
            String(value || "")
                .normalize("NFKC")
                .toLocaleLowerCase()
                .trim()
                // Treat common separators as equivalent.
                .replace(/[\s_\-‐‑‒–—―]+/g, " ")
                .replace(/\s+/g, " ")
        );
    }
    function rulesConflict(first, second) {
        const firstCaseSensitive = first.caseSensitive === true;
        const secondCaseSensitive = second.caseSensitive === true;
        if (firstCaseSensitive !== secondCaseSensitive) return false;
        if (first.inputType !== second.inputType) return false;
        if (first.outputType !== second.outputType) return false;
        const normalizeSearch = (value) => {
            const text = String(value || "")
                .normalize("NFKC")
                .trim()
                .replace(/[\s_\-‐‑‒–—―]+/g, " ")
                .replace(/\s+/g, " ");
            return firstCaseSensitive ? text : text.toLocaleLowerCase();
        };
        const firstSearch = normalizeSearch(first.search);
        const secondSearch = normalizeSearch(second.search);
        if (!firstSearch || !secondSearch) return false;
        if (firstSearch !== secondSearch) return false;
        if (first.replacement === second.replacement) return false;
        return true;
    }
    function buildConflictClusters(matchedRules) {
        const rules = matchedRules.slice().sort((a, b) => {
            if (a.groupIndex !== b.groupIndex) {
                return a.groupIndex - b.groupIndex;
            }
            return a.ruleIndex - b.ruleIndex;
        });
        const adjacency = rules.map(() => []);
        for (let i = 0; i < rules.length; i++) {
            for (let j = i + 1; j < rules.length; j++) {
                if (rulesConflict(rules[i], rules[j])) {
                    adjacency[i].push(j);
                    adjacency[j].push(i);
                }
            }
        }
        const visited = new Set();
        const clusters = [];
        for (let start = 0; start < rules.length; start++) {
            if (visited.has(start) || adjacency[start].length === 0) {
                continue;
            }
            const stack = [start];
            const componentIndexes = new Set();
            visited.add(start);
            while (stack.length) {
                const current = stack.pop();
                componentIndexes.add(current);
                for (const neighbor of adjacency[current]) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        stack.push(neighbor);
                    }
                }
            }
            const component = Array.from(componentIndexes)
                .map((index) => rules[index])
                .sort((a, b) => {
                    if (a.groupIndex !== b.groupIndex) {
                        return a.groupIndex - b.groupIndex;
                    }
                    return a.ruleIndex - b.ruleIndex;
                });
            if (component.length > 1) {
                const firstMember = component[0];
                const normalizedSearch =
                    firstMember.caseSensitive === true
                        ? String(firstMember.search || "")
                              .normalize("NFKC")
                              .trim()
                              .replace(/[\s_\-‐‑‒–—―]+/g, " ")
                              .replace(/\s+/g, " ")
                        : normalizeConflictText(firstMember.search);
                clusters.push({
                    id: `conflict-${clusters.length + 1}`,
                    search: firstMember.search,
                    normalizedSearch,
                    members: component
                });
            }
        }
        return clusters;
    }
    function urlPatternMatches(pattern, currentUrl) {
        const value = String(pattern || "").trim();
        const url = String(currentUrl || "");
        // Empty patterns match every page.
        if (!value) return true;
        // Support regular-expression patterns written as /pattern/flags.
        if (value.startsWith("/")) {
            const lastSlash = value.lastIndexOf("/");
            if (lastSlash > 0) {
                const source = value.slice(1, lastSlash);
                const flags = value.slice(lastSlash + 1);
                try {
                    return new RegExp(source, flags).test(url);
                } catch (error) {
                    console.warn("[FR Debug] Invalid URL regex:", pattern, error);
                    return false;
                }
            }
        }
        // Support * as a wildcard.
        if (value.includes("*")) {
            const escaped = value
                .split("*")
                .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
                .join(".*");
            try {
                return new RegExp(escaped, "i").test(url);
            } catch (error) {
                console.warn("[FR Debug] Invalid URL pattern:", pattern, error);
                return false;
            }
        }
        // Ordinary patterns match anywhere in the URL.
        return url.toLowerCase().includes(value.toLowerCase());
    }
    function analyzeDebugPage() {
        if (!state.imported || !state.database.groups.length) {
            state.status = "Import a FoxReplace JSON file before analyzing.";
            renderDebug();
            return;
        }
        try {
            // 1. Extract visible page text.
            const pageText = extractPageText();
            // 2. Find groups whose URL patterns match this page.
            const eligibleGroups = state.database.groups.filter(
                (group) =>
                    group.enabled !== false &&
                    Array.isArray(group.urls) &&
                    (group.urls.length === 0 || group.urls.some((pattern) => urlPatternMatches(pattern, location.href)))
            );
            // 3. Match rules and collect errors.
            const result = matchPageRules(pageText, eligibleGroups);
            const matchedRules = result.matches;
            const ruleErrors = result.errors;
            // 4. Build matched groups.
            const groupMatches = buildGroupMatches(matchedRules);
            // 5. Build conflicts from matched rules.
            const conflicts = buildConflictClusters(matchedRules);
            // 6. Save results.
            state.pageText = pageText;
            state.matchingRules = matchedRules;
            state.groupMatches = groupMatches;
            state.conflicts = conflicts;
            state.ruleErrors = ruleErrors;
            state.lastAnalysis = Date.now();
            const totalOccurrences = matchedRules.reduce((total, rule) => total + (rule.matchCount || 0), 0);
            state.status =
                `Analysis complete: ${matchedRules.length} matched rules, ` +
                `${totalOccurrences} occurrences, ${groupMatches.length} groups, ` +
                `${conflicts.length} conflict clusters, ` +
                `${ruleErrors.length} rule errors.`;
        } catch (error) {
            state.status = `Analysis failed: ${error.message}`;
            console.error("[FR Debug] Analysis failed:", error);
        }
        renderDebug();
    }
    function openImportPicker() {
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = ".json,application/json";
        picker.style.display = "none";
        picker.addEventListener("change", async () => {
            const file = picker.files && picker.files[0];
            if (!file) {
                picker.remove();
                return;
            }
            try {
                const text = await file.text();
                const result = importFoxReplaceJSON(text);
                state.status =
                    `Imported ${result.groups} groups and ${result.rules} rules. ` +
                    `${result.invalidRules} invalid rules retained.`;
                // Show the imported database results immediately.
                analyzeDebugPage();
            } catch (error) {
                state.status = `Import failed: ${error.message}`;
                console.error("[FR Debug] Import failed:", error);
                renderDebug();
            } finally {
                picker.remove();
            }
        });
        document.body.appendChild(picker);
        picker.click();
    }
    function buildCopyText() {
        const lines = [
            "FR Debug Analysis",
            `Page: ${location.href}`,
            `Analyzed: ${state.lastAnalysis ? new Date(state.lastAnalysis).toLocaleString() : "Not analyzed"}`,
            "",
            `Matched rules: ${state.matchingRules.length}`,
            `Matched groups: ${state.groupMatches.length}`,
            `Conflict clusters: ${state.conflicts.length}`,
            `Rule errors: ${state.ruleErrors.length}`,
            ""
        ];
        for (const group of state.groupMatches) {
            lines.push(`GROUP: ${group.name}`);
            for (const match of group.rules) {
                lines.push(`  Search: ${match.search}`);
                lines.push(`  Replacement: ${match.replacement}`);
                lines.push(`  Input type: ${match.inputType}`);
                lines.push(`  Output type: ${match.outputType}`);
                lines.push(`  Case sensitive: ${match.caseSensitive ? "Yes" : "No"}`);
                lines.push(`  Matches: ${match.matchCount}`);
                lines.push(`  Source indexes: group ${match.sourceGroupIndex}, rule ${match.sourceRuleIndex}`);
                lines.push("");
            }
        }
        if (state.conflicts.length) {
            lines.push("CONFLICTS");
            state.conflicts.forEach((cluster, index) => {
                lines.push(`${index + 1}. ${cluster.search}`);
                cluster.members.forEach((member) => {
                    lines.push(`   ${member.groupName} — ${member.search} → ${member.replacement}`);
                });
            });
        }
        if (state.ruleErrors.length) {
            lines.push("", "RULE ERRORS");
            state.ruleErrors.forEach((error) => {
                lines.push(`${error.groupName}, rule ${error.ruleIndex + 1}: ${error.message}`);
            });
        }
        return lines.join("\n");
    }
    async function copyGridText(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
            const area = document.createElement("textarea");
            area.value = text;
            area.style.position = "fixed";
            area.style.opacity = "0";
            document.body.appendChild(area);
            area.select();
            const copied = document.execCommand("copy");
            area.remove();
            return copied;
        } catch (error) {
            console.warn("[FR Debug] Grid copy failed:", error);
            return false;
        }
    }
    async function copyResults() {
        const text = buildCopyText();
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
            } else {
                const area = document.createElement("textarea");
                area.value = text;
                area.style.position = "fixed";
                area.style.opacity = "0";
                document.body.appendChild(area);
                area.select();
                const copied = document.execCommand("copy");
                area.remove();
                if (!copied) throw new Error("Clipboard copy was not available.");
            }
            state.status = "Analysis results copied to clipboard.";
        } catch (error) {
            state.status = `Copy failed: ${error.message}`;
        }
        renderDebug();
    }
    function createElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = String(text);
        return element;
    }
    function createButton(label, callback, className = "") {
        const button = createElement("button", className, label);
        button.type = "button";
        button.addEventListener("click", callback);
        return button;
    }
    function appendField(parent, label, value) {
        const wrapper = createElement("div", "frd-field");
        const heading = createElement("strong", "", label);
        const content = createElement("div", "frd-value", value);
        wrapper.append(heading, content);
        parent.appendChild(wrapper);
    }
    function installDebugStyles() {
        if (document.getElementById("fr-debug-styles")) return;
        const style = document.createElement("style");
        style.id = "fr-debug-styles";
        style.textContent = `
            #fr-debug-panel {
                position: fixed;
                z-index: 2147483646;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
                min-width: 420px;
                min-height: 220px;
                max-width: 95vw;
                max-height: 95vh;
                width: 900px;
                height: 600px;
                background: #202124;
                color: #e8eaed;
                border: 1px solid #5f6368;
                border-radius: 8px;
                box-shadow: 0 8px 30px rgba(0,0,0,.45);
                font: 13px/1.45 Arial, sans-serif;
                overflow: hidden;
                resize: both;
            }
            #fr-debug-panel * {
                box-sizing: border-box;
            }
            #fr-debug-panel button {
                border: 1px solid #5f6368;
                border-radius: 4px;
                padding: 6px 10px;
                background: #303134;
                color: #f1f3f4;
                cursor: pointer;
                font: inherit;
            }
            #fr-debug-panel button:hover {
                background: #45474a;
            }
            #fr-debug-panel button:focus-visible {
                outline: 2px solid #8ab4f8;
                outline-offset: 2px;
            }
            #fr-debug-panel .frd-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 10px 12px;
                background: #292a2d;
                border-bottom: 1px solid #5f6368;
                cursor: move;
                user-select: none;
            }
            #fr-debug-panel .frd-title {
                font-size: 15px;
                font-weight: bold;
            }
            #fr-debug-panel .frd-header-actions {
                display: flex;
                gap: 6px;
            }
            #fr-debug-panel .frd-toolbar {
                display: flex;
                flex-wrap: wrap;
                gap: 7px;
                padding: 9px 12px;
                border-bottom: 1px solid #5f6368;
            }
            #fr-debug-panel .frd-status {
                padding: 8px 12px;
                color: #bdc1c6;
                border-bottom: 1px solid #45474a;
                overflow-wrap: anywhere;
            }
            #fr-debug-panel .frd-content {
                flex: 1;
                min-height: 0;
                overflow: auto;
                padding: 12px;
            }
            #fr-debug-panel .frd-tabs {
                display: flex;
                gap: 6px;
                margin-bottom: 12px;
            }
            #fr-debug-panel .frd-tab-active {
                background: #174ea6 !important;
                border-color: #8ab4f8 !important;
            }
            #fr-debug-panel .frd-card {
                margin-bottom: 12px;
                padding: 11px;
                border: 1px solid #5f6368;
                border-radius: 6px;
                background: #292a2d;
            }
            #fr-debug-panel .frd-card-title {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 9px;
                font-weight: bold;
                overflow-wrap: anywhere;
            }
            #fr-debug-panel .frd-rule {
                margin-top: 9px;
                padding: 10px;
                border-left: 3px solid #8ab4f8;
                background: #202124;
                overflow-wrap: anywhere;
            }
            #fr-debug-panel .frd-field {
                margin-top: 6px;
            }
            #fr-debug-panel .frd-field strong {
                display: block;
                color: #9aa0a6;
                margin-bottom: 2px;
            }
            #fr-debug-panel .frd-value {
                white-space: pre-wrap;
                overflow-wrap: anywhere;
                user-select: text;
            }
            #fr-debug-panel .frd-muted {
                color: #9aa0a6;
            }
            #fr-debug-panel .frd-error {
                border-left: 3px solid #f28b82;
                padding: 8px 10px;
                margin: 7px 0;
                background: #332626;
                overflow-wrap: anywhere;
            }
            #fr-debug-panel .frd-empty {
                padding: 18px;
                text-align: center;
                color: #9aa0a6;
                border: 1px dashed #5f6368;
                border-radius: 6px;
            }
            #fr-debug-panel .frd-count {
                color: #9aa0a6;
                font-weight: normal;
            }
            #fr-debug-panel .frd-url {
                margin-top: 5px;
                color: #9aa0a6;
                overflow-wrap: anywhere;
            }
                        /* WNC-style spreadsheet */
            #fr-debug-panel .frd-grid-toolbar {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 7px;
                margin-bottom: 8px;
            }
            #fr-debug-panel .frd-grid-search {
                flex: 1;
                min-width: 180px;
                padding: 6px 8px;
                border: 1px solid #555;
                border-radius: 3px;
                background: #181818;
                color: #eee;
                font: inherit;
            }
            #fr-debug-panel .frd-grid-count {
                color: #aaa;
                white-space: nowrap;
            }
            #fr-debug-panel .frd-grid-wrap {
                width: 100%;
                height: 100%;
                overflow: auto;
                border: 1px solid #555;
                background: #202124;
            }
            #fr-debug-panel .frd-spreadsheet {
                width: max-content;
                min-width: 100%;
                border-collapse: collapse;
                table-layout: fixed;
                font-size: 12px;
            }
            #fr-debug-panel .frd-spreadsheet th,
            #fr-debug-panel .frd-spreadsheet td {
                position: relative;
                padding: 3px 5px;
                border: 1px solid #484848;
                text-align: left;
                vertical-align: middle;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                height: 29px;
            }
            #fr-debug-panel .frd-spreadsheet thead th {
                position: sticky;
                top: 0;
                z-index: 5;
                background: #292929;
                color: #eee;
                font-weight: bold;
                user-select: none;
            }
            #fr-debug-panel .frd-spreadsheet thead tr.frd-filter-row th {
                top: 29px;
                z-index: 4;
                padding: 2px;
                background: #242424;
            }
            #fr-debug-panel .frd-spreadsheet th.frd-sortable {
                cursor: pointer;
            }
            #fr-debug-panel .frd-spreadsheet th.frd-sortable:hover {
                background: #3a3a3a;
            }
            #fr-debug-panel .frd-spreadsheet .frd-filter {
                width: 100%;
                min-width: 55px;
                padding: 3px 4px;
                border: 1px solid #555;
                border-radius: 2px;
                background: #181818;
                color: #eee;
                font: inherit;
            }
            #fr-debug-panel .frd-spreadsheet td input,
            #fr-debug-panel .frd-spreadsheet td select {
                width: 100%;
                min-width: 0;
                padding: 2px 4px;
                border: 1px solid #555;
                background: #181818;
                color: #eee;
                font: inherit;
            }
            #fr-debug-panel .frd-spreadsheet tbody tr:nth-child(even) {
                background: #252525;
            }
            #fr-debug-panel .frd-spreadsheet tbody tr:hover {
                background: #343a40;
            }
            #fr-debug-panel .frd-spreadsheet tbody tr.frd-selected {
                background: #263b55;
                outline: 1px solid #8ab4f8;
            }
            #fr-debug-panel .frd-spreadsheet tbody tr.frd-conflict {
                box-shadow: inset 3px 0 #f6c344;
            }
            #fr-debug-panel .frd-spreadsheet tbody tr.frd-error-row {
                box-shadow: inset 3px 0 #f28b82;
            }
            #fr-debug-panel .frd-spreadsheet td.frd-conflict-cell {
                background: #493d20;
                color: #ffe09a;
            }
            #fr-debug-panel .frd-spreadsheet td.frd-error-cell {
                background: #482b2b;
                color: #ffb4ab;
            }
            #fr-debug-panel .frd-spreadsheet .frd-row-number {
                width: 42px;
                text-align: center;
                color: #aaa;
            }
            #fr-debug-panel .frd-column-resizer {
                position: absolute;
                top: 0;
                right: 0;
                width: 5px;
                height: 100%;
                cursor: col-resize;
                user-select: none;
            }
            #fr-debug-panel .frd-column-resizer:hover {
                background: #8ab4f8;
            }
            #fr-debug-panel .frd-grid-empty {
                padding: 24px;
                color: #aaa;
                text-align: center;
            }
            #fr-debug-panel .frd-grid-tabs {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                margin-bottom: 8px;
            }
            #fr-debug-panel .frd-grid-tabs button.frd-tab-active {
                background: #174ea6;
                border-color: #8ab4f8;
            }
            #fr-debug-panel .frd-grid-status {
                margin-bottom: 7px;
                color: #aaa;
                font-size: 11px;
            }
        `;
        document.head.appendChild(style);
    }
    function createDebugPanel() {
        if (state.panel && state.panel.isConnected) return;
        installDebugStyles();
        const panel = createElement("section");
        panel.id = "fr-debug-panel";
        panel.style.width = `${state.settings.width}px`;
        panel.style.height = `${state.settings.height}px`;
        panel.style.left = `${state.settings.left}px`;
        panel.style.top = `${state.settings.top}px`;
        const header = createElement("div", "frd-header");
        const title = createElement("div", "frd-title", "FR Debug");
        const headerActions = createElement("div", "frd-header-actions");
        const minimizeButton = createButton("Minimize", () => {
            state.settings.minimized = !state.settings.minimized;
            saveSettings();
            renderDebug();
        });
        const closeButton = createButton("Close", closeDebugPanel);
        headerActions.append(minimizeButton, closeButton);
        header.append(title, headerActions);
        const toolbar = createElement("div", "frd-toolbar");
        const importButton = createButton("Import FoxReplace JSON", openImportPicker);
        const analyzeButton = createButton("Analyze Page", analyzeDebugPage);
        const copyButton = createButton("Copy Results", copyResults);
        toolbar.append(importButton, analyzeButton, copyButton);
        const status = createElement("div", "frd-status");
        const content = createElement("div", "frd-content");
        panel.append(header, toolbar, status, content);
        document.body.appendChild(panel);
        state.panel = panel;
        // Correct saved coordinates if the browser window has changed size.
        const initialRect = panel.getBoundingClientRect();
        const initialLeft = Math.max(
            0,
            Math.min(window.innerWidth - Math.min(initialRect.width, 80), initialRect.left)
        );
        const initialTop = Math.max(
            0,
            Math.min(window.innerHeight - Math.min(initialRect.height, 40), initialRect.top)
        );
        panel.style.left = `${initialLeft}px`;
        panel.style.top = `${initialTop}px`;
        state.settings.left = Math.round(initialLeft);
        state.settings.top = Math.round(initialTop);
        saveSettings();
        let drag = null;
        header.addEventListener("pointerdown", (event) => {
            if (event.target.closest("button")) return;
            if (event.button !== 0) return;
            const rect = panel.getBoundingClientRect();
            drag = {
                pointerX: event.clientX,
                pointerY: event.clientY,
                left: rect.left,
                top: rect.top
            };
            header.setPointerCapture(event.pointerId);
        });
        header.addEventListener("pointermove", (event) => {
            if (!drag) return;
            const rect = panel.getBoundingClientRect();
            const left = Math.max(
                0,
                Math.min(window.innerWidth - Math.min(rect.width, 80), drag.left + event.clientX - drag.pointerX)
            );
            const top = Math.max(
                0,
                Math.min(window.innerHeight - Math.min(rect.height, 40), drag.top + event.clientY - drag.pointerY)
            );
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
        });
        function stopDragging() {
            if (!drag) return;
            drag = null;
            const rect = panel.getBoundingClientRect();
            state.settings.left = Math.round(rect.left);
            state.settings.top = Math.round(rect.top);
            saveSettings();
        }
        header.addEventListener("pointerup", stopDragging);
        header.addEventListener("pointercancel", stopDragging);
        header.addEventListener("lostpointercapture", stopDragging);
        // Save dimensions only while expanded.
        if (typeof ResizeObserver === "function") {
            const observer = new ResizeObserver(() => {
                if (!panel.isConnected || state.settings.minimized) return;
                const rect = panel.getBoundingClientRect();
                if (rect.width > 0 && rect.height > 0) {
                    state.settings.width = Math.round(rect.width);
                    state.settings.height = Math.round(rect.height);
                    saveSettings();
                }
            });
            observer.observe(panel);
        }
        renderDebug();
    }
    function closeDebugPanel() {
        if (state.panel) {
            state.panel.remove();
            state.panel = null;
        }
    }
    function toggleDebugPanel() {
        if (state.panel && state.panel.isConnected) {
            closeDebugPanel();
        } else {
            createDebugPanel();
        }
    }
    const GRID_COLUMNS = [
        { key: "group", label: "Group", width: 135 },
        { key: "search", label: "Search / Find", width: 240 },
        { key: "replacement", label: "Replacement", width: 240 },
        { key: "inputType", label: "Input Type", width: 95 },
        { key: "outputType", label: "Output Type", width: 95 },
        { key: "caseSensitive", label: "Case", width: 65 },
        { key: "enabled", label: "Enabled", width: 65 },
        { key: "matches", label: "Matches", width: 65 },
        { key: "conflict", label: "Conflict", width: 85 },
        { key: "source", label: "Source Index", width: 115 },
        { key: "error", label: "Error", width: 220 }
    ];
    function gridRowId(groupIndex, ruleIndex) {
        return `${groupIndex}:${ruleIndex}`;
    }
    function getAllGridRows() {
        const matches = new Map();
        const errors = new Map();
        const conflicts = new Map();
        state.matchingRules.forEach((match) => {
            matches.set(gridRowId(match.sourceGroupIndex, match.sourceRuleIndex), match);
        });
        state.ruleErrors.forEach((error) => {
            errors.set(gridRowId(error.groupIndex, error.ruleIndex), error.message);
        });
        state.conflicts.forEach((cluster) => {
            cluster.members.forEach((member) => {
                const id = gridRowId(member.sourceGroupIndex, member.sourceRuleIndex);
                conflicts.set(id, cluster.id);
            });
        });
        const rows = [];
        state.database.groups.forEach((group, groupIndex) => {
            group.rules.forEach((rule, ruleIndex) => {
                const id = gridRowId(groupIndex, ruleIndex);
                const match = matches.get(id);
                const error = errors.get(id) || (Array.isArray(rule.errors) ? rule.errors.join(" ") : "");
                rows.push({
                    id,
                    groupIndex,
                    ruleIndex,
                    group: group.name,
                    search: rule.input,
                    replacement: rule.output,
                    inputType: rule.inputType,
                    outputType: rule.outputType,
                    caseSensitive: rule.caseSensitive ? "Yes" : "No",
                    enabled: rule.enabled !== false && group.enabled !== false ? "Yes" : "No",
                    matches: match ? match.matchCount : 0,
                    conflict: conflicts.has(id) ? "Conflict" : "",
                    conflictId: conflicts.get(id) || "",
                    source: `G${groupIndex + 1} / R${ruleIndex + 1}`,
                    error: error || "",
                    matched: Boolean(match),
                    valid: rule.valid !== false,
                    groupObject: group,
                    ruleObject: rule
                });
            });
        });
        return rows;
    }
    function getVisibleGridRows() {
        let rows = getAllGridRows();
        if (state.activeTab === "groups") {
            rows = rows.filter((row) => row.matched);
        } else if (state.activeTab === "conflicts") {
            rows = rows.filter((row) => Boolean(row.conflict));
        } else if (state.activeTab === "errors") {
            rows = rows.filter((row) => Boolean(row.error));
        }
        const globalSearch = state.gridSearch.trim().toLocaleLowerCase();
        if (globalSearch) {
            rows = rows.filter((row) =>
                GRID_COLUMNS.some((column) =>
                    String(row[column.key] ?? "")
                        .toLocaleLowerCase()
                        .includes(globalSearch)
                )
            );
        }
        Object.entries(state.gridFilters).forEach(([key, value]) => {
            const filter = String(value || "")
                .trim()
                .toLocaleLowerCase();
            if (!filter) return;
            rows = rows.filter((row) =>
                String(row[key] ?? "")
                    .toLocaleLowerCase()
                    .includes(filter)
            );
        });
        const sort = state.gridSort;
        if (sort && sort.column) {
            const direction = sort.direction === "desc" ? -1 : 1;
            rows.sort((a, b) => {
                const first = a[sort.column];
                const second = b[sort.column];
                if (typeof first === "number" && typeof second === "number") {
                    return (first - second) * direction;
                }
                return (
                    String(first ?? "").localeCompare(String(second ?? ""), undefined, {
                        numeric: true,
                        sensitivity: "base"
                    }) * direction
                );
            });
        }
        return rows;
    }
    function setGridSort(column) {
        if (state.gridSort.column === column) {
            state.gridSort.direction = state.gridSort.direction === "asc" ? "desc" : "asc";
        } else {
            state.gridSort = {
                column,
                direction: "asc"
            };
        }
        renderDebug();
    }
    function selectGridRow(row, event) {
        const id = row.dataset.rowId;
        const visibleRows = getVisibleGridRows();
        const clickedIndex = visibleRows.findIndex((item) => item.id === id);
        if (event.shiftKey && state.lastSelectedRow) {
            const previousIndex = visibleRows.findIndex((item) => item.id === state.lastSelectedRow);
            if (!event.ctrlKey && !event.metaKey) {
                state.selectedRows.clear();
            }
            if (previousIndex !== -1 && clickedIndex !== -1) {
                const start = Math.min(previousIndex, clickedIndex);
                const end = Math.max(previousIndex, clickedIndex);
                for (let i = start; i <= end; i++) {
                    state.selectedRows.add(visibleRows[i].id);
                }
            }
        } else if (event.ctrlKey || event.metaKey) {
            if (state.selectedRows.has(id)) {
                state.selectedRows.delete(id);
            } else {
                state.selectedRows.add(id);
            }
            state.lastSelectedRow = id;
        } else {
            state.selectedRows.clear();
            state.selectedRows.add(id);
            state.lastSelectedRow = id;
        }
        renderDebug();
    }
    function addGridColumnResizer(th, column) {
        const resizer = createElement("span", "frd-column-resizer");
        resizer.title = "Drag to resize column";
        resizer.addEventListener("pointerdown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const startX = event.clientX;
            const startWidth = th.getBoundingClientRect().width;
            resizer.setPointerCapture(event.pointerId);
            function move(moveEvent) {
                const width = Math.max(55, Math.round(startWidth + moveEvent.clientX - startX));
                state.settings.columnWidths[column.key] = width;
                th.style.width = `${width}px`;
                const table = th.closest("table");
                const index = Array.from(th.parentElement.children).indexOf(th);
                table.querySelectorAll("tr").forEach((row) => {
                    const cell = row.children[index];
                    if (cell) cell.style.width = `${width}px`;
                });
            }
            function stop() {
                resizer.removeEventListener("pointermove", move);
                resizer.removeEventListener("pointerup", stop);
                resizer.removeEventListener("pointercancel", stop);
                saveSettings();
            }
            resizer.addEventListener("pointermove", move);
            resizer.addEventListener("pointerup", stop);
            resizer.addEventListener("pointercancel", stop);
        });
        th.appendChild(resizer);
    }
    function createGridCell(value, className = "") {
        const cell = createElement("td", className);
        cell.textContent = value === undefined || value === null ? "" : String(value);
        cell.title = cell.textContent;
        return cell;
    }
    function renderSpreadsheet(content) {
        const allRows = getAllGridRows();
        const rows = getVisibleGridRows();
        const tabs = createElement("div", "frd-grid-tabs");
        const views = [
            ["all", "All Rules"],
            ["groups", "Matched Rules"],
            ["conflicts", `Conflicts (${state.conflicts.length})`],
            ["errors", `Errors (${state.ruleErrors.length})`]
        ];
        views.forEach(([key, label]) => {
            const button = createButton(label, () => {
                state.activeTab = key;
                state.selectedRows.clear();
                renderDebug();
            });
            if (state.activeTab === key) {
                button.classList.add("frd-tab-active");
            }
            tabs.appendChild(button);
        });
        content.appendChild(tabs);
        const toolbar = createElement("div", "frd-grid-toolbar");
        const search = createElement("input", "frd-grid-search");
        search.type = "search";
        search.placeholder = "Search all columns...";
        search.value = state.gridSearch;
        search.addEventListener("input", () => {
            state.gridSearch = search.value;
            renderDebug();
        });
        const count = createElement("span", "frd-grid-count", `${rows.length} of ${allRows.length} rules`);
        const clear = createButton("Clear Filters", () => {
            state.gridSearch = "";
            state.gridFilters = {};
            renderDebug();
        });
        const copySelected = createButton("Copy Selected Rows", () => {
            const selected = getVisibleGridRows().filter((row) => state.selectedRows.has(row.id));
            if (!selected.length) {
                state.status = "Select one or more rows first.";
                renderDebug();
                return;
            }
            const headings = GRID_COLUMNS.map((column) => column.label);
            const lines = selected.map((row) =>
                GRID_COLUMNS.map((column) => String(row[column.key] ?? "").replace(/\t/g, " ")).join("\t")
            );
            const text = [headings.join("\t"), ...lines].join("\n");
            copyGridText(text).then((success) => {
                state.status = success ? `Copied ${selected.length} selected rows.` : "Could not copy selected rows.";
                renderDebug();
            });
        });
        toolbar.append(search, count, clear, copySelected);
        content.appendChild(toolbar);
        const gridStatus = createElement(
            "div",
            "frd-grid-status",
            "Select rows with click. Use Ctrl-click or Shift-click for multiple rows. Click headers to sort; drag header edges to resize."
        );
        content.appendChild(gridStatus);
        const wrapper = createElement("div", "frd-grid-wrap");
        const table = createElement("table", "frd-spreadsheet");
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        const numberHeader = createElement("th", "frd-row-number", "#");
        headerRow.appendChild(numberHeader);
        GRID_COLUMNS.forEach((column) => {
            const th = createElement(
                "th",
                "frd-sortable",
                column.label +
                    (state.gridSort.column === column.key ? (state.gridSort.direction === "asc" ? " ▲" : " ▼") : "")
            );
            const width = Number(state.settings.columnWidths[column.key]) || column.width;
            th.style.width = `${width}px`;
            th.style.minWidth = `${width}px`;
            th.addEventListener("click", (event) => {
                if (event.target.classList.contains("frd-column-resizer")) return;
                setGridSort(column.key);
            });
            addGridColumnResizer(th, column);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        const filterRow = createElement("tr", "frd-filter-row");
        filterRow.appendChild(createElement("th", "frd-row-number", ""));
        GRID_COLUMNS.forEach((column) => {
            const th = document.createElement("th");
            const input = createElement("input", "frd-filter");
            input.type = "search";
            input.placeholder = "Filter";
            input.value = state.gridFilters[column.key] || "";
            input.addEventListener("change", () => {
                state.gridFilters[column.key] = input.value;
                renderDebug();
            });
            th.appendChild(input);
            filterRow.appendChild(th);
        });
        thead.appendChild(filterRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        rows.forEach((rowData, index) => {
            const row = document.createElement("tr");
            row.dataset.rowId = rowData.id;
            if (state.selectedRows.has(rowData.id)) {
                row.classList.add("frd-selected");
            }
            if (rowData.conflict) row.classList.add("frd-conflict");
            if (rowData.error) row.classList.add("frd-error-row");
            row.addEventListener("click", (event) => {
                selectGridRow(row, event);
            });
            const numberCell = createGridCell(index + 1, "frd-row-number");
            row.appendChild(numberCell);
            GRID_COLUMNS.forEach((column) => {
                const value = rowData[column.key];
                const cell = createGridCell(value);
                if (column.key === "conflict" && value) {
                    cell.classList.add("frd-conflict-cell");
                }
                if (column.key === "error" && value) {
                    cell.classList.add("frd-error-cell");
                }
                row.appendChild(cell);
            });
            tbody.appendChild(row);
        });
        if (!rows.length) {
            const emptyRow = document.createElement("tr");
            const emptyCell = createElement(
                "td",
                "frd-grid-empty",
                state.imported ? "No rules match this view or filter." : "Import a FoxReplace JSON file to begin."
            );
            emptyCell.colSpan = GRID_COLUMNS.length + 1;
            emptyRow.appendChild(emptyCell);
            tbody.appendChild(emptyRow);
        }
        table.appendChild(tbody);
        wrapper.appendChild(table);
        content.appendChild(wrapper);
    }
    function renderGroupsTab(content) {
        if (!state.imported) {
            content.appendChild(
                createElement(
                    "div",
                    "frd-empty",
                    "No FoxReplace database imported. Use Import FoxReplace JSON to begin."
                )
            );
            return;
        }
        if (!state.groupMatches.length) {
            content.appendChild(
                createElement("div", "frd-empty", "No enabled, eligible FoxReplace rules matched this page.")
            );
            return;
        }
        state.groupMatches.forEach((group) => {
            const card = createElement("div", "frd-card");
            const heading = createElement("div", "frd-card-title");
            const title = createElement("span", "", `${group.name} (${group.rules.length} matched rules)`);
            const collapsed = state.collapsedGroups.has(group.groupIndex);
            const toggle = createButton(collapsed ? "Expand" : "Collapse", () => {
                if (collapsed) {
                    state.collapsedGroups.delete(group.groupIndex);
                } else {
                    state.collapsedGroups.add(group.groupIndex);
                }
                renderDebug();
            });
            heading.append(title, toggle);
            card.appendChild(heading);
            const urls = Array.isArray(group.group.urls) ? group.group.urls : [];
            if (urls.length) {
                card.appendChild(createElement("div", "frd-url", `URL patterns: ${urls.join(", ")}`));
            }
            if (!collapsed) {
                group.rules.forEach((match) => {
                    const ruleBox = createElement("div", "frd-rule");
                    appendField(ruleBox, "Search / original input", match.search);
                    appendField(ruleBox, "Replacement / original output", match.replacement);
                    appendField(ruleBox, "Input type", match.inputType);
                    appendField(ruleBox, "Output type", match.outputType);
                    appendField(ruleBox, "Case sensitive", match.caseSensitive ? "Yes" : "No");
                    appendField(ruleBox, "Match count", match.matchCount);
                    appendField(
                        ruleBox,
                        "Source indexes",
                        `Group ${match.sourceGroupIndex}, rule ${match.sourceRuleIndex}`
                    );
                    card.appendChild(ruleBox);
                });
            }
            content.appendChild(card);
        });
    }
    function renderConflictsTab(content) {
        if (!state.imported) {
            content.appendChild(
                createElement("div", "frd-empty", "Import a FoxReplace JSON file before checking conflicts.")
            );
            return;
        }
        if (!state.conflicts.length) {
            content.appendChild(
                createElement("div", "frd-empty", "No conflicts found among the rules that matched this page.")
            );
            return;
        }
        state.conflicts.forEach((cluster, index) => {
            const card = createElement("div", "frd-card");
            card.appendChild(
                createElement("div", "frd-card-title", `Conflict ${index + 1} — ${cluster.members.length} rules`)
            );
            appendField(card, "Normalized search target", cluster.normalizedSearch);
            cluster.members.forEach((member) => {
                const ruleBox = createElement("div", "frd-rule");
                appendField(ruleBox, "Group", member.groupName);
                appendField(ruleBox, "Search", member.search);
                appendField(ruleBox, "Replacement", member.replacement);
                appendField(ruleBox, "Input type", member.inputType);
                appendField(ruleBox, "Output type", member.outputType);
                appendField(ruleBox, "Case sensitive", member.caseSensitive ? "Yes" : "No");
                appendField(ruleBox, "Match count", member.matchCount);
                appendField(
                    ruleBox,
                    "Source indexes",
                    `Group ${member.sourceGroupIndex}, rule ${member.sourceRuleIndex}`
                );
                card.appendChild(ruleBox);
            });
            content.appendChild(card);
        });
    }
    function renderRuleErrors(content) {
        if (!state.ruleErrors.length) return;
        const card = createElement("div", "frd-card");
        card.appendChild(createElement("div", "frd-card-title", `Rule errors (${state.ruleErrors.length})`));
        state.ruleErrors.forEach((error) => {
            const item = createElement("div", "frd-error");
            item.textContent =
                `${error.groupName}, rule ${error.ruleIndex + 1}: ` + `${error.message} Search: ${error.search}`;
            card.appendChild(item);
        });
        content.appendChild(card);
    }
    function renderDebug() {
        if (!state.panel || !state.panel.isConnected) {
            createDebugPanel();
            return;
        }
        const panel = state.panel;
        const status = panel.querySelector(".frd-status");
        const content = panel.querySelector(".frd-content");
        const minimizeButton = panel.querySelector(".frd-header-actions button");
        const toolbar = panel.querySelector(".frd-toolbar");
        if (status) {
            status.textContent = state.status;
        }
        if (minimizeButton) {
            minimizeButton.textContent = state.settings.minimized ? "Restore" : "Minimize";
        }
        if (state.settings.minimized) {
            panel.style.height = "auto";
            panel.style.resize = "none";
            if (content) content.style.display = "none";
            if (toolbar) toolbar.style.display = "none";
            return;
        }
        panel.style.width = `${state.settings.width}px`;
        panel.style.height = `${state.settings.height}px`;
        panel.style.resize = "both";
        if (toolbar) toolbar.style.display = "flex";
        if (!content) return;
        content.style.display = "flex";
        content.style.flexDirection = "column";
        content.replaceChildren();
        renderSpreadsheet(content);
    }
    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== "function") return;
        GM_registerMenuCommand("FR Debug: Open / Close Panel", toggleDebugPanel);
        GM_registerMenuCommand("FR Debug: Import FoxReplace JSON", () => {
            if (!state.panel || !state.panel.isConnected) {
                createDebugPanel();
            }
            openImportPicker();
        });
        GM_registerMenuCommand("FR Debug: Analyze Current Page", () => {
            if (!state.panel || !state.panel.isConnected) {
                createDebugPanel();
            }
            analyzeDebugPage();
        });
    }
    function initializeDebug() {
        loadSettings();
        loadDatabase();
        installDebugStyles();
        registerMenuCommands();
        createDebugPanel();
        if (state.imported) {
            state.status =
                `Restored ${state.database.groups.length} saved FoxReplace groups. ` +
                "Run Analyze Page to check the current page.";
            renderDebug();
        }
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeDebug, { once: true });
    } else {
        initializeDebug();
    }
})();
