// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.2.7
// @description  FoxReplace companion/workbench for finding chapter candidates, groups, and conflicts.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==
(function () {
    "use strict";

    const DB_KEY = "WNC_FOXREPLACE_DATABASE_V2";
    const UI_SETTINGS_KEY = "WNC_UI_SETTINGS_V1";
    const CANDIDATE_TEMPLATE_KEY = "WNC_CANDIDATE_TEMPLATE_V1";
    const UI_ID = "wnc-overlay";
    const STYLE_ID = "wnc-dark-style";
    const INPUT_TEMPLATES = ["Other", "Korean", "Korean 2", "Japanese"];
    const TAB_ORDER = ["candidates", "groups", "conflicts"];

    const OCCURRENCE_REGEX =
        /(?<![A-Z0-9'’-])((?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*)(?:\s+(?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*))*)(?![A-Za-z0-9'’-])/g;

    const DEFAULT_UI_SETTINGS = {
        width: 1400,
        height: 0,
        columns: {
            candidates: [420, 100, 220],
            groups: [220, 520, 420, 100],
            conflicts: [220, 520, 420, 420, 100]
        }
    };

    const state = {
        collapsedGroups: new Set(),
        screen: "candidates",
        candidates: [],
        candidateClusters: [],
        groupMatches: [],
        conflicts: [],
        candidateTemplate: "Other",
        expandedRules: new Set(),
        analysisError: null
    };

    const RULE_REGEX_CACHE = new WeakMap();
    let adaptedDatabase = { groups: [] };
    let wncColumnDrag = null;
    let wncPanelResizeObserver = null;

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

    function normalizeUrls(value) {
        if (Array.isArray(value)) {
            return value.map((item) => String(item ?? "").trim()).filter(Boolean);
        }
        if (typeof value === "string") {
            return value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
        }
        return [];
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
            inputType: String(rawRule?.inputType ?? "text").trim().toLowerCase(),
            outputType: String(rawRule?.outputType ?? "text").trim().toLowerCase(),
            caseSensitive: normalizeBoolean(rawRule?.caseSensitive, false),
            enabled: normalizeBoolean(rawRule?.enabled, true),
            html: rawRule?.html ?? null
        };
    }

    function normalizeGroup(rawGroup, groupIndex) {
        const group = rawGroup && typeof rawGroup === "object" ? rawGroup : {};
        const name = String(group.name ?? group.groupName ?? `Group ${groupIndex + 1}`);
        const rawRules = Array.isArray(group.substitutions)
            ? group.substitutions
            : Array.isArray(group.rules)
              ? group.rules
              : [];
        return {
            raw: group,
            index: groupIndex,
            name,
            urls: normalizeUrls(group.urls ?? group.url ?? group.urlPatterns),
            rules: rawRules.map((rule, ruleIndex) => normalizeRule(rule, ruleIndex, groupIndex, name)),
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
        const directKeys = ["groups", "substitutionGroups", "substitutionList", "lists"];
        for (const key of directKeys) {
            if (Array.isArray(database[key])) {
                return database[key];
            }
        }
        for (const value of Object.values(database)) {
            if (Array.isArray(value) && value.length && value.every((item) => item && typeof item === "object")) {
                const looksLikeGroups = value.some(
                    (item) =>
                        Array.isArray(item.substitutions) ||
                        Array.isArray(item.rules) ||
                        item.name !== undefined ||
                        item.groupName !== undefined
                );
                if (looksLikeGroups) {
                    return value;
                }
            }
        }
        return [];
    }

    function adaptFoxReplaceDatabase(rawDatabase) {
        const groups = findGroupArray(rawDatabase);
        if (!Array.isArray(groups) || !groups.length) {
            return { groups: [] };
        }
        const normalizedGroups = groups.map((group, index) => normalizeGroup(group, index));
        return { groups: normalizedGroups };
    }

    function loadNormalDatabase() {
        const value = readStorage(DB_KEY, null);
        if (!value || typeof value !== "object") {
            return null;
        }
        return value;
    }

    function loadActiveDatabase() {
        const normal = loadNormalDatabase();
        if (normal) {
            return normal;
        }
        return { groups: [] };
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
        if (!database || typeof database !== "object" || Array.isArray(database)) {
            if (Array.isArray(database)) {
                database = { groups: database };
            } else {
                return null;
            }
        }
        const groups = findGroupArray(database);
        if (!Array.isArray(groups)) {
            return null;
        }
        return { ...database, groups };
    }

    function ensureDatabaseShape() {
        if (!adaptedDatabase || !Array.isArray(adaptedDatabase.groups)) {
            adaptedDatabase = { groups: [] };
        }
    }

    function initializeWnc() {
        let database = { groups: [] };
        try {
            database = loadActiveDatabase();
        } catch {
            database = { groups: [] };
        }
        try {
            adaptedDatabase = adaptFoxReplaceDatabase(database);
        } catch {
            adaptedDatabase = { groups: [] };
        }
        ensureDatabaseShape();
        state.candidateTemplate = readStorage(CANDIDATE_TEMPLATE_KEY, "Other") || "Other";
        if (!INPUT_TEMPLATES.includes(state.candidateTemplate)) {
            state.candidateTemplate = "Other";
        }
    }

    function readFileText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ""));
            reader.onerror = () => reject(reader.error || new Error("Unable to read file"));
            reader.readAsText(file);
        });
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
                    render();
                    runAnalysisSafely();
                    render();
                } catch (error) {
                    state.analysisError = error instanceof Error ? error : new Error(String(error));
                    render();
                }
            },
            { once: true }
        );
        input.click();
    }

    function wildcardToRegex(value) {
        const escaped = escapeRegexLiteral(value);
        return new RegExp("^" + escaped.replace(/\\\*/g, ".*") + "$");
    }

    function escapeRegexLiteral(value) {
        return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
        return urls.some((pattern) => urlPatternMatches(pattern, location.href));
    }

    function getCurrentSiteGroups() {
        return (adaptedDatabase.groups || []).filter((group) => group.enabled && groupMatchesCurrentSite(group));
    }

    function getCurrentSiteRules() {
        return getCurrentSiteGroups().flatMap((group) => (group.rules || []).filter((rule) => rule.enabled));
    }

    function splitCandidateTokens(candidate) {
        return String(candidate ?? "").trim().split(/\s+/).filter(Boolean);
    }

    function normalizeCandidateToken(token) {
        let value = String(token ?? "").trim().toLowerCase().replace(/[’']/g, "");
        if (!value) {
            return "";
        }
        if (
            value.endsWith("s") &&
            !value.endsWith("ss") &&
            !value.endsWith("us") &&
            !value.endsWith("is") &&
            !value.endsWith("es")
        ) {
            value = value.slice(0, -1);
        }
        return value;
    }

    function normalizeCandidate(candidate) {
        return splitCandidateTokens(candidate)
            .map(normalizeCandidateToken)
            .filter(Boolean)
            .join(" ");
    }

    function scanCandidateOccurrences(text) {
        const occurrences = [];
        if (!text) {
            return occurrences;
        }
        OCCURRENCE_REGEX.lastIndex = 0;
        let match;
        while ((match = OCCURRENCE_REGEX.exec(text)) !== null) {
            const value = String(match[1] || "").trim();
            if (!value) {
                continue;
            }
            const startIndex = match.index;
            if (startIndex === 0) {
                continue;
            }
            let sentenceStart = false;
            for (let index = startIndex - 1; index >= 0; index--) {
                const character = text[index];
                if (/\s/.test(character)) {
                    continue;
                }
                if (/["'“”‘’([{]/.test(character)) {
                    continue;
                }
                if (/[.!?]/.test(character)) {
                    sentenceStart = true;
                }
                break;
            }
            if (sentenceStart) {
                continue;
            }
            occurrences.push({ text: value, index: startIndex });
        }
        return occurrences;
    }

    function scanSentenceStartOccurrences(text) {
        const occurrences = [];
        if (!text) {
            return occurrences;
        }
        OCCURRENCE_REGEX.lastIndex = 0;
        let match;
        while ((match = OCCURRENCE_REGEX.exec(text)) !== null) {
            const value = String(match[1] || "").trim();
            if (!value) {
                continue;
            }
            const startIndex = match.index;
            let isSentenceStart = startIndex === 0;
            if (!isSentenceStart) {
                for (let index = startIndex - 1; index >= 0; index--) {
                    const character = text[index];
                    if (/\s/.test(character)) {
                        continue;
                    }
                    if (/["'“”‘’([{]/.test(character)) {
                        continue;
                    }
                    isSentenceStart = /[.!?]/.test(character);
                    break;
                }
            }
            if (!isSentenceStart) {
                continue;
            }
            occurrences.push({ text: value, index: startIndex });
        }
        return occurrences;
    }

    function mergeCandidateOccurrences(occurrences) {
        const candidateMap = new Map();
        for (const occurrence of occurrences || []) {
            const text = String(occurrence?.text || "").trim();
            if (!text) {
                continue;
            }
            const normalized = normalizeCandidate(text);
            if (!normalized) {
                continue;
            }
            let entry = candidateMap.get(normalized);
            if (!entry) {
                entry = {
                    name: text,
                    normalized,
                    frequency: 0,
                    variants: new Map(),
                    sentenceStarts: [],
                    originalIndex: occurrence.index
                };
                candidateMap.set(normalized, entry);
            }
            entry.frequency += 1;
            const variantCount = Number(entry.variants.get(text) || 0);
            entry.variants.set(text, variantCount + 1);
        }
        return [...candidateMap.values()];
    }

    function mergeSentenceStartOccurrences(occurrences) {
        const sentenceStartMap = new Map();
        for (const occurrence of occurrences || []) {
            const text = String(occurrence?.text || "").trim();
            if (!text) {
                continue;
            }
            const normalized = normalizeCandidate(text);
            if (!normalized) {
                continue;
            }
            let entry = sentenceStartMap.get(normalized);
            if (!entry) {
                entry = {
                    text,
                    normalized,
                    frequency: 0,
                    variants: new Map(),
                    originalIndex: occurrence.index
                };
                sentenceStartMap.set(normalized, entry);
            }
            entry.frequency += 1;
            const variantCount = Number(entry.variants.get(text) || 0);
            entry.variants.set(text, variantCount + 1);
        }
        return [...sentenceStartMap.values()];
    }

    function chooseCandidateDisplayName(candidate) {
        if (!candidate?.variants?.size) {
            return candidate?.name || "";
        }
        const variants = [...candidate.variants.keys()]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .filter((value) => normalizeCandidate(value) === String(candidate.normalized || ""));
        if (!variants.length) {
            return candidate?.name || "";
        }
        variants.sort((a, b) => {
            if (a.length !== b.length) {
                return a.length - b.length;
            }
            const aPossessive = /['’]/.test(a);
            const bPossessive = /['’]/.test(b);
            if (aPossessive !== bPossessive) {
                return aPossessive ? 1 : -1;
            }
            return a.localeCompare(b);
        });
        return variants[0];
    }

    function finalizeCandidateNames(candidates) {
        return candidates.map((candidate, index) => {
            const normalized = String(candidate.normalized || "").trim();
            return {
                ...candidate,
                normalized,
                name: chooseCandidateDisplayName({ ...candidate, normalized }),
                originalIndex: candidate.originalIndex ?? index
            };
        });
    }

    function getCandidateTokens(value) {
        if (value && typeof value === "object" && Array.isArray(value.normalizedTokens)) {
            return value.normalizedTokens;
        }
        const source = typeof value === "object" ? value?.normalized || value?.name || "" : value;
        const tokens = splitCandidateTokens(normalizeCandidate(source));
        if (value && typeof value === "object") {
            value.normalizedTokens = tokens;
        }
        return tokens;
    }

    function getSharedContiguousTokenCount(valueA, valueB) {
        const tokensA = Array.isArray(valueA) ? valueA : getCandidateTokens(valueA);
        const tokensB = Array.isArray(valueB) ? valueB : getCandidateTokens(valueB);
        if (!tokensA.length || !tokensB.length) {
            return 0;
        }
        let best = 0;
        for (let i = 0; i < tokensA.length; i++) {
            for (let j = 0; j < tokensB.length; j++) {
                let count = 0;
                while (
                    i + count < tokensA.length &&
                    j + count < tokensB.length &&
                    tokensA[i + count] === tokensB[j + count]
                ) {
                    count += 1;
                }
                if (count > best) {
                    best = count;
                }
            }
        }
        return best;
    }

    function findSentenceStartMatch(starter, candidates) {
        if (!starter || !Array.isArray(candidates) || !candidates.length) {
            return null;
        }
        const starterTokens = getCandidateTokens(starter);
        if (!starterTokens.length) {
            return null;
        }
        let bestCandidate = null;
        let bestSharedCount = 0;
        let bestOriginalIndex = Infinity;
        for (const candidate of candidates) {
            const candidateTokens = getCandidateTokens(candidate);
            if (!candidateTokens.length || candidateTokens.length > starterTokens.length) {
                continue;
            }
            const sharedContiguousTokens = getSharedContiguousTokenCount(starterTokens, candidateTokens);
            if (sharedContiguousTokens !== candidateTokens.length) {
                continue;
            }
            const originalIndex = Number(candidate.originalIndex ?? Infinity);
            if (
                sharedContiguousTokens > bestSharedCount ||
                (sharedContiguousTokens === bestSharedCount && originalIndex < bestOriginalIndex)
            ) {
                bestCandidate = candidate;
                bestSharedCount = sharedContiguousTokens;
                bestOriginalIndex = originalIndex;
            }
        }
        return bestCandidate;
    }

    function applySentenceStartMatches(candidates, sentenceStarts) {
        if (!Array.isArray(candidates) || !Array.isArray(sentenceStarts)) {
            return;
        }
        const orderedCandidates = [...candidates].sort((a, b) => {
            const frequencyDifference = Number(b.frequency || 0) - Number(a.frequency || 0);
            if (frequencyDifference !== 0) {
                return frequencyDifference;
            }
            return Number(a.originalIndex ?? Infinity) - Number(b.originalIndex ?? Infinity);
        });
        for (const starter of sentenceStarts) {
            if (!starter || starter.matchedCandidate) {
                continue;
            }
            const frequency = Number(starter.frequency || 0);
            if (frequency <= 0) {
                continue;
            }
            const candidate = findSentenceStartMatch(starter, orderedCandidates);
            if (!candidate) {
                continue;
            }
            if (!Array.isArray(candidate.sentenceStarts)) {
                candidate.sentenceStarts = [];
            }
            candidate.sentenceStarts.push({
                text: starter.text,
                normalized: starter.normalized,
                frequency
            });
            starter.matchedCandidate = candidate;
        }
    }

    function buildCandidateClusters(candidates) {
        const remaining = new Set(candidates || []);
        const ordered = [...remaining].sort((a, b) => {
            const frequencyDifference = Number(b.frequency || 0) - Number(a.frequency || 0);
            if (frequencyDifference !== 0) {
                return frequencyDifference;
            }
            return Number(a.originalIndex || 0) - Number(b.originalIndex || 0);
        });
        const tokenIndex = new Map();
        const candidateTokens = new Map();
        for (const candidate of ordered) {
            const tokens = getCandidateTokens(candidate);
            candidateTokens.set(candidate, tokens);
            for (const token of tokens) {
                let indexed = tokenIndex.get(token);
                if (!indexed) {
                    indexed = new Set();
                    tokenIndex.set(token, indexed);
                }
                indexed.add(candidate);
            }
        }
        const clusters = [];
        for (const root of ordered) {
            if (!remaining.has(root)) {
                continue;
            }
            const members = [];
            const queue = [{ candidate: root, depth: 0 }];
            let queueIndex = 0;
            remaining.delete(root);
            while (queueIndex < queue.length) {
                const { candidate, depth } = queue[queueIndex++];
                members.push(candidate);
                if (depth >= 2) {
                    continue;
                }
                const related = new Set();
                const tokens = candidateTokens.get(candidate) || [];
                for (const token of tokens) {
                    const indexed = tokenIndex.get(token);
                    if (!indexed) {
                        continue;
                    }
                    for (const other of indexed) {
                        if (remaining.has(other)) {
                            related.add(other);
                        }
                    }
                }
                for (const other of related) {
                    remaining.delete(other);
                    queue.push({ candidate: other, depth: depth + 1 });
                }
            }
            members.sort((a, b) => {
                const frequencyDifference = Number(b.frequency || 0) - Number(a.frequency || 0);
                if (frequencyDifference !== 0) {
                    return frequencyDifference;
                }
                return Number(a.originalIndex || 0) - Number(b.originalIndex || 0);
            });
            clusters.push({ root, members });
        }
        return clusters;
    }

    function processCandidateClusters(candidates) {
        const UNCLUSTERED_FREQUENCY_RATIO = 0.05;
        const candidateList = Array.isArray(candidates) ? candidates.filter(Boolean) : [];
        if (!candidateList.length) {
            return { candidates: [], clusters: [] };
        }
        const clusters = buildCandidateClusters(candidateList);
        const maxFrequency = Math.max(...candidateList.map((candidate) => Number(candidate?.frequency || 0)));
        const threshold = maxFrequency * UNCLUSTERED_FREQUENCY_RATIO;
        const retainedClusters = clusters.filter((cluster) => {
            const members = Array.isArray(cluster?.members) ? cluster.members : [];
            if (members.length > 1) {
                return true;
            }
            const frequency = Number(members[0]?.frequency || cluster?.root?.frequency || 0);
            return frequency >= threshold;
        });
        const retainedCandidates = retainedClusters.flatMap((cluster) => (Array.isArray(cluster?.members) ? cluster.members : []));
        return {
            candidates: retainedCandidates,
            clusters: retainedClusters
        };
    }

    function scanChapterCandidates(text) {
        const candidateOccurrences = scanCandidateOccurrences(text);
        const sentenceStartOccurrences = scanSentenceStartOccurrences(text);
        const candidates = mergeCandidateOccurrences(candidateOccurrences);
        const finalizedCandidates = finalizeCandidateNames(candidates);
        const sentenceStarts = mergeSentenceStartOccurrences(sentenceStartOccurrences);
        applySentenceStartMatches(finalizedCandidates, sentenceStarts);
        return {
            candidates: finalizedCandidates,
            sentenceStarts
        };
    }

    function compileRuleRegex(rule) {
        if (!rule || rule.inputType !== "regexp") {
            return null;
        }
        if (RULE_REGEX_CACHE.has(rule)) {
            return RULE_REGEX_CACHE.get(rule);
        }
        const flags = rule.caseSensitive ? "" : "i";
        try {
            const regex = new RegExp(rule.input, flags);
            RULE_REGEX_CACHE.set(rule, regex);
            return regex;
        } catch {
            RULE_REGEX_CACHE.set(rule, null);
            return null;
        }
    }

    function wholeWordRuleMatches(candidateText, ruleText, caseSensitive) {
        const value = String(candidateText ?? "");
        const input = String(ruleText ?? "");
        if (!value || !input) {
            return false;
        }
        const flags = caseSensitive ? "" : "i";
        try {
            const pattern = new RegExp(
                "(?<![A-Za-z0-9'’-])" + escapeRegexLiteral(input) + "(?![A-Za-z0-9'’-])",
                flags
            );
            return pattern.test(value);
        } catch {
            return false;
        }
    }

    function getCandidateMatchForms(candidate) {
        const forms = new Set();
        const addForm = (value) => {
            const text = String(value ?? "").trim();
            if (!text) {
                return;
            }
            forms.add(text);
            const normalized = normalizeCandidate(text);
            if (normalized) {
                forms.add(normalized);
            }
        };
        if (candidate && typeof candidate === "object") {
            addForm(candidate.name);
            addForm(candidate.normalized);
            if (candidate.variants instanceof Map) {
                for (const variant of candidate.variants.keys()) {
                    addForm(variant);
                }
            } else if (Array.isArray(candidate.variants)) {
                for (const variant of candidate.variants) {
                    addForm(variant);
                }
            }
        } else {
            addForm(candidate);
        }
        return [...forms];
    }

    function findCandidateRuleMatches(candidate, pageMatchedRules) {
        if (!candidate || !Array.isArray(pageMatchedRules)) {
            return { exact: [], wholeWord: [], partial: [], all: [] };
        }
        const candidateForms = getCandidateMatchForms(candidate)
            .map((value) => String(value || "").trim())
            .filter(Boolean);
        if (!candidateForms.length) {
            return { exact: [], wholeWord: [], partial: [], all: [] };
        }
        const exact = [];
        const wholeWord = [];
        const partial = [];
        for (const rule of pageMatchedRules) {
            if (!rule) {
                continue;
            }
            const ruleText = String(rule.input ?? rule.text ?? rule.find ?? "").trim();
            if (!ruleText) {
                continue;
            }
            let exactMatch = false;
            let wholeWordMatch = false;
            let partialMatch = false;
            for (const form of candidateForms) {
                if (rule.caseSensitive) {
                    if (form === ruleText) {
                        exactMatch = true;
                        break;
                    }
                } else if (form.toLowerCase() === ruleText.toLowerCase()) {
                    exactMatch = true;
                    break;
                }
            }
            if (exactMatch) {
                exact.push(rule);
                continue;
            }
            for (const form of candidateForms) {
                if (wholeWordRuleMatches(ruleText, form, Boolean(rule.caseSensitive))) {
                    wholeWordMatch = true;
                    break;
                }
            }
            if (wholeWordMatch) {
                wholeWord.push(rule);
                continue;
            }
            for (const form of candidateForms) {
                const candidateValue = rule.caseSensitive ? form : form.toLowerCase();
                const ruleValue = rule.caseSensitive ? ruleText : ruleText.toLowerCase();
                if (
                    candidateValue.length >= 2 &&
                    ruleValue.length >= 2 &&
                    (ruleValue.includes(candidateValue) || candidateValue.includes(ruleValue))
                ) {
                    partialMatch = true;
                    break;
                }
            }
            if (partialMatch) {
                partial.push(rule);
            }
        }
        const all = [...new Set([...exact, ...wholeWord, ...partial])];
        return { exact, wholeWord, partial, all };
    }

    function buildGroupMatches(pageRuleMatches, candidateRuleMatches) {
        const candidateMatchesByRule = new Map();
        for (const [candidate, matches] of candidateRuleMatches || []) {
            for (const rule of matches?.all || []) {
                if (!rule) {
                    continue;
                }
                let entry = candidateMatchesByRule.get(rule);
                if (!entry) {
                    entry = { rule, candidates: [], matchCount: 0 };
                    candidateMatchesByRule.set(rule, entry);
                }
                if (!entry.candidates.includes(candidate)) {
                    entry.candidates.push(candidate);
                }
            }
        }

        const pageMatchesByRule = new Map();
        for (const pageMatch of pageRuleMatches || []) {
            if (!pageMatch?.rule) {
                continue;
            }
            pageMatchesByRule.set(pageMatch.rule, Number(pageMatch.matchCount || 0));
        }

        const groups = [];
        const groupMap = new Map();
        for (const pageMatch of pageRuleMatches || []) {
            const rule = pageMatch?.rule;
            if (!rule) {
                continue;
            }
            const matchedRule = candidateMatchesByRule.get(rule);
            if (!matchedRule) {
                continue;
            }
            matchedRule.matchCount = pageMatchesByRule.get(rule) || 0;
            let group = groupMap.get(rule.groupIndex);
            if (!group) {
                group = {
                    index: Number(rule.groupIndex || 0),
                    name: String(rule.groupName || ""),
                    rules: []
                };
                groupMap.set(rule.groupIndex, group);
                groups.push(group);
            }
            group.rules.push(matchedRule);
        }
        return groups;
    }

    function findRulePageMatchRanges(text, rule, lowerSource = null) {
        const source = String(text ?? "");
        if (!source || !rule) {
            return [];
        }
        if (rule.inputType === "regexp") {
            const regex = compileRuleRegex(rule);
            if (!regex) {
                return [];
            }
            const matcher = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
            const matches = [];
            let match;
            while ((match = matcher.exec(source)) !== null) {
                matches.push({ start: match.index, end: match.index + match[0].length });
                if (match[0].length === 0) {
                    matcher.lastIndex += 1;
                }
            }
            return matches;
        }

        if (rule.inputType === "wholewords") {
            const pattern = String(rule.input ?? "");
            if (!pattern) {
                return [];
            }
            const regex = new RegExp(
                `(?<![A-Za-z0-9'’-])${escapeRegexLiteral(pattern)}(?![A-Za-z0-9'’-])`,
                rule.caseSensitive ? "g" : "gi"
            );
            const matches = [];
            let match;
            while ((match = regex.exec(source)) !== null) {
                matches.push({ start: match.index, end: match.index + match[0].length });
                if (match[0].length === 0) {
                    regex.lastIndex += 1;
                }
            }
            return matches;
        }

        const pattern = String(rule.input ?? "");
        if (!pattern) {
            return [];
        }
        const searchSource = rule.caseSensitive ? source : (lowerSource ?? source.toLowerCase());
        const searchPattern = rule.caseSensitive ? pattern : pattern.toLowerCase();
        const matches = [];
        let position = 0;
        while (position < searchSource.length) {
            const index = searchSource.indexOf(searchPattern, position);
            if (index === -1) {
                break;
            }
            matches.push({ start: index, end: index + searchPattern.length });
            position = index + Math.max(searchPattern.length, 1);
        }
        return matches;
    }

    function scanFoxReplacePage(text, rules = getCurrentSiteRules()) {
        const matches = [];
        const source = String(text ?? "");
        const lowerSource = source.toLowerCase();
        for (const rule of rules) {
            const ranges = findRulePageMatchRanges(source, rule, lowerSource);
            if (!ranges.length) {
                continue;
            }
            matches.push({ rule, matchCount: ranges.length, ranges });
        }
        return matches;
    }

    function buildConflictClusters(pageRuleMatches, pageText = "") {
        const matches = Array.isArray(pageRuleMatches)
            ? pageRuleMatches.filter((entry) => entry && entry.rule && Array.isArray(entry.ranges) && entry.ranges.length)
            : [];
        const clusters = [];
        const ruleToCluster = new Map();

        function matchesEntireTarget(target, rule) {
            const value = String(target ?? "");
            if (!value || !rule) {
                return false;
            }
            const ranges = findRulePageMatchRanges(value, rule);
            return ranges.some((range) => Number(range?.start || 0) === 0 && Number(range?.end || 0) === value.length);
        }

        function addConflict(rules, target) {
            const uniqueRules = [...new Set(rules)];
            const value = String(target ?? "").trim();
            if (uniqueRules.length < 2 || !value) {
                return;
            }
            const existingClusters = uniqueRules
                .map((rule) => ruleToCluster.get(rule))
                .filter((cluster) => cluster && clusters.includes(cluster));
            let cluster;
            if (existingClusters.length) {
                cluster = existingClusters[0];
                for (const other of existingClusters.slice(1)) {
                    for (const rule of other.rules) {
                        if (!cluster.rules.includes(rule)) {
                            cluster.rules.push(rule);
                        }
                        ruleToCluster.set(rule, cluster);
                    }
                    for (const [rule, targets] of other.targets) {
                        let targetSet = cluster.targets.get(rule);
                        if (!targetSet) {
                            targetSet = new Set();
                            cluster.targets.set(rule, targetSet);
                        }
                        for (const otherTarget of targets) {
                            targetSet.add(otherTarget);
                        }
                    }
                    const index = clusters.indexOf(other);
                    if (index !== -1) {
                        clusters.splice(index, 1);
                    }
                }
            } else {
                cluster = { rules: [], targets: new Map() };
                clusters.push(cluster);
            }
            for (const rule of uniqueRules) {
                if (!cluster.rules.includes(rule)) {
                    cluster.rules.push(rule);
                }
                ruleToCluster.set(rule, cluster);
                let targetSet = cluster.targets.get(rule);
                if (!targetSet) {
                    targetSet = new Set();
                    cluster.targets.set(rule, targetSet);
                }
                targetSet.add(value);
            }
        }

        for (let i = 0; i < matches.length; i++) {
            const left = matches[i];
            for (let j = i + 1; j < matches.length; j++) {
                const right = matches[j];
                for (const range of left.ranges) {
                    const start = Number(range?.start || 0);
                    const end = Number(range?.end || 0);
                    if (end <= start) {
                        continue;
                    }
                    const target = String(pageText.slice(start, end)).trim();
                    if (target && matchesEntireTarget(target, right.rule)) {
                        addConflict([left.rule, right.rule], target);
                    }
                }
                for (const range of right.ranges) {
                    const start = Number(range?.start || 0);
                    const end = Number(range?.end || 0);
                    if (end <= start) {
                        continue;
                    }
                    const target = String(pageText.slice(start, end)).trim();
                    if (target && matchesEntireTarget(target, left.rule)) {
                        addConflict([left.rule, right.rule], target);
                    }
                }
            }
        }

        for (const source of matches) {
            const output = String(source.rule.output || "").trim();
            if (!output) {
                continue;
            }
            for (const target of matches) {
                if (source.rule === target.rule) {
                    continue;
                }
                if (matchesEntireTarget(output, target.rule)) {
                    addConflict([source.rule, target.rule], output);
                }
            }
        }
        return clusters;
    }

    function buildConflictData(pageRuleMatches, conflictClusters) {
        const clusterByRule = new Map();
        for (let clusterIndex = 0; clusterIndex < (conflictClusters || []).length; clusterIndex++) {
            const cluster = conflictClusters[clusterIndex];
            for (const rule of cluster?.rules || []) {
                clusterByRule.set(rule, {
                    clusterId: clusterIndex + 1,
                    targets: cluster?.targets instanceof Map ? cluster.targets.get(rule) || new Set() : new Set()
                });
            }
        }

        const results = [];
        for (const pageMatch of pageRuleMatches || []) {
            const rule = pageMatch?.rule;
            if (!rule) {
                continue;
            }
            const cluster = clusterByRule.get(rule);
            if (!cluster) {
                continue;
            }
            for (const target of cluster.targets) {
                results.push({
                    rule,
                    matchCount: Number(pageMatch.matchCount || 0),
                    clusterId: cluster.clusterId,
                    target: String(target || "")
                });
            }
        }
        return results;
    }

    function getVisibleGroupMatches() {
        return (state.groupMatches || []).filter((group) => Array.isArray(group?.rules) && group.rules.length > 0);
    }

    function getGroupRulesWithMatches(group) {
        return Array.isArray(group?.rules) ? group.rules.filter((rule) => rule?.rule) : [];
    }

    function getVisibleConflicts() {
        return state.conflicts.slice();
    }

    function sortDisplayedGroups(groups) {
        return [...groups].sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
    }

    function clearAnalysisResults() {
        state.candidates = [];
        state.candidateClusters = [];
        state.groupMatches = [];
        state.conflicts = [];
    }

    function buildCandidateResults(candidates) {
        return (candidates || []).map((candidate) => {
            const name = String(candidate?.name || candidate?.normalized || "").trim();
            const sentenceStarts = Array.isArray(candidate?.sentenceStarts)
                ? candidate.sentenceStarts.filter(
                      (start) =>
                          start &&
                          String(start.text || "").trim() &&
                          Number(start.frequency || 0) > 0
                  )
                : [];
            return {
                ...candidate,
                name,
                sentenceStarts,
                frequency: Number(candidate?.frequency || 0),
                generatedInput: generateCandidateInput({ ...candidate, name, sentenceStarts }, state.candidateTemplate)
            };
        });
    }

    function normalizeGeneratedInputSpacing(value) {
        return String(value ?? "").replace(/\s+/g, " ").trim();
    }

    function generateOtherInput(candidate) {
        const value = normalizeGeneratedInputSpacing(candidate?.name || candidate?.normalized || "");
        if (!value) {
            return "";
        }
        return "(?<![a-z])" + escapeRegexLiteral(value) + "(?![a-z])";
    }

    function generateKoreanInput(candidate) {
        const value = normalizeGeneratedInputSpacing(candidate?.name || candidate?.normalized || "");
        if (!value) {
            return "";
        }
        const original = normalizeGeneratedInputSpacing(candidate?.name || candidate?.normalized || "");
        const originalTokens = splitCandidateTokens(original);
        const valueTokens = splitCandidateTokens(value);
        let nameTokens = valueTokens;
        if (
            valueTokens.length > 1 &&
            originalTokens.length > 1 &&
            valueTokens[0].toLowerCase() === originalTokens[0].toLowerCase()
        ) {
            nameTokens = valueTokens.slice(1);
        }
        if (nameTokens.length === 0) {
            return "";
        }
        const pattern = nameTokens.map((token) => escapeRegexLiteral(token)).join("[- ]?");
        return "(?<![a-z])" + pattern + "(?![a-z])";
    }

    function generateKorean2Input(candidate) {
        const value = normalizeGeneratedInputSpacing(candidate?.name || candidate?.normalized || "");
        if (!value) {
            return "";
        }
        const original = normalizeGeneratedInputSpacing(candidate?.name || candidate?.normalized || "");
        const originalTokens = splitCandidateTokens(original);
        let nameValue = value;
        if (originalTokens.length > 1) {
            const valueTokens = splitCandidateTokens(value);
            if (
                valueTokens.length > 1 &&
                valueTokens[0].toLowerCase() === originalTokens[0].toLowerCase()
            ) {
                nameValue = valueTokens.slice(1).join(" ");
            }
        }
        const nameTokens = splitCandidateTokens(nameValue);
        if (!nameTokens.length) {
            return "";
        }
        const namePattern = nameTokens.map((token) => escapeRegexLiteral(token)).join("[- ]?");
        if (originalTokens.length <= 1) {
            return "(?<![a-z])" + namePattern + "(?![a-z])";
        }
        return "(?<![a-z])(?:" + escapeRegexLiteral(originalTokens[0]) + " )?" + namePattern + "(?![a-z])";
    }

    function generateJapaneseInput(candidate) {
        const value = normalizeGeneratedInputSpacing(candidate?.name || candidate?.normalized || "");
        if (!value) {
            return "";
        }
        const tokens = splitCandidateTokens(value);
        if (tokens.length <= 1) {
            return "(?<![a-z])" + escapeRegexLiteral(value) + "(?![a-z])";
        }
        const forward = tokens.map(escapeRegexLiteral).join("\\s+");
        const reverse = [tokens[tokens.length - 1], ...tokens.slice(0, -1)].map(escapeRegexLiteral).join("\\s+");
        return "(?<![a-z])(?:" + forward + "|" + reverse + ")(?![a-z])";
    }

    function generateCandidateInput(candidate, template = state.candidateTemplate) {
        if (!candidate) {
            return "";
        }
        const identity = String(candidate.name || candidate.normalized || "").trim();
        if (!identity) {
            return "";
        }
        switch (template) {
            case "Korean":
                return generateKoreanInput({ ...candidate, name: identity });
            case "Korean 2":
                return generateKorean2Input({ ...candidate, name: identity });
            case "Japanese":
                return generateJapaneseInput({ ...candidate, name: identity });
            case "Other":
            default:
                return generateOtherInput({ ...candidate, name: identity });
        }
    }

    function regenerateCandidateInputs(candidates, template) {
        for (const candidate of candidates || []) {
            candidate.generatedInput = generateCandidateInput(candidate, template);
        }
        return candidates;
    }

    function getTabLabel(tab) {
        if (tab === "candidates") {
            return `Candidates (${state.candidates.length})`;
        }
        if (tab === "groups") {
            return `Groups (${getVisibleGroupMatches().length})`;
        }
        const clusterIds = new Set(getVisibleConflicts().map((conflict) => Number(conflict?.clusterId || 0)));
        return `Conflicts (${clusterIds.size})`;
    }

    function getVisibleCandidateClusters() {
        return Array.isArray(state.candidateClusters) ? state.candidateClusters : [];
    }

    function renderCandidateRow(candidate) {
        const frequency = Number(candidate?.frequency || 0);
        const sentenceStarts = Array.isArray(candidate?.sentenceStarts)
            ? candidate.sentenceStarts.filter(
                  (start) =>
                      start &&
                      Number(start.frequency || 0) > 0 &&
                      String(start.text || "").trim()
              )
            : [];
        const candidateName = String(candidate?.name || candidate?.normalized || "").trim();
        const generatedInput = String(candidate?.generatedInput || "").trim();
        const hasStarts = sentenceStarts.length > 0;
        const startsHtml = hasStarts
            ? `
                <div class="wnc-sentence-start-list">
                    ${sentenceStarts
                        .map(
                            (start) => `
                                <div class="wnc-sentence-start">
                                    ${escapeHtml(start.text)}
                                    <span class="wnc-muted">
                                        ${escapeHtml(Number(start.frequency || 0))}
                                    </span>
                                </div>
                            `
                        )
                        .join("")}
                </div>
            `
            : "";
        const expandButton = hasStarts
            ? `
                <button
                    type="button"
                    class="wnc-candidate-expand"
                    data-wnc-expand-candidate="1"
                    aria-expanded="false"
                    title="Show sentence starts"
                >
                    +
                </button>
            `
            : `<span class="wnc-candidate-expand-placeholder"></span>`;
        return `
            <tr>
                <td>
                    <div class="wnc-candidate-name-row">
                        ${expandButton}
                        <span class="wnc-candidate-name">${escapeHtml(candidateName)}</span>
                    </div>
                    ${hasStarts ? `<div class="wnc-sentence-starts" hidden>${startsHtml}</div>` : ""}
                </td>
                <td>${escapeHtml(frequency)}</td>
                <td>
                    <button type="button" data-wnc-highlight="${escapeHtml(candidateName)}">Highlight</button>
                    <button type="button" data-wnc-regex="${escapeHtml(generatedInput)}">Regex</button>
                    <button type="button" data-wnc-copy="${escapeHtml(generatedInput)}">Copy</button>
                </td>
            </tr>
        `;
    }

    function renderCandidatesTab() {
        const clusters = getVisibleCandidateClusters();
        if (!clusters.length) {
            return `<div class="wnc-muted">No candidates found.</div>`;
        }
        const rows = clusters
            .map(
                (cluster) => `
                    <tbody class="wnc-candidate-cluster">
                        ${(cluster.members || []).map((candidate) => renderCandidateRow(candidate)).join("")}
                    </tbody>
                `
            )
            .join("");
        return `
            <div class="wnc-tab-content">
                <table class="wnc-table" data-wnc-table="candidates">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Frequency</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    ${rows}
                </table>
            </div>
        `;
    }

    function renderGroupRule(group, rule) {
        const sourceRule = rule?.rule || rule || {};
        return `
            <tr class="wnc-group-row">
                <td>${escapeHtml(group?.name || "")}</td>
                <td class="wnc-code">${escapeHtml(sourceRule.input || "")}</td>
                <td class="wnc-code">${escapeHtml(sourceRule.output || "")}</td>
                <td>${escapeHtml(Number(rule?.matchCount || 0))}</td>
            </tr>
        `;
    }

    function renderGroupsTab() {
        const groups = sortDisplayedGroups(getVisibleGroupMatches());
        if (!groups.length) {
            return `<div class="wnc-muted">No matching FoxReplace groups found.</div>`;
        }
        const rows = groups
            .flatMap((group) => {
                const rules = getGroupRulesWithMatches(group);
                return rules.map((rule) => renderGroupRule(group, rule));
            })
            .join("");
        return `
            <div class="wnc-tab-content">
                <table class="wnc-table" data-wnc-table="groups">
                    <thead>
                        <tr>
                            <th>Group</th>
                            <th>Input</th>
                            <th>Output</th>
                            <th>Matches</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderConflict(conflict) {
        const rule = conflict?.rule || {};
        return `
            <tr class="wnc-conflict-row">
                <td>${escapeHtml(rule.groupName || "")}</td>
                <td>${escapeHtml(rule.input || "")}</td>
                <td>${escapeHtml(rule.output || "")}</td>
                <td>${escapeHtml(conflict?.target || "")}</td>
                <td>${escapeHtml(Number(conflict?.matchCount || 0))}</td>
            </tr>
        `;
    }

    function renderConflictsTab() {
        const conflicts = getVisibleConflicts();
        if (!conflicts.length) {
            return `<div class="wnc-muted">No conflicts found.</div>`;
        }
        const clusters = new Map();
        for (const conflict of conflicts) {
            const clusterId = Number(conflict?.clusterId || 0);
            if (!clusters.has(clusterId)) {
                clusters.set(clusterId, []);
            }
            clusters.get(clusterId).push(conflict);
        }
        return `
            <div class="wnc-conflicts">
                ${Array.from(clusters.entries())
                    .map(
                        ([clusterId, items]) => `
                            <div class="wnc-conflict-cluster">
                                <div class="wnc-conflict-cluster-header">Conflict ${escapeHtml(String(clusterId))}</div>
                                <table class="wnc-table" data-wnc-table="conflicts">
                                    <thead>
                                        <tr>
                                            <th>Group</th>
                                            <th>Input</th>
                                            <th>Output</th>
                                            <th>Target</th>
                                            <th>Matches</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${items.map((conflict) => renderConflict(conflict)).join("")}
                                    </tbody>
                                </table>
                            </div>
                        `
                    )
                    .join("")}
            </div>
        `;
    }

    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function getWncStyles() {
        return `
            #${UI_ID} {
                position: fixed;
                top: 40px;
                left: 50%;
                transform: translateX(-50%);
                width: min(1400px, calc(100vw - 20px));
                min-width: 320px;
                max-width: calc(100vw - 20px);
                height: calc(100vh - 80px);
                min-height: 200px;
                max-height: calc(100vh - 20px);
                overflow: auto;
                resize: both;
                z-index: 2147483647;
                background: #222 !important;
                color: #fff !important;
                border: 1px solid #777;
                border-radius: 4px;
                padding: 6px;
                box-sizing: border-box;
                font: 12px Arial, sans-serif;
                box-shadow: 0 4px 20px rgba(0,0,0,.5);
            }
            #${UI_ID}.wnc-minimized {
                width: auto;
                min-width: 160px;
                min-height: 0;
                height: auto;
                max-width: none;
                max-height: none;
                overflow: visible;
                resize: none;
                padding: 4px 6px;
                background: #222 !important;
            }
            #${UI_ID}.wnc-minimized .wnc-panel-body { display: none; }
            #${UI_ID} .wnc-panel-header {
                height: 26px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin: 0;
                background: #222 !important;
            }
            #${UI_ID} .wnc-panel-title {
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                color: #fff !important;
            }
            #${UI_ID} .wnc-panel-actions {
                display: flex;
                align-items: center;
                gap: 3px;
                flex-shrink: 0;
            }
            #${UI_ID} .wnc-panel-actions button {
                height: 22px;
                min-width: 24px;
                padding: 2px 6px;
                box-sizing: border-box;
                cursor: pointer;
            }
            #${UI_ID} .wnc-panel-body {
                height: calc(100% - 26px);
                overflow: auto;
                background: #222 !important;
                color: #fff !important;
            }
            #${UI_ID} .wnc-tab-bar {
                display: flex;
                gap: 3px;
                position: sticky;
                top: 0;
                z-index: 20;
                background: #222 !important;
                padding: 3px 0;
                border-bottom: 1px solid #555;
            }
            #${UI_ID} .wnc-tab-content {
                background: #222 !important;
                color: #fff !important;
            }
            #${UI_ID} .wnc-table {
                width: max-content;
                min-width: 100%;
                border-collapse: collapse;
                table-layout: auto;
                background: #111 !important;
                color: #fff !important;
            }
            #${UI_ID} .wnc-table th,
            #${UI_ID} .wnc-table td {
                border: 1px solid #333;
                padding: 7px;
                text-align: left;
                vertical-align: top;
                white-space: nowrap;
            }
            #${UI_ID} .wnc-table th {
                position: sticky;
                top: 0;
                z-index: 10;
                background: #181818 !important;
                color: #fff !important;
            }
            #${UI_ID} .wnc-table td {
                background: #111 !important;
                color: #fff !important;
            }
            #${UI_ID} .wnc-table td.wnc-code {
                max-width: min(700px, 55vw);
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #${UI_ID} .wnc-candidate-name-row {
                display: flex;
                align-items: center;
                gap: 4px;
            }
            #${UI_ID} .wnc-candidate-expand,
            #${UI_ID} .wnc-candidate-expand-placeholder {
                width: 20px;
                min-width: 20px;
                height: 20px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }
            #${UI_ID} .wnc-sentence-start-list {
                margin-top: 4px;
                margin-left: 24px;
            }
            #${UI_ID} .wnc-sentence-start { white-space: nowrap; }
            #${UI_ID} .wnc-muted { opacity: .7; }
            #${UI_ID} .wnc-candidate-toolbar {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
                padding: 4px 0 7px;
                background: #222 !important;
                color: #fff !important;
            }
            #${UI_ID} .wnc-candidate-toolbar label {
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }
            #${UI_ID} .wnc-candidate-toolbar select {
                min-width: 110px;
            }
            #${UI_ID} .wnc-regex-preview {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                max-width: 100%;
            }
            #${UI_ID} .wnc-regex-preview code {
                display: inline-block;
                max-width: 760px;
                overflow: auto;
                white-space: pre;
                padding: 3px 5px;
                border: 1px solid #555;
                background: #111;
                color: #fff;
            }
            #${UI_ID} .wnc-table {
                table-layout: fixed !important;
            }
            #${UI_ID} .wnc-table th {
                position: sticky;
                overflow: visible;
            }
            #${UI_ID} .wnc-col-resizer {
                position: absolute;
                top: 0;
                right: -3px;
                width: 7px;
                height: 100%;
                cursor: col-resize;
                z-index: 30;
            }
            #${UI_ID} .wnc-col-resizer:hover {
                background: rgba(255,255,255,.18);
            }
            body.wnc-resizing-column,
            body.wnc-resizing-column * {
                cursor: col-resize !important;
                user-select: none !important;
            }
        `;
    }

    function ensureWncStyles() {
        let style = document.getElementById(STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = STYLE_ID;
            document.head?.appendChild(style);
        }
        style.textContent = getWncStyles();
    }

    function showWncRegexPreview(value) {
        const preview = document.querySelector("[data-wnc-regex-preview]");
        const code = document.querySelector("[data-wnc-regex-preview-value]");
        if (!preview || !code) {
            return;
        }
        code.textContent = String(value || "");
        preview.hidden = false;
        preview.scrollIntoView({ block: "nearest" });
    }

    function copyText(text) {
        const value = String(text ?? "");
        return new Promise(async (resolve) => {
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(value);
                    resolve(true);
                    return;
                }
            } catch {
                // fall through
            }
            try {
                const textarea = document.createElement("textarea");
                textarea.value = value;
                textarea.setAttribute("readonly", "");
                textarea.style.position = "fixed";
                textarea.style.left = "-9999px";
                textarea.style.top = "0";
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const copied = document.execCommand("copy");
                textarea.remove();
                resolve(copied);
                return;
            } catch {
                resolve(false);
            }
        });
    }

    function highlightWncCandidate(value) {
        const needle = String(value || "").trim();
        if (!needle) {
            return;
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const lowerNeedle = needle.toLowerCase();
        const nodes = [];
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || parent.closest("#wnc-overlay,script,style,noscript,textarea,input")) {
                continue;
            }
            if (String(node.nodeValue || "").toLowerCase().includes(lowerNeedle)) {
                nodes.push(node);
            }
        }
        for (const textNode of nodes) {
            const parent = textNode.parentElement;
            if (!parent || parent.closest("#wnc-highlighted-candidate")) {
                continue;
            }
            const source = String(textNode.nodeValue || "");
            const lower = source.toLowerCase();
            let position = 0;
            const fragment = document.createDocumentFragment();
            while (true) {
                const index = lower.indexOf(lowerNeedle, position);
                if (index < 0) {
                    fragment.appendChild(document.createTextNode(source.slice(position)));
                    break;
                }
                fragment.appendChild(document.createTextNode(source.slice(position, index)));
                const mark = document.createElement("mark");
                mark.className = "wnc-highlighted-candidate";
                mark.textContent = source.slice(index, index + needle.length);
                fragment.appendChild(mark);
                position = index + needle.length;
            }
            parent.replaceChild(fragment, textNode);
        }
    }

    function getWncUiSettings() {
        const value = readStorage(UI_SETTINGS_KEY, null);
        if (!value || typeof value !== "object") {
            return JSON.parse(JSON.stringify(DEFAULT_UI_SETTINGS));
        }
        const merged = JSON.parse(JSON.stringify(DEFAULT_UI_SETTINGS));
        if (Number.isFinite(Number(value.width))) {
            merged.width = Number(value.width);
        }
        if (Number.isFinite(Number(value.height))) {
            merged.height = Number(value.height);
        }
        if (value.columns && typeof value.columns === "object") {
            for (const tab of Object.keys(merged.columns)) {
                if (Array.isArray(value.columns[tab])) {
                    merged.columns[tab] = value.columns[tab].map(Number).filter((n) => Number.isFinite(n) && n >= 40);
                }
            }
        }
        return merged;
    }

    function saveWncUiSettings(settings) {
        writeStorage(UI_SETTINGS_KEY, settings);
    }

    function getWncColumnWidths(tab) {
        const settings = getWncUiSettings();
        return Array.isArray(settings.columns[tab]) ? settings.columns[tab] : DEFAULT_UI_SETTINGS.columns[tab];
    }

    function saveWncColumnWidths(tab, widths) {
        const settings = getWncUiSettings();
        settings.columns[tab] = widths.map((n) => Math.max(40, Math.round(Number(n) || 40)));
        saveWncUiSettings(settings);
    }

    function applyWncColumnWidths(table, tab) {
        if (!table) {
            return;
        }
        const widths = getWncColumnWidths(tab);
        const headers = [...table.querySelectorAll("thead th")];
        headers.forEach((header, index) => {
            const width = widths[index];
            if (!Number.isFinite(width)) {
                return;
            }
            header.style.width = width + "px";
            header.style.minWidth = width + "px";
            header.style.maxWidth = width + "px";
            const cells = table.querySelectorAll("tbody tr > :nth-child(" + (index + 1) + ")");
            cells.forEach((cell) => {
                cell.style.width = width + "px";
                cell.style.minWidth = width + "px";
                cell.style.maxWidth = width + "px";
            });
        });
    }

    function installWncColumnResizers(overlay) {
        if (!overlay) {
            return;
        }
        for (const table of overlay.querySelectorAll("[data-wnc-table]")) {
            const tab = table.getAttribute("data-wnc-table") || "candidates";
            applyWncColumnWidths(table, tab);
            const headers = [...table.querySelectorAll("thead th")];
            headers.forEach((header, index) => {
                if (header.querySelector(".wnc-col-resizer")) {
                    return;
                }
                const handle = document.createElement("span");
                handle.className = "wnc-col-resizer";
                handle.title = "Drag to resize column";
                handle.dataset.wncColumnResize = "1";
                handle.dataset.wncColumn = String(index);
                handle.dataset.wncTable = tab;
                header.appendChild(handle);
            });
        }
    }

    function applyWncPanelSize(overlay) {
        if (!overlay || overlay.classList.contains("wnc-minimized")) {
            return;
        }
        const settings = getWncUiSettings();
        const viewportWidth = Math.max(320, window.innerWidth - 20);
        const width = Math.max(320, Math.min(Number(settings.width || 1400), viewportWidth));
        overlay.style.width = width + "px";
        if (Number(settings.height) > 0) {
            const viewportHeight = Math.max(220, window.innerHeight - 20);
            const height = Math.max(200, Math.min(Number(settings.height), viewportHeight));
            overlay.style.height = height + "px";
        } else {
            overlay.style.height = "auto";
            overlay.style.maxHeight = "calc(100vh - 20px)";
        }
    }

    function saveWncPanelSize(overlay) {
        if (!overlay || overlay.classList.contains("wnc-minimized")) {
            return;
        }
        const settings = getWncUiSettings();
        const rect = overlay.getBoundingClientRect();
        if (rect.width >= 320) {
            settings.width = Math.round(rect.width);
        }
        if (rect.height >= 200) {
            settings.height = Math.round(rect.height);
        }
        saveWncUiSettings(settings);
    }

    function ensureWncCandidateControls(overlay) {
        const candidateTable = overlay?.querySelector(".wnc-tab-content .wnc-table[data-wnc-table='candidates']");
        if (!candidateTable || candidateTable.querySelectorAll("thead th").length !== 3) {
            return;
        }
        let toolbar = overlay.querySelector(".wnc-candidate-toolbar");
        if (!toolbar) {
            toolbar = document.createElement("div");
            toolbar.className = "wnc-candidate-toolbar";
            candidateTable.parentNode.insertBefore(toolbar, candidateTable);
        }
        toolbar.innerHTML = "";

        const label = document.createElement("label");
        label.textContent = "Regex template ";
        const select = document.createElement("select");
        select.dataset.wncTemplate = "1";
        for (const item of INPUT_TEMPLATES) {
            const option = document.createElement("option");
            option.value = item;
            option.textContent = item;
            option.selected = item === state.candidateTemplate;
            select.appendChild(option);
        }
        label.appendChild(select);
        toolbar.appendChild(label);

        const preview = document.createElement("div");
        preview.className = "wnc-regex-preview";
        preview.dataset.wncRegexPreview = "1";
        preview.hidden = true;
        const previewLabel = document.createElement("span");
        previewLabel.className = "wnc-regex-preview-label";
        previewLabel.textContent = "Regex preview:";
        preview.appendChild(previewLabel);
        const code = document.createElement("code");
        code.dataset.wncRegexPreviewValue = "1";
        preview.appendChild(code);
        const copy = document.createElement("button");
        copy.type = "button";
        copy.textContent = "Copy regex";
        copy.dataset.wncRegexCopy = "1";
        preview.appendChild(copy);
        toolbar.appendChild(preview);
    }

    function render() {
        ensureWncStyles();
        let overlay = document.getElementById(UI_ID);
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = UI_ID;
            document.body.appendChild(overlay);
        }

        const minimized = overlay.classList.contains("wnc-minimized");
        const savedWidth = !minimized && overlay.style.width ? overlay.style.width : "";
        const savedHeight = !minimized && overlay.style.height ? overlay.style.height : "";

        overlay.innerHTML = `
            <div class="wnc-panel-header">
                <div class="wnc-panel-title">Webnovel Cleaner</div>
                <div class="wnc-panel-actions">
                    <button type="button" data-wnc-minimize="1" title="${minimized ? "Restore" : "Minimize"}">${minimized ? "□" : "−"}</button>
                    <button type="button" data-wnc-close="1" title="Close">×</button>
                </div>
            </div>
            <div class="wnc-panel-body">
                <div class="wnc-tab-bar">
                    ${TAB_ORDER.map(
                        (tab) => `
                            <button type="button" data-wnc-tab="${escapeHtml(tab)}">
                                ${escapeHtml(getTabLabel(tab))}
                            </button>
                        `
                    ).join("")}
                </div>
                ${state.screen === "groups" ? renderGroupsTab() : state.screen === "conflicts" ? renderConflictsTab() : renderCandidatesTab()}
            </div>
        `;

        Object.assign(overlay.style, {
            position: "fixed",
            top: minimized ? "10px" : "40px",
            left: "50%",
            right: "auto",
            bottom: "auto",
            transform: "translateX(-50%)",
            margin: "0",
            padding: minimized ? "4px 6px" : "6px",
            boxSizing: "border-box",
            minWidth: minimized ? "160px" : "320px",
            maxWidth: minimized ? "none" : "calc(100vw - 20px)",
            minHeight: minimized ? "0" : "200px",
            maxHeight: minimized ? "none" : "calc(100vh - 20px)",
            zIndex: "2147483647",
            display: "block",
            visibility: "visible",
            opacity: "1"
        });

        if (minimized) {
            overlay.style.width = "auto";
            overlay.style.height = "auto";
            overlay.classList.add("wnc-minimized");
        } else {
            overlay.classList.remove("wnc-minimized");
            if (savedWidth) {
                overlay.style.width = savedWidth;
            } else {
                overlay.style.width = "min(1400px, calc(100vw - 20px))";
            }
            if (savedHeight) {
                overlay.style.height = savedHeight;
            } else {
                overlay.style.height = "calc(100vh - 80px)";
            }
            overlay.style.overflow = "auto";
            overlay.style.resize = "both";
        }

        applyWncPanelSize(overlay);
        ensureWncCandidateControls(overlay);
        installWncColumnResizers(overlay);
        return overlay;
    }

    function openWnc() {
        state.screen = "candidates";
        state.analysisError = null;
        render();
        runAnalysisSafely();
        render();
    }

    function closeWnc() {
        document.getElementById(UI_ID)?.remove();
    }

    function registerWncMenuCommands() {
        if (typeof GM_registerMenuCommand !== "function") {
            return false;
        }
        GM_registerMenuCommand("Open Webnovel Cleaner", () => {
            try {
                openWnc();
            } catch (error) {
                state.analysisError = error;
                render();
            }
        });
        GM_registerMenuCommand("Import FoxReplace JSON", () => {
            try {
                openImportPicker();
            } catch (error) {
                state.analysisError = error;
                render();
            }
        });
        return true;
    }

    function analyzePage() {
        state.analysisError = null;
        clearAnalysisResults();
        const pageText = scanPageText();
        const candidateScan = scanChapterCandidates(pageText);
        const candidates = candidateScan.candidates;
        const siteRules = getCurrentSiteRules();
        const pageRuleMatches = scanFoxReplacePage(pageText, siteRules);
        const pageMatchedRules = pageRuleMatches.map(({ rule }) => rule);
        const candidateRuleMatches = new Map();
        for (const candidate of candidates) {
            candidateRuleMatches.set(candidate, findCandidateRuleMatches(candidate, pageMatchedRules));
        }
        const remainingCandidates = candidates.filter((candidate) => {
            const matches = candidateRuleMatches.get(candidate);
            return !matches?.exact?.length;
        });
        const candidatePool = processCandidateClusters(remainingCandidates);
        state.candidates = buildCandidateResults(candidatePool.candidates);
        state.candidateClusters = candidatePool.clusters;
        state.groupMatches = buildGroupMatches(pageRuleMatches, candidateRuleMatches);
        const conflictClusters = buildConflictClusters(pageRuleMatches, pageText);
        state.conflicts = buildConflictData(pageRuleMatches, conflictClusters);
        render();
    }

    function runAnalysisSafely() {
        try {
            analyzePage();
            return true;
        } catch (error) {
            clearAnalysisResults();
            state.analysisError = error;
            return false;
        }
    }

    function scanPageText() {
        const root = document.body;
        if (!root) {
            return "";
        }
        const blockTags = /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|DL|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H1|H2|H3|H4|H5|H6|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/;
        const ignoredClassPattern = /(?:breadcrumb|pagination|pager|chapter[-_ ]?(?:nav|navigation|list|link)|next[-_ ]?(?:chapter|page)|prev(?:ious)?[-_ ]?(?:chapter|page)|report[-_ ]?(?:chapter|issue)|chapter[-_ ]?issue|co[\s\S]*?(?:nav|pager)|page[-_ ]?(?:nav|navigation))/i;
        const parts = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        let previousNode = null;
        let previousBlock = null;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) {
                continue;
            }
            if (parent.closest("script, style, noscript, template, svg, #wnc-overlay")) {
                previousNode = null;
                previousBlock = null;
                continue;
            }
            let displayElement = parent;
            let hidden = false;
            while (displayElement && displayElement !== root) {
                if (window.getComputedStyle(displayElement).display === "none") {
                    hidden = true;
                    break;
                }
                displayElement = displayElement.parentElement;
            }
            if (hidden) {
                previousNode = null;
                previousBlock = null;
                continue;
            }
            const ignoredElement = parent.closest("aside, button, footer, form, h1, h2, h3, h4, h5, h6, header, input, label, nav, option, select, textarea, time");
            if (ignoredElement) {
                previousNode = null;
                previousBlock = null;
                continue;
            }
            let classElement = parent;
            let ignored = false;
            while (classElement && classElement !== root) {
                const className = typeof classElement.className === "string" ? classElement.className : "";
                const id = String(classElement.id || "");
                if (ignoredClassPattern.test(className) || ignoredClassPattern.test(id)) {
                    ignored = true;
                    break;
                }
                classElement = classElement.parentElement;
            }
            if (ignored) {
                previousNode = null;
                previousBlock = null;
                continue;
            }
            const rawText = String(node.nodeValue || "");
            if (!rawText || !rawText.trim()) {
                continue;
            }
            const text = rawText.replace(/\u00A0/g, " ").replace(/[ \t\r\n]+/g, " ");
            if (!text.trim()) {
                continue;
            }
            let currentBlock = parent;
            while (currentBlock && currentBlock !== root && !blockTags.test(currentBlock.tagName)) {
                currentBlock = currentBlock.parentElement;
            }
            if (previousNode) {
                const previousParent = previousNode.parentElement;
                if (previousParent) {
                    const previousCommon = getCommonAncestor(previousParent, parent);
                    const previousBlockElement = findNearestBlockElement(previousParent, previousCommon, blockTags);
                    const currentBlockElement = findNearestBlockElement(parent, previousCommon, blockTags);
                    if (previousBlock && currentBlock && previousBlock !== currentBlock) {
                        parts.push(" ");
                    } else if (previousBlockElement && currentBlockElement && previousBlockElement !== currentBlockElement) {
                        parts.push(" ");
                    } else {
                        const previousPart = parts.length ? String(parts[parts.length - 1]) : "";
                        if (/[A-Za-z0-9'’-]$/.test(previousPart) && /^[A-Za-z0-9'’-]/.test(text)) {
                            parts.push(" ");
                        }
                    }
                }
            }
            parts.push(text);
            previousNode = node;
            previousBlock = currentBlock;
        }
        return parts.join("").replace(/\s+/g, " ").trim();
    }

    function getCommonAncestor(first, second) {
        let ancestor = first;
        while (ancestor) {
            if (ancestor.contains(second)) {
                return ancestor;
            }
            ancestor = ancestor.parentElement;
        }
        return null;
    }

    function findNearestBlockElement(element, boundary, blockTags) {
        let current = element;
        while (current && current !== boundary) {
            if (current.nodeType === Node.ELEMENT_NODE && blockTags.test(current.tagName)) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }

    function handleOverlayClick(event) {
        const expandButton = event.target.closest("[data-wnc-expand-candidate]");
        if (expandButton) {
            const row = expandButton.closest("tr");
            if (!row) {
                return;
            }
            const starts = row.querySelector(".wnc-sentence-starts");
            if (!starts) {
                return;
            }
            const expanded = starts.hidden === false;
            starts.hidden = expanded;
            expandButton.textContent = expanded ? "+" : "−";
            expandButton.setAttribute("aria-expanded", expanded ? "false" : "true");
            return;
        }

        const highlightButton = event.target.closest("[data-wnc-highlight]");
        if (highlightButton) {
            const value = highlightButton.getAttribute("data-wnc-highlight");
            if (value) {
                highlightWncCandidate(value);
            }
            return;
        }

        const regexButton = event.target.closest("[data-wnc-regex]");
        if (regexButton) {
            const value = regexButton.getAttribute("data-wnc-regex");
            if (value) {
                showWncRegexPreview(value);
            }
            return;
        }

        const copyButton = event.target.closest("[data-wnc-copy]");
        if (copyButton) {
            const value = copyButton.getAttribute("data-wnc-copy") || "";
            copyText(value);
            return;
        }

        const minimizeButton = event.target.closest("[data-wnc-minimize]");
        if (minimizeButton) {
            const overlay = document.getElementById(UI_ID);
            if (overlay) {
                overlay.classList.toggle("wnc-minimized");
                render();
            }
            return;
        }

        const closeButton = event.target.closest("[data-wnc-close]");
        if (closeButton) {
            closeWnc();
            return;
        }

        const tabButton = event.target.closest("[data-wnc-tab]");
        if (tabButton) {
            state.screen = tabButton.getAttribute("data-wnc-tab") || "candidates";
            render();
        }
    }

    function handleGlobalPointerDown(event) {
        const handle = event.target.closest("[data-wnc-column-resize]");
        if (!handle) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const table = handle.closest("table");
        const header = handle.closest("th");
        if (!table || !header) {
            return;
        }
        const tab = handle.dataset.wncTable || "candidates";
        const index = Number(handle.dataset.wncColumn);
        const widths = getWncColumnWidths(tab);
        const startWidth = header.getBoundingClientRect().width;
        wncColumnDrag = { table, tab, index, startX: event.clientX, startWidth, widths };
        handle.setPointerCapture?.(event.pointerId);
        document.body.classList.add("wnc-resizing-column");
    }

    function handleGlobalPointerMove(event) {
        if (!wncColumnDrag) {
            return;
        }
        const drag = wncColumnDrag;
        const width = Math.max(40, Math.round(drag.startWidth + event.clientX - drag.startX));
        drag.widths[drag.index] = width;
        applyWncColumnWidths(drag.table, drag.tab);
    }

    function handleGlobalPointerUp() {
        if (!wncColumnDrag) {
            return;
        }
        saveWncColumnWidths(wncColumnDrag.tab, wncColumnDrag.widths);
        document.body.classList.remove("wnc-resizing-column");
        wncColumnDrag = null;
    }

    function attachWncEvents() {
        const overlay = document.getElementById(UI_ID);
        if (overlay) {
            overlay.onclick = handleOverlayClick;
        }
        document.addEventListener("pointerdown", handleGlobalPointerDown, true);
        document.addEventListener("pointermove", handleGlobalPointerMove, true);
        document.addEventListener("pointerup", handleGlobalPointerUp, true);
        document.addEventListener("change", (event) => {
            const select = event.target.closest("[data-wnc-template]");
            if (!select) {
                return;
            }
            const template = INPUT_TEMPLATES.includes(select.value) ? select.value : "Other";
            state.candidateTemplate = template;
            writeStorage(CANDIDATE_TEMPLATE_KEY, template);
            regenerateCandidateInputs(state.candidates, template);
            for (const cluster of state.candidateClusters || []) {
                regenerateCandidateInputs(cluster.members || [], template);
            }
            render();
        }, true);
        document.addEventListener("click", (event) => {
            const regexCopy = event.target.closest("[data-wnc-regex-copy]");
            if (regexCopy) {
                const code = document.querySelector("[data-wnc-regex-preview-value]");
                if (code) {
                    copyText(code.textContent || "");
                }
                return;
            }
            const regexButton = event.target.closest("[data-wnc-regex]");
            if (regexButton) {
                showWncRegexPreview(regexButton.getAttribute("data-wnc-regex") || "");
            }
        }, true);
        window.addEventListener("resize", () => {
            const overlayEl = document.getElementById(UI_ID);
            if (overlayEl) {
                applyWncPanelSize(overlayEl);
                installWncColumnResizers(overlayEl);
            }
        });
    }

    function startWncPanelResizePersistence() {
        const overlay = document.getElementById(UI_ID);
        if (!overlay) {
            return;
        }
        if (wncPanelResizeObserver) {
            wncPanelResizeObserver.disconnect();
        }
        wncPanelResizeObserver = new ResizeObserver(() => {
            if (overlay && !overlay.classList.contains("wnc-minimized") && overlay.matches(":hover")) {
                saveWncPanelSize(overlay);
            }
        });
        wncPanelResizeObserver.observe(overlay);
    }

    function mutateRenderAfterCreate() {
        const overlay = document.getElementById(UI_ID);
        if (!overlay) {
            return;
        }
        applyWncPanelSize(overlay);
        ensureWncCandidateControls(overlay);
        installWncColumnResizers(overlay);
        startWncPanelResizePersistence();
    }

    const originalRender = render;
    render = function () {
        const result = originalRender.apply(this, arguments);
        mutateRenderAfterCreate();
        return result;
    };

    function bootWnc() {
        registerWncMenuCommands();
        try {
            initializeWnc();
        } catch (error) {
            adaptedDatabase = { groups: [] };
            ensureDatabaseShape();
            state.analysisError = error;
        }
        attachWncEvents();
    }

    bootWnc();
})();
