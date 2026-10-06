// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.2.2
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
    const UNCLUSTERED_FREQUENCY_RATIO = 0.05;

    const CANDIDATE_REGEX =
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

    function normalizeInputType(value) {
        const type = String(value ?? "")
            .trim()
            .toLowerCase();

        if (
            type === "wholewords" ||
            type === "whole words" ||
            type === "wholeword"
        ) {
            return "wholewords";
        }

        if (
            type === "regexp" ||
            type === "regex" ||
            type === "regular expression"
        ) {
            return "regexp";
        }

        return "text";
    }

    function normalizeOutputType(value) {
        const type = String(value ?? "")
            .trim()
            .toLowerCase();

        return type || "text";
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
            inputType: normalizeInputType(rawRule?.inputType),
            outputType: normalizeOutputType(rawRule?.outputType),
            caseSensitive: normalizeBoolean(rawRule?.caseSensitive, false),
            enabled: normalizeBoolean(rawRule?.enabled, true),
            html: normalizeBoolean(rawRule?.html, false)
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
            html: normalizeBoolean(group.html, false)
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

    function escapeRegex(value) {
        return String(value ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function wildcardToRegex(value) {
        const escaped = escapeRegex(value);

        return new RegExp("^" + escaped.replace(/\\\*/g, ".*") + "$");
    }

    function urlPatternMatches(pattern, url) {
        if (!pattern) {
            return false;
        }

        try {
            return wildcardToRegex(pattern).test(url);
        } catch {
            return false;
        }
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
    function scanCandidateOccurrences(text) {
        const occurrences = [];

        if (!text) {
            return occurrences;
        }

        CANDIDATE_REGEX.lastIndex = 0;

        let match;

        while ((match = CANDIDATE_REGEX.exec(text)) !== null) {
            const value = String(match[1] || "").trim();

            if (!value) {
                continue;
            }

            const startIndex = match.index;

            let isSentenceStart = false;

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
        const starterTokens = splitCandidateTokens(starter.normalized);

        if (!starterTokens.length) {
            return null;
        }

        const matches = [];

        for (const candidate of candidates) {
            const candidateTokens = getCandidateTokens(candidate.name);

            if (!candidateTokens.length) {
                continue;
            }

            if (candidateTokens.length > starterTokens.length) {
                continue;
            }

            let matchesCandidate = true;

            for (let i = 0; i < candidateTokens.length; i++) {
                if (candidateTokens[i] !== starterTokens[i]) {
                    matchesCandidate = false;
                    break;
                }
            }

            if (matchesCandidate) {
                matches.push(candidate);
            }
        }

        if (!matches.length) {
            return null;
        }

        matches.sort((a, b) => {
            const tokenDifference =
                getCandidateTokens(b.name).length -
                getCandidateTokens(a.name).length;

            if (tokenDifference !== 0) {
                return tokenDifference;
            }

            return Number(b.frequency || 0) - Number(a.frequency || 0);
        });

        return matches[0];
    }
    function applySentenceStartMatches(candidates, sentenceStarts) {
        const starters = Array.isArray(sentenceStarts)
            ? sentenceStarts.slice()
            : [];

        const orderedCandidates = candidates
            .map((candidate, index) => ({
                candidate,
                index,
                tokens: getCandidateTokens(candidate.name)
            }))
            .sort((a, b) => {
                const tokenDifference = b.tokens.length - a.tokens.length;

                if (tokenDifference !== 0) {
                    return tokenDifference;
                }

                const frequencyDifference =
                    Number(b.candidate.frequency || 0) -
                    Number(a.candidate.frequency || 0);

                if (frequencyDifference !== 0) {
                    return frequencyDifference;
                }

                return a.index - b.index;
            });

        for (const starter of starters) {
            const match = findSentenceStartMatch(
                starter,
                orderedCandidates.map((entry) => entry.candidate)
            );

            if (!match) {
                continue;
            }

            const frequency = Number(starter.frequency || 0);

            if (frequency <= 0) {
                continue;
            }

            match.frequency = Number(match.frequency || 0) + frequency;

            if (!Array.isArray(match.sentenceStarts)) {
                match.sentenceStarts = [];
            }

            match.sentenceStarts.push({
                text: starter.text,
                normalized: starter.normalized,
                frequency
            });

            starter.frequency = 0;
        }

        return candidates;
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
            .replace(/’/g, "'")
            .toLowerCase();

        if (!value) {
            return "";
        }

        if (value.endsWith("'s")) {
            return value.slice(0, -2);
        }

        if (value.endsWith("s'")) {
            return value.slice(0, -1);
        }

        if (value.length <= 3) {
            return value;
        }

        if (value.endsWith("ies") && value.length > 4) {
            return value.slice(0, -3) + "y";
        }

        if (value.endsWith("sses")) {
            return value.slice(0, -2);
        }

        if (/(?:ches|shes|xes|zes)$/.test(value)) {
            return value.slice(0, -2);
        }

        if (value.endsWith("ves") && value.length > 4) {
            if (value === "leaves") {
                return "leaf";
            }

            if (value === "wolves") {
                return "wolf";
            }

            return value;
        }

        if (value.endsWith("es") && value.length > 4) {
            const stem = value.slice(0, -2);

            if (/(?:s|x|z|ch|sh)$/.test(stem)) {
                return stem;
            }
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

        for (const occurrence of occurrences) {
            const name = String(occurrence?.text || "").trim();
            const normalized = normalizeCandidate(name);

            if (!normalized) {
                continue;
            }

            let candidate = candidateMap.get(normalized);

            if (!candidate) {
                candidate = {
                    name,
                    normalized,
                    frequency: 0,
                    variants: new Map(),
                    sentenceStarts: [],
                    originalIndex: occurrence.index
                };

                candidateMap.set(normalized, candidate);
            }

            candidate.frequency += 1;

            const variant = candidate.variants.get(name);

            if (variant) {
                candidate.variants.set(name, variant + 1);
            } else {
                candidate.variants.set(name, 1);
            }

            if (occurrence.isSentenceStart) {
                candidate.sentenceStarts.push({
                    text: name,
                    normalized,
                    frequency: 1
                });
            }

            if (occurrence.index < candidate.originalIndex) {
                candidate.originalIndex = occurrence.index;
            }
        }

        const candidates = Array.from(candidateMap.values());

        for (const candidate of candidates) {
            candidate.name = chooseCandidateDisplayName(candidate);
        }

        return {
            candidates,
            sentenceStarts: []
        };
    }
    function chooseCandidateDisplayName(candidate) {
        if (!candidate?.variants?.size) {
            return candidate?.name || "";
        }

        let bestName = candidate.name || "";
        let bestFrequency = -1;

        for (const [name, frequency] of candidate.variants) {
            if (frequency > bestFrequency) {
                bestName = name;
                bestFrequency = frequency;
                continue;
            }

            if (frequency === bestFrequency && name.length < bestName.length) {
                bestName = name;
            }
        }

        return bestName;
    }
    function finalizeCandidateNames(candidates) {
        return candidates.map((candidate, index) => ({
            ...candidate,
            name: chooseCandidateDisplayName(candidate),
            originalIndex: candidate.originalIndex ?? index
        }));
    }
    function scanChapterCandidates(text) {
        const occurrences = scanCandidateOccurrences(text);
        const merged = mergeCandidateOccurrences(occurrences);

        merged.candidates = finalizeCandidateNames(merged.candidates);

        return {
            candidates: merged.candidates,
            sentenceStarts: merged.sentenceStarts
        };
    }
    function candidateTokens(candidate) {
        return splitCandidateTokens(
            candidate?.normalized || candidate?.name || ""
        ).map(normalizeCandidateToken);
    }
    function getCandidateTokens(name) {
        return splitCandidateTokens(normalizeCandidate(name));
    }
    function buildCandidateClusters(candidates) {
        const ordered = [...candidates].sort((a, b) => {
            const frequencyDifference =
                Number(b.frequency || 0) - Number(a.frequency || 0);

            if (frequencyDifference !== 0) {
                return frequencyDifference;
            }

            return Number(a.originalIndex || 0) - Number(b.originalIndex || 0);
        });

        const unassigned = new Set(ordered);
        const clusters = [];

        while (unassigned.size) {
            const root = ordered.find((candidate) => unassigned.has(candidate));

            if (!root) {
                break;
            }

            const cluster = [root];
            const depths = new Map([[root, 0]]);
            const queue = [root];

            unassigned.delete(root);

            while (queue.length) {
                const current = queue.shift();
                const depth = depths.get(current);

                if (depth >= 2) {
                    continue;
                }

                for (const candidate of ordered) {
                    if (!unassigned.has(candidate)) {
                        continue;
                    }

                    if (!candidatesShareToken(current, candidate)) {
                        continue;
                    }

                    const nextDepth = depth + 1;

                    depths.set(candidate, nextDepth);
                    queue.push(candidate);
                    cluster.push(candidate);
                    unassigned.delete(candidate);
                }
            }

            const members = cluster.slice(1).sort((a, b) => {
                const frequencyDifference =
                    Number(b.frequency || 0) - Number(a.frequency || 0);

                if (frequencyDifference !== 0) {
                    return frequencyDifference;
                }

                return (
                    Number(a.originalIndex || 0) - Number(b.originalIndex || 0)
                );
            });

            clusters.push([root, ...members]);
        }

        clusters.sort((a, b) => {
            const frequencyDifference =
                Number(b[0]?.frequency || 0) - Number(a[0]?.frequency || 0);

            if (frequencyDifference !== 0) {
                return frequencyDifference;
            }

            return (
                Number(a[0]?.originalIndex || 0) -
                Number(b[0]?.originalIndex || 0)
            );
        });

        return clusters;
    }
    function candidatesShareToken(candidateA, candidateB) {
        const tokensA = new Set(candidateTokens(candidateA));

        for (const token of candidateTokens(candidateB)) {
            if (tokensA.has(token)) {
                return true;
            }
        }

        return false;
    }
    function processCandidateClusters(candidates) {
        const clusters = buildCandidateClusters(candidates);

        const maxFrequency = candidates.reduce(
            (max, candidate) => Math.max(max, Number(candidate.frequency || 0)),
            0
        );

        const threshold = maxFrequency * UNCLUSTERED_FREQUENCY_RATIO;

        const retainedClusters = clusters.filter((cluster) => {
            if (cluster.length > 1) {
                return true;
            }

            const frequency = Number(cluster[0]?.frequency || 0);

            return frequency > 0 && frequency >= threshold;
        });

        return {
            candidates: retainedClusters.flat(),
            clusters: retainedClusters
        };
    }
    function compileRuleRegex(rule) {
        if (!rule || rule.inputType !== "regexp") {
            return null;
        }

        const rawFlags = String(rule.raw?.flags || rule.raw?.regexpFlags || "");

        let flags = rule.caseSensitive
            ? rawFlags.replace(/i/g, "")
            : rawFlags.includes("i")
              ? rawFlags
              : rawFlags + "i";

        flags = flags.replace(/[gy]/g, "");

        try {
            return new RegExp(rule.input, flags);
        } catch {
            return null;
        }
    }
    function compareRuleText(candidateText, ruleText, caseSensitive) {
        const left = String(candidateText ?? "");

        const right = String(ruleText ?? "");

        if (caseSensitive) {
            return left === right;
        }

        return left.toLowerCase() === right.toLowerCase();
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

    function textRuleContains(candidateText, ruleText, caseSensitive) {
        const value = String(candidateText ?? "");

        const input = String(ruleText ?? "");

        if (caseSensitive) {
            return value.includes(input);
        }

        return value.toLowerCase().includes(input.toLowerCase());
    }

    function ruleMatchesEntireCandidate(candidate, rule) {
        const forms = getCandidateMatchForms(candidate);

        if (!forms.length) {
            return false;
        }

        if (rule.inputType === "regexp") {
            return forms.some((form) => regexMatchesEntireString(form, rule));
        }

        if (rule.inputType === "wholewords") {
            const input = String(rule.input ?? "").trim();

            return forms.some((form) =>
                compareRuleText(String(form).trim(), input, rule.caseSensitive)
            );
        }

        return forms.some((form) =>
            compareRuleText(form, rule.input, rule.caseSensitive)
        );
    }

    function regexMatchesEntireString(text, rule) {
        const regex = compileRuleRegex(rule);

        if (!regex) {
            return false;
        }

        const value = String(text ?? "");

        regex.lastIndex = 0;

        const match = regex.exec(value);

        if (!match) {
            return false;
        }

        return match.index === 0 && match[0].length === value.length;
    }

    function ruleMatchesCandidate(candidate, rule) {
        const forms = getCandidateMatchForms(candidate);

        if (!forms.length) {
            return false;
        }

        if (rule.inputType === "regexp") {
            const regex = compileRuleRegex(rule);

            if (!regex) {
                return false;
            }

            return forms.some((form) => {
                regex.lastIndex = 0;

                return regex.test(form);
            });
        }

        if (rule.inputType === "wholewords") {
            return forms.some((form) =>
                wholeWordRuleMatches(form, rule.input, rule.caseSensitive)
            );
        }

        return forms.some((form) =>
            textRuleContains(form, rule.input, rule.caseSensitive)
        );
    }

    function getCandidateMatchForms(candidate) {
        const forms = new Set();

        if (candidate?.variants) {
            for (const value of candidate.variants.keys()) {
                if (value) {
                    forms.add(value);
                }
            }
        }

        if (candidate?.name) {
            forms.add(String(candidate.name));
        }

        return Array.from(forms);
    }
    function findCandidateRuleMatches(candidate, rules) {
        const exact = [];
        const partial = [];

        for (const rule of rules) {
            if (ruleMatchesEntireCandidate(candidate, rule)) {
                exact.push(rule);
            } else if (ruleMatchesCandidate(candidate, rule)) {
                partial.push(rule);
            }
        }

        return {
            exact,
            partial,
            all: [...exact, ...partial]
        };
    }
    function buildGroupMatches(pageRuleMatches, candidateRuleMatches) {
        const pageMatchesByRule = new Map();

        for (const { rule, matchCount } of pageRuleMatches) {
            pageMatchesByRule.set(getRuleKey(rule), {
                rule,
                matchCount
            });
        }

        const candidatesByRule = new Map();

        for (const [candidate, matches] of candidateRuleMatches) {
            for (const rule of matches?.all || []) {
                const key = getRuleKey(rule);
                const candidates = candidatesByRule.get(key) || [];

                candidates.push(candidate);
                candidatesByRule.set(key, candidates);
            }
        }

        return getCurrentSiteGroups()
            .map((group) => {
                const rules = (group.rules || [])
                    .map((rule) => {
                        const pageMatch = pageMatchesByRule.get(
                            getRuleKey(rule)
                        );

                        if (!pageMatch) {
                            return null;
                        }

                        const candidates =
                            candidatesByRule.get(getRuleKey(rule)) || [];

                        if (!candidates.length) {
                            return null;
                        }

                        return {
                            ...rule,
                            groupIndex: rule.groupIndex ?? group.index,
                            groupName: rule.groupName || "",
                            ruleIndex: rule.ruleIndex,
                            matchCount: Number(pageMatch.matchCount || 0),
                            candidates: [...candidates].sort(
                                (a, b) =>
                                    Number(b.frequency || 0) -
                                    Number(a.frequency || 0)
                            )
                        };
                    })
                    .filter(Boolean);

                if (!rules.length) {
                    return null;
                }

                return {
                    ...group,
                    index: group.index,
                    name: group.name,
                    rules
                };
            })
            .filter(Boolean);
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

    function generateCandidateInput(candidate, template) {
        switch (template) {
            case "Korean":
                return generateKoreanInput(candidate);

            case "Korean 2":
                return generateKorean2Input(candidate);

            case "Japanese":
                return generateJapaneseInput(candidate);

            case "Other":
            default:
                return generateOtherInput(candidate);
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
                `(?<![A-Za-z0-9'’-])${escapeRegex(pattern)}(?![A-Za-z0-9'’-])`,
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
    function buildConflictClusters(pageText, pageRuleMatches) {
        const ruleMatches = new Map();

        for (const { rule } of pageRuleMatches) {
            const matches = findRulePageMatchRanges(pageText, rule);

            if (matches.length) {
                ruleMatches.set(rule, matches);
            }
        }

        const ruleConnections = new Map();

        for (const rule of ruleMatches.keys()) {
            ruleConnections.set(rule, new Set());
        }

        const rules = [...ruleMatches.keys()];

        for (let i = 0; i < rules.length; i++) {
            const rule = rules[i];
            const matches = ruleMatches.get(rule);

            for (let j = i + 1; j < rules.length; j++) {
                const other = rules[j];
                const otherMatches = ruleMatches.get(other);

                if (
                    matches.some((match) =>
                        otherMatches.some(
                            (otherMatch) =>
                                match.start < otherMatch.end &&
                                otherMatch.start < match.end
                        )
                    )
                ) {
                    ruleConnections.get(rule).add(other);
                    ruleConnections.get(other).add(rule);
                }
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

            visited.add(rule);

            while (queue.length) {
                const current = queue.shift();

                cluster.push(current);

                for (const next of ruleConnections.get(current) || []) {
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

        // 1. Scan the page for candidates.
        const candidateScan = scanChapterCandidates(pageText);
        const candidates = candidateScan.candidates;

        // 2. Scan every FoxReplace rule against the page.
        const pageRuleMatches = scanFoxReplacePage(pageText, siteRules);

        const pageMatchedRules = pageRuleMatches.map(({ rule }) => rule);

        // 3. Match candidates against page-matched FoxReplace rules.
        const candidateRuleMatches = new Map();

        for (const candidate of candidates) {
            candidateRuleMatches.set(
                candidate,
                findCandidateRuleMatches(candidate, pageMatchedRules)
            );
        }

        // 4. Remove candidates already covered by FoxReplace.
        const remainingCandidates = candidates.filter((candidate) => {
            const matches = candidateRuleMatches.get(candidate);

            return !matches?.all?.length;
        });

        // 5. Cluster and frequency-filter the remaining candidates.
        const candidatePool = processCandidateClusters(remainingCandidates);

        state.candidates = buildCandidateResults(candidatePool.candidates);
        state.candidateClusters = candidatePool.clusters;

        // 6. Build Groups only from rules that actually matched the page.
        state.groupMatches = buildGroupMatches(
            pageRuleMatches,
            candidateRuleMatches
        );

        // 7. Build conflicts directly from page-matched rules/page text.
        const conflictClusters = buildConflictClusters(
            pageText,
            pageRuleMatches
        );

        state.conflicts = buildConflictData(pageRuleMatches, conflictClusters);

        render();
    }
    function scanPageText() {
        const root = document.body;

        if (!root) {
            return "";
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

        const parts = [];
        let node;

        const blockTags =
            /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|DL|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H1|H2|H3|H4|H5|H6|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/;

        let previousTextNode = null;

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

            if (!rawText) {
                continue;
            }

            const text = rawText
                .replace(/\u00A0/g, " ")
                .replace(/[ \t\r\n]+/g, " ");

            if (!text.trim()) {
                continue;
            }

            if (previousTextNode) {
                const previousParent = previousTextNode.parentElement;

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
                    }
                }
            }

            parts.push(text);

            previousTextNode = node;
        }

        return parts.join("").replace(/\s+/g, " ").trim();
    }
    function countTextRuleMatches(text, rule) {
        const source = String(text ?? "");
        const pattern = String(rule?.input ?? "");

        if (!source || !pattern) {
            return 0;
        }

        if (rule.caseSensitive) {
            let count = 0;
            let position = 0;

            while (position < source.length) {
                const index = source.indexOf(pattern, position);

                if (index === -1) {
                    break;
                }

                count++;
                position = index + Math.max(pattern.length, 1);
            }

            return count;
        }

        const sourceLower = source.toLowerCase();
        const patternLower = pattern.toLowerCase();

        let count = 0;
        let position = 0;

        while (position < sourceLower.length) {
            const index = sourceLower.indexOf(patternLower, position);

            if (index === -1) {
                break;
            }

            count++;
            position = index + Math.max(patternLower.length, 1);
        }

        return count;
    }
    function countWholeWordRuleMatches(text, rule) {
        const source = String(text ?? "");
        const pattern = String(rule?.input ?? "");

        if (!source || !pattern) {
            return 0;
        }

        const regex = new RegExp(
            `(?<![A-Za-z0-9'’-])${escapeRegex(pattern)}(?![A-Za-z0-9'’-])`,
            rule.caseSensitive ? "g" : "gi"
        );

        let count = 0;
        let match;

        while ((match = regex.exec(source)) !== null) {
            count++;

            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }

        return count;
    }
    function countRegexRuleMatches(text, rule) {
        const source = String(text ?? "");

        if (!source || !rule?.input) {
            return 0;
        }

        const regex = compileRuleRegex(rule);

        if (!regex) {
            return 0;
        }

        const matcher = new RegExp(
            regex.source,
            regex.flags.includes("g") ? regex.flags : `${regex.flags}g`
        );

        let count = 0;
        let match;

        while ((match = matcher.exec(source)) !== null) {
            count++;

            if (match[0].length === 0) {
                matcher.lastIndex++;
            }
        }

        return count;
    }

    function countRulePageMatches(text, rule) {
        switch (rule?.inputType) {
            case "regexp":
                return countRegexRuleMatches(text, rule);

            case "wholewords":
                return countWholeWordRuleMatches(text, rule);

            case "text":
            default:
                return countTextRuleMatches(text, rule);
        }
    }

    function scanFoxReplacePage(text, rules = getCurrentSiteRules()) {
        const matches = [];

        for (const rule of rules) {
            const matchCount = countRulePageMatches(text, rule);

            if (matchCount > 0) {
                matches.push({
                    rule,
                    matchCount
                });
            }
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

        if (
            current &&
            current !== boundary &&
            current.nodeType === Node.ELEMENT_NODE &&
            blockTags.test(current.tagName)
        ) {
            return current;
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
    function getRuleKey(rule) {
        if (!rule) {
            return "";
        }

        return [
            rule.groupIndex ?? "",
            rule.ruleIndex ?? "",
            rule.input ?? "",
            rule.output ?? ""
        ].join("\u0000");
    }
    function getRuleExpansionKey(group, rule) {
        return `${Number(group.index)}:${Number(rule.ruleIndex)}`;
    }

    function isRuleExpanded(group, rule) {
        return state.expandedRules.has(getRuleExpansionKey(group, rule));
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

        return `
        <tr>
            <td>
                ${escapeHtml(candidate.name)}
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
                    ${cluster
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
    function renderGroupRule(group, rule) {
        const candidates = Array.isArray(rule.candidates)
            ? rule.candidates
            : [];

        const candidateHtml = candidates.length
            ? `
            <div class="wnc-group-candidates">
                ${candidates
                    .map(
                        (candidate) => `
                            <div class="wnc-group-candidate">
                                ${escapeHtml(candidate.name)}
                                <span class="wnc-muted">
                                    (${escapeHtml(candidate.frequency)})
                                </span>
                            </div>
                        `
                    )
                    .join("")}
            </div>
        `
            : "";

        return `
        <div class="wnc-group-rule">
            <div class="wnc-group-rule-header">
                <span class="wnc-group-rule-name">
                    ${escapeHtml(rule.input || "")}
                </span>
                <span class="wnc-muted">
                    (${escapeHtml(rule.matchCount)})
                </span>
            </div>
            ${candidateHtml}
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
        runAnalysisSafely();

        state.screen = "candidates";

        render();
    }

    function closeWnc() {
        document.getElementById(WNC_UI_ID)?.remove();
    }
    function bindWncEvents() {
        document.querySelectorAll("[data-wnc-tab]").forEach((button) => {
            button.addEventListener("click", () => {
                state.screen = button.dataset.wncTab;

                render();
            });
        });

        document.querySelectorAll("[data-wnc-template]").forEach((select) => {
            select.addEventListener("change", () => {
                state.candidateTemplate = select.value;

                regenerateCandidateInputs(
                    state.candidates,
                    state.candidateTemplate
                );

                render();
            });
        });

        document.querySelectorAll("[data-wnc-scan]").forEach((button) => {
            button.addEventListener("click", () => {
                analyzePage();
            });
        });

        document.querySelectorAll("[data-wnc-close]").forEach((button) => {
            button.addEventListener("click", closeWnc);
        });

        document
            .querySelectorAll("[data-wnc-group-toggle]")
            .forEach((element) => {
                element.addEventListener("click", () => {
                    toggleGroupCollapsed(element.dataset.wncGroupToggle);
                });
            });

        document
            .querySelectorAll("[data-wnc-rule-toggle]")
            .forEach((element) => {
                element.addEventListener("click", () => {
                    toggleRuleExpanded(
                        element.dataset.groupIndex,
                        element.dataset.ruleIndex
                    );
                });
            });

        document.querySelectorAll("[data-wnc-copy]").forEach((button) => {
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
