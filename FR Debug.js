// ==UserScript==
// @name         FR Debug
// @namespace    https://github.com/FRDebug
// @version      2.1.0
// @description  Independently analyze FoxReplace rules and visible page values against the current page.
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
    const LIMITS = {
        groups: 500,
        rules: 5000,
        pageTextChars: 2_000_000,
        regexLength: 1000,
        matchesPerRule: 5000,
        columnWidth: 1200
    };
    const EXCLUDED_TAGS = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "TEMPLATE",
        "NAV",
        "HEADER",
        "FOOTER",
        "ASIDE",
        "BUTTON",
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
    const EMPTY_DATABASE = {
        format: "foxreplace",
        version: null,
        groups: []
    };
    let gridRenderTimer = null;
    let resizeSaveTimer = null;
    const state = {
        settings: { ...DEFAULT_SETTINGS },
        database: cloneJSON(EMPTY_DATABASE),
        pageText: "",
        matchingRules: [],
        allMatchedRules: [],
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
        resizeObserver: null,
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
            width: validNumber(settings.width, DEFAULT_SETTINGS.width, 320, 10000),
            height: validNumber(settings.height, DEFAULT_SETTINGS.height, 220, 10000),
            left: validNumber(settings.left, DEFAULT_SETTINGS.left, 0, 10000),
            top: validNumber(settings.top, DEFAULT_SETTINGS.top, 0, 10000),
            minimized: settings.minimized === true,
            columnWidths: Object.fromEntries(
                Object.entries(
                    settings.columnWidths && typeof settings.columnWidths === "object" ? settings.columnWidths : {}
                )
                    .filter(([key]) =>
                        [
                            "group",
                            "search",
                            "replacement",
                            "inputType",
                            "outputType",
                            "caseSensitive",
                            "enabled",
                            "matches",
                            "conflict",
                            "source",
                            "error"
                        ].includes(key)
                    )
                    .map(([key, value]) => {
                        const width = Number(value);
                        return [key, Number.isFinite(width) ? Math.min(LIMITS.columnWidth, Math.max(55, width)) : 120];
                    })
            )
        };
    }
    function saveSettings() {
        storageSet(STORAGE.settings, state.settings);
    }
    function validateStoredDatabase(saved) {
        if (!saved || typeof saved !== "object" || !Array.isArray(saved.groups)) {
            throw new Error("Saved database has an invalid structure.");
        }
        if (saved.groups.length > LIMITS.groups) throw new Error(`Saved database exceeds ${LIMITS.groups} groups.`);
        let totalRules = 0;
        const groups = saved.groups.map((group, groupIndex) => {
            if (!group || typeof group !== "object" || Array.isArray(group)) {
                throw new Error(`Saved group ${groupIndex + 1} is invalid.`);
            }
            const source =
                group.original && Array.isArray(group.original.substitutions)
                    ? group.original
                    : {
                          name: group.name,
                          urls: group.urls,
                          enabled: group.enabled,
                          html: group.html,
                          mode: group.mode,
                          substitutions: Array.isArray(group.rules)
                              ? group.rules.map((rule) => ({
                                    input: rule && rule.input,
                                    output: rule && rule.output,
                                    inputType: rule && rule.inputType,
                                    outputType: rule && rule.outputType,
                                    caseSensitive: rule && rule.caseSensitive,
                                    enabled: rule && rule.enabled
                                }))
                              : []
                      };
            if (!Array.isArray(source.substitutions))
                throw new Error(`Saved group ${groupIndex + 1} has no rules array.`);
            totalRules += source.substitutions.length;
            if (totalRules > LIMITS.rules) throw new Error(`Saved database exceeds ${LIMITS.rules} rules.`);
            return normalizeImportedGroup(source, groupIndex);
        });
        return { format: "foxreplace", version: saved.version ?? null, original: saved.original || null, groups };
    }
    function loadDatabase() {
        const saved = storageGet(STORAGE.database, null);
        if (!saved) return;
        try {
            state.database = validateStoredDatabase(saved);
            state.imported = state.database.groups.length > 0;
            state.status = `Loaded and validated ${state.database.groups.length} saved FoxReplace groups.`;
        } catch (error) {
            state.database = cloneJSON(EMPTY_DATABASE);
            state.imported = false;
            state.status = `Saved database rejected: ${error.message}. Please re-import the JSON file.`;
            console.warn("[FR Debug] Saved database validation failed:", error);
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
        if (!sourceRule || typeof sourceRule !== "object" || Array.isArray(sourceRule)) {
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
        if (!["text", "html"].includes(outputType)) {
            errors.push(`Unsupported output type: ${outputType}`);
        }
        if (input.length > LIMITS.regexLength) {
            errors.push(`Search input exceeds ${LIMITS.regexLength} characters.`);
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
        if (parsed.groups.length > LIMITS.groups) throw new Error(`The file exceeds ${LIMITS.groups} groups.`);
        const ruleCount = parsed.groups.reduce(
            (total, group) => total + (group && Array.isArray(group.substitutions) ? group.substitutions.length : 0),
            0
        );
        if (ruleCount > LIMITS.rules) throw new Error(`The file exceeds ${LIMITS.rules} rules.`);
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
        // Clear results from the previous import.
        state.pageText = "";
        state.matchingRules = [];
        state.allMatchedRules = [];
        state.groupMatches = [];
        state.conflicts = [];
        state.ruleErrors = [];
        // Clear old selections and filters.
        state.gridSearch = "";
        state.gridFilters = {};
        state.selectedRows.clear();
        state.lastSelectedRow = null;
        state.collapsedGroups.clear();
        state.lastAnalysis = null;
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
    function isExcludedElement(element) {
        if (!(element instanceof Element)) return false;
        if (EXCLUDED_TAGS.has(element.tagName)) return true;
        if (element.id === "fr-debug-panel" || element.closest("#fr-debug-panel, [data-fr-debug]")) {
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
            style.opacity === "0" ||
            style.contentVisibility === "hidden"
        );
    }
    function extractPageText() {
        if (!document.body) return "";
        const chunks = [];
        let collectedLength = 0;
        const add = (value) => {
            if (collectedLength >= LIMITS.pageTextChars) return false;
            const text = String(value || "");
            const remaining = LIMITS.pageTextChars - collectedLength;
            const part = text.length > remaining ? text.slice(0, remaining) : text;
            chunks.push(part);
            collectedLength += part.length;
            return collectedLength < LIMITS.pageTextChars;
        };
        const walk = (root) => {
            for (const node of root.childNodes) {
                if (collectedLength >= LIMITS.pageTextChars) return;
                if (node.nodeType === Node.TEXT_NODE) {
                    add(node.nodeValue || "");
                    continue;
                }
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const element = node;
                if (isExcludedElement(element)) continue;
                const tag = element.tagName;
                const block = BLOCK_TAGS.has(tag);
                if (block || tag === "BR" || tag === "HR") add("\n");
                if (tag === "INPUT") {
                    const type = (element.type || "text").toLowerCase();
                    if (!["password", "hidden", "file", "submit", "button", "reset", "image"].includes(type)) {
                        if (["checkbox", "radio"].includes(type)) {
                            if (element.checked) add(` ${element.value || "checked"} `);
                        } else if (element.value) add(` ${element.value} `);
                    }
                } else if (tag === "TEXTAREA" && element.value) {
                    add(` ${element.value} `);
                } else if (tag === "SELECT") {
                    const selected = Array.from(element.selectedOptions || [])
                        .map((option) => option.label || option.textContent || option.value)
                        .filter(Boolean);
                    if (selected.length) add(` ${selected.join(" ")} `);
                }
                if (tag === "TEXTAREA" || tag === "SELECT") continue;
                if (element.getAttribute("alt")) add(` ${element.getAttribute("alt")} `);
                if (element.isContentEditable && element.getAttribute("aria-label"))
                    add(` ${element.getAttribute("aria-label")} `);
                walk(element);
                if (block || tag === "BR" || tag === "HR") add("\n");
            }
        };
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
                // Reject common catastrophic-backtracking structures before running on page text.
                if (input.length > LIMITS.regexLength)
                    throw new Error(`Regular expression exceeds ${LIMITS.regexLength} characters.`);
                if (/\([^)]*[+*][^)]*\)[+*{]|\([^)]*\|[^)]*\)[+*{]|(?:\.\*|\.\+){2,}|\[[^\]]+\][+*][+*{]/.test(input)) {
                    throw new Error("Regular expression rejected: potentially catastrophic nested quantifier.");
                }
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
            if (matches.length >= LIMITS.matchesPerRule) {
                throw new Error(`Match limit (${LIMITS.matchesPerRule}) exceeded for this rule.`);
            }
            matches.push({
                index: match.index,
                length: match[0].length,
                text: match[0]
            });
            if (match[0].length === 0) {
                if (regex.lastIndex >= text.length) {
                    break;
                }
                const codePoint = text.codePointAt(regex.lastIndex);
                regex.lastIndex += regex.unicode && codePoint > 0xffff ? 2 : 1;
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
        return String(value || "")
            .normalize("NFKC")
            .trim();
    }
    function rulesConflict(first, second) {
        if (first.inputType !== second.inputType) return false;
        if (first.outputType !== second.outputType) return false;
        if (first.inputType === "regexp") {
            // Regex equivalence is not safely inferable from textual normalization.
            return false;
        }
        const firstSearch = normalizeConflictText(first.search);
        const secondSearch = normalizeConflictText(second.search);
        if (!firstSearch || !secondSearch) return false;
        const sameSearch =
            first.caseSensitive === true && second.caseSensitive === true
                ? firstSearch === secondSearch
                : firstSearch.toLocaleLowerCase() === secondSearch.toLocaleLowerCase();
        return sameSearch && first.replacement !== second.replacement;
    }
    function buildConflictClusters(matchedRules) {
        const buckets = new Map();
        for (const rule of matchedRules) {
            if (rule.inputType === "regexp") continue;
            const normalized = normalizeConflictText(rule.search);
            if (!normalized) continue;
            const key = [rule.inputType, rule.outputType, normalized.toLocaleLowerCase()].join("\u0000");
            if (!buckets.has(key)) {
                buckets.set(key, []);
            }
            buckets.get(key).push(rule);
        }
        const clusters = [];
        for (const members of buckets.values()) {
            if (members.length < 2) continue;
            const visited = new Set();
            for (let start = 0; start < members.length; start++) {
                if (visited.has(start)) continue;
                const component = [];
                const queue = [start];
                visited.add(start);
                while (queue.length) {
                    const current = queue.pop();
                    const first = members[current];
                    component.push(first);
                    for (let next = 0; next < members.length; next++) {
                        if (visited.has(next)) continue;
                        if (rulesConflict(first, members[next])) {
                            visited.add(next);
                            queue.push(next);
                        }
                    }
                }
                if (component.length < 2) continue;
                component.sort((a, b) => a.groupIndex - b.groupIndex || a.ruleIndex - b.ruleIndex);
                clusters.push({
                    id: `conflict-${clusters.length + 1}`,
                    search: component[0].search,
                    normalizedSearch: normalizeConflictText(component[0].search),
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
            if (value.length > LIMITS.regexLength) return false;
            const lastSlash = value.lastIndexOf("/");
            if (lastSlash > 0) {
                const source = value.slice(1, lastSlash);
                const flags = value.slice(lastSlash + 1);
                if (
                    source.length > LIMITS.regexLength ||
                    /\([^)]*[+*][^)]*\)[+*{]|\([^)]*\|[^)]*\)[+*{]|(?:\.\*|\.\+){2,}/.test(source)
                )
                    return false;
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
            // Extract visible page text once.
            const pageText = extractPageText();
            // Find enabled groups whose URL settings match this website.
            const eligibleGroupIndexes = new Set();
            state.database.groups.forEach((group, index) => {
                if (group.enabled === false) return;
                const urls = Array.isArray(group.urls) ? group.urls : [];
                if (urls.length === 0 || urls.some((pattern) => urlPatternMatches(pattern, location.href))) {
                    eligibleGroupIndexes.add(index);
                }
            });
            // Analyze every enabled group only once.
            const allEnabledGroups = state.database.groups.filter((group) => group.enabled !== false);
            const result = matchPageRules(pageText, allEnabledGroups);
            // All text matches, regardless of URL settings.
            const allMatchedRules = result.matches;
            // Only matches belonging to URL-eligible groups.
            const matchedRules = allMatchedRules.filter((match) => eligibleGroupIndexes.has(match.sourceGroupIndex));
            // Build groups and conflicts using website-eligible matches.
            const groupMatches = buildGroupMatches(matchedRules);
            const conflicts = buildConflictClusters(matchedRules);
            // Save analysis results.
            state.pageText = pageText;
            state.allMatchedRules = allMatchedRules;
            state.matchingRules = matchedRules;
            state.groupMatches = groupMatches;
            state.conflicts = conflicts;
            state.ruleErrors = result.errors;
            state.lastAnalysis = Date.now();
            const totalOccurrences = matchedRules.reduce((total, rule) => total + (rule.matchCount || 0), 0);
            state.status =
                `Analysis complete: ${allMatchedRules.length} text-matched rules, ` +
                `${matchedRules.length} website-eligible rules, ` +
                `${totalOccurrences} occurrences, ` +
                `${groupMatches.length} groups, ` +
                `${conflicts.length} conflict clusters, ` +
                `${state.ruleErrors.length} rule errors.`;
        } catch (error) {
            state.status = `Analysis failed: ${error.message}`;
            console.error("[FR Debug] Analysis failed:", error);
        }
        renderDebug();
    }
    function closeDebugPanel() {
        if (resizeSaveTimer !== null) {
            clearTimeout(resizeSaveTimer);
            resizeSaveTimer = null;
            saveSettings();
        }
        if (gridRenderTimer !== null) {
            clearTimeout(gridRenderTimer);
            gridRenderTimer = null;
        }
        if (state.resizeObserver) {
            state.resizeObserver.disconnect();
            state.resizeObserver = null;
        }
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
    function gridRowId(groupIndex, ruleIndex) {
        return `${groupIndex}:${ruleIndex}`;
    }
    function getAllGridRows() {
        const matches = new Map();
        const allMatches = new Map();
        const errors = new Map();
        const conflicts = new Map();
        state.matchingRules.forEach((match) => {
            matches.set(gridRowId(match.sourceGroupIndex, match.sourceRuleIndex), match);
        });
        state.allMatchedRules.forEach((match) => {
            allMatches.set(gridRowId(match.sourceGroupIndex, match.sourceRuleIndex), match);
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
        const useAllMatches = state.activeTab === "all";
        state.database.groups.forEach((group, groupIndex) => {
            group.rules.forEach((rule, ruleIndex) => {
                const id = gridRowId(groupIndex, ruleIndex);
                const match = matches.get(id);
                const allMatch = allMatches.get(id);
                const error = errors.get(id) || (Array.isArray(rule.errors) ? rule.errors.join(" ") : "");
                const displayedMatch = useAllMatches ? allMatch : match;
                const conflictId = conflicts.get(id) || "";
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
                    matches: displayedMatch ? displayedMatch.matchCount : 0,
                    conflict: conflictId ? "Conflict" : "",
                    conflictId,
                    source: `G${groupIndex + 1} / R${ruleIndex + 1}`,
                    error: error || "",
                    matched: Boolean(match),
                    matchedRegardlessOfSite: Boolean(allMatch),
                    valid: rule.valid !== false,
                    groupObject: group,
                    ruleObject: rule
                });
            });
        });
        return rows;
    }
    function getVisibleGridRows(sourceRows = getAllGridRows()) {
        const activeTab = state.activeTab;
        const globalSearch = state.gridSearch.trim().toLocaleLowerCase();
        const searchableColumns = GRID_COLUMNS.map((column) => column.key);
        const filters = Object.entries(state.gridFilters)
            .map(([key, value]) => [
                key,
                String(value || "")
                    .trim()
                    .toLocaleLowerCase()
            ])
            .filter(([, filter]) => filter);
        const rows = sourceRows.filter((row) => {
            if (activeTab === "all" && !row.matchedRegardlessOfSite) {
                return false;
            }
            if (activeTab === "groups" && !row.matched) {
                return false;
            }
            if (activeTab === "conflicts" && !row.conflict) {
                return false;
            }
            if (globalSearch) {
                const found = searchableColumns.some((key) =>
                    String(row[key] ?? "")
                        .toLocaleLowerCase()
                        .includes(globalSearch)
                );
                if (!found) return false;
            }
            for (const [key, filter] of filters) {
                if (
                    !String(row[key] ?? "")
                        .toLocaleLowerCase()
                        .includes(filter)
                ) {
                    return false;
                }
            }
            return true;
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
    function selectGridRow(row, event, visibleRows, visibleRowIndexes) {
        const id = row.dataset.rowId;
        const clickedIndex = visibleRowIndexes.get(id);
        if (event.shiftKey && state.lastSelectedRow) {
            const previousIndex = visibleRowIndexes.get(state.lastSelectedRow);
            if (!event.ctrlKey && !event.metaKey) {
                state.selectedRows.clear();
            }
            if (previousIndex !== undefined && clickedIndex !== undefined) {
                const start = Math.min(previousIndex, clickedIndex);
                const end = Math.max(previousIndex, clickedIndex);
                for (let i = start; i <= end; i++) {
                    state.selectedRows.add(visibleRows[i].id);
                }
            } else {
                state.selectedRows.clear();
                state.selectedRows.add(id);
            }
            state.lastSelectedRow = id;
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
                const width = Math.min(
                    LIMITS.columnWidth,
                    Math.max(55, Math.round(startWidth + moveEvent.clientX - startX))
                );
                state.settings.columnWidths[column.key] = width;
                th.style.width = `${width}px`;
                th.style.minWidth = `${width}px`;
                const table = th.closest("table");
                const index = Array.from(th.parentElement.children).indexOf(th);
                table.querySelectorAll("tr").forEach((row) => {
                    const cell = row.children[index];
                    if (cell) {
                        cell.style.width = `${width}px`;
                        cell.style.minWidth = `${width}px`;
                    }
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
    function scheduleGridRender(selector, selectionStart) {
        clearTimeout(gridRenderTimer);
        gridRenderTimer = setTimeout(() => {
            gridRenderTimer = null;
            if (!state.panel || !state.panel.isConnected) {
                return;
            }
            renderDebug();
            if (!selector) return;
            const input = state.panel.querySelector(selector);
            if (input) {
                input.focus();
                if (typeof selectionStart === "number") {
                    input.setSelectionRange(selectionStart, selectionStart);
                }
            }
        }, 150);
    }
    function renderSpreadsheet(content) {
        const allRows = getAllGridRows();
        const rows = getVisibleGridRows(allRows);
        const visibleRowIndexes = new Map(rows.map((item, index) => [item.id, index]));
        const tabs = createElement("div", "frd-grid-tabs");
        const views = [
            ["all", "All Rules Matched"],
            ["groups", "Matched Rules (This Site)"],
            ["conflicts", `Conflicts (${state.conflicts.length})`]
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
            scheduleGridRender(".frd-grid-search", search.selectionStart);
        });
        const count = createElement("span", "frd-grid-count", `${rows.length} of ${allRows.length} rules`);
        const clear = createButton("Clear Filters", () => {
            state.gridSearch = "";
            state.gridFilters = {};
            renderDebug();
        });
        const copySelected = createButton("Copy Selected Rows", () => {
            const selected = rows.filter((row) => state.selectedRows.has(row.id));
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
            input.addEventListener("input", () => {
                state.gridFilters[column.key] = input.value;
                const selectionStart = input.selectionStart;
                const filterIndex = GRID_COLUMNS.findIndex((item) => item.key === column.key) + 2;
                scheduleGridRender(`.frd-filter-row th:nth-child(${filterIndex}) input`, selectionStart);
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
                selectGridRow(row, event, rows, visibleRowIndexes);
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
        const fragment = document.createDocumentFragment();
        state.groupMatches.forEach((group) => {
            const card = createElement("div", "frd-card");
            const heading = createElement("div", "frd-card-title");
            const collapsed = state.collapsedGroups.has(group.groupIndex);
            const title = createElement("span", "", `${group.name} (${group.rules.length} matched rules)`);
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
            fragment.appendChild(card);
        });
        content.appendChild(fragment);
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
        const fragment = document.createDocumentFragment();
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
            fragment.appendChild(card);
        });
        content.appendChild(fragment);
    }
    function renderRuleErrors(content) {
        if (!state.ruleErrors.length) return;
        const fragment = document.createDocumentFragment();
        const card = createElement("div", "frd-card");
        card.appendChild(createElement("div", "frd-card-title", `Rule errors (${state.ruleErrors.length})`));
        state.ruleErrors.forEach((error) => {
            const item = createElement("div", "frd-error");
            item.textContent =
                `${error.groupName}, rule ${error.ruleIndex + 1}: ` + `${error.message} Search: ${error.search}`;
            card.appendChild(item);
        });
        fragment.appendChild(card);
        content.appendChild(fragment);
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
    function createElement(tag, className = "", text = "") {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined && text !== null) {
            element.textContent = String(text);
        }
        return element;
    }
    function createButton(label, onClick) {
        const button = createElement("button", "frd-button", label);
        button.type = "button";
        if (typeof onClick === "function") {
            button.addEventListener("click", onClick);
        }
        return button;
    }
    function appendField(container, label, value) {
        const field = createElement("div", "frd-field");
        const heading = createElement("strong", "frd-field-label", label);
        const content = createElement("div", "frd-field-value", value);
        field.append(heading, content);
        container.appendChild(field);
        return field;
    }
    function copyGridText(text) {
        const fallback = () => {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            document.body.appendChild(textarea);
            textarea.select();
            let success = false;
            try {
                success = document.execCommand("copy");
            } catch (_) {
                success = false;
            }
            textarea.remove();
            return success;
        };
        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
                return navigator.clipboard
                    .writeText(text)
                    .then(() => true)
                    .catch(() => fallback());
            }
        } catch (_) {
            // Fall back if the clipboard API throws immediately.
        }
        return Promise.resolve(fallback());
    }
    function openImportPicker() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.style.display = "none";
        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            input.remove();
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const result = importFoxReplaceJSON(String(reader.result || ""));
                    state.status =
                        `Imported ${result.groups} groups and ${result.rules} rules. ` +
                        `${result.invalidRules} invalid rules retained for inspection.`;
                    renderDebug();
                } catch (error) {
                    state.status = `Import failed: ${error.message}`;
                    renderDebug();
                }
            };
            reader.onerror = () => {
                state.status = "Import failed: Could not read the selected file.";
                renderDebug();
            };
            reader.readAsText(file);
        });
        document.body.appendChild(input);
        input.click();
    }
    function installDebugStyles() {
        if (document.getElementById("fr-debug-styles")) return;
        const style = document.createElement("style");
        style.id = "fr-debug-styles";
        style.textContent = `
        #fr-debug-panel {
            position: fixed;
            z-index: 2147483647;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
            min-width: 320px;
            min-height: 220px;
            color: #eeeeee;
            background: #202124;
            border: 1px solid #55585c;
            border-radius: 8px;
            box-shadow: 0 5px 25px rgba(0,0,0,.45);
            font: 13px/1.45 Arial, sans-serif;
            overflow: hidden;
        }
        #fr-debug-panel *,
        #fr-debug-panel *::before,
        #fr-debug-panel *::after {
            box-sizing: border-box;
        }
        #fr-debug-panel .frd-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 9px 12px;
            background: #303238;
            border-bottom: 1px solid #45474a;
            cursor: move;
            user-select: none;
        }
        #fr-debug-panel .frd-title {
            font-size: 14px;
            font-weight: bold;
        }
        #fr-debug-panel .frd-header-actions,
        #fr-debug-panel .frd-toolbar {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 6px;
        }
        #fr-debug-panel button {
            padding: 6px 10px;
            color: #eeeeee;
            background: #41444a;
            border: 1px solid #62666d;
            border-radius: 4px;
            cursor: pointer;
            font: inherit;
        }
        #fr-debug-panel button:hover {
            background: #555961;
        }
        #fr-debug-panel .frd-status {
            padding: 7px 12px;
            color: #c9d4e3;
            background: #27292e;
            border-bottom: 1px solid #45474a;
            overflow-wrap: anywhere;
        }
        #fr-debug-panel .frd-toolbar {
            padding: 8px 12px;
            border-bottom: 1px solid #45474a;
        }
        #fr-debug-panel .frd-content {
            flex: 1;
            min-height: 0;
            overflow: auto;
            padding: 12px;
        }
        #fr-debug-panel .frd-grid-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-bottom: 12px;
        }
        #fr-debug-panel .frd-tab-active {
            background: #245b91;
            border-color: #4b8dcc;
        }
        #fr-debug-panel .frd-grid-toolbar {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 8px;
        }
        #fr-debug-panel input {
            min-width: 0;
            padding: 6px;
            color: #eeeeee;
            background: #292b30;
            border: 1px solid #55585c;
            border-radius: 3px;
        }
        #fr-debug-panel .frd-grid-search {
            flex: 1;
            min-width: 160px;
        }
        #fr-debug-panel .frd-grid-count,
        #fr-debug-panel .frd-grid-status {
            color: #b9bec7;
        }
        #fr-debug-panel .frd-grid-status {
            margin-bottom: 8px;
        }
        #fr-debug-panel .frd-grid-wrap {
            width: 100%;
            overflow: auto;
            border: 1px solid #45474a;
        }
        #fr-debug-panel .frd-spreadsheet {
            width: max-content;
            min-width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }
        #fr-debug-panel .frd-spreadsheet th,
        #fr-debug-panel .frd-spreadsheet td {
            position: relative;
            padding: 7px;
            border-right: 1px solid #45474a;
            border-bottom: 1px solid #45474a;
            text-align: left;
            vertical-align: top;
            overflow-wrap: anywhere;
        }
        #fr-debug-panel .frd-spreadsheet th {
            background: #303238;
        }
        #fr-debug-panel .frd-spreadsheet th.frd-sortable {
            cursor: pointer;
            user-select: none;
        }
        #fr-debug-panel .frd-spreadsheet td {
            max-width: 1200px;
        }
        #fr-debug-panel .frd-spreadsheet tbody tr {
            cursor: pointer;
        }
        #fr-debug-panel .frd-spreadsheet tbody tr:hover {
            background: #343840;
        }
        #fr-debug-panel .frd-spreadsheet tbody tr.frd-selected {
            background: #24496c;
        }
        #fr-debug-panel .frd-spreadsheet tbody tr.frd-conflict {
            box-shadow: inset 3px 0 #e0a33a;
        }
        #fr-debug-panel .frd-spreadsheet tbody tr.frd-error-row {
            box-shadow: inset 3px 0 #d65c5c;
        }
        #fr-debug-panel .frd-row-number {
            width: 42px;
            min-width: 42px;
            color: #aeb4bd;
            text-align: center !important;
        }
        #fr-debug-panel .frd-filter-row th {
            padding: 4px;
            background: #27292e;
        }
        #fr-debug-panel .frd-filter {
            width: 100%;
        }
        #fr-debug-panel .frd-column-resizer {
            position: absolute;
            top: 0;
            right: 0;
            width: 6px;
            height: 100%;
            cursor: col-resize;
            touch-action: none;
        }
        #fr-debug-panel .frd-grid-empty {
            padding: 20px !important;
            color: #b9bec7;
            text-align: center !important;
        }
        #fr-debug-panel .frd-conflict-cell {
            color: #ffc66d;
        }
        #fr-debug-panel .frd-error-cell,
        #fr-debug-panel .frd-error {
            color: #ff9292;
        }
        #fr-debug-panel .frd-card {
            margin-bottom: 12px;
            padding: 12px;
            border: 1px solid #45474a;
            border-radius: 5px;
        }
        #fr-debug-panel .frd-card-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
            font-weight: bold;
        }
        #fr-debug-panel .frd-rule {
            margin-top: 8px;
            padding: 9px;
            background: #292b30;
            border-radius: 4px;
        }
        #fr-debug-panel .frd-field {
            margin-bottom: 7px;
        }
        #fr-debug-panel .frd-field-label {
            display: block;
            color: #aebdce;
        }
        #fr-debug-panel .frd-field-value {
            overflow-wrap: anywhere;
            white-space: pre-wrap;
        }
        #fr-debug-panel .frd-url,
        #fr-debug-panel .frd-empty {
            margin: 8px 0;
            color: #c1c7d0;
            overflow-wrap: anywhere;
        }
    `;
        (document.head || document.documentElement).appendChild(style);
    }
    function createDebugPanel() {
        if (state.panel && state.panel.isConnected) return;
        const panel = createElement("div");
        panel.id = "fr-debug-panel";
        panel.style.width = `${state.settings.width}px`;
        panel.style.height = `${state.settings.height}px`;
        panel.style.left = `${state.settings.left}px`;
        panel.style.top = `${state.settings.top}px`;
        const header = createElement("div", "frd-header");
        const title = createElement("span", "frd-title", "FR Debug");
        const headerActions = createElement("div", "frd-header-actions");
        const minimize = createButton(state.settings.minimized ? "Restore" : "Minimize", () => {
            state.settings.minimized = !state.settings.minimized;
            saveSettings();
            renderDebug();
        });
        const close = createButton("Close", closeDebugPanel);
        headerActions.append(minimize, close);
        header.append(title, headerActions);
        const status = createElement("div", "frd-status", state.status);
        const toolbar = createElement("div", "frd-toolbar");
        toolbar.append(
            createButton("Analyze Page", analyzeDebugPage),
            createButton("Import FoxReplace JSON", openImportPicker)
        );
        const content = createElement("div", "frd-content");
        panel.append(header, status, toolbar, content);
        document.body.appendChild(panel);
        state.panel = panel;
        // Allow the panel to be moved by dragging its header.
        header.addEventListener("pointerdown", (event) => {
            if (event.button !== 0 || !(event.target instanceof Element) || event.target.closest("button")) {
                return;
            }
            event.preventDefault();
            const startX = event.clientX;
            const startY = event.clientY;
            const startLeft = panel.offsetLeft;
            const startTop = panel.offsetTop;
            function move(moveEvent) {
                const left = Math.max(0, startLeft + moveEvent.clientX - startX);
                const top = Math.max(0, startTop + moveEvent.clientY - startY);
                panel.style.left = `${left}px`;
                panel.style.top = `${top}px`;
                state.settings.left = left;
                state.settings.top = top;
            }
            function stop() {
                document.removeEventListener("pointermove", move);
                document.removeEventListener("pointerup", stop);
                document.removeEventListener("pointercancel", stop);
                window.removeEventListener("blur", stop);
                saveSettings();
            }
            window.addEventListener("blur", stop);
            document.addEventListener("pointermove", move);
            document.addEventListener("pointerup", stop);
            document.addEventListener("pointercancel", stop);
        });
        if (typeof ResizeObserver === "function") {
            const resizeObserver = new ResizeObserver(() => {
                if (state.settings.minimized) return;
                const rect = panel.getBoundingClientRect();
                const width = Math.max(320, Math.round(rect.width));
                const height = Math.max(220, Math.round(rect.height));
                if (state.settings.width === width && state.settings.height === height) {
                    return;
                }
                state.settings.width = width;
                state.settings.height = height;
                clearTimeout(resizeSaveTimer);
                resizeSaveTimer = setTimeout(() => {
                    saveSettings();
                    resizeSaveTimer = null;
                }, 250);
            });
            state.resizeObserver = resizeObserver;
            resizeObserver.observe(panel);
        }
        renderDebug();
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
