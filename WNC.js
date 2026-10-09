// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.3.3
// @description  FoxReplace companion/workbench for finding chapter candidates, groups, and conflicts.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC.js
// @downloadURL  https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC.js
// ==/UserScript==
(function () {
    "use strict";
    const WNC_VERSION = "6.3.3";
    const DB_KEY = "WNC_FOXREPLACE_DATABASE_V2";
    const OCCURRENCE_REGEX =
        /(?<![A-Z0-9'’-])((?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*)(?:\s+(?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*))*)(?![A-Za-z0-9'’-])/g;
    const INPUT_TEMPLATES = ["Other", "Korean", "Korean 2", "Japanese"];
    function readStorage(key, fallback = null) {
        try {
            const value = GM_getValue(key, fallback);
            if (typeof value === "string") {
                try {
                    return JSON.parse(value);
                } catch {
                    return value;
                }
            }
            return value;
        } catch {
            return fallback;
        }
    }
    function writeStorage(key, value) {
        try {
            GM_setValue(key, value);
            return true;
        } catch {
            return false;
        }
    }
    const state = {
        collapsedGroups: new Set(),
        collapsedCandidateClusters: new Set(),
        screen: "candidates",
        candidates: [],
        candidateClusters: [],
        groupMatches: [],
        conflicts: [],
        candidateTemplate:
            readStorage("WNC_CANDIDATE_TEMPLATE_V1", "Other") || "Other",
        expandedRules: new Set(),
        analysisError: null
    };
    const RULE_REGEX_CACHE = new WeakMap();
    let adaptedDatabase = {
        groups: []
    };
    const WNC_UI_SETTINGS_KEY = "WNC_UI_SETTINGS_V1";
    const WNC_DEFAULT_UI_SETTINGS = {
        width: 1400,
        height: null,
        minimized: false
    };
    const WNC_UI_RESIZE_CSS = `
.wnc-overlay {
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    pointer-events: none;
}
.wnc-panel {
    position: fixed;
    top: 24px;
    right: 24px;
    display: flex;
    flex-direction: column;
    min-width: 500px;
    min-height: 200px;
    max-width: calc(100vw - 20px);
    max-height: calc(100vh - 20px);
    box-sizing: border-box;
    overflow: hidden;
    resize: both;
    pointer-events: auto;
    background: #181a1f;
    color: #e8eaed;
    border: 1px solid #454952;
    border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, .45);
    font: 13px/1.4 Arial, sans-serif;
}
.wnc-panel *,
.wnc-panel *::before,
.wnc-panel *::after {
    box-sizing: border-box;
}
.wnc-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    padding: 10px 12px;
    background: #20232a;
    border-bottom: 1px solid #3b3f48;
    cursor: move;
    user-select: none;
}
.wnc-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
    font-weight: 700;
}
.wnc-version {
    flex: 0 0 auto;
    opacity: .55;
    font-size: 11px;
}
.wnc-header button,
.wnc-toolbar button,
.wnc-mini-button {
    border: 1px solid #50545e;
    border-radius: 5px;
    background: #292d35;
    color: #e8eaed;
    padding: 5px 9px;
    cursor: pointer;
}
.wnc-header button:hover,
.wnc-toolbar button:hover,
.wnc-mini-button:hover {
    background: #353a44;
}
.wnc-header button:active,
.wnc-toolbar button:active,
.wnc-mini-button:active {
    background: #404651;
}
.wnc-tabs {
    display: flex;
    flex: 0 0 auto;
    gap: 2px;
    padding: 7px 8px 0;
    background: #20232a;
    border-bottom: 1px solid #3b3f48;
    overflow-x: auto;
}
.wnc-tab {
    flex: 0 0 auto;
    border: 1px solid transparent;
    border-bottom: 0;
    border-radius: 6px 6px 0 0;
    padding: 7px 14px;
    background: transparent;
    color: #aeb4bf;
    cursor: pointer;
}
.wnc-tab:hover {
    color: #fff;
    background: #292d35;
}
.wnc-tab-active {
    color: #fff;
    background: #181a1f;
    border-color: #454952;
}
.wnc-body {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    width: 100%;
    overflow: auto;
    padding: 10px;
}
.wnc-section {
    width: 100%;
    min-width: 0;
}
.wnc-toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    margin-bottom: 10px;
}
.wnc-section-title {
    min-width: 0;
    font-size: 15px;
    font-weight: 700;
    margin-right: auto;
}
.wnc-template-label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: #b9bec8;
}
.wnc-template-select {
    min-width: 120px;
    padding: 5px 7px;
    border: 1px solid #4a4f59;
    border-radius: 5px;
    background: #24272e;
    color: #e8eaed;
}
.wnc-regex-preview {
    min-width: 0;
    max-width: 420px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 5px 8px;
    border: 1px solid #393d46;
    border-radius: 5px;
    background: #111318;
    color: #aeb7c5;
    font-family: monospace;
}
.wnc-table-wrap {
    width: 100%;
    min-width: 0;
    overflow: auto;
    border: 1px solid #393d46;
    border-radius: 7px;
}
.wnc-table {
    width: 100%;
    min-width: 850px;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
}
.wnc-table col.wnc-col-candidate {
    width: 190px;
}
.wnc-table col.wnc-col-prefix {
    width: 150px;
}
.wnc-table col.wnc-col-suffix {
    width: 150px;
}
.wnc-table col.wnc-col-frequency {
    width: 80px;
}
.wnc-table col.wnc-col-input {
    width: 210px;
}
.wnc-table col.wnc-col-regex {
    width: 300px;
}
.wnc-table th,
.wnc-table td {
    position: relative;
    padding: 7px 9px;
    border-right: 1px solid #30343c;
    border-bottom: 1px solid #30343c;
    vertical-align: middle;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.wnc-table th:last-child,
.wnc-table td:last-child {
    border-right: 0;
}
.wnc-table tr:last-child td {
    border-bottom: 0;
}
.wnc-table th {
    position: sticky;
    top: 0;
    z-index: 2;
    background: #252932;
    color: #d8dce3;
    text-align: left;
    font-weight: 700;
}
.wnc-table td {
    background: #1c1f25;
}
.wnc-candidate-row:hover td {
    background: #22262e;
}
.wnc-candidate-name-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
}
.wnc-frequency-cell {
    text-align: center;
    font-weight: 700;
}
.wnc-prefix-cell,
.wnc-suffix-cell {
    color: #b7bfcb;
}
.wnc-input-wrapper,
.wnc-regex-wrapper {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
}
.wnc-candidate-input,
.wnc-regex-input {
    min-width: 0;
    width: 100%;
    height: 28px;
    padding: 4px 7px;
    border: 1px solid #414650;
    border-radius: 4px;
    background: #111318;
    color: #e8eaed;
    font-family: monospace;
}
.wnc-regex-input {
    font-size: 11px;
}
.wnc-mini-button {
    flex: 0 0 auto;
    padding: 4px 7px;
    font-size: 11px;
}
.wnc-cluster-row td {
    background: #242830;
    color: #9da6b4;
    font-weight: 700;
}
.wnc-cluster-label {
    color: #e0e4ea;
}
.wnc-cluster-members {
    opacity: .7;
    font-weight: 400;
}
.wnc-cluster-member td:first-child {
    padding-left: 24px;
}
.wnc-empty {
    padding: 24px;
    text-align: center;
    color: #8e96a3;
}
.wnc-group {
    margin-bottom: 8px;
    border: 1px solid #393d46;
    border-radius: 6px;
    overflow: hidden;
}
.wnc-group-header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 0;
    background: #252932;
    color: #e8eaed;
    text-align: left;
    cursor: pointer;
}
.wnc-group-header:hover {
    background: #2d313a;
}
.wnc-group-marker {
    width: 14px;
    opacity: .75;
}
.wnc-group-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 700;
}
.wnc-group-count,
.wnc-rule-count,
.wnc-conflict-count {
    opacity: .65;
    font-size: 11px;
}
.wnc-group-rules {
    padding: 4px 0;
}
.wnc-rule-row {
    display: grid;
    grid-template-columns:
        minmax(0, 1fr)
        minmax(120px, 30%);
    gap: 10px;
    padding: 7px 10px;
    border-top: 1px solid #30343c;
}
.wnc-rule-main {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
}
.wnc-rule-text,
.wnc-rule-replacement {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.wnc-rule-replacement {
    color: #9da6b4;
}
.wnc-conflict-cluster {
    margin-bottom: 10px;
    border: 1px solid #593f3f;
    border-radius: 6px;
    overflow: hidden;
}
.wnc-conflict-header {
    padding: 8px 10px;
    background: #322326;
    font-weight: 700;
}
.wnc-conflict-rule {
    display: grid;
    grid-template-columns:
        minmax(0, 1fr)
        minmax(100px, 25%)
        50px;
    gap: 10px;
    padding: 7px 10px;
    border-top: 1px solid #3d3033;
}
.wnc-conflict-text,
.wnc-conflict-group {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.wnc-conflict-group {
    color: #9da6b4;
}
.wnc-conflict-count {
    text-align: right;
}
.wnc-toast {
    position: fixed;
    left: 50%;
    bottom: 24px;
    transform: translate(-50%, 15px);
    opacity: 0;
    pointer-events: none;
    z-index: 2147483647;
    padding: 8px 14px;
    border: 1px solid #555b66;
    border-radius: 6px;
    background: #252932;
    color: #fff;
    transition:
        opacity .15s,
        transform .15s;
}
.wnc-toast-visible {
    opacity: 1;
    transform: translate(-50%, 0);
}
.wnc-column-resizer {
    position: absolute;
    right: -3px;
    top: 0;
    width: 7px;
    height: 100%;
    cursor: col-resize;
    z-index: 5;
}
.wnc-column-resizer:hover {
    background: rgba(255,255,255,.08);
}
.wnc-dragging-column,
.wnc-dragging-column * {
    cursor: col-resize !important;
    user-select: none !important;
}
@media (max-width: 900px) {
    .wnc-panel {
        top: 10px;
        right: 10px;
        max-width: calc(100vw - 20px);
        width: calc(100vw - 20px);
    }
}
`;
    function getWncUiSettings() {
        try {
            const raw = GM_getValue(WNC_UI_SETTINGS_KEY, null);
            if (!raw) {
                return {
                    ...WNC_DEFAULT_UI_SETTINGS
                };
            }
            const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
            return {
                ...WNC_DEFAULT_UI_SETTINGS,
                ...(parsed && typeof parsed === "object" ? parsed : {})
            };
        } catch (error) {
            console.warn("[WNC] Unable to load UI settings:", error);
            return {
                ...WNC_DEFAULT_UI_SETTINGS
            };
        }
    }
    function saveWncUiSettings(settings) {
        try {
            GM_setValue(
                WNC_UI_SETTINGS_KEY,
                JSON.stringify({
                    ...WNC_DEFAULT_UI_SETTINGS,
                    ...(settings || {})
                })
            );
        } catch (error) {
            console.warn("[WNC] Unable to save UI settings:", error);
        }
    }
    function applyWncPanelSize(element) {
        if (!element) {
            return;
        }
        const panel = element.classList?.contains("wnc-panel")
            ? element
            : element.querySelector?.(".wnc-panel") || element;
        const settings = getWncUiSettings();
        if (Number.isFinite(Number(settings.width))) {
            panel.style.width = `${Math.max(500, Number(settings.width))}px`;
        }
        if (
            settings.height !== null &&
            Number.isFinite(Number(settings.height))
        ) {
            panel.style.height = `${Math.max(200, Number(settings.height))}px`;
        } else {
            panel.style.height = "auto";
        }
        panel.style.maxWidth = "calc(100vw - 20px)";
        panel.style.maxHeight = "calc(100vh - 20px)";
    }
    function saveWncPanelSize(element) {
        if (!element) {
            return;
        }
        const panel = element.classList?.contains("wnc-panel")
            ? element
            : element.querySelector?.(".wnc-panel") || element;
        if (!panel || panel.classList.contains("wnc-minimized")) {
            return;
        }
        const settings = getWncUiSettings();
        const rect = panel.getBoundingClientRect();
        if (rect.width >= 500) {
            settings.width = Math.round(rect.width);
        }
        if (rect.height >= 200) {
            settings.height = Math.round(rect.height);
        }
        saveWncUiSettings(settings);
    }
    function startWncPanelResizePersistence(element) {
        if (!element) {
            return;
        }
        const panel = element.classList?.contains("wnc-panel")
            ? element
            : element.querySelector?.(".wnc-panel") || element;
        if (!panel || panel.dataset.wncResizePersistence === "1") {
            return;
        }
        panel.dataset.wncResizePersistence = "1";
        let timer = null;
        const saveSize = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                saveWncPanelSize(panel);
            }, 150);
        };
        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(saveSize);
            observer.observe(panel);
            panel._wncResizeObserver = observer;
        }
        if (!window._wncResizeHandler) {
            window._wncResizeHandler = () => {
                const currentPanel = document.querySelector(".wnc-panel");
                if (!currentPanel) {
                    return;
                }
                const settings = getWncUiSettings();
                if (
                    Number.isFinite(Number(settings.width)) &&
                    Number(settings.width) > window.innerWidth - 20
                ) {
                    currentPanel.style.width = `${Math.max(
                        500,
                        window.innerWidth - 20
                    )}px`;
                }
                if (
                    Number.isFinite(Number(settings.height)) &&
                    Number(settings.height) > window.innerHeight - 20
                ) {
                    currentPanel.style.height = `${Math.max(
                        200,
                        window.innerHeight - 20
                    )}px`;
                }
            };
            window.addEventListener("resize", window._wncResizeHandler);
        }
    }
    function normalizeBoolean(value, fallback = true) {
        if (value === undefined || value === null) {
            return fallback;
        }
        if (typeof value === "boolean") {
            return value;
        }
        if (typeof value === "number") {
            return value !== 0;
        }
        const text = String(value).trim().toLowerCase();
        if (["false", "0", "no", "off"].includes(text)) {
            return false;
        }
        if (["true", "1", "yes", "on"].includes(text)) {
            return true;
        }
        return fallback;
    }
    function normalizeRule(rawRule, ruleIndex, groupIndex, groupName = "") {
        const input = String(rawRule?.input ?? "");
        const output = String(rawRule?.output ?? "");
        return {
            raw: rawRule,
            groupIndex,
            groupName: String(groupName ?? ""),
            ruleIndex,
            input,
            output,
            inputType: String(rawRule?.inputType ?? "text")
                .trim()
                .toLowerCase(),
            outputType: String(rawRule?.outputType ?? "text")
                .trim()
                .toLowerCase(),
            caseSensitive: normalizeBoolean(rawRule?.caseSensitive, false),
            enabled: normalizeBoolean(rawRule?.enabled, true),
            html: rawRule?.html ?? null
        };
    }
    function normalizeUrls(value) {
        if (Array.isArray(value)) {
            return value
                .map((item) => String(item ?? "").trim())
                .filter(Boolean);
        }
        if (typeof value === "string") {
            return value
                .split(/\r?\n/)
                .map((item) => item.trim())
                .filter(Boolean);
        }
        return [];
    }
    function normalizeGroup(rawGroup, groupIndex) {
        const group = rawGroup && typeof rawGroup === "object" ? rawGroup : {};
        const name = String(
            group.name ?? group.groupName ?? `Group ${groupIndex + 1}`
        );
        const rawRules = Array.isArray(group.substitutions)
            ? group.substitutions
            : Array.isArray(group.rules)
              ? group.rules
              : [];
        const rules = rawRules.map((rule, ruleIndex) =>
            normalizeRule(rule, ruleIndex, groupIndex, name)
        );
        return {
            raw: group,
            index: groupIndex,
            name,
            urls: normalizeUrls(group.urls ?? group.url ?? group.urlPatterns),
            rules,
            enabled: normalizeBoolean(group.enabled, true),
            mode: String(group.mode ?? ""),
            pageLoad: normalizeBoolean(group.pageLoad, false),
            auto: normalizeBoolean(group.auto, false),
            html: group.html ?? null
        };
    }
    function findGroupArray(database) {
        if (Array.isArray(database)) {
            return database;
        }
        if (!database || typeof database !== "object") {
            return [];
        }
        for (const key of [
            "groups",
            "substitutionGroups",
            "substitutionList",
            "lists"
        ]) {
            if (Array.isArray(database[key])) {
                return database[key];
            }
        }
        for (const value of Object.values(database)) {
            if (
                Array.isArray(value) &&
                value.length &&
                value.every((item) => item && typeof item === "object") &&
                value.some(
                    (item) =>
                        Array.isArray(item.substitutions) ||
                        Array.isArray(item.rules) ||
                        item.name !== undefined ||
                        item.groupName !== undefined
                )
            ) {
                return value;
            }
        }
        return [];
    }
    function adaptFoxReplaceDatabase(rawDatabase) {
        const groups = findGroupArray(rawDatabase);
        if (!Array.isArray(groups) || !groups.length) {
            return {
                groups: []
            };
        }
        const normalizedGroups = [];
        for (let index = 0; index < groups.length; index++) {
            normalizedGroups.push(normalizeGroup(groups[index], index));
        }
        return {
            groups: normalizedGroups
        };
    }
    function parseImportedText(text) {
        const source = String(text ?? "").trim();
        if (!source) {
            return null;
        }
        let database;
        try {
            database = JSON.parse(source);
        } catch {
            return null;
        }
        if (Array.isArray(database)) {
            database = {
                groups: database
            };
        }
        if (!database || typeof database !== "object") {
            return null;
        }
        const groups = findGroupArray(database);
        if (!Array.isArray(groups)) {
            return null;
        }
        return {
            ...database,
            groups
        };
    }
    function readFileText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () =>
                reject(reader.error || new Error("Unable to read file"));
            reader.readAsText(file);
        });
    }
    function ensureDatabaseShape() {
        if (
            !adaptedDatabase ||
            typeof adaptedDatabase !== "object" ||
            !Array.isArray(adaptedDatabase.groups)
        ) {
            adaptedDatabase = {
                groups: []
            };
        }
        adaptedDatabase.groups = adaptedDatabase.groups.filter(
            (group) => group && typeof group === "object"
        );
        for (const group of adaptedDatabase.groups) {
            if (!Array.isArray(group.rules)) {
                group.rules = [];
            }
            group.rules = group.rules.filter(
                (rule) => rule && typeof rule === "object"
            );
        }
        return adaptedDatabase;
    }
    function normalizeGeneratedInputSpacing(value) {
        return String(value ?? "")
            .replace(/\s+/g, " ")
            .trim();
    }
    function generateOtherInput(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.normalized || ""
        );
        if (!value) {
            return "";
        }
        return "(?<![a-z])" + escapeRegExp(value) + "(?![a-z])";
    }
    function generateKoreanInput(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.normalized || ""
        );
        if (!value) {
            return "";
        }
        const original = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.normalized || ""
        );
        const originalTokens = tokenizeCandidate(original);
        const valueTokens = tokenizeCandidate(value);
        let nameTokens = valueTokens;
        if (
            valueTokens.length > 1 &&
            originalTokens.length > 1 &&
            valueTokens[0].toLowerCase() === originalTokens[0].toLowerCase()
        ) {
            nameTokens = valueTokens.slice(1);
        }
        if (!nameTokens.length) {
            return "";
        }
        const pattern = nameTokens
            .map((token) => escapeRegExp(token))
            .join("[- ]?");
        return "(?<![a-z])" + pattern + "(?![a-z])";
    }
    function generateKorean2Input(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.normalized || ""
        );
        if (!value) {
            return "";
        }
        const original = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.normalized || ""
        );
        const originalTokens = tokenizeCandidate(original);
        let nameValue = value;
        if (originalTokens.length > 1) {
            const valueTokens = tokenizeCandidate(value);
            if (
                valueTokens.length > 1 &&
                valueTokens[0].toLowerCase() === originalTokens[0].toLowerCase()
            ) {
                nameValue = valueTokens.slice(1).join(" ");
            }
        }
        const nameTokens = tokenizeCandidate(nameValue);
        if (!nameTokens.length) {
            return "";
        }
        const namePattern = nameTokens
            .map((token) => escapeRegExp(token))
            .join("[- ]?");
        if (originalTokens.length <= 1) {
            return "(?<![a-z])" + namePattern + "(?![a-z])";
        }
        return (
            "(?<![a-z])" +
            "(?:" +
            escapeRegExp(originalTokens[0]) +
            " )?" +
            namePattern +
            "(?![a-z])"
        );
    }
    function generateJapaneseInput(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.normalized || ""
        );
        if (!value) {
            return "";
        }
        const tokens = tokenizeCandidate(value);
        if (tokens.length <= 1) {
            return "(?<![a-z])" + escapeRegExp(value) + "(?![a-z])";
        }
        const forward = tokens.map((token) => escapeRegExp(token)).join("\\s+");
        const reverse = [tokens[tokens.length - 1], ...tokens.slice(0, -1)]
            .map((token) => escapeRegExp(token))
            .join("\\s+");
        return "(?<![a-z])(?:" + forward + "|" + reverse + ")(?![a-z])";
    }
    function openImportPicker() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener(
            "change",
            async () => {
                const file = input.files?.[0];
                if (!file) {
                    return;
                }
                try {
                    const text = await readFileText(file);
                    const database = parseImportedText(text);
                    if (!database) {
                        throw new Error("Invalid FoxReplace JSON");
                    }
                    if (!writeStorage(DB_KEY, database)) {
                        throw new Error("Unable to save FoxReplace database");
                    }
                    adaptedDatabase = adaptFoxReplaceDatabase(database);
                    ensureDatabaseShape();
                    state.analysisError = null;
                    clearAnalysisResults();
                    runAnalysisSafely();
                } catch (error) {
                    state.analysisError =
                        error instanceof Error
                            ? error
                            : new Error(String(error));
                    console.error("[WNC] Import error:", state.analysisError);
                    renderCurrentScreen();
                }
            },
            {
                once: true
            }
        );
        input.click();
    }
    function wildcardToRegex(value) {
        const escaped = escapeRegExp(value);
        return new RegExp("^" + escaped.replace(/\\\*/g, ".*") + "$");
    }
    function urlPatternMatches(pattern, url) {
        const value = String(pattern ?? "").trim();
        const target = String(url ?? "");
        if (!value || !target) {
            return false;
        }
        if (value.includes("*")) {
            try {
                return wildcardToRegex(value).test(target);
            } catch {
                return false;
            }
        }
        return target.includes(value);
    }
    function groupMatchesCurrentSite(group) {
        const urls = Array.isArray(group?.urls) ? group.urls : [];
        if (!urls.length) {
            return true;
        }
        const url = location.href;
        return urls.some((pattern) => urlPatternMatches(pattern, url));
    }
    function getCurrentSiteGroups() {
        return (adaptedDatabase.groups || []).filter(
            (group) => group.enabled && groupMatchesCurrentSite(group)
        );
    }
    function findBestCandidateForStart(starter, candidates) {
        if (!starter || !Array.isArray(candidates) || !candidates.length) {
            return null;
        }
        const starterTokens = getCandidateTokens(starter);
        if (!starterTokens.length) {
            return null;
        }
        let bestCandidate = null;
        let bestLength = 0;
        let bestPosition = Infinity;
        let bestOriginalIndex = Infinity;
        for (const candidate of candidates) {
            if (!candidate) {
                continue;
            }
            const candidateTokens = getCandidateTokens(candidate);
            if (
                !candidateTokens.length ||
                candidateTokens.length > starterTokens.length
            ) {
                continue;
            }
            for (
                let position = 0;
                position <= starterTokens.length - candidateTokens.length;
                position++
            ) {
                let matches = true;
                for (let index = 0; index < candidateTokens.length; index++) {
                    if (
                        starterTokens[position + index] !==
                        candidateTokens[index]
                    ) {
                        matches = false;
                        break;
                    }
                }
                if (!matches) {
                    continue;
                }
                const originalIndex = Number(
                    candidate.originalIndex ?? Infinity
                );
                /*
                 * Selection priority:
                 *
                 * 1. Longest Candidate token sequence.
                 * 2. Earliest occurrence inside the Start.
                 * 3. Earliest original Candidate occurrence.
                 */
                if (
                    candidateTokens.length > bestLength ||
                    (candidateTokens.length === bestLength &&
                        position < bestPosition) ||
                    (candidateTokens.length === bestLength &&
                        position === bestPosition &&
                        originalIndex < bestOriginalIndex)
                ) {
                    bestCandidate = candidate;
                    bestLength = candidateTokens.length;
                    bestPosition = position;
                    bestOriginalIndex = originalIndex;
                }
            }
        }
        if (!bestCandidate) {
            return null;
        }
        return {
            candidate: bestCandidate,
            position: bestPosition,
            length: bestLength
        };
    }
    function tokenizeCandidate(value) {
        return String(value ?? "")
            .replace(/[“”„‟]/g, '"')
            .replace(/[‘’]/g, "'")
            .replace(/[–—−]/g, "-")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }
    function normalizeCandidateToken(token) {
        let value = String(token ?? "")
            .trim()
            .toLowerCase();
        if (!value) {
            return "";
        }
        value = value.replace(/^[("'“”‘’]+/, "").replace(/[)"'“”‘’]+$/, "");
        if (!value) {
            return "";
        }
        // Normalize possessives.
        value = value.replace(/['’]s$/i, "");
        value = value.replace(/s['’]$/i, "s");
        /*
         * Normalize only the plural forms that are reasonably safe.
         *
         * Do NOT blindly strip a final "s":
         * James -> jame
         * Chris -> chri
         * Lucas -> luca
         * This is especially dangerous for names.
         */
        if (value.length > 4 && /ies$/.test(value)) {
            value = value.slice(0, -3) + "y";
        } else if (value.length > 4 && /(ches|shes|xes|zes)$/.test(value)) {
            value = value.slice(0, -2);
        } else if (
            value.length > 4 &&
            /ses$/.test(value) &&
            !/sses$/.test(value)
        ) {
            value = value.slice(0, -2);
        }
        return value;
    }
    function getCandidateTokens(value) {
        const source = typeof value === "string" ? value : (value?.name ?? "");
        return tokenizeCandidate(source)
            .map(normalizeCandidateToken)
            .filter(Boolean);
    }
    function normalizeCandidateIdentity(value) {
        return getCandidateTokens(value).join(" ");
    }
    function normalizeCandidateDisplay(value) {
        return tokenizeCandidate(value).join(" ");
    }
    function isSentenceStart(text, index) {
        if (!text || index <= 0) {
            return false;
        }
        for (let i = index - 1; i >= 0; i--) {
            const character = text[i];
            if (/\s/.test(character)) {
                continue;
            }
            if (/["'“”‘’([{]/.test(character)) {
                continue;
            }
            return /[.!?]/.test(character);
        }
        return false;
    }
    function scanPageText(text) {
        const candidates = [];
        const starts = [];
        const source = String(text ?? "");
        if (!source) {
            return {
                candidates,
                starts
            };
        }
        OCCURRENCE_REGEX.lastIndex = 0;
        let match;
        while ((match = OCCURRENCE_REGEX.exec(source)) !== null) {
            const value = String(match[1] || "").trim();
            if (!value) {
                continue;
            }
            const index = match.index;
            const occurrence = {
                text: value,
                index
            };
            if (isSentenceStart(source, index)) {
                starts.push(occurrence);
            } else {
                candidates.push(occurrence);
            }
        }
        return {
            candidates,
            starts
        };
    }
    function mergeCandidateRecords(records) {
        const candidatesByIdentity = new Map();
        for (const record of records || []) {
            const display = normalizeCandidateDisplay(record?.text);
            const identity = normalizeCandidateIdentity(display);
            if (!identity) continue;
            let candidate = candidatesByIdentity.get(identity);
            if (!candidate) {
                candidate = {
                    name: display,
                    identity,
                    frequency: 0,
                    variants: new Map(),
                    originalIndex: Number(record?.index ?? Infinity)
                };
                candidatesByIdentity.set(identity, candidate);
            }
            candidate.frequency += 1;
            const variant = display || String(record?.text ?? "");
            candidate.variants.set(
                variant,
                (candidate.variants.get(variant) || 0) + 1
            );
            candidate.originalIndex = Math.min(
                candidate.originalIndex,
                Number(record?.index ?? Infinity)
            );
        }
        return [...candidatesByIdentity.values()];
    }
    function finalizeCandidates(rawCandidates) {
        return (rawCandidates || []).map((candidate, index) => {
            const finalized = {
                ...candidate,
                originalIndex: candidate.originalIndex ?? index,
                name: String(candidate.name ?? "").trim(),
                frequency: Number(candidate.frequency || 0),
                variants: candidate.variants
                    ? [...candidate.variants.entries()].map(
                          ([name, frequency]) => ({
                              name,
                              frequency
                          })
                      )
                    : [],
                starts: [],
                prefixes: [],
                suffixes: [],
                prefixCounts: new Map(),
                suffixCounts: new Map()
            };
            finalized.identity = normalizeCandidateIdentity(finalized.name);
            return finalized;
        });
    }
    function createStartRecord(occurrence) {
        const name = normalizeCandidateDisplay(occurrence.text);
        return {
            text: occurrence.text,
            name,
            identity: normalizeCandidateIdentity(name),
            frequency: 1,
            occurrence
        };
    }
    function collectStartRecords(occurrences) {
        const map = new Map();
        for (const occurrence of occurrences || []) {
            const record = createStartRecord(occurrence);
            if (!record.identity) {
                continue;
            }
            let existing = map.get(record.identity);
            if (!existing) {
                existing = {
                    ...record,
                    variants: new Map()
                };
                map.set(record.identity, existing);
            } else {
                existing.frequency += 1;
            }
            const variant = record.name;
            existing.variants.set(
                variant,
                (existing.variants.get(variant) || 0) + 1
            );
            if (
                !existing.occurrence ||
                Number(occurrence.index ?? Infinity) <
                    Number(existing.occurrence.index ?? Infinity)
            ) {
                existing.occurrence = occurrence;
            }
        }
        return [...map.values()];
    }
    function addPrefix(candidate, tokens, frequency) {
        if (!candidate || !tokens.length) {
            return;
        }
        const value = tokens.join(" ");
        const key = normalizeCandidateIdentity(value);
        if (!key) {
            return;
        }
        candidate.prefixCounts.set(
            key,
            (candidate.prefixCounts.get(key) || 0) + frequency
        );
    }
    function addSuffix(candidate, tokens, frequency) {
        if (!candidate || !tokens.length) {
            return;
        }
        const value = tokens.join(" ");
        const key = normalizeCandidateIdentity(value);
        if (!key) {
            return;
        }
        candidate.suffixCounts.set(
            key,
            (candidate.suffixCounts.get(key) || 0) + frequency
        );
    }
    function finalizePrefixSuffix(candidate) {
        candidate.prefixes = [...candidate.prefixCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([value, frequency]) => ({
                value,
                frequency
            }));
        candidate.suffixes = [...candidate.suffixCounts.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .map(([value, frequency]) => ({
                value,
                frequency
            }));
    }
    function startMatchesCandidateExactly(start, candidate) {
        if (!start || !candidate) {
            return false;
        }
        return start.identity === candidate.identity;
    }
    function extractStartAffixes(start, candidate) {
        const startTokens = getCandidateTokens(start.name);
        const candidateTokens = getCandidateTokens(candidate.name);
        if (!startTokens.length || !candidateTokens.length) {
            return {
                prefix: [],
                suffix: []
            };
        }
        const result = findTokenSubsequence(startTokens, candidateTokens);
        if (!result) {
            return {
                prefix: [],
                suffix: []
            };
        }
        return {
            prefix: startTokens.slice(0, result.position),
            suffix: startTokens.slice(result.position + result.length)
        };
    }
    function findTokenSubsequence(sourceTokens, targetTokens) {
        if (
            !Array.isArray(sourceTokens) ||
            !Array.isArray(targetTokens) ||
            !targetTokens.length ||
            targetTokens.length > sourceTokens.length
        ) {
            return null;
        }
        for (
            let position = 0;
            position <= sourceTokens.length - targetTokens.length;
            position++
        ) {
            let matches = true;
            for (let index = 0; index < targetTokens.length; index++) {
                if (sourceTokens[position + index] !== targetTokens[index]) {
                    matches = false;
                    break;
                }
            }
            if (matches) {
                return {
                    position,
                    length: targetTokens.length
                };
            }
        }
        return null;
    }
    function applyTwoPassStartMatching(candidates, starts) {
        const finalizedCandidates = Array.isArray(candidates) ? candidates : [];
        const startRecords = Array.isArray(starts) ? starts : [];
        /*
         * ========================================================
         * PASS 1
         *
         * IDENTICAL STARTS
         *
         * A Start whose normalized token sequence is exactly the
         * same as a Candidate belongs to that Candidate.
         *
         * The Start is consumed without changing candidate frequency.
         *
         * It contributes no Prefix/Suffix data.
         *
         * It does NOT:
         *   - become a child row
         *   - create prefix information
         *   - create suffix information
         *   - remain available to Pass 2
         * ========================================================
         */
        const remainingStarts = [];
        for (const start of startRecords) {
            if (!start || !start.identity) {
                continue;
            }
            let exactCandidate = null;
            for (const candidate of finalizedCandidates) {
                if (startMatchesCandidateExactly(start, candidate)) {
                    exactCandidate = candidate;
                    break;
                }
            }
            if (!exactCandidate) {
                remainingStarts.push(start);
                continue;
            }
            /*
             * Starts are metadata, not candidate occurrences. Do not
             * add their frequency to the candidate.
             *
             * Intentionally do NOT add this Start to:
             *
             * candidate.starts
             * candidate.prefixCounts
             * candidate.suffixCounts
             *
             * It has been completely consumed.
             */
        }
        /*
         * ========================================================
         * PASS 2
         *
         * REMAINING STARTS
         *
         * Each remaining Start gets at most one Candidate.
         *
         * The strongest match is:
         *
         *   1. longest Candidate
         *   2. earliest position in Start
         *   3. earliest original Candidate
         *
         * Only non-identical matches produce Prefix/Suffix data.
         * ========================================================
         */
        const orderedCandidates = finalizedCandidates
            .slice()
            .sort(
                (a, b) =>
                    getCandidateTokens(b).length -
                        getCandidateTokens(a).length ||
                    Number(b.frequency || 0) - Number(a.frequency || 0) ||
                    Number(a.originalIndex ?? Infinity) -
                        Number(b.originalIndex ?? Infinity)
            );
        for (const start of remainingStarts) {
            const match = findBestCandidateForStart(start, orderedCandidates);
            /*
             * IMPORTANT:
             *
             * An unmatched Start is discarded.
             *
             * It NEVER becomes a Candidate.
             */
            if (!match) {
                continue;
            }
            const candidate = match.candidate;
            const frequency = Number(start.frequency) || 0;
            /*
             * Start frequency is used only to weight Prefix/Suffix
             * metadata. It never changes candidate frequency.
             */
            const affixes = extractStartAffixes(start, candidate);
            addPrefix(candidate, affixes.prefix, frequency);
            addSuffix(candidate, affixes.suffix, frequency);
            /*
             * Keep this as internal metadata only.
             *
             * The UI must NOT render this as a child Start row.
             */
            candidate.starts.push({
                name: start.name,
                frequency,
                prefix: affixes.prefix.join(" "),
                suffix: affixes.suffix.join(" ")
            });
        }
        for (const candidate of finalizedCandidates) {
            finalizePrefixSuffix(candidate);
        }
        return finalizedCandidates;
    }
    function getPrefixDisplay(candidate) {
        const prefixes = Array.isArray(candidate?.prefixes)
            ? candidate.prefixes
            : [];
        if (!prefixes.length) {
            return "";
        }
        return prefixes
            .map((item) =>
                item.frequency > 1
                    ? `${item.value} (${item.frequency})`
                    : item.value
            )
            .join(", ");
    }
    function getSuffixDisplay(candidate) {
        const suffixes = Array.isArray(candidate?.suffixes)
            ? candidate.suffixes
            : [];
        if (!suffixes.length) {
            return "";
        }
        return suffixes
            .map((item) =>
                item.frequency > 1
                    ? `${item.value} (${item.frequency})`
                    : item.value
            )
            .join(", ");
    }
    function getCandidateFrequency(candidate) {
        return Number(candidate?.frequency || 0);
    }
    function compareCandidates(a, b) {
        return (
            getCandidateFrequency(b) - getCandidateFrequency(a) ||
            String(a?.name || "").localeCompare(String(b?.name || ""))
        );
    }
    function candidateSharesToken(first, second) {
        const firstTokens = new Set(getCandidateTokens(first));
        const secondTokens = getCandidateTokens(second);
        for (const token of secondTokens) {
            if (firstTokens.has(token)) {
                return true;
            }
        }
        return false;
    }
    function candidatesAreRelated(first, second) {
        return candidateSharesToken(first, second);
    }
    function buildCandidateClusters(candidates) {
        const source = Array.isArray(candidates)
            ? candidates.slice().sort(compareCandidates)
            : [];
        const unclustered = new Set(source);
        const clusters = [];
        while (unclustered.size) {
            const seed = source.find((candidate) => unclustered.has(candidate));
            if (!seed) break;
            const members = [seed];
            for (const candidate of source) {
                if (candidate === seed || !unclustered.has(candidate)) continue;
                if (candidatesAreRelated(seed, candidate))
                    members.push(candidate);
            }
            members.sort((a, b) =>
                a === seed ? -1 : b === seed ? 1 : compareCandidates(a, b)
            );
            for (const member of members) unclustered.delete(member);
            clusters.push({ seed, members });
        }
        return clusters;
    }
    function removeWeakSingletons(candidates, clusters) {
        const source = Array.isArray(candidates) ? candidates : [];
        if (!source.length) {
            return [];
        }
        const maximumFrequency = Math.max(
            ...source.map(getCandidateFrequency),
            0
        );
        if (maximumFrequency <= 0) {
            return source;
        }
        const minimumFrequency = maximumFrequency * 0.05;
        const retained = new Set();
        for (const cluster of clusters || []) {
            const members = Array.isArray(cluster.members)
                ? cluster.members
                : [];
            /*
             * All multi-member clusters survive.
             */
            if (members.length > 1) {
                for (const member of members) {
                    retained.add(member);
                }
                continue;
            }
            /*
             * A singleton survives only if it reaches
             * the 5% threshold.
             */
            const member = members[0];
            if (member && getCandidateFrequency(member) >= minimumFrequency) {
                retained.add(member);
            }
        }
        return source.filter((candidate) => retained.has(candidate));
    }
    function getCandidateRuleInput(candidate) {
        return String(candidate?.name || "").trim();
    }
    function generateRegex(value, template = state.candidateTemplate) {
        const source = String(value ?? "").trim();
        if (!source) {
            return "";
        }
        const escaped = escapeRegExp(source);
        switch (String(template || "Other")) {
            case "Korean":
                return (
                    "(?<![가-힣A-Za-z0-9])" + escaped + "(?![가-힣A-Za-z0-9])"
                );
            case "Korean 2":
                return "(?<![가-힣])" + escaped + "(?![가-힣])";
            case "Japanese":
                return (
                    "(?<![一-龯々〆ヵぁ-んァ-ンA-Za-z0-9])" +
                    escaped +
                    "(?![一-龯々〆ヵぁ-んァ-ンA-Za-z0-9])"
                );
            case "Other":
            default:
                return "\\b" + escaped + "\\b";
        }
    }
    function regenerateCandidateInputs(
        candidates,
        template = state.candidateTemplate
    ) {
        for (const candidate of candidates || []) {
            candidate.regex = generateRegex(
                getCandidateRuleInput(candidate),
                template
            );
        }
        return candidates;
    }
    function buildCandidateResults(pageText) {
        const scanned = scanPageText(pageText);
        const mergedCandidates = mergeCandidateRecords(scanned.candidates);
        const candidates = finalizeCandidates(mergedCandidates);
        const starts = collectStartRecords(scanned.starts);
        applyTwoPassStartMatching(candidates, starts);
        return {
            candidates: candidates.sort(compareCandidates),
            starts,
            scanned
        };
    }
    function escapeRegExp(value) {
        return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function compileRuleRegex(rule) {
        if (!rule || typeof rule !== "object") {
            return null;
        }
        if (RULE_REGEX_CACHE.has(rule)) {
            return RULE_REGEX_CACHE.get(rule);
        }
        let source = ruleText(rule);
        if (!source) {
            RULE_REGEX_CACHE.set(rule, null);
            return null;
        }
        let expression = null;
        if (
            source.length >= 2 &&
            source.startsWith("/") &&
            source.lastIndexOf("/") > 0
        ) {
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
            rule.isRegex === true ||
            rule.regexp === true;
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
        const regex = compileRuleRegex(rule);
        if (!regex || !pageText) {
            return 0;
        }
        regex.lastIndex = 0;
        let count = 0;
        while (regex.exec(pageText)) {
            count++;
            /*
             * Prevent an empty regular expression from looping
             * forever.
             */
            if (regex.lastIndex === 0) {
                break;
            }
        }
        regex.lastIndex = 0;
        return count;
    }
    function ruleText(rule) {
        if (!rule || typeof rule !== "object") {
            return "";
        }
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
        const value = values.find(
            (item) => typeof item === "string" && item.trim()
        );
        return String(value || "").trim();
    }
    function ruleReplacement(rule) {
        if (!rule || typeof rule !== "object") {
            return "";
        }
        const values = [rule.replace, rule.replacement, rule.to, rule.value];
        const value = values.find((item) => typeof item === "string");
        return String(value || "");
    }
    function getRuleId(rule, groupIndex, ruleIndex) {
        if (
            rule &&
            (rule.id !== undefined ||
                rule.uid !== undefined ||
                rule.key !== undefined)
        ) {
            return String(rule.id ?? rule.uid ?? rule.key);
        }
        return [groupIndex, ruleIndex, ruleText(rule)].join(":");
    }
    function getGroupName(group, index) {
        if (typeof group === "string") {
            return group;
        }
        if (!group || typeof group !== "object") {
            return `Group ${index + 1}`;
        }
        return String(
            group.name ?? group.title ?? group.label ?? `Group ${index + 1}`
        );
    }
    function getGroupRules(group) {
        if (Array.isArray(group?.rules)) {
            return group.rules;
        }
        if (Array.isArray(group?.items)) {
            return group.items;
        }
        if (Array.isArray(group?.entries)) {
            return group.entries;
        }
        return [];
    }
    function normalizeAdaptedDatabase(database) {
        if (!database || typeof database !== "object") {
            return {
                groups: []
            };
        }
        if (Array.isArray(database.groups)) {
            return database;
        }
        if (Array.isArray(database)) {
            return {
                groups: database
            };
        }
        return {
            groups: []
        };
    }
    function matchPageRules(pageText, database) {
        const adapted = normalizeAdaptedDatabase(database);
        const matches = [];
        adapted.groups.forEach((group, groupIndex) => {
            if (group?.enabled === false || !groupMatchesCurrentSite(group)) {
                return;
            }
            const rules = getGroupRules(group);
            const groupName = getGroupName(group, groupIndex);
            rules.forEach((rule, ruleIndex) => {
                if (rule?.enabled === false) {
                    return;
                }
                const count = countRuleMatches(rule, pageText);
                if (count <= 0) {
                    return;
                }
                matches.push({
                    rule,
                    ruleIndex,
                    group,
                    groupIndex,
                    groupName,
                    ruleId: getRuleId(rule, groupIndex, ruleIndex),
                    text: ruleText(rule),
                    replacement: ruleReplacement(rule),
                    count
                });
            });
        });
        return matches;
    }
    function candidateMatchesRule(candidate, matchedRule) {
        if (!candidate || !matchedRule) {
            return false;
        }
        const candidateTokens = getCandidateTokens(candidate);
        const ruleTextValue = ruleText(matchedRule);
        if (!candidateTokens.length || !ruleTextValue) {
            return false;
        }
        const ruleTokens = tokenizeCandidate(ruleTextValue);
        if (candidateTokens.length !== ruleTokens.length) {
            return false;
        }
        for (let index = 0; index < candidateTokens.length; index++) {
            if (
                candidateTokens[index] !==
                normalizeCandidateToken(ruleTokens[index])
            ) {
                return false;
            }
        }
        return true;
    }
    function filterCandidatesAgainstRules(candidates, pageRuleMatches) {
        const source = Array.isArray(candidates) ? candidates : [];
        const matches = Array.isArray(pageRuleMatches) ? pageRuleMatches : [];
        const matchedCandidates = new Set();
        for (const candidate of source) {
            for (const pageRule of matches) {
                if (candidateMatchesRule(candidate, pageRule)) {
                    matchedCandidates.add(candidate);
                    break;
                }
            }
        }
        return {
            retained: source.filter(
                (candidate) => !matchedCandidates.has(candidate)
            ),
            matched: source.filter((candidate) =>
                matchedCandidates.has(candidate)
            )
        };
    }
    function buildGroupMatches(pageRuleMatches) {
        const matches = Array.isArray(pageRuleMatches) ? pageRuleMatches : [];
        const groups = [];
        const groupMap = new Map();
        for (const pageMatch of matches) {
            if (!pageMatch?.rule) {
                continue;
            }
            const groupIndex = Number(pageMatch.groupIndex ?? 0);
            let group = groupMap.get(groupIndex);
            if (!group) {
                group = {
                    groupIndex,
                    group: pageMatch.group || null,
                    name: String(pageMatch.groupName || ""),
                    rules: []
                };
                groupMap.set(groupIndex, group);
                groups.push(group);
            }
            if (!group.rules.some((rule) => rule.ruleId === pageMatch.ruleId)) {
                group.rules.push(pageMatch);
            }
        }
        return groups;
    }
    function normalizeConflictText(value) {
        return normalizeCandidateIdentity(String(value ?? ""));
    }
    function rulesConflict(first, second) {
        if (!first || !second) {
            return false;
        }
        const firstText = String(first.text ?? "").trim();
        const secondText = String(second.text ?? "").trim();
        if (!firstText || !secondText) {
            return false;
        }
        /*
         * Normalize the actual rule expressions independently.
         *
         * Conflict detection must never be based merely on one
         * rule's text appearing inside another rule's text.
         *
         * Example:
         *
         *   hyeong
         *   min-hyeong
         *
         * These do NOT conflict merely because "hyeong" occurs
         * inside "min-hyeong".
         *
         * Exact equivalent targets DO conflict.
         */
        const firstNormalized = normalizeConflictText(firstText);
        const secondNormalized = normalizeConflictText(secondText);
        if (
            firstNormalized &&
            secondNormalized &&
            firstNormalized === secondNormalized
        ) {
            return true;
        }
        /*
         * Detect the important broad/narrow form where two rules
         * represent the same target but use different separators
         * or boundary syntax.
         *
         * Strip common regex boundary assertions and normalize
         * separator variants before comparing.
         */
        const normalizeConflictTarget = (value) => {
            let text = String(value ?? "").trim();
            if (!text) {
                return "";
            }
            text = text
                .replace(/^\(\?<=[^)]+\)/g, "")
                .replace(/^\(\?<![^)]+\)/g, "")
                .replace(/\(\?=[^)]+\)$/g, "")
                .replace(/\(\?![^)]+\)$/g, "");
            /*
             * Remove common non-capturing/group syntax when it is
             * only being used to express separator alternatives.
             */
            text = text
                .replace(/\\b/g, "")
                .replace(/\\B/g, "")
                .replace(/[\^$]/g, "");
            /*
             * Treat the common name separators as equivalent.
             *
             * ji-hun
             * ji hun
             * ji[- ]?hun
             *
             * become the same logical target.
             */
            text = text
                .replace(/\[-\s?\]\?/g, " ")
                .replace(/\[-\s\]\?/g, " ")
                .replace(/\\?[-–—]/g, " ")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
            return text;
        };
        const firstTarget = normalizeConflictTarget(firstText);
        const secondTarget = normalizeConflictTarget(secondText);
        if (firstTarget && secondTarget && firstTarget === secondTarget) {
            return true;
        }
        /*
         * Do NOT use findTokenSubsequence() here.
         *
         * Substring/token containment is not sufficient evidence
         * of a conflict.
         */
        return false;
    }
    function buildConflictClusters(pageRuleMatches) {
        const rules = Array.isArray(pageRuleMatches) ? pageRuleMatches : [];
        const visited = new Set();
        const clusters = [];
        for (let i = 0; i < rules.length; i++) {
            if (visited.has(i)) {
                continue;
            }
            const cluster = [];
            const queue = [i];
            visited.add(i);
            while (queue.length) {
                const index = queue.shift();
                const rule = rules[index];
                cluster.push(rule);
                for (let j = 0; j < rules.length; j++) {
                    if (visited.has(j)) {
                        continue;
                    }
                    if (rulesConflict(rule, rules[j])) {
                        visited.add(j);
                        queue.push(j);
                    }
                }
            }
            if (cluster.length > 1) {
                cluster.sort(
                    (a, b) =>
                        a.groupIndex - b.groupIndex || a.ruleIndex - b.ruleIndex
                );
                clusters.push(cluster);
            }
        }
        return clusters;
    }
    function clearAnalysisResults() {
        state.candidates = [];
        state.candidateClusters = [];
        state.groupMatches = [];
        state.conflicts = [];
        state.analysisError = null;
    }
    /* ================= ANALYSIS PIPELINE ================= */
    function buildAnalysisResult(pageText, database) {
        /*
         * ========================================================
         * 1. CANDIDATES / STARTS
         *
         * buildCandidateResults() performs:
         *
         *   page scan
         *   candidate establishment
         *   Start collection
         *   Pass 1 identical Start matching
         *   Pass 2 remaining Start matching
         *   Prefix/Suffix aggregation
         *   Candidate frequency finalization
         * ========================================================
         */
        const candidateResult = buildCandidateResults(pageText);
        /*
         * ========================================================
         * 2. PAGE-MATCHED FOXREPLACE RULES
         *
         * This is the ONLY page-rule matching stage.
         *
         * Only rules that actually match this page are allowed
         * to:
         *
         *   - absorb Candidates
         *   - appear in Groups
         *   - participate in Conflicts
         * ========================================================
         */
        const pageRuleMatches = matchPageRules(pageText, database);
        /*
         * ========================================================
         * 3. RULE ABSORPTION
         *
         * Candidates that have an exact-equivalent
         * page-matched FoxReplace rule are removed from
         * Candidate output.
         *
         * The FoxReplace rule itself remains in Groups.
         * ========================================================
         */
        const filtered = filterCandidatesAgainstRules(
            candidateResult.candidates,
            pageRuleMatches
        );
        const retainedCandidates = filtered.retained;
        /*
         * ========================================================
         * 4. REBUILD CLUSTERS AFTER ABSORPTION
         *
         * Candidate clusters must describe the Candidates that
         * actually remain visible.
         *
         * A Candidate absorbed by FoxReplace must not remain in
         * the cluster structure.
         * ========================================================
         */
        const initialClusters = buildCandidateClusters(retainedCandidates);
        const retainedAfterSingletonFilter = removeWeakSingletons(
            retainedCandidates,
            initialClusters
        );
        const retainedSet = new Set(retainedAfterSingletonFilter);
        const candidateClusters = initialClusters
            .map((cluster) => ({
                ...cluster,
                members: cluster.members.filter((member) =>
                    retainedSet.has(member)
                )
            }))
            .filter((cluster) => cluster.members.length > 0);
        regenerateCandidateInputs(retainedAfterSingletonFilter);
        /*
         * ========================================================
         * 5. GROUPS
         *
         * Groups are built exclusively from page-matched rules.
         *
         * Candidate information is used only to determine whether
         * a candidate was absorbed; it is not used to discover
         * additional FoxReplace rules.
         * ========================================================
         */
        const groupMatches = buildGroupMatches(pageRuleMatches);
        /*
         * ========================================================
         * 6. CONFLICTS
         *
         * Conflicts operate directly on page-matched FoxReplace
         * rules.
         *
         * Candidates and Starts are deliberately excluded.
         * ========================================================
         */
        const conflictClusters = buildConflictClusters(pageRuleMatches);
        return {
            pageText,
            scanned: candidateResult.scanned,
            starts: candidateResult.starts,
            /*
             * Candidates before FoxReplace absorption.
             */
            allCandidates: candidateResult.candidates,
            /*
             * Candidates absorbed by page-matched rules.
             */
            matchedCandidates: filtered.matched,
            /*
             * Candidates remaining for Candidate output.
             */
            candidates: retainedAfterSingletonFilter.sort(compareCandidates),
            candidateClusters,
            pageRuleMatches,
            groupMatches,
            conflicts: conflictClusters
        };
    }
    function getCandidateDisplayName(candidate) {
        return String(candidate?.name || "").trim();
    }
    function getCandidateRegex(candidate) {
        if (candidate?.regex) {
            return String(candidate.regex);
        }
        return generateRegex(
            getCandidateDisplayName(candidate),
            state.candidateTemplate
        );
    }
    function copyText(value) {
        const text = String(value ?? "");
        if (!text) {
            return Promise.resolve(false);
        }
        if (
            navigator.clipboard &&
            typeof navigator.clipboard.writeText === "function"
        ) {
            return navigator.clipboard.writeText(text).then(
                () => true,
                () => {
                    return copyTextFallback(text);
                }
            );
        }
        return Promise.resolve(copyTextFallback(text));
    }
    function copyTextFallback(text) {
        const textarea = document.createElement("textarea");
        textarea.value = String(text);
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        textarea.style.top = "0";
        document.body.appendChild(textarea);
        textarea.select();
        let success = false;
        try {
            success = document.execCommand("copy");
        } catch (error) {
            success = false;
        }
        textarea.remove();
        return success;
    }
    function showTemporaryMessage(message) {
        let element = document.querySelector(".wnc-toast");
        if (!element) {
            element = document.createElement("div");
            element.className = "wnc-toast";
            document.body.appendChild(element);
        }
        element.textContent = String(message);
        element.classList.add("wnc-toast-visible");
        clearTimeout(element._wncTimer);
        element._wncTimer = setTimeout(() => {
            element.classList.remove("wnc-toast-visible");
        }, 1800);
    }
    function createElement(tag, className, text) {
        const element = document.createElement(tag);
        if (className) {
            element.className = className;
        }
        if (text !== undefined) {
            element.textContent = String(text);
        }
        return element;
    }
    function renderCandidateInput(candidate) {
        const wrapper = createElement("div", "wnc-input-wrapper");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "wnc-candidate-input";
        input.value = getCandidateDisplayName(candidate);
        input.title = "Candidate input";
        input.readOnly = true;
        wrapper.appendChild(input);
        const copy = createElement("button", "wnc-mini-button", "Copy");
        copy.type = "button";
        copy.addEventListener("click", async () => {
            const ok = await copyText(input.value);
            showTemporaryMessage(ok ? "Copied" : "Copy failed");
        });
        wrapper.appendChild(copy);
        return wrapper;
    }
    function renderCandidateRegex(candidate) {
        const wrapper = createElement("div", "wnc-regex-wrapper");
        const input = document.createElement("input");
        input.type = "text";
        input.className = "wnc-regex-input";
        input.value = getCandidateRegex(candidate);
        input.readOnly = true;
        wrapper.appendChild(input);
        const copy = createElement("button", "wnc-mini-button", "Copy");
        copy.type = "button";
        copy.addEventListener("click", async () => {
            const ok = await copyText(input.value);
            showTemporaryMessage(ok ? "Regex copied" : "Copy failed");
        });
        wrapper.appendChild(copy);
        return wrapper;
    }
    function renderCandidateRow(candidate, index) {
        const row = createElement("tr", "wnc-candidate-row");
        row.dataset.index = String(index);
        const nameCell = createElement("td", "wnc-candidate-name");
        const name = createElement(
            "div",
            "wnc-candidate-name-text",
            getCandidateDisplayName(candidate)
        );
        nameCell.appendChild(name);
        row.appendChild(nameCell);
        const prefixCell = createElement("td", "wnc-prefix-cell");
        prefixCell.textContent = getPrefixDisplay(candidate);
        row.appendChild(prefixCell);
        const suffixCell = createElement("td", "wnc-suffix-cell");
        suffixCell.textContent = getSuffixDisplay(candidate);
        row.appendChild(suffixCell);
        const frequencyCell = createElement("td", "wnc-frequency-cell");
        frequencyCell.textContent = String(getCandidateFrequency(candidate));
        row.appendChild(frequencyCell);
        const inputCell = createElement("td", "wnc-input-cell");
        inputCell.appendChild(renderCandidateInput(candidate));
        row.appendChild(inputCell);
        const regexCell = createElement("td", "wnc-regex-cell");
        regexCell.appendChild(renderCandidateRegex(candidate));
        row.appendChild(regexCell);
        /*
         * Deliberately do NOT render:
         *
         * candidate.starts
         *
         * Identical Starts are consumed completely in Pass 1.
         * Non-identical Starts are represented only through
         * Prefix/Suffix.
         */
        return row;
    }
    function renderClusterRows(tableBody, clusters) {
        if (!tableBody || !Array.isArray(clusters)) return;
        const candidateIndex = new Map();
        state.candidates.forEach((candidate, index) =>
            candidateIndex.set(candidate, index)
        );
        clusters.forEach((cluster, clusterIndex) => {
            const members = Array.isArray(cluster.members)
                ? cluster.members
                : [];
            if (!members.length) return;
            const root = members.includes(cluster.seed)
                ? cluster.seed
                : members[0];
            const ordered = [
                root,
                ...members
                    .filter((candidate) => candidate !== root)
                    .sort(compareCandidates)
            ];
            const collapsed = state.collapsedCandidateClusters.has(root);
            ordered.forEach((candidate, memberIndex) => {
                if (memberIndex > 0 && collapsed) return;
                const index = candidateIndex.get(candidate);
                if (index === undefined) return;
                const row = renderCandidateRow(candidate, index);
                if (memberIndex === 0 && ordered.length > 1) {
                    const nameCell = row.querySelector(".wnc-candidate-name");
                    const name = nameCell?.querySelector(
                        ".wnc-candidate-name-text"
                    );
                    if (nameCell && name) {
                        const toggle = createElement(
                            "button",
                            "wnc-cluster-toggle",
                            collapsed ? "+" : "−"
                        );
                        toggle.type = "button";
                        toggle.title = collapsed
                            ? "Expand candidate cluster"
                            : "Collapse candidate cluster";
                        toggle.setAttribute(
                            "aria-expanded",
                            String(!collapsed)
                        );
                        toggle.addEventListener("click", () => {
                            if (state.collapsedCandidateClusters.has(root))
                                state.collapsedCandidateClusters.delete(root);
                            else state.collapsedCandidateClusters.add(root);
                            renderCurrentScreen();
                        });
                        nameCell.insertBefore(toggle, name);
                        row.classList.add("wnc-cluster-root");
                    }
                } else if (memberIndex > 0) {
                    row.classList.add("wnc-cluster-member");
                }
                tableBody.appendChild(row);
            });
        });
    }
    function renderCandidatesTab(container) {
        const section = createElement("section", "wnc-section");
        const toolbar = createElement("div", "wnc-toolbar");
        const title = createElement("div", "wnc-section-title", "Candidates");
        toolbar.appendChild(title);
        const templateLabel = createElement(
            "label",
            "wnc-template-label",
            "Regex template"
        );
        const select = document.createElement("select");
        select.className = "wnc-template-select";
        INPUT_TEMPLATES.forEach((template) => {
            const option = document.createElement("option");
            option.value = template;
            option.textContent = template;
            option.selected = state.candidateTemplate === template;
            select.appendChild(option);
        });
        select.addEventListener("change", () => {
            state.candidateTemplate = select.value;
            writeStorage("WNC_CANDIDATE_TEMPLATE_V1", state.candidateTemplate);
            regenerateCandidateInputs(state.candidates);
            renderCurrentScreen();
        });
        templateLabel.appendChild(select);
        toolbar.appendChild(templateLabel);
        const regexPreview = createElement("span", "wnc-regex-preview");
        if (state.candidates.length) {
            regexPreview.textContent = getCandidateRegex(state.candidates[0]);
        } else {
            regexPreview.textContent = "Regex preview";
        }
        toolbar.appendChild(regexPreview);
        section.appendChild(toolbar);
        const tableWrap = createElement("div", "wnc-table-wrap");
        const table = document.createElement("table");
        table.className = "wnc-table wnc-candidate-table";
        const colGroup = document.createElement("colgroup");
        [
            ["candidate", "Candidate"],
            ["prefix", "Prefix"],
            ["suffix", "Suffix"],
            ["frequency", "Frequency"],
            ["input", "Input"],
            ["regex", "Regex"]
        ].forEach(([key, label]) => {
            const col = document.createElement("col");
            col.dataset.column = key;
            col.className = `wnc-col-${key}`;
            colGroup.appendChild(col);
        });
        table.appendChild(colGroup);
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        [
            "Candidate",
            "Prefix",
            "Suffix",
            "Frequency",
            "Input",
            "Regex"
        ].forEach((label, index) => {
            const th = document.createElement("th");
            th.textContent = label;
            th.dataset.columnIndex = String(index);
            addColumnResizer(th, table);
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        table.appendChild(tbody);
        if (!state.candidates.length) {
            const empty = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = 6;
            cell.className = "wnc-empty";
            cell.textContent = "No candidates found.";
            empty.appendChild(cell);
            tbody.appendChild(empty);
        } else {
            renderClusterRows(tbody, state.candidateClusters);
        }
        tableWrap.appendChild(table);
        section.appendChild(tableWrap);
        container.appendChild(section);
        restoreColumnWidths(table);
    }
    function renderGroupRule(ruleMatch) {
        const row = createElement("div", "wnc-rule-row");
        const left = createElement("div", "wnc-rule-main");
        const ruleTextElement = createElement(
            "span",
            "wnc-rule-text",
            ruleMatch.text
        );
        left.appendChild(ruleTextElement);
        const count = createElement(
            "span",
            "wnc-rule-count",
            String(ruleMatch.count)
        );
        left.appendChild(count);
        row.appendChild(left);
        const replacement = createElement(
            "span",
            "wnc-rule-replacement",
            ruleMatch.replacement
        );
        row.appendChild(replacement);
        return row;
    }
    function renderGroupsTab(container) {
        const section = createElement("section", "wnc-section");
        const title = createElement("div", "wnc-section-title", "Groups");
        section.appendChild(title);
        const groups = Array.isArray(state.groupMatches)
            ? state.groupMatches
            : [];
        if (!groups.length) {
            const empty = createElement(
                "div",
                "wnc-empty",
                "No matched groups."
            );
            section.appendChild(empty);
            container.appendChild(section);
            return;
        }
        groups.forEach((group, groupIndex) => {
            const wrapper = createElement("div", "wnc-group");
            const header = createElement("button", "wnc-group-header");
            header.type = "button";
            const collapsed = state.collapsedGroups.has(group.groupIndex);
            header.setAttribute("aria-expanded", String(!collapsed));
            const marker = createElement(
                "span",
                "wnc-group-marker",
                collapsed ? "▶" : "▼"
            );
            header.appendChild(marker);
            header.appendChild(
                createElement("span", "wnc-group-name", group.name)
            );
            header.appendChild(
                createElement(
                    "span",
                    "wnc-group-count",
                    String(group.rules.length)
                )
            );
            header.addEventListener("click", () => {
                if (state.collapsedGroups.has(group.groupIndex)) {
                    state.collapsedGroups.delete(group.groupIndex);
                } else {
                    state.collapsedGroups.add(group.groupIndex);
                }
                renderCurrentScreen();
            });
            wrapper.appendChild(header);
            if (!collapsed) {
                const rules = createElement("div", "wnc-group-rules");
                group.rules.forEach((ruleMatch) => {
                    rules.appendChild(renderGroupRule(ruleMatch));
                });
                wrapper.appendChild(rules);
            }
            section.appendChild(wrapper);
        });
        container.appendChild(section);
    }
    function renderConflictsTab(container) {
        const section = createElement("section", "wnc-section");
        const title = createElement("div", "wnc-section-title", "Conflicts");
        section.appendChild(title);
        const conflicts = Array.isArray(state.conflicts) ? state.conflicts : [];
        if (!conflicts.length) {
            section.appendChild(
                createElement("div", "wnc-empty", "No conflicts found.")
            );
            container.appendChild(section);
            return;
        }
        conflicts.forEach((cluster, clusterIndex) => {
            const wrapper = createElement("div", "wnc-conflict-cluster");
            const header = createElement(
                "div",
                "wnc-conflict-header",
                `Conflict ${clusterIndex + 1}`
            );
            wrapper.appendChild(header);
            cluster.forEach((rule) => {
                const row = createElement("div", "wnc-conflict-rule");
                const text = createElement(
                    "span",
                    "wnc-conflict-text",
                    rule.text
                );
                row.appendChild(text);
                const group = createElement(
                    "span",
                    "wnc-conflict-group",
                    rule.groupName
                );
                row.appendChild(group);
                const count = createElement(
                    "span",
                    "wnc-conflict-count",
                    String(rule.count)
                );
                row.appendChild(count);
                wrapper.appendChild(row);
            });
            section.appendChild(wrapper);
        });
        container.appendChild(section);
    }
    function getColumnWidths(table) {
        const widths = {};
        if (!table) {
            return widths;
        }
        table.querySelectorAll("col[data-column]").forEach((col) => {
            const key = col.dataset.column;
            const width = parseInt(col.style.width || "", 10);
            if (key && Number.isFinite(width)) {
                widths[key] = width;
            }
        });
        return widths;
    }
    function restoreColumnWidths(table) {
        if (!table) {
            return;
        }
        let stored;
        try {
            stored = JSON.parse(
                readStorage("WNC_COLUMN_WIDTHS_V1", "{}") || "{}"
            );
        } catch (error) {
            stored = {};
        }
        table.querySelectorAll("col[data-column]").forEach((col) => {
            const key = col.dataset.column;
            const width = Number(stored[key]);
            if (width >= 50 && width <= 1200) {
                col.style.width = `${width}px`;
            }
        });
    }
    function saveColumnWidths(table) {
        const widths = getColumnWidths(table);
        writeStorage("WNC_COLUMN_WIDTHS_V1", JSON.stringify(widths));
    }
    function addColumnResizer(header, table) {
        if (!header || !table) {
            return;
        }
        const resizer = document.createElement("span");
        resizer.className = "wnc-column-resizer";
        resizer.title = "Drag to resize column";
        header.appendChild(resizer);
        resizer.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.button !== 0) {
                return;
            }
            const index = Number(header.dataset.columnIndex);
            const columns = table.querySelectorAll("col");
            const column = columns[index];
            if (!column) {
                return;
            }
            const startX = event.clientX;
            const startWidth = header.getBoundingClientRect().width;
            document.body.classList.add("wnc-dragging-column");
            const move = (moveEvent) => {
                const delta = moveEvent.clientX - startX;
                const width = Math.max(50, Math.min(1200, startWidth + delta));
                column.style.width = `${Math.round(width)}px`;
            };
            const up = () => {
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", up);
                document.body.classList.remove("wnc-dragging-column");
                saveColumnWidths(table);
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
        });
    }
    function makePanelDraggable(panel, header) {
        if (!panel || !header) {
            return;
        }
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let startLeft = 0;
        let startTop = 0;
        header.addEventListener("mousedown", (event) => {
            if (event.button !== 0) {
                return;
            }
            if (
                event.target.closest(
                    "button, select, input, textarea, a, .wnc-column-resizer"
                )
            ) {
                return;
            }
            dragging = true;
            const rect = panel.getBoundingClientRect();
            startX = event.clientX;
            startY = event.clientY;
            startLeft = rect.left;
            startTop = rect.top;
            panel.style.right = "auto";
            panel.style.left = `${Math.round(rect.left)}px`;
            panel.style.top = `${Math.round(rect.top)}px`;
            document.body.classList.add("wnc-dragging-panel");
            const move = (moveEvent) => {
                if (!dragging) {
                    return;
                }
                const maxLeft = Math.max(
                    0,
                    window.innerWidth - panel.offsetWidth
                );
                const maxTop = Math.max(
                    0,
                    window.innerHeight - panel.offsetHeight
                );
                const left = Math.max(
                    0,
                    Math.min(maxLeft, startLeft + (moveEvent.clientX - startX))
                );
                const top = Math.max(
                    0,
                    Math.min(maxTop, startTop + (moveEvent.clientY - startY))
                );
                panel.style.left = `${Math.round(left)}px`;
                panel.style.top = `${Math.round(top)}px`;
            };
            const up = () => {
                dragging = false;
                document.removeEventListener("mousemove", move);
                document.removeEventListener("mouseup", up);
                document.body.classList.remove("wnc-dragging-panel");
            };
            document.addEventListener("mousemove", move);
            document.addEventListener("mouseup", up);
        });
    }
    /* ================= UI LIFECYCLE ================= */
    function renderCurrentScreen() {
        const overlay = document.getElementById(WNC_UI_ID);
        if (!overlay) {
            return;
        }
        const panel = overlay.querySelector(".wnc-panel");
        if (!panel) {
            return;
        }
        const body = panel.querySelector(".wnc-body");
        if (!body) {
            return;
        }
        /*
         * Do not replace the panel itself.
         *
         * Only the content area is rebuilt.
         */
        body.textContent = "";
        if (state.screen === "groups") {
            renderGroupsTab(body);
        } else if (state.screen === "conflicts") {
            renderConflictsTab(body);
        } else {
            renderCandidatesTab(body);
        }
        panel.querySelectorAll(".wnc-tab").forEach((tab) => {
            tab.classList.toggle(
                "wnc-tab-active",
                tab.dataset.screen === state.screen
            );
        });
        /*
         * Re-apply persisted dimensions after content changes.
         *
         * This is especially important when the previous content
         * was shorter than the new screen.
         */
        applyWncPanelSize(panel);
    }
    function createPanel() {
        let overlay = document.getElementById(WNC_UI_ID);
        if (overlay) {
            const panel = overlay.querySelector(".wnc-panel");
            if (panel) {
                applyWncPanelSize(panel);
                startWncPanelResizePersistence(panel);
            }
            return overlay;
        }
        ensureWncStyles();
        overlay = document.createElement("div");
        overlay.id = WNC_UI_ID;
        overlay.className = "wnc-overlay";
        const panel = document.createElement("div");
        panel.className = "wnc-panel";
        const header = document.createElement("div");
        header.className = "wnc-header";
        const title = document.createElement("div");
        title.className = "wnc-title";
        title.textContent = `Webnovel Cleaner ${WNC_VERSION}`;
        const version = document.createElement("span");
        version.className = "wnc-version";
        version.textContent = `v${WNC_VERSION}`;
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "wnc-close";
        closeButton.textContent = "×";
        closeButton.title = "Close";
        closeButton.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            overlay.remove();
        });
        header.appendChild(title);
        header.appendChild(version);
        header.appendChild(closeButton);
        const tabs = document.createElement("div");
        tabs.className = "wnc-tabs";
        [
            ["candidates", "Candidates"],
            ["groups", "Groups"],
            ["conflicts", "Conflicts"]
        ].forEach(([screen, label]) => {
            const tab = document.createElement("button");
            tab.type = "button";
            tab.className = "wnc-tab";
            tab.dataset.screen = screen;
            tab.textContent = label;
            tab.addEventListener("click", (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (state.screen === screen) {
                    return;
                }
                state.screen = screen;
                renderCurrentScreen();
            });
            tabs.appendChild(tab);
        });
        const body = document.createElement("div");
        body.className = "wnc-body";
        panel.appendChild(header);
        panel.appendChild(tabs);
        panel.appendChild(body);
        overlay.appendChild(panel);
        document.documentElement.appendChild(overlay);
        /*
         * Apply the persisted dimensions only after the actual
         * .wnc-panel exists in the document.
         */
        applyWncPanelSize(panel);
        /*
         * Native CSS resize handles width and height.
         * ResizeObserver remembers the final dimensions.
         */
        startWncPanelResizePersistence(panel);
        /*
         * Header dragging is independent of resizing.
         */
        makePanelDraggable(panel, header);
        /*
         * Render the current screen immediately so the panel is
         * usable even when createPanel() is called before the
         * analysis renderer.
         */
        renderCurrentScreen();
        return overlay;
    }
    function showAnalysisError(error) {
        state.analysisError =
            error instanceof Error ? error : new Error(String(error));
        console.error("[WNC] Analysis error:", state.analysisError);
        try {
            const panel = createPanel();
            const body =
                panel?.querySelector(".wnc-body") ||
                panel?.querySelector(".wnc-panel-body");
            if (!body) {
                return;
            }
            body.textContent = "";
            const section = document.createElement("section");
            section.className = "wnc-section";
            const title = document.createElement("div");
            title.className = "wnc-section-title";
            title.textContent = "Analysis Error";
            const message = document.createElement("div");
            message.className = "wnc-empty";
            message.textContent = state.analysisError.message;
            section.appendChild(title);
            section.appendChild(message);
            body.appendChild(section);
        } catch (panelError) {
            console.error("[WNC] Unable to create error UI:", panelError);
        }
    }
    /* ================= PAGE SCANNING / ENTRY POINTS ================= */
    function getPageText() {
        if (!document.body) {
            return "";
        }
        const excludedSelector = [
            "script",
            "style",
            "noscript",
            "template",
            "svg",
            "canvas",
            "nav",
            "footer",
            "aside",
            "form",
            "button",
            "input",
            "select",
            "textarea",
            "option",
            "[hidden]",
            "[aria-hidden='true']",
            "[role='navigation']",
            "[role='complementary']",
            "[role='dialog']",
            "[role='banner']",
            "[role='contentinfo']",
            ".wnc-overlay",
            "#wnc-overlay",
            "#wnc-panel"
        ].join(",");
        const excludedNamePattern =
            /(^|[\s_-])(?:ads?|advert(?:isement)?s?|sponsor(?:ed)?|sidebars?|recommendations?|related[-_ ]?(?:posts?|content|articles?)|comments?|comment[-_ ]?(?:list|section|thread)|social[-_ ]?share|share[-_ ]?buttons?)(?=$|[\s_-])/i;
        const blockTags = new Set([
            "ADDRESS",
            "ARTICLE",
            "BLOCKQUOTE",
            "DD",
            "DL",
            "DT",
            "DIV",
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
            "TD",
            "TFOOT",
            "TH",
            "THEAD",
            "TR",
            "UL"
        ]);
        const parts = [];
        function appendBoundary() {
            if (
                parts.length &&
                !String(parts[parts.length - 1]).endsWith("\n")
            ) {
                parts.push("\n");
            }
        }
        function shouldExclude(element) {
            if (element.matches(excludedSelector)) {
                return true;
            }
            const classAndId = `${element.getAttribute("class") || ""} ${element.id || ""}`;
            if (excludedNamePattern.test(classAndId)) {
                return true;
            }
            const style = window.getComputedStyle(element);
            return (
                style.display === "none" ||
                style.visibility === "hidden" ||
                style.visibility === "collapse" ||
                Number(style.opacity) === 0
            );
        }
        function visit(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                if (node.nodeValue) {
                    parts.push(node.nodeValue);
                }
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            const element = node;
            if (element !== document.body && shouldExclude(element)) {
                return;
            }
            if (element.tagName === "BR" || element.tagName === "HR") {
                appendBoundary();
                return;
            }
            const isBlock = blockTags.has(element.tagName);
            if (isBlock) {
                appendBoundary();
            }
            for (const child of element.childNodes) {
                visit(child);
            }
            if (isBlock) {
                appendBoundary();
            }
        }
        visit(document.body);
        return parts
            .join("")
            .replace(/[ \t\f\v]+\n/g, "\n")
            .replace(/\n[ \t\f\v]+/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    }
    function analyzePage() {
        const pageText = getPageText();
        const analysis = buildAnalysisResult(pageText, adaptedDatabase);
        state.candidates = Array.isArray(analysis.candidates)
            ? analysis.candidates
            : [];
        state.candidateClusters = Array.isArray(analysis.candidateClusters)
            ? analysis.candidateClusters
            : [];
        state.groupMatches = Array.isArray(analysis.groupMatches)
            ? analysis.groupMatches
            : [];
        state.conflicts = Array.isArray(analysis.conflicts)
            ? analysis.conflicts
            : [];
        state.analysisError = null;
        return analysis;
    }
    function runAnalysisSafely() {
        try {
            const analysis = analyzePage();
            createPanel();
            renderCurrentScreen();
            return analysis;
        } catch (error) {
            showAnalysisError(error);
            return null;
        }
    }
    function initializeDatabase() {
        try {
            const stored = readStorage(DB_KEY, null);
            if (!stored) {
                adaptedDatabase = {
                    groups: []
                };
                return adaptedDatabase;
            }
            const database =
                typeof stored === "string" ? JSON.parse(stored) : stored;
            adaptedDatabase = adaptFoxReplaceDatabase(database);
            ensureDatabaseShape();
            return adaptedDatabase;
        } catch (error) {
            console.warn(
                "[WNC] Stored FoxReplace database could not be loaded.",
                error
            );
            adaptedDatabase = {
                groups: []
            };
            return adaptedDatabase;
        }
    }
    function registerMenu() {
        if (typeof GM_registerMenuCommand !== "function") {
            return;
        }
        GM_registerMenuCommand("Webnovel Cleaner — Analyze page", () => {
            runAnalysisSafely();
        });
        GM_registerMenuCommand("Webnovel Cleaner — Reload database", () => {
            initializeDatabase();
            state.analysisError = null;
            clearAnalysisResults();
            runAnalysisSafely();
        });
        GM_registerMenuCommand(
            "Webnovel Cleaner — Import FoxReplace JSON",
            () => {
                openImportPicker();
            }
        );
    }
    function startWnc() {
        initializeDatabase();
        registerMenu();
        window.WNC = window.WNC || {};
        window.WNC.version = WNC_VERSION;
        window.WNC.analyze = runAnalysisSafely;
        window.WNC.importDatabase = openImportPicker;
        window.WNC.getState = () => ({
            ...state,
            candidates: state.candidates.slice(),
            candidateClusters: state.candidateClusters.slice(),
            groupMatches: state.groupMatches.slice(),
            conflicts: state.conflicts.slice()
        });
        /*
         * Do not automatically analyze on every
         * page mutation. Analysis is explicitly
         * triggered by the menu/API and by the
         * normal startup path below.
         */
    }
    startWnc();
})();
