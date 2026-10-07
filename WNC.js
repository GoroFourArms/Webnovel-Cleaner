// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.2.3
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
    const DB_KEY = "WNC_FOXREPLACE_DATABASE_V2";
    const OCCURRENCE_REGEX =
        /(?<![A-Z0-9'’-])((?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*)(?:\s+(?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*))*)(?![A-Za-z0-9'’-])/g;
    const INPUT_TEMPLATES = ["Other", "Korean", "Korean 2", "Japanese"];
    const state = {
        collapsedGroups: new Set(),
        screen: "candidates",
        candidates: [],
        candidateClusters: [],
        groupMatches: [],
        conflicts: [],
        candidateTemplate: "Other",
        expandedRules: new Set()
    };
    const RULE_REGEX_CACHE = new WeakMap();
    let adaptedDatabase = {
        groups: []
    };
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
        const name = String(group.name ?? `Group ${groupIndex + 1}`);
        const rawRules = Array.isArray(group.substitutions)
            ? group.substitutions
            : [];
        const rules = rawRules.map((rule, ruleIndex) =>
            normalizeRule(rule, ruleIndex, groupIndex, name)
        );
        return {
            raw: group,
            index: groupIndex,
            name,
            urls: normalizeUrls(group.urls),
            rules,
            enabled: normalizeBoolean(group.enabled, true),
            mode: String(group.mode ?? ""),
            pageLoad: normalizeBoolean(group.pageLoad, false),
            auto: normalizeBoolean(group.auto, false),
            html: group.html ?? null
        };
    }
    function findGroupArray(database) {
        if (!database || typeof database !== "object") {
            return [];
        }
        return Array.isArray(database.groups) ? database.groups : [];
    }
    function adaptFoxReplaceDatabase(rawDatabase) {
        const groups = findGroupArray(rawDatabase);
        return {
            groups: groups.map((group, groupIndex) =>
                normalizeGroup(group, groupIndex)
            )
        };
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
        return {
            groups: []
        };
    }
    function parseImportedText(text) {
        try {
            const database = JSON.parse(text);
            if (
                !database ||
                typeof database !== "object" ||
                !Array.isArray(database.groups) ||
                !database.groups.length
            ) {
                return null;
            }
            const version = String(database.version ?? "").trim();
            if (version && !/^2\.\d+$/.test(version)) {
                return null;
            }
            return database;
        } catch {
            return null;
        }
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
    function openImportPicker() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.addEventListener("change", async () => {
            const file = input.files?.[0];
            if (!file) {
                return;
            }
            try {
                const text = await readFileText(file);
                const database = parseImportedText(text);
                if (!database) {
                    return;
                }
                if (!writeStorage(DB_KEY, database)) {
                    return;
                }
                adaptedDatabase = adaptFoxReplaceDatabase(database);
                render();
            } catch {
                return;
            }
        });
        input.click();
    }
    function wildcardToRegex(value) {
        const escaped = escapeRegexLiteral(value);
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
    function getCurrentSiteRules() {
        return getCurrentSiteGroups().flatMap((group) =>
            (group.rules || []).filter((rule) => rule.enabled)
        );
    }
    function scanOccurrences(text) {
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
            occurrences.push({
                text: value,
                index: startIndex,
                isSentenceStart
            });
        }
        return occurrences;
    }
    function findSentenceStartMatch(starter, candidates) {
        if (!starter || !Array.isArray(candidates) || !candidates.length) {
            return null;
        }
        const starterTokens = getCandidateTokens(starter);
        if (!starterTokens.length) {
            return null;
        }
        const starterTokenSet = new Set(starterTokens);
        const matches = [];
        for (const candidate of candidates) {
            const candidateTokens = getCandidateTokens(candidate);
            if (!candidateTokens.length) {
                continue;
            }
            const sharedContiguousTokens = getSharedContiguousTokenCount(
                starterTokens,
                candidateTokens
            );
            if (sharedContiguousTokens <= 0) {
                continue;
            }
            let sharedTokenCount = 0;
            const candidateTokenSet = new Set(candidateTokens);
            for (const token of candidateTokenSet) {
                if (starterTokenSet.has(token)) {
                    sharedTokenCount++;
                }
            }
            matches.push({
                candidate,
                sharedContiguousTokens,
                sharedTokenCount,
                originalIndex: Number(candidate.originalIndex ?? Infinity),
                candidateTokenCount: candidateTokens.length
            });
        }
        if (!matches.length) {
            return null;
        }
        matches.sort((a, b) => {
            if (b.sharedContiguousTokens !== a.sharedContiguousTokens) {
                return b.sharedContiguousTokens - a.sharedContiguousTokens;
            }
            if (b.sharedTokenCount !== a.sharedTokenCount) {
                return b.sharedTokenCount - a.sharedTokenCount;
            }
            if (a.originalIndex !== b.originalIndex) {
                return a.originalIndex - b.originalIndex;
            }
            return a.candidateTokenCount - b.candidateTokenCount;
        });
        return matches[0].candidate;
    }
    function applySentenceStartMatches(candidates, sentenceStarts) {
        if (!Array.isArray(candidates) || !Array.isArray(sentenceStarts)) {
            return;
        }
        const orderedCandidates = [...candidates].sort((a, b) => {
            const frequencyDifference =
                Number(b.frequency || 0) - Number(a.frequency || 0);
            if (frequencyDifference !== 0) {
                return frequencyDifference;
            }
            return Number(a.originalIndex || 0) - Number(b.originalIndex || 0);
        });
        for (const starter of sentenceStarts) {
            if (!starter) {
                continue;
            }
            const frequency = Number(starter.frequency || 0);
            if (frequency <= 0) {
                continue;
            }
            const candidate = findSentenceStartMatch(
                starter,
                orderedCandidates
            );
            if (!candidate) {
                continue;
            }
            if (!Array.isArray(candidate.sentenceStarts)) {
                candidate.sentenceStarts = [];
            }
            candidate.frequency = Number(candidate.frequency || 0) + frequency;
            candidate.sentenceStarts.push({
                text: starter.text,
                normalized: starter.normalized,
                frequency
            });
            starter.matchedCandidate = candidate;
            starter.frequency = 0;
        }
    }
    function splitCandidateTokens(candidate) {
        return String(candidate ?? "")
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }
    function normalizeCandidateToken(token) {
        let value = String(token ?? "")
            .trim()
            .toLowerCase()
            .replace(/[’']/g, "");
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
    function normalizedCandidateRegexValue(name) {
        return normalizeGeneratedInputSpacing(name || "");
    }
    function mergeCandidateOccurrences(occurrences) {
        const candidateMap = new Map();
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
            const targetMap = occurrence.isSentenceStart
                ? sentenceStartMap
                : candidateMap;
            let entry = targetMap.get(normalized);
            if (!entry) {
                entry = occurrence.isSentenceStart
                    ? {
                          text,
                          normalized,
                          frequency: 0,
                          variants: new Map(),
                          originalIndex: occurrence.index
                      }
                    : {
                          name: text,
                          normalized,
                          frequency: 0,
                          variants: new Map(),
                          sentenceStarts: [],
                          originalIndex: occurrence.index
                      };
                targetMap.set(normalized, entry);
            }
            entry.frequency++;
            const variantCount = Number(entry.variants.get(text) || 0);
            entry.variants.set(text, variantCount + 1);
        }
        return {
            candidates: [...candidateMap.values()],
            sentenceStarts: [...sentenceStartMap.values()]
        };
    }
    function chooseCandidateDisplayName(candidate) {
        if (!candidate?.variants?.size) {
            return candidate?.name || "";
        }
        const variants = [...candidate.variants.keys()]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
            .filter(
                (value) =>
                    normalizeCandidate(value) ===
                    String(candidate.normalized || "")
            );
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
                name: chooseCandidateDisplayName({
                    ...candidate,
                    normalized
                }),
                originalIndex: candidate.originalIndex ?? index
            };
        });
    }
    function scanChapterCandidates(text) {
        const occurrences = scanOccurrences(text);
        const merged = mergeCandidateOccurrences(occurrences);
        merged.candidates = finalizeCandidateNames(merged.candidates);
        applySentenceStartMatches(merged.candidates, merged.sentenceStarts);
        return {
            candidates: merged.candidates,
            sentenceStarts: merged.sentenceStarts
        };
    }
    function getCandidateTokens(value) {
        if (
            value &&
            typeof value === "object" &&
            Array.isArray(value.normalizedTokens)
        ) {
            return value.normalizedTokens;
        }
        const source =
            typeof value === "object"
                ? value?.normalized || value?.name || ""
                : value;
        const tokens = splitCandidateTokens(normalizeCandidate(source));
        if (value && typeof value === "object") {
            value.normalizedTokens = tokens;
        }
        return tokens;
    }
    function getSharedContiguousTokenCount(valueA, valueB) {
        const tokensA = Array.isArray(valueA)
            ? valueA
            : getCandidateTokens(valueA);
        const tokensB = Array.isArray(valueB)
            ? valueB
            : getCandidateTokens(valueB);
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
                    count++;
                }
                if (count > best) {
                    best = count;
                }
            }
        }
        return best;
    }
    function buildCandidateClusters(candidates) {
        const remaining = new Set(candidates || []);
        const ordered = [...remaining].sort((a, b) => {
            if (Number(b.frequency || 0) !== Number(a.frequency || 0)) {
                return Number(b.frequency || 0) - Number(a.frequency || 0);
            }
            return Number(a.originalIndex || 0) - Number(b.originalIndex || 0);
        });
        const tokenIndex = new Map();
        for (const candidate of ordered) {
            const tokens = getCandidateTokens(candidate);
            for (const token of tokens) {
                if (!tokenIndex.has(token)) {
                    tokenIndex.set(token, new Set());
                }
                tokenIndex.get(token).add(candidate);
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
                for (const token of getCandidateTokens(candidate)) {
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
                for (const other of ordered) {
                    if (!related.has(other)) {
                        continue;
                    }
                    if (!remaining.has(other)) {
                        continue;
                    }
                    remaining.delete(other);
                    queue.push({
                        candidate: other,
                        depth: depth + 1
                    });
                }
            }
            members.sort((a, b) => {
                if (Number(b.frequency || 0) !== Number(a.frequency || 0)) {
                    return Number(b.frequency || 0) - Number(a.frequency || 0);
                }
                return (
                    Number(a.originalIndex || 0) - Number(b.originalIndex || 0)
                );
            });
            clusters.push({
                root,
                members
            });
        }
        return clusters;
    }
    function rangesOverlap(rangesA, rangesB) {
        if (!rangesA?.length || !rangesB?.length) {
            return false;
        }
        const first = [...rangesA].sort(
            (a, b) => Number(a.start || 0) - Number(b.start || 0)
        );
        const second = [...rangesB].sort(
            (a, b) => Number(a.start || 0) - Number(b.start || 0)
        );
        let i = 0;
        let j = 0;
        while (i < first.length && j < second.length) {
            const a = first[i];
            const b = second[j];
            if (
                Number(a.start || 0) < Number(b.end || 0) &&
                Number(b.start || 0) < Number(a.end || 0)
            ) {
                return true;
            }
            if (Number(a.end || 0) <= Number(b.end || 0)) {
                i++;
            } else {
                j++;
            }
        }
        return false;
    }
    function processCandidateClusters(candidates) {
        const UNCLUSTERED_FREQUENCY_RATIO = 0.05;
        const clusters = buildCandidateClusters(candidates);
        const maxFrequency = Math.max(
            0,
            ...clusters.map((cluster) => Number(cluster.root?.frequency || 0))
        );
        const threshold = maxFrequency * UNCLUSTERED_FREQUENCY_RATIO;
        const retainedClusters = clusters.filter((cluster) => {
            if (cluster.members.length > 1) {
                return true;
            }
            return Number(cluster.root?.frequency || 0) >= threshold;
        });
        const retainedCandidates = retainedClusters.flatMap(
            (cluster) => cluster.members
        );
        return {
            candidates: retainedCandidates,
            clusters: retainedClusters
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
    function regexpRuleMatches(value, rule) {
        const regex = compileRuleRegex(rule);
        if (!regex) {
            return false;
        }
        regex.lastIndex = 0;
        return regex.test(String(value ?? ""));
    }
    function plainRuleMatches(value, rule) {
        const text = String(value ?? "");
        const input = String(rule?.input ?? "");
        if (!text || !input) {
            return false;
        }
        if (rule.caseSensitive) {
            return text.includes(input);
        }
        return text.toLowerCase().includes(input.toLowerCase());
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
                "(?<![A-Za-z0-9'’-])" +
                    escapeRegex(input) +
                    "(?![A-Za-z0-9'’-])",
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
    function findCandidateRuleMatches(candidate, rules) {
        const exact = [];
        const partial = [];
        const forms = getCandidateMatchForms(candidate);
        if (!candidate || !forms.length) {
            return {
                exact,
                partial,
                all: []
            };
        }
        for (const rule of rules || []) {
            if (!rule) {
                continue;
            }
            let matched = false;
            let exactMatch = false;
            for (const form of forms) {
                let formMatched = false;
                let formExact = false;
                if (rule.inputType === "regexp") {
                    if (!regexpRuleMatches(form, rule)) {
                        continue;
                    }
                    formMatched = true;
                    const ranges = findRulePageMatchRanges(form, rule);
                    formExact =
                        ranges.length === 1 &&
                        ranges[0].start === 0 &&
                        ranges[0].end === form.length;
                } else if (rule.inputType === "wholewords") {
                    if (
                        !wholeWordRuleMatches(
                            form,
                            rule.input,
                            rule.caseSensitive
                        )
                    ) {
                        continue;
                    }
                    formMatched = true;
                    const input = String(rule.input ?? "");
                    const value = String(form ?? "");
                    const left = rule.caseSensitive
                        ? value
                        : value.toLowerCase();
                    const right = rule.caseSensitive
                        ? input
                        : input.toLowerCase();
                    formExact = left === right;
                } else if (rule.inputType === "text") {
                    if (!plainRuleMatches(form, rule)) {
                        continue;
                    }
                    formMatched = true;
                    const input = String(rule.input ?? "");
                    const value = String(form ?? "");
                    const left = rule.caseSensitive
                        ? value
                        : value.toLowerCase();
                    const right = rule.caseSensitive
                        ? input
                        : input.toLowerCase();
                    formExact = left === right;
                }
                if (!formMatched) {
                    continue;
                }
                matched = true;
                if (formExact) {
                    exactMatch = true;
                    break;
                }
            }
            if (exactMatch) {
                exact.push(rule);
            } else if (matched) {
                partial.push(rule);
            }
        }
        return {
            exact,
            partial,
            all: [...exact, ...partial]
        };
    }
    function buildGroupMatches(
        pageRuleMatches,
        candidateRuleMatches,
        retainedCandidates
    ) {
        const retainedSet = new Set(retainedCandidates || []);
        const matchedRules = new Map();
        const pageMatchMap = new Map();
        for (const pageMatch of pageRuleMatches || []) {
            if (!pageMatch?.rule) continue;
            pageMatchMap.set(pageMatch.rule, pageMatch);
        }
        for (const [candidate, matches] of candidateRuleMatches || []) {
            if (!retainedSet.has(candidate)) {
                continue;
            }
            for (const rule of matches?.all || []) {
                if (!rule) continue;
                const pageMatch = pageMatchMap.get(rule);
                if (!pageMatch) {
                    continue;
                }
                let entry = matchedRules.get(rule);
                if (!entry) {
                    entry = {
                        rule,
                        candidates: [],
                        matchCount: Number(pageMatch.matchCount || 0)
                    };
                    matchedRules.set(rule, entry);
                }
                if (!entry.candidates.includes(candidate)) {
                    entry.candidates.push(candidate);
                }
            }
        }
        const groups = [];
        const groupMap = new Map();
        for (const pageMatch of pageRuleMatches || []) {
            const rule = pageMatch?.rule;
            if (!rule || !matchedRules.has(rule)) {
                continue;
            }
            let group = groupMap.get(rule.groupIndex);
            if (!group) {
                group = {
                    index: rule.groupIndex,
                    name: rule.groupName,
                    rules: []
                };
                groupMap.set(rule.groupIndex, group);
                groups.push(group);
            }
            group.rules.push(matchedRules.get(rule));
        }
        return groups;
    }
    function buildConflictData(pageRuleMatches, conflictClusters) {
        const clusterMap = new Map();
        conflictClusters.forEach((cluster, clusterIndex) => {
            const clusterId = clusterIndex + 1;
            for (const rule of cluster) {
                clusterMap.set(rule, clusterId);
            }
        });
        return pageRuleMatches
            .filter(({ rule }) => clusterMap.has(rule))
            .map(({ rule, matchCount }) => ({
                rule,
                matchCount,
                clusterId: clusterMap.get(rule)
            }));
    }
    function escapeRegexLiteral(value) {
        return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
    function normalizeGeneratedInputSpacing(value) {
        return String(value ?? "")
            .replace(/\s+/g, " ")
            .trim();
    }
    function generateOtherInput(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.regexValue ??
                candidate?.name ??
                candidate?.displayName ??
                ""
        );
        if (!value) {
            return "";
        }
        return "(?<![a-z])" + escapeRegexLiteral(value) + "(?![a-z])";
    }
    function generateKoreanInput(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.regexValue ??
                candidate?.name ??
                candidate?.displayName ??
                ""
        );
        if (!value) {
            return "";
        }
        const original = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.displayName || ""
        );
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
        const pattern = nameTokens
            .map((token) => escapeRegexLiteral(token))
            .join("[- ]?");
        return "(?<![a-z])" + pattern + "(?![a-z])";
    }
    function generateKorean2Input(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.regexValue ??
                candidate?.name ??
                candidate?.displayName ??
                ""
        );
        if (!value) {
            return "";
        }
        const original = normalizeGeneratedInputSpacing(
            candidate?.name || candidate?.displayName || ""
        );
        const originalTokens = splitCandidateTokens(original);
        let nameValue = value;
        if (originalTokens.length > 1) {
            const firstToken = originalTokens[0];
            const valueTokens = splitCandidateTokens(value);
            if (
                valueTokens.length > 1 &&
                valueTokens[0].toLowerCase() === firstToken.toLowerCase()
            ) {
                nameValue = valueTokens.slice(1).join(" ");
            }
        }
        const nameTokens = splitCandidateTokens(nameValue);
        if (!nameTokens.length) {
            return "";
        }
        const namePattern = nameTokens
            .map((token) => escapeRegexLiteral(token))
            .join("[- ]?");
        if (originalTokens.length <= 1) {
            return "(?<![a-z])" + namePattern + "(?![a-z])";
        }
        return (
            "(?<![a-z])" +
            "(?:" +
            escapeRegexLiteral(originalTokens[0]) +
            " )?" +
            namePattern +
            "(?![a-z])"
        );
    }
    function generateJapaneseInput(candidate) {
        const value = normalizeGeneratedInputSpacing(
            candidate?.regexValue ??
                candidate?.name ??
                candidate?.displayName ??
                ""
        );
        if (!value) {
            return "";
        }
        const tokens = splitCandidateTokens(value);
        if (tokens.length <= 1) {
            return "(?<![a-z])" + escapeRegexLiteral(value) + "(?![a-z])";
        }
        const forward = tokens.map(escapeRegexLiteral).join("\\s+");
        const reverse = [tokens[tokens.length - 1], ...tokens.slice(0, -1)]
            .map(escapeRegexLiteral)
            .join("\\s+");
        return "(?<![a-z])(?:" + forward + "|" + reverse + ")(?![a-z])";
    }
    function generateCandidateInput(
        candidate,
        template = state.candidateTemplate
    ) {
        if (!candidate) {
            return "";
        }
        const identity = String(
            candidate.name || candidate.normalized || ""
        ).trim();
        if (!identity) {
            return "";
        }
        const identityTokens = splitCandidateTokens(identity);
        if (!identityTokens.length) {
            return "";
        }
        const base = identityTokens.join(" ");
        const forms = new Set([base, `${base}s`, `${base}'s`, `${base}s'`]);
        if (candidate.variants instanceof Map) {
            for (const variant of candidate.variants.keys()) {
                const value = String(variant || "").trim();
                if (
                    value &&
                    normalizeCandidate(value) === normalizeCandidate(base)
                ) {
                    forms.add(value);
                }
            }
        } else if (Array.isArray(candidate.variants)) {
            for (const variant of candidate.variants) {
                const value = String(variant || "").trim();
                if (
                    value &&
                    normalizeCandidate(value) === normalizeCandidate(base)
                ) {
                    forms.add(value);
                }
            }
        }
        const generationCandidate = {
            ...candidate,
            name: base,
            normalized: normalizeCandidate(base),
            variants: new Map([...forms].map((form) => [form, 1]))
        };
        switch (template) {
            case "Korean":
                return generateKoreanInput(generationCandidate);
            case "Korean 2":
                return generateKorean2Input(generationCandidate);
            case "Japanese":
                return generateJapaneseInput(generationCandidate);
            case "Other":
            default:
                return generateOtherInput(generationCandidate);
        }
    }
    function regenerateCandidateInputs(candidates, template) {
        for (const candidate of candidates) {
            candidate.generatedInput = generateCandidateInput(
                candidate,
                template
            );
        }
        return candidates;
    }
    function clearAnalysisResults() {
        state.candidates = [];
        state.candidateClusters = [];
        state.groupMatches = [];
        state.conflicts = [];
    }
    function buildCandidateResults(candidates) {
        return candidates.map((candidate) => {
            candidate.regexValue =
                candidate.regexValue ||
                normalizedCandidateRegexValue(candidate.name);
            candidate.generatedInput =
                candidate.generatedInput ||
                generateCandidateInput(candidate, state.candidateTemplate);
            return candidate;
        });
    }
    function findRulePageMatchRanges(text, rule) {
        const source = String(text ?? "");
        if (!source || !rule) {
            return [];
        }
        if (rule.inputType === "regexp") {
            const regex = compileRuleRegex(rule);
            if (!regex) {
                return [];
            }
            const matcher = new RegExp(
                regex.source,
                regex.flags.includes("g") ? regex.flags : `${regex.flags}g`
            );
            const matches = [];
            let match;
            while ((match = matcher.exec(source)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length
                });
                if (match[0].length === 0) {
                    matcher.lastIndex++;
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
                `(?<![A-Za-z0-9'’-])${escapeRegexLiteral(
                    pattern
                )}(?![A-Za-z0-9'’-])`,
                rule.caseSensitive ? "g" : "gi"
            );
            const matches = [];
            let match;
            while ((match = regex.exec(source)) !== null) {
                matches.push({
                    start: match.index,
                    end: match.index + match[0].length
                });
                if (match[0].length === 0) {
                    regex.lastIndex++;
                }
            }
            return matches;
        }
        const pattern = String(rule.input ?? "");
        if (!pattern) {
            return [];
        }
        const searchSource = rule.caseSensitive ? source : source.toLowerCase();
        const searchPattern = rule.caseSensitive
            ? pattern
            : pattern.toLowerCase();
        const matches = [];
        let position = 0;
        while (position < searchSource.length) {
            const index = searchSource.indexOf(searchPattern, position);
            if (index === -1) {
                break;
            }
            matches.push({
                start: index,
                end: index + searchPattern.length
            });
            position = index + Math.max(searchPattern.length, 1);
        }
        return matches;
    }
    function buildConflictClusters(pageRuleMatches) {
        const rangesByRule = new Map();
        for (const pageMatch of pageRuleMatches || []) {
            if (!pageMatch?.rule) {
                continue;
            }
            rangesByRule.set(pageMatch.rule, pageMatch.ranges || []);
        }
        const rules = [...rangesByRule.keys()];
        const connections = new Map();
        for (const rule of rules) {
            connections.set(rule, new Set());
        }
        const inputMatchesOutput = (inputRule, outputRule) => {
            const input = String(inputRule?.input ?? "");
            const output = String(outputRule?.output ?? "");
            if (!input || !output) {
                return false;
            }
            if (inputRule.inputType === "regexp") {
                const regex = compileRuleRegex(inputRule);
                if (!regex) {
                    return false;
                }
                regex.lastIndex = 0;
                return regex.test(output);
            }
            if (inputRule.inputType === "wholewords") {
                return wholeWordRuleMatches(
                    output,
                    input,
                    inputRule.caseSensitive
                );
            }
            if (inputRule.inputType === "text") {
                if (inputRule.caseSensitive) {
                    return output.includes(input);
                }
                return output.toLowerCase().includes(input.toLowerCase());
            }
            return false;
        };
        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            const ranges = rangesByRule.get(rule) || [];
            for (let j = i + 1; j < rules.length; j++) {
                const otherRule = rules[j];
                const otherRanges = rangesByRule.get(otherRule) || [];
                const overlaps = rangesOverlap(ranges, otherRanges);
                const chain =
                    inputMatchesOutput(otherRule, rule) ||
                    inputMatchesOutput(rule, otherRule);
                if (!overlaps && !chain) {
                    continue;
                }
                connections.get(rule).add(otherRule);
                connections.get(otherRule).add(rule);
            }
        }
        const clusters = [];
        const visited = new Set();
        for (const rule of rules) {
            if (visited.has(rule)) {
                continue;
            }
            const cluster = [];
            const queue = [rule];
            let queueIndex = 0;
            visited.add(rule);
            while (queueIndex < queue.length) {
                const current = queue[queueIndex++];
                cluster.push(current);
                for (const next of connections.get(current) || []) {
                    if (visited.has(next)) {
                        continue;
                    }
                    visited.add(next);
                    queue.push(next);
                }
            }
            if (cluster.length > 1) {
                clusters.push(cluster);
            }
        }
        return clusters;
    }
    function analyzePage() {
        clearAnalysisResults();
        const pageText = scanPageText();
        const siteRules = getCurrentSiteRules();
        const candidateScan = scanChapterCandidates(pageText);
        const candidates = candidateScan.candidates;
        const pageRuleMatches = scanFoxReplacePage(pageText, siteRules);
        const pageMatchedRules = pageRuleMatches.map(({ rule }) => rule);
        const candidateRuleMatches = new Map();
        for (const candidate of candidates) {
            candidateRuleMatches.set(
                candidate,
                findCandidateRuleMatches(candidate, pageMatchedRules)
            );
        }
        const remainingCandidates = candidates.filter((candidate) => {
            const matches = candidateRuleMatches.get(candidate);
            return !matches?.all?.length;
        });
        const candidatePool = processCandidateClusters(remainingCandidates);
        state.candidates = buildCandidateResults(candidatePool.candidates);
        state.candidateClusters = candidatePool.clusters;
        state.groupMatches = buildGroupMatches(
            pageRuleMatches,
            candidateRuleMatches,
            candidatePool.candidates
        );
        const conflictClusters = buildConflictClusters(pageRuleMatches);
        state.conflicts = buildConflictData(pageRuleMatches, conflictClusters);
        render();
    }
    function scanPageText() {
        const root = document.body;
        if (!root) {
            return "";
        }
        const blockTags =
            /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|DL|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H1|H2|H3|H4|H5|H6|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/;
        const parts = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        let previousNode = null;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent) {
                continue;
            }
            if (
                parent.closest(
                    "script, style, noscript, template, svg, #wnc-overlay"
                )
            ) {
                continue;
            }
            const rawText = String(node.nodeValue || "");
            if (!rawText || !rawText.trim()) {
                continue;
            }
            const text = rawText
                .replace(/\u00A0/g, " ")
                .replace(/[ \t\r\n]+/g, " ");
            if (!text.trim()) {
                continue;
            }
            if (previousNode) {
                const previousParent = previousNode.parentElement;
                if (previousParent) {
                    const commonAncestor = getCommonAncestor(
                        previousParent,
                        parent
                    );
                    const previousBlock = findNearestBlockElement(
                        previousParent,
                        commonAncestor,
                        blockTags
                    );
                    const currentBlock = findNearestBlockElement(
                        parent,
                        commonAncestor,
                        blockTags
                    );
                    if (
                        previousBlock &&
                        currentBlock &&
                        previousBlock !== currentBlock
                    ) {
                        parts.push(" ");
                    } else {
                        const previousPart = parts.length
                            ? String(parts[parts.length - 1])
                            : "";
                        if (
                            /[A-Za-z0-9'’-]$/.test(previousPart) &&
                            /^[A-Za-z0-9'’-]/.test(text)
                        ) {
                            parts.push(" ");
                        }
                    }
                }
            }
            parts.push(text);
            previousNode = node;
        }
        return parts.join("").replace(/\s+/g, " ").trim();
    }
    function scanFoxReplacePage(text, rules = getCurrentSiteRules()) {
        const matches = [];
        for (const rule of rules) {
            const ranges = findRulePageMatchRanges(text, rule);
            if (!ranges.length) {
                continue;
            }
            matches.push({
                rule,
                matchCount: ranges.length,
                ranges
            });
        }
        return matches;
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
            if (
                current.nodeType === Node.ELEMENT_NODE &&
                blockTags.test(current.tagName)
            ) {
                return current;
            }
            current = current.parentElement;
        }
        return null;
    }
    function runAnalysisSafely() {
        try {
            return analyzePage();
        } catch (error) {
            clearAnalysisResults();
            return {
                candidates: [],
                candidateClusters: [],
                groupMatches: [],
                conflicts: [],
                error
            };
        }
    }
    function getVisibleGroupMatches() {
        return state.groupMatches.filter((group) => {
            const rules = getGroupRulesWithMatches(group);
            if (!rules.length) {
                return false;
            }
            return true;
        });
    }
    function getGroupRulesWithMatches(group) {
        return (group?.rules || []).filter(
            (rule) => Number(rule.matchCount || 0) > 0
        );
    }
    function getVisibleConflicts() {
        return state.conflicts.slice();
    }
    function sortDisplayedGroups(groups) {
        return [...groups].sort(
            (a, b) => Number(a.index || 0) - Number(b.index || 0)
        );
    }
    function getRuleExpansionKey(group, rule) {
        return `${Number(group.index)}:${Number(rule.ruleIndex)}`;
    }
    function toggleGroupCollapsed(groupIndex) {
        const index = Number(groupIndex);
        if (state.collapsedGroups.has(index)) {
            state.collapsedGroups.delete(index);
        } else {
            state.collapsedGroups.add(index);
        }
        render();
    }
    function toggleRuleExpanded(groupIndex, ruleIndex) {
        const key = getRuleExpansionKey(
            {
                index: groupIndex
            },
            {
                ruleIndex
            }
        );
        if (state.expandedRules.has(key)) {
            state.expandedRules.delete(key);
        } else {
            state.expandedRules.add(key);
        }
        render();
    }
    const WNC_UI_ID = "wnc-overlay";
    const WNC_STYLE_ID = "wnc-dark-style";
    const WNC_TAB_ORDER = ["candidates", "groups", "conflicts"];
    function getWncStyles() {
        return `
#${WNC_UI_ID} {
    position: fixed;
    inset: 20px;
    z-index: 2147483647;
    background: #111;
    color: #eee;
    border: 1px solid #444;
    border-radius: 8px;
    box-shadow: 0 10px 40px rgba(0,0,0,.6);
    font-family: Arial, sans-serif;
    font-size: 14px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}
#${WNC_UI_ID} * {
    box-sizing: border-box;
}
#${WNC_UI_ID} button,
#${WNC_UI_ID} select {
    background: #222;
    color: #eee;
    border: 1px solid #555;
    border-radius: 4px;
    padding: 6px 9px;
}
#${WNC_UI_ID} button {
    cursor: pointer;
}
#${WNC_UI_ID} button:hover {
    background: #333;
}
    .wnc-sentence-start {
    margin-left: 28px;
    color: #aaa;
    padding: 3px 0;
}
.wnc-conflict-cluster-header {
    font-weight: bold;
    margin-bottom: 6px;
}
.wnc-conflict-cluster-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.wnc-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    border-bottom: 1px solid #444;
}
.wnc-title {
    font-weight: bold;
    margin-right: 10px;
}
.wnc-tabs {
    display: flex;
    gap: 4px;
}
.wnc-tab.active {
    background: #555;
}
.wnc-spacer {
    flex: 1;
}
.wnc-content {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: 12px;
}
.wnc-table {
    width: 100%;
    border-collapse: collapse;
}
.wnc-table th,
.wnc-table td {
    border-bottom: 1px solid #333;
    padding: 7px;
    text-align: left;
    vertical-align: top;
}
.wnc-table th {
    position: sticky;
    top: 0;
    background: #181818;
}
.wnc-input {
    width: 100%;
    min-width: 200px;
    background: #181818;
    color: #eee;
    border: 1px solid #444;
    padding: 5px;
}
.wnc-group {
    border: 1px solid #444;
    border-radius: 6px;
    margin-bottom: 10px;
    overflow: hidden;
}
.wnc-group-header {
    display: flex;
    gap: 10px;
    align-items: center;
    padding: 9px;
    background: #191919;
}
.wnc-group-rules {
    padding: 0 9px 9px;
}
.wnc-rule {
    border-top: 1px solid #333;
    padding: 8px 0;
}
.wnc-rule-header {
    display: flex;
    gap: 8px;
    align-items: center;
}
.wnc-rule-body {
    padding: 8px 0 0 28px;
}
.wnc-conflict {
    border: 1px solid #444;
    border-radius: 6px;
    margin-bottom: 8px;
    padding: 9px;
}
.wnc-conflict-cluster {
    margin-bottom: 14px;
}
.wnc-muted {
    color: #999;
}
.wnc-code {
    font-family: monospace;
    white-space: pre-wrap;
    word-break: break-word;
}
`;
    }
    function ensureWncStyles() {
        let style = document.getElementById(WNC_STYLE_ID);
        if (!style) {
            style = document.createElement("style");
            style.id = WNC_STYLE_ID;
            document.head?.appendChild(style);
        }
        style.textContent = getWncStyles();
    }
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }
    function getTabLabel(tab) {
        if (tab === "candidates") {
            return `Candidates (${state.candidates.length})`;
        }
        if (tab === "groups") {
            return `Groups (${state.groupMatches.length})`;
        }
        return `Conflicts (${state.conflicts.length})`;
    }
    function renderToolbar() {
        return `
<div class="wnc-toolbar">
    <div class="wnc-title">
        Webnovel Cleaner
    </div>
    <div class="wnc-tabs">
        ${WNC_TAB_ORDER.map(
            (tab) =>
                `<button class="wnc-tab ${
                    state.screen === tab ? "active" : ""
                }" data-wnc-tab="${tab}">${escapeHtml(getTabLabel(tab))}</button>`
        ).join("")}
    </div>
    <div class="wnc-spacer"></div>
    <select
        id="wnc-template"
        data-wnc-template
    >
        ${INPUT_TEMPLATES.map(
            (template) =>
                `<option value="${escapeHtml(template)}" ${
                    state.candidateTemplate === template ? "selected" : ""
                }>${escapeHtml(template)}</option>`
        ).join("")}
    </select>
    <button data-wnc-scan>
        Scan
    </button>
    <button data-wnc-close>
        Close
    </button>
</div>
`;
    }
    function getVisibleCandidateClusters() {
        return Array.isArray(state.candidateClusters)
            ? state.candidateClusters
            : [];
    }
    function renderCandidateRow(candidate) {
        const frequency = Number(candidate.frequency || 0);
        const sentenceStarts = Array.isArray(candidate.sentenceStarts)
            ? candidate.sentenceStarts
            : [];
        const sentenceStartHtml = sentenceStarts
            .filter(
                (start) =>
                    start &&
                    Number(start.frequency || 0) > 0 &&
                    String(start.text || "").trim()
            )
            .map(
                (start) => `
                <div class="wnc-sentence-start">
                    ${escapeHtml(start.text)}
                    <span class="wnc-muted">
                        (${escapeHtml(Number(start.frequency || 0))})
                    </span>
                </div>
            `
            )
            .join("");
        return `
        <tr>
            <td>
                ${escapeHtml(candidate.name)}
                ${sentenceStartHtml}
            </td>
            <td>${escapeHtml(frequency)}</td>
            <td>${escapeHtml(candidate.regexValue || "")}</td>
            <td>${escapeHtml(candidate.generatedInput || "")}</td>
            <td>
                <button
                    type="button"
                    data-wnc-copy="${escapeHtml(candidate.generatedInput || "")}"
                >
                    Copy
                </button>
            </td>
        </tr>
    `;
    }
    function renderCandidatesTab() {
        const clusters = getVisibleCandidateClusters();
        const rows = clusters
            .map(
                (cluster) => `
                <tbody class="wnc-candidate-cluster">
                    ${(cluster.members || [])
                        .map((candidate) => renderCandidateRow(candidate))
                        .join("")}
                </tbody>
            `
            )
            .join("");
        return `
        <div class="wnc-tab-content">
            <table class="wnc-table">
                <thead>
                    <tr>
                        <th>Name</th>
                        <th>Frequency</th>
                        <th>Regex Candidate</th>
                        <th>Generated Input</th>
                        <th>Copy</th>
                    </tr>
                </thead>
                ${rows}
            </table>
        </div>
    `;
    }
    function renderGroupsTab() {
        const groups = sortDisplayedGroups(getVisibleGroupMatches());
        return `
        <div class="wnc-groups">
            ${groups
                .map((group) => {
                    const groupIndex = group.index;
                    const collapsed = state.collapsedGroups.has(groupIndex);
                    const rules = getGroupRulesWithMatches(group);
                    return `
                        <section
                            class="wnc-group${collapsed ? " is-collapsed" : ""}"
                        >
                            <button
                                type="button"
                                class="wnc-group-header"
                                data-wnc-group-toggle="${escapeHtml(
                                    groupIndex
                                )}"
                            >
                                <span class="wnc-group-chevron">
                                    ${collapsed ? "▶" : "▼"}
                                </span>
                                <span class="wnc-group-name">
                                    ${escapeHtml(group.name)}
                                </span>
                            </button>
                            ${
                                collapsed
                                    ? ""
                                    : `
                                        <div class="wnc-group-rules">
                                            ${rules
                                                .map((rule) =>
                                                    renderGroupRule(group, rule)
                                                )
                                                .join("")}
                                        </div>
                                    `
                            }
                        </section>
                    `;
                })
                .join("")}
        </div>
    `;
    }
    function renderConflict(conflict) {
        const rule = conflict.rule || {};
        return `
        <div class="wnc-conflict">
            <div class="wnc-conflict-header">
                <span class="wnc-conflict-name">
                    ${escapeHtml(rule.groupName || "")}
                </span>
                <span class="wnc-muted">
                    (${escapeHtml(conflict.matchCount)})
                </span>
            </div>
            <div class="wnc-conflict-rule">
                ${escapeHtml(rule.input || "")}
            </div>
        </div>
    `;
    }
    function renderConflictsTab() {
        const conflicts = getVisibleConflicts();
        const clusters = new Map();
        for (const conflict of conflicts) {
            const clusterId = conflict.clusterId;
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
                        <section
                            class="wnc-conflict-cluster"
                            data-wnc-conflict-cluster="${escapeHtml(
                                String(clusterId)
                            )}"
                        >
                            <div class="wnc-conflict-cluster-header">
                                Conflict cluster
                            </div>
                            <div class="wnc-conflict-cluster-items">
                                ${items
                                    .map((conflict) => renderConflict(conflict))
                                    .join("")}
                            </div>
                        </section>
                    `
                )
                .join("")}
        </div>
    `;
    }
    function renderActiveTab() {
        if (state.screen === "groups") {
            return renderGroupsTab();
        }
        if (state.screen === "conflicts") {
            return renderConflictsTab();
        }
        return renderCandidatesTab();
    }
    function renderWncWindow() {
        return `
<div id="${WNC_UI_ID}">
    ${renderToolbar()}
    <div class="wnc-content">
        ${renderActiveTab()}
    </div>
</div>
`;
    }
    function renderGroupRule(group, rule) {
        const sourceRule = rule?.rule || rule;
        const candidates = Array.isArray(rule?.candidates)
            ? rule.candidates
            : [];
        const expansionKey = getRuleExpansionKey(group, sourceRule);
        const expanded = state.expandedRules.has(expansionKey);
        const candidateHtml = candidates
            .map(
                (candidate) => `
                <div class="wnc-muted">
                    ${escapeHtml(candidate?.name || "")}
                    <span>
                        (${escapeHtml(Number(candidate?.frequency || 0))})
                    </span>
                </div>
            `
            )
            .join("");
        return `
        <div class="wnc-rule">
            <div class="wnc-rule-header">
                <button
                    type="button"
                    data-wnc-rule-toggle="${escapeHtml(expansionKey)}"
                    data-wnc-group-index="${escapeHtml(group.index)}"
                    data-wnc-rule-index="${escapeHtml(sourceRule.ruleIndex)}"
                >
                    ${expanded ? "▼" : "▶"}
                </button>
                <span class="wnc-code">
                    ${escapeHtml(sourceRule.input || "")}
                </span>
                <span class="wnc-muted">
                    (${escapeHtml(Number(rule?.matchCount || 0))})
                </span>
            </div>
            ${
                expanded
                    ? `
                        <div class="wnc-rule-body">
                            <div class="wnc-code">
                                ${escapeHtml(sourceRule.output || "")}
                            </div>
                            ${
                                candidateHtml ||
                                `<div class="wnc-muted">No candidates</div>`
                            }
                        </div>
                    `
                    : ""
            }
        </div>
    `;
    }
    function render() {
        ensureWncStyles();
        let overlay = document.getElementById(WNC_UI_ID);
        if (!overlay) {
            overlay = document.createElement("div");
            overlay.id = WNC_UI_ID;
            document.body?.appendChild(overlay);
        }
        if (!overlay) {
            return;
        }
        overlay.innerHTML = renderWncWindow();
        bindWncEvents(overlay);
    }
    function openWnc() {
        state.screen = "candidates";
        runAnalysisSafely();
    }
    function closeWnc() {
        document.getElementById(WNC_UI_ID)?.remove();
    }
    function bindWncEvents(overlay) {
        if (!overlay) {
            return;
        }
        overlay.querySelectorAll("[data-wnc-tab]").forEach((button) => {
            button.addEventListener("click", () => {
                state.screen = button.dataset.wncTab;
                render();
            });
        });
        overlay.querySelectorAll("[data-wnc-template]").forEach((select) => {
            select.addEventListener("change", () => {
                state.candidateTemplate = select.value;
                regenerateCandidateInputs(
                    state.candidates,
                    state.candidateTemplate
                );
                render();
            });
        });
        overlay.querySelectorAll("[data-wnc-scan]").forEach((button) => {
            button.addEventListener("click", () => {
                analyzePage();
            });
        });
        overlay.querySelectorAll("[data-wnc-close]").forEach((button) => {
            button.addEventListener("click", closeWnc);
        });
        overlay
            .querySelectorAll("[data-wnc-group-toggle]")
            .forEach((element) => {
                element.addEventListener("click", () => {
                    toggleGroupCollapsed(element.dataset.wncGroupToggle);
                });
            });
        overlay
            .querySelectorAll("[data-wnc-rule-toggle]")
            .forEach((element) => {
                element.addEventListener("click", () => {
                    toggleRuleExpanded(
                        element.dataset.wncGroupIndex,
                        element.dataset.wncRuleIndex
                    );
                });
            });
        overlay.querySelectorAll("[data-wnc-copy]").forEach((button) => {
            button.addEventListener("click", () => {
                copyText(button.dataset.wncCopy);
            });
        });
    }
    async function copyText(text) {
        const value = String(text ?? "");
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(value);
                return true;
            }
        } catch {
            // Fall through to the legacy copy method.
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
            return copied;
        } catch {
            return false;
        }
    }
    function registerWncMenuCommands() {
        GM_registerMenuCommand("Open Webnovel Cleaner", openWnc);
        GM_registerMenuCommand("Import FoxReplace JSON", openImportPicker);
    }
    function ensureDatabaseShape() {
        if (!adaptedDatabase || !Array.isArray(adaptedDatabase.groups)) {
            adaptedDatabase = {
                groups: []
            };
        }
    }
    function initializeWnc() {
        const database = loadActiveDatabase();
        adaptedDatabase = adaptFoxReplaceDatabase(database);
        ensureDatabaseShape();
        registerWncMenuCommands();
    }
    function startWnc() {
        initializeWnc();
    }
    startWnc();
})();
