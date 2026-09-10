// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.0.4
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
        substitutions: []
    };

    const DEFAULT_RULE = {
        input: "",
        output: "",
        inputType: "text",
        caseSensitive: false,
        enabled: true,
        html: "none"
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
        showOtherGroups: false
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
        db = normalizeDatabase(db);
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

        normalized.urls = normalized.urls.map(url => String(url ?? ""));

        if (!Array.isArray(normalized.substitutions)) {
            normalized.substitutions = [];
        }

        normalized.substitutions = normalized.substitutions
            .map(normalizeRule)
            .filter(Boolean);

        normalized.enabled = Boolean(normalized.enabled);
        normalized.pageLoad = Boolean(normalized.pageLoad);
        normalized.auto = Boolean(normalized.auto);

        return normalized;
    }

    function normalizeRule(rule) {
        if (!rule || typeof rule !== "object") {
            return null;
        }

        const normalized = {
            ...DEFAULT_RULE,
            ...rule
        };

        normalized.input = String(normalized.input ?? "");
        normalized.output = String(normalized.output ?? "");
        normalized.inputType = normalized.inputType === "regexp"
            ? "regexp"
            : "text";

        normalized.caseSensitive = Boolean(normalized.caseSensitive);
        normalized.enabled = Boolean(normalized.enabled);

        normalized.html = String(normalized.html ?? "none");

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

    function sortedRules(group) {
        return group.substitutions
            .map((rule, index) => ({ rule, index }))
            .sort((a, b) => compareNames(a.rule.input, b.rule.input));
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

    for (const occurrence of occurrences) {
        const overlaps = selected.some(existing =>
            occurrence.start < existing.end &&
            occurrence.end > existing.start
        );

        if (!overlaps) {
            selected.push(occurrence);
            continue;
        }

        for (let i = selected.length - 1; i >= 0; i--) {
            const existing = selected[i];

            if (
                occurrence.start < existing.end &&
                occurrence.end > existing.start &&
                occurrence.end - occurrence.start >
                    existing.end - existing.start
            ) {
                selected.splice(i, 1);
                selected.push(occurrence);
            }
        }
    }

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
    COMMON_STANDALONE_WORDS.has(candidate.toLowerCase())
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

            if (regex.test(candidate)) {
                return true;
            }

            /*
             * Also test the candidate inside the page context.
             */
            regex.lastIndex = 0;

            if (ruleMatchesText(rule, candidate)) {
                return true;
            }
        }

        return false;
    }

    function scanCandidates() {
        const text = getPageText();

        if (!text) {
            state.candidates = [];
            state.selectedCandidates.clear();
            return;
        }

        const discovered = extractCandidates(text)
            .filter(item => !candidateCoveredByExistingRule(item.candidate));

        state.candidates = clusterAndSortCandidates(discovered);
        state.selectedCandidates.clear();

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
    if (!candidates.length) {
        return [];
    }

    /*
     * Find the highest candidate frequency on the page.
     */
    const maxFrequency = Math.max(
        ...candidates.map(candidate => candidate.matches)
    );

    /*
     * Anything below this frequency is hidden IF it is genuinely
     * unclustered.
     *
     * Example:
     *
     *   max = 59
     *   5%  = 2.95
     *
     * Therefore an unclustered candidate occurring 1 or 2 times
     * is hidden, while one occurring 3+ times remains visible.
     */
    const minimumUnclusteredFrequency =
        maxFrequency * UNCLUSTERED_FREQUENCY_RATIO;

    /*
     * Build connected components.
     *
     * This deliberately uses transitive chaining:
     *
     *   Fred
     *      |
     *   Fred Smith
     *      |
     *   Smith John
     *
     * All three become one cluster.
     */
    const visited = new Set();
    const clusters = [];

    for (let i = 0; i < candidates.length; i++) {
        if (visited.has(i)) {
            continue;
        }

        const clusterIndexes = [];
        const queue = [i];

        visited.add(i);

        while (queue.length) {
            const currentIndex = queue.shift();

            clusterIndexes.push(currentIndex);

            for (
                let otherIndex = 0;
                otherIndex < candidates.length;
                otherIndex++
            ) {
                if (visited.has(otherIndex)) {
                    continue;
                }

                if (
                    candidatesShareToken(
                        candidates[currentIndex],
                        candidates[otherIndex]
                    )
                ) {
                    visited.add(otherIndex);
                    queue.push(otherIndex);
                }
            }
        }

        clusters.push(
            clusterIndexes.map(index => candidates[index])
        );
    }

    /*
     * Remove weak genuinely-unclustered candidates.
     *
     * A cluster containing two or more candidates is considered
     * meaningful regardless of the individual frequencies.
     *
     * A one-item cluster is kept only when its frequency reaches
     * the 5% threshold.
     */
    const filteredClusters = clusters.filter(cluster => {
        if (cluster.length > 1) {
            return true;
        }

        return cluster[0].matches >= minimumUnclusteredFrequency;
    });

    /*
     * Sort clusters by their highest-frequency candidate.
     */
    filteredClusters.sort((a, b) => {
        const aMax = Math.max(
            ...a.map(candidate => candidate.matches)
        );

        const bMax = Math.max(
            ...b.map(candidate => candidate.matches)
        );

        if (bMax !== aMax) {
            return bMax - aMax;
        }

        return compareNames(
            a[0].candidate,
            b[0].candidate
        );
    });

    /*
     * Sort candidates inside each cluster by frequency.
     */
    return filteredClusters.flatMap(cluster => {
        return cluster.sort((a, b) => {
            if (b.matches !== a.matches) {
                return b.matches - a.matches;
            }

            return compareNames(
                a.candidate,
                b.candidate
            );
        });
    });
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
            return tokens.join(" ");
        }

        return [
            tokens[tokens.length - 1],
            ...tokens.slice(0, -1)
        ].join(" ");
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

    function cssEscapeSafe(value) {
        if (window.CSS && typeof window.CSS.escape === "function") {
            return window.CSS.escape(String(value));
        }

        return String(value).replace(/[^a-zA-Z0-9_-]/g, "_");
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

    function refresh() {
        saveDatabase();
        render();
    }

    // ---------------------------------------------------------------------
    // Root UI
    // ---------------------------------------------------------------------

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
                            placeholder="Search..."
                            autocomplete="off"
                            spellcheck="false"
                            value="${escapeHTML(state.searchQuery)}"
                        >

                        <button
                            class="wnc-button wnc-primary"
                            data-action="create-group"
                        >Create New Group</button>

                        <button
                            class="wnc-button"
                            data-action="import"
                        >Import</button>

                        <button
                            class="wnc-button"
                            data-action="export"
                        >Export</button>

                        <button
                            class="wnc-button"
                            data-action="close"
                        >Close</button>

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
                const total =
                    (counts.get(candidate) || 0) + 1;

                counts.set(candidate, total);

                if (
                    !top ||
                    total > top.total
                ) {
                    top = {
                        candidate,
                        rule: rule.input,
                        total
                    };
                }
            }

            /*
             * Avoid an infinite loop on zero-length regexes.
             */
            if (match[0].length === 0) {
                regex.lastIndex++;
            }
        }
    }

    return top;
}

    function renderGroups(content) {
        const query = state.searchQuery.trim().toLowerCase();

        const groups = sortedGroups()
            .map(({ group, index }) => {
                const pageText = getPageText();

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
            item.matches > 0 || item.siteMatches
        );

        const otherGroups = groups.filter(item =>
            item.matches === 0 && !item.siteMatches
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
        getPageText()
    );

            return `
                <tr
                    class="wnc-clickable-row"
                    data-action="open-group"
                    data-group-index="${index}"
                >
                    <td>${escapeHTML(group.name || "(Unnamed)")}</td>

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
                                ? escapeHTML(topCandidate.rule)
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
            <td>${escapeHTML(group.name || "(Unnamed)")}</td>

            <td class="wnc-number">0</td>

            <td class="wnc-number">0</td>

            <td class="wnc-site-status">
                <span class="wnc-cross">✕</span>
            </td>

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
                    <td colspan="4">
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

                <div class="wnc-table-wrap">
                    <table class="wnc-table">
                      <thead>
    <tr>
        <th>Group</th>
        <th>Rules</th>
        <th>Matches</th>
        <th>Sites</th>
        <th>Top Candidate</th>
        <th>Rule</th>
        <th>Total</th>
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
                                                colspan="4"
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
                                <td>Unmatched</td>
                                <td></td>
                                <td class="wnc-number">
                                    ${state.candidates.length}
                                </td>
                                <td></td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>
        `;
    }

    function countGroupMatches(group) {
        const text = getPageText();

        if (!text) {
            return 0;
        }

        let total = 0;

        for (const rule of group.substitutions) {
            if (!rule.enabled) {
                continue;
            }

            total += countRuleMatches(rule, text);
        }

        return total;
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

                    <h1>${escapeHTML(group.name || "(Unnamed)")}</h1>
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

        const visibleRules = sortedRules(group)
            .filter(({ rule }) => {
                if (!rule.enabled || !rule.input) {
                    return false;
                }

                return ruleMatchesText(rule, text);
            });

        const rows = visibleRules.map(({ rule, index }) => {
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
                        <select
                            class="wnc-cell-select"
                            data-field="inputType"
                        >
                            <option
                                value="text"
                                ${rule.inputType === "text" ? "selected" : ""}
                            >Text</option>

                            <option
                                value="regexp"
                                ${
                                    rule.inputType === "regexp"
                                        ? "selected"
                                        : ""
                                }
                            >Regexp</option>
                        </select>
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

                    <td>
                        <input
                            class="wnc-cell-input"
                            data-field="html"
                            value="${escapeHTML(rule.html)}"
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
                            <th>Input</th>
                            <th>Output</th>
                            <th>Type</th>
                            <th>Case</th>
                            <th>Enabled</th>
                            <th>HTML</th>
                            <th>Matches</th>
                            <th></th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows || `
                            <tr>
                                <td colspan="8" class="wnc-empty">
                                    No rules from this group match this page
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
                <table class="wnc-table">
                    <thead>
                        <tr>
                            <th>URL Pattern</th>
                            <th>Current Site</th>
                            <th></th>
                        </tr>
                    </thead>

                    <tbody>
                        ${rows || `
                            <tr>
                                <td colspan="3" class="wnc-empty">
                                    No URL patterns
                                </td>
                            </tr>
                        `}

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
                                    ${
                                        group.enabled
                                            ? "checked"
                                            : ""
                                    }
                                >
                            </td>
                        </tr>

                        <tr>
                            <td>Page Load</td>
                            <td>
                                <input
                                    type="checkbox"
                                    data-group-field="pageLoad"
                                    ${
                                        group.pageLoad
                                            ? "checked"
                                            : ""
                                    }
                                >
                            </td>
                        </tr>

                        <tr>
                            <td>Auto</td>
                            <td>
                                <input
                                    type="checkbox"
                                    data-group-field="auto"
                                    ${
                                        group.auto
                                            ? "checked"
                                            : ""
                                    }
                                >
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        `;
    }

    // ---------------------------------------------------------------------
    // Unmatched screen
    // ---------------------------------------------------------------------

    function renderUnmatched(content) {
        if (!state.candidates.length) {
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

                    <select
                        class="wnc-control-select"
                        data-unmatched-control="type"
                    >
                        <option
                            value="text"
                            ${
                                state.candidateType === "text"
                                    ? "selected"
                                    : ""
                            }
                        >text</option>

                        <option
                            value="regexp"
                            ${
                                state.candidateType === "regexp"
                                    ? "selected"
                                    : ""
                            }
                        >regexp</option>
                    </select>

                    <select
                        class="wnc-control-select"
                        data-unmatched-control="template"
                        ${
                            state.candidateType !== "regexp"
                                ? "disabled"
                                : ""
                        }
                    >
                        <option
                            value="Korean"
                            ${
                                state.candidateTemplate === "Korean"
                                    ? "selected"
                                    : ""
                            }
                        >Korean</option>

                        <option
                            value="Japanese"
                            ${
                                state.candidateTemplate === "Japanese"
                                    ? "selected"
                                    : ""
                            }
                        >Japanese</option>

                        <option
                            value="Other"
                            ${
                                state.candidateTemplate === "Other"
                                    ? "selected"
                                    : ""
                            }
                        >Other</option>
                    </select>

                    <select
                        class="wnc-control-select"
                        data-unmatched-control="case"
                    >
                        <option
                            value="false"
                            ${
                                !state.candidateCaseSensitive
                                    ? "selected"
                                    : ""
                            }
                        >No</option>

                        <option
                            value="true"
                            ${
                                state.candidateCaseSensitive
                                    ? "selected"
                                    : ""
                            }
                        >Yes</option>
                    </select>

                    <button
                        class="wnc-button wnc-apply"
                        data-action="apply-checked"
                        ${
                            !groups.length
                                ? "disabled"
                                : ""
                        }
                    >Apply Checked</button>

                </div>

                <div class="wnc-table-wrap">
                    <table class="wnc-table wnc-unmatched-table">
                        <thead>
                            <tr>
                                <th>Apply</th>
                                <th>Candidate</th>
                                <th>Input</th>
                                <th>Output</th>
                                <th>Matches</th>
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
                                            No unmatched candidates
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

    function handleClick(event) {
        const target = event.target.closest("[data-action]");

        if (!target) {
            return;
        }

        const action = target.dataset.action;

        switch (action) {
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
                closeUI();
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

            case "apply-checked":
                applyCheckedCandidates();
                break;
        }
    }

    function handleChange(event) {
        const target = event.target;

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

        // Unmatched global controls.
        if (target.matches("[data-unmatched-control]")) {
            handleUnmatchedControl(target);
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
             * Unmatched is transient WNC state.
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
         * Always rescan when entering Unmatched so the list reflects the
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

        saveDatabase();

        render();

        /*
         * Focus the new row's Input cell if possible.
         */
        requestAnimationFrame(() => {
            const rows = document.querySelectorAll(
                ".wnc-rules-table tbody tr[data-rule-index]"
            );

            const last = rows[rows.length - 1];

            last
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
    // Unmatched controls
    // ---------------------------------------------------------------------

    function handleUnmatchedControl(target) {
        const control = target.dataset.unmatchedControl;

        switch (control) {
            case "targetGroup":
                state.targetGroup = Number(target.value);
                break;

            case "type":
                state.candidateType = target.value;

                /*
                 * Type change only changes the global setting.
                 * Existing Input edits are not destroyed.
                 */
                break;

            case "template":
                state.candidateTemplate = target.value;
                break;

            case "case":
                state.candidateCaseSensitive =
                    target.value === "true";
                break;
        }

        /*
         * Re-render only for controls whose visual state depends on the
         * selected value.
         */
        if (
            control === "type" ||
            control === "template" ||
            control === "case" ||
            control === "targetGroup"
        ) {
            render();
        }
    }

    // ---------------------------------------------------------------------
    // Apply Checked
    // ---------------------------------------------------------------------

    function applyCheckedCandidates() {
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

            const rule = createNativeRule();

            rule.input = input;
            rule.output = output;
            rule.inputType = state.candidateType;
            rule.caseSensitive =
                state.candidateCaseSensitive;
            rule.enabled = true;

            /*
             * Native FoxReplace default.
             */
            rule.html = "none";

            /*
             * Avoid creating an exact duplicate substitution in the target
             * group. If an exact same rule already exists, the candidate is
             * still considered handled.
             */
            const duplicate = group.substitutions.some(existing =>
                existing.input === rule.input &&
                existing.output === rule.output &&
                existing.inputType === rule.inputType &&
                existing.caseSensitive === rule.caseSensitive &&
                existing.enabled === rule.enabled &&
                existing.html === rule.html
            );

            if (!duplicate) {
                group.substitutions.push(rule);
            }

            /*
             * Remove from Unmatched.
             */
            state.candidates.splice(index, 1);
        }

        state.selectedCandidates.clear();

        saveDatabase();

        /*
         * Return to the refreshed Unmatched spreadsheet.
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

    async function importFile(file) {
        if (!file) {
            return;
        }

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            const validated = normalizeDatabase(parsed);

            if (!validated) {
                alert(
                    "Invalid FoxReplace JSON.\n\n" +
                    "The current WNC database was not changed."
                );

                return;
            }

            db = validated;

            saveDatabase();

            /*
             * Import replaces only the canonical FoxReplace database.
             * Unmatched remains transient.
             */
            state.candidates = [];
            state.selectedCandidates.clear();

            render();

        } catch (error) {
            console.error("WNC import error:", error);

            alert(
                "The JSON file could not be imported.\n\n" +
                "The current WNC database was not changed."
            );
        }
    }

    // ---------------------------------------------------------------------
    // Export
    // ---------------------------------------------------------------------

    function exportDatabase() {
        /*
         * Build a fresh native FoxReplace object.
         *
         * WNC-specific state is intentionally absent.
         */
        const exported = {
            groups: sortedGroups().map(({ group }) => {
                const outputGroup = {
                    name: group.name,
                    urls: [...group.urls],
                    enabled: group.enabled,
                    pageLoad: group.pageLoad,
                    auto: group.auto,
                    substitutions: sortedRules(group)
                        .map(({ rule }) => ({
                            input: rule.input,
                            output: rule.output,
                            inputType: rule.inputType,
                            caseSensitive: rule.caseSensitive,
                            enabled: rule.enabled,
                            html: rule.html
                        }))
                };

                return outputGroup;
            })
        };

        const json = JSON.stringify(exported, null, 2);

        const blob = new Blob(
            [json],
            {
                type: "application/json"
            }
        );

        const url = URL.createObjectURL(blob);

        const anchor = document.createElement("a");

        anchor.href = url;
        anchor.download = "foxreplace.json";

        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();

        setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
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
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: 2147483647;

    width: min(1000px, 92vw);
    height: min(720px, 82vh);

    background: #111214;
    color: #e8e8e8;

    font-family:
        Inter,
        ui-sans-serif,
        system-ui,
        -apple-system,
        BlinkMacSystemFont,
        "Segoe UI",
        sans-serif;

    font-size: 13px;
    line-height: 1.35;

    border: 1px solid #303236;
    box-shadow: 0 12px 40px rgba(0, 0, 0, .55);
}

.wnc-shell {
    width: 100%;
    height: 100%;
    min-height: 0;

    display: flex;
    flex-direction: column;

    background: #111214;
}

.wnc-header {
    height: 48px;
    min-height: 48px;

    display: flex;
    align-items: center;
    justify-content: space-between;

    padding: 0 12px;

    border-bottom: 1px solid #303236;
    background: #17181a;
}

.wnc-brand {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: .04em;
    color: #f0f0f0;
}

.wnc-header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
}

.wnc-search {
    width: 240px;
    height: 30px;
    min-width: 120px;
    padding: 2px 8px;
    border: 1px solid #383a3e;
    border-radius: 2px;
    outline: none;
    background: #1c1e21;
    color: #e2e2e2;
    font: inherit;
}

.wnc-search::placeholder {
    color: #73767b;
}

.wnc-search:focus {
    border-color: #60636a;
    background: #202226;
}

.wnc-button {
    height: 30px;
    padding: 0 11px;
    border: 1px solid #414348;
    border-radius: 3px;
    background: #222428;
    color: #e7e7e7;
    font: inherit;
    cursor: pointer;
}

.wnc-button:hover:not(:disabled) {
    background: #292b2f;
    border-color: #55585d;
}

.wnc-button:disabled {
    opacity: .45;
    cursor: default;
}

.wnc-primary {
    background: #25272a;
}

.wnc-apply {
    white-space: nowrap;
}

.wnc-screen {
    width: 100%;
    height: 100%;
    min-height: 0;

    display: flex;
    flex-direction: column;

    overflow: hidden;
    padding: 14px;
}

#wnc-content {
    flex: 1;
    min-height: 0;
    overflow: hidden;
}

.wnc-section-heading,
.wnc-workspace-heading {
    height: 34px;
    display: flex;
    align-items: center;
    margin-bottom: 8px;
}

.wnc-section-heading h1,
.wnc-workspace-heading h1 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #eeeeee;
}

.wnc-workspace-heading {
    gap: 7px;
}

.wnc-back {
    width: 27px;
    height: 27px;
    padding: 0;
    border: 1px solid #3d3f43;
    border-radius: 3px;
    background: #202226;
    color: #e8e8e8;
    font-size: 21px;
    line-height: 20px;
    cursor: pointer;
}

.wnc-back:hover {
    background: #292b2f;
}

.wnc-tabs {
    display: flex;
    height: 32px;
    margin-bottom: 8px;
    border-bottom: 1px solid #34363a;
}

.wnc-tab {
    min-width: 70px;
    height: 31px;
    padding: 0 12px;
    border: 0;
    border-bottom: 2px solid transparent;
    background: transparent;
    color: #8f9298;
    font: inherit;
    cursor: pointer;
}

.wnc-tab:hover {
    color: #d8d8d8;
}

.wnc-tab.active {
    border-bottom-color: #d4d4d4;
    color: #f0f0f0;
}

.wnc-table-wrap {
    width: 100%;
    flex: 1;
    min-height: 0;

    overflow: auto;

    border: 1px solid #303236;
    background: #151618;
}

.wnc-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
}

.wnc-table th,
.wnc-table td {
    height: 31px;
    padding: 0 7px;
    border-right: 1px solid #303236;
    border-bottom: 1px solid #303236;
    vertical-align: middle;
    text-align: left;
    overflow: hidden;
}

.wnc-table th:last-child,
.wnc-table td:last-child {
    border-right: 0;
}

.wnc-table th {
    height: 29px;
    background: #1c1e21;
    color: #9da0a5;
    font-size: 11px;
    font-weight: 600;
    text-transform: none;
    white-space: nowrap;
}

.wnc-table td {
    background: #151618;
    color: #dedede;
}

.wnc-table tbody tr:hover td {
    background: #1a1c1f;
}

.wnc-clickable-row {
    cursor: pointer;
}

.wnc-clickable-row:hover td {
    background: #202226;
}

.wnc-unmatched-row td {
    color: #d6d6d6;
}

.wnc-collapse-row {
    cursor: pointer;
}

.wnc-collapse-row td {
    height: 30px;
    background: #191b1e !important;
    color: #9da0a5 !important;
    font-size: 11px;
    font-weight: 600;
}

.wnc-collapse-row:hover td {
    background: #202226 !important;
    color: #d0d2d5 !important;
}

.wnc-collapse-arrow {
    display: inline-block;
    width: 18px;
    color: #8d9095;
}

.wnc-collapse-count {
    margin-left: 5px;
    color: #696c71;
    font-weight: 400;
}

.wnc-number {
    width: 90px;
    text-align: right !important;
    color: #b8bbc0 !important;
    font-variant-numeric: tabular-nums;
}

.wnc-site-status {
    width: 90px;
    text-align: center !important;
}

.wnc-check {
    color: #65c174;
    font-weight: 700;
}

.wnc-cross {
    color: #8c8e93;
    font-weight: 600;
}

.wnc-empty {
    height: 40px !important;
    text-align: center !important;
    color: #777a80 !important;
}

.wnc-cell-input,
.wnc-cell-select,
.wnc-control-select {
    width: 100%;
    height: 27px;
    min-width: 0;
    padding: 2px 5px;
    border: 1px solid #383a3e;
    border-radius: 2px;
    outline: none;
    background: #1c1e21;
    color: #e2e2e2;
    font: inherit;
}

.wnc-cell-input:focus,
.wnc-cell-select:focus,
.wnc-control-select:focus {
    border-color: #60636a;
    background: #202226;
}

.wnc-cell-select {
    cursor: pointer;
}

.wnc-center {
    width: 72px;
    text-align: center !important;
}

.wnc-delete-cell {
    width: 34px;
    text-align: center !important;
    padding: 0 !important;
}

.wnc-delete {
    width: 25px;
    height: 25px;
    border: 0;
    background: transparent;
    color: #85878c;
    font-size: 18px;
    line-height: 24px;
    cursor: pointer;
}

.wnc-delete:hover {
    color: #d2d2d2;
    background: #292b2f;
}

.wnc-add-row td {
    height: 34px;
    background: #17191b !important;
}

.wnc-add-button {
    height: 26px;
    padding: 0 7px;
    border: 1px solid transparent;
    background: transparent;
    color: #989ba1;
    font: inherit;
    cursor: pointer;
}

.wnc-add-button:hover {
    border-color: #3b3d41;
    background: #222428;
    color: #e1e1e1;
}

.wnc-group-options {
    width: 360px;
    max-width: 100%;
    margin-top: 10px;
}

.wnc-group-options .wnc-table td:first-child {
    width: 150px;
    color: #aeb1b6;
}

.wnc-group-options .wnc-table td:last-child {
    text-align: left;
}

/*
 * Unmatched has six controls:
 *
 *   Groups
 *   Target Group
 *   Type
 *   Template
 *   Case
 *   Apply Checked
 *
 * Keep them together on one compact row on normal desktop widths.
 */
.wnc-unmatched-controls {
    display: grid;
    grid-template-columns:
        auto
        minmax(150px, 1fr)
        100px
        115px
        80px
        auto;
    gap: 5px;
    margin-bottom: 8px;
    align-items: center;
}

.wnc-unmatched-controls .wnc-control-select {
    height: 30px;
}

.wnc-unmatched-controls .wnc-button {
    height: 30px;
}

.wnc-check-cell {
    width: 54px;
    text-align: center !important;
}

.wnc-unmatched-table th:nth-child(1) {
    width: 54px;
}

.wnc-unmatched-table th:nth-child(5) {
    width: 85px;
}

.wnc-rules-table th:nth-child(3) {
    width: 95px;
}

.wnc-rules-table th:nth-child(4),
.wnc-rules-table th:nth-child(5) {
    width: 65px;
}

.wnc-rules-table th:nth-child(6) {
    width: 100px;
}

.wnc-rules-table th:nth-child(7) {
    width: 75px;
}

@media (max-width: 800px) {
    .wnc-unmatched-controls {
        grid-template-columns:
            auto
            1fr
            1fr
            1fr
            1fr
            auto;
    }

    .wnc-screen {
        padding: 8px;
    }

    .wnc-header {
        padding: 0 8px;
    }
}

@media (max-width: 600px) {
    .wnc-unmatched-controls {
        grid-template-columns:
            1fr
            1fr
            1fr;
    }

    .wnc-unmatched-controls .wnc-button {
        width: 100%;
    }
}
        `;

        document.head.appendChild(style);
    }

    function closeUI() {
        document.getElementById("wnc-root")?.remove();
    }

    // ---------------------------------------------------------------------
    // Startup
    // ---------------------------------------------------------------------

    function openUI() {
        if (document.readyState === "loading") {
            document.addEventListener(
                "DOMContentLoaded",
                mount,
                { once: true }
            );
        } else {
            mount();
        }
    }

    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand(
            "WNC — Open Rule Workbench",
            openUI
        );
    }

})();