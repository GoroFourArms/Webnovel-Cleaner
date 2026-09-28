// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.1.25
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
 * WNC is a FoxReplace companion/workbench.
 *
 * It does NOT:
 *   - replace text on the page
 *   - use MutationObserver
 *   - automatically clean pages
 *   - act as a second FoxReplace runtime
 *   - export FoxReplace JSON
 *   - apply generated candidates as FoxReplace rules
 *
 * It DOES:
 *   - import native FoxReplace JSON
 *   - inspect FoxReplace groups and rules
 *   - scan the current page for unmatched capitalized words/phrases
 *   - cluster candidates within 2 token links
 *   - generate FoxReplace-ready Input patterns
 *   - let the user copy generated Input values
 *
 * Clustering:
 *   - highest-frequency candidate becomes the first cluster root
 *   - subsequent highest-frequency unclustered candidates become roots
 *   - candidates within 2 token links belong to the same cluster
 *   - unclustered candidates below 5% of the maximum frequency are hidden
 */
// ---------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------
const DB_KEY = "WNC_FOXREPLACE_DATABASE_V1";
const LAST_IMPORTED_DB_KEY =
    "WNC_LAST_IMPORTED_DATABASE_V1";

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

let db =
    loadLastImportedDatabase() ||
    loadDatabase();

let state = {
    screen: "groups",
    groupIndex: null,
    candidates: [],

    candidateTemplate: "Other",

    showOtherGroups: false,
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

function loadLastImportedDatabase() {
    const raw =
        readStorage(LAST_IMPORTED_DB_KEY, null);

    if (!raw) {
        return null;
    }

    const normalized =
        normalizeDatabase(raw);

    return normalized || null;
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

normalized.enabled =
    typeof normalized.enabled === "boolean"
        ? normalized.enabled
        : normalized.enabled === "true"
            ? true
            : normalized.enabled === "false"
                ? false
                : Boolean(normalized.enabled);

normalized.pageLoad =
    typeof normalized.pageLoad === "boolean"
        ? normalized.pageLoad
        : normalized.pageLoad === "true"
            ? true
            : normalized.pageLoad === "false"
                ? false
                : Boolean(normalized.pageLoad);

normalized.auto =
    typeof normalized.auto === "boolean"
        ? normalized.auto
        : normalized.auto === "true"
            ? true
            : normalized.auto === "false"
                ? false
                : Boolean(normalized.auto);
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
    if (!rule || typeof rule !== "object") {
        return null;
    }

    const normalized = {
        ...rule
    };

    normalized.input = String(
        normalized.input ?? ""
    );

    normalized.output = String(
        normalized.output ?? ""
    );

    const inputType = String(
        normalized.inputType ?? ""
    )
        .trim()
        .toLowerCase();

    if (
        normalized.inputType === 1 ||
        inputType === "1" ||
        inputType === "whole" ||
        inputType === "whole words" ||
        inputType === "whole word" ||
        inputType === "wholeword"
    ) {
        normalized.inputType = "whole";
    } else if (
        normalized.inputType === 2 ||
        inputType === "2" ||
        inputType === "regexp" ||
        inputType === "regex" ||
        inputType === "regular expression"
    ) {
        normalized.inputType = "regexp";
    } else {
        normalized.inputType = "text";
    }

    if (
        normalized.outputType === 1 ||
        normalized.outputType === "1" ||
        normalized.outputType === "function"
    ) {
        normalized.outputType = 1;
    } else {
        normalized.outputType = 0;
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

    if ("html" in normalized) {
        normalized.html = String(
            normalized.html ?? "none"
        );
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
const CHAPTER_SELECTOR_KEY = "wnc-chapter-selector";

const DEFAULT_CHAPTER_SELECTORS = [
    ".entry-content",
    ".text-left",
    ".prose",
    ".chapter-content",
    ".chapter-content2",
    ".chapter-content3",
    ".chapter_content",
    ".chapter-body",
    ".chapter-text",
    ".chapter-body-content",
    ".read-content",
    ".reading-content",
    ".reader-content",
    ".novel-content",
    ".novel-body",
    ".story-content",
    ".story-body",
    ".book-content",
    ".post-content",
    ".content-area",
    "article",
    "main",
    "#chapter-content",
    "#chapter-body",
    "#read-content",
    "#reading-content",
    "#reader-content",
    "#novel-content"
];

function getChapterSelector() {
    const hostname = location.hostname;

    return String(
        GM_getValue(
            `${CHAPTER_SELECTOR_KEY}:${hostname}`,
            ""
        )
    ).trim();
}

function saveChapterSelector(selector) {
    const hostname = location.hostname;

    GM_setValue(
        `${CHAPTER_SELECTOR_KEY}:${hostname}`,
        String(selector ?? "").trim()
    );
}

function findChapterContainer() {
    const savedSelector =
        getChapterSelector();

    /*
     * Site-specific selector has priority.
     */
    if (savedSelector) {
        try {
            const saved =
                document.querySelector(savedSelector);

            if (saved) {
                return saved;
            }
        } catch (error) {
            /*
             * Invalid selector.
             * Continue with automatic detection.
             */
        }
    }

    const candidates = [];
    const seen = new Set();

    for (
        let i = 0;
        i < DEFAULT_CHAPTER_SELECTORS.length;
        i++
    ) {
        const selector =
            DEFAULT_CHAPTER_SELECTORS[i];

        let elements;

        try {
            elements =
                document.querySelectorAll(selector);
        } catch (error) {
            continue;
        }

        for (const element of elements) {
            if (seen.has(element)) {
                continue;
            }

            seen.add(element);

            const text =
                element.innerText?.trim() || "";

            if (text.length < 300) {
                continue;
            }

            candidates.push({
                element,
                priority: i
            });
        }
    }

    if (!candidates.length) {
        return null;
    }

    let best = null;
    let bestScore = -Infinity;

    for (const candidate of candidates) {
        const element = candidate.element;
        const text =
            element.innerText.trim();

        const paragraphs =
            element.querySelectorAll("p").length;

        const headings =
            element.querySelectorAll(
                "h1, h2, h3, h4"
            ).length;

        const links =
            element.querySelectorAll("a").length;

        const buttons =
            element.querySelectorAll(
                "button, input, select"
            ).length;

        const navigation =
            element.querySelectorAll(
                "nav, header, footer"
            ).length;

        const comments =
            element.querySelectorAll(
                "[class*='comment'], [id*='comment']"
            ).length;

        let score =
            Math.min(text.length, 50000) / 100 +
            paragraphs * 80 +
            headings * 10;

        score += Math.max(
            0,
            30 - candidate.priority
        );

        score -= links * 2;
        score -= buttons * 10;
        score -= navigation * 100;
        score -= comments * 50;

        if (
            text.length > 0 &&
            links > text.length / 100
        ) {
            score -= 100;
        }

        if (score > bestScore) {
            best = element;
            bestScore = score;
        }
    }

    return best;
}

function getPageText() {
    const chapter =
        findChapterContainer();

    if (!chapter) {
        return "";
    }

    const clone =
        chapter.cloneNode(true);

    const wncRoot =
        clone.querySelector("#wnc-root");

    if (wncRoot) {
        wncRoot.remove();
    }

    return (
        clone.innerText ||
        clone.textContent ||
        ""
    ).trim();
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

const FILTER_WORDS = new Set([
    "a", "after", "an", "and", "as", "at", "before", "but",
    "by", "for", "from", "how", "if", "in", "of", "on",
    "or", "since", "so", "tell", "that", "the", "then", "there",
    "this", "to", "until", "what", "when", "where", "while",
    "why", "with"
]);

const FILTER_ALONE = new Set([
    "ah", "do", "ha", "he",
    "i", "no", "oh", "you"
]);

    function addCandidate(map, value) {
    let candidate = String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();

    if (!candidate) {
        return;
    }

    candidate = candidate.replace(
        /^(?:The|A|An)\s+/i,
        ""
    );

    while (
        candidate &&
        FILTER_CONTEXT.has(
            candidate.split(/\s+/)[0].toLowerCase()
        )
    ) {
        candidate = candidate
            .split(/\s+/)
            .slice(1)
            .join(" ")
            .trim();
    }

    if (!candidate) {
        return;
    }

    if ([...candidate].length < 2) {
        return;
    }

    const normalized =
        candidate.toLowerCase();

    if (FILTER_ALONE.has(normalized)) {
        return;
    }

    const tokens = candidate.split(/\s+/);

    if (
        tokens.length === 1 &&
        FILTER_WORDS.has(
            tokens[0].toLowerCase()
        )
    ) {
        return;
    }

    const mergeKey =
        candidateMergeKey(candidate);

    for (const [
        existingCandidate,
        matches
    ] of map.entries()) {
        if (
            candidateMergeKey(existingCandidate) ===
            mergeKey
        ) {
            map.set(
                existingCandidate,
                matches + 1
            );

            return;
        }
    }
map.set(
    normalizeCandidateRepresentative(candidate),
    1
);
}
function candidateMergeKey(candidate) {
    return tokenizeCandidate(candidate)
        .map(normalizeToken)
        .join(" ");
}

function normalizeCandidateRepresentative(candidate) {
    return tokenizeCandidate(candidate)
        .map(token => {
            const normalized = normalizeToken(token);
            return normalized
                ? normalized.charAt(0).toUpperCase() +
                  normalized.slice(1)
                : normalized;
        })
        .join(" ");
}
    // ---------------------------------------------------------------------
    // Existing-rule exclusion
    // ---------------------------------------------------------------------

function getCurrentSiteRules() {
    return db.groups
        .filter(group =>
            group.enabled &&
            groupMatchesCurrentSite(group)
        )
        .flatMap(group => group.substitutions)
        .filter(rule =>
            rule.enabled &&
            rule.input
        );
}

function candidateCoveredByExistingRule(candidate) {
const rules = getCurrentSiteRules();

for (const rule of rules) {

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

    if (!text) {
        state.candidates = [];
        return;
    }

    const discovered = extractCandidates(text)
        .filter(item =>
            !candidateCoveredByExistingRule(item.candidate)
        );

    state.candidates =
        clusterAndSortCandidates(discovered);

    /*
     * Generate the current FoxReplace Input for every
     * candidate using the existing template system.
     */
    for (const candidate of state.candidates) {
        if (!candidate) {
            continue;
        }

        if (state.candidateTemplate === "Japanese") {
            const pattern =
                generateJapanesePattern(
                    tokenizeCandidate(candidate.candidate)
                );

            candidate.input =
                pattern?.input ?? "";

            candidate.output = "";
        } else {
            candidate.input =
                generateTemplateInput(
                    candidate.candidate,
                    state.candidateTemplate
                );

            candidate.output = "";
        }
    }
}

// ---------------------------------------------------------------------
// Candidate clustering
// ---------------------------------------------------------------------

/*
 * Candidates are clustered by shared-token relationships
 * with a maximum traversal depth of 2.
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
 * of the cluster. A chain of shared tokens is allowed up to 2 links.
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
    if (!candidates?.length) {
        return [];
    }

    const items = candidates.map(item => ({
        ...item,
        tokens: new Set(
            tokenizeCandidate(item.candidate)
                .map(normalizeToken)
                .filter(Boolean)
        ),
        cluster: null,
        degree: Infinity
    }));

    const maxFrequency = Math.max(
        ...items.map(item => Number(item.matches) || 0)
    );

    if (!maxFrequency) {
        return [];
    }

    const minimumFrequency =
        maxFrequency * UNCLUSTERED_FREQUENCY_RATIO;

    const unclustered = new Set(items);

    while (unclustered.size) {
        let root = null;

        /*
         * Highest-frequency unclustered candidate
         * becomes the next cluster root.
         */
        for (const item of unclustered) {
            if (
                !root ||
                item.matches > root.matches ||
                (
                    item.matches === root.matches &&
                    item.candidate.localeCompare(
                        root.candidate,
                        undefined,
                        { sensitivity: "base" }
                    ) < 0
                )
            ) {
                root = item;
            }
        }

        if (!root) {
            break;
        }

        const cluster = [];
        const queue = [{
            item: root,
            degree: 0
        }];

        unclustered.delete(root);

        while (queue.length) {
            const current = queue.shift();

            current.item.cluster = root.candidate;
            current.item.degree = current.degree;

            cluster.push(current.item);

            /*
             * Maximum cluster depth is 2.
             */
            if (current.degree >= 2) {
                continue;
            }

            for (const candidate of [...unclustered]) {
                let sharesToken = false;

                for (const token of current.item.tokens) {
                    if (candidate.tokens.has(token)) {
                        sharesToken = true;
                        break;
                    }
                }

                if (!sharesToken) {
                    continue;
                }

                const nextDegree =
                    current.degree + 1;

                if (nextDegree > 2) {
                    continue;
                }

                unclustered.delete(candidate);

                queue.push({
                    item: candidate,
                    degree: nextDegree
                });
            }
        }

        /*
         * Sort candidates inside the cluster by frequency.
         */
        cluster.sort((a, b) => {
            if (b.matches !== a.matches) {
                return b.matches - a.matches;
            }

            return a.candidate.localeCompare(
                b.candidate,
                undefined,
                { sensitivity: "base" }
            );
        });

        /*
         * A cluster is retained when its root reaches
         * the 5% threshold.
         */
        if (root.matches >= minimumFrequency) {
            root.clusterItems = cluster;
        }
    }

    /*
     * Return clusters in root-frequency order.
     */
    const result = [];

    const roots = items
        .filter(item =>
            item.cluster === item.candidate
        )
        .sort((a, b) => {
            if (b.matches !== a.matches) {
                return b.matches - a.matches;
            }

            return a.candidate.localeCompare(
                b.candidate,
                undefined,
                { sensitivity: "base" }
            );
        });

    for (const root of roots) {
        if (!root.clusterItems) {
            continue;
        }

        result.push(...root.clusterItems);
    }

    return result;
}

function tokenizeCandidate(value) {
    return String(value)
        .trim()
        .split(/\s+/)
        .filter(Boolean);
}
function normalizeToken(token) {
    let word = token.toLowerCase();

    // Possessives
    word = word.replace(/['’]s$/, "");
    word = word.replace(/['’]$/, "");

    // Plurals
    if (word.endsWith("ies") && word.length > 3) {
        word = word.slice(0, -3) + "y";
    } else if (
        word.endsWith("ses") ||
        word.endsWith("xes") ||
        word.endsWith("zes") ||
        word.endsWith("ches") ||
        word.endsWith("shes")
    ) {
        word = word.slice(0, -2);
    } else if (word.endsWith("s") && !word.endsWith("ss")) {
        word = word.slice(0, -1);
    }

    return word;
}
    // ---------------------------------------------------------------------
    // Template helpers
    // ---------------------------------------------------------------------


function generateTemplateInput(candidate, template) {
    const tokens = tokenizeCandidate(candidate);

    if (!tokens.length) {
        return String(candidate ?? "");
    }

    switch (template) {
        case "Korean":
            return generateKoreanRegex(tokens);

        case "Japanese": {
            const pattern =
                generateJapanesePattern(tokens);

            return pattern?.input ?? "";
        }

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
        left: 50%;
        right: auto;
        width: fit-content;
        max-width: 95vw;
        transform: translateX(-50%);
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
    .wnc-back:hover,
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
        max-width: 100%;
        table-layout: auto;
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
.wnc-chapter-selector {
    display: flex;
    gap: 6px;
    margin-top: 6px;
}

#wnc-chapter-selector {
    flex: 1;
    min-width: 0;
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

    #wnc-root input[type="checkbox"] {
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
        <button
            class="wnc-button"
            data-action="import"
            title="Import"
        >Imp</button>

        <button
            class="wnc-button"
            data-action="close"
            title="Close"
        >×</button>
    </div>

    <input
        id="wnc-import-file"
        type="file"
        accept=".json,application/json"
        style="display:none"
    >
</header>
                <main id="wnc-content"></main>
            </div>
        `;

document.documentElement.appendChild(root);

injectStyles();

root.addEventListener("click", handleClick);

render();

try {
    scanCandidates();
    render();
} catch (error) {
    console.error("WNC scanner error:", error);
}

} // END mount()

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
function renderGroups(content) {
const groups = sortedGroups();

    const pageText = getPageText();

    const currentGroups = [];
    const otherGroups = [];

    for (const entry of groups) {
        if (
            groupMatchesCurrentSite(entry.group)
        ) {
            currentGroups.push(entry);
        } else {
            otherGroups.push(entry);
        }
    }

    const renderGroupRow = ({
        group,
        index
    }) => {
        const summary =
            groupMatchesCurrentSite(group)
                ? findTopCandidateForGroup(
                    group,
                    pageText
                )
                : null;

        return `
            <tr
                class="wnc-clickable-row"
                data-action="open-group"
                data-group-index="${index}"
            >
                <td>
                    ${escapeHTML(
                        group.name || "(Unnamed)"
                    )}
                </td>

                <td class="wnc-site-match">
                    ${
                        groupMatchesCurrentSite(group)
                            ? "✓"
                            : "—"
                    }
                </td>

                <td>
                    ${escapeHTML(
                        summary?.candidate ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        summary?.replace ?? "—"
                    )}
                </td>

                <td>
                    ${escapeHTML(
                        summary?.with ?? "—"
                    )}
                </td>

                <td class="wnc-number">
                    ${summary?.total ?? 0}
                </td>
            </tr>
        `;
    };

    const currentRows =
        currentGroups
            .map(renderGroupRow)
            .join("");

    const otherRows =
        otherGroups
            .map(renderGroupRow)
            .join("");

    content.innerHTML = `
        <section class="wnc-screen">

            <div class="wnc-section-heading">
                <h1>Groups</h1>

                <button
                    type="button"
                    class="wnc-button wnc-primary"
                    data-action="open-unmatched"
                >Candidates</button>
            </div>

            <div class="wnc-table-wrap">
                <table class="wnc-table">
                    <thead>
                        <tr>
                            <th>Group</th>
                            <th>Site</th>
                            <th>Candidate</th>
                            <th>Replace</th>
                            <th>With</th>
                            <th>T#</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${
                            currentRows ||
                            `
                                <tr>
                                    <td
                                        colspan="6"
                                        class="wnc-empty"
                                    >
                                        No matching groups
                                    </td>
                                </tr>
                            `
                        }

                        ${
                            otherGroups.length
                                ? `
                                    <tr
                                        class="wnc-collapse-row"
                                        data-action="toggle-other-groups"
                                    >
                                        <td colspan="6">
                                            <span class="wnc-collapse-arrow">
                                                ${
                                                    state.showOtherGroups
                                                        ? "▼"
                                                        : "▶"
                                                }
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
                                : ""
                        }
                    </tbody>
                </table>
            </div>

        </section>
    `;
}
function findTopCandidateForGroup(group, text) {
    let topCandidate = null;
    let topRule = null;

    for (const rule of group.substitutions) {
        if (!rule.enabled || !rule.input) {
            continue;
        }

        const regex = buildRuleRegex(rule);

        if (!regex) {
            continue;
        }

        let ruleTotal = 0;
        const counts = new Map();

        while (true) {
            const match = regex.exec(text);

            if (!match) {
                break;
            }

            const candidate = match[0];

            if (candidate) {
                ruleTotal++;

                const total =
                    (counts.get(candidate) || 0) + 1;

                counts.set(candidate, total);

                /*
                 * Candidate / Replace / With are based on the
                 * most frequently matched candidate string.
                 *
                 * This is independent of T#, which is based
                 * on the total matches of the top rule.
                 */
                if (
                    !topCandidate ||
                    total > topCandidate.total ||
                    (
                        total === topCandidate.total &&
                        candidate.localeCompare(
                            topCandidate.candidate,
                            undefined,
                            { sensitivity: "base" }
                        ) < 0
                    )
                ) {
                    topCandidate = {
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

        /*
         * T# is the total number of matches made by the
         * single rule with the highest match count.
         */
        if (
            ruleTotal > 0 &&
            (
                !topRule ||
                ruleTotal > topRule.total ||
                (
                    ruleTotal === topRule.total &&
                    String(rule.input).localeCompare(
                        String(topRule.rule.input),
                        undefined,
                        { sensitivity: "base" }
                    ) < 0
                )
            )
        ) {
            topRule = {
                rule,
                total: ruleTotal
            };
        }
    }

    if (!topCandidate && !topRule) {
        return null;
    }

    return {
        candidate: topCandidate?.candidate ?? "—",
        replace: topCandidate?.replace ?? "—",
        with: topCandidate?.with ?? "—",
        total: topRule?.total ?? 0
    };
}

function renderGroup(content) {
    const group = db.groups[state.groupIndex];

    if (!group) {
        state.screen = "groups";
        render();
        return;
    }

    const pageText = getPageText();

    const visibleRules =
        groupMatchesCurrentSite(group)
            ? group.substitutions.filter(rule =>
                rule.enabled &&
                countRuleMatches(
                    rule,
                    pageText
                ) > 0
            )
            : [];

    content.innerHTML = `
        <section class="wnc-screen">
            <div class="wnc-workspace-heading">
                <button
                    class="wnc-back"
                    data-action="back-groups"
                    title="Back"
                >‹</button>

                <h1>
                    ${escapeHTML(group.name || "(Unnamed)")}
                </h1>
            </div>

            <div class="wnc-table-wrap">
                <table class="wnc-table wnc-rules-table">
                    <thead>
                        <tr>
                            <th>Replace</th>
                            <th>With</th>
                            <th>Type</th>
                            <th>Output</th>
                            <th>Case</th>
                            <th>Enable</th>
                            <th>Matches</th>
                        </tr>
                    </thead>

                    <tbody>
                        ${
                            visibleRules.length
                                ? visibleRules.map(rule => {
                                    const matches =
                                        countRuleMatches(
                                            rule,
                                            pageText
                                        );

                                    return `
                                        <tr>
                                            <td>
                                                ${escapeHTML(
                                                    rule.input
                                                )}
                                            </td>

                                            <td>
                                                ${escapeHTML(
                                                    rule.output
                                                )}
                                            </td>

                                            <td>
                                                ${escapeHTML(
                                                    rule.inputType
                                                )}
                                            </td>

                                            <td>
                                                ${
                                                    Number(
                                                        rule.outputType
                                                    ) === 1
                                                        ? "Function"
                                                        : "Text"
                                                }
                                            </td>

                                            <td class="wnc-center">
                                                ${
                                                    rule.caseSensitive
                                                        ? "Yes"
                                                        : "No"
                                                }
                                            </td>

                                            <td class="wnc-center">
                                                ${
                                                    rule.enabled
                                                        ? "Yes"
                                                        : "No"
                                                }
                                            </td>

                                            <td class="wnc-number">
                                                ${matches}
                                            </td>
                                        </tr>
                                    `;
                                }).join("")
                                : `
                                    <tr>
                                        <td
                                            colspan="7"
                                            class="wnc-empty"
                                        >
                                            No matching rules on this page
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
// Candidate screen
    // ---------------------------------------------------------------------
function renderUnmatched(content) {
    const getCandidateInput = (candidate) => {
        if (!candidate) {
            return "";
        }

        if (state.candidateTemplate === "Japanese") {
            const pattern =
                generateJapanesePattern(
                    tokenizeCandidate(candidate.candidate)
                );

            return pattern?.input ?? "";
        }

        return generateTemplateInput(
            candidate.candidate,
            state.candidateTemplate
        );
    };

    const rows = state.candidates
        .map((item, index) => {
            const input =
                getCandidateInput(item);

            return `
                <tr data-candidate-index="${index}">
                    <td>
                        ${escapeHTML(item.candidate)}
                    </td>

                    <td class="wnc-number">
                        ${item.matches}
                    </td>

                    <td class="wnc-input-cell">
                        <span
                            class="wnc-candidate-input"
                            title="${escapeHTML(input)}"
                        >${escapeHTML(input)}</span>
                    </td>

                    <td class="wnc-copy-cell">
                        <button
                            type="button"
                            class="wnc-choice"
                            data-action="copy-candidate-input"
                            data-candidate-index="${index}"
                        >Copy</button>
                    </td>
                </tr>
            `;
        })
        .join("");

    content.innerHTML = `
        <section class="wnc-screen">

            <div class="wnc-unmatched-controls">
                <button
                    type="button"
                    class="wnc-button"
                    data-action="groups"
                >Groups</button>

                <button
                    type="button"
                    class="wnc-choice"
                    data-action="unmatched-template-cycle"
                >${
                    state.candidateTemplate === "Korean"
                        ? "Kor"
                        : state.candidateTemplate === "Japanese"
                            ? "Jap"
                            : "Oth"
                }</button>

                <span class="wnc-muted">
                    ${state.candidates.length} candidates
                </span>
            </div>

            <div class="wnc-chapter-selector">
                <input
                    type="text"
                    id="wnc-chapter-selector"
                    value="${escapeHTML(getChapterSelector())}"
                    placeholder="Chapter container CSS selector"
                    autocomplete="off"
                    spellcheck="false"
                >

                <button
                    type="button"
                    class="wnc-button"
                    data-action="save-chapter-selector"
                >Save</button>
            </div>

            <div class="wnc-table-wrap">
                <table class="wnc-table wnc-unmatched-table">
                    <thead>
                        <tr>
                            <th>Candidate</th>
                            <th class="wnc-number">Matches</th>
                            <th>Input</th>
                            <th></th>
                        </tr>
                    </thead>

                    <tbody>
                        ${
                            rows || `
                                <tr>
                                    <td
                                        colspan="4"
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
    const templates = [
        "Other",
        "Korean",
        "Japanese"
    ];

    const currentIndex =
        templates.indexOf(
            state.candidateTemplate
        );

    state.candidateTemplate =
        templates[
            (currentIndex + 1) %
            templates.length
        ];

    for (const candidate of state.candidates) {
        if (!candidate) {
            continue;
        }

        if (
            state.candidateTemplate ===
            "Japanese"
        ) {
            const pattern =
                generateJapanesePattern(
                    tokenizeCandidate(
                        candidate.candidate
                    )
                );

            candidate.input =
                pattern?.input ?? "";

            candidate.output =
                pattern?.output ?? "";
        } else {
            candidate.input =
                generateTemplateInput(
                    candidate.candidate,
                    state.candidateTemplate
                );

            candidate.output = "";
        }
    }
}
  function copyTextFallback(text) {
    const textarea =
        document.createElement("textarea");

    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";

    document.body.appendChild(textarea);

    textarea.focus();
    textarea.select();

    try {
        document.execCommand("copy");
    } catch (error) {
        console.error(
            "WNC clipboard error:",
            error
        );
    }

    textarea.remove();
}
  function closeUI() {
    const root =
        document.getElementById("wnc-root");

    if (root) {
        root.remove();
    }
}
function handleClick(event) {
    const target =
        event.target.closest("[data-action]");

    if (!target) {
        return;
    }

    const action =
        target.dataset.action;

    if (action === "copy-candidate-input") {
        const index =
            Number(
                target.dataset.candidateIndex
            );

        const candidate =
            state.candidates[index];

        if (!candidate) {
            return;
        }

        const input =
            state.candidateTemplate ===
            "Japanese"
                ? generateJapanesePattern(
                    tokenizeCandidate(
                        candidate.candidate
                    )
                )?.input ?? ""
                : generateTemplateInput(
                    candidate.candidate,
                    state.candidateTemplate
                );

        if (
            navigator.clipboard &&
            navigator.clipboard.writeText
        ) {
            navigator.clipboard
                .writeText(input)
                .catch(() => {
                    copyTextFallback(input);
                });
        } else {
            copyTextFallback(input);
        }

        return;
    }

    if (
        action ===
        "unmatched-template-cycle"
    ) {
        updateCandidateTemplate();
        render();
        return;
    }

    if (
        action ===
        "save-chapter-selector"
    ) {
        const input =
            document.querySelector(
                "#wnc-chapter-selector"
            );

        saveChapterSelector(
            input?.value || ""
        );

        scanCandidates();
        render();
        return;
    }

if (action === "import") {
    const input =
        document.getElementById(
            "wnc-import-file"
        );

    if (input) {
        input.click();
    }

    return;
}

    if (action === "close") {
        closeUI();
        return;
    }

    if (action === "open-group") {
        const groupIndex =
            Number(
                target.dataset.groupIndex
            );

        openGroup(groupIndex);
        return;
    }

    if (action === "open-unmatched") {
        openUnmatched();
        return;
    }

    if (action === "groups") {
        state.screen = "groups";
        render();
        return;
    }

    if (
        action ===
        "toggle-other-groups"
    ) {
        state.showOtherGroups =
            !state.showOtherGroups;

        render();
        return;
    }

    if (action === "back-groups") {
        state.screen = "groups";
        state.groupIndex = null;
        render();
        return;
    }
}



    // ---------------------------------------------------------------------
    // Group actions
    // ---------------------------------------------------------------------

    function openGroup(index) {
        if (!db.groups[index]) {
            return;
        }
        state.groupIndex = index;
        state.screen = "group";
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

/*
 * Remember only the latest imported database.
 * This does not overwrite the normal database.
 */
writeStorage(
    LAST_IMPORTED_DB_KEY,
    validated
);

state.candidates = [];
                state.screen = "groups";
                state.groupIndex = null;
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

GM_registerMenuCommand("Webnovel Cleaner", () => {
    mount();
});

})();
