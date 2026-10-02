// ==UserScript==
// @name         Webnovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      6.1.32
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

    const CHAPTER_CONTAINER_SELECTORS = [
        ".chapter-container",
        ".chapter-body",
        ".entry-content",
        ".text-left",
        ".prose",
        "article",
        "main"
    ];

    const CANDIDATE_REGEX =
        /(?<![A-Z0-9'’-])((?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*)(?:\s+(?:[A-Z](?:\.[A-Z])+\.?|[A-Z]\.|[A-Z]{2,}|[A-Z][A-Za-z0-9'’-]*))*)(?![A-Za-z0-9'’-])/g;

    const FILTER_WORDS = new Set([
        "a","after","an","and","as","at","before","but","by","for","from","how","if","in","of","on","or","since","so","tell","that","the","then","there","this","to","until","what","when","where","while","why","with"
    ]);

    const FILTER_ALONE = new Set([
        "ah","do","ha","he","i","no","oh","you"
    ]);

    const SINGULARIZATION_EXCEPTIONS = new Set([
        "james","davis","lucas","carlos","thomas"
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
        conflictClusters: [],
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
    let chapterText = "";

    function readStorage(
        key,
        fallback = null
    ) {
        try {
            const value =
                GM_getValue(
                    key,
                    fallback
                );

            if (
                typeof value ===
                "string"
            ) {
                try {
                    return JSON.parse(
                        value
                    );
                } catch {
                    return value;
                }
            }

            return value;
        } catch {
            return fallback;
        }
    }

    function writeStorage(
        key,
        value
    ) {
        try {
            GM_setValue(
                key,
                value
            );
            return true;
        } catch {
            return false;
        }
    }

    function normalizeInputType(
        value
    ) {
        const type =
            String(
                value ??
                ""
            )
                .trim()
                .toLowerCase();

        if (
            type ===
            "wholewords"
        ) {
            return "wholewords";
        }

        if (
            type ===
            "regexp" ||
            type ===
            "regex"
        ) {
            return "regexp";
        }

        return "text";
    }

    function normalizeOutputType(
        value
    ) {
        const type =
            String(
                value ??
                ""
            )
                .trim()
                .toLowerCase();

        return type || "text";
    }

    function firstDefined(
        object,
        keys,
        fallback
    ) {
        for (
            const key of keys
        ) {
            if (
                object &&
                object[key] !==
                    undefined &&
                object[key] !==
                    null
            ) {
                return object[key];
            }
        }

        return fallback;
    }

    function normalizeBoolean(
        value,
        fallback = true
    ) {
        if (
            value ===
            undefined ||
            value === null
        ) {
            return fallback;
        }

        if (
            typeof value ===
            "boolean"
        ) {
            return value;
        }

        if (
            typeof value ===
            "number"
        ) {
            return value !== 0;
        }

        const text =
            String(
                value
            )
                .trim()
                .toLowerCase();

        if (
            [
                "false",
                "0",
                "no",
                "off"
            ].includes(text)
        ) {
            return false;
        }

        if (
            [
                "true",
                "1",
                "yes",
                "on"
            ].includes(text)
        ) {
            return true;
        }

        return fallback;
    }

    function normalizeRule(
        rawRule,
        ruleIndex,
        groupIndex
    ) {
        const rule =
            rawRule &&
            typeof rawRule ===
                "object"
                ? rawRule
                : {};

        const input =
            String(
                firstDefined(
                    rule,
                    [
                        "input",
                        "pattern",
                        "find",
                        "search"
                    ],
                    ""
                )
            );

        const output =
            String(
                firstDefined(
                    rule,
                    [
                        "output",
                        "replace",
                        "replacement"
                    ],
                    ""
                )
            );

        return {
            raw: rule,
            groupIndex,
            ruleIndex,
            input,
            output,
            inputType:
                normalizeInputType(
                    firstDefined(
                        rule,
                        [
                            "inputType",
                            "type",
                            "mode"
                        ],
                        "text"
                    )
                ),
            outputType:
                normalizeOutputType(
                    firstDefined(
                        rule,
                        [
                            "outputType",
                            "replaceType"
                        ],
                        "text"
                    )
                ),
            caseSensitive:
                normalizeBoolean(
                    firstDefined(
                        rule,
                        [
                            "caseSensitive",
                            "matchCase"
                        ],
                        false
                    ),
                    false
                ),
            enabled:
                normalizeBoolean(
                    firstDefined(
                        rule,
                        [
                            "enabled",
                            "active"
                        ],
                        true
                    ),
                    true
                ),
            html:
                normalizeBoolean(
                    firstDefined(
                        rule,
                        [
                            "html",
                            "isHtml"
                        ],
                        false
                    ),
                    false
                )
        };
    }

    function normalizeUrls(
        value
    ) {
        if (
            Array.isArray(
                value
            )
        ) {
            return value
                .map(
                    item =>
                        String(
                            item ??
                            ""
                        )
                            .trim()
                )
                .filter(Boolean);
        }

        if (
            value ===
            undefined ||
            value ===
            null
        ) {
            return [];
        }

        return [
            String(value)
                .trim()
        ].filter(Boolean);
    }

    function normalizeGroup(
        rawGroup,
        groupIndex
    ) {
        const group =
            rawGroup &&
            typeof rawGroup ===
                "object"
                ? rawGroup
                : {};

        const rawRules =
            firstDefined(
                group,
                [
                    "rules",
                    "replacements",
                    "items"
                ],
                []
            );

        const rules =
            Array.isArray(
                rawRules
            )
                ? rawRules.map(
                      (
                          rule,
                          ruleIndex
                      ) =>
                          normalizeRule(
                              rule,
                              ruleIndex,
                              groupIndex
                          )
                  )
                : [];

        return {
            raw: group,
            index: groupIndex,
            name: String(
                firstDefined(
                    group,
                    [
                        "name",
                        "groupName",
                        "title"
                    ],
                    `Group ${groupIndex + 1}`
                )
            ),
            urls: normalizeUrls(
                firstDefined(
                    group,
                    [
                        "urls",
                        "url",
                        "sites",
                        "site"
                    ],
                    []
                )
            ),
            rules,
            enabled:
                normalizeBoolean(
                    firstDefined(
                        group,
                        [
                            "enabled",
                            "active"
                        ],
                        true
                    ),
                    true
                ),
            mode: firstDefined(
                group,
                [
                    "mode",
                    "matchMode"
                ],
                ""
            ),
            pageLoad:
                normalizeBoolean(
                    firstDefined(
                        group,
                        [
                            "pageLoad",
                            "onPageLoad"
                        ],
                        false
                    ),
                    false
                ),
            auto:
                normalizeBoolean(
                    firstDefined(
                        group,
                        [
                            "auto",
                            "automatic"
                        ],
                        false
                    ),
                    false
                ),
            html:
                normalizeBoolean(
                    firstDefined(
                        group,
                        [
                            "html",
                            "isHtml"
                        ],
                        false
                    ),
                    false
                )
        };
    }

    function findGroupArray(
        database
    ) {
        if (
            !database ||
            typeof database !==
                "object"
        ) {
            return [];
        }

        if (
            Array.isArray(
                database.groups
            )
        ) {
            return database.groups;
        }

        if (
            Array.isArray(
                database.group
            )
        ) {
            return database.group;
        }

        for (
            const value of Object.values(
                database
            )
        ) {
            if (
                Array.isArray(
                    value
                ) &&
                value.length
            ) {
                const first =
                    value[0];

                if (
                    first &&
                    typeof first ===
                        "object" &&
                    (
                        "rules" in
                            first ||
                        "replacements" in
                            first ||
                        "name" in
                            first ||
                        "groupName" in
                            first
                    )
                ) {
                    return value;
                }
            }

            if (
                value &&
                typeof value ===
                    "object"
            ) {
                const nested =
                    findGroupArray(
                        value
                    );

                if (
                    nested.length
                ) {
                    return nested;
                }
            }
        }

        return [];
    }

    function adaptFoxReplaceDatabase(
        rawDatabase
    ) {
        const groups =
            findGroupArray(
                rawDatabase
            );

        return {
            groups: groups.map(
                (
                    group,
                    groupIndex
                ) =>
                    normalizeGroup(
                        group,
                        groupIndex
                    )
            )
        };
    }

    function countAdaptedRules(
        database
    ) {
        return (
            database?.groups || []
        ).reduce(
            (
                total,
                group
            ) =>
                total +
                (
                    group.rules ||
                    []
                ).length,
            0
        );
    }

    function describeDatabase(
        database
    ) {
        const groups =
            database?.groups ||
            [];

        return {
            groups: groups.length,
            rules: countAdaptedRules(
                database
            )
        };
    }

    function loadNormalDatabase() {
        const value =
            readStorage(
                DB_KEY,
                null
            );

        if (
            !value ||
            typeof value !==
                "object"
        ) {
            return null;
        }

        return value;
    }

    function loadLastImportedDatabase() {
        const value =
            readStorage(
                LAST_IMPORTED_DB_KEY,
                null
            );

        if (
            !value ||
            typeof value !==
                "object"
        ) {
            return null;
        }

        return value;
    }

    function loadActiveDatabase() {
        const normal =
            loadNormalDatabase();

        if (normal) {
            return normal;
        }

        return (
            loadLastImportedDatabase() ||
            {
                groups: []
            }
        );
    }

    function parseImportedText(
        text
    ) {
        try {
            return JSON.parse(
                text
            );
        } catch {
            return null;
        }
    }

    function readFileText(
        file
    ) {
        return new Promise(
            (
                resolve,
                reject
            ) => {
                const reader =
                    new FileReader();

                reader.onload =
                    () =>
                        resolve(
                            String(
                                reader.result ||
                                ""
                            )
                        );

                reader.onerror =
                    () =>
                        reject(
                            reader.error ||
                            new Error(
                                "Unable to read file"
                            )
                        );

                reader.readAsText(
                    file
                );
            }
        );
    }

    function openImportPicker() {
        const input =
            document.createElement(
                "input"
            );

        input.type = "file";
        input.accept =
            ".json,application/json";

        input.addEventListener(
            "change",
            async () => {
                const file =
                    input.files?.[0];

                if (!file) {
                    return;
                }

                try {
                    const text =
                        await readFileText(
                            file
                        );

                    const database =
                        parseImportedText(
                            text
                        );

                    if (!database) {
                        return;
                    }

                    rawFoxReplaceDatabase =
                        database;

                    adaptedDatabase =
                        adaptFoxReplaceDatabase(
                            database
                        );

                    writeStorage(
                        LAST_IMPORTED_DB_KEY,
                        database
                    );

                    render();
                } catch {
                    return;
                }
            }
        );

        input.click();
    }

    function escapeRegex(
        value
    ) {
        return String(
            value ?? ""
        ).replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
    }

    function wildcardToRegex(
        value
    ) {
        const escaped =
            escapeRegex(
                value
            );

        return new RegExp(
            "^" +
                escaped.replace(
                    /\\\*/g,
                    ".*"
                ) +
                "$"
        );
    }

    function urlPatternMatches(
        pattern,
        url
    ) {
        if (
            !pattern
        ) {
            return false;
        }

        try {
            return wildcardToRegex(
                pattern
            ).test(
                url
            );
        } catch {
            return false;
        }
    }

    function groupMatchesCurrentSite(
        group
    ) {
        const urls =
            Array.isArray(
                group?.urls
            )
                ? group.urls
                : [];

        if (!urls.length) {
            return true;
        }

        const url =
            location.href;

        return urls.some(
            pattern =>
                urlPatternMatches(
                    pattern,
                    url
                )
        );
    }

    function getCurrentSiteGroups() {
        return (
            adaptedDatabase.groups ||
            []
        ).filter(
            group =>
                group.enabled &&
                groupMatchesCurrentSite(
                    group
                )
        );
    }

    function getCurrentSiteRules() {
        return getCurrentSiteGroups()
            .flatMap(
                group =>
                    (
                        group.rules ||
                        []
                    ).filter(
                        rule =>
                            rule.enabled
                    )
            );
    }

    function resetCandidateRegex() {
        CANDIDATE_REGEX.lastIndex = 0;
    }

    function shouldFilterStandaloneCandidate(
        candidate
    ) {
        const normalized =
            String(
                candidate ?? ""
            )
                .trim()
                .toLowerCase();

        if (
            !normalized
        ) {
            return true;
        }

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

        return false;
    }

    function scanCandidateOccurrences(
        text
    ) {
        const source =
            String(
                text ?? ""
            );

        resetCandidateRegex();

        const occurrences = [];
        let match;

        while (
            (
                match =
                    CANDIDATE_REGEX.exec(
                        source
                    )
            ) !== null
        ) {
            const value =
                String(
                    match[1] ||
                    ""
                ).trim();

            if (
                !value ||
                shouldFilterStandaloneCandidate(
                    value
                )
            ) {
                continue;
            }

            occurrences.push({
                text: value,
                index:
                    match.index
            });
        }

        return occurrences;
    }

    function splitCandidateTokens(
        candidate
    ) {
        return String(
            candidate ?? ""
        )
            .trim()
            .split(
                /\s+/
            )
            .filter(Boolean);
    }

    function normalizeCandidateToken(
        token
    ) {
        let value =
            String(
                token ?? ""
            )
                .trim()
                .replace(
                    /’/g,
                    "'"
                )
                .toLowerCase();

        if (
            !value
        ) {
            return "";
        }

        if (
            value.endsWith(
                "'s"
            )
        ) {
            value =
                value.slice(
                    0,
                    -2
                );
        } else if (
            value.endsWith(
                "s'"
            )
        ) {
            value =
                value.slice(
                    0,
                    -1
                );
        }

        if (
            SINGULARIZATION_EXCEPTIONS.has(
                value
            )
        ) {
            return value;
        }

        if (
            value.length <= 3
        ) {
            return value;
        }

        if (
            value.endsWith(
                "ies"
            ) &&
            value.length > 4
        ) {
            return (
                value.slice(
                    0,
                    -3
                ) +
                "y"
            );
        }

        if (
            /(?:ches|shes|xes|zes)$/.test(
                value
            )
        ) {
            return value.slice(
                0,
                -2
            );
        }

        if (
            value.endsWith(
                "sses"
            )
        ) {
            return value.slice(
                0,
                -2
            );
        }

        if (
            value.endsWith(
                "oes"
            ) &&
            value.length > 4
        ) {
            return value.slice(
                0,
                -2
            );
        }

        if (
            value ===
            "leaves"
        ) {
            return "leaf";
        }

        if (
            value ===
            "wolves"
        ) {
            return "wolf";
        }

        if (
            value.endsWith(
                "s"
            ) &&
            !value.endsWith(
                "ss"
            )
        ) {
            return value.slice(
                0,
                -1
            );
        }

        return value;
    }

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

    function mergeCandidateOccurrences(
        occurrences
    ) {
        const map =
            new Map();

        for (
            const occurrence
            of occurrences
        ) {
            const name =
                String(
                    occurrence?.text ??
                    ""
                ).trim();

            if (!name) {
                continue;
            }

            const normalized =
                normalizeCandidate(
                    name
                );

            if (
                !normalized
            ) {
                continue;
            }

            let candidate =
                map.get(
                    normalized
                );

            if (
                !candidate
            ) {
                candidate = {
                    name,
                    normalized,
                    frequency: 0,
                    variants: new Map(),
                    occurrences: []
                };

                map.set(
                    normalized,
                    candidate
                );
            }

            candidate.frequency += 1;

            candidate.variants.set(
                name,
                (
                    candidate.variants.get(
                        name
                    ) || 0
                ) + 1
            );

            candidate.occurrences.push(
                occurrence
            );
        }

        return Array.from(
            map.values()
        );
    }

    function chooseCandidateDisplayName(
        candidate
    ) {
        if (
            !candidate?.variants
        ) {
            return (
                candidate?.name ||
                ""
            );
        }

        let bestName =
            candidate.name ||
            "";

        let bestFrequency =
            -1;

        for (
            const [
                name,
                frequency
            ] of candidate.variants
        ) {
            if (
                frequency >
                bestFrequency
            ) {
                bestFrequency =
                    frequency;
                bestName =
                    name;
            }
        }

        return bestName;
    }

    function finalizeCandidateNames(
        candidates
    ) {
        return candidates.map(
            (
                candidate,
                index
            ) => ({
                ...candidate,
                name:
                    chooseCandidateDisplayName(
                        candidate
                    ),
                originalIndex:
                    index
            })
        );
    }

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

        return finalizeCandidateNames(
            merged
        );
    }

    const MAX_CLUSTER_TOKEN_LINKS = 2;

    function candidateTokens(
        candidate
    ) {
        return splitCandidateTokens(
            candidate?.normalized ||
                candidate?.name ||
                ""
        ).map(
            normalizeCandidateToken
        );
    }

    function tokenEditDistance(
        leftTokens,
        rightTokens
    ) {
        const left =
            Array.isArray(
                leftTokens
            )
                ? leftTokens
                : [];

        const right =
            Array.isArray(
                rightTokens
            )
                ? rightTokens
                : [];

        const previous =
            Array.from(
                {
                    length:
                        right.length +
                        1
                },
                (
                    _,
                    index
                ) => index
            );

        for (
            let i = 1;
            i <= left.length;
            i++
        ) {
            const current =
                new Array(
                    right.length +
                        1
                );

            current[0] = i;

            for (
                let j = 1;
                j <= right.length;
                j++
            ) {
                const cost =
                    left[i - 1] ===
                    right[j - 1]
                        ? 0
                        : 1;

                current[j] =
                    Math.min(
                        current[j - 1] +
                            1,
                        previous[j] +
                            1,
                        previous[j - 1] +
                            cost
                    );
            }

            for (
                let j = 0;
                j < current.length;
                j++
            ) {
                previous[j] =
                    current[j];
            }
        }

        return previous[
            right.length
        ];
    }

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

        let index = 0;

        for (
            const token
            of longer
        ) {
            if (
                token ===
                shorter[index]
            ) {
                index++;

                if (
                    index ===
                    shorter.length
                ) {
                    return true;
                }
            }
        }

        return (
            shorter.length ===
            0
        );
    }

    function candidateTokenLinkDistance(
        left,
        right
    ) {
        if (
            left.normalized ===
            right.normalized
        ) {
            return 0;
        }

        const leftTokens =
            candidateTokens(
                left
            );

        const rightTokens =
            candidateTokens(
                right
            );

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

    function candidatesAreClusterLinked(
        left,
        right
    ) {
        return (
            candidateTokenLinkDistance(
                left,
                right
            ) <=
            MAX_CLUSTER_TOKEN_LINKS
        );
    }

    

    

    

    function buildCandidateClusters(
        candidates
    ) {
        if (
            !Array.isArray(
                candidates
            ) ||
            !candidates.length
        ) {
            return {
                clusters: [],
                unclustered: [],
                assigned: new Set()
            };
        }

        const ordered =
            candidates
                .slice()
                .sort(
                    (
                        left,
                        right
                    ) => {
                        const frequencyDifference =
                            (
                                Number(
                                    right.frequency
                                ) || 0
                            ) -
                            (
                                Number(
                                    left.frequency
                                ) || 0
                            );

                        if (
                            frequencyDifference !==
                            0
                        ) {
                            return frequencyDifference;
                        }

                        return (
                            (
                                left.originalIndex ??
                                0
                            ) -
                            (
                                right.originalIndex ??
                                0
                            )
                        );
                    }
                );

        const clusters = [];
        const assigned = new Set();

        for (
            const root
            of ordered
        ) {
            const rootKey =
                root.normalized;

            if (
                assigned.has(
                    rootKey
                )
            ) {
                continue;
            }

            const cluster = {
                root,
                rootFrequency:
                    Number(
                        root.frequency
                    ) || 0,
                members: []
            };

            cluster.members.push(
                root
            );

            assigned.add(
                rootKey
            );

            for (
                const candidate
                of ordered
            ) {
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
                        root,
                        candidate
                    )
                ) {
                    cluster.members.push(
                        candidate
                    );

                    assigned.add(
                        candidateKey
                    );
                }
            }

            cluster.members.sort(
                (
                    left,
                    right
                ) => {
                    const frequencyDifference =
                        (
                            Number(
                                right.frequency
                            ) || 0
                        ) -
                        (
                            Number(
                                left.frequency
                            ) || 0
                        );

                    if (
                        frequencyDifference !==
                        0
                    ) {
                        return frequencyDifference;
                    }

                    return String(
                        left.name ||
                        ""
                    ).localeCompare(
                        String(
                            right.name ||
                            ""
                        )
                    );
                }
            );

            clusters.push(
                cluster
            );
        }

        return {
            clusters,
            unclustered:
                ordered.filter(
                    candidate =>
                        !assigned.has(
                            candidate.normalized
                        )
                ),
            assigned
        };
    }
      

    function applyUnclusteredFrequencyFilter(
        candidates
    ) {
        if (
            !Array.isArray(
                candidates
            ) ||
            !candidates.length
        ) {
            return {
                candidates: [],
                removed: [],
                isolated: [],
                maximumFrequency: 0,
                threshold: 0
            };
        }

        const maximumFrequency =
            Math.max(
                ...candidates.map(
                    candidate =>
                        Number(
                            candidate.frequency
                        ) || 0
                )
            );

        const clustering =
            buildCandidateClusters(
                candidates
            );

        const isolated =
            clustering.clusters
                .filter(
                    cluster =>
                        cluster.members.length ===
                        1
                )
                .map(
                    cluster =>
                        cluster.root
                );

        const threshold =
            maximumFrequency *
            UNCLUSTERED_FREQUENCY_RATIO;

        const isolatedSet =
            new Set(
                isolated.map(
                    candidate =>
                        candidate.normalized
                )
            );

        const removed = [];
        const kept = [];

        for (
            const candidate
            of candidates
        ) {
            if (
                isolatedSet.has(
                    candidate.normalized
                ) &&
                (
                    Number(
                        candidate.frequency
                    ) || 0
                ) <
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

    function processCandidateClusters(
        candidates
    ) {
        const filtered =
            applyUnclusteredFrequencyFilter(
                candidates
            );

        const clustering =
            buildCandidateClusters(
                filtered.candidates
            );

        return {
            candidates:
                filtered.candidates,
            removed:
                filtered.removed,
            clusters:
                clustering.clusters,
            isolated:
                filtered.isolated,
            maximumFrequency:
                filtered.maximumFrequency,
            threshold:
                filtered.threshold
        };
    }

    

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

        const rawFlags =
            String(
                rule.raw?.flags ||
                rule.raw?.regexpFlags ||
                ""
            );

        let flags =
            rule.caseSensitive
                ? rawFlags.replace(
                      /i/g,
                      ""
                  )
                : rawFlags.includes(
                      "i"
                  )
                    ? rawFlags
                    : rawFlags + "i";

        flags =
            flags.replace(
                /g/g,
                ""
            );

        try {
            return new RegExp(
                rule.input,
                flags
            );
        } catch {
            return null;
        }
    }

    function compareRuleText(
        candidateText,
        ruleText,
        caseSensitive
    ) {
        const left =
            String(
                candidateText ??
                ""
            );

        const right =
            String(
                ruleText ??
                ""
            );

        if (
            caseSensitive
        ) {
            return (
                left === right
            );
        }

        return (
            left.toLowerCase() ===
            right.toLowerCase()
        );
    }

    function wholeWordRuleMatches(
        candidateText,
        ruleText,
        caseSensitive
    ) {
        const value =
            String(
                candidateText ??
                ""
            );

        const input =
            String(
                ruleText ??
                ""
            );

        if (
            !value ||
            !input
        ) {
            return false;
        }

        const flags =
            caseSensitive
                ? ""
                : "i";

        try {
            const pattern =
                new RegExp(
                    "(?<![A-Za-z0-9'’-])" +
                        escapeRegex(
                            input
                        ) +
                        "(?![A-Za-z0-9'’-])",
                    flags
                );

            return pattern.test(
                value
            );
        } catch {
            return false;
        }
    }

    function textRuleContains(
        candidateText,
        ruleText,
        caseSensitive
    ) {
        const value =
            String(
                candidateText ??
                ""
            );

        const input =
            String(
                ruleText ??
                ""
            );

        if (
            caseSensitive
        ) {
            return value.includes(
                input
            );
        }

        return value
            .toLowerCase()
            .includes(
                input.toLowerCase()
            );
    }

    function ruleMatchesEntireCandidate(
        candidate,
        rule
    ) {
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
            return forms.some(
                form =>
                    regexMatchesEntireString(
                        form,
                        rule
                    )
            );
        }

        if (
            rule.inputType ===
            "wholewords"
        ) {
            const input =
                String(
                    rule.input ??
                    ""
                ).trim();

            return forms.some(
                form =>
                    compareRuleText(
                        String(
                            form
                        ).trim(),
                        input,
                        rule.caseSensitive
                    )
            );
        }

        return forms.some(
            form =>
                compareRuleText(
                    form,
                    rule.input,
                    rule.caseSensitive
                )
        );
    }

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

        regex.lastIndex = 0;

        const match =
            regex.exec(
                value
            );

        if (!match) {
            return false;
        }

        return (
            match.index ===
                0 &&
            match[0].length ===
                value.length
        );
    }

    function ruleMatchesCandidate(
        candidate,
        rule
    ) {
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
                    regex.lastIndex =
                        0;

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

    function getCandidateMatchForms(
        candidate
    ) {
        const forms =
            new Set();

        if (
            candidate?.variants
        ) {
            for (
                const value
                of candidate.variants.keys()
            ) {
                if (
                    value
                ) {
                    forms.add(
                        value
                    );
                }
            }
        }

        if (
            candidate?.name
        ) {
            forms.add(
                String(
                    candidate.name
                )
            );
        }

        return Array.from(
            forms
        );
    }

    function rulePartiallyMatchesCandidate(
        candidate,
        rule
    ) {
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
                    regex.lastIndex =
                        0;

                    const match =
                        regex.exec(
                            form
                        );

                    if (
                        !match ||
                        !match[0].length
                    ) {
                        return false;
                    }

                    return !(
                        match.index ===
                            0 &&
                        match[0].length ===
                            form.length
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
                    ) &&
                    !compareRuleText(
                        form.trim(),
                        String(
                            rule.input ||
                                ""
                        ).trim(),
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
                ) &&
                !compareRuleText(
                    form,
                    rule.input,
                    rule.caseSensitive
                )
        );
    }

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

    function findCandidateRuleMatches(
        candidate
    ) {
        const rules =
            getCurrentSiteRules();

        const exact = [];
        const partial = [];
        const all = [];

        for (
            const rule
            of rules
        ) {
            const type =
                getRuleMatchType(
                    candidate,
                    rule
                );

            if (
                type ===
                "exact"
            ) {
                exact.push(
                    rule
                );
                all.push({
                    rule,
                    type
                });
            } else if (
                type ===
                "partial"
            ) {
                partial.push(
                    rule
                );
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

    function ruleOutputMatchesRuleInput(
        sourceRule,
        targetRule
    ) {
        if (
            !sourceRule?.enabled ||
            !targetRule?.enabled ||
            !sourceRule.output ||
            !targetRule.input ||
            sourceRule ===
                targetRule
        ) {
            return false;
        }

        const output =
            String(
                sourceRule.output
            );

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

        if (
            targetRule.inputType ===
            "wholewords"
        ) {
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

    function classifyCandidate(
        candidate
    ) {
        const matches =
            findCandidateRuleMatches(
                candidate
            );

        if (
            !matches.all.length
        ) {
            return {
                type: "candidate",
                candidate,
                matches
            };
        }

        if (
            matches.exact.length ===
                1 &&
            matches.partial.length ===
                0
        ) {
            return {
                type: "group",
                candidate,
                rule:
                    matches.exact[0],
                matches
            };
        }

        return {
            type: "conflict",
            candidate,
            matches
        };
    }

    function buildGroupMatches(
        classifications
    ) {
        const matchesByGroup =
            new Map();

        for (
            const classification
            of classifications
        ) {
            if (
                classification.type !==
                "group"
            ) {
                continue;
            }

            const rule =
                classification.rule;

            const groupIndex =
                Number(
                    rule.groupIndex
                );

            if (
                !Number.isFinite(
                    groupIndex
                )
            ) {
                continue;
            }

            if (
                !matchesByGroup.has(
                    groupIndex
                )
            ) {
                matchesByGroup.set(
                    groupIndex,
                    new Map()
                );
            }

            const rules =
                matchesByGroup.get(
                    groupIndex
                );

            if (
                !rules.has(
                    rule.ruleIndex
                )
            ) {
                rules.set(
                    rule.ruleIndex,
                    []
                );
            }

            const candidates =
                rules.get(
                    rule.ruleIndex
                );

            if (
                !candidates.some(
                    candidate =>
                        candidate.normalized ===
                        classification.candidate.normalized
                )
            ) {
                candidates.push(
                    classification.candidate
                );
            }
        }

        const result = [];

        for (
            let groupIndex = 0;
            groupIndex <
                adaptedDatabase.groups.length;
            groupIndex++
        ) {
            const sourceGroup =
                adaptedDatabase.groups[
                    groupIndex
                ];

            const matchedRules =
                matchesByGroup.get(
                    groupIndex
                );

            if (
                !matchedRules
            ) {
                continue;
            }

            const rules = [];

            for (
                let ruleIndex = 0;
                ruleIndex <
                    (
                        sourceGroup.rules?.length ||
                        0
                    );
                ruleIndex++
            ) {
                if (
                    !matchedRules.has(
                        ruleIndex
                    )
                ) {
                    continue;
                }

                const sourceRule =
                    sourceGroup.rules[
                        ruleIndex
                    ];

                rules.push({
                    ...sourceRule,
                    candidates:
                        matchedRules.get(
                            ruleIndex
                        )
                });
            }

            if (
                rules.length
            ) {
                result.push({
                    ...sourceGroup,
                    index: groupIndex,
                    rules
                });
            }
        }

        return result;
    }

      function getConflictRuleKey(
        rule
    ) {
        if (!rule) {
            return "";
        }

        return (
            String(
                rule.groupIndex ?? ""
            ) +
            ":" +
            String(
                rule.ruleIndex ?? ""
            )
        );
    }

    function buildConflictClusters(
        classifications
    ) {
        const ruleMap = new Map();
        const adjacency = new Map();

        for (
            const classification
            of classifications || []
        ) {
            if (
                classification.type !==
                "conflict"
            ) {
                continue;
            }

            const uniqueRules =
                new Map();

            for (
                const match
                of (
                    classification.matches?.all ||
                    []
                )
            ) {
                const rule =
                    match.rule;

                const key =
                    getConflictRuleKey(
                        rule
                    );

                if (key) {
                    uniqueRules.set(
                        key,
                        rule
                    );
                }
            }

            const keys =
                Array.from(
                    uniqueRules.keys()
                );

            for (
                const [key, rule]
                of uniqueRules
            ) {
                ruleMap.set(
                    key,
                    rule
                );

                if (
                    !adjacency.has(
                        key
                    )
                ) {
                    adjacency.set(
                        key,
                        new Set()
                    );
                }
            }

            for (
                let index = 0;
                index < keys.length;
                index++
            ) {
                for (
                    let next = index + 1;
                    next < keys.length;
                    next++
                ) {
                    adjacency
                        .get(
                            keys[index]
                        )
                        .add(
                            keys[next]
                        );

                    adjacency
                        .get(
                            keys[next]
                        )
                        .add(
                            keys[index]
                        );
                }
            }
        }

        const rules =
            Array.from(
                ruleMap.entries()
            );

        for (
            const [
                sourceKey,
                sourceRule
            ]
            of rules
        ) {
            for (
                const [
                    targetKey,
                    targetRule
                ]
                of rules
            ) {
                if (
                    sourceKey ===
                    targetKey
                ) {
                    continue;
                }

                if (
                    ruleOutputMatchesRuleInput(
                        sourceRule,
                        targetRule
                    )
                ) {
                    adjacency
                        .get(
                            sourceKey
                        )
                        .add(
                            targetKey
                        );

                    adjacency
                        .get(
                            targetKey
                        )
                        .add(
                            sourceKey
                        );
                }
            }
        }

        const visited = new Set();
        const clusters = [];
        const ruleClusterMap =
            new Map();

        let nextClusterId = 1;

        for (
            const [
                rootKey
            ]
            of rules
        ) {
            if (
                visited.has(
                    rootKey
                )
            ) {
                continue;
            }

            const stack = [
                rootKey
            ];

            const clusterKeys = [];

            visited.add(
                rootKey
            );

            while (
                stack.length
            ) {
                const key =
                    stack.pop();

                clusterKeys.push(
                    key
                );

                for (
                    const neighbor
                    of (
                        adjacency.get(
                            key
                        ) || new Set()
                    )
                ) {
                    if (
                        visited.has(
                            neighbor
                        )
                    ) {
                        continue;
                    }

                    visited.add(
                        neighbor
                    );

                    stack.push(
                        neighbor
                    );
                }
            }

            clusterKeys.sort(
                (
                    left,
                    right
                ) => {
                    const leftRule =
                        ruleMap.get(
                            left
                        );

                    const rightRule =
                        ruleMap.get(
                            right
                        );

                    return (
                        (
                            leftRule?.groupIndex ??
                            0
                        ) -
                        (
                            rightRule?.groupIndex ??
                            0
                        )
                    ) ||
                    (
                        (
                            leftRule?.ruleIndex ??
                            0
                        ) -
                        (
                            rightRule?.ruleIndex ??
                            0
                        )
                    );
                }
            );

            const clusterId =
                nextClusterId++;

            for (
                const key
                of clusterKeys
            ) {
                ruleClusterMap.set(
                    key,
                    clusterId
                );
            }

            clusters.push({
                id: clusterId,
                ruleKeys:
                    clusterKeys,
                rules:
                    clusterKeys.map(
                        key =>
                            ruleMap.get(
                                key
                            )
                    )
            });
        }

        return {
            clusters,
            ruleClusterMap
        };
    }

    function buildConflictData(
        classifications,
        ruleClusterMap
    ) {
        const conflicts = [];
        let discoveryOrder = 0;

        for (
            const classification
            of classifications
        ) {
            if (
                classification.type !==
                "conflict"
            ) {
                continue;
            }

            const candidate =
                classification.candidate;

            for (
                const match
                of (
                    classification.matches?.all ||
                    []
                )
            ) {
                const rule =
                    match.rule;

                const group =
                    adaptedDatabase.groups[
                        rule.groupIndex
                    ];

                if (!group) {
                    continue;
                }

                const ruleKey =
                    getConflictRuleKey(
                        rule
                    );

                conflicts.push({
                    id:
                        `conflict-${discoveryOrder + 1}`,
                    discoveryOrder:
                        discoveryOrder++,
                    candidate,
                    candidateName:
                        candidate.name ||
                        "",
                    frequency:
                        Number(
                            candidate.frequency
                        ) || 0,
                    clusterId:
                        ruleClusterMap?.get(
                            ruleKey
                        ) || 0,
                    type:
                        match.type,
                    groupName:
                        group.name ||
                        "(Unnamed group)",
                    group,
                    rule,
                    ruleInput:
                        rule.input ||
                        "",
                    ruleOutput:
                        rule.output ||
                        ""
                });
            }
        }

        return conflicts;
    }

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

    function normalizeGeneratedInputSpacing(
        value
    ) {
        return String(
            value ?? ""
        )
            .replace(
                /\s+/g,
                " "
            )
            .trim();
    }

    function generateOtherInput(
        candidate
    ) {
        const value =
            normalizeGeneratedInputSpacing(
                candidate?.name ||
                candidate?.displayName ||
                ""
            );

        if (!value) {
            return "";
        }

        return (
            "(?<![a-z])" +
            escapeRegexLiteral(
                value
            ) +
            "(?![a-z])"
        );
    }

    function generateKoreanInput(
        candidate
    ) {
        const value =
            normalizeGeneratedInputSpacing(
                candidate?.name ||
                candidate?.displayName ||
                ""
            );

        if (!value) {
            return "";
        }

        const tokens =
            splitCandidateTokens(
                value
            );

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

        const nameTokens =
            tokens.slice(1);

        const pattern =
            nameTokens
                .map(
                    token =>
                        escapeRegexLiteral(
                            token
                        )
                )
                .join(
                    "[- ]?"
                );

        return (
            "(?<![a-z])" +
            pattern +
            "(?![a-z])"
        );
    }

    function generateJapaneseInput(
        candidate
    ) {
        const value =
            normalizeGeneratedInputSpacing(
                candidate?.name ||
                candidate?.displayName ||
                ""
            );

        if (!value) {
            return "";
        }

        const tokens =
            splitCandidateTokens(
                value
            );

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

        const forward =
            tokens
                .map(
                    escapeRegexLiteral
                )
                .join(
                    "\\s+"
                );

        const reverse =
            [
                tokens[
                    tokens.length - 1
                ],
                ...tokens.slice(
                    0,
                    -1
                )
            ]
                .map(
                    escapeRegexLiteral
                )
                .join(
                    "\\s+"
                );

        return (
            "(?<![a-z])(?:" +
            forward +
            "|" +
            reverse +
            ")(?![a-z])"
        );
    }

    function generateCandidateInput(
        candidate,
        template
    ) {
        if (
            template ===
            "Korean"
        ) {
            return generateKoreanInput(
                candidate
            );
        }

        if (
            template ===
            "Japanese"
        ) {
            return generateJapaneseInput(
                candidate
            );
        }

        return generateOtherInput(
            candidate
        );
    }

    function regenerateCandidateInputs(
        candidates,
        template
    ) {
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

        regenerateCandidateInputs(
            state.candidates,
            template
        );

        render();
    }

    function generatedInputLooksValid(
        input
    ) {
        if (!input) {
            return false;
        }

        try {
            new RegExp(
                input
            );

            return true;
        } catch {
            return false;
        }
    }

    function getGeneratedInput(
        candidate
    ) {
        if (
            candidate.generatedInput
        ) {
            return candidate.generatedInput;
        }

        const input =
            generateCandidateInput(
                candidate,
                state.candidateTemplate
            );

        candidate.generatedInput =
            input;

        return input;
    }

    function clearAnalysisResults() {
        state.candidates = [];
        state.groupMatches = [];
        state.conflicts = [];
        state.conflictClusters = [];
    }

    function buildCandidateResults(
        classifications
    ) {
        const candidates = [];

        for (
            const classification
            of classifications
        ) {
            if (
                classification.type !==
                "candidate"
            ) {
                continue;
            }

            const candidate =
                classification.candidate;

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
function getChapterScanInfo() {
    if (!document.body) {
        return {
            container: null,
            text: "",
            error: null
        };
    }

    let container = null;

    for (const selector of CHAPTER_CONTAINER_SELECTORS) {
        try {
            const element = document.querySelector(selector);

            if (element) {
                container = element;
                break;
            }
        } catch {
            continue;
        }
    }

    container = container || document.body;

    const text = String(
        container.innerText ??
        container.textContent ??
        ""
    )
        .replace(/\u00A0/g, " ")
        .replace(/\r/g, "")
        .replace(/\s+/g, " ")
        .trim();

    return {
        container,
        text,
        error: null
    };
}
function analyzePage() {
        clearAnalysisResults();

        const scanInfo =
            getChapterScanInfo();

        chapterText =
            scanInfo.text || "";

        if (
            !chapterText.trim()
        ) {
            return {
                chapterText: "",
                candidates: [],
                groupMatches: [],
                conflicts: [],
                conflictClusters: [],
                error:
                    scanInfo.error ||
                    null
            };
        }

        const scanned =
            scanChapterCandidates(
                chapterText
            );

        const classifications =
            scanned.map(
                candidate =>
                    classifyCandidate(
                        candidate
                    )
            );

        const candidates =
            buildCandidateResults(
                classifications
            );

        const candidateProcessing =
            processCandidateClusters(
                candidates
            );

        const groupMatches =
            buildGroupMatches(
                classifications
            );

        const conflictClustering =
            buildConflictClusters(
                classifications
            );

        const conflicts =
            buildConflictData(
                classifications,
                conflictClustering.ruleClusterMap
            );

        state.candidates =
            candidateProcessing.candidates;

        state.groupMatches =
            groupMatches;

        state.conflicts =
            conflicts;

        state.conflictClusters =
            conflictClustering.clusters;

        regenerateCandidateInputs(
            state.candidates,
            state.candidateTemplate
        );

        return {
            chapterText,
            candidates:
                state.candidates,
            groupMatches,
            conflicts,
            conflictClusters:
                state.conflictClusters,
            error: null
        };
    }

    function runAnalysisSafely() {
        try {
            return analyzePage();
        } catch (
            error
        ) {
            clearAnalysisResults();

            return {
                chapterText: "",
                candidates: [],
                groupMatches: [],
                conflicts: [],
                error
            };
        }
    }

    function getVisibleGroupMatches() {
        if (
            state.showOtherGroups
        ) {
            return state.groupMatches;
        }

        const currentGroups =
            new Set(
                getCurrentSiteGroups().map(
                    group =>
                        group.index
                )
            );

        return state.groupMatches.filter(
            group =>
                currentGroups.has(
                    group.index
                )
        );
    }

    function getGroupRulesWithMatches(
        group
    ) {
        return (
            group?.rules ||
            []
        ).filter(
            rule =>
                Array.isArray(
                    rule.candidates
                ) &&
                rule.candidates.length
        );
    }

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
            sortState.direction ===
            0
        ) {
            sortState.direction =
                1;
        } else if (
            sortState.direction ===
            1
        ) {
            sortState.direction =
                -1;
        } else {
            sortState.direction =
                0;
        }
    }

    function compareNumbers(
        left,
        right
    ) {
        return (
            (
                Number(
                    left
                ) || 0
            ) -
            (
                Number(
                    right
                ) || 0
            )
        );
    }

    function compareStrings(
        left,
        right
    ) {
        return String(
            left ?? ""
        ).localeCompare(
            String(
                right ?? ""
            )
        );
    }

    function getGroupSortValue(
        group,
        column
    ) {
        if (
            column ===
            "name"
        ) {
            return group.name;
        }

        if (
            column ===
            "rules"
        ) {
            return (
                group.rules?.length ||
                0
            );
        }

        if (
            column ===
            "matches"
        ) {
            return (
                getGroupRulesWithMatches(
                    group
                ).reduce(
                    (
                        total,
                        rule
                    ) =>
                        total +
                        (
                            rule.candidates
                                ?.length ||
                            0
                        ),
                    0
                )
            );
        }

        return group.index;
    }

    function compareGroups(
        left,
        right
    ) {
        const column =
            state.groupSort.column;

        if (
            state.groupSort.direction ===
            0
        ) {
            return (
                left.index -
                right.index
            );
        }

        const leftValue =
            getGroupSortValue(
                left,
                column
            );

        const rightValue =
            getGroupSortValue(
                right,
                column
            );

        const result =
            typeof leftValue ===
                "number" &&
            typeof rightValue ===
                "number"
                ? compareNumbers(
                      leftValue,
                      rightValue
                  )
                : compareStrings(
                      leftValue,
                      rightValue
                  );

        return (
            result *
            state.groupSort.direction
        );
    }

    function sortGroupMatches(
        groups
    ) {
        return groups
            .slice()
            .sort(
                compareGroups
            );
    }

    function getRuleSortValue(
        rule,
        column
    ) {
        if (
            column ===
            "input"
        ) {
            return rule.input;
        }

        if (
            column ===
            "output"
        ) {
            return rule.output;
        }

        if (
            column ===
            "matches"
        ) {
            return (
                rule.candidates?.length ||
                0
            );
        }

        return rule.ruleIndex;
    }

    function compareRules(
        left,
        right
    ) {
        const column =
            state.ruleSort.column;

        if (
            state.ruleSort.direction ===
            0
        ) {
            return (
                left.ruleIndex -
                right.ruleIndex
            );
        }

        const leftValue =
            getRuleSortValue(
                left,
                column
            );

        const rightValue =
            getRuleSortValue(
                right,
                column
            );

        const result =
            typeof leftValue ===
                "number" &&
            typeof rightValue ===
                "number"
                ? compareNumbers(
                      leftValue,
                      rightValue
                  )
                : compareStrings(
                      leftValue,
                      rightValue
                  );

        return (
            result *
            state.ruleSort.direction
        );
    }

    function sortGroupRules(
        rules
    ) {
        return rules
            .slice()
            .sort(
                compareRules
            );
    }

    function getVisibleConflicts() {
        return state.conflicts
            .slice()
            .sort(
                (
                    left,
                    right
                ) =>
                    left.discoveryOrder -
                    right.discoveryOrder
            );
    }

    function getClusterDisplayId(
        conflict
    ) {
        const value =
            Number(
                conflict?.clusterId
            );

        return Number.isFinite(
            value
        ) &&
            value > 0
            ? value
            : "";
    }

    function sortDisplayedGroups(
        groups
    ) {
        return sortGroupMatches(
            groups
        );
    }

    function sortGroupsBy(
        column
    ) {
        cycleSortState(
            state.groupSort,
            column
        );

        render();
    }

    function sortRulesBy(
        column
    ) {
        cycleSortState(
            state.ruleSort,
            column
        );

        render();
    }

    function getRuleExpansionKey(
        group,
        rule
    ) {
        return (
            `${group.index}:${rule.ruleIndex}`
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

    function resetDisplaySorting() {
        state.groupSort = {
            column: "original",
            direction: 0
        };

        state.ruleSort = {
            column: "original",
            direction: 0
        };
    }

    function getAnalysisSummary() {
        const clusterIds =
            new Set();

        for (
            const conflict
            of state.conflicts
        ) {
            const clusterId =
                Number(
                    conflict.clusterId
                );

            if (
                Number.isFinite(
                    clusterId
                ) &&
                clusterId > 0
            ) {
                clusterIds.add(
                    clusterId
                );
            }
        }

        return {
            candidates:
                state.candidates.length,
            groups:
                state.groupMatches.length,
            conflicts:
                state.conflicts.length,
            conflictClusters:
                clusterIds.size
        };
    }

    const WNC_UI_ID =
        "wnc-overlay";

    const WNC_STYLE_ID =
        "wnc-dark-style";

    const WNC_TAB_ORDER = [
        "candidates",
        "groups",
        "conflicts"
    ];

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
        let style =
            document.getElementById(
                WNC_STYLE_ID
            );

        if (!style) {
            style =
                document.createElement(
                    "style"
                );

            style.id =
                WNC_STYLE_ID;

            document.head?.appendChild(
                style
            );
        }

        style.textContent =
            getWncStyles();
    }

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

    function getTabLabel(
        tab
    ) {
        if (
            tab ===
            "candidates"
        ) {
            return `Candidates (${state.candidates.length})`;
        }

        if (
            tab ===
            "groups"
        ) {
            return `Groups (${state.groupMatches.length})`;
        }

        return `Conflicts (${state.conflicts.length})`;
    }

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

        return sortState.direction ===
            1
            ? " ▲"
            : " ▼";
    }

    function renderToolbar() {
        return `
<div class="wnc-toolbar">
    <div class="wnc-title">
        Webnovel Cleaner
    </div>
    <div class="wnc-tabs">
        ${WNC_TAB_ORDER.map(
            tab =>
                `<button class="wnc-tab ${
                    state.screen === tab
                        ? "active"
                        : ""
                }" data-wnc-tab="${tab}">${escapeHtml(
                    getTabLabel(
                        tab
                    )
                )}</button>`
        ).join("")}
    </div>
    <div class="wnc-spacer"></div>
    <select id="wnc-template">
        ${INPUT_TEMPLATES.map(
            template =>
                `<option value="${escapeHtml(
                    template
                )}" ${
                    state.candidateTemplate ===
                    template
                        ? "selected"
                        : ""
                }>${escapeHtml(
                    template
                )}</option>`
        ).join("")}
    </select>
    <button data-wnc-close>
        Close
    </button>
</div>
`;
    }

    function getVisibleCandidates() {
        const clustering =
            buildCandidateClusters(
                state.candidates
            );

        return clustering.clusters
            .flatMap(
                cluster =>
                    cluster.members
            );
    }

    function renderCandidatesTab() {
        if (
            !state.candidates.length
        ) {
            return `
<div class="wnc-muted">
    No unmatched candidates found.
</div>
`;
        }

        return `
<table class="wnc-table">
    <thead>
        <tr>
            <th>Name</th>
            <th>Frequency</th>
            <th>Generated Input</th>
            <th></th>
        </tr>
    </thead>
    <tbody>
        ${getVisibleCandidates()
            .map(
                candidate => {
                    const input =
                        getGeneratedInput(
                            candidate
                        );

                    return `
<tr>
    <td>${escapeHtml(
        candidate.name
    )}</td>
    <td>${escapeHtml(
        candidate.frequency
    )}</td>
    <td>
        <div class="wnc-code">
            ${escapeHtml(
                input
            )}
        </div>
    </td>
    <td>
        <button
            data-wnc-copy="${escapeHtml(
                input
            )}"
            ${
                generatedInputLooksValid(
                    input
                )
                    ? ""
                    : "disabled"
            }>
            Copy
        </button>
    </td>
</tr>
`;
                }
            )
            .join("")}
    </tbody>
</table>
`;
    }

    function renderGroupHeader(
        group
    ) {
        const ruleCount =
            group.rules?.length ||
            0;

        const matchCount =
            getGroupRulesWithMatches(
                group
            ).reduce(
                (
                    total,
                    rule
                ) =>
                    total +
                    (
                        rule.candidates
                            ?.length ||
                        0
                    ),
                0
            );

        return `
<div class="wnc-group-header">
    <strong>
        ${escapeHtml(
            group.name ||
                "(Unnamed group)"
        )}
    </strong>
    <span class="wnc-muted">
        Rules: ${ruleCount}
    </span>
    <span class="wnc-muted">
        Matches: ${matchCount}
    </span>
</div>
`;
    }

    function renderGroupRule(
        group,
        rule
    ) {
        const expanded =
            isRuleExpanded(
                group,
                rule
            );

        const candidates =
            rule.candidates ||
            [];

        return `
<div class="wnc-rule">
    <div class="wnc-rule-header">
        <button
            data-wnc-rule-toggle="1"
            data-group-index="${escapeHtml(
                group.index
            )}"
            data-rule-index="${escapeHtml(
                rule.ruleIndex
            )}">
            ${expanded ? "−" : "+"}
        </button>
        <span>
            ${escapeHtml(
                rule.input
            )}
        </span>
        <span class="wnc-muted">
            → ${escapeHtml(
                rule.output
            )}
        </span>
        <span class="wnc-muted">
            (${candidates.length})
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
                      candidate =>
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
        const groups =
            sortDisplayedGroups(
                getVisibleGroupMatches()
            );

        if (!groups.length) {
            return `
<div class="wnc-muted">
    No matched groups found.
</div>
`;
        }

        return `
<div class="wnc-summary">
    <button data-wnc-group-sort="name">
        Group${getSortArrow(
            state.groupSort,
            "name"
        )}
    </button>
    <button data-wnc-group-sort="rules">
        Rules${getSortArrow(
            state.groupSort,
            "rules"
        )}
    </button>
    <button data-wnc-group-sort="matches">
        Matches${getSortArrow(
            state.groupSort,
            "matches"
        )}
    </button>
</div>
${groups
    .map(
        group => `
<div class="wnc-group">
    ${renderGroupHeader(
        group
    )}
    <div class="wnc-group-rules">
        ${sortGroupRules(
            getGroupRulesWithMatches(
                group
            )
        )
            .map(
                rule =>
                    renderGroupRule(
                        group,
                        rule
                    )
            )
            .join("")}
    </div>
</div>
`
    )
    .join("")}
`;
    }

    function renderConflict(
        conflict
    ) {
        return `
<div class="wnc-conflict">
    <div>
        <strong>
            ${escapeHtml(
                conflict.candidateName
            )}
        </strong>
        <span class="wnc-muted">
            (${escapeHtml(
                conflict.frequency
            )})
        </span>
    </div>
    <div>
        <span class="wnc-muted">
            ${escapeHtml(
                conflict.groupName
            )}
        </span>
    </div>
    <div class="wnc-code">
        ${escapeHtml(
            conflict.ruleInput
        )}
        →
        ${escapeHtml(
            conflict.ruleOutput
        )}
    </div>
    <div class="wnc-muted">
        ${escapeHtml(
            conflict.type
        )}
    </div>
</div>
`;
    }

    function getConflictClustersForDisplay() {
        const clusters =
            new Map();

        for (
            const conflict
            of getVisibleConflicts()
        ) {
            const clusterId =
                getClusterDisplayId(
                    conflict
                );

            const key =
                clusterId || 0;

            if (
                !clusters.has(
                    key
                )
            ) {
                clusters.set(
                    key,
                    []
                );
            }

            clusters.get(
                key
            ).push(
                conflict
            );
        }

        return Array.from(
            clusters.entries()
        );
    }

    function renderConflictsTab() {
        const clusters =
            getConflictClustersForDisplay();

        if (!clusters.length) {
            return `
<div class="wnc-muted">
    No conflicts found.
</div>
`;
        }

        return clusters
            .map(
                (
                    [
                        clusterId,
                        conflicts
                    ]
                ) => `
<div class="wnc-conflict-cluster">
    <div class="wnc-cluster-title">
        ${
            clusterId
                ? `Cluster ${escapeHtml(
                      clusterId
                  )}`
                : "Unclustered"
        }
    </div>
    ${conflicts
        .map(
            conflict =>
                renderConflict(
                    conflict
                )
        )
        .join("")}
</div>
`
            )
            .join("");
    }

    function renderActiveTab() {
        if (
            state.screen ===
            "groups"
        ) {
            return renderGroupsTab();
        }

        if (
            state.screen ===
            "conflicts"
        ) {
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

        let overlay =
            document.getElementById(
                WNC_UI_ID
            );

        if (!overlay) {
            overlay =
                document.createElement(
                    "div"
                );

            overlay.id =
                WNC_UI_ID;

            document.body?.appendChild(
                overlay
            );
        }

        if (!overlay) {
            return;
        }

        overlay.innerHTML =
            renderWncWindow();

        bindWncEvents(
            overlay
        );
    }

    function openWnc() {
        runAnalysisSafely();

        resetDisplaySorting();

        state.screen =
            "candidates";

        render();
    }

    function closeWnc() {
        document
            .getElementById(
                WNC_UI_ID
            )
            ?.remove();
    }

    function bindWncEvents(
        overlay
    ) {
        overlay
            .querySelectorAll(
                "[data-wnc-tab]"
            )
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () => {
                            state.screen =
                                button.dataset
                                    .wncTab;

                            render();
                        }
                    )
            );

        overlay
            .querySelector(
                "#wnc-template"
            )
            ?.addEventListener(
                "change",
                event =>
                    setCandidateTemplate(
                        event.target
                            .value
                    )
            );

        overlay
            .querySelector(
                "[data-wnc-close]"
            )
            ?.addEventListener(
                "click",
                closeWnc
            );

        overlay
            .querySelectorAll(
                "[data-wnc-copy]"
            )
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            copyText(
                                button.dataset
                                    .wncCopy
                            )
                    )
            );

        overlay
            .querySelectorAll(
                "[data-wnc-group-sort]"
            )
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () =>
                            sortGroupsBy(
                                button.dataset
                                    .wncGroupSort
                            )
                    )
            );

        overlay
            .querySelectorAll(
                "[data-wnc-rule-toggle]"
            )
            .forEach(
                button =>
                    button.addEventListener(
                        "click",
                        () => {
                            const groupIndex =
                                Number(
                                    button.dataset
                                        .groupIndex
                                );

                            const ruleIndex =
                                Number(
                                    button.dataset
                                        .ruleIndex
                                );

                            const group =
                                state.groupMatches.find(
                                    item =>
                                        item.index ===
                                        groupIndex
                                );

                            const rule =
                                group?.rules?.find(
                                    item =>
                                        item.ruleIndex ===
                                        ruleIndex
                                );

                            if (
                                group &&
                                rule
                            ) {
                                toggleRuleExpanded(
                                    group,
                                    rule
                                );
                            }
                        }
                    )
            );
    }

  async function copyText(
    text
    ) {
    const value =
        String(
            text ?? ""
        );

    try {
        await navigator.clipboard.writeText(
            value
        );

        return true;
    } catch {
        return false;
    }
    }

    function registerWncMenuCommands() {
        GM_registerMenuCommand(
            "Open Webnovel Cleaner",
            openWnc
        );

        GM_registerMenuCommand(
            "Import FoxReplace JSON",
            openImportPicker
        );
    }

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
        }
    }

    function initializeWnc() {
        rawFoxReplaceDatabase =
            loadActiveDatabase();

        adaptedDatabase =
            adaptFoxReplaceDatabase(
                rawFoxReplaceDatabase
            );

        ensureDatabaseShape();

        registerWncMenuCommands();
    }

    function startWnc() {
        initializeWnc();
    }

    startWnc();
})();
