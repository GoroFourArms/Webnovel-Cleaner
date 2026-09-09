// ==UserScript==
// @name         WebNovel Cleaner
// @namespace    https://github.com/GoroFourArms/Webnovel-Cleaner
// @version      5.2
// @description  WebNovel Cleaner - replacement engine, scanner, editor and FoxReplace-compatible database
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

    const WNC_VERSION = "5.2.0";

    const FOXREPLACE_DB_KEY = "WNC_FOXREPLACE_DATABASE_V1";
    const LEGACY_DB_KEY = "WNC_DATABASE_V5";

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

    // ============================================================
    // PART 1 - DATABASE / FOXREPLACE DATA MODEL
    // ============================================================

    const DEFAULT_DATABASE = {
        groups: []
    };

    function clone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function normalizeFoxReplaceDatabase(db) {
        const source =
            db && typeof db === "object"
                ? clone(db)
                : clone(DEFAULT_DATABASE);

        if (!Array.isArray(source.groups)) {
            source.groups = [];
        }

        source.groups = source.groups.map(group => {
            const normalizedGroup =
                group && typeof group === "object"
                    ? group
                    : {};

            if (typeof normalizedGroup.name !== "string") {
                normalizedGroup.name = "Unnamed Group";
            }

            if (!Array.isArray(normalizedGroup.urls)) {
                normalizedGroup.urls = [];
            }

            normalizedGroup.urls = normalizedGroup.urls
                .filter(url => typeof url === "string");

            if (typeof normalizedGroup.enabled !== "boolean") {
                normalizedGroup.enabled = true;
            }

            if (typeof normalizedGroup.pageLoad !== "boolean") {
                normalizedGroup.pageLoad = true;
            }

            if (typeof normalizedGroup.auto !== "boolean") {
                normalizedGroup.auto = true;
            }

            if (!Array.isArray(normalizedGroup.substitutions)) {
                normalizedGroup.substitutions = [];
            }

            normalizedGroup.substitutions =
                normalizedGroup.substitutions.map(substitution => {
                    const normalizedSubstitution =
                        substitution &&
                        typeof substitution === "object"
                            ? substitution
                            : {};

                    if (typeof normalizedSubstitution.input !== "string") {
                        normalizedSubstitution.input = "";
                    }

                    if (typeof normalizedSubstitution.output !== "string") {
                        normalizedSubstitution.output = "";
                    }

                    if (
                        normalizedSubstitution.inputType !== "text" &&
                        normalizedSubstitution.inputType !== "whole" &&
                        normalizedSubstitution.inputType !== "regexp"
                    ) {
                        normalizedSubstitution.inputType = "text";
                    }

                    if (
                        typeof normalizedSubstitution.caseSensitive !==
                        "boolean"
                    ) {
                        normalizedSubstitution.caseSensitive = false;
                    }

                    if (
                        typeof normalizedSubstitution.enabled !== "boolean"
                    ) {
                        normalizedSubstitution.enabled = true;
                    }

                    if (
                        normalizedSubstitution.html !== "none" &&
                        normalizedSubstitution.html !== "html" &&
                        normalizedSubstitution.html !== "all"
                    ) {
                        normalizedSubstitution.html = "none";
                    }

                    return normalizedSubstitution;
                });

            return normalizedGroup;
        });

        return source;
    }

    function migrateLegacyDatabase() {
        const currentValue = GM_getValue(FOXREPLACE_DB_KEY, null);

        if (
            currentValue !== null &&
            currentValue !== undefined &&
            currentValue !== ""
        ) {
            return null;
        }

        const legacyValue = GM_getValue(LEGACY_DB_KEY, null);

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
                typeof legacyValue === "string"
                    ? JSON.parse(legacyValue)
                    : clone(legacyValue);
        } catch (error) {
            console.warn(
                "[WNC] Legacy database could not be parsed:",
                error
            );
            return null;
        }

        if (!legacy || !Array.isArray(legacy.packs)) {
            return null;
        }

        const groups = legacy.packs
            .slice()
            .sort((a, b) => {
                return (
                    Number(a?.order ?? 0) -
                    Number(b?.order ?? 0)
                );
            })
            .map(pack => {
                const oldRules = Array.isArray(pack?.rules)
                    ? pack.rules
                    : [];

                const substitutions = oldRules
                    .slice()
                    .sort((a, b) => {
                        return (
                            Number(a?.order ?? 0) -
                            Number(b?.order ?? 0)
                        );
                    })
                    .map(rule => {
                        let inputType = rule?.type;

                        if (inputType === "regex") {
                            inputType = "regexp";
                        }

                        if (
                            inputType !== "text" &&
                            inputType !== "whole" &&
                            inputType !== "regexp"
                        ) {
                            inputType = "text";
                        }

                        let html = rule?.htmlMode;

                        if (
                            html !== "none" &&
                            html !== "html" &&
                            html !== "all"
                        ) {
                            html = "none";
                        }

                        return {
                            input:
                                typeof rule?.find === "string"
                                    ? rule.find
                                    : "",

                            output:
                                typeof rule?.replace === "string"
                                    ? rule.replace
                                    : "",

                            inputType,

                            caseSensitive:
                                typeof rule?.caseSensitive === "boolean"
                                    ? rule.caseSensitive
                                    : false,

                            enabled:
                                typeof rule?.enabled === "boolean"
                                    ? rule.enabled
                                    : true,

                            html
                        };
                    });

                return {
                    name:
                        typeof pack?.name === "string"
                            ? pack.name
                            : "Unnamed Group",

                    urls: Array.isArray(pack?.urls)
                        ? pack.urls.filter(
                              url => typeof url === "string"
                          )
                        : [],

                    enabled:
                        typeof pack?.enabled === "boolean"
                            ? pack.enabled
                            : true,

                    pageLoad:
                        typeof pack?.pageLoad === "boolean"
                            ? pack.pageLoad
                            : true,

                    auto:
                        typeof pack?.auto === "boolean"
                            ? pack.auto
                            : true,

                    substitutions
                };
            });

        const migrated = normalizeFoxReplaceDatabase({
            groups
        });

        GM_setValue(
            FOXREPLACE_DB_KEY,
            JSON.stringify(migrated)
        );

        console.info(
            "[WNC] Legacy database migrated to FoxReplace format."
        );

        return migrated;
    }

    function migrateDatabase(db) {
        return normalizeFoxReplaceDatabase(db);
    }

    function loadDatabase() {
        migrateLegacyDatabase();

        const stored = GM_getValue(
            FOXREPLACE_DB_KEY,
            null
        );

        if (
            stored === null ||
            stored === undefined ||
            stored === ""
        ) {
            return clone(DEFAULT_DATABASE);
        }

        try {
            const parsed =
                typeof stored === "string"
                    ? JSON.parse(stored)
                    : clone(stored);

            return migrateDatabase(parsed);
        } catch (error) {
            console.warn(
                "[WNC] Database could not be loaded:",
                error
            );

            return clone(DEFAULT_DATABASE);
        }
    }

    function saveDatabase(db) {
        const normalized =
            normalizeFoxReplaceDatabase(db);

        GM_setValue(
            FOXREPLACE_DB_KEY,
            JSON.stringify(normalized)
        );

        WNC.database.current = normalized;

        return clone(normalized);
    }

    WNC.database.current = loadDatabase();

    function getDatabase() {
        WNC.database.current = loadDatabase();
        return clone(WNC.database.current);
    }

    function setPackOrder(packName, requestedOrder) {
        const db = getDatabase();

        const currentIndex = db.groups.findIndex(
            group => group.name === packName
        );

        if (currentIndex < 0) {
            return false;
        }

        let targetIndex = Number(requestedOrder);

        if (!Number.isFinite(targetIndex)) {
            return false;
        }

        targetIndex = Math.max(
            0,
            Math.min(targetIndex, db.groups.length - 1)
        );

        const [group] = db.groups.splice(
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
        const db = getDatabase();

        const group = db.groups.find(
            item => item.name === packName
        );

        if (!group) {
            return false;
        }

        let currentIndex = Number(oldOrder);
        let targetIndex = Number(requestedOrder);

        if (
            !Number.isFinite(currentIndex) ||
            !Number.isFinite(targetIndex)
        ) {
            return false;
        }

        if (
            currentIndex < 0 ||
            currentIndex >= group.substitutions.length
        ) {
            return false;
        }

        targetIndex = Math.max(
            0,
            Math.min(
                targetIndex,
                group.substitutions.length - 1
            )
        );

        const [substitution] =
            group.substitutions.splice(
                currentIndex,
                1
            );

        group.substitutions.splice(
            targetIndex,
            0,
            substitution
        );

        saveDatabase(db);

        return true;
    }

    function createPack(name) {
        const db = getDatabase();

        const groupName =
            String(name || "").trim();

        if (!groupName) {
            throw new Error(
                "Group name cannot be empty."
            );
        }

        if (
            db.groups.some(
                group => group.name === groupName
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
        const db = getDatabase();

        return (
            db.groups.find(
                group => group.name === name
            ) || null
        );
    }

    function updatePack(name, data) {
        const db = getDatabase();

        const group = db.groups.find(
            item => item.name === name
        );

        if (!group) {
            return false;
        }

        const source =
            data && typeof data === "object"
                ? data
                : {};

        if (typeof source.name === "string") {
            const newName = source.name.trim();

            if (
                newName &&
                newName !== group.name &&
                db.groups.some(
                    item =>
                        item !== group &&
                        item.name === newName
                )
            ) {
                throw new Error(
                    `Group already exists: ${newName}`
                );
            }

            if (newName) {
                group.name = newName;
            }
        }

        if (Array.isArray(source.urls)) {
            group.urls = source.urls
                .filter(
                    url => typeof url === "string"
                );
        }

        if (
            typeof source.enabled === "boolean"
        ) {
            group.enabled = source.enabled;
        }

        if (
            typeof source.pageLoad === "boolean"
        ) {
            group.pageLoad = source.pageLoad;
        }

        if (
            typeof source.auto === "boolean"
        ) {
            group.auto = source.auto;
        }

        saveDatabase(db);

        return true;
    }

    function removePack(name) {
        const db = getDatabase();

        const originalLength =
            db.groups.length;

        db.groups = db.groups.filter(
            group => group.name !== name
        );

        if (
            db.groups.length === originalLength
        ) {
            return false;
        }

        saveDatabase(db);

        return true;
    }

    function addRule(packName, rule) {
        const db = getDatabase();

        const group = db.groups.find(
            item => item.name === packName
        );

        if (!group) {
            return false;
        }

        group.substitutions.push({
            input:
                typeof rule?.input === "string"
                    ? rule.input
                    : "",

            output:
                typeof rule?.output === "string"
                    ? rule.output
                    : "",

            inputType:
                rule?.inputType === "whole" ||
                rule?.inputType === "regexp"
                    ? rule.inputType
                    : "text",

            caseSensitive:
                typeof rule?.caseSensitive === "boolean"
                    ? rule.caseSensitive
                    : false,

            enabled:
                typeof rule?.enabled === "boolean"
                    ? rule.enabled
                    : true,

            html:
                rule?.html === "html" ||
                rule?.html === "all"
                    ? rule.html
                    : "none"
        });

        saveDatabase(db);

        return true;
    }

    function updateRule(
        packName,
        ruleIndex,
        data
    ) {
        const db = getDatabase();

        const group = db.groups.find(
            item => item.name === packName
        );

        if (!group) {
            return false;
        }

        const index = Number(ruleIndex);

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= group.substitutions.length
        ) {
            return false;
        }

        const substitution =
            group.substitutions[index];

        const source =
            data && typeof data === "object"
                ? data
                : {};

        if (
            typeof source.input === "string"
        ) {
            substitution.input =
                source.input;
        }

        if (
            typeof source.output === "string"
        ) {
            substitution.output =
                source.output;
        }

        if (
            source.inputType === "text" ||
            source.inputType === "whole" ||
            source.inputType === "regexp"
        ) {
            substitution.inputType =
                source.inputType;
        }

        if (
            typeof source.caseSensitive ===
            "boolean"
        ) {
            substitution.caseSensitive =
                source.caseSensitive;
        }

        if (
            typeof source.enabled === "boolean"
        ) {
            substitution.enabled =
                source.enabled;
        }

        if (
            source.html === "none" ||
            source.html === "html" ||
            source.html === "all"
        ) {
            substitution.html =
                source.html;
        }

        saveDatabase(db);

        return true;
    }

    function removeRule(
        packName,
        ruleIndex
    ) {
        const db = getDatabase();

        const group = db.groups.find(
            item => item.name === packName
        );

        if (!group) {
            return false;
        }

        const index = Number(ruleIndex);

        if (
            !Number.isInteger(index) ||
            index < 0 ||
            index >= group.substitutions.length
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

    function matchSite(pattern, url) {
        if (!pattern) {
            return false;
        }

        const source =
            String(pattern).trim();

        if (!source) {
            return false;
        }

        const target =
            String(url || "");

        if (
            source === "*" ||
            source === target
        ) {
            return true;
        }

        const escaped = source
            .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
            .replace(/\*/g, ".*");

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

    function getMatchedPacks(url) {
        const db = getDatabase();

        return db.groups.filter(group => {
            if (!group.enabled) {
                return false;
            }

            if (!Array.isArray(group.urls)) {
                return true;
            }

            if (group.urls.length === 0) {
                return true;
            }

            return group.urls.some(
                pattern =>
                    matchSite(pattern, url)
            );
        });
    }

    WNC.database.get =
        getDatabase;

    WNC.database.save =
        saveDatabase;

    WNC.database.normalize =
        normalizeFoxReplaceDatabase;

    WNC.database.migrate =
        migrateDatabase;

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

    console.info(
        `[WNC] Part 1 loaded - database ${WNC_VERSION}`
    );

    // ============================================================
    // PART 2 - REPLACEMENT ENGINE
    // ============================================================

    function escapeRegExp(value) {
        return String(value).replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );
    }

    function buildRuleRegex(rule) {
        if (
            !rule ||
            typeof rule.input !== "string" ||
            !rule.input
        ) {
            return null;
        }

        let source;

        switch (rule.inputType) {
            case "regexp":
                source = rule.input;
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

        if (!rule.caseSensitive) {
            flags += "i";
        }

        try {
            return new RegExp(
                source,
                flags
            );
        } catch (error) {
            console.warn(
                "[WNC] Invalid regular expression:",
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
            typeof text !== "string" ||
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

        const result = text.replace(
            regex,
            () => {
                replacements++;
                return rule.output;
            }
        );

        return {
            text: result,
            replacements
        };
    }

    function applyGroup(text, group) {
        if (
            !group ||
            group.enabled === false ||
            !Array.isArray(group.substitutions)
        ) {
            return {
                text,
                replacements: 0
            };
        }

        let result = text;
        let replacements = 0;

        for (
            const rule of group.substitutions
        ) {
            const applied =
                applySubstitution(
                    result,
                    rule
                );

            result = applied.text;
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

            result = applied.text;
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

            result = applied.text;
            replacements +=
                applied.replacements;
        }

        return {
            text: result,
            replacements
        };
    }

    function applyHtmlSubstitution(
        element,
        rule
    ) {
        if (
            !element ||
            !rule ||
            rule.enabled === false
        ) {
            return 0;
        }

        if (
            rule.html !== "all" &&
            rule.html !== "html"
        ) {
            return 0;
        }

        const applied =
            applySubstitution(
                element.innerHTML,
                rule
            );

        if (
            applied.replacements > 0
        ) {
            element.innerHTML =
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

        let replacements = 0;

        if (
            root.nodeType === Node.ELEMENT_NODE
        ) {
            replacements +=
                applyHtmlSubstitution(
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
                        const parent =
                            node.parentElement;

                        if (!parent) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        const tag =
                            parent.tagName;

                        if (
                            tag === "SCRIPT" ||
                            tag === "STYLE" ||
                            tag === "NOSCRIPT" ||
                            tag === "TEXTAREA" ||
                            tag === "INPUT"
                        ) {
                            return NodeFilter.FILTER_REJECT;
                        }

                        return NodeFilter.FILTER_ACCEPT;
                    }
                }
            );

        const nodes = [];

        let node;

        while (
            (node = walker.nextNode())
        ) {
            nodes.push(node);
        }

        for (
            const textNode of nodes
        ) {
            const applied =
                applySubstitution(
                    textNode.nodeValue,
                    rule
                );

            if (
                applied.replacements > 0
            ) {
                textNode.nodeValue =
                    applied.text;

                replacements +=
                    applied.replacements;
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
            const rule of group.substitutions || []
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

    console.info(
        "[WNC] Part 2 loaded - replacement engine"
    );

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
            typeof text !== "string" ||
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
            const rule of group.substitutions || []
        ) {
            matches +=
                scanSubstitution(
                    text,
                    rule
                );
        }

        return matches;
    }

    function scanDatabase(
        text,
        database
    ) {
        const db =
            normalizeFoxReplaceDatabase(
                database
            );

        let matches = 0;

        for (
            const group of db.groups
        ) {
            matches +=
                scanGroup(
                    text,
                    group
                );
        }

        return matches;
    }

    function scanPage(
        root = document.body,
        url = location.href
    ) {
        scannerState.running = true;
        scannerState.scanned++;
        scannerState.lastRun =
            new Date().toISOString();

        if (!root) {
            scannerState.running = false;
            return {
                scanned: 0,
                matches: 0
            };
        }

        const groups =
            getMatchedPacks(url);

        let text = "";

        if (
            root.innerText !== undefined
        ) {
            text = root.innerText;
        } else {
            text = root.textContent || "";
        }

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

        scannerState.running = false;

        return {
            scanned: 1,
            matches
        };
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
            ...String(text).matchAll(regex)
        ];
    }

    function findPageMatches(
        root = document.body,
        url = location.href
    ) {
        const groups =
            getMatchedPacks(url);

        const text =
            root?.innerText ??
            root?.textContent ??
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

                if (matches.length) {
                    results.push({
                        group: group.name,
                        rule,
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

    console.info(
        "[WNC] Part 3 loaded - scanner"
    );

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
                enabled: Boolean(enabled)
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
                pageLoad: Boolean(pageLoad)
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
                auto: Boolean(auto)
            }
        );
    }

    function setRuleField(
        packName,
        ruleIndex,
        field,
        value
    ) {
        const allowedFields = new Set([
            "input",
            "output",
            "inputType",
            "caseSensitive",
            "enabled",
            "html"
        ]);

        if (!allowedFields.has(field)) {
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

    function setRuleInput(
        packName,
        ruleIndex,
        input
    ) {
        return setRuleField(
            packName,
            ruleIndex,
            "input",
            input
        );
    }

    function setRuleOutput(
        packName,
        ruleIndex,
        output
    ) {
        return setRuleField(
            packName,
            ruleIndex,
            "output",
            output
        );
    }

    function setRuleInputType(
        packName,
        ruleIndex,
        inputType
    ) {
        return setRuleField(
            packName,
            ruleIndex,
            "inputType",
            inputType
        );
    }

    function setRuleCaseSensitive(
        packName,
        ruleIndex,
        caseSensitive
    ) {
        return setRuleField(
            packName,
            ruleIndex,
            "caseSensitive",
            Boolean(caseSensitive)
        );
    }

    function setRuleEnabled(
        packName,
        ruleIndex,
        enabled
    ) {
        return setRuleField(
            packName,
            ruleIndex,
            "enabled",
            Boolean(enabled)
        );
    }

    function setRuleHtml(
        packName,
        ruleIndex,
        html
    ) {
        return setRuleField(
            packName,
            ruleIndex,
            "html",
            html
        );
    }

    function getEditablePack(
        packName
    ) {
        return getPack(packName);
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

        return (
            group.substitutions?.[index] ||
            null
        );
    }

    function selectGroup(name) {
        editorState.selectedGroup =
            name;

        editorState.selectedRule =
            null;

        return getEditablePack(name);
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

    function getEditorState() {
        return {
            ...editorState
        };
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

    WNC.editor.setRuleInput =
        setRuleInput;

    WNC.editor.setRuleOutput =
        setRuleOutput;

    WNC.editor.setRuleInputType =
        setRuleInputType;

    WNC.editor.setRuleCaseSensitive =
        setRuleCaseSensitive;

    WNC.editor.setRuleEnabled =
        setRuleEnabled;

    WNC.editor.setRuleHtml =
        setRuleHtml;

    WNC.editor.getPack =
        getEditablePack;

    WNC.editor.getRule =
        getEditableRule;

    WNC.editor.selectGroup =
        selectGroup;

    WNC.editor.selectRule =
        selectRule;

    WNC.editor.state =
        getEditorState;

    console.info(
        "[WNC] Part 4 loaded - editor"
    );

    // ============================================================
    // PART 5 - FOXREPLACE IMPORT / EXPORT TOOLS
    // ============================================================

    function isFoxReplaceDatabase(
        value
    ) {
        if (
            !value ||
            typeof value !== "object" ||
            !Array.isArray(value.groups)
        ) {
            return false;
        }

        for (
            const group of value.groups
        ) {
            if (
                !group ||
                typeof group !== "object"
            ) {
                return false;
            }

            if (
                group.name !== undefined &&
                typeof group.name !== "string"
            ) {
                return false;
            }

            if (
                group.urls !== undefined &&
                !Array.isArray(group.urls)
            ) {
                return false;
            }

            if (
                group.enabled !== undefined &&
                typeof group.enabled !== "boolean"
            ) {
                return false;
            }

            if (
                group.pageLoad !== undefined &&
                typeof group.pageLoad !== "boolean"
            ) {
                return false;
            }

            if (
                group.auto !== undefined &&
                typeof group.auto !== "boolean"
            ) {
                return false;
            }

            if (
                group.substitutions !== undefined &&
                !Array.isArray(
                    group.substitutions
                )
            ) {
                return false;
            }

            for (
                const substitution of
                group.substitutions || []
            ) {
                if (
                    !substitution ||
                    typeof substitution !== "object"
                ) {
                    return false;
                }

                if (
                    substitution.input !== undefined &&
                    typeof substitution.input !== "string"
                ) {
                    return false;
                }

                if (
                    substitution.output !== undefined &&
                    typeof substitution.output !== "string"
                ) {
                    return false;
                }

                if (
                    substitution.inputType !== undefined &&
                    ![
                        "text",
                        "whole",
                        "regexp"
                    ].includes(
                        substitution.inputType
                    )
                ) {
                    return false;
                }

                if (
                    substitution.caseSensitive !== undefined &&
                    typeof substitution.caseSensitive !==
                        "boolean"
                ) {
                    return false;
                }

                if (
                    substitution.enabled !== undefined &&
                    typeof substitution.enabled !==
                        "boolean"
                ) {
                    return false;
                }

                if (
                    substitution.html !== undefined &&
                    ![
                        "none",
                        "html",
                        "all"
                    ].includes(
                        substitution.html
                    )
                ) {
                    return false;
                }
            }
        }

        return true;
    }

    function importFoxReplaceDatabase(
        json
    ) {
        let parsed;

        try {
            parsed =
                typeof json === "string"
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

        if (
            !isFoxReplaceDatabase(parsed)
        ) {
            return {
                success: false,
                error:
                    "The imported data is not valid FoxReplace JSON."
            };
        }

        const normalized =
            normalizeFoxReplaceDatabase(
                parsed
            );

        saveDatabase(normalized);

        return {
            success: true,
            database: clone(normalized)
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

    function importDatabaseFromText(
        text
    ) {
        return importFoxReplaceDatabase(
            text
        );
    }

    function downloadDatabase(
        filename = "foxreplace.json"
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
            URL.createObjectURL(blob);

        const link =
            document.createElement("a");

        link.href = url;
        link.download = filename;

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(
            () =>
                URL.revokeObjectURL(url),
            1000
        );

        return true;
    }

    function clearDatabase() {
        saveDatabase(
            clone(DEFAULT_DATABASE)
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
            groups: db.groups.length,
            rules,
            jsonLength:
                JSON.stringify(db).length
        };
    }

    function copyJson(value) {
        const json =
            typeof value === "string"
                ? value
                : JSON.stringify(
                      value,
                      null,
                      2
                  );

        GM_setClipboard(
            json,
            "text"
        );

        return json;
    }

    WNC.tools.isFoxReplaceDatabase =
        isFoxReplaceDatabase;

    WNC.tools.import =
        importFoxReplaceDatabase;

    WNC.tools.importText =
        importDatabaseFromText;

    WNC.tools.export =
        exportFoxReplaceDatabase;

    WNC.tools.copy =
        copyDatabaseToClipboard;

    WNC.tools.copyJson =
        copyJson;

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

    console.info(
        "[WNC] Part 5 loaded - FoxReplace tools"
    );

    // ============================================================
    // PART 6 - CLEANER
    // ============================================================

    const cleanerState = {
        running: false,
        lastRun: null,
        replacements: 0
    };

    let cleanerObserver = null;

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
        return applyMatchedPacks(
            text,
            url
        );
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
            getPageLoadGroups(url);

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

    function getCleanerStatus() {
        return {
            ...cleanerState,
            observer:
                Boolean(cleanerObserver)
        };
    }

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
        return getMatchedPacks(url)
            .filter(
                group =>
                    shouldCleanGroup(
                        group
                    )
            );
    }

    function cleanPageLoad(
        root = document.body,
        url = location.href
    ) {
        if (!root) {
            return 0;
        }

        cleanerState.running = true;

        const groups =
            getPageLoadGroups(url);

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

        cleanerState.running = false;

        return replacements;
    }

    function startCleanerObserver() {
        if (cleanerObserver) {
            return false;
        }

        if (
            typeof MutationObserver ===
            "undefined"
        ) {
            return false;
        }

        cleanerObserver =
            new MutationObserver(
                mutations => {
                    const groups =
                        getPageLoadGroups(
                            location.href
                        );

                    if (
                        groups.length === 0
                    ) {
                        return;
                    }

                    for (
                        const mutation of
                        mutations
                    ) {
                        for (
                            const node of
                            mutation.addedNodes
                        ) {
                            if (
                                node.nodeType !==
                                Node.ELEMENT_NODE
                            ) {
                                continue;
                            }

                            for (
                                const group of
                                groups
                            ) {
                                applyGroupToDocument(
                                    node,
                                    group
                                );
                            }
                        }
                    }
                }
            );

        const target =
            document.body ||
            document.documentElement;

        if (!target) {
            cleanerObserver =
                null;

            return false;
        }

        cleanerObserver.observe(
            target,
            {
                childList: true,
                subtree: true
            }
        );

        return true;
    }

    function stopCleanerObserver() {
        if (!cleanerObserver) {
            return false;
        }

        cleanerObserver.disconnect();
        cleanerObserver = null;

        return true;
    }

    function initializeCleaner() {
        const run = () => {
            cleanPageLoad(
                document.body,
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

    WNC.cleaner.status =
        getCleanerStatus;

    WNC.cleaner.shouldCleanGroup =
        shouldCleanGroup;

    WNC.cleaner.getPageLoadGroups =
        getPageLoadGroups;

    WNC.cleaner.cleanPageLoad =
        cleanPageLoad;

    WNC.cleaner.start =
        startCleanerObserver;

    WNC.cleaner.stop =
        stopCleanerObserver;

    WNC.cleaner.initialize =
        initializeCleaner;

    console.info(
        "[WNC] Part 6 loaded - cleaner"
    );

    // ============================================================
    // PART 7 - UI / DIAGNOSTICS / INITIALIZATION
    // ============================================================

    function getDiagnostics() {
        const db =
            getDatabase();

        const stats =
            getDatabaseStats();

        return {
            version:
                WNC_VERSION,

            databaseKey:
                FOXREPLACE_DB_KEY,

            groups:
                stats.groups,

            rules:
                stats.rules,

            databaseBytes:
                JSON.stringify(db).length,

            scanner:
                getScannerStatus(),

            cleaner:
                getCleanerStatus(),

            editor:
                getEditorState()
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
            document.createElement("input");

        input.type = "file";
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
            document.getElementById(
                "wnc-panel"
            )
        ) {
            return;
        }

        const panel =
            document.createElement("div");

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

                const action =
                    button.dataset.action;

                try {
                    if (
                        action ===
                        "import"
                    ) {
                        openImportDialog();

                    } else if (
                        action ===
                        "export"
                    ) {
                        openExportDialog();

                    } else if (
                        action ===
                        "copy"
                    ) {
                        copyDatabaseJson();

                        status.textContent =
                            "JSON copied";

                    } else if (
                        action ===
                        "scan"
                    ) {
                        const result =
                            scanPage();

                        status.textContent =
                            `Matches: ${result.matches}`;

                    } else if (
                        action ===
                        "clean"
                    ) {
                        const count =
                            cleanPageLoad();

                        status.textContent =
                            `Replacements: ${count}`;
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
        GM_addStyle(`
            #wnc-panel {
                position: fixed;
                right: 12px;
                bottom: 12px;
                z-index: 2147483647;
                padding: 10px;
                background: rgba(20, 20, 20, 0.95);
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
                    "[WNC] Scan result:",
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
                    "[WNC] Clean result:",
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
        installStyles();
        registerMenuCommands();

        WNC.cleaner.initialize();

        console.info(
            "[WNC] Database:",
            getDatabase()
        );

        console.info(
            "[WNC] Diagnostics:",
            getDiagnostics()
        );

        console.info(
            `[WNC] WebNovel Cleaner ${WNC_VERSION} initialized.`
        );

        if (
            document.body
        ) {
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

    WNC.ui.diagnostics =
        getDiagnostics;

    WNC.diagnostics.get =
        getDiagnostics;

    WNC.diagnostics.showDatabase =
        showDatabaseJson;

    WNC.diagnostics.copyDatabase =
        copyDatabaseJson;

    // Expose WNC for console/debugging.
    try {
        unsafeWindow.WNC =
            WNC;
    } catch {
        window.WNC =
            WNC;
    }

    initializeWNC();

})();
