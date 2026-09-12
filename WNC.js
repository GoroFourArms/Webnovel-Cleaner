// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.1.8
// @description  Webnovel Cleaner
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @updateURL    https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC.js
// @downloadURL  https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC.js
// ==/UserScript==

(() => {
    "use strict";

    /*
     * WNC 6
     *
     * PURPOSE
     * -------
     * WNC is a FoxReplace rule workbench.
     *
     * It does NOT:
     *   - replace text on the page
     *   - use MutationObserver
     *   - automatically clean pages
     *   - act as a second FoxReplace runtime
     *
     * It DOES:
     *   - hold native FoxReplace JSON
     *   - scan the current page for unmatched capitalized words/phrases
     *   - let the user edit candidates into FoxReplace rules
     *   - let the user edit existing matching rules
     *   - let the user edit group URL patterns
     *   - import/export native FoxReplace JSON
     */

    // ---------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------

    const DB_KEY = "WNC_FOXREPLACE_DATABASE_V1";

    const UI = {
        title: "WNC"
    };

const DEFAULT_GROUP = {
    name: "",
    urls: [],
    enabled: true,
    pageLoad: true,
    auto: true,
    html: 0,
    substitutions: []
};

const DEFAULT_RULE = {
    input: "",
    output: "",
    inputType: "text",
    outputType: 0,
    caseSensitive: false,
    enabled: true
};

    let db = loadDatabase();

    let state = {
        screen: "groups",
        groupIndex: null,
        tab: "rules",

        candidates: [],

        targetGroup: null,
        candidateType: "text",
        candidateTemplate: "Other",
        candidateCaseSensitive: false,

        selectedCandidates: new Set(),

searchQuery: "",
showOtherGroups: false,
unmatchedInitialized: false,
ruleSortField: null,
ruleSortDirection: 1
    };

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    function readStorage(key, fallback = null) {
        try {
            if (typeof GM_getValue === "function") {
                return GM_getValue(key, fallback);
            }

            const value = localStorage.getItem(key);
            return value === null ? fallback : JSON.parse(value);
        } catch {
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            if (typeof GM_setValue === "function") {
                GM_setValue(key, value);
                return;
            }

            localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error("WNC storage error:", error);
        }
    }

    function loadDatabase() {
        const raw = readStorage(DB_KEY, null);

        if (!raw) {
            return {
                groups: []
            };
        }

        const normalized = normalizeDatabase(raw);

        if (!normalized) {
            return {
                groups: []
            };
        }

        return normalized;
    }

    function saveDatabase() {
    writeStorage(DB_KEY, db);
}

    // ---------------------------------------------------------------------
    // Native FoxReplace normalization
    // ---------------------------------------------------------------------

    function normalizeDatabase(value) {
        if (!value || typeof value !== "object") {
            return null;
        }

        if (!Array.isArray(value.groups)) {
            return null;
        }

        const groups = value.groups
            .filter(group => group && typeof group === "object")
            .map(normalizeGroup)
            .filter(Boolean);

        return {
            ...value,
            groups
        };
    }

    function normalizeGroup(group) {
        const normalized = {
            ...DEFAULT_GROUP,
            ...group
        };

        normalized.name = String(normalized.name ?? "");

        if (!Array.isArray(normalized.urls)) {
            normalized.urls = [];
        }

        normalized.urls = normalized.urls
    .filter(url => typeof url === "string" || typeof url === "number")
    .map(url => String(url));

        if (!Array.isArray(normalized.substitutions)) {
            normalized.substitutions = [];
        }

        normalized.substitutions = normalized.substitutions
            .map(normalizeRule)
            .filter(Boolean);

        normalized.enabled = Boolean(normalized.enabled);
        normalized.pageLoad = Boolean(normalized.pageLoad);
        normalized.auto = Boolean(normalized.auto);
        normalized.html =
        normalized.html === 1 ||
        normalized.html === "1"
        ? 1
        : normalized.html === 2 ||
          normalized.html === "2"
            ? 2
            : 0;

return normalized;
}


function normalizeRule(rule) {
    if (!rule || typeof rule !== "object") return null;

    const normalized = {
        ...rule
    };

    normalized.input = String(normalized.input ?? "");
    normalized.output = String(normalized.output ?? "");

    if (
        normalized.outputType === 1 ||
        normalized.outputType === "1" ||
        normalized.outputType === "function"
    ) {
        normalized.outputType = 1;
    } else {
        normalized.outputType = 0;
    }

    // WNC uses readable strings internally.
    if (
        normalized.inputType === 1 ||
        normalized.inputType === "1"
    ) {
        normalized.inputType = "whole";
    } else if (
        normalized.inputType === 2 ||
        normalized.inputType === "2"
    ) {
        normalized.inputType = "regexp";
    } else {
        normalized.inputType = "text";
    }

    normalized.caseSensitive =
        typeof normalized.caseSensitive === "boolean"
            ? normalized.caseSensitive
            : normalized.caseSensitive === "true"
                ? true
                : normalized.caseSensitive === "false"
                    ? false
                    : Boolean(normalized.caseSensitive);

    normalized.enabled =
        typeof normalized.enabled === "boolean"
            ? normalized.enabled
            : normalized.enabled === "true"
                ? true
                : normalized.enabled === "false"
                    ? false
                    : Boolean(normalized.enabled);

    // Only normalize html when it actually exists.
    if ("html" in normalized) {
        normalized.html = String(normalized.html ?? "none");
    }

    return normalized;
}

    // ---------------------------------------------------------------------
    // Sorting
    // ---------------------------------------------------------------------

    function compareNames(a, b) {
        return String(a).localeCompare(
            String(b),
            undefined,
            {
                sensitivity: "base",
                numeric: true
            }
        );
    }

    function sortedGroups() {
        return db.groups
            .map((group, index) => ({ group, index }))
            .sort((a, b) => compareNames(a.group.name, b.group.name));
    }

    function sortRulesByHeader(field) {
    const group = db.groups[state.groupIndex];

    if (!group || !group.substitutions.length) {
        return;
    }

    if (state.ruleSortField === field) {
        state.ruleSortDirection *= -1;
    } else {
        state.ruleSortField = field;
        state.ruleSortDirection = 1;
    }

    const pageText = getPageText();

    group.substitutions.sort((a, b) => {
        let comparison = 0;

        if (field === "matches") {
            comparison =
                countRuleMatches(a, pageText) -
                countRuleMatches(b, pageText);
        } else if (
            field === "caseSensitive" ||
            field === "enabled"
        ) {
            comparison =
                Number(a[field]) -
                Number(b[field]);
        } else {
            comparison = compareNames(
                a[field],
                b[field]
            );
        }

        return comparison * state.ruleSortDirection;
    });

    saveDatabase();
    render();
}

    // ---------------------------------------------------------------------
    // Current site matching
    // ---------------------------------------------------------------------

    function currentURL() {
        return window.location.href;
    }

    function currentHostname() {
        return window.location.hostname;
    }

    /*
     * FoxReplace URL formats vary between versions/configurations.
     *
     * WNC deliberately keeps the stored URL values untouched.
     * This matcher supports the common cases:
     *
     *   exact URL
     *   URL substring
     *   hostname
     *   wildcard *
     *   regular-expression-looking /.../ patterns
     */
    function urlPatternMatches(pattern) {
        pattern = String(pattern ?? "").trim();

        if (!pattern) {
            return false;
        }

        const url = currentURL();
        const hostname = currentHostname();

        // /pattern/ style URL regex.
        if (
            pattern.length > 2 &&
            pattern.startsWith("/") &&
            pattern.lastIndexOf("/") > 0
        ) {
            const lastSlash = pattern.lastIndexOf("/");

            try {
                const source = pattern.slice(1, lastSlash);
                const flags = pattern.slice(lastSlash + 1);

                return new RegExp(source, flags).test(url);
            } catch {
                // Fall through to literal matching.
            }
        }

        // Wildcard.
        if (pattern.includes("*")) {
            const escaped = pattern
                .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
                .replace(/\*/g, ".*");

            try {
                return new RegExp(`^${escaped}$`, "i").test(url);
            } catch {
                // Continue.
            }
        }

        if (pattern === hostname) {
            return true;
        }

        return url === pattern || url.includes(pattern);
    }

    function groupMatchesCurrentSite(group) {
        if (!Array.isArray(group.urls) || group.urls.length === 0) {
            return false;
        }

        return group.urls.some(urlPatternMatches);
    }

    // ---------------------------------------------------------------------
    // Rule matching
    // ---------------------------------------------------------------------

    function buildRuleRegex(rule) {
        if (!rule.input) {
            return null;
        }

        const flags = rule.caseSensitive ? "g" : "gi";

        try {
        if (rule.inputType === "regexp") {
            return new RegExp(rule.input, flags);
        }

        if (rule.inputType === "whole") {
            return new RegExp(
                `(?<![\\p{L}\\p{N}_])${escapeRegExp(rule.input)}(?![\\p{L}\\p{N}_])`,
                flags + "u"
            );
        }

        return new RegExp(escapeRegExp(rule.input), flags);
        } catch {
            return null;
        }
    }

    function countRuleMatches(rule, text) {
        const regex = buildRuleRegex(rule);

        if (!regex) {
            return 0;
        }

        let count = 0;

        while (true) {
            const match = regex.exec(text);

            if (!match) {
                break;
            }

            count++;

            /*
             * Avoid an infinite loop on zero-length regexes.
             */
            if (match[0].length === 0) {
                regex.lastIndex++;
            }

            if (count > 100000) {
                break;
            }
        }

        return count;
    }

    function ruleMatchesText(rule, text) {
        return countRuleMatches(rule, text) > 0;
    }

    function getPageText() {
        if (!document.body) {
            return "";
        }

        return document.body.innerText || "";
    }

    // ---------------------------------------------------------------------
    // Candidate scanner
    // ---------------------------------------------------------------------

    /*
     * Candidate extraction:
     *
     * Finds capitalized words and capitalized multi-token phrases.
     *
     * Examples:
     *
     *   Park Min-Suk
     *   King Eldor
     *   Lady Aria
     *   New York
     *
     * Hyphens inside a token are retained.
     *
     * Lowercase continuation words are allowed only when they are part of
     * an immediately adjacent capitalized sequence through a hyphen.
     */

    function extractCandidates(text) {
    const counts = new Map();

    const tokenPattern =
        /[\p{Lu}][\p{L}\p{M}\p{N}'’-]*(?:[-–—][\p{Lu}\p{L}\p{M}\p{N}'’-]*)?/gu;

    const matches = [];
    let match;

    while ((match = tokenPattern.exec(text)) !== null) {
        matches.push({
            value: match[0],
            start: match.index,
            end: match.index + match[0].length
        });
    }

    /*
     * Build phrases first so we can identify the longest candidate
     * covering each occurrence.
     */
    const occurrences = [];

    for (let i = 0; i < matches.length; i++) {
        let phrase = matches[i].value;

        occurrences.push({
            candidate: phrase,
            start: matches[i].start,
            end: matches[i].end
        });

        for (let j = i + 1; j < matches.length; j++) {
            const previous = matches[j - 1];
            const current = matches[j];

            const between = text.slice(previous.end, current.start);

            if (!/^[ \t\r\n]+$/.test(between)) {
                break;
            }

            phrase += " " + current.value;

            occurrences.push({
                candidate: phrase,
                start: matches[i].start,
                end: current.end
            });

            if (j - i >= 5) {
                break;
            }
        }
    }

    /*
     * Count each occurrence only once.
     *
     * When candidates overlap, the longest candidate wins.
     *
     * Example:
     *
     *   Security Office
     *
     * counts as:
     *
     *   Security Office = 1
     *
     * and does not add another count to:
     *
     *   Security
     */
const selected = [];

const sortedOccurrences = [...occurrences].sort((a, b) => {
    const lengthDifference =
        (b.end - b.start) - (a.end - a.start);

    if (lengthDifference !== 0) {
        return lengthDifference;
    }

    if (a.start !== b.start) {
        return a.start - b.start;
    }

    return compareNames(
        a.candidate,
        b.candidate
    );
});

for (const occurrence of sortedOccurrences) {
    const overlaps = selected.some(existing =>
        occurrence.start < existing.end &&
        occurrence.end > existing.start
    );

    if (!overlaps) {
        selected.push(occurrence);
    }
}

selected.sort((a, b) => {
    if (a.start !== b.start) {
        return a.start - b.start;
    }

    return a.end - b.end;
});

for (const occurrence of selected) {
    addCandidate(counts, occurrence.candidate);
}

    return [...counts.entries()].map(([candidate, matches]) => ({
        candidate,
        input: candidate,
        output: "",
        matches
    }));
}

const COMMON_STANDALONE_WORDS = new Set([
  "And",
"But",
"Or",
"If",
"So",
"Yet",
"For",
"Nor",
"Then",
"Than",
"That",
"This",
"These",
"Those",
"The",
"A",
"An",
"I",
"Am",
"Is",
"Are",
"Was",
"Were",
"Be",
"Been",
"Being",
"He",
"She",
"It",
"We",
"They",
"You",
"Me",
"Him",
"Her",
"Us",
"Them",
"My",
"Your",
"His",
"Her",
"Our",
"Their",
"Of",
"In",
"On",
"At",
"To",
"From",
"With",
"By",
"As",
"Into",
"Upon",
"About",
"After",
"Before",
"Over",
"Under",
    "the",
    "a",
    "an",
    "this",
    "that",
    "these",
    "those",
    "and",
    "but",
    "or",
    "nor",
    "yet",
    "so",
    "he",
    "she",
    "it",
    "they",
    "we",
    "i",
    "you",
    "his",
    "her",
    "its",
    "their",
    "our",
    "your",
    "my",
    "then",
    "now",
    "just",
    "still",
    "also",
    "even",
    "only",
    "already",
    "finally",
    "suddenly",
    "when",
    "while",
    "where",
    "what",
    "why",
    "how",
    "who",
    "if",
    "though",
    "although",
    "because",
    "since",
    "after",
    "before",
    "until",
    "unless",
    "as",
    "for",
    "from",
    "with",
    "without",
    "into",
    "upon",
    "over",
    "under",
    "through",
    "there",
    "here",
    "however",
    "therefore",
    "meanwhile",
    "instead",
    "besides",
    "otherwise",
    "indeed",
    "perhaps",
    "maybe",
    "certainly",
    "actually",
    "apparently",
    "unfortunately",
    "fortunately",
    "to",
    "of",
    "in",
    "on",
    "at",
    "by"
]);

function addCandidate(map, value) {
    let candidate = value.trim();

    if (!candidate) {
        return;
    }

    /*
     * Remove leading articles from multi-word candidates.
     *
     * "The White Dragon" becomes "White Dragon".
     *
     * We only do this for leading articles, so names such as
     * "He Tao", "Do Hyuk", "Will Smith", and "May Chen"
     * remain intact.
     */
    candidate = candidate.replace(
        /^(?:The|A|An)\s+/i,
        ""
    );

    if (!candidate) {
        return;
    }

    if ([...candidate].length < 2) {
        return;
    }

    /*
     * Filter common words only when they are standalone.
     *
     * This means "He" is filtered, but "He Tao" remains.
     */
    if (
        !/\s/.test(candidate) &&
        COMMON_STANDALONE_WORDS.has(
            candidate.toLowerCase()
        )
    ) {
        return;
    }

    const tokens = candidate.split(/\s+/);

    if (
        tokens.length > 1 &&
        tokens.every(token =>
            COMMON_STANDALONE_WORDS.has(
                token.toLowerCase()
            )
        )
    ) {
        return;
    }

    map.set(
        candidate,
        (map.get(candidate) || 0) + 1
    );
}

    // ---------------------------------------------------------------------
    // Existing-rule exclusion
    // ---------------------------------------------------------------------

    function getAllRules() {
        return db.groups.flatMap(group => group.substitutions);
    }

function candidateCoveredByExistingRule(candidate) {
    const rules = getAllRules();

    for (const rule of rules) {
        if (!rule.enabled || !rule.input) {
            continue;
        }

        const regex = buildRuleRegex(rule);

        if (!regex) {
            continue;
        }

        regex.lastIndex = 0;

        const match = regex.exec(candidate);

        if (
            match &&
            match.index === 0 &&
            match[0].length === candidate.length
        ) {
            return true;
        }
    }

    return false;
}

function scanCandidates() {
    const text = getPageText();

    /*
     * Default target group to the first alphabetical group.
     */
    if (
        state.targetGroup === null ||
        !db.groups[state.targetGroup]
    ) {
        const groups = sortedGroups();

        state.targetGroup = groups.length
            ? groups[0].index
            : null;
    }

    if (!text) {
        state.candidates = [];
        state.selectedCandidates.clear();
        state.unmatchedInitialized = true;
        return;
    }

    const discovered = extractCandidates(text)
        .filter(item =>
            !candidateCoveredByExistingRule(item.candidate)
        );

    state.candidates = clusterAndSortCandidates(discovered);
    state.selectedCandidates.clear();

    state.unmatchedInitialized = true;
}

// ---------------------------------------------------------------------
// Candidate clustering
// ---------------------------------------------------------------------

/*
 * Candidates are clustered by connected shared-token relationships.
 *
 * Example:
 *
 *   Fred        59
 *   Fred Smith  11
 *   Smith John   4
 *
 * becomes ONE cluster because:
 *
 *   Fred <-> Fred Smith <-> Smith John
 *
 * Candidates do not need to share a token directly with every member
 * of the cluster. A chain of shared tokens is enough.
 *
 * Unclustered candidates whose frequency is below 5% of the maximum
 * candidate frequency are hidden.
 */

const UNCLUSTERED_FREQUENCY_RATIO = 0.05;

function candidateTokens(candidate) {
    return new Set(
        tokenizeCandidate(candidate.candidate)
            .map(normalizeToken)
            .filter(Boolean)
    );
}

function candidatesShareToken(a, b) {
    const aTokens = candidateTokens(a);
    const bTokens = candidateTokens(b);

    for (const token of aTokens) {
        if (bTokens.has(token)) {
            return true;
        }
    }

    return false;
}

function clusterAndSortCandidates(candidates) {
const sorted = [...candidates].sort((a, b) => {
if (b.matches !== a.matches) {
return b.matches - a.matches;
}
    return compareNames(
        a.candidate,
        b.candidate
    );
});

const clusters = [];
const assigned = new Set();

for (let i = 0; i < sorted.length; i++) {
    if (assigned.has(i)) {
        continue;
    }

    const clusterIndexes = new Set([i]);

    /*
     * Breadth-first search with a maximum depth of 2.
     *
     * Degree 0:
     *   Bob
     *
     * Degree 1:
     *   Bob Yang
     *
     * Degree 2:
     *   Yang Ho
     *
     * Degree 3 is never explored.
     */
    let frontier = [i];

    for (let depth = 0; depth < 2; depth++) {
        const nextFrontier = [];

        for (const sourceIndex of frontier) {
            for (let j = 0; j < sorted.length; j++) {
                if (clusterIndexes.has(j) || assigned.has(j)) {
                    continue;
                }

                if (
                    candidatesShareToken(
                        sorted[sourceIndex].candidate,
                        sorted[j].candidate
                    )
                ) {
                    clusterIndexes.add(j);
                    nextFrontier.push(j);
                }
            }
        }

        frontier = nextFrontier;

        if (!frontier.length) {
            break;
        }
    }

    const cluster = [];

    for (const index of clusterIndexes) {
        cluster.push(sorted[index]);
        assigned.add(index);
    }

    /*
     * Keep the cluster only when:
     *
     * 1. It contains multiple candidates, or
     * 2. Its candidate has at least 5% of the maximum frequency.
     */
    const maxMatches = sorted[0]?.matches || 0;

    if (
        cluster.length > 1 ||
        cluster[0].matches >=
            maxMatches * UNCLUSTERED_FREQUENCY_RATIO
    ) {
        clusters.push(cluster);
    }
}

return clusters.flat();
}
function tokenizeCandidate(value) {
    return String(value)
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}

function normalizeToken(token) {
    return token
        .toLowerCase()
        .replace(/[’']/g, "'")
        .replace(/[–—]/g, "-")
        .replace(/-/g, "");
}

    // ---------------------------------------------------------------------
    // Template helpers
    // ---------------------------------------------------------------------
function getHTMLModeLabel(mode) {
    switch (Number(mode)) {
        case 1:
            return "Output only";

        case 2:
            return "Input & Output";

        default:
            return "No";
    }
}

function cycleGroupHTML() {
    const group = db.groups[state.groupIndex];

    if (!group) {
        return;
    }

    const current =
        Number.isInteger(Number(group.html))
            ? Number(group.html)
            : 0;

    group.html = (current + 1) % 3;

    saveDatabase();
    render();
}
    function generateTemplateInput(candidate, template) {
        const tokens = tokenizeCandidate(candidate);

        if (!tokens.length) {
            return candidate;
        }

        switch (template) {
            case "Korean":
                return generateKoreanRegex(tokens);

            case "Japanese":
                return generateJapanesePattern(tokens);

            case "Other":
            default:
                return generateOtherRegex(tokens);
        }
    }

    /*
     * Korean:
     *
     * Park Min-Suk
     *
     * becomes:
     *
     * (?<![a-z])Min[- ]?Suk(?![a-z])
     *
     * "Park" is deliberately not included.
     *
     * A two-token candidate is treated as:
     *
     *   First Last -> Last
     *
     * For three or more tokens, the first token is treated as the surname /
     * prefix and omitted.
     */
    function generateKoreanRegex(tokens) {
        let working = tokens;

        if (working.length >= 2) {
            working = working.slice(1);
        }

        const transformed = working.map(token => {
            return token
                .split(/[-–—]/)
                .filter(Boolean)
                .map(escapeRegExp)
                .join("[- ]?");
        });

        const body = transformed.join(" ");

        return `(?<![a-z])${body}(?![a-z])`;
    }

    /*
     * Japanese:
     *
     * Firsttoken Secondtoken
     *
     * becomes:
     *
     * Secondtoken Firsttoken
     *
     * Literal spaces only.
     *
     * No \\s+.
     */
    
function generateJapanesePattern(tokens) {
    if (tokens.length < 2) {
        return {
            input: tokens.join(" "),
            output: tokens.join(" ")
        };
    }

    const leftRight = tokens.join(" ");
    const rightLeft = [
        tokens[tokens.length - 1],
        ...tokens.slice(0, -1)
    ].join(" ");

    return {
        input: `${leftRight}|${rightLeft}`,
        output: tokens[tokens.length - 1]
    };
}

    /*
     * Other:
     *
     * First Middle Last
     *
     * becomes:
     *
     * (?<![a-z])First Middle Last(?![a-z])
     */
    function generateOtherRegex(tokens) {
        const body = tokens
            .map(escapeRegExp)
            .join(" ");

        return `(?<![a-z])${body}(?![a-z])`;
    }

    // ---------------------------------------------------------------------
    // Utility
    // ---------------------------------------------------------------------

    function escapeRegExp(value) {
        return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function createNativeRule() {
        return {
            ...DEFAULT_RULE
        };
    }

    function createNativeGroup() {
        return {
            ...DEFAULT_GROUP,
            urls: [],
            substitutions: []
        };
    }

    // ---------------------------------------------------------------------
    // Styles
    // ---------------------------------------------------------------------

    function injectStyles() {
        if (document.getElementById("wnc-styles")) {
            return;
        }

        const style = document.createElement("style");
        style.id = "wnc-styles";

        style.textContent = `
            #wnc-root {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                width: 100%;
                max-height: 90vh;
                z-index: 2147483647;
                overflow: auto;
                box-sizing: border-box;
                font-family: Arial, Helvetica, sans-serif;
                font-size: 14px;
                line-height: 1.4;
                color: #e8e8e8;
                background: #171717;
                border-bottom: 2px solid #444;
                box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45);
            }

            #wnc-root *,
            #wnc-root *::before,
            #wnc-root *::after {
                box-sizing: border-box;
            }

            .wnc-shell {
                width: 100%;
            }

            .wnc-header {
                display: flex;
                align-items: center;
                gap: 5px;
                padding: 4px 6px;
                background: #222;
                border-bottom: 1px solid #444;
            }

            .wnc-brand {
                flex: 0 0 auto;
                font-size: 18px;
                font-weight: 700;
                white-space: nowrap;
            }

            .wnc-header-actions {
                display: flex;
                align-items: center;
                gap: 3px;
                flex: 1;
                min-width: 0;
            }

            .wnc-search {
                flex: 1 1 180px;
                min-width: 150px;
                height: 34px;
                padding: 6px 10px;
                color: #eee;
                background: #111;
                border: 1px solid #555;
                border-radius: 5px;
                outline: none;
            }

            .wnc-search:focus {
                border-color: #888;
            }

            .wnc-button,
            .wnc-choice,
            .wnc-tab,
            .wnc-back,
            .wnc-delete,
            .wnc-add-button,
            .wnc-html-button {
                appearance: none;
                font: inherit;
                color: #eee;
                background: #303030;
                border: 1px solid #555;
                border-radius: 5px;
                cursor: pointer;
            }

            .wnc-button {
                min-height: 24px;
                padding: 2px 6px;
                white-space: nowrap;
            }

            .wnc-button:hover,
            .wnc-choice:hover,
            .wnc-tab:hover,
            .wnc-add-button:hover,
            .wnc-html-button:hover {
                background: #414141;
            }

            .wnc-button:disabled,
            .wnc-choice:disabled {
                opacity: 0.45;
                cursor: default;
            }

            .wnc-primary,
            .wnc-apply {
                font-weight: 700;
            }

            .wnc-screen {
                padding: 12px;
                background: #171717;
            }

            .wnc-section-heading,
            .wnc-workspace-heading {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 10px;
            }

            .wnc-section-heading h1 {
                margin: 0;
                font-size: 20px;
            }

            .wnc-group-name {
                flex: 1;
                min-width: 200px;
                height: 36px;
                padding: 6px 10px;
                color: #eee;
                background: #111;
                border: 1px solid #555;
                border-radius: 5px;
                font: inherit;
                font-size: 18px;
                font-weight: 700;
            }

            .wnc-back {
                width: 36px;
                height: 36px;
                font-size: 24px;
                line-height: 1;
            }

            .wnc-tabs {
                display: flex;
                gap: 4px;
                margin-bottom: 10px;
            }

            .wnc-tab {
                padding: 7px 14px;
            }

            .wnc-tab.active,
            .wnc-choice.active {
                background: #555;
                border-color: #888;
                font-weight: 700;
            }

            .wnc-table-wrap {
                width: 100%;
                overflow: auto;
                border: 1px solid #444;
                border-radius: 5px;
            }

            .wnc-table {
                width: 100%;
                border-collapse: collapse;
                background: #1d1d1d;
            }

            .wnc-table th,
            .wnc-table td {
                padding: 7px 8px;
                border-bottom: 1px solid #383838;
                text-align: left;
                vertical-align: middle;
                white-space: nowrap;
            }

            .wnc-table th {
                background: #292929;
                font-weight: 700;
                user-select: none;
            }

            .wnc-table th[data-action] {
                cursor: pointer;
            }

            .wnc-table th[data-action]:hover {
                background: #3a3a3a;
            }

            .wnc-clickable-row {
                cursor: pointer;
            }

            .wnc-clickable-row:hover td {
                background: #292929;
            }

            .wnc-unmatched-row td {
                background: #202020;
                font-weight: 700;
            }

            .wnc-number {
                text-align: right !important;
                font-variant-numeric: tabular-nums;
            }

            .wnc-center {
                text-align: center !important;
            }

            .wnc-cell-input {
                width: auto;
                min-width: 0;
                height: 30px;
                padding: 4px 7px;
                color: #eee;
                background: #111;
                border: 1px solid #444;
                border-radius: 4px;
                font: inherit;
            }
            .wnc-unmatched-table {
                 width: auto;
            }
            .wnc-cell-input:focus {
                border-color: #888;
                outline: none;
            }

            .wnc-choice-group {
                display: inline-flex;
                gap: 3px;
                white-space: nowrap;
            }

            .wnc-choice {
                min-height: 30px;
                padding: 4px 9px;
            }

            .wnc-delete {
                width: 30px;
                height: 30px;
                font-size: 18px;
                line-height: 1;
            }

            .wnc-delete:hover {
                background: #5a3030;
            }

            .wnc-add-row td {
                padding: 9px;
                text-align: center;
                background: #181818;
            }

            .wnc-add-button {
                padding: 6px 12px;
            }

            .wnc-empty {
                padding: 18px !important;
                text-align: center !important;
                opacity: 0.65;
            }

            .wnc-site-status,
            .wnc-site-match {
                text-align: center !important;
            }

            .wnc-check {
                font-weight: 700;
            }

            .wnc-cross {
                opacity: 0.7;
            }

            .wnc-collapse-row {
                cursor: pointer;
            }

            .wnc-collapse-row td {
                background: #252525;
                font-weight: 700;
            }

            .wnc-collapse-arrow {
                display: inline-block;
                width: 20px;
            }

            .wnc-collapse-count {
                margin-left: 8px;
                opacity: 0.7;
            }

            .wnc-unmatched-controls {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-wrap: wrap;
                margin-bottom: 10px;
                padding: 10px;
                background: #222;
                border: 1px solid #444;
                border-radius: 5px;
            }

            .wnc-control-select {
                min-width: 180px;
                height: 34px;
                padding: 5px 8px;
                color: #eee;
                background: #111;
                border: 1px solid #555;
                border-radius: 5px;
                font: inherit;
            }

            .wnc-control-select:focus {
                outline: none;
                border-color: #888;
            }

            .wnc-group-options {
                margin-top: 10px;
                max-width: 500px;
            }

            .wnc-html-button {
                min-width: 110px;
                padding: 5px 10px;
            }

            input[type="checkbox"] {
                width: 17px;
                height: 17px;
                cursor: pointer;
            }

            @media (max-width: 900px) {
                .wnc-header {
                    align-items: flex-start;
                }

                .wnc-header-actions {
                    flex-direction: column;
                    align-items: stretch;
                }

                .wnc-search {
                    width: 100%;
                }
            }
        `;

        document.head.appendChild(style);
    }

    function mount() {
        const existing = document.getElementById("wnc-root");

        if (existing) {
            existing.remove();
        }

        const root = document.createElement("div");
        root.id = "wnc-root";

        root.innerHTML = `
            <div class="wnc-shell">
            
                <header class="wnc-header">
                    <div class="wnc-brand">WNC</div>

                    <div class="wnc-header-actions">
                        <input
                            id="wnc-search"
                            class="wnc-search"
                            type="search"
                            placeholder="Group..."
                            autocomplete="off"
                            spellcheck="false"
                            value="${escapeHTML(state.searchQuery)}"
                        >

                        <button
                            class="wnc-button"
                            data-action="import"
                            title="Import"
                        >Imp</button>

                        <button
                            class="wnc-button"
                            data-action="export"
                            title="Export"
                        >Exp</button>

                        <button
                            class="wnc-button"
                            data-action="close"
                            title="Close"
                        >×</button>

                        <input
                            id="wnc-import-file"
                            type="file"
                            accept=".json,application/json"
                            hidden
                        >
                    </div>
                </header>
                <main id="wnc-content"></main>
            </div>
        `;

        document.documentElement.appendChild(root);

        injectStyles();

        root.addEventListener("click", handleClick);
root.addEventListener("change", handleChange);
root.addEventListener("input", handleInput);

scanCandidates();
render();
    }

    // ---------------------------------------------------------------------
    // Rendering
    // ---------------------------------------------------------------------

    function render() {
        const content = document.getElementById("wnc-content");

        if (!content) {
            return;
        }

        if (state.screen === "groups") {
            renderGroups(content);
            return;
        }

        if (state.screen === "group") {
            renderGroup(content);
            return;
        }

        if (state.screen === "unmatched") {
            renderUnmatched(content);
        }
    }

    // ---------------------------------------------------------------------
    // Groups screen
    // ---------------------------------------------------------------------

function findTopCandidateForGroup(group, text) {
    let top = null;

    for (const rule of group.substitutions) {
        if (!rule.enabled || !rule.input) {
            continue;
        }

        const regex = buildRuleRegex(rule);

        if (!regex) {
            continue;
        }

        const counts = new Map();

        while (true) {
            const match = regex.exec(text);

            if (!match) {
                break;
            }

            const candidate = match[0];

            if (candidate) {
                const total = (counts.get(candidate) || 0) + 1;

                counts.set(candidate, total);

                if (
                    !top ||
                    total > top.total ||
                    (
                        total === top.total &&
                        candidate.localeCompare(
                            top.candidate,
                            undefined,
                            { sensitivity: "base" }
                        ) < 0
                    )
                ) {
                    top = {
                        candidate,
                        replace: rule.input,
                        with: rule.output,
                        total
                    };
                }
            }

            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }
    }

    return top;
}

function renderGroups(content) {
    const query = state.searchQuery.trim().toLowerCase();
    const pageText = getPageText();

    const groups = sortedGroups()
        .map(({ group, index }) => {
            const ruleMatches = group.substitutions
                .map(rule => ({
                    rule,
                    matches: rule.enabled
                        ? countRuleMatches(rule, pageText)
                        : 0
                }))
                .filter(item => item.matches > 0);

            const matches = ruleMatches.reduce(
                (total, item) => total + item.matches,
                0
            );

            const ruleCount = ruleMatches.length;
            const siteMatches = groupMatchesCurrentSite(group);

            const searchMatch =
                !query ||
                group.name.toLowerCase().includes(query) ||
                group.substitutions.some(rule =>
                    String(rule.input)
                        .toLowerCase()
                        .includes(query)
                );

            return {
                group,
                index,
                ruleCount,
                matches,
                siteMatches,
                searchMatch
            };
        })
        .filter(item => item.searchMatch);

    const activeGroups = groups.filter(item =>
        item.group.enabled &&
        (item.matches > 0 || item.siteMatches)
    );

    const otherGroups = groups.filter(item =>
        !item.group.enabled ||
        (item.matches === 0 && !item.siteMatches)
    );

    const rows = activeGroups.map(item => {
        const {
            group,
            index,
            ruleCount,
            matches,
            siteMatches
        } = item;

        const topCandidate =
            findTopCandidateForGroup(
                group,
                pageText
            );

        return `
            <tr
                class="wnc-clickable-row"
                data-action="open-group"
                data-group-index="${index}"
            >
                <td>
                    ${escapeHTML(group.name || "(Unnamed)")}
                </td>

                <td class="wnc-number">
                    ${ruleCount}
                </td>

                <td class="wnc-number">
                    ${matches}
                </td>

                <td class="wnc-site-status">
                    ${
                        siteMatches
                            ? `<span class="wnc-check">✓</span>`
                            : `<span class="wnc-cross">✕</span>`
                    }
                </td>

                <td>
                    ${
                        topCandidate
                            ? escapeHTML(topCandidate.candidate)
                            : "—"
                    }
                </td>

                <td>
                    ${
                        topCandidate
                            ? escapeHTML(topCandidate.replace)
                            : "—"
                    }
                </td>

                <td>
                    ${
                        topCandidate
                            ? escapeHTML(topCandidate.with)
                            : "—"
                    }
                </td>

                <td class="wnc-number">
                    ${
                        topCandidate
                            ? topCandidate.total
                            : 0
                    }
                </td>
            </tr>
        `;
    }).join("");

    const otherRows = otherGroups.map(item => {
        const {
            group,
            index
        } = item;

        return `
            <tr
                class="wnc-clickable-row"
                data-action="open-group"
                data-group-index="${index}"
            >
                <td>
                    ${escapeHTML(group.name || "(Unnamed)")}
                </td>

                <td class="wnc-number">0</td>

                <td class="wnc-number">0</td>

                <td class="wnc-site-status">
                    <span class="wnc-cross">✕</span>
                </td>

                <td>—</td>

                <td>—</td>

                <td>—</td>

                <td class="wnc-number">0</td>
            </tr>
        `;
    }).join("");

    const otherSection = otherGroups.length
        ? `
            <tr
                class="wnc-collapse-row"
                data-action="toggle-other-groups"
            >
                <td colspan="8">
                    <span class="wnc-collapse-arrow">
                        ${state.showOtherGroups ? "▼" : "▶"}
                    </span>

                    Other Groups

                    <span class="wnc-collapse-count">
                        ${otherGroups.length}
                    </span>
                </td>
            </tr>

            ${
                state.showOtherGroups
                    ? otherRows
                    : ""
            }
        `
        : "";

    content.innerHTML = `
        <section class="wnc-screen">

            <div class="wnc-section-heading">
                <h1>Groups</h1>
            </div>

            <div class="wnc-table-wrap wnc-groups-table-wrap">
                <table class="wnc-table wnc-groups-table">

                    <thead>
                        <tr>
                            <th>Group</th>
                            <th>R#</th>
                            <th>M#</th>
                            <th>S</th>
                            <th>Candidate</th>
                            <th>Replace</th>
                            <th>With</th>
                            <th>T#</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${
                            rows || !otherSection
                                ? rows
                                : ""
                        }

                        ${
                            !rows && !otherSection
                                ? `
                                    <tr>
                                        <td
                                            colspan="8"
                                            class="wnc-empty"
                                        >
                                            No groups
                                        </td>
                                    </tr>
                                `
                                : ""
                        }

                        ${otherSection}

                        <tr
                            class="wnc-clickable-row wnc-unmatched-row"
                            data-action="open-unmatched"
                        >
                            <td>Candidate</td>

                            <td></td>

                            <td></td>

                            <td></td>

                            <td></td>

                            <td></td>

                            <td></td>

                            <td class="wnc-number">
                                ${state.candidates.length}
                            </td>
                        </tr>
                    </tbody>

                </table>
            </div>

        </section>
    `;
}

    // ---------------------------------------------------------------------
    // Group workspace
    // ---------------------------------------------------------------------

    function renderGroup(content) {
        const group = db.groups[state.groupIndex];

        if (!group) {
            state.screen = "groups";
            render();
            return;
        }

        content.innerHTML = `
            <section class="wnc-screen">
                <div class="wnc-workspace-heading">
                    <button
                        class="wnc-back"
                        data-action="back-groups"
                        title="Back"
                    >‹</button>

                   <input
    class="wnc-group-name"
    data-field="group-name"
    value="${escapeHTML(group.name || "")}"
    placeholder="Group name"
>
                </div>

                <div class="wnc-tabs">
                    <button
                        class="wnc-tab ${
                            state.tab === "rules" ? "active" : ""
                        }"
                        data-action="group-tab"
                        data-tab="rules"
                    >Rules</button>

                    <button
                        class="wnc-tab ${
                            state.tab === "sites" ? "active" : ""
                        }"
                        data-action="group-tab"
                        data-tab="sites"
                    >Sites</button>
                </div>

                <div id="wnc-group-workspace"></div>
            </section>
        `;

        const workspace =
            document.getElementById("wnc-group-workspace");

        if (state.tab === "rules") {
            renderRules(workspace, group);
        } else {
            renderSites(workspace, group);
        }
    }

    // ---------------------------------------------------------------------
    // Rules tab
    // ---------------------------------------------------------------------

    function renderRules(container, group) {
        const text = getPageText();

          const rows = group.substitutions.map((rule, index) => {
            const matches = countRuleMatches(rule, text);

            return `
                <tr data-rule-index="${index}">
                    <td>
                        <input
                            class="wnc-cell-input"
                            data-field="input"
                            value="${escapeHTML(rule.input)}"
                        >
                    </td>

                    <td>
                        <input
                            class="wnc-cell-input"
                            data-field="output"
                            value="${escapeHTML(rule.output)}"
                        >
                    </td>

                    <td>
                        <div class="wnc-choice-group wnc-rule-type">
                            <button
                                type="button"
                                class="wnc-choice ${
                                    rule.inputType === "text"
                                        ? "active"
                                        : ""
                                }"
                                data-action="rule-type"
                                data-rule-index="${index}"
                                data-type="text"
                            >Text</button>

                            <button
                                type="button"
                                class="wnc-choice ${
                                    rule.inputType === "whole"
                                        ? "active"
                                        : ""
                                }"
                                data-action="rule-type"
                                data-rule-index="${index}"
                                data-type="whole"
                            >Whole</button>

                            <button
                                type="button"
                                class="wnc-choice ${
                                    rule.inputType === "regexp"
                                        ? "active"
                                        : ""
                                }"
                                data-action="rule-type"
                                data-rule-index="${index}"
                                data-type="regexp"
                            >Regex</button>
                        </div>
                    </td>

                    <td class="wnc-center">
                        <button
                            type="button"
                            class="wnc-choice"
                            data-action="rule-output-type"
                            data-rule-index="${index}"
                        >${
                            Number(rule.outputType) === 1
                                ? "Function"
                                : "Text"
                        }</button>
                    </td>

                    <td class="wnc-center">
                        <input
                            type="checkbox"
                            data-field="caseSensitive"
                            ${rule.caseSensitive ? "checked" : ""}
                        >
                    </td>

                    <td class="wnc-center">
                        <input
                            type="checkbox"
                            data-field="enabled"
                            ${rule.enabled ? "checked" : ""}
                        >
                    </td>

                    <td class="wnc-number">
                        ${matches}
                    </td>

                    <td class="wnc-delete-cell">
                        <button
                            class="wnc-delete"
                            data-action="delete-rule"
                            data-rule-index="${index}"
                            title="Delete rule"
                        >×</button>
                    </td>
                </tr>
            `;
        }).join("");

        container.innerHTML = `
            <div class="wnc-table-wrap">
                <table class="wnc-table wnc-rules-table">
                    <thead>
    <tr>
<th
    data-action="sort-rules"
    data-sort-field="input"
>Replace</th>

<th
    data-action="sort-rules"
    data-sort-field="output"
>With</th>

        <th
            data-action="sort-rules"
            data-sort-field="inputType"
        >Type</th>

        <th>Output</th>

        <th
            data-action="sort-rules"
            data-sort-field="caseSensitive"
        >Case</th>

<th
    data-action="sort-rules"
    data-sort-field="enabled"
>Enable</th>

        <th
            data-action="sort-rules"
            data-sort-field="matches"
        >Matches</th>

        <th></th>
    </tr>
</thead>

                    <tbody>
                        ${rows || `
                            <tr>
                                <td colspan="8" class="wnc-empty">
                                    No rules in this group
                                </td>
                            </tr>
                        `}

                        <tr class="wnc-add-row">
                            <td colspan="8">
                                <button
                                    class="wnc-add-button"
                                    data-action="add-rule"
                                >+ Add rule</button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    // ---------------------------------------------------------------------
    // Sites tab
    // ---------------------------------------------------------------------

    function renderSites(container, group) {
    const rows = group.urls.map((url, index) => `
        <tr>
            <td>
                <input
                    class="wnc-cell-input"
                    data-site-index="${index}"
                    data-field="url"
                    value="${escapeHTML(url)}"
                >
            </td>

            <td class="wnc-site-match">
                ${
                    urlPatternMatches(url)
                        ? `<span class="wnc-check">✓</span>`
                        : `<span class="wnc-cross">✕</span>`
                }
            </td>

            <td class="wnc-delete-cell">
                <button
                    class="wnc-delete"
                    data-action="delete-site"
                    data-site-index="${index}"
                    title="Delete URL"
                >×</button>
            </td>
        </tr>
    `).join("");

    container.innerHTML = `
        <div class="wnc-table-wrap">
            <table class="wnc-table wnc-sites-table">

                <thead>
                    <tr>
                        <th>URL Pattern</th>
                        <th>Current Site</th>
                        <th></th>
                    </tr>
                </thead>

                <tbody>
                    ${
                        rows || `
                            <tr>
                                <td colspan="3" class="wnc-empty">
                                    No URL patterns
                                </td>
                            </tr>
                        `
                    }

                    <tr class="wnc-add-row">
                        <td colspan="3">
                            <button
                                class="wnc-add-button"
                                data-action="add-site"
                            >+ Add URL pattern</button>
                        </td>
                    </tr>
                </tbody>

            </table>
        </div>

        <div class="wnc-group-options">
            <table class="wnc-table">
                <tbody>

                    <tr>
                        <td>Enabled</td>
                        <td>
                            <input
                                type="checkbox"
                                data-group-field="enabled"
                                ${group.enabled ? "checked" : ""}
                            >
                        </td>
                    </tr>

                    <tr>
                        <td>Page Load</td>
                        <td>
                            <input
                                type="checkbox"
                                data-group-field="pageLoad"
                                ${group.pageLoad ? "checked" : ""}
                            >
                        </td>
                    </tr>

                    <tr>
                        <td>Auto</td>
                        <td>
                            <input
                                type="checkbox"
                                data-group-field="auto"
                                ${group.auto ? "checked" : ""}
                            >
                        </td>
                    </tr>

                    <tr>
                        <td>HTML</td>
                        <td>
                            <button
                                type="button"
                                class="wnc-html-button"
                                data-action="cycle-group-html"
                            >${escapeHTML(getHTMLModeLabel(group.html))}</button>
                        </td>
                    </tr>

                </tbody>
            </table>
        </div>
    `;
}

    // ---------------------------------------------------------------------
// Candidate screen
    // ---------------------------------------------------------------------

    function renderUnmatched(content) {
    if (!state.unmatchedInitialized) {
        scanCandidates();
    }

        const groups = sortedGroups();

        const targetOptions = groups.map(({ group, index }) => `
            <option
                value="${index}"
                ${
                    state.targetGroup === index
                        ? "selected"
                        : ""
                }
            >${escapeHTML(group.name || "(Unnamed)")}</option>
        `).join("");

        const rows = state.candidates.map((item, index) => `
            <tr data-candidate-index="${index}">
                <td class="wnc-check-cell">
                    <input
                        type="checkbox"
                        data-candidate-check="${index}"
                        ${
                            state.selectedCandidates.has(index)
                                ? "checked"
                                : ""
                        }
                    >
                </td>

                <td>
                    <input
                        class="wnc-cell-input"
                        data-candidate-field="candidate"
                        data-candidate-index="${index}"
                        value="${escapeHTML(item.candidate)}"
                    >
                </td>

                <td>
                    <input
                        class="wnc-cell-input"
                        data-candidate-field="input"
                        data-candidate-index="${index}"
                        value="${escapeHTML(item.input)}"
                    >
                </td>

                <td>
                    <input
                        class="wnc-cell-input"
                        data-candidate-field="output"
                        data-candidate-index="${index}"
                        value="${escapeHTML(item.output)}"
                    >
                </td>

                <td class="wnc-number">
                    ${item.matches}
                </td>
            </tr>
        `).join("");

        content.innerHTML = `
            <section class="wnc-screen">

                <div class="wnc-unmatched-controls">

                    <button
                        class="wnc-button"
                        data-action="groups"
                    >Groups</button>

                    <select
                        class="wnc-control-select"
                        data-unmatched-control="targetGroup"
                        ${
                            groups.length
                                ? ""
                                : "disabled"
                        }
                    >
                        ${
                            groups.length
                                ? targetOptions
                                : `<option>No groups</option>`
                        }
                    </select>

     <button
    type="button"
    class="wnc-choice"
    data-action="unmatched-type-cycle"
>${state.candidateType === "text" ? "Txt" : state.candidateType === "whole" ? "Wh" : "Rx"}</button>

                    <div class="wnc-choice-group">
                        <button
                            type="button"
                            class="wnc-choice ${
                                state.candidateTemplate === "Korean"
                                    ? "active"
                                    : ""
                            }"
                            data-action="unmatched-template"
                            data-template="Korean"
                            ${
                                state.candidateType !== "regexp"
                                    ? "disabled"
                                    : ""
                            }
                        >Korean</button>

                        <button
                            type="button"
                            class="wnc-choice ${
                                state.candidateTemplate === "Japanese"
                                    ? "active"
                                    : ""
                            }"
                            data-action="unmatched-template"
                            data-template="Japanese"
                            ${
                                state.candidateType !== "regexp"
                                    ? "disabled"
                                    : ""
                            }
                        >Japanese</button>

                        <button
                            type="button"
                            class="wnc-choice ${
                                state.candidateTemplate === "Other"
                                    ? "active"
                                    : ""
                            }"
                            data-action="unmatched-template"
                            data-template="Other"
                            ${
                                state.candidateType !== "regexp"
                                    ? "disabled"
                                    : ""
                            }
                        >Other</button>
                    </div>

                    <div class="wnc-choice-group">
                        <button
                            type="button"
                            class="wnc-choice ${
                                !state.candidateCaseSensitive
                                    ? "active"
                                    : ""
                            }"
                            data-action="unmatched-case"
                            data-case="false"
                        >No</button>

                        <button
                            type="button"
                            class="wnc-choice ${
                                state.candidateCaseSensitive
                                    ? "active"
                                    : ""
                            }"
                            data-action="unmatched-case"
                            data-case="true"
                        >Yes</button>
                    </div>

                    <button
                        class="wnc-button wnc-apply"
                        data-action="apply"
                        ${
                            !groups.length
                                ? "disabled"
                                : ""
                        }
                    >A</button>

                </div>

                <div class="wnc-table-wrap">
                    <table class="wnc-table wnc-unmatched-table">
                        <thead>
                            <tr>
                                <th>A</th>
                                <th>Candidate</th>
                                <th>Input</th>
                                <th>Output</th>
                                <th>#</th>
                            </tr>
                        </thead>

                        <tbody>
                            ${
                                rows || `
                                    <tr>
                                        <td
                                            colspan="5"
                                            class="wnc-empty"
                                        >
                                            No candidates
                                        </td>
                                    </tr>
                                `
                            }
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------
function updateCandidateTemplate() {
    if (state.candidateType !== "regexp") {
        return;
    }
    for (const candidate of state.candidates) {
        if (!candidate._inputEdited) {
            if (state.candidateTemplate === "Japanese") {
                const pattern = generateJapanesePattern(
                    tokenizeCandidate(candidate.candidate)
                );
                candidate.input = pattern.input;
                candidate.output = pattern.output;
            } else {
                candidate.input = generateTemplateInput(
                    candidate.candidate,
                    state.candidateTemplate
                );
            }
        }
    }
}
function handleClick(event) {
const target = event.target.closest("[data-action]");
if (!target) {
    return;
}

const action = target.dataset.action;

switch (action) {
    case "sort-rules":
    sortRulesByHeader(
        target.dataset.sortField
    );
    break;
    case "rule-type":
        setRuleType(
            Number(target.dataset.ruleIndex),
            target.dataset.type
        );
        break;

    case "rule-output-type":
        toggleRuleOutputType(
            Number(target.dataset.ruleIndex)
        );
        break;

case "unmatched-type-cycle":
    state.candidateType =
        state.candidateType === "text"
            ? "whole"
            : state.candidateType === "whole"
                ? "regexp"
                : "text";

    if (state.candidateType === "text" ||
        state.candidateType === "whole") {
        for (const candidate of state.candidates) {
            if (!candidate._inputEdited) {
                candidate.input = candidate.candidate;
            }
            candidate.output = candidate.candidate;
        }
    } else {
        updateCandidateTemplate();
    }

    render();
    break;

case "unmatched-template":
    state.candidateTemplate = target.dataset.template;
    updateCandidateTemplate();
    render();
    break;
        
    case "unmatched-case":
        handleUnmatchedControl(target);
        break;

    case "create-group":
        createGroup();
        break;

    case "import":
        document
            .getElementById("wnc-import-file")
            ?.click();
        break;

    case "export":
        exportDatabase();
        break;

    case "close":
    document.getElementById("wnc-root")?.remove();
    break;

    case "open-group":
        openGroup(
            Number(target.dataset.groupIndex)
        );
        break;

    case "open-unmatched":
        openUnmatched();
        break;

    case "groups":
        state.screen = "groups";
        state.groupIndex = null;
        render();
        break;

    case "toggle-other-groups":
        state.showOtherGroups =
            !state.showOtherGroups;
        render();
        break;

    case "back-groups":
        state.screen = "groups";
        state.groupIndex = null;
        render();
        break;

    case "group-tab":
        state.tab = target.dataset.tab;
        render();
        break;
case "cycle-group-html":
    cycleGroupHTML();
    break;
    case "add-rule":
        addRule();
        break;

    case "delete-rule":
        deleteRule(
            Number(target.dataset.ruleIndex)
        );
        break;

    case "add-site":
        addSite();
        break;

    case "delete-site":
        deleteSite(
            Number(target.dataset.siteIndex)
        );
        break;

    case "apply":
        applyCandidates();
        break;
    }
}

function handleChange(event) {
        const target = event.target;

        // Unmatched target group.
        if (
            target.matches(
                '[data-unmatched-control="targetGroup"]'
            )
        ) {
            handleUnmatchedControl(target);
            return;
        }
        // Import.
        if (target.id === "wnc-import-file") {
            importFile(target.files?.[0]);
            target.value = "";
            return;
        }

        // Candidate checkboxes.
        if (target.matches("[data-candidate-check]")) {
            const index = Number(target.dataset.candidateCheck);

            if (target.checked) {
                state.selectedCandidates.add(index);
            } else {
                state.selectedCandidates.delete(index);
            }

            return;
        }

        // Existing rule fields.
        if (target.matches("[data-field]")) {
            handleRuleField(target);
            return;
        }

        // Site fields.
        if (target.matches("[data-site-index]")) {
            handleSiteField(target);
            return;
        }

        // Group options.
        if (target.matches("[data-group-field]")) {
            handleGroupField(target);
        }
    }
function handleInput(event) {
    const target = event.target;

    if (target.matches(".wnc-group-name")) {
        const group = db.groups[state.groupIndex];

        if (group) {
            group.name = target.value;
            saveDatabase();
        }

        return;
    }

        if (target.id === "wnc-search") {
            state.searchQuery = target.value;

            if (state.screen === "groups") {
                const cursorStart = target.selectionStart;
                const cursorEnd = target.selectionEnd;

                const content =
                    document.getElementById("wnc-content");

                if (content) {
                    renderGroups(content);
                }

                requestAnimationFrame(() => {
                    const search =
                        document.getElementById("wnc-search");

                    if (search) {
                        search.focus();
                        search.setSelectionRange(
                            cursorStart,
                            cursorEnd
                        );
                    }
                });
            }

            return;
        }

        if (target.matches("[data-candidate-field]")) {
            const index =
                Number(target.dataset.candidateIndex);

            const field =
                target.dataset.candidateField;

            if (!state.candidates[index]) {
                return;
            }

            state.candidates[index][field] = target.value;

            /*
             * IMPORTANT:
             *
             * If the user manually changes the Input column, remember that
             * the generated regexp template must not overwrite that edit.
             */
            if (field === "input") {
                state.candidates[index]._inputEdited = true;
            }

            /*
             * Candidate edits are deliberately not written to the database.
 * Candidate is transient WNC state.
             */
            return;
        }

        if (target.matches("[data-field]")) {
            handleRuleField(target);
            return;
        }

        if (target.matches("[data-site-index]")) {
            handleSiteField(target);
        }
    }
    function handleUnmatchedControl(target) {
        const control =
            target.dataset.unmatchedControl ||
            target.dataset.action;

        switch (control) {
            case "targetGroup":
                state.targetGroup = Number(target.value);
                break;

            case "unmatched-type":
                if (
                    !["text", "whole", "regexp"].includes(
                        target.dataset.type
                    )
                ) {
                    return;
                }

                state.candidateType =
                    target.dataset.type;

                if (state.candidateType !== "regexp") {
                    state.candidateTemplate = "Other";
                }
                break;

            case "unmatched-template":
                if (
                    state.candidateType !== "regexp" ||
                    !["Korean", "Japanese", "Other"].includes(
                        target.dataset.template
                    )
                ) {
                    return;
                }

                state.candidateTemplate =
                    target.dataset.template;
                break;

            case "unmatched-case":
                state.candidateCaseSensitive =
                    target.dataset.case === "true";
                break;

            default:
                return;
        }

        render();
    }

    function setRuleType(index, type) {
        const group = db.groups[state.groupIndex];

        if (!group || !group.substitutions[index]) {
            return;
        }

        if (!["text", "whole", "regexp"].includes(type)) {
            return;
        }

        group.substitutions[index].inputType = type;

        saveDatabase();
        render();
    }

    function toggleRuleOutputType(index) {
        const group = db.groups[state.groupIndex];

        if (!group || !group.substitutions[index]) {
            return;
        }

        group.substitutions[index].outputType =
            Number(group.substitutions[index].outputType) === 1
                ? 0
                : 1;

        saveDatabase();
        render();
    }
    // ---------------------------------------------------------------------
    // Group actions
    // ---------------------------------------------------------------------

    function createGroup() {
        const group = createNativeGroup();

        let number = 1;
        let name = "New Group";

        while (
            db.groups.some(
                existing => existing.name === name
            )
        ) {
            number++;
            name = `New Group ${number}`;
        }

        group.name = name;

        db.groups.push(group);

        saveDatabase();

        /*
         * Open the new group immediately.
         */
        state.groupIndex = db.groups.length - 1;
        state.screen = "group";
        state.tab = "rules";

        render();
    }

    function openGroup(index) {
        if (!db.groups[index]) {
            return;
        }

        state.groupIndex = index;
        state.screen = "group";
        state.tab = "rules";

        render();
    }

    function openUnmatched() {
        state.screen = "unmatched";

    /*
     * Always rescan when entering Candidate so the list reflects the
     * current page and current FoxReplace database.
     */
        scanCandidates();

        render();
    }

    // ---------------------------------------------------------------------
    // Rule actions
    // ---------------------------------------------------------------------

    function addRule() {
    const group = db.groups[state.groupIndex];

    if (!group) {
        return;
    }

    const rule = createNativeRule();

    group.substitutions.push(rule);

    const newRuleIndex =
        group.substitutions.length - 1;

    saveDatabase();
    render();

    requestAnimationFrame(() => {
        const row = document.querySelector(
            `.wnc-rules-table tbody tr[data-rule-index="${newRuleIndex}"]`
        );

        row
            ?.querySelector('[data-field="input"]')
            ?.focus();
    });
}

    function deleteRule(index) {
        const group = db.groups[state.groupIndex];

        if (!group || !group.substitutions[index]) {
            return;
        }

        group.substitutions.splice(index, 1);

        saveDatabase();
        render();
    }

    function handleRuleField(target) {
        const group = db.groups[state.groupIndex];

        if (!group) {
            return;
        }

        const row = target.closest("tr");

        if (!row) {
            return;
        }

        const index = Number(row.dataset.ruleIndex);

        if (!group.substitutions[index]) {
            return;
        }

        const rule = group.substitutions[index];
        const field = target.dataset.field;

        if (target.type === "checkbox") {
            rule[field] = target.checked;
        } else {
            rule[field] = target.value;
        }

        saveDatabase();

        /*
         * Rule visibility depends on matching the current page.
         * Re-render after the user leaves an Input field rather than during
         * every keystroke.
         */
        if (
            field === "input" ||
            field === "inputType" ||
            field === "caseSensitive" ||
            field === "enabled"
        ) {
            /*
             * Do not immediately re-render text input while the user is typing.
             * The database is already updated. The next explicit UI action
             * refreshes the visible match list.
             */
        }
    }

    // ---------------------------------------------------------------------
    // Site actions
    // ---------------------------------------------------------------------

    function addSite() {
        const group = db.groups[state.groupIndex];

        if (!group) {
            return;
        }

        group.urls.push("");

        saveDatabase();
        render();
    }

    function deleteSite(index) {
        const group = db.groups[state.groupIndex];

        if (!group || index < 0 || index >= group.urls.length) {
            return;
        }

        group.urls.splice(index, 1);

        saveDatabase();
        render();
    }

    function handleSiteField(target) {
        const group = db.groups[state.groupIndex];

        if (!group) {
            return;
        }

        const index = Number(target.dataset.siteIndex);

        if (index < 0 || index >= group.urls.length) {
            return;
        }

        group.urls[index] = target.value;

        saveDatabase();
    }

    function handleGroupField(target) {
        const group = db.groups[state.groupIndex];

        if (!group) {
            return;
        }

        const field = target.dataset.groupField;

        group[field] = target.checked;

        saveDatabase();
    }

    // ---------------------------------------------------------------------
    // Apply
    // ---------------------------------------------------------------------

    function applyCandidates() {
        const group = db.groups[state.targetGroup];

        if (!group) {
            return;
        }

        const indexes = [...state.selectedCandidates]
            .sort((a, b) => b - a);

        if (!indexes.length) {
            return;
        }

        for (const index of indexes) {
            const candidate = state.candidates[index];

            if (!candidate) {
                continue;
            }
            let input = String(candidate.input ?? "");
            const output = String(candidate.output ?? "");

            /*
             * If regexp is selected, the template provides the initial
             * generated Input only when the user has not already edited it.
             *
             * The actual Input column is authoritative.
             */
            if (
                state.candidateType === "regexp" &&
                !candidate._inputEdited
            ) {
                input = generateTemplateInput(
                    candidate.candidate,
                    state.candidateTemplate
                );
            }

            if (!input.trim()) {
                continue;
            }

            const rule = createNativeRule();

            rule.input = input;
            rule.output = output;
            rule.inputType = state.candidateType;
            rule.caseSensitive =
                state.candidateCaseSensitive;
            rule.enabled = true;

            group.substitutions.push(rule);

        /*
         * Remove from Candidate.
         */
            state.candidates.splice(index, 1);
        }

        state.selectedCandidates.clear();

        saveDatabase();

        /*
          * Return to the refreshed Candidate spreadsheet.
         */
        state.screen = "unmatched";

        /*
         * Do not scan immediately because the candidate list is already
         * updated and should not unexpectedly reintroduce rows during this
         * operation.
         */
        render();
    }

    // ---------------------------------------------------------------------
    // Import
    // ---------------------------------------------------------------------

     function importFile(file) {
        if (!file) {
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {
            try {
                const text = String(reader.result || "");
                const parsed = JSON.parse(text);

                const validated = normalizeDatabase(parsed);

                if (!validated) {
                    alert(
                        "Invalid FoxReplace JSON.\n\n" +
                        "The file must contain a FoxReplace database with a groups array.\n\n" +
                        "The current WNC database was not changed."
                    );

                    return;
                }

                db = validated;

                saveDatabase();

                /*
                 * Import replaces the canonical FoxReplace database.
                 * Candidate remains transient.
                 */
                state.candidates = [];
                state.selectedCandidates.clear();
                state.unmatchedInitialized = false;

                state.screen = "groups";
                state.groupIndex = null;
                state.tab = "rules";

                render();

            } catch (error) {
                console.error("WNC import error:", error);

                alert(
                    "The JSON file could not be imported.\n\n" +
                    "The current WNC database was not changed."
                );
            }
        };

        reader.onerror = () => {
            console.error(
                "WNC import read error:",
                reader.error
            );

            alert(
                "The JSON file could not be read.\n\n" +
                "The current WNC database was not changed."
            );
        };

        reader.readAsText(file);
    }

    // ---------------------------------------------------------------------
    // Export
    // ---------------------------------------------------------------------

    function exportDatabase() {
        const exported = {
            ...db,
            groups: db.groups.map(group => ({
                ...group,
                urls: Array.isArray(group.urls)
                    ? [...group.urls]
                    : [],
                substitutions: Array.isArray(group.substitutions)
                    ? group.substitutions.map(rule => ({
                        ...rule,
                    inputType:
                        rule.inputType === "whole"
                            ? 1
                            : rule.inputType === "regexp"
                                ? 2
                                : 0,
                    outputType:
                        Number(rule.outputType) === 1
                            ? 1
                            : 0
                    }))
                    : []
            }))
        };

        const blob = new Blob(
            [JSON.stringify(exported, null, 2)],
            { type: "application/json" }
        );

        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = "foxreplace.json";

        document.body.appendChild(link);
        link.click();
        link.remove();

        URL.revokeObjectURL(url);
    }
    
GM_registerMenuCommand("Webnovel Cleaner", () => {
    mount();
});

})();
