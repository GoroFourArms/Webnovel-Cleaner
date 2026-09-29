// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.1.28
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

    const FILTER_WORDS = new Set([
        "a",
        "after",
        "an",
        "and",
        "as",
        "at",
        "before",
        "but",
        "by",
        "for",
        "from",
        "how",
        "if",
        "in",
        "of",
        "on",
        "or",
        "since",
        "so",
        "tell",
        "that",
        "the",
        "then",
        "there",
        "this",
        "to",
        "until",
        "what",
        "when",
        "where",
        "while",
        "why",
        "with"
    ]);

    const FILTER_ALONE = new Set([
        "ah",
        "do",
        "ha",
        "he",
        "i",
        "no",
        "oh",
        "you"
    ]);

    const SINGULARIZATION_EXCEPTIONS = new Set([
        "james",
        "davis",
        "lucas",
        "carlos",
        "thomas"
    ]);

    const INPUT_TEMPLATES = [
        "Other",
        "Korean",
        "Japanese"
    ];

    const state = {
        screen: "candidates",
        groupIndex: null,
        candidates: [],
        groupMatches: [],
        conflicts: [],
        candidateTemplate: "Other",
        showOtherGroups: false,

        groupSort: {
            column: "original",
            direction: 0
        },

        ruleSort: {
            column: "original",
            direction: 0
        },

        expandedRules: new Set()
    };

    let rawFoxReplaceDatabase = null;

    let adaptedDatabase = {
        groups: []
    };

    function readStorage(key, fallback = null) {
        try {
            const value = GM_getValue(key, fallback);

            if (typeof value === "string") {
                const trimmed = value.trim();

                if (!trimmed) {
                    return fallback;
                }

                try {
                    return JSON.parse(trimmed);
                } catch {
                    return value;
                }
            }

            return value;
        } catch (error) {
            console.error("WNC storage read failed:", key, error);
            return fallback;
        }
    }

    function writeStorage(key, value) {
        try {
            GM_setValue(key, value);
            return true;
        } catch (error) {
            console.error("WNC storage write failed:", key, error);
            return false;
        }
    }

    function normalizeInputType(value) {
        const text = String(value ?? "")
            .trim()
            .toLowerCase();

        if (
            value === 1 ||
            text === "1" ||
            text === "whole" ||
            text === "wholeword" ||
            text === "whole-word" ||
            text === "whole word" ||
            text === "whole words" ||
            text === "wholewords"
        ) {
            return "wholewords";
        }

        if (
            value === 2 ||
            text === "2" ||
            text === "regexp" ||
            text === "regex" ||
            text === "regular expression"
        ) {
            return "regexp";
        }

        return "text";
    }

    function normalizeOutputType(value) {
        if (value === undefined || value === null) {
            return 0;
        }

        const text = String(value)
            .trim()
            .toLowerCase();

        if (/^\d+$/.test(text)) {
            return Number(text);
        }

        return value;
    }

    function firstDefined(object, keys, fallback = undefined) {
        if (!object || typeof object !== "object") {
            return fallback;
        }

        for (const key of keys) {
            if (
                Object.prototype.hasOwnProperty.call(object, key) &&
                object[key] !== undefined &&
                object[key] !== null
            ) {
                return object[key];
            }
        }

        return fallback;
    }

    function normalizeBoolean(value, fallback = false) {
        if (value === undefined || value === null) {
            return fallback;
        }

        if (typeof value === "boolean") {
            return value;
        }

        if (typeof value === "number") {
            return value !== 0;
        }

        const text = String(value)
            .trim()
            .toLowerCase();

        if (
            text === "true" ||
            text === "yes" ||
            text === "on" ||
            text === "enabled" ||
            text === "enable" ||
            text === "1"
        ) {
            return true;
        }

        if (
            text === "false" ||
            text === "no" ||
            text === "off" ||
            text === "disabled" ||
            text === "disable" ||
            text === "0"
        ) {
            return false;
        }

        return fallback;
    }

    function normalizeRule(rawRule, ruleIndex, groupIndex) {
        if (!rawRule || typeof rawRule !== "object") {
            return null;
        }

        const input = firstDefined(
            rawRule,
            [
                "input",
                "Input",
                "find",
                "Find",
                "pattern",
                "Pattern",
                "from",
                "From"
            ],
            ""
        );

        const output = firstDefined(
            rawRule,
            [
                "output",
                "Output",
                "replace",
                "Replace",
                "replacement",
                "Replacement",
                "to",
                "To"
            ],
            ""
        );

        const inputTypeRaw = firstDefined(
            rawRule,
            [
                "inputType",
                "InputType",
                "type",
                "Type"
            ],
            "text"
        );

        const outputTypeRaw = firstDefined(
            rawRule,
            [
                "outputType",
                "OutputType"
            ],
            0
        );

        let inputType = normalizeInputType(inputTypeRaw);

        const explicitRegexp = firstDefined(
            rawRule,
            [
                "regexp",
                "regex",
                "isRegexp",
                "isRegex",
                "regularExpression"
            ],
            undefined
        );

        if (
            normalizeBoolean(explicitRegexp, false)
        ) {
            inputType = "regexp";
        }

        const caseSensitive = normalizeBoolean(
            firstDefined(
                rawRule,
                [
                    "caseSensitive",
                    "CaseSensitive",
                    "matchCase",
                    "MatchCase"
                ],
                false
            ),
            false
        );

        let enabled = normalizeBoolean(
            firstDefined(
                rawRule,
                [
                    "enabled",
                    "Enabled",
                    "active",
                    "Active"
                ],
                true
            ),
            true
        );

        if (
            Object.prototype.hasOwnProperty.call(rawRule, "disabled") &&
            normalizeBoolean(rawRule.disabled, false)
        ) {
            enabled = false;
        }

        return {
            raw: rawRule,
            groupIndex,
            ruleIndex,
            input: String(input ?? ""),
            output: String(output ?? ""),
            inputType,
            outputType: normalizeOutputType(outputTypeRaw),
            caseSensitive,
            enabled,
            html: firstDefined(
                rawRule,
                [
                    "html",
                    "HTML"
                ],
                0
            )
        };
    }

    function normalizeUrls(value) {
        if (value === undefined || value === null) {
            return [];
        }

        if (Array.isArray(value)) {
            return value
                .map(item => String(item ?? "").trim())
                .filter(Boolean);
        }

        if (typeof value === "string") {
            return value
                .split(/\r?\n/)
                .map(item => item.trim())
                .filter(Boolean);
        }

        return [];
    }

    function normalizeGroup(rawGroup, groupIndex) {
        if (!rawGroup || typeof rawGroup !== "object") {
            return null;
        }

        const name = String(
            firstDefined(
                rawGroup,
                [
                    "name",
                    "Name",
                    "title",
                    "Title",
                    "groupName",
                    "GroupName"
                ],
                ""
            ) ?? ""
        );

        const urls = normalizeUrls(
            firstDefined(
                rawGroup,
                [
                    "urls",
                    "URLs",
                    "urlPatterns",
                    "URLPatterns",
                    "sites",
                    "Sites"
                ],
                []
            )
        );

        const rawRules = firstDefined(
            rawGroup,
            [
                "substitutions",
                "Substitutions",
                "rules",
                "Rules",
                "entries",
                "Entries",
                "replacements",
                "Replacements"
            ],
            []
        );

        if (!Array.isArray(rawRules)) {
            return null;
        }

        const rules = rawRules
            .map((rule, ruleIndex) =>
                normalizeRule(rule, ruleIndex, groupIndex)
            )
            .filter(Boolean);

        const enabled = normalizeBoolean(
            firstDefined(
                rawGroup,
                [
                    "enabled",
                    "Enabled",
                    "active",
                    "Active"
                ],
                true
            ),
            true
        );

        const disabled = normalizeBoolean(
            firstDefined(
                rawGroup,
                [
                    "disabled",
                    "Disabled"
                ],
                false
            ),
            false
        );

        return {
            raw: rawGroup,
            index: groupIndex,
            name,
            urls,
            rules,
            enabled: disabled ? false : enabled,

            mode: firstDefined(
                rawGroup,
                [
                    "mode",
                    "Mode"
                ],
                null
            ),

            pageLoad: normalizeBoolean(
                firstDefined(
                    rawGroup,
                    [
                        "pageLoad",
                        "PageLoad"
                    ],
                    true
                ),
                true
            ),

            auto: normalizeBoolean(
                firstDefined(
                    rawGroup,
                    [
                        "auto",
                        "Auto"
                    ],
                    true
                ),
                true
            ),

            html: firstDefined(
                rawGroup,
                [
                    "html",
                    "HTML"
                ],
                0
            )
        };
    }

    function findGroupArray(database) {
        if (!database || typeof database !== "object") {
            return null;
        }

        const directKeys = [
            "groups",
            "Groups",
            "groupList",
            "GroupList",
            "groupsList",
            "GroupsList"
        ];

        for (const key of directKeys) {
            if (Array.isArray(database[key])) {
                return database[key];
            }
        }

        const wrapperKeys = [
            "data",
            "Data",
            "database",
            "Database",
            "settings",
            "Settings",
            "foxreplace",
            "FoxReplace"
        ];

        for (const key of wrapperKeys) {
            const child = database[key];

            if (!child || typeof child !== "object") {
                continue;
            }

            const result = findGroupArray(child);

            if (Array.isArray(result)) {
                return result;
            }
        }

        for (const value of Object.values(database)) {
            if (!Array.isArray(value)) {
                continue;
            }

            const looksLikeGroups = value.some(item => {
                if (!item || typeof item !== "object") {
                    return false;
                }

                return (
                    Array.isArray(item.substitutions) ||
                    Array.isArray(item.Substitutions) ||
                    Array.isArray(item.rules) ||
                    Array.isArray(item.Rules) ||
                    Array.isArray(item.entries) ||
                    Array.isArray(item.Entries)
                );
            });

            if (looksLikeGroups) {
                return value;
            }
        }

        return null;
    }

    function adaptFoxReplaceDatabase(rawDatabase) {
        if (!rawDatabase || typeof rawDatabase !== "object") {
            throw new Error(
                "The imported value is not a JSON object."
            );
        }

        const groups = findGroupArray(rawDatabase);

        if (!Array.isArray(groups)) {
            throw new Error(
                "No FoxReplace group array was found."
            );
        }

        const adaptedGroups = [];

        for (let index = 0; index < groups.length; index++) {
            const adapted = normalizeGroup(
                groups[index],
                index
            );

            if (adapted) {
                adaptedGroups.push(adapted);
            }
        }

        if (
            groups.length > 0 &&
            adaptedGroups.length === 0
        ) {
            throw new Error(
                "A group array was found, but none of its groups had a recognizable FoxReplace rule structure."
            );
        }

        return {
            raw: rawDatabase,

            version: firstDefined(
                rawDatabase,
                [
                    "version",
                    "Version"
                ],
                null
            ),

            groups: adaptedGroups
        };
    }

    function countAdaptedRules(database) {
        if (!database || !Array.isArray(database.groups)) {
            return 0;
        }

        return database.groups.reduce(
            (total, group) =>
                total +
                (
                    Array.isArray(group.rules)
                        ? group.rules.length
                        : 0
                ),
            0
        );
    }

    function describeDatabase(database) {
        if (!database) {
            return {
                groups: 0,
                rules: 0,
                version: null
            };
        }

        return {
            groups: Array.isArray(database.groups)
                ? database.groups.length
                : 0,

            rules: countAdaptedRules(database),

            version: database.version
        };
    }

    function loadNormalDatabase() {
        const stored = readStorage(DB_KEY, null);

        if (!stored) {
            return null;
        }

        try {
            return adaptFoxReplaceDatabase(stored);
        } catch (error) {
            console.warn(
                "WNC normal database could not be adapted:",
                error
            );

            return null;
        }
    }

    function loadLastImportedDatabase() {
        const stored = readStorage(
            LAST_IMPORTED_DB_KEY,
            null
        );

        if (!stored) {
            return null;
        }

        try {
            return adaptFoxReplaceDatabase(stored);
        } catch (error) {
            console.warn(
                "WNC last imported database could not be adapted:",
                error
            );

            return null;
        }
    }

    function loadActiveDatabase() {
        return (
            loadLastImportedDatabase() ||
            loadNormalDatabase() ||
            {
                raw: {
                    groups: []
                },

                version: null,

                groups: []
            }
        );
    }

    let db = loadActiveDatabase();

    function parseImportedText(text) {
        let cleaned = String(text ?? "")
            .replace(/^\uFEFF/, "")
            .trim();

        if (!cleaned) {
            throw new Error(
                "The selected file is empty."
            );
        }

        let parsed;

        try {
            parsed = JSON.parse(cleaned);
        } catch (error) {
            throw new Error(
                "The selected file is not valid JSON."
            );
        }

        if (typeof parsed === "string") {
            const secondPass = parsed.trim();

            if (
                secondPass.startsWith("{") ||
                secondPass.startsWith("[")
            ) {
                try {
                    parsed = JSON.parse(
                        secondPass
                    );
                } catch {
                    throw new Error(
                        "The file contains a JSON string, but the embedded JSON is invalid."
                    );
                }
            }
        }

        return parsed;
    }

    function readFileText(file) {
        if (
            file &&
            typeof file.text === "function"
        ) {
            return file.text();
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = () => {
                resolve(
                    String(
                        reader.result ?? ""
                    )
                );
            };

            reader.onerror = () => {
                reject(
                    new Error(
                        "The browser could not read the selected file."
                    )
                );
            };

            reader.readAsText(file);
        });
    }

    function openImportPicker() {
        const input = document.createElement("input");

        input.type = "file";
        input.accept = ".json,application/json";
        input.style.display = "none";

        document.body.appendChild(input);

        input.addEventListener(
            "change",
            async () => {
                const file =
                    input.files &&
                    input.files[0];

                if (!file) {
                    input.remove();
                    return;
                }

                try {
                    const text =
                        await readFileText(file);

                    const parsed =
                        parseImportedText(text);

                    const adapted =
                        adaptFoxReplaceDatabase(
                            parsed
                        );

                    const saved =
                        writeStorage(
                            LAST_IMPORTED_DB_KEY,
                            parsed
                        );

                    if (!saved) {
                        throw new Error(
                            "The imported database could not be saved."
                        );
                    }

                    rawFoxReplaceDatabase =
                        parsed;

                    adaptedDatabase =
                        adapted;

                    db = adapted;

                    state.screen =
                        "candidates";

                    state.groupIndex =
                        null;

                    state.expandedRules.clear();

                    analyzePage();
                    render();

                    const info =
                        describeDatabase(
                            adapted
                        );

                    alert(
                        "FoxReplace JSON imported successfully.\n\n" +
                        `Groups loaded: ${info.groups}\n` +
                        `Rules loaded: ${info.rules}` +
                        (
                            info.version
                                ? `\nFoxReplace version: ${info.version}`
                                : ""
                        )
                    );
                } catch (error) {
                    console.error(
                        "WNC import error:",
                        error
                    );

                    alert(
                        "Webnovel Cleaner could not import that FoxReplace JSON.\n\n" +
                        String(
                            error?.message ||
                            error
                        )
                    );
                } finally {
                    input.remove();
                }
            },
            {
                once: true
            }
        );

        input.click();
    }

    function escapeRegex(text) {
        return String(text)
            .replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );
    }

    function wildcardToRegex(pattern) {
        return String(pattern)
            .split("*")
            .map(escapeRegex)
            .join(".*");
    }

    function urlPatternMatches(pattern) {
        const currentUrl =
            String(location.href);

        const currentHostname =
            String(location.hostname);

        const currentOrigin =
            String(location.origin);

        const rawPattern =
            String(pattern ?? "")
                .trim();

        if (!rawPattern) {
            return false;
        }

        if (
            rawPattern.length >= 2 &&
            rawPattern.startsWith("/") &&
            rawPattern.lastIndexOf("/") > 0
        ) {
            const lastSlash =
                rawPattern.lastIndexOf("/");

            const expression =
                rawPattern.slice(
                    1,
                    lastSlash
                );

            const flags =
                rawPattern.slice(
                    lastSlash + 1
                );

            try {
                return new RegExp(
                    expression,
                    flags
                ).test(currentUrl);
            } catch {
                return false;
            }
        }

        if (rawPattern === currentUrl) {
            return true;
        }

        if (
            rawPattern === currentHostname
        ) {
            return true;
        }

        if (
            rawPattern === currentOrigin
        ) {
            return true;
        }

        if (rawPattern.includes("*")) {
            try {
                const expression =
                    "^" +
                    wildcardToRegex(
                        rawPattern
                    ) +
                    "$";

                return new RegExp(
                    expression,
                    "i"
                ).test(currentUrl);
            } catch {
                return false;
            }
        }

        if (
            rawPattern.includes("://") ||
            rawPattern.startsWith("/")
        ) {
            return currentUrl.includes(
                rawPattern
            );
        }

        return (
            currentHostname
                .toLowerCase()
                .includes(
                    rawPattern.toLowerCase()
                )
        );
    }

    function groupMatchesCurrentSite(group) {
        if (!group || !group.enabled) {
            return false;
        }

        if (
            Array.isArray(group.urls) &&
            group.urls.length > 0
        ) {
            return group.urls.some(
                urlPatternMatches
            );
        }

        return true;
    }

    function getCurrentSiteGroups() {
        if (
            !db ||
            !Array.isArray(db.groups)
        ) {
            return [];
        }

        return db.groups.filter(
            groupMatchesCurrentSite
        );
    }

    function getCurrentSiteRules() {
        const groups =
            getCurrentSiteGroups();

        const result = [];

        for (const group of groups) {
            if (
                !Array.isArray(group.rules)
            ) {
                continue;
            }

            for (const rule of group.rules) {
                if (!rule.enabled) {
                    continue;
                }

                result.push({
                    group,
                    rule
                });
            }
        }

        return result;
    }

    function elementHasUsefulText(element) {
        if (!element) {
            return false;
        }

        const text =
            String(
                element.innerText ??
                element.textContent ??
                ""
            ).trim();

        return text.length >= 100;
    }

    function analyzePage() {
        /*
         * Implemented in Part 6.
         */
    }

    function render() {
        /*
         * Implemented in Part 7.
         */
    }

    /**********************************************************************
     * 19. CANDIDATE REGEX
     **********************************************************************/

    /*
     * Resetting lastIndex is important because CANDIDATE_REGEX is global.
     *
     * Without this, repeated calls to scan the same page can begin at an
     * unexpected position.
     */
    function resetCandidateRegex() {
        CANDIDATE_REGEX.lastIndex = 0;
    }


    /**********************************************************************
     * 24. STANDALONE FILTERING
     **********************************************************************/

    function shouldFilterStandaloneCandidate(
        candidate
    ) {
        const normalized =
            String(candidate ?? "")
                .trim()
                .toLowerCase();

        if (!normalized) {
            return true;
        }

        /*
         * FILTER_WORDS and FILTER_ALONE apply ONLY when the complete
         * candidate is one word.
         *
         * Therefore:
         *
         *   The          → filtered
         *   He           → filtered
         *
         * but:
         *
         *   The Dragon   → retained
         *   He Tao       → retained
         */
        if (
            !/\s/.test(normalized)
        ) {
            if (
                FILTER_WORDS.has(
                    normalized
                )
            ) {
                return true;
            }

            if (
                FILTER_ALONE.has(
                    normalized
                )
            ) {
                return true;
            }
        }

        return false;
    }


    /**********************************************************************
     * 25. EXACT CANDIDATE SCANNER
     **********************************************************************/

    function scanCandidateOccurrences(
        text
    ) {
        const occurrences = [];

        if (!text) {
            return occurrences;
        }

        resetCandidateRegex();

        let match;

        while (
            (
                match =
                    CANDIDATE_REGEX.exec(
                        text
                    )
            ) !== null
        ) {
            /*
             * The complete candidate is capture group 1.
             *
             * We intentionally do not break the phrase into individual
             * words.
             */
            const candidate =
                String(
                    match[1] ?? ""
                ).trim();

            if (!candidate) {
                continue;
            }

            /*
             * Standalone filters are applied BEFORE normalization.
             *
             * Larger phrases remain intact.
             */
            if (
                shouldFilterStandaloneCandidate(
                    candidate
                )
            ) {
                continue;
            }

            occurrences.push({
                text: candidate,

                start: match.index,

                end:
                    match.index +
                    match[0].length
            });
        }

        return occurrences;
    }


    /**********************************************************************
     * 26. TOKENIZATION FOR NORMALIZATION
     **********************************************************************/

    function splitCandidateTokens(
        candidate
    ) {
        return String(
            candidate ?? ""
        )
            .trim()
            .split(/\s+/)
            .filter(Boolean);
    }


    /**********************************************************************
     * 27. TOKEN NORMALIZATION
     **********************************************************************/

    /*
     * This function normalizes ONLY candidate occurrences.
     *
     * It must NEVER be used on FoxReplace rule inputs.
     */

    function normalizeCandidateToken(
        token
    ) {
        let word =
            String(
                token ?? ""
            ).trim();

        if (!word) {
            return "";
        }

        /*
         * Normalize curly apostrophes.
         */
        word =
            word.replace(
                /[’‘]/g,
                "'"
            );

        /*
         * Preserve punctuation such as:
         *
         *   U.S.
         *   Mr.
         *   X.
         */
        const lower =
            word.toLowerCase();

        /*
         * Explicit proper-name exceptions.
         *
         * These names must not be interpreted as plural nouns.
         */
        if (
            SINGULARIZATION_EXCEPTIONS.has(
                lower
            )
        ) {
            return word;
        }

        /*
         * Possessive:
         *
         * Dragon's → Dragon
         * James'   → James
         * Dragons' → Dragons
         */
        if (
            /['’]s$/i.test(word)
        ) {
            word =
                word.replace(
                    /['’]s$/i,
                    ""
                );
        } else if (
            /s['’]$/i.test(word)
        ) {
            /*
             * Dragons' → Dragons
             *
             * The plural is handled below.
             */
            word =
                word.replace(
                    /['’]$/i,
                    ""
                );
        }

        const lowerAfterPossessive =
            word.toLowerCase();

        /*
         * Never singularize these after possessive processing either.
         */
        if (
            SINGULARIZATION_EXCEPTIONS.has(
                lowerAfterPossessive
            )
        ) {
            return word;
        }

        /*
         * Do not singularize very short words.
         */
        if (
            word.length <= 3
        ) {
            return word;
        }

        /*
         * Common plural handling.
         *
         * This is intentionally conservative. WNC is trying to merge
         * ordinary name/title variants, not perform full English
         * morphological analysis.
         */

        /*
         * -ies:
         *
         * Cities → City
         */
        if (
            /[^aeiou]ies$/i.test(word) &&
            word.length > 4
        ) {
            return word.replace(
                /ies$/i,
                "y"
            );
        }

        /*
         * -ses / -xes / -zes / -ches / -shes
         *
         * Examples:
         *   Boxes → Box
         *   Classes → Class
         *
         * Do not apply this blindly to all words ending in s.
         */
        if (
            /(ses|xes|zes|ches|shes)$/i.test(
                word
            )
        ) {
            const candidate =
                word.replace(
                    /es$/i,
                    ""
                );

            if (
                candidate.length >= 3
            ) {
                return candidate;
            }
        }

        /*
         * Ordinary plural -s.
         *
         * Avoid:
         *   James
         *   Davis
         *   Lucas
         *   Carlos
         *   Thomas
         *
         * Those were handled by the explicit exception list.
         */
        if (
            /s$/i.test(word) &&
            !/ss$/i.test(word) &&
            !/[aeiou]us$/i.test(word) &&
            !/is$/i.test(word) &&
            !/os$/i.test(word) &&
            !/as$/i.test(word)
        ) {
            const candidate =
                word.slice(
                    0,
                    -1
                );

            if (
                candidate.length >= 3
            ) {
                return candidate;
            }
        }

        return word;
    }


    /**********************************************************************
     * 28. FULL CANDIDATE NORMALIZATION
     **********************************************************************/

    function normalizeCandidate(
        candidate
    ) {
        return splitCandidateTokens(
            candidate
        )
            .map(
                normalizeCandidateToken
            )
            .filter(Boolean)
            .join(" ");
    }


    /**********************************************************************
     * 29. CANDIDATE DISPLAY / CANONICAL FORM
     **********************************************************************/

    /*
     * The normalized form is the canonical clustering key.
     *
     * We retain the first observed display form separately.
     */
    function createCandidateOccurrence(
        text
    ) {
        return {
            original: text,

            normalized:
                normalizeCandidate(
                    text
                )
        };
    }


    /**********************************************************************
     * 30. MERGE DUPLICATE NORMALIZED CANDIDATES
     **********************************************************************/

    function mergeCandidateOccurrences(
        occurrences
    ) {
        const map = new Map();

        for (
            const occurrence
            of occurrences
        ) {
            const original =
                String(
                    occurrence?.text ??
                    ""
                ).trim();

            if (!original) {
                continue;
            }

            const normalized =
                normalizeCandidate(
                    original
                );

            if (!normalized) {
                continue;
            }

            if (
                shouldFilterStandaloneCandidate(
                    normalized
                )
            ) {
                continue;
            }

            if (!map.has(normalized)) {
                map.set(
                    normalized,
                    {
                        name: original,

                        normalized,

                        frequency: 0,

                        variants: new Map(),

                        occurrences: []
                    }
                );
            }

            const candidate =
                map.get(
                    normalized
                );

            candidate.frequency++;

            candidate.occurrences.push(
                occurrence
            );

            const oldVariantCount =
                candidate.variants.get(
                    original
                ) || 0;

            candidate.variants.set(
                original,
                oldVariantCount + 1
            );
        }

        return Array.from(
            map.values()
        );
    }


    /**********************************************************************
     * 31. DISPLAY NAME SELECTION
     **********************************************************************/

    /*
     * When several spelling variants normalize together, select the
     * most frequently observed original form.
     *
     * Ties retain first-discovered order.
     */
    function chooseCandidateDisplayName(
        candidate
    ) {
        if (
            !candidate ||
            !(candidate.variants instanceof Map)
        ) {
            return candidate?.name || "";
        }

        let bestName =
            candidate.name || "";

        let bestFrequency =
            0;

        for (
            const [
                name,
                frequency
            ]
            of candidate.variants
        ) {
            if (
                frequency >
                bestFrequency
            ) {
                bestName =
                    name;

                bestFrequency =
                    frequency;
            }
        }

        return bestName;
    }


    function finalizeCandidateNames(
        candidates
    ) {
        for (
            const candidate
            of candidates
        ) {
            candidate.name =
                chooseCandidateDisplayName(
                    candidate
                );
        }

        return candidates;
    }


    /**********************************************************************
     * 32. RAW SCAN PIPELINE
     **********************************************************************/

    function scanChapterCandidates(
        text
    ) {
        const occurrences =
            scanCandidateOccurrences(
                text
            );

        const merged =
            mergeCandidateOccurrences(
                occurrences
            );

        finalizeCandidateNames(
            merged
        );

        /*
         * Frequency order here is intentional.
         *
         * This is the input order for the hierarchy-building process.
         */
        merged.sort(
            (a, b) =>
                b.frequency -
                a.frequency
        );

        return merged;
    }


    /**********************************************************************
     * 33. CHAPTER SCAN DIAGNOSTICS
     **********************************************************************/

function getChapterScanInfo() {
    const text =
        document.body?.innerText ||
        document.body?.textContent ||
        "";

    return {
        container: document.body,
        text: text
            .replace(/\u00A0/g, " ")
            .replace(/\r/g, "")
            .trim()
    };
}


    /**********************************************************************
     * 34. END PART 2
     **********************************************************************/
      /**********************************************************************
     * 35. CLUSTERING CONFIGURATION
     **********************************************************************/

    /*
     * A candidate belongs to another candidate's cluster when their
     * normalized token sequences are close enough to be connected by
     * token links.
     *
     * Maximum direct token distance:
     *
     *     2 token links
     *
     * The hierarchy is built in frequency order:
     *
     *     highest-frequency candidate → root
     *     next highest unclustered candidate → next root
     *     etc.
     *
     * Once a candidate is attached to a root, it can also bring candidates
     * within two token links of itself into the same cluster.
     *
     * Therefore the cluster may grow through a chain, but each individual
     * link is limited to two token links.
     */
    const MAX_CLUSTER_TOKEN_LINKS = 2;


    /**********************************************************************
     * 36. TOKEN NORMALIZATION FOR CLUSTERING
     **********************************************************************/

    function candidateTokens(
        candidate
    ) {
        return splitCandidateTokens(
            candidate?.normalized ??
            candidate?.name ??
            ""
        )
            .map(
                token =>
                    token.toLowerCase()
            )
            .filter(Boolean);
    }


    /**********************************************************************
     * 37. TOKEN DISTANCE
     **********************************************************************/

    /*
     * We need a token-level distance rather than a character-level
     * distance.
     *
     * Examples:
     *
     *     John Smith
     *     John Smith Jr
     *
     * are close.
     *
     *     John Smith
     *     John
     *
     * are also close.
     *
     *     John Smith
     *     Zhang Wei
     *
     * are not.
     *
     * This function computes a minimum number of token insertions,
     * deletions, and substitutions.
     */

    function tokenEditDistance(
        leftTokens,
        rightTokens
    ) {
        const left =
            Array.isArray(leftTokens)
                ? leftTokens
                : [];

        const right =
            Array.isArray(rightTokens)
                ? rightTokens
                : [];

        const rows =
            left.length + 1;

        const columns =
            right.length + 1;

        const matrix =
            Array.from(
                {
                    length: rows
                },
                () =>
                    new Array(
                        columns
                    ).fill(0)
            );

        for (
            let i = 0;
            i < rows;
            i++
        ) {
            matrix[i][0] = i;
        }

        for (
            let j = 0;
            j < columns;
            j++
        ) {
            matrix[0][j] = j;
        }

        for (
            let i = 1;
            i < rows;
            i++
        ) {
            for (
                let j = 1;
                j < columns;
                j++
            ) {
                const same =
                    left[i - 1] ===
                    right[j - 1];

                const substitutionCost =
                    same
                        ? 0
                        : 1;

                matrix[i][j] =
                    Math.min(
                        matrix[i - 1][j] +
                            1,

                        matrix[i][j - 1] +
                            1,

                        matrix[i - 1][j - 1] +
                            substitutionCost
                    );
            }
        }

        return matrix[
            rows - 1
        ][
            columns - 1
        ];
    }


    /**********************************************************************
     * 38. SUBSEQUENCE / TOKEN-LINK DISTANCE
     **********************************************************************/

    /*
     * WNC clustering is intended for name/title variants rather than
     * unrestricted fuzzy matching.
     *
     * This helper therefore treats a contained token sequence as a
     * particularly strong relationship.
     *
     * Examples:
     *
     *     "Wei"
     *     "Zhang Wei"
     *
     * have a short relationship.
     *
     * Likewise:
     *
     *     "John Smith"
     *     "John Smith Jr"
     *
     * are closely related.
     */

    function isTokenSubsequence(
        shorter,
        longer
    ) {
        if (
            shorter.length >
            longer.length
        ) {
            return false;
        }

        if (
            shorter.length === 0
        ) {
            return true;
        }

        let shortIndex = 0;

        for (
            const token
            of longer
        ) {
            if (
                token ===
                shorter[shortIndex]
            ) {
                shortIndex++;

                if (
                    shortIndex ===
                    shorter.length
                ) {
                    return true;
                }
            }
        }

        return false;
    }


    /**********************************************************************
     * 39. CANDIDATE TOKEN LINK DISTANCE
     **********************************************************************/

    function candidateTokenLinkDistance(
        left,
        right
    ) {
        const leftTokens =
            candidateTokens(
                left
            );

        const rightTokens =
            candidateTokens(
                right
            );

        if (
            !leftTokens.length ||
            !rightTokens.length
        ) {
            return Infinity;
        }

        /*
         * Exact normalized candidate.
         */
        if (
            left.normalized ===
            right.normalized
        ) {
            return 0;
        }

        /*
         * Containment is important for names.
         */
        if (
            isTokenSubsequence(
                leftTokens,
                rightTokens
            ) ||
            isTokenSubsequence(
                rightTokens,
                leftTokens
            )
        ) {
            return Math.abs(
                leftTokens.length -
                rightTokens.length
            );
        }

        return tokenEditDistance(
            leftTokens,
            rightTokens
        );
    }


    /**********************************************************************
     * 40. DIRECT CLUSTER RELATIONSHIP
     **********************************************************************/

    function candidatesAreClusterLinked(
        left,
        right
    ) {
        const distance =
            candidateTokenLinkDistance(
                left,
                right
            );

        return (
            distance <=
            MAX_CLUSTER_TOKEN_LINKS
        );
    }


    /**********************************************************************
     * 41. CLUSTER OBJECT
     **********************************************************************/

    function createCluster(
        root,
        clusterId
    ) {
        return {
            id: clusterId,

            root,

            members: [],

            memberKeys: new Set()
        };
    }


    function addCandidateToCluster(
        cluster,
        candidate
    ) {
        if (!cluster || !candidate) {
            return false;
        }

        const key =
            candidate.normalized;

        if (
            cluster.memberKeys.has(
                key
            )
        ) {
            return false;
        }

        cluster.memberKeys.add(
            key
        );

        cluster.members.push(
            candidate
        );

        return true;
    }


    /**********************************************************************
     * 42. HIERARCHICAL CLUSTERING
     **********************************************************************/

    /*
     * IMPORTANT:
     *
     * This is intentionally NOT a conventional all-pairs clustering
     * algorithm.
     *
     * The hierarchy is determined by frequency.
     *
     * Example:
     *
     *     100 × Zhang Wei
     *      60 × Zhang
     *      40 × Wei
     *      20 × Zhang Wei Jr
     *
     * Zhang Wei becomes the first root.
     *
     * Candidates linked to it become members of that cluster.
     *
     * After that, the highest-frequency candidate that remains
     * unclustered becomes the next root.
     *
     * This preserves the requested frequency hierarchy.
     */

    function buildCandidateClusters(
        candidates
    ) {
        if (
            !Array.isArray(candidates) ||
            !candidates.length
        ) {
            return {
                clusters: [],

                unclustered: [],

                assigned: new Set()
            };
        }

        /*
         * Work from highest frequency to lowest frequency.
         *
         * Stable tie behavior is preserved by retaining the incoming
         * order.
         */
        const ordered =
            candidates
                .map(
                    (
                        candidate,
                        index
                    ) => ({
                        candidate,
                        originalIndex: index
                    })
                )
                .sort(
                    (a, b) => {
                        if (
                            b.candidate.frequency !==
                            a.candidate.frequency
                        ) {
                            return (
                                b.candidate.frequency -
                                a.candidate.frequency
                            );
                        }

                        return (
                            a.originalIndex -
                            b.originalIndex
                        );
                    }
                );

        const assigned =
            new Set();

        const clusters = [];

        let nextClusterId = 1;


        /******************************************************************
         * Select roots in descending frequency order.
         ******************************************************************/

        for (
            const item
            of ordered
        ) {
            const root =
                item.candidate;

            const rootKey =
                root.normalized;

            if (
                assigned.has(
                    rootKey
                )
            ) {
                continue;
            }

            const cluster =
                createCluster(
                    root,
                    nextClusterId++
                );

            addCandidateToCluster(
                cluster,
                root
            );

            assigned.add(
                rootKey
            );

            /*
             * We maintain a queue of cluster members.
             *
             * This permits the requested chain behavior:
             *
             *     root
             *       ↓ within 2 links
             *     member A
             *       ↓ within 2 links
             *     member B
             *
             * B can therefore belong to the root's cluster even if B
             * is not directly within two links of the root.
             */
            const queue = [
                root
            ];

            let queueIndex = 0;

            while (
                queueIndex <
                queue.length
            ) {
                const source =
                    queue[
                        queueIndex++
                    ];

                /*
                 * Scan frequency-ordered candidates.
                 *
                 * We intentionally do not use an all-pairs union-find
                 * because that would lose the frequency hierarchy.
                 */
                for (
                    const candidateItem
                    of ordered
                ) {
                    const candidate =
                        candidateItem.candidate;

                    const candidateKey =
                        candidate.normalized;

                    if (
                        assigned.has(
                            candidateKey
                        )
                    ) {
                        continue;
                    }

                    if (
                        candidatesAreClusterLinked(
                            source,
                            candidate
                        )
                    ) {
                        addCandidateToCluster(
                            cluster,
                            candidate
                        );

                        assigned.add(
                            candidateKey
                        );

                        queue.push(
                            candidate
                        );
                    }
                }
            }

            /*
             * Cluster members are sorted by frequency, not by the order
             * in which the chain happened to discover them.
             */
            cluster.members.sort(
                (a, b) =>
                    b.frequency -
                    a.frequency
            );

            clusters.push(
                cluster
            );
        }


        /******************************************************************
         * Candidates that never became part of a cluster.
         *
         * In normal operation a root always creates a cluster, so the
         * "unclustered" list is primarily useful for the 5% rule and
         * diagnostic purposes.
         ******************************************************************/

        const unclustered =
            candidates.filter(
                candidate =>
                    !assigned.has(
                        candidate.normalized
                    )
            );

        return {
            clusters,

            unclustered,

            assigned
        };
    }


    /**********************************************************************
     * 43. TRUE UNCLUSTERED CANDIDATES
     **********************************************************************/

    /*
     * The hierarchical algorithm above gives every surviving candidate
     * a root. However, WNC's 5% rule specifically concerns candidates
     * that cannot form a meaningful cluster with another candidate.
     *
     * Therefore we identify isolated candidates separately.
     */

    function findIsolatedCandidates(
        candidates
    ) {
        const isolated = [];

        for (
            const candidate
            of candidates
        ) {
            let linked = false;

            for (
                const other
                of candidates
            ) {
                if (
                    candidate ===
                    other
                ) {
                    continue;
                }

                if (
                    candidatesAreClusterLinked(
                        candidate,
                        other
                    )
                ) {
                    linked = true;
                    break;
                }
            }

            if (!linked) {
                isolated.push(
                    candidate
                );
            }
        }

        return isolated;
    }


    /**********************************************************************
     * 44. 5% UNCLUSTERED FREQUENCY FILTER
     **********************************************************************/

    /*
     * Only genuinely isolated candidates are subject to the cutoff.
     *
     * The highest frequency candidate establishes the maximum.
     *
     * Anything isolated below 5% of that maximum is removed.
     *
     * Candidates inside a cluster are NEVER removed by this rule.
     */

    function applyUnclusteredFrequencyFilter(
        candidates
    ) {
        if (
            !Array.isArray(candidates) ||
            !candidates.length
        ) {
            return {
                candidates: [],

                removed: [],

                isolated: [],

                maximumFrequency: 0
            };
        }

        const maximumFrequency =
            candidates.reduce(
                (
                    maximum,
                    candidate
                ) =>
                    Math.max(
                        maximum,
                        Number(
                            candidate.frequency
                        ) || 0
                    ),
                0
            );

        if (
            maximumFrequency <= 0
        ) {
            return {
                candidates:
                    candidates.slice(),

                removed: [],

                isolated: [],

                maximumFrequency
            };
        }

        const isolated =
            findIsolatedCandidates(
                candidates
            );

        const isolatedKeys =
            new Set(
                isolated.map(
                    candidate =>
                        candidate.normalized
                )
            );

        const threshold =
            maximumFrequency *
            UNCLUSTERED_FREQUENCY_RATIO;

        const kept = [];

        const removed = [];

        for (
            const candidate
            of candidates
        ) {
            if (
                !isolatedKeys.has(
                    candidate.normalized
                )
            ) {
                /*
                 * Clustered candidates are always retained.
                 */
                kept.push(
                    candidate
                );

                continue;
            }

            if (
                candidate.frequency <
                threshold
            ) {
                removed.push(
                    candidate
                );
            } else {
                kept.push(
                    candidate
                );
            }
        }

        return {
            candidates: kept,

            removed,

            isolated,

            maximumFrequency,

            threshold
        };
    }


    /**********************************************************************
     * 45. COMPLETE CANDIDATE CLUSTER PIPELINE
     **********************************************************************/

function processCandidateClusters(
    candidates
) {
    const clustering =
        buildCandidateClusters(
            candidates
        );

    const filtered =
        applyUnclusteredFrequencyFilter(
            candidates
        );

    const finalClustering =
        buildCandidateClusters(
            filtered.candidates
        );

    return {
        candidates:
            filtered.candidates,

        removed:
            filtered.removed,

        clusters:
            finalClustering.clusters,

        initialClusters:
            clustering.clusters,

        isolated:
            filtered.isolated,

        maximumFrequency:
            filtered.maximumFrequency,

        threshold:
            filtered.threshold || 0
    };
}

    /**********************************************************************
     * 46. CLUSTER LOOKUP
     **********************************************************************/

    function findClusterForCandidate(
        clusters,
        normalized
    ) {
        if (
            !Array.isArray(clusters)
        ) {
            return null;
        }

        for (
            const cluster
            of clusters
        ) {
            if (
                cluster.memberKeys &&
                cluster.memberKeys.has(
                    normalized
                )
            ) {
                return cluster;
            }
        }

        return null;
    }


    /**********************************************************************
     * 47. CLUSTERED CANDIDATE INDEX
     **********************************************************************/

    function createCandidateClusterIndex(
        clusters
    ) {
        const index = new Map();

        for (
            const cluster
            of clusters || []
        ) {
            for (
                const candidate
                of cluster.members || []
            ) {
                index.set(
                    candidate.normalized,
                    cluster
                );
            }
        }

        return index;
    }


    /**********************************************************************
     * 48. CLUSTER SORTING
     **********************************************************************/

    function sortClusterMembers(
        cluster
    ) {
        if (
            !cluster ||
            !Array.isArray(
                cluster.members
            )
        ) {
            return;
        }

        cluster.members.sort(
            (a, b) => {
                const frequencyDifference =
                    b.frequency -
                    a.frequency;

                if (
                    frequencyDifference !==
                    0
                ) {
                    return frequencyDifference;
                }

                return (
                    a.name.localeCompare(
                        b.name
                    )
                );
            }
        );
    }


    function sortClustersByRootFrequency(
        clusters
    ) {
        if (
            !Array.isArray(clusters)
        ) {
            return [];
        }

        /*
         * Root hierarchy remains frequency based.
         *
         * cluster.id is used as the tie-breaker, preserving discovery
         * order.
         */
        return clusters
            .slice()
            .sort(
                (a, b) => {
                    const frequencyDifference =
                        b.root.frequency -
                        a.root.frequency;

                    if (
                        frequencyDifference !==
                        0
                    ) {
                        return frequencyDifference;
                    }

                    return (
                        a.id -
                        b.id
                    );
                }
            );
    }


    /**********************************************************************
     * 49. CLUSTER DIAGNOSTICS
     **********************************************************************/

    function getClusterDiagnostics(
        result
    ) {
        if (!result) {
            return {
                candidates: 0,

                clusters: 0,

                removed: 0,

                isolated: 0,

                maximumFrequency: 0,

                threshold: 0
            };
        }

        return {
            candidates:
                Array.isArray(
                    result.candidates
                )
                    ? result.candidates.length
                    : 0,

            clusters:
                Array.isArray(
                    result.clusters
                )
                    ? result.clusters.length
                    : 0,

            removed:
                Array.isArray(
                    result.removed
                )
                    ? result.removed.length
                    : 0,

            isolated:
                Array.isArray(
                    result.isolated
                )
                    ? result.isolated.length
                    : 0,

            maximumFrequency:
                result.maximumFrequency ||
                0,

            threshold:
                result.threshold ||
                0
        };
    }


    /**********************************************************************
     * 50. END PART 3
     **********************************************************************/
      /**********************************************************************
     * 51. FOXREPLACE MATCHING
     **********************************************************************/

    /*
     * IMPORTANT:
     *
     * Candidate normalization is NEVER applied to FoxReplace rules.
     *
     * Example:
     *
     *     Candidate:
     *         Dragons
     *
     *     normalized candidate:
     *         Dragon
     *
     *     FoxReplace rule:
     *         Dragons
     *
     * The rule remains "Dragons".
     *
     * Matching is performed against the candidate's observed/display
     * forms and the rule's actual input.
     */


    /**********************************************************************
     * 52. REGEXP COMPILATION
     **********************************************************************/

    function compileRuleRegex(
        rule
    ) {
        if (
            !rule ||
            rule.inputType !==
                "regexp"
        ) {
            return null;
        }

        try {
            let flags =
                rule.caseSensitive
                    ? ""
                    : "i";

            /*
             * Preserve common regex flags if a FoxReplace-compatible
             * representation includes them separately.
             */
            const rawRule =
                rule.raw || {};

            const suppliedFlags =
                firstDefined(
                    rawRule,
                    [
                        "flags",
                        "Flags",
                        "regexFlags",
                        "regexpFlags"
                    ],
                    ""
                );

            if (
                suppliedFlags
            ) {
                flags =
                    String(
                        suppliedFlags
                    );

                if (
                    !rule.caseSensitive &&
                    !flags.includes("i")
                ) {
                    flags += "i";
                }
            }

            /*
             * Do not force global matching here.
             *
             * For existence testing, a non-global regex is safer because
             * repeated .test() calls cannot suffer from lastIndex state.
             */
            flags =
                flags.replace(
                    /g/g,
                    ""
                );

            return new RegExp(
                rule.input,
                flags
            );
        } catch (error) {
            return null;
        }
    }


    /**********************************************************************
     * 53. TEXT CASE COMPARISON
     **********************************************************************/

    function compareRuleText(
        candidateText,
        ruleText,
        caseSensitive
    ) {
        if (
            caseSensitive
        ) {
            return (
                candidateText ===
                ruleText
            );
        }

        return (
            String(candidateText)
                .toLowerCase() ===
            String(ruleText)
                .toLowerCase()
        );
    }


    /**********************************************************************
     * 54. WHOLE-WORD COMPARISON
     **********************************************************************/

    function wholeWordRuleMatches(
        candidateText,
        ruleText,
        caseSensitive
    ) {
        const candidate =
            String(
                candidateText ?? ""
            );

        const ruleInput =
            String(
                ruleText ?? ""
            );

        if (!ruleInput) {
            return false;
        }

        /*
         * Escape the literal rule input.
         */
        const escaped =
            escapeRegex(
                ruleInput
            );

        /*
         * FoxReplace whole-word behavior is fundamentally a literal
         * word-boundary match.
         *
         * We use an alphanumeric boundary rather than JavaScript's \b
         * because FoxReplace names can contain apostrophes and hyphens.
         */
        const expression =
            `(?<![A-Za-z0-9'’-])` +
            escaped +
            `(?![A-Za-z0-9'’-])`;

        try {
            return new RegExp(
                expression,
                caseSensitive
                    ? ""
                    : "i"
            ).test(
                candidate
            );
        } catch {
            return false;
        }
    }


    /**********************************************************************
     * 55. LITERAL TEXT CONTAINMENT
     **********************************************************************/

    function textRuleContains(
        candidateText,
        ruleText,
        caseSensitive
    ) {
        const candidate =
            String(
                candidateText ?? ""
            );

        const ruleInput =
            String(
                ruleText ?? ""
            );

        if (!ruleInput) {
            return false;
        }

        if (
            caseSensitive
        ) {
            return candidate.includes(
                ruleInput
            );
        }

        return candidate
            .toLowerCase()
            .includes(
                ruleInput.toLowerCase()
            );
    }


    /**********************************************************************
     * 56. EXACT/FULL RULE MATCH
     **********************************************************************/

    function ruleMatchesEntireCandidate(
        candidate,
        rule
    ) {
        if (
            !candidate ||
            !rule ||
            !rule.enabled
        ) {
            return false;
        }

        const candidateForms =
            getCandidateMatchForms(
                candidate
            );

        if (
            !candidateForms.length
        ) {
            return false;
        }

        /*
         * TEXT rules:
         *
         * Exact/full match means the entire candidate equals the rule
         * input.
         */
        if (
            rule.inputType === "text"
        ) {
            return candidateForms.some(
                form =>
                    compareRuleText(
                        form,
                        rule.input,
                        rule.caseSensitive
                    )
            );
        }

        /*
         * WHOLEWORDS rules:
         *
         * The candidate itself is tested as a complete text string.
         */
        if (
            rule.inputType ===
            "wholewords"
        ) {
            return candidateForms.some(
                form =>
                    wholeWordRuleMatches(
                        form,
                        rule.input,
                        rule.caseSensitive
                    )
            );
        }

        /*
         * REGEXP rules:
         *
         * A regex match is considered a full match only if the regex
         * consumes the entire candidate.
         */
        if (
            rule.inputType ===
            "regexp"
        ) {
            return candidateForms.some(
                form =>
                    regexMatchesEntireString(
                        form,
                        rule
                    )
            );
        }

        return false;
    }


    /**********************************************************************
     * 57. REGEXP FULL-STRING MATCH
     **********************************************************************/

    function regexMatchesEntireString(
        text,
        rule
    ) {
        const regex =
            compileRuleRegex(
                rule
            );

        if (!regex) {
            return false;
        }

        const value =
            String(
                text ?? ""
            );

        /*
         * First try a normal match.
         */
        const match =
            regex.exec(
                value
            );

        if (!match) {
            return false;
        }

        /*
         * A regex can match a substring.
         *
         * For a full rule match, the matched span must cover the entire
         * candidate.
         */
        return (
            match.index === 0 &&
            match[0].length ===
                value.length
        );
    }


    /**********************************************************************
     * 58. ANY RULE MATCH
     **********************************************************************/

    function ruleMatchesCandidate(
        candidate,
        rule
    ) {
        if (
            !candidate ||
            !rule ||
            !rule.enabled
        ) {
            return false;
        }

        const forms =
            getCandidateMatchForms(
                candidate
            );

        if (
            !forms.length
        ) {
            return false;
        }

        if (
            rule.inputType ===
            "regexp"
        ) {
            const regex =
                compileRuleRegex(
                    rule
                );

            if (!regex) {
                return false;
            }

            return forms.some(
                form => {
                    regex.lastIndex = 0;

                    return regex.test(
                        form
                    );
                }
            );
        }

        if (
            rule.inputType ===
            "wholewords"
        ) {
            return forms.some(
                form =>
                    wholeWordRuleMatches(
                        form,
                        rule.input,
                        rule.caseSensitive
                    )
            );
        }

        return forms.some(
            form =>
                textRuleContains(
                    form,
                    rule.input,
                    rule.caseSensitive
                )
        );
    }


    /**********************************************************************
     * 59. CANDIDATE MATCH FORMS
     **********************************************************************/

    /*
     * A candidate may have multiple observed variants after normalization.
     *
     * Example:
     *
     *     Dragon
     *     Dragons
     *     Dragon's
     *
     * These are one candidate internally, but FoxReplace matching must
     * consider the ORIGINAL forms rather than the normalized "Dragon".
     */
    function getCandidateMatchForms(
        candidate
    ) {
        if (!candidate) {
            return [];
        }

        const forms = [];

        /*
         * The observed variants are authoritative.
         */
        if (
            candidate.variants instanceof Map
        ) {
            for (
                const name
                of candidate.variants.keys()
            ) {
                if (
                    name &&
                    !forms.includes(
                        name
                    )
                ) {
                    forms.push(
                        name
                    );
                }
            }
        }

        /*
         * Fallback to the display name.
         */
        if (
            candidate.name &&
            !forms.includes(
                candidate.name
            )
        ) {
            forms.push(
                candidate.name
            );
        }

        return forms;
    }


    /**********************************************************************
     * 60. PARTIAL / CONTAINED MATCH
     **********************************************************************/

    function rulePartiallyMatchesCandidate(
        candidate,
        rule
    ) {
        if (
            !candidate ||
            !rule ||
            !rule.enabled
        ) {
            return false;
        }

        /*
         * If it is already a full match, it is not merely partial.
         */
        if (
            ruleMatchesEntireCandidate(
                candidate,
                rule
            )
        ) {
            return false;
        }

        const forms =
            getCandidateMatchForms(
                candidate
            );

        if (
            !forms.length
        ) {
            return false;
        }

        if (
            rule.inputType ===
            "regexp"
        ) {
            const regex =
                compileRuleRegex(
                    rule
                );

            if (!regex) {
                return false;
            }

            return forms.some(
                form => {
                    regex.lastIndex = 0;

                    const match =
                        regex.exec(
                            form
                        );

                    return (
                        !!match &&
                        (
                            match.index > 0 ||
                            match[0].length <
                                form.length
                        )
                    );
                }
            );
        }

        if (
            rule.inputType ===
            "wholewords"
        ) {
            /*
             * Whole-word rules can match a portion of a multi-token
             * candidate.
             *
             * Example:
             *
             *     Rule: John
             *     Candidate: John Smith
             */
            return forms.some(
                form => {
                    if (
                        !wholeWordRuleMatches(
                            form,
                            rule.input,
                            rule.caseSensitive
                        )
                    ) {
                        return false;
                    }

                    return !compareRuleText(
                        form,
                        rule.input,
                        rule.caseSensitive
                    );
                }
            );
        }

        return forms.some(
            form =>
                textRuleContains(
                    form,
                    rule.input,
                    rule.caseSensitive
                ) &&
                !compareRuleText(
                    form,
                    rule.input,
                    rule.caseSensitive
                )
        );
    }


    /**********************************************************************
     * 61. RULE MATCH DETAILS
     **********************************************************************/

    function getRuleMatchType(
        candidate,
        rule
    ) {
        if (
            ruleMatchesEntireCandidate(
                candidate,
                rule
            )
        ) {
            return "exact";
        }

        if (
            rulePartiallyMatchesCandidate(
                candidate,
                rule
            )
        ) {
            return "partial";
        }

        return "none";
    }


    /**********************************************************************
     * 62. MATCH ALL CURRENT-SITE RULES
     **********************************************************************/

    function findCandidateRuleMatches(
        candidate
    ) {
        const currentRules =
            getCurrentSiteRules();

        const exact = [];

        const partial = [];

        for (
            const entry
            of currentRules
        ) {
            const type =
                getRuleMatchType(
                    candidate,
                    entry.rule
                );

            if (
                type === "exact"
            ) {
                exact.push(
                    entry
                );
            } else if (
                type === "partial"
            ) {
                partial.push(
                    entry
                );
            }
        }

        return {
            exact,

            partial,

            all: [
                ...exact,
                ...partial
            ]
        };
    }


    /**********************************************************************
     * 63. RULE OUTPUT → RULE INPUT CONFLICT
     **********************************************************************/

    /*
     * A rule can itself produce text that another rule consumes.
     *
     * Example:
     *
     *     Rule A:
     *       input  = "X"
     *       output = "John"
     *
     *     Rule B:
     *       input  = "John"
     *
     * This is a conflict because applying A can create something that B
     * can then match.
     *
     * We check the actual rule strings, without candidate normalization.
     */

    function ruleOutputMatchesRuleInput(
        sourceRule,
        targetRule
    ) {
        if (
            !sourceRule ||
            !targetRule
        ) {
            return false;
        }

        if (
            !sourceRule.enabled ||
            !targetRule.enabled
        ) {
            return false;
        }

        const output =
            String(
                sourceRule.output ?? ""
            );

        const input =
            String(
                targetRule.input ?? ""
            );

        if (
            !output ||
            !input
        ) {
            return false;
        }

        /*
         * Do not consider a rule conflicting with itself.
         */
        if (
            sourceRule ===
            targetRule
        ) {
            return false;
        }

        /*
         * Target regexp.
         */
        if (
            targetRule.inputType ===
            "regexp"
        ) {
            const regex =
                compileRuleRegex(
                    targetRule
                );

            if (!regex) {
                return false;
            }

            regex.lastIndex = 0;

            return regex.test(
                output
            );
        }

        /*
         * Target whole-word rule.
         */
        if (
            targetRule.inputType ===
            "wholewords"
        ) {
            return wholeWordRuleMatches(
                output,
                input,
                targetRule.caseSensitive
            );
        }

        /*
         * Target literal rule.
         */
        return textRuleContains(
            output,
            input,
            targetRule.caseSensitive
        );
    }


    /**********************************************************************
     * 64. RULE-TO-RULE CONFLICTS
     **********************************************************************/

    function findRuleOutputConflicts() {
        const rules =
            getCurrentSiteRules();

        const conflicts = [];

        for (
            let i = 0;
            i < rules.length;
            i++
        ) {
            const source =
                rules[i];

            for (
                let j = 0;
                j < rules.length;
                j++
            ) {
                if (
                    i === j
                ) {
                    continue;
                }

                const target =
                    rules[j];

                if (
                    ruleOutputMatchesRuleInput(
                        source.rule,
                        target.rule
                    )
                ) {
                    conflicts.push({
                        type:
                            "rule-output-input",

                        source,

                        target
                    });
                }
            }
        }

        return conflicts;
    }


    /**********************************************************************
     * 65. CONFLICT OBJECTS
     **********************************************************************/

    function createCandidateConflict(
        candidate,
        matchData
    ) {
        return {
            type: "candidate",

            candidate,

            exact:
                matchData.exact,

            partial:
                matchData.partial,

            all:
                matchData.all
        };
    }


    /**********************************************************************
     * 66. CLASSIFICATION
     **********************************************************************/

    /*
     * Classification rules:
     *
     *     no relevant rule
     *         → Candidates
     *
     *     exactly one exact rule
     *     and no partial rules
     *         → Groups
     *
     *     multiple exact rules
     *         → Conflicts
     *
     *     exact + partial
     *         → Conflicts
     *
     *     partial without exact
     *         → Conflicts
     *
     *     rule-output → rule-input relationship
     *         → Conflicts
     */

    function classifyCandidate(
        candidate
    ) {
        const matches =
            findCandidateRuleMatches(
                candidate
            );

        if (
            matches.exact.length === 0 &&
            matches.partial.length === 0
        ) {
            return {
                classification:
                    "candidate",

                candidate,

                matches
            };
        }

        if (
            matches.exact.length === 1 &&
            matches.partial.length === 0
        ) {
            return {
                classification:
                    "group",

                candidate,

                matches
            };
        }

        return {
            classification:
                "conflict",

            candidate,

            matches
        };
    }


    /**********************************************************************
     * 67. GROUP MATCH RECORDS
     **********************************************************************/

function buildGroupMatches(classifications) {
    const groups = new Map();

    for (const item of classifications) {
        if (
            !item ||
            item.classification !== "group"
        ) {
            continue;
        }

        const matches =
            item.matches?.exact || [];

        for (const match of matches) {
            const group =
                match?.group;

            const rule =
                match?.rule;

            if (!group || !rule) {
                continue;
            }

            if (!groups.has(group.index)) {
                groups.set(
                    group.index,
                    {
                        ...group,
                        rules: []
                    }
                );
            }

            const groupMatch =
                groups.get(group.index);

            if (
                !groupMatch.rules.some(
                    existing =>
                        existing.ruleIndex ===
                        rule.ruleIndex
                )
            ) {
                groupMatch.rules.push({
                    ...rule,
                    matchedCandidates: []
                });
            }

            const groupRule =
                groupMatch.rules.find(
                    existing =>
                        existing.ruleIndex ===
                        rule.ruleIndex
                );

            if (
                groupRule &&
                !groupRule.matchedCandidates.some(
                    candidate =>
                        candidate.normalized ===
                        item.candidate.normalized
                )
            ) {
                groupRule.matchedCandidates.push(
                    item.candidate
                );
            }
        }
    }

    return Array.from(
        groups.values()
    );
}


    /**********************************************************************
     * 68. CONFLICT CANDIDATE RECORDS
     **********************************************************************/

    function buildCandidateConflicts(
        classifications
    ) {
        return classifications
            .filter(
                classification =>
                    classification.classification ===
                    "conflict"
            )
            .map(
                classification =>
                    createCandidateConflict(
                        classification.candidate,
                        classification.matches
                    )
            );
    }


    /**********************************************************************
     * 69. CONFLICT RELATIONSHIP KEYS
     **********************************************************************/

    function getConflictRuleKeys(
        conflict
    ) {
        const keys = new Set();

        if (!conflict) {
            return keys;
        }

        for (
            const entry
            of conflict.exact || []
        ) {
            keys.add(
                `${entry.group.index}:${entry.rule.ruleIndex}`
            );
        }

        for (
            const entry
            of conflict.partial || []
        ) {
            keys.add(
                `${entry.group.index}:${entry.rule.ruleIndex}`
            );
        }

        return keys;
    }


    /**********************************************************************
     * 70. CONFLICT CLUSTER LINK
     **********************************************************************/

    /*
     * Two candidate conflicts belong to the same conflict cluster if:
     *
     *   1. they share a FoxReplace rule, OR
     *   2. their candidates are themselves within the same candidate
     *      cluster relationship.
     *
     * The first condition is the important one for rule ambiguity.
     */

    function conflictsAreLinked(
        left,
        right
    ) {
        const leftRules =
            getConflictRuleKeys(
                left
            );

        const rightRules =
            getConflictRuleKeys(
                right
            );

        for (
            const key
            of leftRules
        ) {
            if (
                rightRules.has(
                    key
                )
            ) {
                return true;
            }
        }

        if (
            left.candidate &&
            right.candidate
        ) {
            return candidatesAreClusterLinked(
                left.candidate,
                right.candidate
            );
        }

        return false;
    }


    /**********************************************************************
     * 71. CONFLICT CLUSTERING
     **********************************************************************/

    function clusterCandidateConflicts(
        conflicts
    ) {
        if (
            !Array.isArray(conflicts) ||
            !conflicts.length
        ) {
            return [];
        }

        const clusters = [];

        const assigned =
            new Set();

        let nextClusterId = 1;

        /*
         * Discovery order is preserved.
         */
        for (
            let i = 0;
            i < conflicts.length;
            i++
        ) {
            if (
                assigned.has(i)
            ) {
                continue;
            }

            const cluster = {
                id: nextClusterId++,

                conflicts: []
            };

            const queue = [i];

            assigned.add(i);

            let queueIndex = 0;

            while (
                queueIndex <
                queue.length
            ) {
                const currentIndex =
                    queue[
                        queueIndex++
                    ];

                const current =
                    conflicts[
                        currentIndex
                    ];

                cluster.conflicts.push(
                    current
                );

                /*
                 * Chain clustering allows:
                 *
                 *     A ↔ B
                 *     B ↔ C
                 *
                 * to become one conflict cluster even if A and C do not
                 * directly share a rule.
                 */
                for (
                    let j = 0;
                    j < conflicts.length;
                    j++
                ) {
                    if (
                        assigned.has(j)
                    ) {
                        continue;
                    }

                    if (
                        conflictsAreLinked(
                            current,
                            conflicts[j]
                        )
                    ) {
                        assigned.add(j);

                        queue.push(j);
                    }
                }
            }

            clusters.push(
                cluster
            );
        }

        return clusters;
    }


    /**********************************************************************
     * 72. RULE-OUTPUT CONFLICT CLUSTERS
     **********************************************************************/

    function clusterRuleOutputConflicts(
        conflicts
    ) {
        if (
            !Array.isArray(conflicts) ||
            !conflicts.length
        ) {
            return [];
        }

        const clusters = [];

        const assigned =
            new Set();

        let nextClusterId = 1;

        for (
            let i = 0;
            i < conflicts.length;
            i++
        ) {
            if (
                assigned.has(i)
            ) {
                continue;
            }

            const cluster = {
                id: nextClusterId++,

                conflicts: []
            };

            const queue = [i];

            assigned.add(i);

            let queueIndex = 0;

            while (
                queueIndex <
                queue.length
            ) {
                const currentIndex =
                    queue[
                        queueIndex++
                    ];

                const current =
                    conflicts[
                        currentIndex
                    ];

                cluster.conflicts.push(
                    current
                );

                for (
                    let j = 0;
                    j < conflicts.length;
                    j++
                ) {
                    if (
                        assigned.has(j)
                    ) {
                        continue;
                    }

                    const other =
                        conflicts[j];

                    const currentKeys =
                        new Set([
                            `${current.source.group.index}:${current.source.rule.ruleIndex}`,
                            `${current.target.group.index}:${current.target.rule.ruleIndex}`
                        ]);

                    const otherKeys =
                        new Set([
                            `${other.source.group.index}:${other.source.rule.ruleIndex}`,
                            `${other.target.group.index}:${other.target.rule.ruleIndex}`
                        ]);

                    let linked = false;

                    for (
                        const key
                        of currentKeys
                    ) {
                        if (
                            otherKeys.has(
                                key
                            )
                        ) {
                            linked = true;
                            break;
                        }
                    }

                    if (linked) {
                        assigned.add(j);

                        queue.push(j);
                    }
                }
            }

            clusters.push(
                cluster
            );
        }

        return clusters;
    }


    /**********************************************************************
     * 73. COMPLETE CONFLICT DATABASE
     **********************************************************************/

function buildConflictData(classifications) {
    const conflicts = [];

    let discoveryOrder = 0;

    for (const item of classifications) {
        if (
            !item ||
            item.classification !== "conflict"
        ) {
            continue;
        }

        const matches =
            item.matches || {};

        const allMatches =
            Array.isArray(matches.all)
                ? matches.all
                : [];

        const groupNames = [];

        for (const match of allMatches) {
            const name =
                match?.group?.name;

            if (
                name &&
                !groupNames.includes(name)
            ) {
                groupNames.push(name);
            }
        }

        conflicts.push({
            id:
                `conflict-${discoveryOrder + 1}`,

            discoveryOrder:
                discoveryOrder++,

            candidate:
                item.candidate,

            groups:
                groupNames,

            matches:
                allMatches,

            exact:
                Array.isArray(matches.exact)
                    ? matches.exact
                    : [],

            partial:
                Array.isArray(matches.partial)
                    ? matches.partial
                    : []
        });
    }

    return conflicts;
}


    /**********************************************************************
     * 74. CONFLICT DISPLAY HELPERS
     **********************************************************************/

    function getConflictGroups(
        conflict
    ) {
        const groups = [];

        const seen = new Set();

        const entries = [
            ...(conflict?.exact || []),
            ...(conflict?.partial || [])
        ];

        for (
            const entry
            of entries
        ) {
            const index =
                entry.group.index;

            if (
                seen.has(index)
            ) {
                continue;
            }

            seen.add(index);

            groups.push(
                entry.group
            );
        }

        return groups;
    }


    function getConflictGroupNames(
        conflict
    ) {
        return getConflictGroups(
            conflict
        ).map(
            group =>
                group.name ||
                "(Unnamed group)"
        );
    }


    function getConflictRuleEntries(
        conflict
    ) {
        const entries = [];

        for (
            const entry
            of conflict?.exact || []
        ) {
            entries.push({
                type: "exact",

                group:
                    entry.group,

                rule:
                    entry.rule
            });
        }

        for (
            const entry
            of conflict?.partial || []
        ) {
            entries.push({
                type: "partial",

                group:
                    entry.group,

                rule:
                    entry.rule
            });
        }

        return entries;
    }


    /**********************************************************************
     * 75. END PART 4
     **********************************************************************/
      /**********************************************************************
     * 76. GENERATED INPUT TEMPLATES
     **********************************************************************/

    /*
     * Generated Input is only a suggestion for the Candidates tab.
     *
     * WNC does NOT:
     *
     *   - add it to FoxReplace
     *   - modify FoxReplace
     *   - replace page text
     *   - execute the generated regexp
     *
     * The user copies the generated Input into FoxReplace manually.
     */


    /**********************************************************************
     * 77. GENERATED INPUT ESCAPING
     **********************************************************************/

    function escapeRegexLiteral(
        value
    ) {
        return String(
            value ?? ""
        ).replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
    }


    /**********************************************************************
     * 78. NORMALIZE DISPLAY SPACING
     **********************************************************************/

    function normalizeGeneratedInputSpacing(
        value
    ) {
        return String(
            value ?? ""
        )
            .trim()
            .replace(
                /\s+/g,
                " "
            );
    }


    /**********************************************************************
     * 79. OTHER TEMPLATE
     **********************************************************************/

    /*
     * "Other" preserves the original WNC behavior:
     *
     *     (?<![a-z])Candidate(?![a-z])
     *
     * The candidate itself is escaped so names containing regex
     * punctuation do not accidentally become regex syntax.
     *
     * Examples:
     *
     *     Dragon
     *         →
     *     (?<![a-z])Dragon(?![a-z])
     *
     *     U.S.
     *         →
     *     (?<![a-z])U\.S\.(?![a-z])
     */

    function generateOtherInput(
        candidate
    ) {
        const value =
            normalizeGeneratedInputSpacing(
                candidate?.name ??
                candidate?.normalized ??
                ""
            );

        if (!value) {
            return "";
        }

        const escaped =
            escapeRegexLiteral(
                value
            );

        return (
            "(?<![a-z])" +
            escaped +
            "(?![a-z])"
        );
    }


    /**********************************************************************
     * 80. KOREAN TEMPLATE HELPERS
     **********************************************************************/

    function isHyphenVariantCandidate(
        value
    ) {
        return /[-‐-‒–—―]/.test(
            String(value ?? "")
        );
    }


    function replaceSpacesAndHyphens(
        value
    ) {
        return String(
            value ?? ""
        )
            .trim()
            .replace(
                /\s+/g,
                " "
            )
            .replace(
                /[-‐-‒–—―]+/g,
                "-"
            );
    }


    /**********************************************************************
     * 81. KOREAN TEMPLATE
     **********************************************************************/

    /*
     * Korean names commonly appear with variations around the first
     * token and with space/hyphen differences.
     *
     * For two or more tokens, WNC intentionally omits the first token
     * from the generated core.
     *
     * Example:
     *
     *     Kim Tae Hyun
     *
     * becomes a pattern centered around:
     *
     *     Tae Hyun
     *
     * and supports the common space/hyphen variation.
     *
     * Single-token names remain intact.
     */

    function generateKoreanInput(
        candidate
    ) {
        const value =
            normalizeGeneratedInputSpacing(
                candidate?.name ??
                candidate?.normalized ??
                ""
            );

        if (!value) {
            return "";
        }

        const tokens =
            splitCandidateTokens(
                value
            );

        /*
         * Single-token candidate.
         */
        if (
            tokens.length <= 1
        ) {
            return (
                "(?<![a-z])" +
                escapeRegexLiteral(
                    value
                ) +
                "(?![a-z])"
            );
        }

        /*
         * Omit the first token.
         */
        const remainingTokens =
            tokens.slice(1);

        const remaining =
            remainingTokens.join(
                " "
            );

        /*
         * Escape every token individually.
         */
        const escapedTokens =
            remainingTokens.map(
                escapeRegexLiteral
            );

        /*
         * Space/hyphen-flexible form.
         *
         *     Tae Hyun
         *     Tae-Hyun
         */
        const flexible =
            escapedTokens.join(
                "[\\s-]+"
            );

        /*
         * Include a version that accepts the remaining phrase with
         * ordinary whitespace as well.
         *
         * The alternation is kept explicit rather than replacing all
         * whitespace globally.
         */
        const alternatives = [
            flexible
        ];

        if (
            remaining !== value
        ) {
            alternatives.push(
                escapeRegexLiteral(
                    remaining
                )
            );
        }

        const uniqueAlternatives =
            Array.from(
                new Set(
                    alternatives
                )
            );

        return (
            "(?<![A-Za-z0-9'’-])(?:" +
            uniqueAlternatives.join(
                "|"
            ) +
            ")(?![A-Za-z0-9'’-])"
        );
    }


    /**********************************************************************
     * 82. JAPANESE TEMPLATE
     **********************************************************************/

    /*
     * Japanese name ordering:
     *
     *     First Last
     *     Last First
     *
     * The generated pattern outputs the LAST token as the core name.
     *
     * Example:
     *
     *     Tanaka Haru
     *
     * becomes:
     *
     *     Tanaka Haru|Haru Tanaka
     *
     * with the final token available as the primary name component.
     */

    function generateJapaneseInput(
        candidate
    ) {
        const value =
            normalizeGeneratedInputSpacing(
                candidate?.name ??
                candidate?.normalized ??
                ""
            );

        if (!value) {
            return "";
        }

        const tokens =
            splitCandidateTokens(
                value
            );

        /*
         * Single-token names.
         */
        if (
            tokens.length <= 1
        ) {
            return (
                "(?<![A-Za-z0-9'’-])" +
                escapeRegexLiteral(
                    value
                ) +
                "(?![A-Za-z0-9'’-])"
            );
        }

        const first =
            tokens[0];

        const last =
            tokens[
                tokens.length - 1
            ];

        /*
         * For multi-token names, retain the full two possible ordering
         * forms.
         */
        const forward =
            tokens
                .map(
                    escapeRegexLiteral
                )
                .join(
                    "\\s+"
                );

        const reverseTokens =
            [
                last,
                ...tokens.slice(
                    0,
                    -1
                )
            ];

        const reverse =
            reverseTokens
                .map(
                    escapeRegexLiteral
                )
                .join(
                    "\\s+"
                );

        /*
         * If first and last happen to be identical, avoid a duplicate
         * alternative.
         */
        const alternatives =
            Array.from(
                new Set([
                    forward,
                    reverse
                ])
            );

        return (
            "(?<![A-Za-z0-9'’-])(?:" +
            alternatives.join(
                "|"
            ) +
            ")(?![A-Za-z0-9'’-])"
        );
    }


    /**********************************************************************
     * 83. TEMPLATE DISPATCHER
     **********************************************************************/

    function generateCandidateInput(
        candidate,
        template
    ) {
        const selected =
            INPUT_TEMPLATES.includes(
                template
            )
                ? template
                : "Other";

        switch (
            selected
        ) {
            case "Korean":
                return generateKoreanInput(
                    candidate
                );

            case "Japanese":
                return generateJapaneseInput(
                    candidate
                );

            case "Other":
            default:
                return generateOtherInput(
                    candidate
                );
        }
    }


    /**********************************************************************
     * 84. REGENERATE ALL CANDIDATE INPUTS
     **********************************************************************/

    function regenerateCandidateInputs(
        candidates,
        template =
            state.candidateTemplate
    ) {
        if (
            !Array.isArray(
                candidates
            )
        ) {
            return [];
        }

        for (
            const candidate
            of candidates
        ) {
            candidate.generatedInput =
                generateCandidateInput(
                    candidate,
                    template
                );
        }

        return candidates;
    }


    /**********************************************************************
     * 85. TEMPLATE CHANGE
     **********************************************************************/

    function setCandidateTemplate(
        template
    ) {
        if (
            !INPUT_TEMPLATES.includes(
                template
            )
        ) {
            return;
        }

        state.candidateTemplate =
            template;

        /*
         * Regenerate every currently displayed candidate immediately.
         */
        regenerateCandidateInputs(
            state.candidates,
            state.candidateTemplate
        );

        render();
    }


    /**********************************************************************
     * 86. GENERATED INPUT VALIDATION
     **********************************************************************/

    /*
     * This is only an internal sanity check.
     *
     * WNC does not execute generated Inputs against page text.
     */

    function generatedInputLooksValid(
        input
    ) {
        if (
            !input ||
            typeof input !== "string"
        ) {
            return false;
        }

        try {
            /*
             * Strip the lookbehind/lookahead only for validation if an
             * environment does not support them.
             *
             * Modern browsers do support the expressions WNC generates,
             * but this check avoids throwing during UI rendering.
             */
            new RegExp(
                input
            );

            return true;
        } catch {
            return false;
        }
    }


    /**********************************************************************
     * 87. GENERATED INPUT DISPLAY VALUE
     **********************************************************************/

    function getGeneratedInput(
        candidate
    ) {
        if (
            !candidate
        ) {
            return "";
        }

        if (
            !candidate.generatedInput
        ) {
            candidate.generatedInput =
                generateCandidateInput(
                    candidate,
                    state.candidateTemplate
                );
        }

        return candidate.generatedInput;
    }


    /**********************************************************************
     * 88. END PART 5
     **********************************************************************/
      /**********************************************************************
     * 89. ANALYSIS PIPELINE
     **********************************************************************/

    /*
     * Complete WNC processing flow:
     *
     *   chapter
     *      ↓
     *   exact candidate scanner
     *      ↓
     *   candidate normalization
     *      ↓
     *   frequency merge
     *      ↓
     *   hierarchical clustering
     *      ↓
     *   remove ONLY isolated candidates below 5%
     *      ↓
     *   FoxReplace matching
     *      ↓
     *   candidates / groups / conflicts
     *      ↓
     *   generated Inputs
     */


    /**********************************************************************
     * 90. EMPTY ANALYSIS STATE
     **********************************************************************/

    function clearAnalysisResults() {
        state.candidates = [];
        state.groupMatches = [];
        state.conflicts = [];
        state.groupIndex = null;
        state.expandedRules.clear();
    }


    /**********************************************************************
     * 91. BUILD CANDIDATE RESULTS
     **********************************************************************/

    function buildCandidateResults(
        processedCandidates
    ) {
        const candidates = [];

        for (
            const candidate
            of processedCandidates
        ) {
            const classification =
                classifyCandidate(
                    candidate,
                    adaptedDatabase
                );

            /*
             * Only completely unmatched candidates belong on the
             * Candidates tab.
             */
if (
    classification.classification !==
    "candidate"
) {
    continue;
}

            candidate.generatedInput =
                generateCandidateInput(
                    candidate,
                    state.candidateTemplate
                );

            candidates.push(
                candidate
            );
        }

        return candidates;
    }


    /**********************************************************************
     * 92. MAIN PAGE ANALYSIS
     **********************************************************************/
function analyzePage() {
    clearAnalysisResults();

    const scanInfo =
        getChapterScanInfo();

    chapterText =
        scanInfo.text || "";

    if (!chapterText.trim()) {
        return {
            candidates: [],
            groupMatches: [],
            conflicts: {
                clusters: [],
                candidateConflicts: [],
                ruleOutputConflicts: []
            }
        };
    }

    const scanned =
        scanChapterCandidates(
            chapterText
        );

    const processed =
        processCandidateClusters(
            scanned
        );

    const classifications =
        processed.candidates.map(
            candidate =>
                classifyCandidate(
                    candidate
                )
        );

    const groupMatches =
        buildGroupMatches(
            classifications
        );

    const conflicts =
        buildConflictData(
            classifications
        );

    const candidates =
        buildCandidateResults(
            processed.candidates
        );

    state.candidates =
        candidates;

    state.groupMatches =
        groupMatches;

    state.conflicts =
        conflicts;

    regenerateCandidateInputs(
        state.candidates,
        state.candidateTemplate
    );

    return {
        candidates,
        groupMatches,
        conflicts
    };
}


    /**********************************************************************
     * 93. SAFE ANALYSIS WRAPPER
     **********************************************************************/

    function runAnalysisSafely() {
        try {
            return analyzePage();
        } catch (
            error
        ) {
            console.error(
                "[WNC] Analysis failed:",
                error
            );

            clearAnalysisResults();

            return {
                chapterText: "",
                candidates: [],
                groups: [],
                conflicts: [],
                error
            };
        }
    }


    /**********************************************************************
     * 94. GROUP MATCH LOOKUP
     **********************************************************************/

    function getVisibleGroupMatches() {
        if (
            !Array.isArray(
                state.groupMatches
            )
        ) {
            return [];
        }

        return state.groupMatches;
    }


    /**********************************************************************
     * 95. RULE MATCH LOOKUP
     **********************************************************************/

    function getGroupRulesWithMatches(
        groupMatch
    ) {
        if (
            !groupMatch ||
            !Array.isArray(
                groupMatch.rules
            )
        ) {
            return [];
        }

        return groupMatch.rules;
    }


    /**********************************************************************
     * 96. SORT DIRECTION CYCLE
     **********************************************************************/

    /*
     * direction:
     *
     *     0  = original order
     *     1  = ascending
     *    -1  = descending
     *
     * Clicking a sortable header cycles:
     *
     *     original → ascending → descending → original
     */

    function cycleSortState(
        sortState,
        column
    ) {
        if (
            sortState.column !==
            column
        ) {
            sortState.column =
                column;

            sortState.direction =
                1;

            return;
        }

        if (
            sortState.direction === 0
        ) {
            sortState.direction =
                1;
        } else if (
            sortState.direction === 1
        ) {
            sortState.direction =
                -1;
        } else {
            sortState.direction =
                0;
        }
    }


    /**********************************************************************
     * 97. GENERIC COMPARISON
     **********************************************************************/

    function compareNumbers(
        a,
        b
    ) {
        const numberA =
            Number.isFinite(
                Number(a)
            )
                ? Number(a)
                : 0;

        const numberB =
            Number.isFinite(
                Number(b)
            )
                ? Number(b)
                : 0;

        return (
            numberA -
            numberB
        );
    }


    function compareStrings(
        a,
        b
    ) {
        return String(
            a ?? ""
        ).localeCompare(
            String(
                b ?? ""
            ),
            undefined,
            {
                numeric: true,
                sensitivity: "base"
            }
        );
    }


    /**********************************************************************
     * 98. GROUP SORTING
     **********************************************************************/

    function getGroupSortValue(
        group,
        column
    ) {
        switch (
            column
        ) {
            case "name":
                return group.name;

            case "rules":
                return group.rules?.length || 0;

            case "matches":
                return (
                    group.rules?.reduce(
                        (
                            total,
                            rule
                        ) =>
                            total +
                            (
                                rule.candidates?.length ||
                                0
                            ),
                        0
                    ) || 0
                );

            case "original":
            default:
                return group.index;
        }
    }


    function compareGroups(
        a,
        b,
        column
    ) {
        if (
            column === "original"
        ) {
            return compareNumbers(
                a.index,
                b.index
            );
        }

        const valueA =
            getGroupSortValue(
                a,
                column
            );

        const valueB =
            getGroupSortValue(
                b,
                column
            );

        if (
            typeof valueA ===
                "number" &&
            typeof valueB ===
                "number"
        ) {
            return compareNumbers(
                valueA,
                valueB
            );
        }

        return compareStrings(
            valueA,
            valueB
        );
    }


    function sortGroupMatches(
        groups
    ) {
        if (
            !Array.isArray(
                groups
            )
        ) {
            return [];
        }

        const copy =
            groups.slice();

        const {
            column,
            direction
        } =
            state.groupSort;

        /*
         * Original order is deliberately preserved rather than
         * recalculated from the displayed name.
         */
        if (
            direction === 0 ||
            column === "original"
        ) {
            return copy.sort(
                (
                    a,
                    b
                ) =>
                    compareNumbers(
                        a.index,
                        b.index
                    )
            );
        }

        return copy.sort(
            (
                a,
                b
            ) =>
                compareGroups(
                    a,
                    b,
                    column
                ) *
                direction
        );
    }


    /**********************************************************************
     * 99. RULE SORTING
     **********************************************************************/

    function getRuleSortValue(
        rule,
        column
    ) {
        switch (
            column
        ) {
            case "input":
                return rule.input;

            case "output":
                return rule.output;

            case "matches":
                return (
                    rule.candidates?.length ||
                    0
                );

            case "original":
            default:
                return rule.index;
        }
    }


    function compareRules(
        a,
        b,
        column
    ) {
        if (
            column === "original"
        ) {
            return compareNumbers(
                a.index,
                b.index
            );
        }

        const valueA =
            getRuleSortValue(
                a,
                column
            );

        const valueB =
            getRuleSortValue(
                b,
                column
            );

        if (
            typeof valueA ===
                "number" &&
            typeof valueB ===
                "number"
        ) {
            return compareNumbers(
                valueA,
                valueB
            );
        }

        return compareStrings(
            valueA,
            valueB
        );
    }


    function sortGroupRules(
        rules
    ) {
        if (
            !Array.isArray(
                rules
            )
        ) {
            return [];
        }

        const copy =
            rules.slice();

        const {
            column,
            direction
        } =
            state.ruleSort;

        /*
         * Original FoxReplace rule order.
         */
        if (
            direction === 0 ||
            column === "original"
        ) {
            return copy.sort(
                (
                    a,
                    b
                ) =>
                    compareNumbers(
                        a.index,
                        b.index
                    )
            );
        }

        return copy.sort(
            (
                a,
                b
            ) =>
                compareRules(
                    a,
                    b,
                    column
                ) *
                direction
        );
    }


    /**********************************************************************
     * 100. CONFLICT SORTING
     **********************************************************************/

    /*
     * Conflicts are intentionally NOT manually sortable.
     *
     * Their order is discovery order.
     *
     * Cluster IDs are assigned once during buildConflictData() and
     * therefore remain stable while the current analysis is displayed.
     */

function getVisibleConflicts() {
    if (!Array.isArray(state.conflicts)) {
        return [];
    }

    return state.conflicts.slice();
}

    /**********************************************************************
     * 101. CLUSTER DISPLAY ORDER
     **********************************************************************/

    function getClusterDisplayId(
        conflict
    ) {
        if (
            conflict &&
            Number.isFinite(
                conflict.clusterId
            )
        ) {
            return conflict.clusterId;
        }

        return "";
    }


    /**********************************************************************
     * 102. CANDIDATE DISPLAY SORT
     **********************************************************************/

    /*
     * Candidates are presented in frequency order.
     *
     * This is separate from FoxReplace group/rule sorting.
     */

    function sortCandidatesForDisplay(
        candidates
    ) {
        if (
            !Array.isArray(
                candidates
            )
        ) {
            return [];
        }

        return candidates
            .slice()
            .sort(
                (
                    a,
                    b
                ) => {
                    const frequencyDifference =
                        compareNumbers(
                            b.frequency,
                            a.frequency
                        );

                    if (
                        frequencyDifference !==
                        0
                    ) {
                        return frequencyDifference;
                    }

                    /*
                     * Preserve discovery order for equal frequencies.
                     */
                    return compareNumbers(
                        a.firstSeenIndex,
                        b.firstSeenIndex
                    );
                }
            );
    }


    /**********************************************************************
     * 103. APPLY GROUP SORT
     **********************************************************************/

    function sortDisplayedGroups() {
        state.groupMatches =
            sortGroupMatches(
                state.groupMatches
            );

        for (
            const group
            of state.groupMatches
        ) {
            if (
                Array.isArray(
                    group.rules
                )
            ) {
                group.rules =
                    sortGroupRules(
                        group.rules
                    );
            }
        }
    }


    /**********************************************************************
     * 104. SORT GROUPS BY HEADER
     **********************************************************************/

    function sortGroupsBy(
        column
    ) {
        cycleSortState(
            state.groupSort,
            column
        );

        /*
         * Group sorting and rule sorting are independent.
         *
         * Changing a group header does not alter the user's rule sort.
         */
        sortDisplayedGroups();

        render();
    }


    /**********************************************************************
     * 105. SORT RULES BY HEADER
     **********************************************************************/

    function sortRulesBy(
        column
    ) {
        cycleSortState(
            state.ruleSort,
            column
        );

        sortDisplayedGroups();

        render();
    }


    /**********************************************************************
     * 106. RULE EXPANSION
     **********************************************************************/

    function getRuleExpansionKey(
        group,
        rule
    ) {
        return (
            String(
                group?.index ??
                ""
            ) +
            ":" +
            String(
                rule?.index ??
                ""
            )
        );
    }


    function isRuleExpanded(
        group,
        rule
    ) {
        return state.expandedRules.has(
            getRuleExpansionKey(
                group,
                rule
            )
        );
    }


    function toggleRuleExpanded(
        group,
        rule
    ) {
        const key =
            getRuleExpansionKey(
                group,
                rule
            );

        if (
            state.expandedRules.has(
                key
            )
        ) {
            state.expandedRules.delete(
                key
            );
        } else {
            state.expandedRules.add(
                key
            );
        }

        render();
    }


    /**********************************************************************
     * 107. GROUP SELECTION
     **********************************************************************/

    function selectGroup(
        groupIndex
    ) {
        state.groupIndex =
            Number.isInteger(
                groupIndex
            )
                ? groupIndex
                : null;

        render();
    }


    /**********************************************************************
     * 108. RESET SORTING
     **********************************************************************/

    function resetDisplaySorting() {
        state.groupSort = {
            column: "original",
            direction: 0
        };

        state.ruleSort = {
            column: "original",
            direction: 0
        };

        sortDisplayedGroups();

        render();
    }


    /**********************************************************************
     * 109. ANALYSIS SUMMARY
     **********************************************************************/

    function getAnalysisSummary() {
        const candidateCount =
            state.candidates.length;

        const groupCount =
            state.groupMatches.length;

        const conflictCount =
            state.conflicts.length;

        const conflictClusterIds =
            new Set();

        for (
            const conflict
            of state.conflicts
        ) {
            if (
                Number.isFinite(
                    conflict.clusterId
                )
            ) {
                conflictClusterIds.add(
                    conflict.clusterId
                );
            }
        }

        return {
            candidateCount,
            groupCount,
            conflictCount,
            conflictClusterCount:
                conflictClusterIds.size
        };
    }


    /**********************************************************************
     * 110. END PART 6
     **********************************************************************/
      /**********************************************************************
     * 111. WNC USER INTERFACE
     **********************************************************************/

    /*
     * The UI intentionally keeps the older WNC dark/suggestions style.
     *
     * Exactly three tabs:
     *
     *     Candidates | Groups | Conflicts
     *
     * The UI is a display/workbench only.
     */


    /**********************************************************************
     * 112. UI CONSTANTS
     **********************************************************************/

    const WNC_UI_ID = "wnc-overlay";

    const WNC_STYLE_ID =
        "wnc-dark-style";

    const WNC_TAB_ORDER = [
        "candidates",
        "groups",
        "conflicts"
    ];


    /**********************************************************************
     * 113. CSS
     **********************************************************************/

    function getWncStyles() {
        return `
            #${WNC_UI_ID} {
                position: fixed;
                inset: 0;
                z-index: 2147483647;
                background: rgba(10, 12, 16, 0.96);
                color: #e8eaed;
                font-family:
                    -apple-system,
                    BlinkMacSystemFont,
                    "Segoe UI",
                    Arial,
                    sans-serif;
                font-size: 15px;
                line-height: 1;
                box-sizing: border-box;
                overflow: auto;
            }

            #${WNC_UI_ID} *,
            #${WNC_UI_ID} *::before,
            #${WNC_UI_ID} *::after {
                box-sizing: border-box;
            }

            #${WNC_UI_ID} .wnc-shell {
                width: 100%;
                min-height: 100%;
                padding: 1px;
            }

            #${WNC_UI_ID} .wnc-toolbar {
                display: flex;
                align-items: center;
                gap: 4px;
                min-height: 28px;
                padding: 1px;
                margin: 1px;
                background: #171a20;
                border: 1px solid #30343c;
                border-radius: 3px;
            }

            #${WNC_UI_ID} .wnc-title {
                font-size: 15px;
                font-weight: 700;
                margin-right: 4px;
                white-space: nowrap;
            }

            #${WNC_UI_ID} .wnc-tabs {
                display: flex;
                align-items: center;
                gap: 1px;
                margin: 0;
                padding: 0;
            }

            #${WNC_UI_ID} .wnc-tab {
                appearance: none;
                border: 1px solid #343943;
                background: #20242b;
                color: #b9bec7;
                padding: 4px 9px;
                margin: 0;
                border-radius: 2px;
                cursor: pointer;
                font: inherit;
                line-height: 1;
            }

            #${WNC_UI_ID} .wnc-tab:hover {
                background: #292e37;
                color: #fff;
            }

            #${WNC_UI_ID} .wnc-tab.active {
                background: #3a404b;
                color: #fff;
                border-color: #626a78;
            }

            #${WNC_UI_ID} .wnc-spacer {
                flex: 1;
            }

            #${WNC_UI_ID} .wnc-template {
                appearance: none;
                background: #20242b;
                color: #e8eaed;
                border: 1px solid #3b4049;
                border-radius: 2px;
                padding: 3px 7px;
                margin: 0;
                font: inherit;
                line-height: 1;
                cursor: pointer;
            }

            #${WNC_UI_ID} .wnc-template:hover {
                background: #292e37;
            }

            #${WNC_UI_ID} .wnc-content {
                margin: 1px;
                padding: 1px;
            }

            #${WNC_UI_ID} .wnc-panel {
                margin: 1px 0;
                padding: 1px;
            }

            #${WNC_UI_ID} .wnc-empty {
                padding: 10px;
                margin: 1px;
                color: #9da3ad;
                background: #15181d;
                border: 1px solid #2c3038;
                border-radius: 2px;
            }

            #${WNC_UI_ID} .wnc-table-wrap {
                width: 100%;
                overflow-x: auto;
                margin: 1px;
                padding: 1px;
            }

            #${WNC_UI_ID} table {
                width: 100%;
                border-collapse: collapse;
                border-spacing: 0;
                margin: 1px;
                padding: 0;
                background: #15181d;
                color: #e8eaed;
            }

            #${WNC_UI_ID} th,
            #${WNC_UI_ID} td {
                border: 1px solid #2c3038;
                padding: 4px;
                margin: 0;
                vertical-align: top;
                line-height: 1;
            }

            #${WNC_UI_ID} th {
                background: #20242b;
                color: #f1f3f5;
                font-weight: 700;
                white-space: nowrap;
            }

            #${WNC_UI_ID} tbody tr:nth-child(even) {
                background: #181b21;
            }

            #${WNC_UI_ID} tbody tr:hover {
                background: #242932;
            }

            #${WNC_UI_ID} .wnc-number {
                text-align: right;
                white-space: nowrap;
            }

            #${WNC_UI_ID} .wnc-input {
                font-family:
                    ui-monospace,
                    SFMono-Regular,
                    Consolas,
                    "Liberation Mono",
                    monospace;
                white-space: pre-wrap;
                word-break: break-word;
                color: #d8dee8;
            }

            #${WNC_UI_ID} .wnc-copy {
                appearance: none;
                border: 1px solid #454b56;
                background: #292e36;
                color: #e8eaed;
                border-radius: 2px;
                padding: 3px 7px;
                margin: 0;
                cursor: pointer;
                font: inherit;
                line-height: 1;
                white-space: nowrap;
            }

            #${WNC_UI_ID} .wnc-copy:hover {
                background: #363c47;
            }

            #${WNC_UI_ID} .wnc-copy.copied {
                background: #3c4650;
            }

            #${WNC_UI_ID} .wnc-sort {
                appearance: none;
                border: 0;
                background: transparent;
                color: inherit;
                font: inherit;
                font-weight: inherit;
                line-height: inherit;
                cursor: pointer;
                padding: 0;
                margin: 0;
            }

            #${WNC_UI_ID} .wnc-sort:hover {
                color: #fff;
            }

            #${WNC_UI_ID} .wnc-sort-arrow {
                display: inline-block;
                margin-left: 3px;
                color: #9da3ad;
            }

            #${WNC_UI_ID} .wnc-group-header {
                background: #1e2229;
                border: 1px solid #343943;
                margin: 1px 0;
                padding: 5px;
                line-height: 1;
                cursor: pointer;
                font-weight: 700;
            }

            #${WNC_UI_ID} .wnc-group-header:hover {
                background: #292e37;
            }

            #${WNC_UI_ID} .wnc-group-name {
                display: inline-block;
            }

            #${WNC_UI_ID} .wnc-group-meta {
                float: right;
                color: #9da3ad;
                font-weight: 400;
            }

            #${WNC_UI_ID} .wnc-rule-main {
                cursor: pointer;
            }

            #${WNC_UI_ID} .wnc-rule-main:hover {
                background: #272c34;
            }

            #${WNC_UI_ID} .wnc-expand {
                width: 22px;
                text-align: center;
                color: #aeb5bf;
                user-select: none;
            }

            #${WNC_UI_ID} .wnc-detail {
                background: #111419;
                color: #c8cdd5;
                padding: 5px;
                border: 1px solid #2b3038;
                line-height: 1;
            }

            #${WNC_UI_ID} .wnc-detail-list {
                margin: 0;
                padding-left: 20px;
                line-height: 1.2;
            }

            #${WNC_UI_ID} .wnc-detail-list li {
                margin: 1px 0;
                padding: 1px;
            }

            #${WNC_UI_ID} .wnc-conflict-cluster {
                margin: 2px 0;
                border: 1px solid #3a3434;
                background: #181719;
            }

            #${WNC_UI_ID} .wnc-conflict-cluster-header {
                padding: 5px;
                background: #252124;
                border-bottom: 1px solid #3a3434;
                font-weight: 700;
            }

            #${WNC_UI_ID} .wnc-conflict {
                padding: 5px;
                border-bottom: 1px solid #2c292b;
                line-height: 1.15;
            }

            #${WNC_UI_ID} .wnc-conflict:last-child {
                border-bottom: 0;
            }

            #${WNC_UI_ID} .wnc-conflict-label {
                color: #aeb5bf;
                font-size: 13px;
            }

            #${WNC_UI_ID} .wnc-conflict-value {
                color: #f0f1f3;
                font-family:
                    ui-monospace,
                    SFMono-Regular,
                    Consolas,
                    monospace;
                word-break: break-word;
            }

            #${WNC_UI_ID} .wnc-badge {
                display: inline-block;
                padding: 2px 4px;
                margin-left: 4px;
                border: 1px solid #454b56;
                border-radius: 2px;
                color: #bfc5ce;
                background: #22262d;
                font-size: 12px;
                line-height: 1;
            }

            #${WNC_UI_ID} .wnc-close {
                appearance: none;
                border: 1px solid #454b56;
                background: #24282f;
                color: #e8eaed;
                border-radius: 2px;
                padding: 3px 7px;
                margin: 0;
                cursor: pointer;
                font: inherit;
                line-height: 1;
            }

            #${WNC_UI_ID} .wnc-close:hover {
                background: #333943;
            }

            #${WNC_UI_ID} .wnc-error {
                margin: 1px;
                padding: 6px;
                border: 1px solid #5a3a3a;
                background: #24191b;
                color: #e1bcbc;
                line-height: 1.2;
            }

            #${WNC_UI_ID} .wnc-path {
                color: #9da3ad;
                font-size: 13px;
                line-height: 1.2;
                margin: 1px;
                padding: 1px;
            }

            #${WNC_UI_ID} .wnc-clickable {
                cursor: pointer;
            }
        `;
    }


    /**********************************************************************
     * 114. INSTALL STYLE
     **********************************************************************/

    function ensureWncStyles() {
        let style =
            document.getElementById(
                WNC_STYLE_ID
            );

        if (
            style
        ) {
            return style;
        }

        style =
            document.createElement(
                "style"
            );

        style.id =
            WNC_STYLE_ID;

        style.textContent =
            getWncStyles();

        (
            document.head ||
            document.documentElement
        ).appendChild(
            style
        );

        return style;
    }


    /**********************************************************************
     * 115. HTML ESCAPING
     **********************************************************************/

    function escapeHtml(
        value
    ) {
        return String(
            value ?? ""
        )
            .replace(
                /&/g,
                "&amp;"
            )
            .replace(
                /</g,
                "&lt;"
            )
            .replace(
                />/g,
                "&gt;"
            )
            .replace(
                /"/g,
                "&quot;"
            )
            .replace(
                /'/g,
                "&#39;"
            );
    }


    /**********************************************************************
     * 116. TAB LABELS
     **********************************************************************/

    function getTabLabel(
        tab
    ) {
        switch (
            tab
        ) {
            case "groups":
                return "Groups";

            case "conflicts":
                return "Conflicts";

            case "candidates":
            default:
                return "Candidates";
        }
    }


    /**********************************************************************
     * 117. SORT ARROW
     **********************************************************************/

    function getSortArrow(
        sortState,
        column
    ) {
        if (
            sortState.column !==
                column ||
            sortState.direction ===
                0
        ) {
            return "";
        }

        return (
            '<span class="wnc-sort-arrow">' +
            (
                sortState.direction ===
                1
                    ? "▲"
                    : "▼"
            ) +
            "</span>"
        );
    }


    /**********************************************************************
     * 118. TOP TOOLBAR
     **********************************************************************/

    function renderToolbar() {
        const tabs =
            WNC_TAB_ORDER
                .map(
                    tab => {
                        const active =
                            state.screen ===
                            tab
                                ? " active"
                                : "";

                        return (
                            '<button class="wnc-tab' +
                            active +
                            '" ' +
                            'data-wnc-tab="' +
                            escapeHtml(
                                tab
                            ) +
                            '">' +
                            escapeHtml(
                                getTabLabel(
                                    tab
                                )
                            ) +
                            "</button>"
                        );
                    }
                )
                .join("");

        /*
         * The template selector is deliberately global.
         *
         * There is no template selector on individual candidate rows.
         */
        const templateOptions =
            INPUT_TEMPLATES
                .map(
                    template =>
                        (
                            '<option value="' +
                            escapeHtml(
                                template
                            ) +
                            '"' +
                            (
                                state.candidateTemplate ===
                                template
                                    ? " selected"
                                    : ""
                            ) +
                            ">" +
                            escapeHtml(
                                template
                            ) +
                            "</option>"
                        )
                )
                .join("");

        return (
            '<div class="wnc-toolbar">' +

                '<div class="wnc-title">' +
                    "Webnovel Cleaner" +
                "</div>" +

                '<div class="wnc-tabs">' +
                    tabs +
                "</div>" +

                '<div class="wnc-spacer"></div>' +

                '<select class="wnc-template" ' +
                    'data-wnc-template>' +
                    templateOptions +
                "</select>" +

                '<button class="wnc-close" ' +
                    'data-wnc-close>' +
                    "Close" +
                "</button>" +

            "</div>"
        );
    }


    /**********************************************************************
     * 119. CANDIDATES TAB
     **********************************************************************/

    function renderCandidatesTab() {
        const candidates =
            sortCandidatesForDisplay(
                state.candidates
            );

        if (
            candidates.length ===
            0
        ) {
            return (
                '<div class="wnc-panel">' +
                    '<div class="wnc-empty">' +
                        "No completely unmatched candidates." +
                    "</div>" +
                "</div>"
            );
        }

        const rows =
            candidates
                .map(
                    candidate => {
                        const name =
                            candidate.name ||
                            "";

                        const frequency =
                            Number(
                                candidate.frequency
                            ) || 0;

                        const input =
                            getGeneratedInput(
                                candidate
                            );

                        return (
                            "<tr>" +

                                "<td>" +
                                    escapeHtml(
                                        name
                                    ) +
                                "</td>" +

                                '<td class="wnc-number">' +
                                    escapeHtml(
                                        frequency
                                    ) +
                                "</td>" +

                                '<td class="wnc-input">' +
                                    escapeHtml(
                                        input
                                    ) +
                                "</td>" +

                                "<td>" +
                                    '<button class="wnc-copy" ' +
                                    'data-wnc-copy="' +
                                    escapeHtml(
                                        input
                                    ) +
                                    '">' +
                                        "Copy" +
                                    "</button>" +
                                "</td>" +

                            "</tr>"
                        );
                    }
                )
                .join("");

        return (
            '<div class="wnc-panel">' +

                '<div class="wnc-table-wrap">' +

                    "<table>" +

                        "<thead>" +
                            "<tr>" +
                                "<th>Candidate</th>" +
                                "<th>Frequency</th>" +
                                "<th>Generated Input</th>" +
                                "<th>Copy</th>" +
                            "</tr>" +
                        "</thead>" +

                        "<tbody>" +
                            rows +
                        "</tbody>" +

                    "</table>" +

                "</div>" +

            "</div>"
        );
    }


    /**********************************************************************
     * 120. GROUP TAB — HEADER
     **********************************************************************/

    function renderGroupHeader(
        group
    ) {
        const ruleCount =
            group.rules?.length ||
            0;

        const matchedCount =
            group.rules?.reduce(
                (
                    total,
                    rule
                ) =>
                    total +
                    (
                        rule.candidates?.length ||
                        0
                    ),
                0
            ) || 0;

        return (
            '<div class="wnc-group-header" ' +
                'data-wnc-group="' +
                escapeHtml(
                    group.index
                ) +
            '">' +

                '<span class="wnc-group-name">' +
                    escapeHtml(
                        group.name ||
                        "(Unnamed group)"
                    ) +
                "</span>" +

                '<span class="wnc-group-meta">' +
                    escapeHtml(
                        ruleCount
                    ) +
                    " rules · " +
                    escapeHtml(
                        matchedCount
                    ) +
                    " matches" +
                "</span>" +

            "</div>"
        );
    }


    /**********************************************************************
     * 121. GROUP TAB — RULE ROW
     **********************************************************************/

    function renderGroupRule(
        group,
        rule
    ) {
        const candidates =
            Array.isArray(
                rule.candidates
            )
                ? rule.candidates
                : [];

        const expanded =
            isRuleExpanded(
                group,
                rule
            );

        const hasDetails =
            candidates.length >
            0;

        const arrow =
            hasDetails
                ? (
                    expanded
                        ? "▼"
                        : "▶"
                )
                : "";

        const output =
            rule.output ?? "";

        const input =
            rule.input ?? "";

        let html =
            "<tr " +
            'class="wnc-rule-main" ' +
            (
                hasDetails
                    ? (
                        'data-wnc-rule-group="' +
                        escapeHtml(
                            group.index
                        ) +
                        '" ' +
                        'data-wnc-rule-index="' +
                        escapeHtml(
                            rule.index
                        ) +
                        '"'
                    )
                    : ""
            ) +
            ">";

        html +=
            '<td class="wnc-expand">' +
                arrow +
            "</td>";

        html +=
            '<td class="wnc-input">' +
                escapeHtml(
                    input
                ) +
            "</td>";

        html +=
            '<td class="wnc-input">' +
                escapeHtml(
                    output
                ) +
            "</td>";

        html +=
            '<td class="wnc-number">' +
                escapeHtml(
                    candidates.length
                ) +
            "</td>";

        html +=
            "</tr>";

        if (
            expanded &&
            hasDetails
        ) {
            html +=
                '<tr>' +
                    '<td></td>' +
                    '<td colspan="3">' +
                        '<div class="wnc-detail">' +
                            '<div class="wnc-conflict-label">' +
                                "Chapter candidates matched by this rule:" +
                            "</div>" +

                            '<ul class="wnc-detail-list">' +

                                candidates
                                    .map(
                                        candidate =>
                                            "<li>" +
                                            escapeHtml(
                                                candidate.name
                                            ) +
                                            " (" +
                                            escapeHtml(
                                                candidate.frequency
                                            ) +
                                            ")" +
                                            "</li>"
                                    )
                                    .join("") +

                            "</ul>" +

                        "</div>" +
                    "</td>" +
                "</tr>";
        }

        return html;
    }


    /**********************************************************************
     * 122. GROUP TAB
     **********************************************************************/

    function renderGroupsTab() {
        const groups =
            sortGroupMatches(
                getVisibleGroupMatches()
            );

        if (
            groups.length ===
            0
        ) {
            return (
                '<div class="wnc-panel">' +
                    '<div class="wnc-empty">' +
                        "No FoxReplace groups matched chapter candidates." +
                    "</div>" +
                "</div>"
            );
        }

        const groupRows =
            groups
                .map(
                    group => {
                        const rules =
                            sortGroupRules(
                                getGroupRulesWithMatches(
                                    group
                                )
                            );

                        return (
                            renderGroupHeader(
                                group
                            ) +

                            '<div class="wnc-table-wrap">' +

                                "<table>" +

                                    "<thead>" +
                                        "<tr>" +

                                            "<th></th>" +

                                            "<th>" +
                                                '<button class="wnc-sort" ' +
                                                'data-wnc-rule-sort="input">' +
                                                    "Input" +
                                                    getSortArrow(
                                                        state.ruleSort,
                                                        "input"
                                                    ) +
                                                "</button>" +
                                            "</th>" +

                                            "<th>" +
                                                '<button class="wnc-sort" ' +
                                                'data-wnc-rule-sort="output">' +
                                                    "Output" +
                                                    getSortArrow(
                                                        state.ruleSort,
                                                        "output"
                                                    ) +
                                                "</button>" +
                                            "</th>" +

                                            "<th>" +
                                                '<button class="wnc-sort" ' +
                                                'data-wnc-rule-sort="matches">' +
                                                    "Matches" +
                                                    getSortArrow(
                                                        state.ruleSort,
                                                        "matches"
                                                    ) +
                                                "</button>" +
                                            "</th>" +

                                        "</tr>" +
                                    "</thead>" +

                                    "<tbody>" +

                                        rules
                                            .map(
                                                rule =>
                                                    renderGroupRule(
                                                        group,
                                                        rule
                                                    )
                                            )
                                            .join("") +

                                    "</tbody>" +

                                "</table>" +

                            "</div>"
                        );
                    }
                )
                .join("");

        return (
            '<div class="wnc-panel">' +

                '<div class="wnc-table-wrap">' +

                    "<table>" +
                        "<thead>" +
                            "<tr>" +

                                "<th>" +
                                    '<button class="wnc-sort" ' +
                                    'data-wnc-group-sort="name">' +
                                        "Group" +
                                        getSortArrow(
                                            state.groupSort,
                                            "name"
                                        ) +
                                    "</button>" +
                                "</th>" +

                                "<th>" +
                                    '<button class="wnc-sort" ' +
                                    'data-wnc-group-sort="rules">' +
                                        "Rules" +
                                        getSortArrow(
                                            state.groupSort,
                                            "rules"
                                        ) +
                                    "</button>" +
                                "</th>" +

                                "<th>" +
                                    '<button class="wnc-sort" ' +
                                    'data-wnc-group-sort="matches">' +
                                        "Matches" +
                                        getSortArrow(
                                            state.groupSort,
                                            "matches"
                                        ) +
                                    "</button>" +
                                "</th>" +

                            "</tr>" +
                        "</thead>" +
                    "</table>" +

                "</div>" +

                groupRows +

            "</div>"
        );
    }


    /**********************************************************************
     * 123. CONFLICT TAB
     **********************************************************************/

    function renderConflict(
        conflict
    ) {
        const candidate =
            conflict.candidate ||
            {};

        const groupName =
            conflict.groupName ||
            "(Unknown group)";

        const ruleInput =
            conflict.ruleInput ||
            "";

        const ruleOutput =
            conflict.ruleOutput ||
            "";

        const type =
            conflict.type ||
            "conflict";

        return (
            '<div class="wnc-conflict">' +

                '<div>' +
                    '<span class="wnc-conflict-label">' +
                        "Candidate: " +
                    "</span>" +
                    '<span class="wnc-conflict-value">' +
                        escapeHtml(
                            candidate.name ||
                            conflict.candidateName ||
                            ""
                        ) +
                    "</span>" +

                    '<span class="wnc-badge">' +
                        escapeHtml(
                            type
                        ) +
                    "</span>" +

                "</div>" +

                '<div>' +
                    '<span class="wnc-conflict-label">' +
                        "Frequency: " +
                    "</span>" +
                    escapeHtml(
                        candidate.frequency ||
                        conflict.frequency ||
                        0
                    ) +
                "</div>" +

                '<div>' +
                    '<span class="wnc-conflict-label">' +
                        "FoxReplace group: " +
                    "</span>" +
                    escapeHtml(
                        groupName
                    ) +
                "</div>" +

                '<div>' +
                    '<span class="wnc-conflict-label">' +
                        "Rule Input: " +
                    "</span>" +
                    '<span class="wnc-conflict-value">' +
                        escapeHtml(
                            ruleInput
                        ) +
                    "</span>" +
                "</div>" +

                '<div>' +
                    '<span class="wnc-conflict-label">' +
                        "Rule Output: " +
                    "</span>" +
                    '<span class="wnc-conflict-value">' +
                        escapeHtml(
                            ruleOutput
                        ) +
                    "</span>" +
                "</div>" +

            "</div>"
        );
    }


    /**********************************************************************
     * 124. CONFLICT CLUSTERS
     **********************************************************************/

    function getConflictClustersForDisplay() {
        const conflicts =
            getVisibleConflicts();

        const clusters = [];
        const byId =
            new Map();

        for (
            const conflict
            of conflicts
        ) {
            const id =
                Number.isFinite(
                    conflict.clusterId
                )
                    ? conflict.clusterId
                    : 0;

            if (
                !byId.has(
                    id
                )
            ) {
                const cluster = {
                    id,
                    conflicts: []
                };

                byId.set(
                    id,
                    cluster
                );

                clusters.push(
                    cluster
                );
            }

            byId
                .get(id)
                .conflicts
                .push(
                    conflict
                );
        }

        return clusters;
    }


    function renderConflictsTab() {
        const clusters =
            getConflictClustersForDisplay();

        if (
            clusters.length ===
            0
        ) {
            return (
                '<div class="wnc-panel">' +
                    '<div class="wnc-empty">' +
                        "No conflicts detected." +
                    "</div>" +
                "</div>"
            );
        }

        return (
            '<div class="wnc-panel">' +

                clusters
                    .map(
                        cluster =>
                            '<div class="wnc-conflict-cluster">' +

                                '<div class="wnc-conflict-cluster-header">' +
                                    "Cluster #" +
                                    escapeHtml(
                                        cluster.id
                                    ) +
                                    " (" +
                                    escapeHtml(
                                        cluster.conflicts.length
                                    ) +
                                    ")" +
                                "</div>" +

                                cluster.conflicts
                                    .map(
                                        renderConflict
                                    )
                                    .join("") +

                            "</div>"
                    )
                    .join("") +

            "</div>"
        );
    }


    /**********************************************************************
     * 125. ACTIVE TAB
     **********************************************************************/

    function renderActiveTab() {
        switch (
            state.screen
        ) {
            case "groups":
                return renderGroupsTab();

            case "conflicts":
                return renderConflictsTab();

            case "candidates":
            default:
                return renderCandidatesTab();
        }
    }


    /**********************************************************************
     * 126. FULL WNC WINDOW
     **********************************************************************/

    function renderWncWindow() {
        const scanInfo =
            getChapterScanInfo();

        const selector =
            scanInfo.selector ||
            "automatic";

        const chapterFound =
            Boolean(
                scanInfo.container
            );

        const error =
            scanInfo.error;

        let html =
            '<div class="wnc-shell">' +

                renderToolbar() +

                '<div class="wnc-path">' +
                    "Chapter container: " +
                    escapeHtml(
                        selector
                    ) +
                    " · " +
                    (
                        chapterFound
                            ? "found"
                            : "not found"
                    ) +
                "</div>";

        if (
            error
        ) {
            html +=
                '<div class="wnc-error">' +
                    escapeHtml(
                        error.message ||
                        error
                    ) +
                "</div>";
        }

        html +=
            '<div class="wnc-content">' +
                renderActiveTab() +
            "</div>";

        html +=
            "</div>";

        return html;
    }


    /**********************************************************************
     * 127. RENDER
     **********************************************************************/

    function render() {
        const overlay =
            document.getElementById(
                WNC_UI_ID
            );

        if (
            !overlay
        ) {
            return;
        }

        overlay.innerHTML =
            renderWncWindow();

        bindWncEvents(
            overlay
        );
    }


    /**********************************************************************
     * 128. OPEN UI
     **********************************************************************/

    function openWnc() {
        ensureWncStyles();

        let overlay =
            document.getElementById(
                WNC_UI_ID
            );

        if (
            !overlay
        ) {
            overlay =
                document.createElement(
                    "div"
                );

            overlay.id =
                WNC_UI_ID;

            document.documentElement
                .appendChild(
                    overlay
                );
        }

        /*
         * Opening WNC always starts on Candidates.
         */
        state.screen =
            "candidates";

        state.groupIndex =
            null;

        runAnalysisSafely();

        render();
    }


    /**********************************************************************
     * 129. CLOSE UI
     **********************************************************************/

    function closeWnc() {
        const overlay =
            document.getElementById(
                WNC_UI_ID
            );

        if (
            overlay
        ) {
            overlay.remove();
        }
    }


    /**********************************************************************
     * 130. END PART 7
     **********************************************************************/
      /**********************************************************************
     * 131. UI EVENT HANDLING
     **********************************************************************/

    function bindWncEvents(
        overlay
    ) {
        if (
            !overlay
        ) {
            return;
        }

        /*
         * Tabs
         */
        overlay
            .querySelectorAll(
                "[data-wnc-tab]"
            )
            .forEach(
                button => {
                    button.addEventListener(
                        "click",
                        () => {
                            const tab =
                                button.getAttribute(
                                    "data-wnc-tab"
                                );

                            if (
                                WNC_TAB_ORDER.includes(
                                    tab
                                )
                            ) {
                                state.screen =
                                    tab;

                                render();
                            }
                        }
                    );
                }
            );


        /*
         * Global candidate template.
         *
         * Changing this immediately regenerates every candidate Input.
         */
        const templateSelect =
            overlay.querySelector(
                "[data-wnc-template]"
            );

        if (
            templateSelect
        ) {
            templateSelect.addEventListener(
                "change",
                event => {
                    setCandidateTemplate(
                        event.target.value
                    );
                }
            );
        }


        /*
         * Close.
         */
        const closeButton =
            overlay.querySelector(
                "[data-wnc-close]"
            );

        if (
            closeButton
        ) {
            closeButton.addEventListener(
                "click",
                closeWnc
            );
        }


        /*
         * Copy generated Input.
         */
        overlay
            .querySelectorAll(
                "[data-wnc-copy]"
            )
            .forEach(
                button => {
                    button.addEventListener(
                        "click",
                        async () => {
                            const value =
                                button.getAttribute(
                                    "data-wnc-copy"
                                ) ||
                                "";

                            const copied =
                                await copyText(
                                    value
                                );

                            if (
                                copied
                            ) {
                                const oldText =
                                    button.textContent;

                                button.textContent =
                                    "Copied";

                                button.classList.add(
                                    "copied"
                                );

                                setTimeout(
                                    () => {
                                        if (
                                            button
                                        ) {
                                            button.textContent =
                                                oldText;

                                            button.classList.remove(
                                                "copied"
                                            );
                                        }
                                    },
                                    900
                                );
                            }
                        }
                    );
                }
            );


        /*
         * Group sorting.
         */
        overlay
            .querySelectorAll(
                "[data-wnc-group-sort]"
            )
            .forEach(
                button => {
                    button.addEventListener(
                        "click",
                        event => {
                            event.stopPropagation();

                            sortGroupsBy(
                                button.getAttribute(
                                    "data-wnc-group-sort"
                                )
                            );
                        }
                    );
                }
            );


        /*
         * Rule sorting.
         */
        overlay
            .querySelectorAll(
                "[data-wnc-rule-sort]"
            )
            .forEach(
                button => {
                    button.addEventListener(
                        "click",
                        event => {
                            event.stopPropagation();

                            sortRulesBy(
                                button.getAttribute(
                                    "data-wnc-rule-sort"
                                )
                            );
                        }
                    );
                }
            );


        /*
         * Expand/collapse individual FoxReplace rules.
         *
         * The rule itself is the clickable row.
         */
        overlay
            .querySelectorAll(
                "[data-wnc-rule-group]"
            )
            .forEach(
                row => {
                    row.addEventListener(
                        "click",
                        () => {
                            const groupIndex =
                                Number(
                                    row.getAttribute(
                                        "data-wnc-rule-group"
                                    )
                                );

                            const ruleIndex =
                                Number(
                                    row.getAttribute(
                                        "data-wnc-rule-index"
                                    )
                                );

                            const group =
                                state.groupMatches
                                    .find(
                                        item =>
                                            item.index ===
                                            groupIndex
                                    );

                            if (
                                !group
                            ) {
                                return;
                            }

                            const rule =
                                group.rules?.find(
                                    item =>
                                        item.index ===
                                        ruleIndex
                                );

                            if (
                                !rule
                            ) {
                                return;
                            }

                            toggleRuleExpanded(
                                group,
                                rule
                            );
                        }
                    );
                }
            );
    }


    /**********************************************************************
     * 132. CLIPBOARD
     **********************************************************************/

    async function copyText(
        value
    ) {
        const text =
            String(
                value ?? ""
            );

        if (
            !text
        ) {
            return false;
        }

        try {
            if (
                navigator.clipboard &&
                typeof navigator.clipboard.writeText ===
                    "function"
            ) {
                await navigator.clipboard.writeText(
                    text
                );

                return true;
            }
        } catch (
            error
        ) {
            console.warn(
                "[WNC] Clipboard API failed:",
                error
            );
        }

        /*
         * Fallback for pages where navigator.clipboard is unavailable.
         */
        try {
            const textarea =
                document.createElement(
                    "textarea"
                );

            textarea.value =
                text;

            textarea.setAttribute(
                "readonly",
                ""
            );

            textarea.style.position =
                "fixed";

            textarea.style.left =
                "-9999px";

            textarea.style.top =
                "0";

            document.body.appendChild(
                textarea
            );

            textarea.focus();
            textarea.select();

            const successful =
                document.execCommand(
                    "copy"
                );

            textarea.remove();

            return Boolean(
                successful
            );
        } catch (
            error
        ) {
            console.warn(
                "[WNC] Clipboard fallback failed:",
                error
            );

            return false;
        }
    }


    /**********************************************************************
     * 133. MENU — OPEN WNC
     **********************************************************************/

    function registerWncMenuCommands() {
        GM_registerMenuCommand(
            "Open Webnovel Cleaner",
            () => {
                openWnc();
            }
        );


        /******************************************************************
         * Import FoxReplace JSON
         ******************************************************************/

        GM_registerMenuCommand(
            "Import FoxReplace JSON",
            () => {
                importFoxReplaceJson();
            }
        );

    /**********************************************************************
     * 134. IMPORT FOXREPLACE JSON
     **********************************************************************/

    function importFoxReplaceJson() {
        const input =
            document.createElement(
                "input"
            );

        input.type =
            "file";

        input.accept =
            ".json,application/json,text/json";

        input.style.display =
            "none";

        document.documentElement
            .appendChild(
                input
            );

        input.addEventListener(
            "change",
            async () => {
                try {
                    const file =
                        input.files?.[0];

                    if (
                        !file
                    ) {
                        return;
                    }

                    await importFoxReplaceFile(
                        file
                    );
                } catch (
                    error
                ) {
                    console.error(
                        "[WNC] Import failed:",
                        error
                    );

                    alert(
                        "WNC could not import the FoxReplace JSON.\n\n" +
                        (
                            error?.message ||
                            String(error)
                        )
                    );
                } finally {
                    input.remove();
                }
            },
            {
                once: true
            }
        );

        input.click();
    }


    /**********************************************************************
     * 135. FOXREPLACE FILE IMPORT
     **********************************************************************/

    async function importFoxReplaceFile(
        file
    ) {
        if (
            !file
        ) {
            throw new Error(
                "No file was selected."
            );
        }

        const fileName =
            String(
                file.name ||
                ""
            );

        const lowerName =
            fileName.toLowerCase();

        if (
            !lowerName.endsWith(
                ".json"
            )
        ) {
            throw new Error(
                "The selected file is not a JSON file."
            );
        }

        const text =
            await readFileText(
                file
            );

        let parsed;

        try {
            parsed =
                JSON.parse(
                    text.replace(
                        /^\uFEFF/,
                        ""
                    )
                );
        } catch (
            error
        ) {
            throw new Error(
                "The selected file is not valid JSON."
            );
        }

        /*
         * Some export/import workflows can produce JSON containing a
         * second JSON string. Support that without assuming it is the
         * normal FoxReplace format.
         */
        if (
            typeof parsed ===
                "string"
        ) {
            try {
                parsed =
                    JSON.parse(
                        parsed
                    );
            } catch {
                throw new Error(
                    "The JSON file contains a string rather than a FoxReplace database."
                );
            }
        }

        const adapted =
            adaptFoxReplaceDatabase(
                parsed
            );

        if (
            !adapted ||
            !Array.isArray(
                adapted.groups
            )
        ) {
            throw new Error(
                "The JSON does not contain a recognizable FoxReplace group database."
            );
        }

        const ruleCount =
            adapted.groups.reduce(
                (
                    total,
                    group
                ) =>
                    total +
                    (
                        Array.isArray(
                            group.rules
                        )
                            ? group.rules.length
                            : 0
                    ),
                0
            );

        if (
            adapted.groups.length ===
                0 ||
            ruleCount ===
                0
        ) {
            throw new Error(
                "The imported database contains no FoxReplace groups/rules."
            );
        }

        /*
         * Important:
         *
         * The imported JSON is stored exactly as imported.
         * It does NOT overwrite the normal WNC database.
         */
        GM_setValue(
            LAST_IMPORTED_DB_KEY,
            parsed
        );

        rawFoxReplaceDatabase =
            parsed;

        adaptedDatabase =
            adapted;

        db =
            adaptedDatabase;

        analyzePage();

        /*
         * If WNC is already open, immediately refresh it.
         */
        render();

        alert(
            "WNC imported FoxReplace JSON successfully.\n\n" +
            "Groups: " +
            adapted.groups.length +
            "\nRules: " +
            ruleCount
        );
    }


    /**********************************************************************
     * 136. FILE READER
     **********************************************************************/

    async function readFileText(
        file
    ) {
        if (
            file &&
            typeof file.text ===
                "function"
        ) {
            return file.text();
        }

        return new Promise(
            (
                resolve,
                reject
            ) => {
                const reader =
                    new FileReader();

                reader.onload =
                    () => {
                        resolve(
                            String(
                                reader.result ||
                                ""
                            )
                        );
                    };

                reader.onerror =
                    () => {
                        reject(
                            new Error(
                                "Unable to read the selected file."
                            )
                        );
                    };

                reader.readAsText(
                    file,
                    "utf-8"
                );
            }
        );
    }


    /**********************************************************************
     * 137. CURRENT-DATABASE VALIDATION
     **********************************************************************/

function ensureDatabaseShape() {
    if (
        !adaptedDatabase ||
        !Array.isArray(
            adaptedDatabase.groups
        )
    ) {
        adaptedDatabase = {
            groups: []
        };

        db =
            adaptedDatabase;
    }

    return adaptedDatabase;
}


    /**********************************************************************
     * 138. STARTUP ANALYSIS
     **********************************************************************/

function initializeWnc() {
    adaptedDatabase =
        loadActiveDatabase();

    db =
        adaptedDatabase;

    ensureDatabaseShape();

    const runAnalysis =
        () => {
            try {
                analyzePage();
            } catch (
                error
            ) {
                console.error(
                    "[WNC] Initial analysis failed:",
                    error
                );

                clearAnalysisResults();
            }
        };

    runAnalysis();

    setTimeout(
        runAnalysis,
        1000
    );

    setTimeout(
        runAnalysis,
        3000
    );
}


    /**********************************************************************
     * 139. PAGE-READY BOOTSTRAP
     **********************************************************************/

    function startWnc() {
        registerWncMenuCommands();

        if (
            document.readyState ===
            "loading"
        ) {
            document.addEventListener(
                "DOMContentLoaded",
                initializeWnc,
                {
                    once: true
                }
            );
        } else {
            initializeWnc();
        }
    }


    /**********************************************************************
     * 140. NO MUTATION OBSERVER
     **********************************************************************/

    /*
     * Deliberately no MutationObserver is installed.
     *
     * WNC analyzes the chapter when:
     *
     *   - the userscript starts
     *   - WNC is opened
     *   - the chapter selector is changed
     *   - a FoxReplace database is imported
     *
     * It does NOT continuously monitor or modify the page.
     */


    /**********************************************************************
     * 141. FINAL START
     **********************************************************************/

    startWnc();

})();
