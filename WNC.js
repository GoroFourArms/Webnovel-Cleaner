// ==UserScript==
// @name         WebNovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      5.2.1
// @description  WebNovel Cleaner - FoxReplace-compatible replacement engine, scanner, editor and database
// @author       GoroFourArms
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC.js
// @downloadURL  https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC.js
// ==/UserScript==

(() => {
    "use strict";

    // ============================================================
    // PART 1 - CORE / DATABASE
    // ============================================================

    const WNC_VERSION = "5.2.1";

    const FOXREPLACE_DB_KEY =
        "WNC_FOXREPLACE_DATABASE_V1";

    const LEGACY_DB_KEY =
        "WNC_DATABASE_V5";

    const WNC = {
        version: WNC_VERSION,

        database: {},
        packs: {},
        rules: {},
        replace: {},
        scanner: {},
        editor: {},
        tools: {},
        foxReplace: {},
        cleaner: {},
        inspector: {},
        diagnostics: {},
        ui: {}
    };

    const DEFAULT_DATABASE = {
        groups: []
    };

    const RUNTIME = {
        initialized: false,
        cleanerInitialized: false,
        observer: null,
        observerPaused: false,
        uiCreated: false
    };

    function clone(value) {
        if (value === undefined) {
            return undefined;
        }

        return JSON.parse(
            JSON.stringify(value)
        );
    }

    function isObject(value) {
        return (
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)
        );
    }

    function normalizeFoxReplaceDatabase(db) {
        const source =
            isObject(db)
                ? clone(db)
                : clone(DEFAULT_DATABASE);

        if (!Array.isArray(source.groups)) {
            source.groups = [];
        }

        source.groups = source.groups.map(
            group => {
                const normalized =
                    isObject(group)
                        ? group
                        : {};

                if (
                    typeof normalized.name !==
                    "string"
                ) {
                    normalized.name =
                        "Unnamed Group";
                }

                normalized.name =
                    normalized.name.trim() ||
                    "Unnamed Group";

                if (
                    !Array.isArray(
                        normalized.urls
                    )
                ) {
                    normalized.urls = [];
                }

                normalized.urls =
                    normalized.urls.filter(
                        url =>
                            typeof url ===
                            "string"
                    );

                if (
                    typeof normalized.enabled !==
                    "boolean"
                ) {
                    normalized.enabled =
                        true;
                }

                if (
                    typeof normalized.pageLoad !==
                    "boolean"
                ) {
                    normalized.pageLoad =
                        true;
                }

                if (
                    typeof normalized.auto !==
                    "boolean"
                ) {
                    normalized.auto =
                        true;
                }

                if (
                    !Array.isArray(
                        normalized.substitutions
                    )
                ) {
                    normalized.substitutions =
                        [];
                }

                normalized.substitutions =
                    normalized.substitutions.map(
                        substitution => {
                            const rule =
                                isObject(
                                    substitution
                                )
                                    ? substitution
                                    : {};

                            if (
                                typeof rule.input !==
                                "string"
                            ) {
                                rule.input = "";
                            }

                            if (
                                typeof rule.output !==
                                "string"
                            ) {
                                rule.output = "";
                            }

                            if (
                                ![
                                    "text",
                                    "whole",
                                    "regexp"
                                ].includes(
                                    rule.inputType
                                )
                            ) {
                                rule.inputType =
                                    "text";
                            }

                            if (
                                typeof rule.caseSensitive !==
                                "boolean"
                            ) {
                                rule.caseSensitive =
                                    false;
                            }

                            if (
                                typeof rule.enabled !==
                                "boolean"
                            ) {
                                rule.enabled =
                                    true;
                            }

                            if (
                                ![
                                    "none",
                                    "html",
                                    "all"
                                ].includes(
                                    rule.html
                                )
                            ) {
                                rule.html =
                                    "none";
                            }

                            return rule;
                        }
                    );

                return normalized;
            }
        );

        return source;
    }

    function validateFoxReplaceDatabase(
        value
    ) {
        if (
            !isObject(value) ||
            !Array.isArray(value.groups)
        ) {
            return {
                valid: false,
                error:
                    "Database must contain a groups array."
            };
        }

        const names = new Set();

        for (
            let groupIndex = 0;
            groupIndex <
            value.groups.length;
            groupIndex++
        ) {
            const group =
                value.groups[groupIndex];

            if (!isObject(group)) {
                return {
                    valid: false,
                    error:
                        `Group ${groupIndex + 1} is not an object.`
                };
            }

            if (
                group.name !== undefined &&
                typeof group.name !==
                    "string"
            ) {
                return {
                    valid: false,
                    error:
                        `Group ${groupIndex + 1} has an invalid name.`
                };
            }

            const name =
                typeof group.name === "string"
                    ? group.name.trim()
                    : "";

            if (name) {
                if (names.has(name)) {
                    return {
                        valid: false,
                        error:
                            `Duplicate group name: ${name}`
                    };
                }

                names.add(name);
            }

            if (
                group.urls !== undefined &&
                !Array.isArray(group.urls)
            ) {
                return {
                    valid: false,
                    error:
                        `Group ${groupIndex + 1} has invalid urls.`
                };
            }

            if (
                Array.isArray(group.urls) &&
                group.urls.some(
                    url =>
                        typeof url !==
                        "string"
                )
            ) {
                return {
                    valid: false,
                    error:
                        `Group ${groupIndex + 1} contains an invalid URL pattern.`
                };
            }

            for (
                const field of [
                    "enabled",
                    "pageLoad",
                    "auto"
                ]
            ) {
                if (
                    group[field] !== undefined &&
                    typeof group[field] !==
                        "boolean"
                ) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1} has an invalid ${field} value.`
                    };
                }
            }

            if (
                group.substitutions !==
                    undefined &&
                !Array.isArray(
                    group.substitutions
                )
            ) {
                return {
                    valid: false,
                    error:
                        `Group ${groupIndex + 1} has invalid substitutions.`
                };
            }

            for (
                let ruleIndex = 0;
                ruleIndex <
                (
                    group.substitutions ||
                    []
                ).length;
                ruleIndex++
            ) {
                const rule =
                    group.substitutions[
                        ruleIndex
                    ];

                if (!isObject(rule)) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1}, substitution ${ruleIndex + 1} is invalid.`
                    };
                }

                if (
                    rule.input !== undefined &&
                    typeof rule.input !==
                        "string"
                ) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1}, substitution ${ruleIndex + 1} has invalid input.`
                    };
                }

                if (
                    rule.output !== undefined &&
                    typeof rule.output !==
                        "string"
                ) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1}, substitution ${ruleIndex + 1} has invalid output.`
                    };
                }

                if (
                    rule.inputType !== undefined &&
                    ![
                        "text",
                        "whole",
                        "regexp"
                    ].includes(
                        rule.inputType
                    )
                ) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1}, substitution ${ruleIndex + 1} has invalid inputType.`
                    };
                }

                if (
                    rule.caseSensitive !==
                        undefined &&
                    typeof rule.caseSensitive !==
                        "boolean"
                ) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1}, substitution ${ruleIndex + 1} has invalid caseSensitive value.`
                    };
                }

                if (
                    rule.enabled !== undefined &&
                    typeof rule.enabled !==
                        "boolean"
                ) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1}, substitution ${ruleIndex + 1} has invalid enabled value.`
                    };
                }

                if (
                    rule.html !== undefined &&
                    ![
                        "none",
                        "html",
                        "all"
                    ].includes(rule.html)
                ) {
                    return {
                        valid: false,
                        error:
                            `Group ${groupIndex + 1}, substitution ${ruleIndex + 1} has invalid html value.`
                    };
                }
            }
        }

        return {
            valid: true,
            error: null
        };
    }

    function migrateLegacyDatabase() {
        const currentValue =
            GM_getValue(
                FOXREPLACE_DB_KEY,
                null
            );

        /*
         * If a usable current database exists,
         * never overwrite it with legacy data.
         */
        if (
            currentValue !== null &&
            currentValue !== undefined &&
            currentValue !== ""
        ) {
            try {
                const current =
                    typeof currentValue ===
                    "string"
                        ? JSON.parse(
                              currentValue
                          )
                        : currentValue;

                const validation =
                    validateFoxReplaceDatabase(
                        current
                    );

                if (validation.valid) {
                    return null;
                }
            } catch {
                /*
                 * Invalid current data is allowed
                 * to fall through to legacy
                 * migration.
                 */
            }
        }

        const legacyValue =
            GM_getValue(
                LEGACY_DB_KEY,
                null
            );

        if (
            legacyValue === null ||
            legacyValue === undefined ||
            legacyValue === ""
        ) {
            return null;
        }

        let legacy;

        try {
            legacy =
                typeof legacyValue ===
                "string"
                    ? JSON.parse(
                          legacyValue
                      )
                    : clone(legacyValue);
        } catch (error) {
            console.warn(
                "[WNC] Legacy database parse failed:",
                error
            );

            return null;
        }

        if (
            !isObject(legacy) ||
            !Array.isArray(legacy.packs)
        ) {
            return null;
        }

        const groups =
            legacy.packs
                .slice()
                .sort(
                    (a, b) =>
                        Number(
                            a?.order ?? 0
                        ) -
                        Number(
                            b?.order ?? 0
                        )
                )
                .map(pack => {
                    const oldRules =
                        Array.isArray(
                            pack?.rules
                        )
                            ? pack.rules
                            : [];

                    const substitutions =
                        oldRules
                            .slice()
                            .sort(
                                (a, b) =>
                                    Number(
                                        a?.order ??
                                            0
                                    ) -
                                    Number(
                                        b?.order ??
                                            0
                                    )
                            )
                            .map(rule => {
                                let inputType =
                                    rule?.type;

                                if (
                                    inputType ===
                                    "regex"
                                ) {
                                    inputType =
                                        "regexp";
                                }

                                if (
                                    ![
                                        "text",
                                        "whole",
                                        "regexp"
                                    ].includes(
                                        inputType
                                    )
                                ) {
                                    inputType =
                                        "text";
                                }

                                let html =
                                    rule?.htmlMode;

                                if (
                                    ![
                                        "none",
                                        "html",
                                        "all"
                                    ].includes(html)
                                ) {
                                    html =
                                        "none";
                                }

                                return {
                                    input:
                                        typeof rule?.find ===
                                        "string"
                                            ? rule.find
                                            : "",

                                    output:
                                        typeof rule?.replace ===
                                        "string"
                                            ? rule.replace
                                            : "",

                                    inputType,

                                    caseSensitive:
                                        typeof rule?.caseSensitive ===
                                        "boolean"
                                            ? rule.caseSensitive
                                            : false,

                                    enabled:
                                        typeof rule?.enabled ===
                                        "boolean"
                                            ? rule.enabled
                                            : true,

                                    html
                                };
                            });

                    return {
                        name:
                            typeof pack?.name ===
                            "string"
                                ? pack.name.trim() ||
                                  "Unnamed Group"
                                : "Unnamed Group",

                        urls:
                            Array.isArray(
                                pack?.urls
                            )
                                ? pack.urls.filter(
                                      url =>
                                          typeof url ===
                                          "string"
                                  )
                                : [],

                        enabled:
                            typeof pack?.enabled ===
                            "boolean"
                                ? pack.enabled
                                : true,

                        pageLoad:
                            typeof pack?.pageLoad ===
                            "boolean"
                                ? pack.pageLoad
                                : true,

                        auto:
                            typeof pack?.auto ===
                            "boolean"
                                ? pack.auto
                                : true,

                        substitutions
                    };
                });

        const migrated =
            normalizeFoxReplaceDatabase({
                groups
            });

        const validation =
            validateFoxReplaceDatabase(
                migrated
            );

        if (!validation.valid) {
            console.warn(
                "[WNC] Legacy migration produced invalid data."
            );

            return null;
        }

        GM_setValue(
            FOXREPLACE_DB_KEY,
            JSON.stringify(migrated)
        );

        console.info(
            "[WNC] Legacy database migrated."
        );

        return migrated;
    }

    function loadDatabase() {
        migrateLegacyDatabase();

        const stored =
            GM_getValue(
                FOXREPLACE_DB_KEY,
                null
            );

        if (
            stored === null ||
            stored === undefined ||
            stored === ""
        ) {
            return clone(
                DEFAULT_DATABASE
            );
        }

        try {
            const parsed =
                typeof stored ===
                "string"
                    ? JSON.parse(stored)
                    : clone(stored);

            const validation =
                validateFoxReplaceDatabase(
                    parsed
                );

            if (!validation.valid) {
                console.warn(
                    "[WNC] Stored database is invalid:",
                    validation.error
                );

                return clone(
                    DEFAULT_DATABASE
                );
            }

            return normalizeFoxReplaceDatabase(
                parsed
            );
        } catch (error) {
            console.warn(
                "[WNC] Database load failed:",
                error
            );

            return clone(
                DEFAULT_DATABASE
            );
        }
    }

    function saveDatabase(db) {
        const normalized =
            normalizeFoxReplaceDatabase(
                db
            );

        const validation =
            validateFoxReplaceDatabase(
                normalized
            );

        if (!validation.valid) {
            throw new Error(
                validation.error
            );
        }

        GM_setValue(
            FOXREPLACE_DB_KEY,
            JSON.stringify(normalized)
        );

        WNC.database.current =
            clone(normalized);

        return clone(normalized);
    }

    WNC.database.current =
        loadDatabase();

    function getDatabase() {
        return clone(
            WNC.database.current
        );
    }

    function createPack(name) {
        const db =
            getDatabase();

        const groupName =
            String(name || "").trim();

        if (!groupName) {
            throw new Error(
                "Group name cannot be empty."
            );
        }

        if (
            db.groups.some(
                group =>
                    group.name ===
                    groupName
            )
        ) {
            throw new Error(
                `Group already exists: ${groupName}`
            );
        }

        db.groups.push({
            name: groupName,
            urls: [],
            enabled: true,
            pageLoad: true,
            auto: true,
            substitutions: []
        });

        saveDatabase(db);

        return groupName;
    }

    function getPacks() {
        return getDatabase().groups;
    }

    function getPack(name) {
        return (
            getDatabase().groups.find(
                group =>
                    group.name === name
            ) || null
        );
    }

    function updatePack(
        name,
        data
    ) {
        const db =
            getDatabase();

        const group =
            db.groups.find(
                item =>
                    item.name ===
                    name
            );

        if (!group) {
            return false;
        }

        const source =
            isObject(data)
                ? data
                : {};

        if (
            typeof source.name ===
            "string"
        ) {
            const newName =
                source.name.trim();

            if (!newName) {
                throw new Error(
                    "Group name cannot be empty."
                );
            }

            if (
                newName !==
                    group.name &&
                db.groups.some(
                    item =>
                        item !== group &&
                        item.name ===
                            newName
                )
            ) {
                throw new Error(
                    `Group already exists: ${newName}`
                );
            }

            group.name =
                newName;
        }

        if (
            Array.isArray(source.urls)
        ) {
            group.urls =
                source.urls.filter(
                    url =>
                        typeof url ===
                        "string"
                );
        }

        if (
            typeof source.enabled ===
            "boolean"
        ) {
            group.enabled =
                source.enabled;
        }

        if (
            typeof source.pageLoad ===
            "boolean"
        ) {
            group.pageLoad =
                source.pageLoad;
        }

        if (
            typeof source.auto ===
            "boolean"
        ) {
            group.auto =
                source.auto;
        }

        saveDatabase(db);

        return true;
    }

    function removePack(name) {
        const db =
            getDatabase();

        const originalLength =
            db.groups.length;

        db.groups =
            db.groups.filter(
                group =>
                    group.name !== name
            );

        if (
            db.groups.length ===
            originalLength
        ) {
            return false;
        }

        saveDatabase(db);

        return true;
    }

    function addRule(
        packName,
        rule
    ) {
        const db =
            getDatabase();

        const group =
            db.groups.find(
                item =>
                    item.name ===
                    packName
            );

        if (!group) {
            return false;
        }

        const source =
            isObject(rule)
                ? rule
                : {};

        const inputType =
            [
                "text",
                "whole",
                "regexp"
            ].includes(
                source.inputType
            )
                ? source.inputType
                : "text";

        const html =
            [
                "none",
                "html",
                "all"
            ].includes(
                source.html
            )
                ? source.html
                : "none";

        group.substitutions.push({
            input:
                typeof source.input ===
                "string"
                    ? source.input
                    : "",

            output:
                typeof source.output ===
                "string"
                    ? source.output
                    : "",

            inputType,

            caseSensitive:
                typeof source.caseSensitive ===
                "boolean"
                    ? source.caseSensitive
                    : false,

            enabled:
                typeof source.enabled ===
                "boolean"
                    ? source.enabled
                    : true,

            html
        });

        saveDatabase(db);

        return true;
    }

    function updateRule(
        packName,
        ruleIndex,
        data
    ) {
        const db =
            getDatabase();

        const group =
            db.groups.find(
                item =>
                    item.name ===
                    packName
            );

        if (!group) {
            return false;
        }

        const index =
            Number(ruleIndex);

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >=
                group.substitutions.length
        ) {
            return false;
        }

        const rule =
            group.substitutions[index];

        const source =
            isObject(data)
                ? data
                : {};

        if (
            typeof source.input ===
            "string"
        ) {
            rule.input =
                source.input;
        }

        if (
            typeof source.output ===
            "string"
        ) {
            rule.output =
                source.output;
        }

        if (
            [
                "text",
                "whole",
                "regexp"
            ].includes(
                source.inputType
            )
        ) {
            rule.inputType =
                source.inputType;
        }

        if (
            typeof source.caseSensitive ===
            "boolean"
        ) {
            rule.caseSensitive =
                source.caseSensitive;
        }

        if (
            typeof source.enabled ===
            "boolean"
        ) {
            rule.enabled =
                source.enabled;
        }

        if (
            [
                "none",
                "html",
                "all"
            ].includes(source.html)
        ) {
            rule.html =
                source.html;
        }

        saveDatabase(db);

        return true;
    }

    function removeRule(
        packName,
        ruleIndex
    ) {
        const db =
            getDatabase();

        const group =
            db.groups.find(
                item =>
                    item.name ===
                    packName
            );

        if (!group) {
            return false;
        }

        const index =
            Number(ruleIndex);

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >=
                group.substitutions.length
        ) {
            return false;
        }

        group.substitutions.splice(
            index,
            1
        );

        saveDatabase(db);

        return true;
    }

    function setPackOrder(
        packName,
        requestedOrder
    ) {
        const db =
            getDatabase();

        const currentIndex =
            db.groups.findIndex(
                group =>
                    group.name ===
                    packName
            );

        if (currentIndex < 0) {
            return false;
        }

        let targetIndex =
            Number(requestedOrder);

        if (
            !Number.isInteger(
                targetIndex
            )
        ) {
            return false;
        }

        targetIndex =
            Math.max(
                0,
                Math.min(
                    targetIndex,
                    db.groups.length - 1
                )
            );

        const [group] =
            db.groups.splice(
                currentIndex,
                1
            );

        db.groups.splice(
            targetIndex,
            0,
            group
        );

        saveDatabase(db);

        return true;
    }

    function setRuleOrder(
        packName,
        oldOrder,
        requestedOrder
    ) {
        const db =
            getDatabase();

        const group =
            db.groups.find(
                item =>
                    item.name ===
                    packName
            );

        if (!group) {
            return false;
        }

        const currentIndex =
            Number(oldOrder);

        let targetIndex =
            Number(requestedOrder);

        if (
            !Number.isInteger(
                currentIndex
            ) ||
            !Number.isInteger(
                targetIndex
            )
        ) {
            return false;
        }

        if (
            currentIndex < 0 ||
            currentIndex >=
                group.substitutions.length
        ) {
            return false;
        }

        targetIndex =
            Math.max(
                0,
                Math.min(
                    targetIndex,
                    group.substitutions.length - 1
                )
            );

        const [rule] =
            group.substitutions.splice(
                currentIndex,
                1
            );

        group.substitutions.splice(
            targetIndex,
            0,
            rule
        );

        saveDatabase(db);

        return true;
    }

    function matchSite(
        pattern,
        url
    ) {
        if (
            typeof pattern !==
                "string" ||
            !pattern.trim()
        ) {
            return false;
        }

        const source =
            pattern.trim();

        const target =
            String(url || "");

        if (
            source === "*" ||
            source === target
        ) {
            return true;
        }

        const escaped =
            source
                .replace(
                    /[.+?^${}()|[\]\\]/g,
                    "\\$&"
                )
                .replace(
                    /\*/g,
                    ".*"
                );

        try {
            return new RegExp(
                `^${escaped}$`,
                "i"
            ).test(target);
        } catch {
            return target
                .toLowerCase()
                .includes(
                    source.toLowerCase()
                );
        }
    }

    function getMatchedPacks(
        url = location.href
    ) {
        return getDatabase().groups.filter(
            group => {
                if (
                    group.enabled ===
                    false
                ) {
                    return false;
                }

                if (
                    !group.urls ||
                    group.urls.length ===
                        0
                ) {
                    return true;
                }

                return group.urls.some(
                    pattern =>
                        matchSite(
                            pattern,
                            url
                        )
                );
            }
        );
    }

    WNC.database.get =
        getDatabase;

    WNC.database.save =
        saveDatabase;

    WNC.database.normalize =
        normalizeFoxReplaceDatabase;

    WNC.database.validate =
        validateFoxReplaceDatabase;

    WNC.packs.get =
        getPacks;

    WNC.packs.getOne =
        getPack;

    WNC.packs.create =
        createPack;

    WNC.packs.update =
        updatePack;

    WNC.packs.remove =
        removePack;

    WNC.packs.setOrder =
        setPackOrder;

    WNC.rules.add =
        addRule;

    WNC.rules.update =
        updateRule;

    WNC.rules.remove =
        removeRule;

    WNC.rules.setOrder =
        setRuleOrder;

    WNC.rules.getMatched =
        getMatchedPacks;

    // ============================================================
    // PART 2 - REPLACEMENT ENGINE
    // ============================================================

    function escapeRegExp(value) {
        return String(value).replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
    }

    function buildRuleRegex(
        rule
    ) {
        if (
            !rule ||
            typeof rule.input !==
                "string" ||
            !rule.input
        ) {
            return null;
        }

        let source;

        switch (
            rule.inputType
        ) {
            case "regexp":
                source =
                    rule.input;
                break;

            case "whole":
                source =
                    `\\b${escapeRegExp(
                        rule.input
                    )}\\b`;
                break;

            case "text":
            default:
                source =
                    escapeRegExp(
                        rule.input
                    );
                break;
        }

        let flags = "g";

        if (
            rule.caseSensitive !==
            true
        ) {
            flags += "i";
        }

        try {
            return new RegExp(
                source,
                flags
            );
        } catch (error) {
            console.warn(
                "[WNC] Invalid rule regex:",
                rule.input,
                error
            );

            return null;
        }
    }

    function applySubstitution(
        text,
        rule
    ) {
        if (
            typeof text !==
                "string" ||
            !rule ||
            rule.enabled === false
        ) {
            return {
                text,
                replacements: 0
            };
        }

        const regex =
            buildRuleRegex(rule);

        if (!regex) {
            return {
                text,
                replacements: 0
            };
        }

        let replacements = 0;

        const result =
            text.replace(
                regex,
                (...args) => {
                    replacements++;

                    /*
                     * Preserve native JavaScript
                     * replacement semantics for
                     * regexp substitutions.
                     */
                    return String(
                        rule.output ?? ""
                    ).replace(
                        /\$(\$|&|`|'|\d{1,2})/g,
                        token => {
                            const key =
                                token.slice(
                                    1
                                );

                            if (
                                key === "$"
                            ) {
                                return "$";
                            }

                            if (
                                key === "&"
                            ) {
                                return args[0];
                            }

                            if (
                                key === "`"
                            ) {
                                return args[
                                    args.length -
                                        2
                                ];
                            }

                            if (
                                key === "'"
                            ) {
                                return args[
                                    args.length -
                                        1
                                ];
                            }

                            const index =
                                Number(
                                    key
                                );

                            return Number.isInteger(
                                index
                            ) &&
                            index > 0 &&
                            index <
                                args.length - 2
                                ? args[
                                      index
                                  ] ??
                                      ""
                                : token;
                        }
                    );
                }
            );

        return {
            text: result,
            replacements
        };
    }

    function applyGroup(
        text,
        group
    ) {
        if (
            !group ||
            group.enabled === false
        ) {
            return {
                text,
                replacements: 0
            };
        }

        let result = text;
        let replacements = 0;

        for (
            const rule of
            group.substitutions || []
        ) {
            const applied =
                applySubstitution(
                    result,
                    rule
                );

            result =
                applied.text;

            replacements +=
                applied.replacements;
        }

        return {
            text: result,
            replacements
        };
    }

    function applyDatabase(
        text,
        database
    ) {
        const db =
            normalizeFoxReplaceDatabase(
                database
            );

        let result = text;
        let replacements = 0;

        for (
            const group of db.groups
        ) {
            const applied =
                applyGroup(
                    result,
                    group
                );

            result =
                applied.text;

            replacements +=
                applied.replacements;
        }

        return {
            text: result,
            replacements
        };
    }

    function applyMatchedPacks(
        text,
        url = location.href
    ) {
        const groups =
            getMatchedPacks(url);

        let result = text;
        let replacements = 0;

        for (
            const group of groups
        ) {
            const applied =
                applyGroup(
                    result,
                    group
                );

            result =
                applied.text;

            replacements +=
                applied.replacements;
        }

        return {
            text: result,
            replacements
        };
    }

    function shouldProcessTextNode(
        node
    ) {
        if (
            !node ||
            node.nodeType !==
                Node.TEXT_NODE
        ) {
            return false;
        }

        const parent =
            node.parentElement;

        if (!parent) {
            return false;
        }

        const tag =
            parent.tagName;

        if (
            [
                "SCRIPT",
                "STYLE",
                "NOSCRIPT",
                "TEXTAREA",
                "INPUT",
                "SELECT",
                "OPTION"
            ].includes(tag)
        ) {
            return false;
        }

        return true;
    }

    function applyRuleToTextNode(
        node,
        rule
    ) {
        if (
            !shouldProcessTextNode(
                node
            )
        ) {
            return 0;
        }

        const applied =
            applySubstitution(
                node.nodeValue,
                rule
            );

        if (
            applied.replacements > 0 &&
            applied.text !==
                node.nodeValue
        ) {
            node.nodeValue =
                applied.text;
        }

        return applied.replacements;
    }

    function applySubstitutionToDocument(
        root,
        rule
    ) {
        if (
            !root ||
            !rule ||
            rule.enabled === false
        ) {
            return 0;
        }

        /*
         * HTML mode is deliberately handled
         * separately. Normal text rules never
         * rewrite innerHTML.
         */
        if (
            rule.html === "html" ||
            rule.html === "all"
        ) {
            return applyHtmlSubstitution(
                root,
                rule
            );
        }

        let replacements = 0;

        if (
            root.nodeType ===
            Node.TEXT_NODE
        ) {
            return applyRuleToTextNode(
                root,
                rule
            );
        }

        const walker =
            document.createTreeWalker(
                root,
                NodeFilter.SHOW_TEXT,
                {
                    acceptNode(node) {
                        return shouldProcessTextNode(
                            node
                        )
                            ? NodeFilter.FILTER_ACCEPT
                            : NodeFilter.FILTER_REJECT;
                    }
                }
            );

        const nodes = [];

        let node;

        while (
            (node =
                walker.nextNode())
        ) {
            nodes.push(node);
        }

        for (
            const textNode of nodes
        ) {
            replacements +=
                applyRuleToTextNode(
                    textNode,
                    rule
                );
        }

        return replacements;
    }

    function applyHtmlSubstitution(
        root,
        rule
    ) {
        if (
            !root ||
            !rule ||
            rule.enabled === false
        ) {
            return 0;
        }

        const elements = [];

        if (
            root.nodeType ===
            Node.ELEMENT_NODE
        ) {
            elements.push(root);
        }

        if (
            root.querySelectorAll
        ) {
            elements.push(
                ...root.querySelectorAll(
                    "*"
                )
            );
        }

        let replacements = 0;

        for (
            const element of elements
        ) {
            if (
                [
                    "SCRIPT",
                    "STYLE",
                    "NOSCRIPT",
                    "TEXTAREA",
                    "INPUT",
                    "SELECT",
                    "OPTION"
                ].includes(
                    element.tagName
                )
            ) {
                continue;
            }

            if (
                rule.html === "html"
            ) {
                const applied =
                    applySubstitution(
                        element.innerHTML,
                        rule
                    );

                if (
                    applied.replacements >
                    0
                ) {
                    element.innerHTML =
                        applied.text;

                    replacements +=
                        applied.replacements;
                }
            } else if (
                rule.html === "all"
            ) {
                const applied =
                    applySubstitution(
                        element.outerHTML,
                        rule
                    );

                if (
                    applied.replacements >
                    0
                ) {
                    /*
                     * Avoid replacing document
                     * root itself.
                     */
                    if (
                        element.parentNode
                    ) {
                        const template =
                            document.createElement(
                                "template"
                            );

                        template.innerHTML =
                            applied.text;

                        const replacement =
                            template.content
                                .firstElementChild;

                        if (
                            replacement
                        ) {
                            element.replaceWith(
                                replacement
                            );

                            replacements +=
                                applied.replacements;
                        }
                    }
                }
            }
        }

        return replacements;
    }

    function applyGroupToDocument(
        root,
        group
    ) {
        if (
            !root ||
            !group ||
            group.enabled === false
        ) {
            return 0;
        }

        let replacements = 0;

        for (
            const rule of
            group.substitutions || []
        ) {
            replacements +=
                applySubstitutionToDocument(
                    root,
                    rule
                );
        }

        return replacements;
    }

    function applyMatchedGroupsToDocument(
        root,
        url = location.href
    ) {
        const groups =
            getMatchedPacks(url);

        let replacements = 0;

        for (
            const group of groups
        ) {
            replacements +=
                applyGroupToDocument(
                    root,
                    group
                );
        }

        return replacements;
    }

    WNC.replace.escapeRegExp =
        escapeRegExp;

    WNC.replace.buildRegex =
        buildRuleRegex;

    WNC.replace.applyRule =
        applySubstitution;

    WNC.replace.applyGroup =
        applyGroup;

    WNC.replace.applyDatabase =
        applyDatabase;

    WNC.replace.applyMatched =
        applyMatchedPacks;

    WNC.replace.applyToDocument =
        applySubstitutionToDocument;

    WNC.replace.applyGroupToDocument =
        applyGroupToDocument;

    WNC.replace.applyMatchedToDocument =
        applyMatchedGroupsToDocument;

    // ============================================================
    // PART 3 - SCANNER
    // ============================================================

    const scannerState = {
        running: false,
        scanned: 0,
        matches: 0,
        lastRun: null
    };

    function scanSubstitution(
        text,
        rule
    ) {
        if (
            typeof text !==
                "string" ||
            !rule ||
            rule.enabled === false
        ) {
            return 0;
        }

        const regex =
            buildRuleRegex(rule);

        if (!regex) {
            return 0;
        }

        let count = 0;

        text.replace(
            regex,
            () => {
                count++;
                return "";
            }
        );

        return count;
    }

    function scanGroup(
        text,
        group
    ) {
        if (
            !group ||
            group.enabled === false
        ) {
            return 0;
        }

        let matches = 0;

        for (
            const rule of
            group.substitutions || []
        ) {
            matches +=
                scanSubstitution(
                    text,
                    rule
                );
        }

        return matches;
    }

    function scanPage(
        root = document.body,
        url = location.href
    ) {
        if (
            scannerState.running
        ) {
            return {
                scanned: 0,
                matches: 0,
                busy: true
            };
        }

        scannerState.running =
            true;

        scannerState.scanned++;

        scannerState.lastRun =
            new Date().toISOString();

        try {
            if (!root) {
                return {
                    scanned: 0,
                    matches: 0,
                    busy: false
                };
            }

            const groups =
                getMatchedPacks(url);

            const text =
                root.innerText ??
                root.textContent ??
                "";

            let matches = 0;

            for (
                const group of groups
            ) {
                matches +=
                    scanGroup(
                        text,
                        group
                    );
            }

            scannerState.matches =
                matches;

            return {
                scanned: 1,
                matches,
                busy: false
            };
        } finally {
            scannerState.running =
                false;
        }
    }

    function findMatches(
        text,
        rule
    ) {
        const regex =
            buildRuleRegex(rule);

        if (!regex) {
            return [];
        }

        return [
            ...String(text).matchAll(
                regex
            )
        ];
    }

    function findPageMatches(
        root = document.body,
        url = location.href
    ) {
        if (!root) {
            return [];
        }

        const groups =
            getMatchedPacks(url);

        const text =
            root.innerText ??
            root.textContent ??
            "";

        const results = [];

        for (
            const group of groups
        ) {
            for (
                const rule of
                group.substitutions || []
            ) {
                const matches =
                    findMatches(
                        text,
                        rule
                    );

                if (
                    matches.length
                ) {
                    results.push({
                        group:
                            group.name,
                        rule: clone(rule),
                        matches
                    });
                }
            }
        }

        return results;
    }

    function getScannerStatus() {
        return {
            ...scannerState
        };
    }

    WNC.scanner.scan =
        scanPage;

    WNC.scanner.find =
        findMatches;

    WNC.scanner.findPage =
        findPageMatches;

    WNC.scanner.status =
        getScannerStatus;

    // ============================================================
    // PART 4 - EDITOR
    // ============================================================

    const editorState = {
        selectedGroup: null,
        selectedRule: null
    };

    function renamePack(
        oldName,
        newName
    ) {
        return updatePack(
            oldName,
            {
                name: newName
            }
        );
    }

    function setPackUrls(
        packName,
        urls
    ) {
        return updatePack(
            packName,
            {
                urls
            }
        );
    }

    function setPackEnabled(
        packName,
        enabled
    ) {
        return updatePack(
            packName,
            {
                enabled:
                    Boolean(enabled)
            }
        );
    }

    function setPackPageLoad(
        packName,
        pageLoad
    ) {
        return updatePack(
            packName,
            {
                pageLoad:
                    Boolean(pageLoad)
            }
        );
    }

    function setPackAuto(
        packName,
        auto
    ) {
        return updatePack(
            packName,
            {
                auto:
                    Boolean(auto)
            }
        );
    }

    function setRuleField(
        packName,
        ruleIndex,
        field,
        value
    ) {
        const allowed =
            new Set([
                "input",
                "output",
                "inputType",
                "caseSensitive",
                "enabled",
                "html"
            ]);

        if (
            !allowed.has(field)
        ) {
            return false;
        }

        return updateRule(
            packName,
            ruleIndex,
            {
                [field]: value
            }
        );
    }

    function getEditablePack(
        packName
    ) {
        return getPack(
            packName
        );
    }

    function getEditableRule(
        packName,
        ruleIndex
    ) {
        const group =
            getPack(packName);

        if (!group) {
            return null;
        }

        const index =
            Number(ruleIndex);

        if (
            !Number.isInteger(index)
        ) {
            return null;
        }

        return (
            group.substitutions?.[
                index
            ] || null
        );
    }

    function selectGroup(
        name
    ) {
        editorState.selectedGroup =
            name;

        editorState.selectedRule =
            null;

        return getEditablePack(
            name
        );
    }

    function selectRule(
        packName,
        ruleIndex
    ) {
        editorState.selectedGroup =
            packName;

        editorState.selectedRule =
            Number(ruleIndex);

        return getEditableRule(
            packName,
            ruleIndex
        );
    }

    WNC.editor.renamePack =
        renamePack;

    WNC.editor.setPackUrls =
        setPackUrls;

    WNC.editor.setPackEnabled =
        setPackEnabled;

    WNC.editor.setPackPageLoad =
        setPackPageLoad;

    WNC.editor.setPackAuto =
        setPackAuto;

    WNC.editor.setRuleField =
        setRuleField;

    WNC.editor.getPack =
        getEditablePack;

    WNC.editor.getRule =
        getEditableRule;

    WNC.editor.selectGroup =
        selectGroup;

    WNC.editor.selectRule =
        selectRule;

    WNC.editor.state =
        () => ({
            ...editorState
        });

    // ============================================================
    // PART 5 - FOXREPLACE IMPORT / EXPORT
    // ============================================================

    function isFoxReplaceDatabase(
        value
    ) {
        return validateFoxReplaceDatabase(
            value
        ).valid;
    }

    function importFoxReplaceDatabase(
        json
    ) {
        let parsed;

        try {
            parsed =
                typeof json ===
                "string"
                    ? JSON.parse(json)
                    : clone(json);
        } catch (error) {
            return {
                success: false,
                error:
                    "Invalid JSON: " +
                    error.message
            };
        }

        const validation =
            validateFoxReplaceDatabase(
                parsed
            );

        if (!validation.valid) {
            return {
                success: false,
                error:
                    validation.error
            };
        }

        const normalized =
            normalizeFoxReplaceDatabase(
                parsed
            );

        saveDatabase(
            normalized
        );

        return {
            success: true,
            database:
                clone(normalized)
        };
    }

    function exportFoxReplaceDatabase() {
        return JSON.stringify(
            getDatabase(),
            null,
            2
        );
    }

    function copyDatabaseToClipboard() {
        const json =
            exportFoxReplaceDatabase();

        GM_setClipboard(
            json,
            "text"
        );

        return json;
    }

    function downloadDatabase(
        filename =
            "foxreplace.json"
    ) {
        const json =
            exportFoxReplaceDatabase();

        const blob =
            new Blob(
                [json],
                {
                    type:
                        "application/json"
                }
            );

        const url =
            URL.createObjectURL(
                blob
            );

        const link =
            document.createElement(
                "a"
            );

        link.href = url;
        link.download =
            filename;

        document.body.appendChild(
            link
        );

        link.click();

        link.remove();

        setTimeout(
            () =>
                URL.revokeObjectURL(
                    url
                ),
            1000
        );

        return true;
    }

    function clearDatabase() {
        saveDatabase(
            clone(
                DEFAULT_DATABASE
            )
        );

        return true;
    }

    function getDatabaseStats() {
        const db =
            getDatabase();

        let rules = 0;

        for (
            const group of db.groups
        ) {
            rules +=
                group.substitutions.length;
        }

        return {
            groups:
                db.groups.length,

            rules,

            jsonLength:
                JSON.stringify(db)
                    .length
        };
    }

    WNC.tools.isFoxReplaceDatabase =
        isFoxReplaceDatabase;

    WNC.tools.import =
        importFoxReplaceDatabase;

    WNC.tools.export =
        exportFoxReplaceDatabase;

    WNC.tools.copy =
        copyDatabaseToClipboard;

    WNC.tools.download =
        downloadDatabase;

    WNC.tools.clear =
        clearDatabase;

    WNC.tools.stats =
        getDatabaseStats;

    WNC.foxReplace.import =
        importFoxReplaceDatabase;

    WNC.foxReplace.export =
        exportFoxReplaceDatabase;

    WNC.foxReplace.validate =
        isFoxReplaceDatabase;

    // ============================================================
    // PART 6 - CLEANER
    // ============================================================

    const cleanerState = {
        running: false,
        lastRun: null,
        replacements: 0
    };

    function shouldCleanGroup(
        group
    ) {
        return Boolean(
            group &&
            group.enabled !== false &&
            group.pageLoad !== false &&
            group.auto !== false
        );
    }

    function getPageLoadGroups(
        url = location.href
    ) {
        return getMatchedPacks(
            url
        ).filter(
            shouldCleanGroup
        );
    }

    function cleanGroup(
        text,
        group
    ) {
        return applyGroup(
            text,
            group
        );
    }

    function cleanPage(
        text,
        url = location.href
    ) {
        const groups =
            getPageLoadGroups(
                url
            );

        let result = text;
        let replacements = 0;

        for (
            const group of groups
        ) {
            const applied =
                applyGroup(
                    result,
                    group
                );

            result =
                applied.text;

            replacements +=
                applied.replacements;
        }

        return {
            text: result,
            replacements
        };
    }

    function cleanText(
        text,
        url = location.href
    ) {
        return cleanPage(
            text,
            url
        );
    }

    function cleanHtml(
        html,
        url = location.href
    ) {
        return cleanPage(
            html,
            url
        );
    }

    function cleanElement(
        element,
        url = location.href
    ) {
        if (
            !element ||
            !element.isConnected
        ) {
            return 0;
        }

        const groups =
            getPageLoadGroups(
                url
            );

        let replacements = 0;

        for (
            const group of groups
        ) {
            replacements +=
                applyGroupToDocument(
                    element,
                    group
                );
        }

        return replacements;
    }

    function cleanPageLoad(
        root = document.body,
        url = location.href
    ) {
        if (!root) {
            return 0;
        }

        if (
            cleanerState.running
        ) {
            return 0;
        }

        cleanerState.running =
            true;

        try {
            const groups =
                getPageLoadGroups(
                    url
                );

            let replacements = 0;

            for (
                const group of groups
            ) {
                replacements +=
                    applyGroupToDocument(
                        root,
                        group
                    );
            }

            cleanerState.replacements =
                replacements;

            cleanerState.lastRun =
                new Date().toISOString();

            return replacements;
        } finally {
            cleanerState.running =
                false;
        }
    }

    function startCleanerObserver() {
        if (
            RUNTIME.observer
        ) {
            return false;
        }

        if (
            typeof MutationObserver ===
            "undefined"
        ) {
            return false;
        }

        const target =
            document.body ||
            document.documentElement;

        if (!target) {
            return false;
        }

        RUNTIME.observer =
            new MutationObserver(
                mutations => {
                    if (
                        RUNTIME.observerPaused
                    ) {
                        return;
                    }

                    const groups =
                        getPageLoadGroups(
                            location.href
                        );

                    if (
                        groups.length ===
                        0
                    ) {
                        return;
                    }

                    const elements =
                        new Set();

                    for (
                        const mutation of
                        mutations
                    ) {
                        for (
                            const node of
                            mutation.addedNodes
                        ) {
                            if (
                                node.nodeType ===
                                Node.ELEMENT_NODE
                            ) {
                                elements.add(
                                    node
                                );
                            } else if (
                                node.nodeType ===
                                Node.TEXT_NODE &&
                                node.parentElement
                            ) {
                                elements.add(
                                    node.parentElement
                                );
                            }
                        }
                    }

                    if (
                        elements.size ===
                        0
                    ) {
                        return;
                    }

                    RUNTIME.observerPaused =
                        true;

                    try {
                        for (
                            const element of
                            elements
                        ) {
                            if (
                                !element.isConnected
                            ) {
                                continue;
                            }

                            for (
                                const group of
                                groups
                            ) {
                                applyGroupToDocument(
                                    element,
                                    group
                                );
                            }
                        }
                    } finally {
                        RUNTIME.observerPaused =
                            false;
                    }
                }
            );

        RUNTIME.observer.observe(
            target,
            {
                childList: true,
                subtree: true
            }
        );

        return true;
    }

    function stopCleanerObserver() {
        if (
            !RUNTIME.observer
        ) {
            return false;
        }

        RUNTIME.observer.disconnect();

        RUNTIME.observer =
            null;

        return true;
    }

    function initializeCleaner() {
        if (
            RUNTIME.cleanerInitialized
        ) {
            return;
        }

        RUNTIME.cleanerInitialized =
            true;

        const run = () => {
            cleanPageLoad(
                document.body ||
                    document.documentElement,
                location.href
            );

            startCleanerObserver();
        };

        if (
            document.readyState ===
            "loading"
        ) {
            document.addEventListener(
                "DOMContentLoaded",
                run,
                {
                    once: true
                }
            );
        } else {
            run();
        }
    }

    function getCleanerStatus() {
        return {
            ...cleanerState,

            observer:
                Boolean(
                    RUNTIME.observer
                )
        };
    }

    WNC.cleaner.cleanGroup =
        cleanGroup;

    WNC.cleaner.cleanPage =
        cleanPage;

    WNC.cleaner.cleanText =
        cleanText;

    WNC.cleaner.cleanHtml =
        cleanHtml;

    WNC.cleaner.cleanElement =
        cleanElement;

    WNC.cleaner.cleanPageLoad =
        cleanPageLoad;

    WNC.cleaner.shouldCleanGroup =
        shouldCleanGroup;

    WNC.cleaner.getPageLoadGroups =
        getPageLoadGroups;

    WNC.cleaner.start =
        startCleanerObserver;

    WNC.cleaner.stop =
        stopCleanerObserver;

    WNC.cleaner.initialize =
        initializeCleaner;

    WNC.cleaner.status =
        getCleanerStatus;

    // ============================================================
    // PART 7 - UI / DIAGNOSTICS / INITIALIZATION
    // ============================================================

    function getDiagnostics() {
        return {
            version:
                WNC_VERSION,

            databaseKey:
                FOXREPLACE_DB_KEY,

            stats:
                getDatabaseStats(),

            scanner:
                {
                    ...scannerState
                },

            cleaner:
                getCleanerStatus(),

            editor:
                {
                    ...editorState
                },

            initialized:
                RUNTIME.initialized
        };
    }

    function showDatabaseJson() {
        const json =
            exportFoxReplaceDatabase();

        console.log(
            "[WNC] FoxReplace database:",
            json
        );

        return json;
    }

    function copyDatabaseJson() {
        return copyDatabaseToClipboard();
    }

    function openImportDialog() {
        const input =
            document.createElement(
                "input"
            );

        input.type =
            "file";

        input.accept =
            "application/json,.json";

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
                        await file.text();

                    const result =
                        importFoxReplaceDatabase(
                            text
                        );

                    if (
                        !result.success
                    ) {
                        alert(
                            "WNC import failed:\n\n" +
                            result.error
                        );

                        return;
                    }

                    alert(
                        "WNC database imported successfully."
                    );

                    location.reload();
                } catch (error) {
                    alert(
                        "WNC import failed:\n\n" +
                        error.message
                    );
                }
            },
            {
                once: true
            }
        );

        input.click();
    }

    function openExportDialog() {
        downloadDatabase(
            "foxreplace.json"
        );
    }

    function createUi() {
        if (
            RUNTIME.uiCreated ||
            document.getElementById(
                "wnc-panel"
            )
        ) {
            return;
        }

        if (!document.body) {
            return;
        }

        RUNTIME.uiCreated =
            true;

        const panel =
            document.createElement(
                "div"
            );

        panel.id =
            "wnc-panel";

        panel.innerHTML = `
            <div class="wnc-title">
                WebNovel Cleaner
            </div>

            <div class="wnc-buttons">
                <button data-action="import">
                    Import
                </button>

                <button data-action="export">
                    Export
                </button>

                <button data-action="copy">
                    Copy JSON
                </button>

                <button data-action="scan">
                    Scan
                </button>

                <button data-action="clean">
                    Clean
                </button>
            </div>

            <div class="wnc-status">
                Ready
            </div>
        `;

        document.body.appendChild(
            panel
        );

        const status =
            panel.querySelector(
                ".wnc-status"
            );

        panel.addEventListener(
            "click",
            event => {
                const button =
                    event.target.closest(
                        "button"
                    );

                if (!button) {
                    return;
                }

                try {
                    switch (
                        button.dataset.action
                    ) {
                        case "import":
                            openImportDialog();
                            break;

                        case "export":
                            openExportDialog();
                            break;

                        case "copy":
                            copyDatabaseJson();

                            status.textContent =
                                "JSON copied";
                            break;

                        case "scan": {
                            const result =
                                scanPage();

                            status.textContent =
                                `Matches: ${result.matches}`;
                            break;
                        }

                        case "clean": {
                            const count =
                                cleanPageLoad();

                            status.textContent =
                                `Replacements: ${count}`;
                            break;
                        }
                    }
                } catch (error) {
                    console.error(
                        "[WNC] UI error:",
                        error
                    );

                    status.textContent =
                        "Error - see console";
                }
            }
        );
    }

    function installStyles() {
        if (
            document.getElementById(
                "wnc-styles"
            )
        ) {
            return;
        }

        GM_addStyle(`
            #wnc-panel {
                position: fixed;
                right: 12px;
                bottom: 12px;
                z-index: 2147483647;
                padding: 10px;
                background: rgba(20,20,20,.95);
                color: #fff;
                border: 1px solid #666;
                border-radius: 8px;
                font: 13px/1.4 sans-serif;
                box-shadow: 0 4px 18px rgba(0,0,0,.35);
            }

            #wnc-panel .wnc-title {
                font-weight: 700;
                margin-bottom: 8px;
            }

            #wnc-panel .wnc-buttons {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
            }

            #wnc-panel button {
                cursor: pointer;
                padding: 4px 8px;
                border: 1px solid #888;
                border-radius: 4px;
                background: #333;
                color: #fff;
            }

            #wnc-panel button:hover {
                background: #444;
            }

            #wnc-panel .wnc-status {
                margin-top: 7px;
                opacity: .8;
            }
        `);
    }

    function registerMenuCommands() {
        GM_registerMenuCommand(
            "WNC: Import FoxReplace JSON",
            openImportDialog
        );

        GM_registerMenuCommand(
            "WNC: Export FoxReplace JSON",
            openExportDialog
        );

        GM_registerMenuCommand(
            "WNC: Copy Database JSON",
            copyDatabaseJson
        );

        GM_registerMenuCommand(
            "WNC: Scan Page",
            () => {
                const result =
                    scanPage();

                console.info(
                    "[WNC] Scan:",
                    result
                );

                alert(
                    `WNC scan complete.\nMatches: ${result.matches}`
                );
            }
        );

        GM_registerMenuCommand(
            "WNC: Clean Page",
            () => {
                const count =
                    cleanPageLoad();

                console.info(
                    "[WNC] Clean:",
                    count
                );

                alert(
                    `WNC clean complete.\nReplacements: ${count}`
                );
            }
        );

        GM_registerMenuCommand(
            "WNC: Show Diagnostics",
            () => {
                console.log(
                    "[WNC] Diagnostics:",
                    getDiagnostics()
                );
            }
        );
    }

    function initializeWNC() {
        if (
            RUNTIME.initialized
        ) {
            return;
        }

        RUNTIME.initialized =
            true;

        installStyles();

        registerMenuCommands();

        initializeCleaner();

        console.info(
            `[WNC] WebNovel Cleaner ${WNC_VERSION} initialized.`
        );

        console.info(
            "[WNC] Database:",
            getDatabase()
        );

        console.info(
            "[WNC] Diagnostics:",
            getDiagnostics()
        );

        if (document.body) {
            createUi();
        } else {
            document.addEventListener(
                "DOMContentLoaded",
                createUi,
                {
                    once: true
                }
            );
        }
    }

    WNC.ui.create =
        createUi;

    WNC.ui.import =
        openImportDialog;

    WNC.ui.export =
        openExportDialog;

    WNC.diagnostics.get =
        getDiagnostics;

    WNC.diagnostics.showDatabase =
        showDatabaseJson;

    WNC.diagnostics.copyDatabase =
        copyDatabaseJson;

    /*
     * Expose WNC for debugging.
     */
    try {
        if (
            typeof unsafeWindow !==
            "undefined"
        ) {
            unsafeWindow.WNC =
                WNC;
        }
    } catch {
        try {
            window.WNC =
                WNC;
        } catch {
            // Ignore environments
            // where window exposure
            // is unavailable.
        }
    }

    initializeWNC();

})();
