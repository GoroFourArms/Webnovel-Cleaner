// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      7.0.0
// @description  Small FoxReplace companion for finding chapter candidates, group matches, and rule conflicts.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE = {
        DB: "WNC_FOXREPLACE_DATABASE_V2",
        UI: "WNC_UI_SETTINGS_V1",
        TEMPLATE: "WNC_CANDIDATE_TEMPLATE_V1",
    };

    const UI_ID = "wnc-overlay";
    const STYLE_ID = "wnc-style";
    const CANDIDATE_TEMPLATES = ["Other", "Korean", "Korean 2", "Japanese"];

    const DEFAULT_STATE = {
        screen: "candidates",
        database: { groups: [] },
        candidates: [],
        groups: [],
        conflicts: [],
        template: "Other",
        error: null,
    };

    const state = {
        ...DEFAULT_STATE,
        overlay: null,
    };

    function safeParseJSON(value, fallback) {
        if (value === undefined || value === null) return fallback;
        try {
            return JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    function readStorage(key, fallback) {
        try {
            const value = GM_getValue(key, undefined);
            if (value === undefined) return fallback;
            return safeParseJSON(value, value);
        } catch {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            const payload = typeof value === "string" ? value : JSON.stringify(value);
            GM_setValue(key, payload);
            return true;
        } catch {
            return false;
        }
    }

    function normalizeBoolean(value, fallback = true) {
        if (value === undefined || value === null) return fallback;
        if (typeof value === "boolean") return value;
        if (typeof value === "number") return value !== 0;
        const text = String(value).trim().toLowerCase();
        if (["true", "1", "yes", "on"].includes(text)) return true;
        if (["false", "0", "no", "off"].includes(text)) return false;
        return fallback;
    }

    function normalizeUrls(value) {
        if (Array.isArray(value)) {
            return value.map((item) => String(item ?? "").trim()).filter(Boolean);
        }
        if (typeof value === "string") {
            return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        }
        return [];
    }

    function normalizeRule(rawRule, groupIndex, groupName, ruleIndex) {
        const rule = rawRule && typeof rawRule === "object" ? rawRule : {};
        return {
            input: String(rule.input ?? "").trim(),
            output: String(rule.output ?? "").trim(),
            caseSensitive: normalizeBoolean(rule.caseSensitive, false),
            enabled: normalizeBoolean(rule.enabled, true),
            inputType: String(rule.inputType ?? "text").trim().toLowerCase(),
            outputType: String(rule.outputType ?? "text").trim().toLowerCase(),
            groupIndex,
            groupName: String(groupName ?? ""),
            ruleIndex,
        };
    }

    function normalizeGroup(rawGroup, groupIndex) {
        const group = rawGroup && typeof rawGroup === "object" ? rawGroup : {};
        const rawRules = Array.isArray(group.substitutions)
            ? group.substitutions
            : Array.isArray(group.rules)
              ? group.rules
              : [];

        return {
            index: groupIndex,
            name: String(group.name ?? group.groupName ?? `Group ${groupIndex + 1}`),
            enabled: normalizeBoolean(group.enabled, true),
            urls: normalizeUrls(group.urls ?? group.url ?? group.urlPatterns),
            rules: rawRules.map((rule, ruleIndex) => normalizeRule(rule, groupIndex, group.name ?? group.groupName ?? `Group ${groupIndex + 1}`, ruleIndex)),
        };
    }

    function findGroupArray(value) {
        if (Array.isArray(value)) return value;
        if (!value || typeof value !== "object") return [];

        const candidateKeys = ["groups", "substitutionGroups", "substitutionList", "lists"];
        for (const key of candidateKeys) {
            const groupArray = value[key];
            if (Array.isArray(groupArray)) return groupArray;
        }

        for (const candidate of Object.values(value)) {
            if (Array.isArray(candidate) && candidate.length && candidate.every((item) => item && typeof item === "object")) {
                const looksLikeGroupList = candidate.some((item) => Array.isArray(item.substitutions) || Array.isArray(item.rules) || item.name || item.groupName);
                if (looksLikeGroupList) return candidate;
            }
        }

        return [];
    }

    function adaptDatabase(rawDatabase) {
        const groups = findGroupArray(rawDatabase);
        if (!Array.isArray(groups) || !groups.length) return { groups: [] };
        return {
            groups: groups.map((group, index) => normalizeGroup(group, index)),
        };
    }

    function loadDatabase() {
        const value = readStorage(STORAGE.DB, null);
        if (!value || typeof value !== "object") return { groups: [] };
        return adaptDatabase(value);
    }

    function saveDatabase(database) {
        return writeStorage(STORAGE.DB, database);
    }

    function parseImportedText(text) {
        const source = String(text ?? "").trim();
        if (!source) return null;

        try {
            const value = JSON.parse(source);
            if (!value || typeof value !== "object") return null;
            return adaptDatabase(value);
        } catch {
            return null;
        }
    }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ""));
            reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
            reader.readAsText(file);
        });
    }

    function importDatabaseFromPicker() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.onchange = async () => {
            const file = input.files && input.files[0];
            if (!file) return;
            try {
                const text = await readFileAsText(file);
                const database = parseImportedText(text);
                if (!database || !Array.isArray(database.groups)) throw new Error("Invalid FoxReplace JSON");
                state.database = database;
                saveDatabase(database);
                analyzePage();
                render();
            } catch (error) {
                state.error = error instanceof Error ? error : new Error(String(error));
                render();
            }
        };
        input.click();
    }

    function getCurrentSiteGroups() {
        return (state.database.groups || []).filter((group) => {
            if (!group.enabled) return false;
            if (!Array.isArray(group.urls) || !group.urls.length) return true;
            return group.urls.some((pattern) => urlMatches(pattern, location.href));
        });
    }

    function getCurrentSiteRules() {
        const groups = getCurrentSiteGroups();
        const rules = [];
        for (const group of groups) {
            for (const rule of group.rules || []) {
                if (rule.enabled) {
                    rules.push(rule);
                }
            }
        }
        return rules;
    }

    function escapeRegexLiteral(value) {
        return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function wildcardToRegex(value) {
        const escaped = escapeRegexLiteral(value).replace(/\\\*/g, ".*");
        return new RegExp("^" + escaped + "$");
    }

    function urlMatches(pattern, url) {
        const text = String(pattern ?? "").trim();
        const target = String(url ?? "");
        if (!text || !target) return false;
        if (text.includes("*")) {
            try {
                return wildcardToRegex(text).test(target);
            } catch {
                return false;
            }
        }
        return target.includes(text);
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function normalizeCandidate(value) {
        return String(value ?? "")
            .replace(/[’']/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
    }

    function findPageTextNodes(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest("script, style, noscript, textarea, input, select, button, #wnc-overlay")) continue;
            const text = String(node.textContent ?? "");
            if (text.trim()) nodes.push(node);
        }
        return nodes;
    }

    function scanPageText() {
        const root = document.body || document.documentElement;
        if (!root) return "";

        const nodes = findPageTextNodes(root);
        const chunks = [];

        for (const node of nodes) {
            const text = String(node.textContent || "").replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
            if (!text) continue;
            if (node.parentElement && node.parentElement.closest("script, style, noscript, textarea, input, select, button")) continue;
            chunks.push(text);
        }

        return chunks.join(" ").replace(/\s+/g, " ").trim();
    }

    function scanCandidateOccurrences(text) {
        const matches = [];
        if (!text) return matches;

        const pattern = /(?<![A-Z0-9'’-])((?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*)(?:\s+(?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*))*)(?![A-Za-z0-9'’-])/g;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const value = String(match[1] || "").trim();
            if (!value) continue;
            matches.push({ value, start: match.index });
        }
        return matches;
    }

    function mergeCandidateOccurrences(occurrences) {
        const map = new Map();
        for (const occurrence of occurrences) {
            const value = String(occurrence.value || "").trim();
            if (!value) continue;
            const normalized = normalizeCandidate(value);
            if (!normalized) continue;
            if (!map.has(normalized)) {
                map.set(normalized, {
                    name: value,
                    normalized,
                    frequency: 0,
                    variants: new Map(),
                    originalIndex: occurrence.start,
                });
            }
            const entry = map.get(normalized);
            entry.frequency += 1;
            entry.variants.set(value, (entry.variants.get(value) || 0) + 1);
        }

        return [...map.values()].sort((a, b) => {
            if (b.frequency !== a.frequency) return b.frequency - a.frequency;
            return (a.originalIndex ?? 0) - (b.originalIndex ?? 0);
        });
    }

    function chooseDisplayName(candidate) {
        const variants = [...(candidate.variants?.keys() || [])].filter(Boolean);
        if (!variants.length) return candidate.name;
        const sorted = [...new Set(variants)]
            .filter((item) => normalizeCandidate(item) === candidate.normalized)
            .sort((a, b) => a.length - b.length || a.localeCompare(b));
        return sorted[0] || candidate.name;
    }

    function finalizeCandidateList(candidates) {
        return candidates.map((candidate) => ({
            ...candidate,
            name: chooseDisplayName(candidate),
            generatedInput: "",
        }));
    }

    function buildCandidateRegex(candidate, template) {
        const name = String(candidate.name || candidate.normalized || "").trim();
        if (!name) return "";

        const tokens = name.split(/\s+/).filter(Boolean);
        const clean = tokens.map((token) => token.replace(/[.,!?]/g, "")).filter(Boolean);

        if (!clean.length) return "";

        switch (template) {
            case "Korean": {
                const pattern = clean.map((part) => escapeRegexLiteral(part)).join("[- ]?");
                return `(?<![a-z])${pattern}(?![a-z])`;
            }
            case "Korean 2": {
                const pattern = clean.map((part) => escapeRegexLiteral(part)).join("[- ]?");
                return `(?<![a-z])(?:${pattern})(?![a-z])`;
            }
            case "Japanese": {
                const pattern = clean.map((part) => escapeRegexLiteral(part)).join("\\s+");
                return `(?<![a-z])(?:${pattern})(?![a-z])`;
            }
            case "Other":
            default: {
                const escaped = clean.map((part) => escapeRegexLiteral(part)).join("\\s+");
                return `(?<![a-z])(?:${escaped})(?![a-z])`;
            }
        }
    }

    function collectCandidates(text) {
        const occurrences = scanCandidateOccurrences(text);
        const merged = mergeCandidateOccurrences(occurrences);
        const finalists = finalizeCandidateList(merged).slice(0, 80);
        for (const candidate of finalists) {
            candidate.generatedInput = buildCandidateRegex(candidate, state.template);
        }
        return finalists;
    }

    function compileRuleRegex(rule) {
        if (!rule || rule.inputType !== "regexp") return null;
        try {
            return new RegExp(rule.input, rule.caseSensitive ? "g" : "gi");
        } catch {
            return null;
        }
    }

    function matchesRule(text, rule) {
        if (!rule || !rule.input) return false;
        const source = String(text ?? "");

        if (rule.inputType === "regexp") {
            const regex = compileRuleRegex(rule);
            return !!regex && regex.test(source);
        }

        const pattern = String(rule.input);
        if (rule.caseSensitive) {
            return source.includes(pattern);
        }
        return source.toLowerCase().includes(pattern.toLowerCase());
    }

    function scanFoxReplacePage(text, rules = getCurrentSiteRules()) {
        const matches = [];
        const target = String(text ?? "");
        for (const rule of rules) {
            if (matchesRule(target, rule)) {
                matches.push({ rule, matchCount: 1 });
            }
        }
        return matches;
    }

    function buildGroupMatches(pageMatches, candidates) {
        if (!Array.isArray(pageMatches) || !pageMatches.length) return [];
        const groups = [];
        const map = new Map();

        for (const match of pageMatches) {
            const rule = match.rule;
            const key = String(rule.groupIndex ?? rule.groupName ?? "");
            if (!map.has(key)) {
                map.set(key, {
                    index: Number(rule.groupIndex ?? 0),
                    name: String(rule.groupName || "Untitled group"),
                    rules: [],
                });
                groups.push(map.get(key));
            }
            const group = map.get(key);
            group.rules.push({
                rule,
                matchCount: Number(match.matchCount || 0),
                candidates: candidates.slice(0, 5).map((candidate) => candidate.name),
            });
        }

        return groups;
    }

    function buildConflictData(pageMatches) {
        const conflicts = [];
        for (let i = 0; i < pageMatches.length; i++) {
            const left = pageMatches[i].rule;
            for (let j = i + 1; j < pageMatches.length; j++) {
                const right = pageMatches[j].rule;
                if (left.output && right.output && left.output === right.output) {
                    conflicts.push({
                        clusterId: i + 1,
                        rule: left,
                        target: left.output,
                        matchCount: 1,
                    });
                    conflicts.push({
                        clusterId: i + 1,
                        rule: right,
                        target: right.output,
                        matchCount: 1,
                    });
                }
            }
        }
        return conflicts;
    }

    function getTabLabel(tab) {
        if (tab === "candidates") return `Candidates (${state.candidates.length})`;
        if (tab === "groups") return `Groups (${state.groups.length})`;
        return `Conflicts (${new Set(state.conflicts.map((item) => item.clusterId)).size})`;
    }

    function renderCandidatesTab() {
        if (!state.candidates.length) {
            return `<div class="wnc-empty">No chapter candidates found.</div>`;
        }

        const rows = state.candidates
            .map((candidate) => `
                <tr>
                    <td>${escapeHtml(candidate.name)}</td>
                    <td>${escapeHtml(candidate.frequency || 0)}</td>
                    <td>
                        <button data-copy="${escapeHtml(candidate.generatedInput || "")}">Copy</button>
                        <button data-regex="${escapeHtml(candidate.generatedInput || "")}">Regex</button>
                    </td>
                </tr>
            `)
            .join("");

        return `
            <div class="wnc-panel-body-inner">
                <table class="wnc-table">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Frequency</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function renderGroupsTab() {
        if (!state.groups.length) {
            return `<div class="wnc-empty">No matching groups found.</div>`;
        }

        const rows = state.groups
            .map((group) => group.rules.map((item) => `
                <tr>
                    <td>${escapeHtml(group.name)}</td>
                    <td>${escapeHtml(item.rule.input || "")}</td>
                    <td>${escapeHtml(item.rule.output || "")}</td>
                    <td>${escapeHtml(item.matchCount)}</td>
                </tr>
            `).join(""))
            .join("");

        return `
            <div class="wnc-panel-body-inner">
                <table class="wnc-table">
                    <thead>
                        <tr>
                            <th>Group</th>
                            <th>Input</th>
                            <th>Output</th>
                            <th>Matches</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function renderConflictsTab() {
        if (!state.conflicts.length) {
            return `<div class="wnc-empty">No small conflicts found.</div>`;
        }

        const rows = state.conflicts
            .map((conflict) => `
                <tr>
                    <td>${escapeHtml(conflict.clusterId)}</td>
                    <td>${escapeHtml(conflict.rule.groupName || "")}</td>
                    <td>${escapeHtml(conflict.rule.input || "")}</td>
                    <td>${escapeHtml(conflict.rule.output || "")}</td>
                    <td>${escapeHtml(conflict.target || "")}</td>
                </tr>
            `)
            .join("");

        return `
            <div class="wnc-panel-body-inner">
                <table class="wnc-table">
                    <thead>
                        <tr>
                            <th>Cluster</th>
                            <th>Group</th>
                            <th>Input</th>
                            <th>Output</th>
                            <th>Target</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;
    }

    function renderCurrentTab() {
        if (state.screen === "groups") return renderGroupsTab();
        if (state.screen === "conflicts") return renderConflictsTab();
        return renderCandidatesTab();
    }

    function getCurrentTemplate() {
        return CANDIDATE_TEMPLATES.includes(state.template) ? state.template : "Other";
    }

    function ensureStyles() {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            document.head.appendChild(style);
        }

        style.textContent = `
            #${UI_ID} {
                position: fixed;
                top: 24px;
                left: 50%;
                transform: translateX(-50%);
                width: min(1400px, calc(100vw - 30px));
                max-height: calc(100vh - 40px);
                background: #1a1a1a;
                color: #f5f5f5;
                border: 1px solid #3d3d3d;
                border-radius: 8px;
                box-shadow: 0 12px 30px rgba(0,0,0,0.35);
                z-index: 2147483647;
                font: 12px/1.4 Arial, sans-serif;
                overflow: hidden;
            }
            #${UI_ID} .wnc-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 8px 12px;
                background: #232323;
                border-bottom: 1px solid #3b3b3b;
                font-weight: 700;
            }
            #${UI_ID} .wnc-header button,
            #${UI_ID} .wnc-tabs button,
            #${UI_ID} .wnc-panel-body-inner button {
                background: #2d2d2d;
                color: white;
                border: 1px solid #555;
                border-radius: 4px;
                cursor: pointer;
            }
            #${UI_ID} .wnc-tabs {
                display: flex;
                gap: 6px;
                padding: 8px 12px 0;
                background: #1a1a1a;
            }
            #${UI_ID} .wnc-tabs button {
                padding: 6px 10px;
            }
            #${UI_ID} .wnc-panel-body-inner {
                max-height: calc(100vh - 120px);
                overflow: auto;
                padding: 12px;
            }
            #${UI_ID} .wnc-table {
                width: 100%;
                border-collapse: collapse;
                background: #111;
            }
            #${UI_ID} .wnc-table th,
            #${UI_ID} .wnc-table td {
                border: 1px solid #333;
                padding: 7px 8px;
                text-align: left;
                vertical-align: top;
                white-space: normal;
            }
            #${UI_ID} .wnc-table th {
                background: #1d1d1d;
            }
            #${UI_ID} .wnc-empty {
                padding: 16px;
                opacity: 0.75;
            }
            #${UI_ID} .wnc-template-select {
                display: flex;
                align-items: center;
                gap: 8px;
                margin: 8px 12px 0;
            }
            #${UI_ID} .wnc-template-select select {
                background: #2a2a2a;
                color: white;
                border: 1px solid #666;
                padding: 4px 6px;
            }
        `;
    }

    function render() {
        ensureStyles();
        if (!state.overlay) {
            state.overlay = document.createElement("div");
            state.overlay.id = UI_ID;
            document.body.appendChild(state.overlay);
        }

        const template = getCurrentTemplate();
        state.overlay.innerHTML = `
            <div class="wnc-header">
                <div>Webnovel Cleaner</div>
                <div>
                    <button type="button" data-action="minimize" title="Minimize">−</button>
                    <button type="button" data-action="close" title="Close">×</button>
                </div>
            </div>
            <div class="wnc-template-select">
                <label>Regex template</label>
                <select data-template>
                    ${CANDIDATE_TEMPLATES.map((item) => `<option value="${escapeHtml(item)}" ${item === template ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
                </select>
            </div>
            <div class="wnc-tabs">
                ${["candidates", "groups", "conflicts"].map((tab) => `<button type="button" data-tab="${tab}">${getTabLabel(tab)}</button>`).join("")}
            </div>
            <div class="wnc-body">${renderCurrentTab()}</div>
        `;
    }

    function clearHighlights() {
        document.querySelectorAll("mark.wnc-highlight").forEach((node) => {
            const text = document.createTextNode(node.textContent || "");
            node.replaceWith(text);
        });
    }

    function highlightMatches(value) {
        clearHighlights();
        const needle = String(value ?? "").trim();
        if (!needle) return;

        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const matches = [];
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) continue;
            if (parent.closest("#wnc-overlay, script, style, textarea, input, select, button")) continue;
            if ((node.textContent || "").toLowerCase().includes(needle.toLowerCase())) {
                matches.push(node);
            }
        }

        for (const textNode of matches) {
            const source = textNode.textContent || "";
            const lower = source.toLowerCase();
            let index = 0;
            const fragment = document.createDocumentFragment();
            while (index < source.length) {
                const found = lower.indexOf(needle.toLowerCase(), index);
                if (found === -1) {
                    fragment.appendChild(document.createTextNode(source.slice(index)));
                    break;
                }
                fragment.appendChild(document.createTextNode(source.slice(index, found)));
                const mark = document.createElement("mark");
                mark.className = "wnc-highlight";
                mark.textContent = source.slice(found, found + needle.length);
                fragment.appendChild(mark);
                index = found + needle.length;
            }
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    }

    async function copyText(value) {
        const text = String(value ?? "");
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(text);
                return true;
            }
        } catch {
            // fall through
        }

        try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.setAttribute("readonly", "");
            textarea.style.position = "fixed";
            textarea.style.left = "-9999px";
            document.body.appendChild(textarea);
            textarea.select();
            const copied = document.execCommand("copy");
            textarea.remove();
            return copied;
        } catch {
            return false;
        }
    }

    function openWnc() {
        state.screen = "candidates";
        render();
        analyzePage();
    }

    function closeWnc() {
        clearHighlights();
        if (state.overlay) {
            state.overlay.remove();
            state.overlay = null;
        }
    }

    function analyzePage() {
        try {
            const text = scanPageText();
            const candidates = collectCandidates(text);
            const rules = getCurrentSiteRules();
            const pageMatches = scanFoxReplacePage(text, rules);
            state.candidates = candidates;
            state.groups = buildGroupMatches(pageMatches, candidates);
            state.conflicts = buildConflictData(pageMatches);
            state.error = null;
            render();
        } catch (error) {
            state.error = error instanceof Error ? error : new Error(String(error));
            state.candidates = [];
            state.groups = [];
            state.conflicts = [];
            render();
        }
    }

    function handleClick(event) {
        const action = event.target.closest("[data-action]");
        if (action) {
            const mode = action.getAttribute("data-action");
            if (mode === "close") return closeWnc();
            if (mode === "minimize") {
                if (state.overlay) state.overlay.style.display = state.overlay.style.display === "none" ? "block" : "none";
                return;
            }
        }

        const tab = event.target.closest("[data-tab]");
        if (tab) {
            state.screen = tab.getAttribute("data-tab") || "candidates";
            render();
            return;
        }

        const templateSelect = event.target.closest("[data-template]");
        if (templateSelect) {
            state.template = templateSelect.value;
            writeStorage(STORAGE.TEMPLATE, state.template);
            analyzePage();
            return;
        }

        const copyButton = event.target.closest("[data-copy]");
        if (copyButton) {
            const value = copyButton.getAttribute("data-copy") || "";
            copyText(value);
            return;
        }

        const regexButton = event.target.closest("[data-regex]");
        if (regexButton) {
            const value = regexButton.getAttribute("data-regex") || "";
            highlightMatches(value);
            return;
        }
    }

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== "function") return;

        GM_registerMenuCommand("Open Webnovel Cleaner", function () {
            openWnc();
        });

        GM_registerMenuCommand("Import FoxReplace JSON", function () {
            importDatabaseFromPicker();
        });
    }

    function boot() {
        const savedTemplate = readStorage(STORAGE.TEMPLATE, "Other");
        if (CANDIDATE_TEMPLATES.includes(savedTemplate)) state.template = savedTemplate;

        const savedDatabase = readStorage(STORAGE.DB, null);
        state.database = savedDatabase && typeof savedDatabase === "object" ? adaptDatabase(savedDatabase) : { groups: [] };

        document.addEventListener("click", handleClick, true);
        registerMenuCommands();
    }

    boot();
})();
