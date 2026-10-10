// ==UserScript==
// @name         FR Debug
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      1.0.0
// @description  Imports FoxReplace rules and checks page matches and conflicts.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
(function () {
    "use strict";
    const FR_DEBUG_VERSION = "1.0.0";
    const FR_DEBUG_UI_ID = "fr-debug-panel";
    const FR_DEBUG_KEYS = {
        settings: "FR_DEBUG_SETTINGS_V1",
        database: "FR_DEBUG_DATABASE_V1",
        lastImport: "FR_DEBUG_LAST_IMPORT_V1"
    };
    const DEFAULT_SETTINGS = {
        width: 900,
        height: 600,
        left: 60,
        top: 60,
        columnWidths: {},
        minimized: false
    };
    const state = {
        pageText: "",
        database: [],
        matchingRules: [],
        conflicts: [],
        settings: { ...DEFAULT_SETTINGS },
        imported: false
    };
    function storageGet(key, fallback) {
        try {
            const value = GM_getValue(key, fallback);
            return value == null ? fallback : value;
        } catch (_) {
            return fallback;
        }
    }
    function storageSet(key, value) {
        try {
            GM_setValue(key, value);
        } catch (error) {
            console.error("[FR Debug] Storage error:", error);
        }
    }
    function loadSettings() {
        const saved = storageGet(FR_DEBUG_KEYS.settings, {});
        state.settings = {
            ...DEFAULT_SETTINGS,
            ...(saved && typeof saved === "object" ? saved : {}),
            columnWidths: {
                ...DEFAULT_SETTINGS.columnWidths,
                ...(saved?.columnWidths || {})
            }
        };
    }
    function saveSettings() {
        storageSet(FR_DEBUG_KEYS.settings, state.settings);
    }
    function getPageText() {
        if (!document.body) return "";
        return document.body.innerText || document.body.textContent || "";
    }
    function normalizeRule(value) {
        return String(value || "")
            .replace(/\r\n?/g, "\n")
            .replace(/[ \t]+/g, " ")
            .trim();
    }
    function normalizeUrl(value) {
        return String(value || "")
            .trim()
            .replace(/\/+$/, "")
            .toLowerCase();
    }
    function ruleMatchesPage(rule, pageText, pageUrl) {
        if (!rule || rule.enabled === false) return false;
        const urls = Array.isArray(rule.urls)
            ? rule.urls
            : rule.url
              ? [rule.url]
              : [];
        if (urls.length) {
            const currentUrl = normalizeUrl(pageUrl);
            const urlMatched = urls.some((value) => {
                const normalized = normalizeUrl(value);
                return normalized === "*" || currentUrl.includes(normalized);
            });
            if (!urlMatched) return false;
        }
        const pattern = String(rule.search ?? rule.find ?? rule.pattern ?? "");
        if (!pattern) return false;
        const flags = rule.regex ? "gi" : "gi";
        try {
            const regex = new RegExp(
                rule.regex ? pattern : escapeRegExp(pattern),
                flags
            );
            return regex.test(pageText);
        } catch (_) {
            return false;
        }
    }
    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function countRuleMatches(rule, pageText) {
        if (!rule || rule.enabled === false) return 0;
        const pattern = String(rule.search ?? rule.find ?? rule.pattern ?? "");
        if (!pattern) return 0;
        try {
            const regex = new RegExp(
                rule.regex ? pattern : escapeRegExp(pattern),
                "gi"
            );
            let count = 0;
            let match;
            while ((match = regex.exec(pageText)) !== null) {
                count++;
                if (!match[0].length) regex.lastIndex++;
                if (count >= 10000) break;
            }
            return count;
        } catch (_) {
            return 0;
        }
    }
    function createElement(tag, attributes = {}, text = "") {
        const element = document.createElement(tag);
        for (const [key, value] of Object.entries(attributes)) {
            if (key === "className") {
                element.className = value;
            } else if (key === "style" && typeof value === "object") {
                Object.assign(element.style, value);
            } else {
                element.setAttribute(key, value);
            }
        }
        if (text !== "") element.textContent = text;
        return element;
    }
    function normalizeImportedRule(rule, groupName = "") {
        if (!rule || typeof rule !== "object") return null;
        return {
            ...rule,
            name: String(
                rule.name ||
                    rule.title ||
                    rule.search ||
                    rule.find ||
                    "(unnamed rule)"
            ),
            search: String(rule.search ?? rule.find ?? rule.pattern ?? ""),
            replacement: String(rule.replace ?? rule.replacement ?? ""),
            group: String(rule.group || groupName || "Ungrouped"),
            enabled: rule.enabled !== false
        };
    }
    function extractRulesFromJSON(data) {
        const rules = [];
        function visit(value, groupName = "") {
            if (Array.isArray(value)) {
                for (const item of value) visit(item, groupName);
                return;
            }
            if (!value || typeof value !== "object") return;
            const isRule =
                "search" in value || "find" in value || "pattern" in value;
            if (isRule) {
                const normalized = normalizeImportedRule(value, groupName);
                if (normalized) rules.push(normalized);
                return;
            }
            const nextGroup = String(
                value.name ||
                    value.title ||
                    value.group ||
                    groupName ||
                    "Ungrouped"
            );
            for (const [key, child] of Object.entries(value)) {
                if (["name", "title", "group"].includes(key)) continue;
                visit(child, nextGroup);
            }
        }
        visit(data);
        return rules;
    }
    function importFoxReplaceJSON(jsonText) {
        let data;
        try {
            data = JSON.parse(jsonText);
        } catch (error) {
            throw new Error(`Invalid JSON: ${error.message}`);
        }
        const rules = extractRulesFromJSON(data);
        if (!rules.length) {
            throw new Error(
                "No FoxReplace rules were found in the imported JSON."
            );
        }
        state.database = rules;
        state.imported = true;
        storageSet(FR_DEBUG_KEYS.database, state.database);
        storageSet(FR_DEBUG_KEYS.lastImport, new Date().toISOString());
        analyzeDebugPage();
    }
    function openImportPicker() {
        const input = createElement("input", {
            type: "file",
            accept: ".json,application/json"
        });
        input.style.display = "none";
        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                importFoxReplaceJSON(await file.text());
            } catch (error) {
                alert(`FR Debug import failed:\n${error.message}`);
            } finally {
                input.remove();
            }
        });
        document.body.appendChild(input);
        input.click();
    }
    function analyzeDebugPage() {
        const pageText = getPageText();
        const pageRuleMatches = matchPageRules(pageText, state.database);
        state.pageText = pageText;
        state.matchingRules = pageRuleMatches;
        state.groupMatches = buildGroupMatches(pageRuleMatches);
        state.conflicts = buildConflictClusters(pageRuleMatches);
        return {
            pageText,
            pageRuleMatches,
            groupMatches: state.groupMatches,
            conflicts: state.conflicts
        };
    }
    function detectConflicts(rules) {
        const conflicts = [];
        for (let i = 0; i < rules.length; i++) {
            for (let j = i + 1; j < rules.length; j++) {
                const first = rules[i];
                const second = rules[j];
                if (
                    normalizeRule(first.search).toLowerCase() ===
                    normalizeRule(second.search).toLowerCase()
                ) {
                    conflicts.push({
                        type: "Same search",
                        first,
                        second
                    });
                    continue;
                }
                const firstMatches = state.pageText.includes(first.search);
                const secondMatches = state.pageText.includes(second.search);
                if (firstMatches && secondMatches) {
                    conflicts.push({
                        type: "Both match page",
                        first,
                        second
                    });
                }
            }
        }
        return conflicts;
    }
    function renderDebug() {
        let panel = document.getElementById(FR_DEBUG_UI_ID);
        if (!panel) {
            panel = createElement("section", {
                id: FR_DEBUG_UI_ID
            });
            document.body.appendChild(panel);
        }
        panel.replaceChildren();
        const header = createElement(
            "header",
            {
                className: "fr-debug-header"
            },
            "FR Debug"
        );
        const importButton = createElement("button", {}, "Import JSON");
        importButton.addEventListener("click", openImportPicker);
        const refreshButton = createElement("button", {}, "Rescan");
        refreshButton.addEventListener("click", analyzeDebugPage);
        header.append(importButton, refreshButton);
        panel.appendChild(header);
        panel.appendChild(
            createElement(
                "div",
                { className: "fr-debug-summary" },
                `Imported rules: ${state.database.length} | Matching rules: ${state.matchingRules.length} | Conflicts: ${state.conflicts.length}`
            )
        );
        const grouped = new Map();
        for (const rule of state.matchingRules) {
            if (!grouped.has(rule.group)) grouped.set(rule.group, []);
            grouped.get(rule.group).push(rule);
        }
        const ruleContainer = createElement("div", {
            className: "fr-debug-rules"
        });
        for (const [groupName, rules] of grouped) {
            ruleContainer.appendChild(
                createElement(
                    "div",
                    { className: "fr-debug-group" },
                    `${groupName} (${rules.length})`
                )
            );
            for (const rule of rules) {
                const row = createElement("div", {
                    className: "fr-debug-rule"
                });
                row.appendChild(createElement("strong", {}, rule.name));
                row.appendChild(
                    createElement("div", {}, `Search: ${rule.search}`)
                );
                row.appendChild(
                    createElement("div", {}, `Replacement: ${rule.replacement}`)
                );
                row.appendChild(
                    createElement("div", {}, `Matches: ${rule.matchCount}`)
                );
                ruleContainer.appendChild(row);
            }
        }
        panel.appendChild(ruleContainer);
        const conflictContainer = createElement("details");
        conflictContainer.appendChild(
            createElement(
                "summary",
                {},
                `Conflicts (${state.conflicts.length})`
            )
        );
        for (const conflict of state.conflicts) {
            conflictContainer.appendChild(
                createElement(
                    "div",
                    { className: "fr-debug-conflict" },
                    `${conflict.type}: ${conflict.first.name} ↔ ${conflict.second.name}`
                )
            );
        }
        panel.appendChild(conflictContainer);
    }
    function installDebugStyles() {
        if (document.getElementById("fr-debug-styles")) return;
        const style = createElement("style", {
            id: "fr-debug-styles"
        });
        style.textContent = `
            #${FR_DEBUG_UI_ID} {
                position: fixed;
                z-index: 2147483645;
                top: ${state.settings.top}px;
                left: ${state.settings.left}px;
                width: ${state.settings.width}px;
                height: ${state.settings.height}px;
                min-width: 360px;
                min-height: 240px;
                display: flex;
                flex-direction: column;
                overflow: auto;
                resize: both;
                box-sizing: border-box;
                padding: 12px;
                border: 1px solid #596579;
                border-radius: 8px;
                background: #171b24;
                color: #e6eaf0;
                font: 13px/1.45 Arial, sans-serif;
                box-shadow: 0 6px 24px #0008;
            }
            #${FR_DEBUG_UI_ID} button {
                padding: 5px 10px;
                border: 1px solid #596579;
                border-radius: 4px;
                background: #293244;
                color: inherit;
                cursor: pointer;
            }
            #${FR_DEBUG_UI_ID} .fr-debug-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 8px;
                margin-bottom: 10px;
                font-weight: bold;
            }
            #${FR_DEBUG_UI_ID} .fr-debug-summary {
                padding: 8px;
                margin-bottom: 8px;
                background: #222a38;
                border-radius: 4px;
            }
            #${FR_DEBUG_UI_ID} .fr-debug-group {
                margin-top: 8px;
                padding: 5px;
                background: #293244;
                font-weight: bold;
            }
            #${FR_DEBUG_UI_ID} .fr-debug-rule,
            #${FR_DEBUG_UI_ID} .fr-debug-conflict {
                padding: 7px 8px;
                border-bottom: 1px solid #343d4e;
                overflow-wrap: anywhere;
            }
            #${FR_DEBUG_UI_ID} details {
                margin-top: 10px;
            }
        `;
        document.head.appendChild(style);
    }
    function enablePanelDragging() {
        const panel = document.getElementById(FR_DEBUG_UI_ID);
        const header = panel?.querySelector(".fr-debug-header");
        if (!panel || !header) return;
        let dragging = false;
        let offsetX = 0;
        let offsetY = 0;
        header.style.cursor = "move";
        header.addEventListener("mousedown", (event) => {
            if (event.target.closest("button")) return;
            dragging = true;
            const rect = panel.getBoundingClientRect();
            offsetX = event.clientX - rect.left;
            offsetY = event.clientY - rect.top;
            event.preventDefault();
        });
        document.addEventListener("mousemove", (event) => {
            if (!dragging) return;
            panel.style.left = `${Math.max(0, event.clientX - offsetX)}px`;
            panel.style.top = `${Math.max(0, event.clientY - offsetY)}px`;
        });
        document.addEventListener("mouseup", () => {
            if (!dragging) return;
            dragging = false;
            state.settings.left = panel.offsetLeft;
            state.settings.top = panel.offsetTop;
            state.settings.width = panel.offsetWidth;
            state.settings.height = panel.offsetHeight;
            saveSettings();
        });
    }
    function initializeDebug() {
        loadSettings();
        state.database = storageGet(FR_DEBUG_KEYS.database, []);
        state.pageText = getPageText();
        installDebugStyles();
        analyzeDebugPage();
        enablePanelDragging();
        const panel = document.getElementById(FR_DEBUG_UI_ID);
        if (panel && typeof ResizeObserver !== "undefined") {
            new ResizeObserver(() => {
                state.settings.width = panel.offsetWidth;
                state.settings.height = panel.offsetHeight;
                saveSettings();
            }).observe(panel);
        }
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initializeDebug, {
            once: true
        });
    } else {
        initializeDebug();
    }
    function createColumnResizer(table, columnKey) {
        const handle = createElement("span", {
            className: "fr-debug-resize-handle"
        });
        Object.assign(handle.style, {
            position: "absolute",
            top: "0",
            right: "0",
            width: "6px",
            height: "100%",
            cursor: "col-resize",
            userSelect: "none"
        });
        let startX = 0;
        let startWidth = 180;
        handle.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            startX = event.clientX;
            startWidth = state.settings.columnWidths[columnKey] || 180;
            function move(moveEvent) {
                const width = Math.max(
                    60,
                    startWidth + moveEvent.clientX - startX
                );
                state.settings.columnWidths[columnKey] = width;
                table
                    .querySelectorAll(`[data-column="${columnKey}"]`)
                    .forEach((cell) => {
                        cell.style.width = `${width}px`;
                        cell.style.minWidth = `${width}px`;
                        cell.style.maxWidth = `${width}px`;
                    });
            }
            function stop() {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", stop);
                saveSettings();
            }
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", stop);
        });
        return handle;
    }
    function renderDebugRuleTable(container) {
        const table = createElement("table", {
            className: "fr-debug-table"
        });
        const columns = [
            { key: "group", label: "Group" },
            { key: "name", label: "Rule" },
            { key: "search", label: "Search" },
            { key: "replacement", label: "Replacement" },
            { key: "matchCount", label: "Matches" }
        ];
        const head = createElement("thead");
        const headerRow = createElement("tr");
        for (const column of columns) {
            const cell = createElement("th", {
                "data-column": column.key
            });
            cell.style.position = "relative";
            cell.textContent = column.label;
            const width = state.settings.columnWidths[column.key];
            if (width) {
                cell.style.width = `${width}px`;
                cell.style.minWidth = `${width}px`;
                cell.style.maxWidth = `${width}px`;
            }
            cell.appendChild(createColumnResizer(table, column.key));
            headerRow.appendChild(cell);
        }
        head.appendChild(headerRow);
        table.appendChild(head);
        const body = createElement("tbody");
        for (const rule of state.matchingRules) {
            const row = createElement("tr");
            const values = {
                group: rule.group,
                name: rule.name,
                search: rule.search,
                replacement: rule.replacement,
                matchCount: rule.matchCount
            };
            for (const column of columns) {
                const cell = createElement(
                    "td",
                    {
                        "data-column": column.key
                    },
                    String(values[column.key] ?? "")
                );
                const width = state.settings.columnWidths[column.key];
                if (width) {
                    cell.style.width = `${width}px`;
                    cell.style.minWidth = `${width}px`;
                    cell.style.maxWidth = `${width}px`;
                }
                row.appendChild(cell);
            }
            body.appendChild(row);
        }
        table.appendChild(body);
        container.appendChild(table);
    }
    function renderDebugConflicts(container) {
        const section = createElement("section", {
            className: "fr-debug-conflicts"
        });
        section.appendChild(
            createElement(
                "h3",
                {},
                `Conflict details (${state.conflicts.length})`
            )
        );
        for (const conflict of state.conflicts) {
            const row = createElement("div", {
                className: "fr-debug-conflict"
            });
            row.appendChild(createElement("strong", {}, conflict.type));
            row.appendChild(
                createElement(
                    "div",
                    {},
                    `${conflict.first.group} / ${conflict.first.name}`
                )
            );
            row.appendChild(
                createElement("div", {}, `Search: ${conflict.first.search}`)
            );
            row.appendChild(
                createElement(
                    "div",
                    {},
                    `Replacement: ${conflict.first.replacement}`
                )
            );
            row.appendChild(
                createElement(
                    "div",
                    {},
                    `${conflict.second.group} / ${conflict.second.name}`
                )
            );
            row.appendChild(
                createElement("div", {}, `Search: ${conflict.second.search}`)
            );
            row.appendChild(
                createElement(
                    "div",
                    {},
                    `Replacement: ${conflict.second.replacement}`
                )
            );
            section.appendChild(row);
        }
        container.appendChild(section);
    }
    const originalRenderDebug = renderDebug;
    renderDebug = function () {
        originalRenderDebug();
        const panel = document.getElementById(FR_DEBUG_UI_ID);
        if (!panel) return;
        const ruleTable = createElement("section", {
            className: "fr-debug-table-container"
        });
        ruleTable.appendChild(createElement("h3", {}, "Matching rules"));
        renderDebugRuleTable(ruleTable);
        panel.appendChild(ruleTable);
        renderDebugConflicts(panel);
        panel.style.width = `${state.settings.width}px`;
        panel.style.height = `${state.settings.height}px`;
        enablePanelDragging();
    };
    const debugStyle = createElement("style");
    debugStyle.textContent = `
        #${FR_DEBUG_UI_ID} .fr-debug-table {
            width: 100%;
            border-collapse: collapse;
            table-layout: fixed;
        }
        #${FR_DEBUG_UI_ID} .fr-debug-table th,
        #${FR_DEBUG_UI_ID} .fr-debug-table td {
            position: relative;
            padding: 6px;
            border: 1px solid #343d4e;
            text-align: left;
            overflow-wrap: anywhere;
        }
        #${FR_DEBUG_UI_ID} .fr-debug-table th {
            background: #293244;
        }
        #${FR_DEBUG_UI_ID} .fr-debug-conflict {
            margin: 6px 0;
            padding: 8px;
            border: 1px solid #596579;
            border-radius: 4px;
        }
    `;
    const RULE_REGEX_CACHE = new WeakMap();
    function ruleText(rule) {
        if (!rule || typeof rule !== "object") return "";
        const values = [
            rule.input,
            rule.regex,
            rule.pattern,
            rule.find,
            rule.search,
            rule.match,
            rule.from,
            rule.text,
            rule.source
        ];
        return String(
            values.find((item) => typeof item === "string" && item.trim()) || ""
        ).trim();
    }
    function ruleReplacement(rule) {
        if (!rule || typeof rule !== "object") return "";
        const values = [rule.replace, rule.replacement, rule.to, rule.value];
        return String(values.find((item) => typeof item === "string") || "");
    }
    function escapeRegExp(value) {
        return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function compileRuleRegex(rule) {
        if (!rule || typeof rule !== "object") return null;
        if (RULE_REGEX_CACHE.has(rule)) {
            return RULE_REGEX_CACHE.get(rule);
        }
        const source = ruleText(rule);
        if (!source) {
            RULE_REGEX_CACHE.set(rule, null);
            return null;
        }
        let expression = null;
        if (source.startsWith("/") && source.lastIndexOf("/") > 0) {
            const lastSlash = source.lastIndexOf("/");
            const body = source.slice(1, lastSlash);
            const flags = source.slice(lastSlash + 1);
            try {
                expression = new RegExp(
                    body,
                    flags.includes("g") ? flags : flags + "g"
                );
            } catch {
                expression = null;
            }
        }
        const regexMode =
            rule.inputType === "regex" ||
            rule.regex === true ||
            rule.isRegex === true;
        if (!expression && regexMode) {
            try {
                expression = new RegExp(source, "g");
            } catch {
                expression = null;
            }
        }
        if (!expression) {
            expression = new RegExp(escapeRegExp(source), "g");
        }
        RULE_REGEX_CACHE.set(rule, expression);
        return expression;
    }
    function countRuleMatches(rule, pageText) {
        if (!rule || typeof pageText !== "string" || !pageText) {
            return 0;
        }
        let compiled;
        try {
            compiled = compileRuleRegex(rule);
        } catch {
            return 0;
        }
        if (!(compiled instanceof RegExp)) return 0;
        const regex = new RegExp(compiled.source, compiled.flags);
        regex.lastIndex = 0;
        let count = 0;
        let match;
        while ((match = regex.exec(pageText)) !== null) {
            count++;
            if (!match[0].length) {
                if (regex.lastIndex >= pageText.length) break;
                const codePoint = pageText.codePointAt(regex.lastIndex);
                regex.lastIndex += codePoint > 0xffff ? 2 : 1;
            }
        }
        return count;
    }
    function getGroupName(group, index) {
        if (typeof group === "string") return group;
        if (!group || typeof group !== "object") {
            return `Group ${index + 1}`;
        }
        return String(
            group.name ?? group.title ?? group.label ?? `Group ${index + 1}`
        );
    }
    function getGroupRules(group) {
        if (Array.isArray(group?.rules)) return group.rules;
        if (Array.isArray(group?.items)) return group.items;
        if (Array.isArray(group?.entries)) return group.entries;
        return [];
    }
    function normalizeAdaptedDatabase(database) {
        if (Array.isArray(database?.groups)) return database;
        if (Array.isArray(database)) return { groups: database };
        return { groups: [] };
    }
    function matchPageRules(pageText, database) {
        const adapted = normalizeAdaptedDatabase(database);
        const matches = [];
        adapted.groups.forEach((group, groupIndex) => {
            if (group?.enabled === false) return;
            const groupName = getGroupName(group, groupIndex);
            getGroupRules(group).forEach((rule, ruleIndex) => {
                if (rule?.enabled === false) return;
                const count = countRuleMatches(rule, pageText);
                if (count <= 0) return;
                matches.push({
                    rule,
                    ruleIndex,
                    group,
                    groupIndex,
                    groupName,
                    text: ruleText(rule),
                    replacement: ruleReplacement(rule),
                    count
                });
            });
        });
        return matches;
    }
    document.head.appendChild(debugStyle);
    /*
     * FR DEBUG NOTES
     *
     * FoxReplace:
     * - Import FoxReplace JSON.
     * - Match enabled rules against the current page text and URL.
     * - Group matching rules by FoxReplace group.
     * - Show each rule's replacement and match count.
     * - Detect conflicts between rules that match the current page.
     *
     * UI:
     * - FR Debug owns its UI, CSS, panel, resizing, dragging,
     *   saved dimensions, column widths, and storage keys.
     * - Do not depend on FR Scanner or shared runtime code.
     */
})();
/**
 * FR DEBUG — PIPELINE SPECIFICATION
 *
 * PURPOSE
 * Import FoxReplace JSON, match its enabled rules against the current
 * page text, organize matching rules by their original FoxReplace groups,
 * and identify conflicts between matched rules.
 *
 * FR Debug is an independent analysis tool. It is NOT FR Scanner.
 *
 * ================================================================
 * 1. INITIALIZATION AND STORAGE
 * ================================================================
 *
 * - Initialize FR Debug's own settings, database, page text, matching
 *   results, Groups, Conflicts, and UI state.
 * - Install FR Debug's own styles, panel, and menu commands.
 * - Support Import FoxReplace JSON and Analyze Page commands.
 * - Save and restore FR Debug's panel dimensions and column widths.
 * - Use FR Debug's independent storage keys.
 * - NEVER read, overwrite, clear, or modify FR Scanner's storage.
 *
 * ================================================================
 * 2. FOXREPLACE JSON IMPORT
 * ================================================================
 *
 * Functions:
 * openImportPicker()
 * importFoxReplaceJSON()
 * extractRulesFromJSON()
 * normalizeImportedRule()
 *
 * - Let the user select a FoxReplace JSON file.
 * - Parse and validate the JSON and its actual FoxReplace schema.
 * - Extract groups and substitution rules without changing their
 *   original group association or source ordering.
 * - Normalize the fields required for analysis:
 *   search text, replacement text, input type, case sensitivity,
 *   enabled state, source group index, and source rule index.
 * - Preserve original rule text separately from comparison values.
 * - Preserve disabled rules in the imported database, but never
 *   include disabled rules in page matching.
 * - Report malformed JSON, unsupported structures, invalid rules,
 *   and import success or failure.
 * - Never silently convert invalid rules into valid-looking rules.
 * - Preserve source indexes so every result can be traced to its
 *   original FoxReplace group and rule.
 * - Store imported data using FR Debug's independent storage key.
 *
 * ================================================================
 * 3. PAGE TEXT EXTRACTION
 * ================================================================
 *
 * Function:
 * getPageText()
 *
 * - Extract visible text recursively from document.body.
 * - Preserve inline text continuity and meaningful block/line breaks.
 * - Exclude hidden content, scripts, navigation, ads, comments,
 *   and UI belonging to FR Debug or FR Scanner.
 * - Normalize whitespace consistently with FR Scanner.
 * - Extract page text once per analysis.
 * - Use the text ONLY for FoxReplace rule matching.
 *
 * IMPORTANT:
 * Do not run FR Scanner's Candidate/Start occurrence scanner.
 *
 * ================================================================
 * 4. DATABASE NORMALIZATION
 * ================================================================
 *
 * Functions:
 * normalizeAdaptedDatabase()
 * getGroupName()
 * getGroupRules()
 *
 * - Validate imported database and group/rule arrays.
 * - Normalize group and rule access without losing source order.
 * - Safely ignore malformed or unusable records.
 * - Preserve original search and replacement text.
 * - Keep disabled rules as imported data, but exclude them from
 *   all matching and downstream analysis.
 *
 * ================================================================
 * 5. MATCH FOXREPLACE RULES AGAINST THE CURRENT PAGE
 * ================================================================
 *
 * Functions:
 * analyzeDebugPage()
 * matchPageRules()
 * groupMatchesCurrentSite()
 * ruleText()
 * ruleReplacement()
 * compileRuleRegex()
 * countRuleMatches()
 *
 * - Extract the current page text once per analysis.
 * - Process FoxReplace groups in original source order.
 * - Apply the correct current-site eligibility test to each group.
 * - Skip disabled rules and rules without usable search text.
 * - Match each eligible rule according to its actual input type:
 *
 *   REGEX:
 *     Compile and apply the configured regular expression.
 *
 *   TEXT:
 *     Match literal text, not an unintended regular expression.
 *
 *   WHOLE WORD:
 *     Apply the established whole-word boundary semantics.
 *
 * - Apply case sensitivity correctly.
 * - Catch invalid regexes per rule so one bad rule cannot abort
 *   the rest of the analysis.
 * - Count occurrences in the ORIGINAL page text.
 * - Never apply replacements to the live page or to the text
 *   being analyzed.
 * - Advance safely after zero-length regex matches to prevent
 *   infinite loops.
 * - Keep only rules with at least one match on the current page.
 * - Record each matched rule's source group index, rule index,
 *   group name, search text, replacement text, identity, and count.
 *
 * CRITICAL INVARIANT:
 * Only enabled, eligible FoxReplace rules that actually match the
 * current page may enter the Groups or Conflicts pipelines.
 *
 * ================================================================
 * 6. BUILD GROUPS
 * ================================================================
 *
 * Function:
 * buildGroupMatches()
 *
 * - Input: page-matched FoxReplace rule records ONLY.
 * - Group results by their original FoxReplace group identity/index.
 * - Preserve original group ordering and rule ordering.
 * - Include each matched rule's search text, replacement, and count.
 * - Omit groups with no matching rules.
 * - Render each group with its heading, matched-rule count,
 *   and independent collapse/expand control.
 *
 * Groups MUST come from the imported FoxReplace structure.
 * NEVER derive groups from Candidate names, Starts, similar-looking
 * text, or FR Scanner results.
 *
 * ================================================================
 * 7. DETECT CONFLICTS
 * ================================================================
 *
 * Functions:
 * normalizeConflictText()
 * rulesConflict()
 * buildConflictClusters()
 *
 * - Input: the SAME page-matched rule records used by Groups.
 * - Compare rule pairs using the established conflict-target
 *   normalization.
 * - Recognize equivalent normalized targets, including supported
 *   separator variations.
 * - Do not classify substring or token containment alone as a
 *   conflict.
 * - Preserve each rule's replacement text for conflict display.
 * - Build connected clusters from pairwise conflict relationships.
 * - Exclude rules without a conflict partner.
 * - Sort cluster members by original group index and rule index.
 * - Display each cluster's participating rules, group names,
 *   search text, replacement text, and page match counts.
 *
 * CRITICAL INVARIANT:
 * Conflicts are calculated directly from page-matched FoxReplace
 * rules. Candidate and Start records are NEVER conflict inputs.
 *
 * ================================================================
 * 8. USER INTERFACE
 * ================================================================
 *
 * Functions:
 * renderDebug()
 * renderGroupsTab()
 * renderConflictsTab()
 * renderGroupRule()
 *
 * - Display matched rules beneath their original FoxReplace groups.
 * - Show search text, replacement text, and match count.
 * - Provide independent group collapse/expand state.
 * - Display conflict clusters separately from Groups.
 * - Show each conflicting rule's group, replacement, and count.
 * - Provide useful empty states when no rules match or no conflicts
 *   are found.
 * - Keep import, analyze/refresh, copy, and close controls working.
 * - Support independent panel dragging and resizing.
 * - Save and restore panel dimensions and column widths.
 * - Keep FR Debug UI and styles independent of FR Scanner.
 *
 * ================================================================
 * 9. ANALYSIS ENTRY POINT AND ERROR HANDLING
 * ================================================================
 *
 * Function:
 * analyzeDebugPage()
 *
 * Pipeline order:
 *
 *   1. Read current page text.
 *   2. Match enabled FoxReplace rules eligible for the current site.
 *   3. Keep only rules with one or more page matches.
 *   4. Build Groups from those matched rules.
 *   5. Build Conflicts from those same matched rules.
 *   6. Save analysis results using FR Debug's own state/storage.
 *   7. Render the updated Debug UI.
 *
 * - Handle errors without destroying the imported database.
 * - Isolate invalid rules so individual failures do not stop
 *   unrelated rules from being analyzed.
 * - Report useful errors instead of silently hiding failures.
 * - Never modify the page or execute FoxReplace substitutions.
 *
 * ================================================================
 * 10. EXPLICITLY OUT OF SCOPE
 * ================================================================
 *
 * FR Debug MUST NOT implement or depend on:
 *
 * - Candidate detection
 * - Start detection
 * - Prefix/Suffix analysis
 * - Candidate clustering
 * - Candidate regex templates
 * - Candidate filtering
 * - FR Scanner occurrence-scanning pipelines
 *
 * ================================================================
 * FINAL OUTPUT
 * ================================================================
 *
 * FR Debug produces:
 *
 * - The imported FoxReplace database.
 * - Enabled, eligible rules matching the current page.
 * - Grouped rule matches in original FoxReplace group order.
 * - Conflict clusters derived from those matched rules.
 * - Original search text and replacement text.
 * - Source group/rule indexes and page match counts.
 *
 * CORE DESIGN RULE:
 * Import FoxReplace JSON -> Extract page text -> Match rules ->
 * Build Groups -> Build Conflicts -> Render UI.
 *
 * Keep the data flow explicit. Groups and Conflicts must consume
 * page-matched FoxReplace rules, never unrelated scanner results.
 */
