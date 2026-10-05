// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.1.33
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
    const LAST_IMPORTED_DB_KEY = "WNC_LAST_IMPORTED_DATABASE_V2";
    const UNCLUSTERED_FREQUENCY_RATIO = 0.05;

    const CANDIDATE_REGEX =
        /(?<![A-Z0-9'’-])((?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*)(?:\s+(?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*))*)(?![A-Za-z0-9'’-])/g;

    const INPUT_TEMPLATES = ["Other", "Korean", "Korean 2", "Japanese"];

    const state = {
        collapsedGroups: new Set(),
        screen: "candidates",
        groupIndex: null,
        candidates: [],
        candidateClusters: [],
        groupMatches: [],
        conflicts: [],
        conflictClusters: [],
        candidateTemplate: "Other",
        showOtherGroups: false,
        expandedRules: new Set()
    };

    let rawFoxReplaceDatabase = null;
    let adaptedDatabase = {
        groups: []
    };
    let chapterText = "";

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

        if (type === "wholewords") {
            return "wholewords";
        }

        if (type === "regexp" || type === "regex") {
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

    function firstDefined(object, keys, fallback) {
        for (const key of keys) {
            if (object && object[key] !== undefined && object[key] !== null) {
                return object[key];
            }
        }

        return fallback;
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

    function normalizeRule(rawRule, ruleIndex, groupIndex) {
        const rule = rawRule && typeof rawRule === "object" ? rawRule : {};

        const input = String(
            firstDefined(rule, ["input", "pattern", "find", "search"], "")
        );

        const output = String(
            firstDefined(rule, ["output", "replace", "replacement"], "")
        );

        return {
            raw: rule,
            groupIndex,
            ruleIndex,
            input,
            output,
            inputType: normalizeInputType(
                firstDefined(rule, ["inputType", "type", "mode"], "text")
            ),
            outputType: normalizeOutputType(
                firstDefined(rule, ["outputType", "replaceType"], "text")
            ),
            caseSensitive: normalizeBoolean(
                firstDefined(rule, ["caseSensitive", "matchCase"], false),
                false
            ),
            enabled: normalizeBoolean(
                firstDefined(rule, ["enabled", "active"], true),
                true
            ),
            html: normalizeBoolean(
                firstDefined(rule, ["html", "isHtml"], false),
                false
            )
        };
    }

    function normalizeUrls(value) {
        if (Array.isArray(value)) {
            return value
                .map((item) => String(item ?? "").trim())
                .filter(Boolean);
        }

        if (value === undefined || value === null) {
            return [];
        }

        return [String(value).trim()].filter(Boolean);
    }

    function normalizeGroup(rawGroup, groupIndex) {
        const group = rawGroup && typeof rawGroup === "object" ? rawGroup : {};

        const rawRules = firstDefined(
            group,
            ["rules", "replacements", "items"],
            []
        );

        const rules = Array.isArray(rawRules)
            ? rawRules.map((rule, ruleIndex) =>
                  normalizeRule(rule, ruleIndex, groupIndex)
              )
            : [];

        return {
            raw: group,
            index: groupIndex,
            name: String(
                firstDefined(
                    group,
                    ["name", "groupName", "title"],
                    `Group ${groupIndex + 1}`
                )
            ),
            urls: normalizeUrls(
                firstDefined(group, ["urls", "url", "sites", "site"], [])
            ),
            rules,
            enabled: normalizeBoolean(
                firstDefined(group, ["enabled", "active"], true),
                true
            ),
            mode: firstDefined(group, ["mode", "matchMode"], ""),
            pageLoad: normalizeBoolean(
                firstDefined(group, ["pageLoad", "onPageLoad"], false),
                false
            ),
            auto: normalizeBoolean(
                firstDefined(group, ["auto", "automatic"], false),
                false
            ),
            html: normalizeBoolean(
                firstDefined(group, ["html", "isHtml"], false),
                false
            )
        };
    }

    function findGroupArray(database) {
        if (!database || typeof database !== "object") {
            return [];
        }

        if (Array.isArray(database.groups)) {
            return database.groups;
        }

        if (Array.isArray(database.group)) {
            return database.group;
        }

        for (const value of Object.values(database)) {
            if (Array.isArray(value) && value.length) {
                const first = value[0];

                if (
                    first &&
                    typeof first === "object" &&
                    ("rules" in first ||
                        "replacements" in first ||
                        "name" in first ||
                        "groupName" in first)
                ) {
                    return value;
                }
            }

            if (value && typeof value === "object") {
                const nested = findGroupArray(value);

                if (nested.length) {
                    return nested;
                }
            }
        }

        return [];
    }

    function adaptFoxReplaceDatabase(rawDatabase) {
        const groups = findGroupArray(rawDatabase);

        return {
            groups: groups.map((group, groupIndex) =>
                normalizeGroup(group, groupIndex)
            )
        };
    }

    function countAdaptedRules(database) {
        return (database?.groups || []).reduce(
            (total, group) => total + (group.rules || []).length,
            0
        );
    }

    function describeDatabase(database) {
        const groups = database?.groups || [];

        return {
            groups: groups.length,
            rules: countAdaptedRules(database)
        };
    }

    function loadNormalDatabase() {
        const value = readStorage(DB_KEY, null);

        if (!value || typeof value !== "object") {
            return null;
        }

        return value;
    }

    function loadLastImportedDatabase() {
        const value = readStorage(LAST_IMPORTED_DB_KEY, null);

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

        return (
            loadLastImportedDatabase() || {
                groups: []
            }
        );
    }

    function parseImportedText(text) {
        try {
            return JSON.parse(text);
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

                rawFoxReplaceDatabase = database;

                adaptedDatabase = adaptFoxReplaceDatabase(database);

                writeStorage(LAST_IMPORTED_DB_KEY, database);

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

    function resetCandidateRegex() {
        CANDIDATE_REGEX.lastIndex = 0;
    }

    function scanCandidateOccurrences(text) {
        const source = String(text ?? "");

        resetCandidateRegex();

        const occurrences = [];
        let match;

        while ((match = CANDIDATE_REGEX.exec(source)) !== null) {
            const rawValue = String(match[1] || "").trim();

            if (!rawValue) {
                continue;
            }

            const before = source.slice(0, match.index);

            const isSentenceStart =
                !before || /[.!?]["'”’)\]]*\s*$/.test(before);

            occurrences.push({
                text: rawValue,
                index: match.index,
                rawText: rawValue,
                isSentenceStart
            });
        }

        return occurrences;
    }
    function getCandidateTokenSet(value) {
        return new Set(getCandidateTokens(value));
    }

    function countSharedCandidateTokens(left, right) {
        const leftTokens = getCandidateTokenSet(left);

        const rightTokens = getCandidateTokenSet(right);

        let count = 0;

        for (const token of rightTokens) {
            if (leftTokens.has(token)) {
                count++;
            }
        }

        return count;
    }

    function getSentenceStartDistance(sentenceStart, candidate) {
        return tokenEditDistance(
            getCandidateTokens(sentenceStart),
            getCandidateTokens(candidate)
        );
    }

    function findSentenceStartMatch(sentenceStart, candidates) {
        const normalizedStart = normalizeCandidate(sentenceStart);

        if (!normalizedStart) {
            return null;
        }

        let best = null;

        for (const candidate of candidates) {
            const shared = countSharedCandidateTokens(
                sentenceStart,
                candidate.name
            );

            if (shared <= 0) {
                continue;
            }

            const candidateTokens = getCandidateTokens(candidate.name);

            const startTokens = getCandidateTokens(sentenceStart);

            const exact = normalizedStart === candidate.normalized;

            const distance = getSentenceStartDistance(
                sentenceStart,
                candidate.name
            );

            if (
                !best ||
                (exact && !best.exact) ||
                (exact === best.exact && shared > best.shared) ||
                (exact === best.exact &&
                    shared === best.shared &&
                    distance < best.distance) ||
                (exact === best.exact &&
                    shared === best.shared &&
                    distance === best.distance &&
                    candidateTokens.length > best.candidateTokenCount) ||
                (exact === best.exact &&
                    shared === best.shared &&
                    distance === best.distance &&
                    candidateTokens.length === best.candidateTokenCount &&
                    startTokens.length > best.startTokenCount)
            ) {
                best = {
                    candidate,
                    exact,
                    shared,
                    distance,
                    candidateTokenCount: candidateTokens.length,
                    startTokenCount: startTokens.length
                };
            }
        }

        return best;
    }

    function applySentenceStartMatches(candidates, sentenceStarts) {
        const retained = [];

        for (const sentenceStart of sentenceStarts) {
            const match = findSentenceStartMatch(
                sentenceStart.text,
                candidates
            );

            if (!match) {
                continue;
            }

            const candidate = match.candidate;

            candidate.frequency += 1;

            if (!match.exact) {
                retained.push({
                    text: sentenceStart.text,
                    candidate,
                    index: sentenceStart.index,
                    tokenCount: match.shared,
                    distance: match.distance
                });
            }
        }

        for (const candidate of candidates) {
            candidate.sentenceStarts = retained.filter(
                (entry) => entry.candidate === candidate
            );
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
            value = value.slice(0, -2);
        } else if (value.endsWith("s'")) {
            value = value.slice(0, -1);
        }

        if (value.length <= 3) {
            return value;
        }

        if (value.endsWith("ies") && value.length > 4) {
            return value.slice(0, -3) + "y";
        }

        if (/(?:ches|shes|xes|zes)$/.test(value)) {
            return value.slice(0, -2);
        }

        if (value.endsWith("sses")) {
            return value.slice(0, -2);
        }

        if (value.endsWith("oes") && value.length > 4) {
            return value.slice(0, -2);
        }

        if (value === "leaves") {
            return "leaf";
        }

        if (value === "wolves") {
            return "wolf";
        }

        if (value.endsWith("s") && !value.endsWith("ss")) {
            return value.slice(0, -1);
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
        const map = new Map();

        const sentenceStarts = [];

        for (const occurrence of occurrences) {
            const name = String(occurrence?.text ?? "").trim();

            if (!name) {
                continue;
            }

            if (occurrence?.isSentenceStart) {
                sentenceStarts.push({
                    text: String(occurrence.rawText || name).trim(),
                    index: Number(occurrence.index) || 0
                });

                continue;
            }

            const normalized = normalizeCandidate(name);

            if (!normalized) {
                continue;
            }

            let candidate = map.get(normalized);

            if (!candidate) {
                candidate = {
                    name,
                    normalized,
                    regexValue: normalizedCandidateRegexValue(name),
                    frequency: 0,
                    variants: new Map(),
                    occurrences: [],
                    sentenceStarts: []
                };

                map.set(normalized, candidate);
            }

            candidate.frequency += 1;

            candidate.variants.set(
                name,
                (candidate.variants.get(name) || 0) + 1
            );

            candidate.occurrences.push(occurrence);
        }

        const candidates = Array.from(map.values());

        applySentenceStartMatches(candidates, sentenceStarts);

        return candidates;
    }

    function chooseCandidateDisplayName(candidate) {
        if (!candidate?.variants) {
            return candidate?.name || "";
        }

        let bestName = candidate.name || "";

        let bestFrequency = -1;

        for (const [name, frequency] of candidate.variants) {
            if (frequency > bestFrequency) {
                bestFrequency = frequency;
                bestName = name;
            }
        }

        return bestName;
    }

    function finalizeCandidateNames(candidates) {
        return candidates.map((candidate, index) => ({
            ...candidate,
            name: chooseCandidateDisplayName(candidate),
            originalIndex: index,
            sentenceStarts: Array.isArray(candidate.sentenceStarts)
                ? candidate.sentenceStarts
                : []
        }));
    }

    function scanChapterCandidates(text) {
        const occurrences = scanCandidateOccurrences(text);

        const merged = mergeCandidateOccurrences(occurrences);

        return finalizeCandidateNames(merged);
    }
    const MAX_CLUSTER_TOKEN_LINKS = 2;

    function candidateTokens(candidate) {
        return splitCandidateTokens(
            candidate?.normalized || candidate?.name || ""
        ).map(normalizeCandidateToken);
    }

    function tokenEditDistance(leftTokens, rightTokens) {
        const left = Array.isArray(leftTokens) ? leftTokens : [];

        const right = Array.isArray(rightTokens) ? rightTokens : [];

        const previous = Array.from(
            {
                length: right.length + 1
            },
            (_, index) => index
        );

        for (let i = 1; i <= left.length; i++) {
            const current = new Array(right.length + 1);

            current[0] = i;

            for (let j = 1; j <= right.length; j++) {
                const cost = left[i - 1] === right[j - 1] ? 0 : 1;

                current[j] = Math.min(
                    current[j - 1] + 1,
                    previous[j] + 1,
                    previous[j - 1] + cost
                );
            }

            for (let j = 0; j < current.length; j++) {
                previous[j] = current[j];
            }
        }

        return previous[right.length];
    }

    function isTokenSubsequence(shorter, longer) {
        if (shorter.length > longer.length) {
            return false;
        }

        let index = 0;

        for (const token of longer) {
            if (token === shorter[index]) {
                index++;

                if (index === shorter.length) {
                    return true;
                }
            }
        }

        return shorter.length === 0;
    }

    function candidateTokenLinkDistance(left, right) {
        if (left.normalized === right.normalized) {
            return 0;
        }

        const leftTokens = candidateTokens(left);
        const rightTokens = candidateTokens(right);

        if (
            isTokenSubsequence(leftTokens, rightTokens) ||
            isTokenSubsequence(rightTokens, leftTokens)
        ) {
            return Math.abs(leftTokens.length - rightTokens.length);
        }

        return Infinity;
    }
    function getCandidateTokens(name) {
        return (
            String(name || "")
                .toLowerCase()
                .match(/[a-z]+/g) || []
        );
    }
    function candidatesAreClusterLinked(candidateA, candidateB) {
        return (
            candidateTokenLinkDistance(candidateA, candidateB) <=
            MAX_CLUSTER_TOKEN_LINKS
        );
    }

    function buildCandidateClusters(candidates) {
        const ordered = [...candidates].sort(
            (a, b) =>
                Number(b.frequency || 0) - Number(a.frequency || 0) ||
                Number(a.originalIndex || 0) - Number(b.originalIndex || 0)
        );

        const assigned = new Set();

        const clusters = [];

        for (const root of ordered) {
            if (assigned.has(root)) {
                continue;
            }

            const members = [root];

            assigned.add(root);

            for (const candidate of ordered) {
                if (assigned.has(candidate) || candidate === root) {
                    continue;
                }

                if (candidatesAreClusterLinked(root, candidate)) {
                    members.push(candidate);
                    assigned.add(candidate);
                }
            }

            const remaining = members
                .filter((candidate) => candidate !== root)
                .sort(
                    (a, b) =>
                        Number(b.frequency || 0) - Number(a.frequency || 0) ||
                        Number(a.originalIndex || 0) -
                            Number(b.originalIndex || 0)
                );

            clusters.push({
                root,
                members: [root, ...remaining]
            });
        }

        return {
            clusters,
            unclustered: clusters
                .filter((cluster) => cluster.members.length === 1)
                .map((cluster) => cluster.root),
            assigned
        };
    }

    function applyUnclusteredFrequencyFilter(candidates) {
        if (!Array.isArray(candidates) || !candidates.length) {
            return [];
        }

        const clustering = buildCandidateClusters(candidates);

        const maxFrequency = Math.max(
            ...candidates.map((candidate) => Number(candidate.frequency || 0))
        );

        if (!Number.isFinite(maxFrequency) || maxFrequency <= 0) {
            return candidates;
        }

        const minimumFrequency = maxFrequency * UNCLUSTERED_FREQUENCY_RATIO;

        const kept = [];

        for (const cluster of clustering.clusters) {
            if (cluster.members.length > 1) {
                kept.push(...cluster.members);
                continue;
            }

            const candidate = cluster.members[0];

            if (Number(candidate.frequency || 0) >= minimumFrequency) {
                kept.push(candidate);
            }
        }

        return kept;
    }

    function processCandidateClusters(candidates) {
        const filtered = applyUnclusteredFrequencyFilter(candidates);

        const clustering = buildCandidateClusters(filtered);

        return {
            candidates: filtered,
            clusters: clustering.clusters,
            unclustered: clustering.unclustered,
            assigned: clustering.assigned
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

        flags = flags.replace(/g/g, "");

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

    function rulePartiallyMatchesCandidate(candidate, rule) {
        if (ruleMatchesEntireCandidate(candidate, rule)) {
            return false;
        }

        const forms = getCandidateMatchForms(candidate);

        if (rule.inputType === "regexp") {
            const regex = compileRuleRegex(rule);

            if (!regex) {
                return false;
            }

            return forms.some((form) => {
                regex.lastIndex = 0;

                const match = regex.exec(form);

                if (!match || !match[0].length) {
                    return false;
                }

                return !(match.index === 0 && match[0].length === form.length);
            });
        }

        if (rule.inputType === "wholewords") {
            return forms.some(
                (form) =>
                    wholeWordRuleMatches(
                        form,
                        rule.input,
                        rule.caseSensitive
                    ) &&
                    !compareRuleText(
                        form.trim(),
                        String(rule.input || "").trim(),
                        rule.caseSensitive
                    )
            );
        }

        return forms.some(
            (form) =>
                textRuleContains(form, rule.input, rule.caseSensitive) &&
                !compareRuleText(form, rule.input, rule.caseSensitive)
        );
    }

    function getRuleMatchType(candidate, rule) {
        if (ruleMatchesEntireCandidate(candidate, rule)) {
            return "exact";
        }

        if (rulePartiallyMatchesCandidate(candidate, rule)) {
            return "partial";
        }

        return "none";
    }

    function findCandidateRuleMatches(candidate) {
        const rules = getCurrentSiteRules();

        const exact = [];
        const partial = [];
        const all = [];

        for (const rule of rules) {
            const type = getRuleMatchType(candidate, rule);

            if (type === "exact") {
                exact.push(rule);
                all.push({
                    rule,
                    type
                });
            } else if (type === "partial") {
                partial.push(rule);
                all.push({
                    rule,
                    type
                });
            }
        }

        return {
            exact,
            partial,
            all
        };
    }

    function ruleOutputMatchesRuleInput(sourceRule, targetRule) {
        if (
            !sourceRule?.enabled ||
            !targetRule?.enabled ||
            !sourceRule.output ||
            !targetRule.input ||
            sourceRule === targetRule
        ) {
            return false;
        }

        const output = String(sourceRule.output);

        if (targetRule.inputType === "regexp") {
            const regex = compileRuleRegex(targetRule);

            if (!regex) {
                return false;
            }

            regex.lastIndex = 0;

            return regex.test(output);
        }

        if (targetRule.inputType === "wholewords") {
            return wholeWordRuleMatches(
                output,
                targetRule.input,
                targetRule.caseSensitive
            );
        }

        return textRuleContains(
            output,
            targetRule.input,
            targetRule.caseSensitive
        );
    }

    function classifyCandidate(candidate) {
        const matches = findCandidateRuleMatches(candidate);

        if (!matches.all.length) {
            return {
                type: "candidate",
                candidate,
                matches
            };
        }

        if (matches.exact.length === 1 && matches.partial.length === 0) {
            return {
                type: "group",
                candidate,
                rule: matches.exact[0],
                matches
            };
        }

        return {
            type: "conflict",
            candidate,
            matches
        };
    }

    function buildGroupMatches(classifications) {
        const matchesByGroup = new Map();

        for (const classification of classifications) {
            if (classification.type !== "group") {
                continue;
            }

            const rule = classification.rule;

            const groupIndex = Number(rule.groupIndex);

            if (!Number.isFinite(groupIndex)) {
                continue;
            }

            if (!matchesByGroup.has(groupIndex)) {
                matchesByGroup.set(groupIndex, new Map());
            }

            const rules = matchesByGroup.get(groupIndex);

            if (!rules.has(rule.ruleIndex)) {
                rules.set(rule.ruleIndex, []);
            }

            const candidates = rules.get(rule.ruleIndex);

            if (
                !candidates.some(
                    (candidate) =>
                        candidate.normalized ===
                        classification.candidate.normalized
                )
            ) {
                candidates.push(classification.candidate);
            }
        }

        const result = [];

        for (
            let groupIndex = 0;
            groupIndex < adaptedDatabase.groups.length;
            groupIndex++
        ) {
            const sourceGroup = adaptedDatabase.groups[groupIndex];

            const matchedRules = matchesByGroup.get(groupIndex);

            if (!matchedRules) {
                continue;
            }

            const rules = [];

            for (
                let ruleIndex = 0;
                ruleIndex < (sourceGroup.rules?.length || 0);
                ruleIndex++
            ) {
                if (!matchedRules.has(ruleIndex)) {
                    continue;
                }

                const sourceRule = sourceGroup.rules[ruleIndex];

                rules.push({
                    ...sourceRule,
                    candidates: matchedRules.get(ruleIndex)
                });
            }

            if (rules.length) {
                result.push({
                    ...sourceGroup,
                    index: groupIndex,
                    rules
                });
            }
        }

        return result;
    }

    function getConflictRuleKey(rule) {
        if (!rule) {
            return "";
        }

        return (
            String(rule.groupIndex ?? "") + ":" + String(rule.ruleIndex ?? "")
        );
    }

    function buildConflictClusters(classifications) {
        const ruleMap = new Map();
        const adjacency = new Map();

        for (const classification of classifications || []) {
            if (classification.type !== "conflict") {
                continue;
            }

            const uniqueRules = new Map();

            for (const match of classification.matches?.all || []) {
                const rule = match.rule;

                const key = getConflictRuleKey(rule);

                if (key) {
                    uniqueRules.set(key, rule);
                }
            }

            const keys = Array.from(uniqueRules.keys());

            for (const [key, rule] of uniqueRules) {
                ruleMap.set(key, rule);

                if (!adjacency.has(key)) {
                    adjacency.set(key, new Set());
                }
            }

            for (let index = 0; index < keys.length; index++) {
                for (let next = index + 1; next < keys.length; next++) {
                    adjacency.get(keys[index]).add(keys[next]);

                    adjacency.get(keys[next]).add(keys[index]);
                }
            }
        }

        const rules = Array.from(ruleMap.entries());

        for (const [sourceKey, sourceRule] of rules) {
            for (const [targetKey, targetRule] of rules) {
                if (sourceKey === targetKey) {
                    continue;
                }

                if (ruleOutputMatchesRuleInput(sourceRule, targetRule)) {
                    adjacency.get(sourceKey).add(targetKey);

                    adjacency.get(targetKey).add(sourceKey);
                }
            }
        }

        const visited = new Set();
        const clusters = [];
        const ruleClusterMap = new Map();

        let nextClusterId = 1;

        for (const [rootKey] of rules) {
            if (visited.has(rootKey)) {
                continue;
            }

            const stack = [rootKey];

            const clusterKeys = [];

            visited.add(rootKey);

            while (stack.length) {
                const key = stack.pop();

                clusterKeys.push(key);

                for (const neighbor of adjacency.get(key) || new Set()) {
                    if (visited.has(neighbor)) {
                        continue;
                    }

                    visited.add(neighbor);

                    stack.push(neighbor);
                }
            }

            clusterKeys.sort((left, right) => {
                const leftRule = ruleMap.get(left);

                const rightRule = ruleMap.get(right);

                return (
                    (leftRule?.groupIndex ?? 0) -
                        (rightRule?.groupIndex ?? 0) ||
                    (leftRule?.ruleIndex ?? 0) - (rightRule?.ruleIndex ?? 0)
                );
            });

            const clusterId = nextClusterId++;

            for (const key of clusterKeys) {
                ruleClusterMap.set(key, clusterId);
            }

            clusters.push({
                id: clusterId,
                ruleKeys: clusterKeys,
                rules: clusterKeys.map((key) => ruleMap.get(key))
            });
        }

        return {
            clusters,
            ruleClusterMap
        };
    }

    function buildConflictData(classifications, ruleClusterMap) {
        const conflicts = [];
        let discoveryOrder = 0;

        for (const classification of classifications) {
            if (classification.type !== "conflict") {
                continue;
            }

            const candidate = classification.candidate;

            for (const match of classification.matches?.all || []) {
                const rule = match.rule;

                const group = adaptedDatabase.groups[rule.groupIndex];

                if (!group) {
                    continue;
                }

                const ruleKey = getConflictRuleKey(rule);

                conflicts.push({
                    id: `conflict-${discoveryOrder + 1}`,
                    discoveryOrder: discoveryOrder++,
                    candidate,
                    candidateName: candidate.name || "",
                    frequency: Number(candidate.frequency) || 0,
                    clusterId: ruleClusterMap?.get(ruleKey) || 0,
                    type: match.type,
                    groupName: group.name || "(Unnamed group)",
                    group,
                    rule,
                    ruleInput: rule.input || "",
                    ruleOutput: rule.output || ""
                });
            }
        }

        return conflicts;
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
        state.conflictClusters = [];
    }

    function buildCandidateResults(candidates) {
        return candidates.map((candidate) => {
            candidate.generatedInput = generateCandidateInput(
                candidate,
                state.candidateTemplate
            );

            return candidate;
        });
    }

    function analyzePage() {
        clearAnalysisResults();

        chapterText = scanPageText();

        if (!chapterText) {
            return {
                chapterText: "",
                candidates: [],
                candidateClusters: [],
                groupMatches: [],
                conflicts: [],
                conflictClusters: [],
                error: null
            };
        }

        const scanned = scanChapterCandidates(chapterText);

        const classifications = scanned.map((candidate) =>
            classifyCandidate(candidate)
        );

        const candidates = buildCandidateResults(classifications);

        const candidateProcessing = processCandidateClusters(candidates);

        const retainedCandidates = new Set(candidateProcessing.candidates);

        const retainedClassifications = classifications.filter(
            (classification) => retainedCandidates.has(classification.candidate)
        );

        const groupMatches = buildGroupMatches(retainedClassifications);

        const conflictClustering = buildConflictClusters(
            retainedClassifications
        );

        const conflicts = buildConflictData(
            retainedClassifications,
            conflictClustering.ruleClusterMap
        );

        state.candidates = candidateProcessing.candidates;
        state.candidateClusters = candidateProcessing.clusters;
        state.groupMatches = groupMatches;
        state.conflicts = conflicts;
        state.conflictClusters = conflictClustering.clusters;

        regenerateCandidateInputs(state.candidates, state.candidateTemplate);

        return {
            chapterText,
            candidates: state.candidates,
            candidateClusters: state.candidateClusters,
            groupMatches,
            conflicts,
            conflictClusters: state.conflictClusters,
            error: null
        };
    }
    function scanPageText() {
        const root = document.body;

        if (!root) {
            return "";
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

        const parts = [];
        let node;

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

            const previous = parts.length ? parts[parts.length - 1] : "";

            if (previous && !/\s$/.test(previous) && !/^\s/.test(text)) {
                const previousElement = node.previousSibling;

                if (
                    previousElement &&
                    previousElement.nodeType === Node.ELEMENT_NODE &&
                    /^(ADDRESS|ARTICLE|ASIDE|BLOCKQUOTE|DIV|DL|FIELDSET|FIGCAPTION|FIGURE|FOOTER|FORM|H1|H2|H3|H4|H5|H6|HEADER|HR|LI|MAIN|NAV|OL|P|PRE|SECTION|TABLE|TD|TH|TR|UL)$/.test(
                        previousElement.tagName
                    )
                ) {
                    parts.push(" ");
                }
            }

            parts.push(text);
        }

        return parts.join("").replace(/\s+/g, " ").trim();
    }
    function runAnalysisSafely() {
        try {
            return analyzePage();
        } catch (error) {
            clearAnalysisResults();

            return {
                chapterText: "",
                candidates: [],
                candidateClusters: [],
                groupMatches: [],
                conflicts: [],
                conflictClusters: [],
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
            (rule) =>
                Array.isArray(rule.candidates) &&
                rule.candidates.some(
                    (candidate) => Number(candidate.frequency || 0) > 0
                )
        );
    }

    function getVisibleConflicts() {
        return state.conflicts
            .slice()
            .sort(
                (left, right) =>
                    Number(left.discoveryOrder || 0) -
                    Number(right.discoveryOrder || 0)
            );
    }

    function sortDisplayedGroups(groups) {
        return [...groups].sort(
            (a, b) => Number(a.index || 0) - Number(b.index || 0)
        );
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
.wnc-cluster-title {
    font-weight: bold;
    margin-bottom: 6px;
}
.wnc-muted {
    color: #999;
}
.wnc-code {
    font-family: monospace;
    white-space: pre-wrap;
    word-break: break-word;
}
.wnc-summary {
    display: flex;
    gap: 12px;
    margin-bottom: 12px;
}
.wnc-summary-item {
    border: 1px solid #444;
    border-radius: 5px;
    padding: 7px 10px;
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
        const sentenceStarts = Array.isArray(candidate.sentenceStarts)
            ? candidate.sentenceStarts
            : [];

        return `
        <tr class="wnc-candidate-row">
            <td>
                ${escapeHtml(candidate.name)}
                ${
                    sentenceStarts.length
                        ? sentenceStarts
                              .map(
                                  (entry) =>
                                      `<div class="wnc-sentence-start">${escapeHtml(
                                          entry.text
                                      )}</div>`
                              )
                              .join("")
                        : ""
                }
            </td>
            <td>
                ${Number(candidate.frequency || 0)}
            </td>
            <td>
                <code>${escapeHtml(
                    candidate.regexValue ?? candidate.name
                )}</code>
            </td>
            <td>
                ${escapeHtml(candidate.generatedInput ?? "")}
            </td>
            <td>
                <button
                    type="button"
                    data-wnc-copy="${escapeHtml(
                        candidate.generatedInput ?? ""
                    )}"
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
                    ${cluster.members
                        .map((candidate) => renderCandidateRow(candidate))
                        .join("")}
                </tbody>
            `
            )
            .join("");

        return `
        <div class="wnc-table-wrap">
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
        const expanded = isRuleExpanded(group, rule);

        const candidates = [...(rule.candidates || [])].sort(
            (a, b) => Number(b.frequency || 0) - Number(a.frequency || 0)
        );

        const totalFrequency = candidates.reduce(
            (total, candidate) => total + Number(candidate.frequency || 0),
            0
        );

        return `
        <div class="wnc-rule">
            <div class="wnc-rule-header">
                <button
                    data-wnc-rule-toggle="1"
                    data-group-index="${escapeHtml(group.index)}"
                    data-rule-index="${escapeHtml(rule.ruleIndex)}"
                >
                    ${expanded ? "−" : "+"}
                </button>

                <span>
                    ${escapeHtml(rule.input)}
                </span>

                <span class="wnc-muted">
                    → ${escapeHtml(rule.output)}
                </span>

                <span class="wnc-muted">
                    (${totalFrequency})
                </span>
            </div>

            ${
                expanded
                    ? `
                        <div class="wnc-rule-body">
                            ${
                                candidates.length
                                    ? candidates
                                          .map(
                                              (candidate) =>
                                                  `<div>${escapeHtml(
                                                      candidate.name
                                                  )} <span class="wnc-muted">(${escapeHtml(
                                                      candidate.frequency
                                                  )})</span></div>`
                                          )
                                          .join("")
                                    : `<div class="wnc-muted">No matches.</div>`
                            }
                        </div>
                    `
                    : ""
            }
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
        return `
<div class="wnc-conflict">
    <div>
        <strong>
            ${escapeHtml(conflict.candidateName)}
        </strong>
        <span class="wnc-muted">
            (${escapeHtml(conflict.frequency)})
        </span>
    </div>
    <div>
        <span class="wnc-muted">
            ${escapeHtml(conflict.groupName)}
        </span>
    </div>
    <div class="wnc-code">
        ${escapeHtml(conflict.ruleInput)}
        →
        ${escapeHtml(conflict.ruleOutput)}
    </div>
    <div class="wnc-muted">
        ${escapeHtml(conflict.type)}
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
                render();
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
        rawFoxReplaceDatabase = loadActiveDatabase();

        adaptedDatabase = adaptFoxReplaceDatabase(rawFoxReplaceDatabase);

        ensureDatabaseShape();

        registerWncMenuCommands();
    }

    function startWnc() {
        initializeWnc();
    }

    startWnc();
})();
