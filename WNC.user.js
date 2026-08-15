// ==UserScript==
// @name         WebNovel Cleaner
// @namespace    WNC
// @version      5.0.0
// @description  WebNovel Cleaner - replacement database and tools
// @author       GoroFourArms
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @run-at       document-idle
// ==/UserScript==


// ============================================================
// WNC v5.0
// PART 1/7
// SECTION: Core Database
//
// No UI.
// No scanner.
// No replacement engine.
//
// This section provides the database that the Editor will edit.
// ============================================================

(function () {

    "use strict";


    // ========================================================
    // CORE
    // ========================================================

    const WNC_VERSION = "5.0.0";
    const DB_KEY = "WNC_DATABASE";


    const DEFAULT_DATABASE = {
        version: WNC_VERSION,
        packs: []
    };


    function clone(data) {

        return JSON.parse(
            JSON.stringify(data)
        );

    }


    function today() {

        return new Date()
            .toISOString()
            .split("T")[0];

    }


    // ========================================================
    // DATABASE STORAGE
    // ========================================================

    function saveDatabase(db) {

        GM_setValue(
            DB_KEY,
            JSON.stringify(
                db,
                null,
                2
            )
        );

    }


    function loadRawDatabase() {

        const stored =
            GM_getValue(DB_KEY);

        if (!stored) {

            return null;

        }


        try {

            return JSON.parse(stored);

        }
        catch (error) {

            console.error(
                "[WNC] Database JSON is invalid:",
                error
            );

            return null;

        }

    }


    // ========================================================
    // MIGRATION
    // ========================================================

    function migrateRule(rule, index) {

        if (!rule || typeof rule !== "object") {

            rule = {};

        }


        if (rule.order === undefined) {

            rule.order = index + 1;

        }


        if (rule.find === undefined) {

            rule.find = "";

        }


        if (rule.replace === undefined) {

            rule.replace = "";

        }


        if (!rule.type) {

            rule.type = "whole";

        }


        if (rule.caseSensitive === undefined) {

            rule.caseSensitive = false;

        }


        if (rule.enabled === undefined) {

            rule.enabled = true;

        }


        if (rule.htmlMode === undefined) {

            rule.htmlMode = "none";

        }


        if (rule.lastUsed === undefined) {

            rule.lastUsed = null;

        }


        return rule;

    }


    function migratePack(pack, index) {

        if (!pack || typeof pack !== "object") {

            pack = {};

        }


        if (!pack.name) {

            pack.name =
                "Unnamed Pack";

        }


        if (!Array.isArray(pack.urls)) {

            pack.urls = [];

        }


        if (!Array.isArray(pack.rules)) {

            pack.rules = [];

        }


        if (pack.order === undefined) {

            pack.order = index + 1;

        }


        if (pack.enabled === undefined) {

            pack.enabled = true;

        }


        if (pack.pageLoad === undefined) {

            pack.pageLoad = true;

        }


        if (pack.auto === undefined) {

            pack.auto = true;

        }


        pack.rules =
            pack.rules.map(
                migrateRule
            );


        return pack;

    }


    function migrateDatabase(db) {

        if (!db || typeof db !== "object") {

            db = clone(
                DEFAULT_DATABASE
            );

        }


        if (!db.version) {

            db.version = "4.0.0";

        }


        if (!Array.isArray(db.packs)) {

            db.packs = [];

        }


        db.packs =
            db.packs.map(
                migratePack
            );


        db.version =
            WNC_VERSION;


        return db;

    }


    function loadDatabase() {

        let db =
            loadRawDatabase();


        if (!db) {

            db =
                clone(
                    DEFAULT_DATABASE
                );

        }


        db =
            migrateDatabase(db);


        saveDatabase(db);


        return db;

    }


    // ========================================================
    // PACK ORDER
    // ========================================================

    function nextPackOrder(db) {

        let max = 0;


        db.packs.forEach(
            pack => {

                if (
                    Number.isFinite(
                        pack.order
                    )
                    &&
                    pack.order > max
                ) {

                    max = pack.order;

                }

            }
        );


        return max + 1;

    }


    // ========================================================
    // RULE ORDER
    // ========================================================

    function nextRuleOrder(pack) {

        let max = 0;


        pack.rules.forEach(
            rule => {

                if (
                    Number.isFinite(
                        rule.order
                    )
                    &&
                    rule.order > max
                ) {

                    max = rule.order;

                }

            }
        );


        return max + 1;

    }


    // ========================================================
    // PACKS
    // ========================================================

    function createPack(name) {

        const db =
            loadDatabase();


        name =
            String(name || "")
            .trim();


        if (!name) {

            return null;

        }


        if (
            db.packs.some(
                pack =>
                    pack.name === name
            )
        ) {

            return null;

        }


        const pack = {

            name,

            order:
                nextPackOrder(db),

            enabled: true,

            pageLoad: true,

            auto: true,

            urls: [],

            rules: []

        };


        db.packs.push(
            pack
        );


        saveDatabase(db);


        return pack;

    }


    function getPacks() {

        return loadDatabase()
            .packs
            .slice()
            .sort(
                (a, b) =>
                    a.order - b.order
            );

    }


    function getPack(name) {

        return loadDatabase()
            .packs
            .find(
                pack =>
                    pack.name === name
            )
            || null;

    }


    function updatePack(name, data) {

        const db =
            loadDatabase();


        const pack =
            db.packs.find(
                item =>
                    item.name === name
            );


        if (!pack) {

            return false;

        }


        Object.assign(
            pack,
            data
        );


        saveDatabase(db);


        return true;

    }


    function removePack(name) {

        const db =
            loadDatabase();


        const oldLength =
            db.packs.length;


        db.packs =
            db.packs.filter(
                pack =>
                    pack.name !== name
            );


        if (
            db.packs.length === oldLength
        ) {

            return false;

        }


        saveDatabase(db);


        return true;

    }


    // ========================================================
    // RULES
    // ========================================================

    function addRule(packName, data = {}) {

        const db =
            loadDatabase();


        const pack =
            db.packs.find(
                item =>
                    item.name === packName
            );


        if (!pack) {

            return null;

        }


        const rule = {

            order:
                nextRuleOrder(pack),

            find:
                data.find !== undefined
                    ? String(data.find)
                    : "",

            replace:
                data.replace !== undefined
                    ? String(data.replace)
                    : "",

            type:
                data.type || "whole",

            caseSensitive:
                data.caseSensitive === true,

            enabled:
                data.enabled !== false,

            htmlMode:
                data.htmlMode || "none",

            lastUsed:
                null

        };


        pack.rules.push(
            rule
        );


        saveDatabase(db);


        return rule;

    }


    function getRule(packName, order) {

        const pack =
            getPack(packName);


        if (!pack) {

            return null;

        }


        return pack.rules.find(
            rule =>
                rule.order === order
        )
        || null;

    }


    function updateRule(
        packName,
        order,
        data
    ) {

        const db =
            loadDatabase();


        const pack =
            db.packs.find(
                item =>
                    item.name === packName
            );


        if (!pack) {

            return false;

        }


        const rule =
            pack.rules.find(
                item =>
                    item.order === order
            );


        if (!rule) {

            return false;

        }


        Object.assign(
            rule,
            data
        );


        saveDatabase(db);


        return true;

    }


    function removeRule(
        packName,
        order
    ) {

        const db =
            loadDatabase();


        const pack =
            db.packs.find(
                item =>
                    item.name === packName
            );


        if (!pack) {

            return false;

        }


        const oldLength =
            pack.rules.length;


        pack.rules =
            pack.rules.filter(
                rule =>
                    rule.order !== order
            );


        if (
            pack.rules.length === oldLength
        ) {

            return false;

        }


        saveDatabase(db);


        return true;

    }


    function touchRule(
        packName,
        order
    ) {

        return updateRule(
            packName,
            order,
            {
                lastUsed: today()
            }
        );

    }


    // ========================================================
    // URL MATCHING
    // ========================================================

    function matchSite(
        pattern,
        url
    ) {

        if (!pattern) {

            return true;

        }


        const test =
            String(pattern)
            .toLowerCase()
            .trim();


        const value =
            String(url)
            .toLowerCase();


        if (!test) {

            return true;

        }


        /*
         * Wildcard matching.
         *
         * Example:
         *
         *   example.com/*
         *
         * matches:
         *
         *   example.com/chapter/1
         */

        if (test.includes("*")) {

            const escaped =
                test.replace(
                    /[.+?^${}()|[\]\\]/g,
                    "\\$&"
                );


            const regex =
                escaped.replace(
                    /\*/g,
                    ".*"
                );


            try {

                return new RegExp(
                    "^" +
                    regex +
                    "$"
                ).test(value);

            }
            catch (error) {

                return false;

            }

        }


        /*
         * Non-wildcard patterns are
         * substring matches.
         */

        return value.includes(
            test
        );

    }


    function getMatchedPacks(url) {

        return getPacks()
            .filter(
                pack => {

                    if (
                        pack.enabled === false
                    ) {

                        return false;

                    }


                    if (
                        !pack.urls.length
                    ) {

                        return true;

                    }


                    return pack.urls.some(
                        pattern =>
                            matchSite(
                                pattern,
                                url
                            )
                    );

                }
            );

    }


    // ========================================================
    // PUBLIC WNC API
    // ========================================================

    unsafeWindow.WNC =
        unsafeWindow.WNC || {};


    const WNC =
        unsafeWindow.WNC;


    WNC.version =
        WNC_VERSION;


    WNC.database = {

        load:
            loadDatabase,

        save:
            saveDatabase,

        migrate:
            migrateDatabase

    };


    WNC.packs = {

        create:
            createPack,

        getAll:
            getPacks,

        get:
            getPack,

        update:
            updatePack,

        remove:
            removePack,

        getMatched:
            getMatchedPacks

    };


    WNC.rules = {

        add:
            addRule,

        get:
            getRule,

        update:
            updateRule,

        remove:
            removeRule,

        touch:
            touchRule

    };


    // ========================================================
    // INITIALIZE
    // ========================================================

    loadDatabase();


    console.log(
        "[WNC] v" +
        WNC_VERSION +
        " Part 1 - Database loaded"
    );
// ============================================================
// WNC v5.0
// PART 2/7
// SECTION: Replacement Engine + Undo
//
// Handles:
//   - Active rules
//   - Whole-word replacement
//   - Text replacement
//   - Regex replacement
//   - Apply
//   - Undo
//
// No UI.
// ============================================================

(function () {

    "use strict";


    const WNC =
        unsafeWindow.WNC;


    // ========================================================
    // STATE
    // ========================================================

    let applying = false;

    let undoStack = [];

    const regexCache =
        new Map();


    // ========================================================
    // REGEX ESCAPE
    // ========================================================

    function escapeRegex(text) {

        return String(text)
            .replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

    }


    // ========================================================
    // BUILD RULE PATTERN
    // ========================================================

    function buildPattern(rule) {

        const cacheKey =
            JSON.stringify({
                type:
                    rule.type,

                find:
                    rule.find,

                caseSensitive:
                    rule.caseSensitive
            });


        if (
            regexCache.has(cacheKey)
        ) {

            return regexCache.get(
                cacheKey
            );

        }


        const flags =
            rule.caseSensitive
                ? "g"
                : "gi";


        let pattern = null;


        try {

            // ------------------------------------------------
            // REGEX
            // ------------------------------------------------

            if (
                rule.type === "regex"
            ) {

                pattern =
                    new RegExp(
                        rule.find,
                        flags
                    );

            }


            // ------------------------------------------------
            // TEXT
            // ------------------------------------------------

            else if (
                rule.type === "text"
            ) {

                pattern =
                    new RegExp(
                        escapeRegex(
                            rule.find
                        ),
                        flags
                    );

            }


            // ------------------------------------------------
            // WHOLE
            // ------------------------------------------------

            else {

                /*
                 * Whole means the phrase must not be
                 * immediately attached to a word/hyphen
                 * character.
                 *
                 * Example:
                 *
                 *   Park
                 *
                 * matches:
                 *
                 *   Park
                 *   Director Park
                 *
                 * but not:
                 *
                 *   Parker
                 *   Park-something
                 */

                pattern =
                    new RegExp(

                        "(?<![\\w-])" +

                        escapeRegex(
                            rule.find
                        ) +

                        "(?![\\w-])",

                        flags

                    );

            }

        }
        catch (error) {

            console.warn(
                "[WNC] Invalid rule:",
                rule.find,
                error
            );

            pattern = null;

        }


        regexCache.set(
            cacheKey,
            pattern
        );


        return pattern;

    }


    // ========================================================
    // REPLACE ONE VALUE
    // ========================================================

    function replaceValue(
        text,
        rule
    ) {

        if (
            !rule ||
            !rule.find
        ) {

            return text;

        }


        const pattern =
            buildPattern(rule);


        if (!pattern) {

            return text;

        }


        try {

            return text.replace(
                pattern,
                rule.replace
            );

        }
        catch (error) {

            console.warn(
                "[WNC] Replacement failed:",
                rule,
                error
            );

            return text;

        }

    }


    // ========================================================
    // GET TEXT NODES
    // ========================================================

    function getTextNodes() {

        const nodes = [];


        if (!document.body) {

            return nodes;

        }


        const walker =
            document.createTreeWalker(

                document.body,

                NodeFilter.SHOW_TEXT

            );


        while (
            walker.nextNode()
        ) {

            const node =
                walker.currentNode;


            const parent =
                node.parentElement;


            if (!parent) {

                continue;

            }


            /*
             * Never modify these elements.
             */

            if (
                [
                    "SCRIPT",
                    "STYLE",
                    "INPUT",
                    "TEXTAREA",
                    "NOSCRIPT",
                    "CODE"
                ].includes(
                    parent.tagName
                )
            ) {

                continue;

            }


            if (
                node.nodeValue &&
                node.nodeValue.trim()
            ) {

                nodes.push(
                    node
                );

            }

        }


        return nodes;

    }


    // ========================================================
    // ACTIVE RULES
    // ========================================================

    function getActiveRules() {

        const url =
            location.hostname;


        const packs =
            WNC.packs.getMatched(
                url
            );


        const rules = [];


        packs.forEach(
            pack => {

                /*
                 * Page-load setting only controls
                 * automatic page-load execution.
                 *
                 * Manual Apply is still allowed.
                 */

                pack.rules
                    .filter(
                        rule =>
                            rule.enabled !== false
                    )
                    .sort(
                        (a, b) =>
                            a.order - b.order
                    )
                    .forEach(
                        rule => {

                            rules.push({

                                pack,

                                rule

                            });

                        }
                    );

            }
        );


        return rules;

    }


    // ========================================================
    // APPLY
    // ========================================================

    function apply() {

        if (applying) {

            return {

                changed: 0,

                rules: 0

            };

        }


        applying = true;


        undoStack = [];


        let changedCount = 0;


        try {

            const rules =
                getActiveRules();


            if (!rules.length) {

                return {

                    changed: 0,

                    rules: 0

                };

            }


            const nodes =
                getTextNodes();


            nodes.forEach(
                node => {

                    const before =
                        node.nodeValue;


                    let after =
                        before;


                    rules.forEach(
                        item => {

                            const changed =
                                replaceValue(
                                    after,
                                    item.rule
                                );


                            if (
                                changed !== after
                            ) {

                                WNC.rules.touch(

                                    item.pack.name,

                                    item.rule.order

                                );

                            }


                            after =
                                changed;

                        }
                    );


                    if (
                        after !== before
                    ) {

                        undoStack.push({

                            node,

                            oldValue:
                                before,

                            newValue:
                                after

                        });


                        node.nodeValue =
                            after;


                        changedCount++;

                    }

                }
            );


            return {

                changed:
                    changedCount,

                rules:
                    rules.length

            };

        }
        finally {

            applying = false;

        }

    }


    // ========================================================
    // UNDO
    // ========================================================

    function undo() {

        if (!undoStack.length) {

            return 0;

        }


        let restored = 0;


        /*
         * Reverse the changes in reverse order.
         *
         * This is safer when multiple nodes were changed.
         */

        for (
            let i =
                undoStack.length - 1;

            i >= 0;

            i--
        ) {

            const change =
                undoStack[i];


            if (
                !change.node
            ) {

                continue;

            }


            /*
             * The node may have been removed from
             * the document since Apply.
             */

            change.node.nodeValue =
                change.oldValue;


            restored++;

        }


        undoStack = [];


        return restored;

    }


    // ========================================================
    // CLEAR UNDO
    // ========================================================

    function clearUndo() {

        undoStack = [];

    }


    // ========================================================
    // UNDO STATUS
    // ========================================================

    function canUndo() {

        return undoStack.length > 0;

    }


    // ========================================================
    // CLEAR REGEX CACHE
    // ========================================================

    function clearRegexCache() {

        regexCache.clear();

    }


    // ========================================================
    // PUBLIC API
    // ========================================================

    WNC.replace = {

        apply,

        undo,

        clearUndo,

        canUndo,

        replaceValue,

        getRules:
            getActiveRules,

        clearRegexCache

    };


    console.log(
        "[WNC] v5.0 Part 2 - Replacement Engine loaded"
    );


})();
  // ============================================================
// WNC v5.0
// PART 3/7
// SECTION: FoxReplace Import / Export
//
// Handles:
//   - FoxReplace JSON conversion
//   - Import as WNC database
//   - Merge FoxReplace packs
//   - Export WNC database
//
// No UI.
// ============================================================

(function () {

    "use strict";


    const WNC =
        unsafeWindow.WNC;


    // ========================================================
    // FOXREPLACE TYPE CONVERSION
    // ========================================================

    function convertType(type) {

        if (type === "regexp") {

            return "regex";

        }


        if (type === "text") {

            return "text";

        }


        return "whole";

    }


    // ========================================================
    // CONVERT FOXREPLACE RULE
    // ========================================================

    function convertRule(
        substitution,
        index
    ) {

        return {

            order:
                index + 1,

            find:
                substitution.input !== undefined
                    ? String(
                        substitution.input
                    )
                    : "",

            replace:
                substitution.output !== undefined
                    ? String(
                        substitution.output
                    )
                    : "",

            type:
                convertType(
                    substitution.inputType
                ),

            caseSensitive:
                substitution.caseSensitive === true,

            enabled: true,

            htmlMode:
                substitution.html || "none",

            lastUsed: null

        };

    }


    // ========================================================
    // CONVERT FOXREPLACE PACK
    // ========================================================

    function convertPack(
        group,
        index
    ) {

        const pack = {

            name:
                group.name ||
                "Imported Pack " +
                (index + 1),

            order:
                index + 1,

            enabled:
                group.enabled !== false,

            pageLoad: true,

            auto: true,

            urls:
                Array.isArray(
                    group.urls
                )
                    ? group.urls.slice()
                    : [],

            rules: []

        };


        /*
         * Some FoxReplace versions use
         * "substitutions".
         */

        if (
            Array.isArray(
                group.substitutions
            )
        ) {

            pack.rules =
                group.substitutions.map(
                    convertRule
                );

        }


        return pack;

    }


    // ========================================================
    // CONVERT FOXREPLACE DATABASE
    // ========================================================

    function convertFoxReplace(
        data
    ) {

        if (
            !data ||
            !Array.isArray(
                data.groups
            )
        ) {

            return null;

        }


        return {

            version:
                WNC.version,

            packs:
                data.groups.map(
                    convertPack
                )

        };

    }


    // ========================================================
    // FIND UNIQUE PACK NAME
    // ========================================================

    function uniquePackName(
        db,
        originalName
    ) {

        let name =
            originalName ||
            "Imported Pack";


        let count = 1;


        while (
            db.packs.some(
                pack =>
                    pack.name === name
            )
        ) {

            name =
                originalName +
                " (" +
                count +
                ")";


            count++;

        }


        return name;

    }


    // ========================================================
    // RULE COMPARISON
    // ========================================================

    function sameRule(
        a,
        b
    ) {

        return (

            a.find === b.find &&

            a.replace === b.replace &&

            a.type === b.type &&

            a.caseSensitive ===
                b.caseSensitive

        );

    }


    // ========================================================
    // IMPORT REPORT
    // ========================================================

    function emptyReport() {

        return {

            groups: 0,

            packsAdded: 0,

            packsMerged: 0,

            rulesAdded: 0,

            duplicatesSkipped: 0

        };

    }


    // ========================================================
    // IMPORT FOXREPLACE
    //
    // Creates new packs if names don't exist.
    // Existing packs receive the imported rules.
    //
    // This is the normal "Import FoxReplace" operation.
    // ========================================================

    function importFoxReplace(
        data
    ) {

        const converted =
            convertFoxReplace(
                data
            );


        if (!converted) {

            return null;

        }


        const db =
            WNC.database.load();


        const report =
            emptyReport();


        report.groups =
            converted.packs.length;


        converted.packs.forEach(
            importedPack => {

                let pack =
                    db.packs.find(
                        existing =>
                            existing.name ===
                            importedPack.name
                    );


                if (!pack) {

                    /*
                     * New pack.
                     */

                    pack = {

                        name:
                            importedPack.name,

                        order:
                            db.packs.length + 1,

                        enabled:
                            importedPack.enabled,

                        pageLoad:
                            importedPack.pageLoad,

                        auto:
                            importedPack.auto,

                        urls:
                            importedPack.urls,

                        rules: []

                    };


                    db.packs.push(
                        pack
                    );


                    report.packsAdded++;

                }
                else {

                    /*
                     * Existing pack.
                     */

                    report.packsMerged++;

                }


                importedPack.rules.forEach(
                    importedRule => {

                        const duplicate =
                            pack.rules.some(
                                existingRule =>
                                    sameRule(
                                        existingRule,
                                        importedRule
                                    )
                            );


                        if (duplicate) {

                            report.duplicatesSkipped++;

                            return;

                        }


                        importedRule.order =
                            nextRuleOrder(
                                pack
                            );


                        pack.rules.push(
                            importedRule
                        );


                        report.rulesAdded++;

                    }
                );

            }
        );


        WNC.database.save(
            db
        );


        return report;

    }


    // ========================================================
    // REPLACE DATABASE
    //
    // Completely replaces the current database with
    // the FoxReplace contents.
    //
    // Confirmation belongs to the UI, not this function.
    // ========================================================

    function replaceWithFoxReplace(
        data
    ) {

        const converted =
            convertFoxReplace(
                data
            );


        if (!converted) {

            return null;

        }


        WNC.database.save(
            converted
        );


        return converted;

    }


    // ========================================================
    // NEXT RULE ORDER
    // ========================================================

    function nextRuleOrder(
        pack
    ) {

        let max = 0;


        pack.rules.forEach(
            rule => {

                if (
                    Number.isFinite(
                        rule.order
                    ) &&
                    rule.order > max
                ) {

                    max =
                        rule.order;

                }

            }
        );


        return max + 1;

    }


    // ========================================================
    // READ FILE
    // ========================================================

    function readJSONFile(
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
                    () => {

                        try {

                            const data =
                                JSON.parse(
                                    reader.result
                                );


                            resolve(
                                data
                            );

                        }
                        catch (error) {

                            reject(
                                new Error(
                                    "Invalid JSON file"
                                )
                            );

                        }

                    };


                reader.onerror =
                    () => {

                        reject(
                            new Error(
                                "Could not read file"
                            )
                        );

                    };


                reader.readAsText(
                    file
                );

            }
        );

    }


    // ========================================================
    // EXPORT DATABASE OBJECT
    // ========================================================

    function exportDatabase() {

        return WNC.database.load();

    }


    // ========================================================
    // DOWNLOAD JSON
    // ========================================================

    function downloadJSON(
        data,
        filename
    ) {

        const blob =
            new Blob(
                [
                    JSON.stringify(
                        data,
                        null,
                        2
                    )
                ],
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


        /*
         * Let the browser finish using the
         * object URL before releasing it.
         */

        setTimeout(
            () => {

                URL.revokeObjectURL(
                    url
                );

            },
            1000
        );

    }


    // ========================================================
    // EXPORT WNC BACKUP
    // ========================================================

    function downloadDatabase() {

        downloadJSON(
            exportDatabase(),
            "WNC-backup.json"
        );

    }


    // ========================================================
    // PUBLIC API
    // ========================================================

    WNC.foxReplace = {

        convert:
            convertFoxReplace,

        import:
            importFoxReplace,

        replace:
            replaceWithFoxReplace

    };


    WNC.export = {

        database:
            exportDatabase,

        download:
            downloadDatabase

    };


    WNC.file = {

        readJSON:
            readJSONFile

    };


    console.log(
        "[WNC] v5.0 Part 3 - FoxReplace compatibility loaded"
    );


})();
// ==UserScript==
// @name         WebNovel Cleaner v5
// @namespace    WNC
// @version      5.0
// @description  WebNovel Cleaner - replacement engine
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        unsafeWindow
// ==/UserScript==


// ============================================================
// WNC v5.0 - PART 3/7
// SECTION: Replacement Engine
//
// Responsibilities:
//
//   • Apply enabled rules
//   • Respect pack/site matching
//   • Page-load switch
//   • Auto switch
//   • Undo
//   • Regex caching
//   • Text-node replacement
//
// UI is NOT included here.
// Editor / Scanner / Tools are separate parts.
// ============================================================

(function(){

"use strict";


const WNC = unsafeWindow.WNC;


// ============================================================
// STATE
// ============================================================

let undoStack = [];

let applying = false;

const regexCache = new Map();


// Global switches.
// These are runtime switches, not database replacement rules.

let applyEnabled = true;

let pageLoadEnabled = true;

let autoEnabled = true;


// ============================================================
// REGEX HELPERS
// ============================================================

function escapeRegex(text){

    return String(text)
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

}


function buildPattern(rule){

    const cacheKey =
        JSON.stringify({
            type:rule.type,
            find:rule.find,
            caseSensitive:rule.caseSensitive
        });


    if(regexCache.has(cacheKey))
        return regexCache.get(cacheKey);


    let pattern = null;


    const flags =
        rule.caseSensitive
            ? "g"
            : "gi";


    try{

        if(rule.type === "regex"){

            pattern =
                new RegExp(
                    rule.find,
                    flags
                );

        }

        else if(rule.type === "text"){

            pattern =
                new RegExp(
                    escapeRegex(rule.find),
                    flags
                );

        }

        else{

            // "whole"
            //
            // Match the complete phrase without
            // touching letters or hyphens directly
            // before/after it.

            pattern =
                new RegExp(
                    "(?<![\\w-])" +
                    escapeRegex(rule.find) +
                    "(?![\\w-])",
                    flags
                );

        }

    }

    catch(error){

        console.warn(
            "[WNC] Invalid rule:",
            rule.find,
            error
        );

        pattern = null;

    }


    regexCache.set(
        cacheKey,
        pattern
    );


    return pattern;

}


// ============================================================
// SINGLE RULE
// ============================================================

function replaceValue(text,rule){

    if(!rule)
        return text;


    if(!rule.find)
        return text;


    if(rule.enabled === false)
        return text;


    const pattern =
        buildPattern(rule);


    if(!pattern)
        return text;


    try{

        return text.replace(
            pattern,
            rule.replace || ""
        );

    }

    catch(error){

        console.warn(
            "[WNC] Replacement failed:",
            rule,
            error
        );

        return text;

    }

}


// ============================================================
// SITE / PACK RULES
// ============================================================

function getActiveRules(){

    if(!applyEnabled)
        return [];


    const hostname =
        location.hostname;


    const packs =
        WNC.packs.getMatched(
            hostname
        );


    const rules = [];


    packs.forEach(pack=>{

        if(pack.enabled === false)
            return;


        // Page Load switch controls whether
        // normal application is allowed.

        if(!pageLoadEnabled)
            return;


        if(pack.pageLoad === false)
            return;


        pack.rules
            .filter(rule =>
                rule.enabled !== false
            )
            .sort((a,b) =>
                a.order - b.order
            )
            .forEach(rule=>{

                rules.push({

                    pack:pack,

                    rule:rule

                });

            });

    });


    return rules;

}


// ============================================================
// TEXT NODES
// ============================================================

function shouldIgnore(node){

    if(!node)
        return true;


    const parent =
        node.parentElement;


    if(!parent)
        return true;


    return [

        "SCRIPT",
        "STYLE",
        "INPUT",
        "TEXTAREA",
        "NOSCRIPT",
        "CODE"

    ].includes(
        parent.tagName
    );

}


function getTextNodes(root=document.body){

    const nodes = [];


    if(!root)
        return nodes;


    const walker =
        document.createTreeWalker(

            root,

            NodeFilter.SHOW_TEXT

        );


    while(walker.nextNode()){

        const node =
            walker.currentNode;


        if(shouldIgnore(node))
            continue;


        if(!node.nodeValue.trim())
            continue;


        nodes.push(node);

    }


    return nodes;

}


// ============================================================
// APPLY TO ONE NODE
// ============================================================

function applyToNode(node,rules){

    if(!node)
        return false;


    if(shouldIgnore(node))
        return false;


    const before =
        node.nodeValue;


    if(!before.trim())
        return false;


    let after =
        before;


    rules.forEach(item=>{

        const changed =
            replaceValue(
                after,
                item.rule
            );


        if(changed !== after){

            WNC.rules.touch(
                item.pack.name,
                item.rule.order
            );

        }


        after = changed;

    });


    if(after === before)
        return false;


    undoStack.push({

        node:node,

        oldValue:before,

        newValue:after

    });


    node.nodeValue =
        after;


    return true;

}


// ============================================================
// APPLY PAGE
// ============================================================

function apply(){

    if(applying)
        return;


    if(!applyEnabled)
        return;


    applying = true;


    undoStack = [];


    const rules =
        getActiveRules();


    if(!rules.length){

        applying = false;

        return;

    }


    const nodes =
        getTextNodes();


    nodes.forEach(node=>{

        applyToNode(
            node,
            rules
        );

    });


    applying = false;


    console.log(
        "[WNC] Applied",
        undoStack.length,
        "text-node changes"
    );

}


// ============================================================
// APPLY ONE NODE FOR AUTO MODE
// ============================================================

function applyAuto(node){

    if(!autoEnabled)
        return;


    if(!applyEnabled)
        return;


    if(!pageLoadEnabled)
        return;


    const rules =
        getActiveRules();


    if(!rules.length)
        return;


    applyToNode(
        node,
        rules
    );

}


// ============================================================
// UNDO
// ============================================================

function undo(){

    if(!undoStack.length)
        return;


    const changes =
        undoStack.slice().reverse();


    changes.forEach(change=>{

        if(!change.node)
            return;


        // Only restore if the node still contains
        // the value produced by WNC.
        //
        // This prevents blindly overwriting later
        // changes made by the page.

        if(
            change.node.nodeValue ===
            change.newValue
        ){

            change.node.nodeValue =
                change.oldValue;

        }

    });


    undoStack = [];


    console.log(
        "[WNC] Undo complete"
    );

}


// ============================================================
// UNDO STATE
// ============================================================

function clearUndo(){

    undoStack = [];

}


function canUndo(){

    return undoStack.length > 0;

}


// ============================================================
// GLOBAL SWITCHES
// ============================================================

function setApplyEnabled(value){

    applyEnabled =
        value !== false;


}


function isApplyEnabled(){

    return applyEnabled;

}


function setPageLoadEnabled(value){

    pageLoadEnabled =
        value !== false;

}


function isPageLoadEnabled(){

    return pageLoadEnabled;

}


function setAutoEnabled(value){

    autoEnabled =
        value !== false;

}


function isAutoEnabled(){

    return autoEnabled;

}


// ============================================================
// CACHE
// ============================================================

function clearRegexCache(){

    regexCache.clear();

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.replace = {

    apply:apply,

    undo:undo,

    clearUndo:clearUndo,

    canUndo:canUndo,

    replaceValue:replaceValue,

    getRules:getActiveRules,

    applyAuto:applyAuto,

    clearRegexCache:clearRegexCache

};


WNC.state = {

    setApplyEnabled:setApplyEnabled,

    isApplyEnabled:isApplyEnabled,

    setPageLoadEnabled:setPageLoadEnabled,

    isPageLoadEnabled:isPageLoadEnabled,

    setAutoEnabled:setAutoEnabled,

    isAutoEnabled:isAutoEnabled

};


// ============================================================
// LOG
// ============================================================

console.log(
    "[WNC] v5.0 Part 3 - Replacement Engine loaded"
);


})();
// ============================================================
// WNC v5.0 - PART 4/7
// SECTION: Page Cleaner + Auto Observer
//
// Responsibilities:
//
//   • Clean existing page text
//   • Watch dynamically added text
//   • Respect Apply / Page Load / Auto switches
//   • Avoid SCRIPT / STYLE / INPUT / etc.
//   • Avoid observer loops
//
// UI is NOT included here.
// ============================================================

(function(){

"use strict";


const WNC = unsafeWindow.WNC;


let observer = null;

let running = false;


// ============================================================
// NODE FILTERING
// ============================================================

function shouldIgnore(node){

    if(!node)
        return true;


    const parent =
        node.parentElement;


    if(!parent)
        return true;


    return [

        "SCRIPT",
        "STYLE",
        "INPUT",
        "TEXTAREA",
        "NOSCRIPT",
        "CODE"

    ].includes(
        parent.tagName
    );

}


// ============================================================
// CLEAN ONE TEXT NODE
// ============================================================

function cleanTextNode(node){

    if(!node)
        return;


    if(shouldIgnore(node))
        return;


    if(!WNC.state.isApplyEnabled())
        return;


    if(!WNC.state.isPageLoadEnabled())
        return;


    if(!node.nodeValue.trim())
        return;


    WNC.replace.applyAuto(node);

}


// ============================================================
// SCAN A NEWLY ADDED NODE
// ============================================================

function scanNode(node){

    if(!node)
        return;


    // A text node can be handled directly.

    if(node.nodeType === Node.TEXT_NODE){

        cleanTextNode(node);

        return;

    }


    // Ignore non-element fragments.

    if(
        node.nodeType !== Node.ELEMENT_NODE &&
        node.nodeType !== Node.DOCUMENT_FRAGMENT_NODE
    ){

        return;

    }


    // The added node itself may contain text.

    if(
        node.nodeType === Node.ELEMENT_NODE &&
        node.childNodes.length === 0
    ){

        return;

    }


    const walker =
        document.createTreeWalker(

            node,

            NodeFilter.SHOW_TEXT

        );


    const textNodes = [];


    while(walker.nextNode()){

        textNodes.push(
            walker.currentNode
        );

    }


    textNodes.forEach(
        cleanTextNode
    );

}


// ============================================================
// CLEAN EXISTING PAGE
// ============================================================

function cleanPage(){

    if(!document.body)
        return;


    if(!WNC.state.isApplyEnabled())
        return;


    if(!WNC.state.isPageLoadEnabled())
        return;


    const walker =
        document.createTreeWalker(

            document.body,

            NodeFilter.SHOW_TEXT

        );


    const nodes = [];


    while(walker.nextNode()){

        nodes.push(
            walker.currentNode
        );

    }


    nodes.forEach(
        cleanTextNode
    );


    console.log(
        "[WNC] Page Load cleaning complete"
    );

}


// ============================================================
// AUTO OBSERVER
// ============================================================

function startObserver(){

    if(observer)
        return;


    if(!document.body)
        return;


    observer =
        new MutationObserver(
            mutations=>{

                if(running)
                    return;


                if(!WNC.state.isApplyEnabled())
                    return;


                if(!WNC.state.isAutoEnabled())
                    return;


                running = true;


                try{

                    mutations.forEach(
                        mutation=>{

                            mutation.addedNodes.forEach(
                                node=>{

                                    scanNode(node);

                                }
                            );

                        }
                    );

                }

                finally{

                    running = false;

                }

            }
        );


    observer.observe(

        document.body,

        {

            childList:true,

            subtree:true

        }

    );


    console.log(
        "[WNC] Auto observer started"
    );

}


// ============================================================
// STOP OBSERVER
// ============================================================

function stopObserver(){

    if(!observer)
        return;


    observer.disconnect();

    observer = null;


    console.log(
        "[WNC] Auto observer stopped"
    );

}


// ============================================================
// RESTART
// ============================================================

function restart(){

    stopObserver();

    startObserver();

}


// ============================================================
// AUTO SWITCH
//
// The UI will call these functions.
// ============================================================

function setAuto(value){

    WNC.state.setAutoEnabled(
        value
    );


    if(value){

        startObserver();

    }

    else{

        stopObserver();

    }

}


// ============================================================
// PAGE LOAD SWITCH
//
// Turning Page Load on does not immediately re-run
// the entire page. The UI can explicitly use Apply.
// ============================================================

function setPageLoad(value){

    WNC.state.setPageLoadEnabled(
        value
    );

}


// ============================================================
// APPLY SWITCH
// ============================================================

function setApply(value){

    WNC.state.setApplyEnabled(
        value
    );


    if(!value){

        stopObserver();

        return;

    }


    if(
        WNC.state.isAutoEnabled()
    ){

        startObserver();

    }

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.cleaner = {

    cleanPage:cleanPage,

    scanNode:scanNode,

    start:startObserver,

    stop:stopObserver,

    restart:restart,

    setAuto:setAuto,

    setPageLoad:setPageLoad,

    setApply:setApply

};


// ============================================================
// INITIALIZATION
//
// We deliberately wait for the page to settle.
// This keeps WNC from fighting the site's own
// chapter rendering.
// ============================================================

function initialize(){

    if(!document.body)
        return;


    setTimeout(()=>{

        if(
            WNC.state.isApplyEnabled() &&
            WNC.state.isPageLoadEnabled()
        ){

            cleanPage();

        }


        if(
            WNC.state.isApplyEnabled() &&
            WNC.state.isAutoEnabled()
        ){

            startObserver();

        }

    },1000);

}


if(document.readyState === "loading"){

    window.addEventListener(
        "load",
        initialize,
        {
            once:true
        }
    );

}

else{

    initialize();

}


// ============================================================
// LOG
// ============================================================

console.log(
    "[WNC] v5.0 Part 4 - Cleaner + Observer loaded"
);


})();
// ============================================================
// WNC v5.0 - PART 5/7
// SECTION: Editor UI
//
// Main UI:
//
//     WNC - Editor
//
// The database is NOT a separate UI.
// This editor is the interface to the database.
//
// ============================================================

(function(){

"use strict";


const WNC = unsafeWindow.WNC;


let panel = null;

let currentPack = null;


// ============================================================
// BASIC HELPERS
// ============================================================

function makeButton(text,action){

    const button =
        document.createElement("button");

    button.textContent = text;

    button.type = "button";

    button.addEventListener(
        "click",
        action
    );

    return button;

}


function makeCheckbox(value,change){

    const input =
        document.createElement("input");

    input.type = "checkbox";

    input.checked =
        value !== false;

    input.addEventListener(
        "change",
        ()=>{
            change(input.checked);
        }
    );

    return input;

}


function makeCell(content){

    const td =
        document.createElement("td");

    if(content instanceof Node)
        td.appendChild(content);

    else
        td.textContent = content;

    return td;

}


function clearPanel(){

    if(panel)
        panel.remove();

    panel = null;

}


// ============================================================
// PANEL
// ============================================================

function createPanel(title){

    clearPanel();


    panel =
        document.createElement("div");


    panel.id =
        "wnc-editor-panel";


    panel.innerHTML = `

        <div class="wnc-editor-header">

            <b></b>

            <button
                type="button"
                class="wnc-editor-close"
            >
                X
            </button>

        </div>

        <div class="wnc-editor-content"></div>

    `;


    panel.querySelector(
        ".wnc-editor-header b"
    ).textContent = title;


    panel.querySelector(
        ".wnc-editor-close"
    ).onclick = clearPanel;


    document.body.appendChild(panel);


    return panel.querySelector(
        ".wnc-editor-content"
    );

}


// ============================================================
// OPEN EDITOR
// ============================================================

function openEditor(){

    currentPack = null;

    renderPacks();

}


// ============================================================
// PACK LIST
// ============================================================

function renderPacks(){

    const content =
        createPanel(
            "WNC Editor — Packs"
        );


    const toolbar =
        document.createElement("div");

    toolbar.className =
        "wnc-editor-toolbar";


    toolbar.appendChild(
        makeButton(
            "New Pack",
            createNewPack
        )
    );


    content.appendChild(toolbar);


    const table =
        document.createElement("table");

    table.className =
        "wnc-editor-table";


    table.innerHTML = `

        <thead>

            <tr>

                <th>Enabled</th>
                <th>Page Load</th>
                <th>Auto</th>
                <th>Pack</th>
                <th>Rules</th>
                <th>Delete</th>

            </tr>

        </thead>

        <tbody></tbody>

    `;


    const tbody =
        table.querySelector("tbody");


    WNC.packs
        .getAll()
        .forEach(pack=>{

            const row =
                document.createElement("tr");


            // Enabled

            const enabled =
                makeCheckbox(
                    pack.enabled,
                    value=>{

                        WNC.packs.update(
                            pack.name,
                            {
                                enabled:value
                            }
                        );

                    }
                );


            row.appendChild(
                makeCell(enabled)
            );


            // Page Load

            const pageLoad =
                makeCheckbox(
                    pack.pageLoad,
                    value=>{

                        WNC.packs.update(
                            pack.name,
                            {
                                pageLoad:value
                            }
                        );

                    }
                );


            row.appendChild(
                makeCell(pageLoad)
            );


            // Auto

            const auto =
                makeCheckbox(
                    pack.auto,
                    value=>{

                        WNC.packs.update(
                            pack.name,
                            {
                                auto:value
                            }
                        );

                    }
                );


            row.appendChild(
                makeCell(auto)
            );


            // Pack name

            const nameCell =
                document.createElement("td");


            const open =
                makeButton(
                    pack.name,
                    ()=>{
                        currentPack =
                            pack.name;

                        renderRules();
                    }
                );


            nameCell.appendChild(open);

            row.appendChild(nameCell);


            // Rule count

            row.appendChild(
                makeCell(
                    String(pack.rules.length)
                )
            );


            // Delete

            const deleteButton =
                makeButton(
                    "Delete",
                    ()=>{

                        if(!confirm(
                            `Delete pack "${pack.name}"?`
                        )){

                            return;

                        }


                        WNC.packs.remove(
                            pack.name
                        );


                        renderPacks();

                    }
                );


            row.appendChild(
                makeCell(deleteButton)
            );


            tbody.appendChild(row);

        });


    content.appendChild(table);

}


// ============================================================
// CREATE PACK
// ============================================================

function createNewPack(){

    const name =
        prompt(
            "Pack name:"
        );


    if(name === null)
        return;


    const clean =
        name.trim();


    if(!clean)
        return;


    if(
        WNC.packs.get(clean)
    ){

        alert(
            "A pack with that name already exists."
        );

        return;

    }


    WNC.packs.create(clean);

    renderPacks();

}


// ============================================================
// RULE EDITOR
// ============================================================

function renderRules(){

    const pack =
        WNC.packs.get(
            currentPack
        );


    if(!pack){

        renderPacks();

        return;

    }


    const content =
        createPanel(
            "WNC Editor — " + pack.name
        );


    // --------------------------------------------------------
    // TOP BAR
    // --------------------------------------------------------

    const toolbar =
        document.createElement("div");

    toolbar.className =
        "wnc-editor-toolbar";


    toolbar.appendChild(
        makeButton(
            "< Back",
            renderPacks
        )
    );


    toolbar.appendChild(
        makeButton(
            "Add Rule",
            ()=>{
                addRule();
            }
        )
    );


    content.appendChild(toolbar);


    // --------------------------------------------------------
    // PACK SETTINGS
    // --------------------------------------------------------

    const settings =
        document.createElement("div");

    settings.className =
        "wnc-editor-pack-settings";


    settings.innerHTML = `
        <b>Pack Settings</b>
    `;


    const urlLabel =
        document.createElement("label");

    urlLabel.textContent =
        "Site URLs";


    const urlInput =
        document.createElement("input");

    urlInput.type =
        "text";

    urlInput.value =
        (pack.urls || []).join(", ");


    urlInput.placeholder =
        "example.com, *.example.org";


    urlInput.addEventListener(
        "change",
        ()=>{

            const urls =
                urlInput.value
                    .split(",")
                    .map(x=>x.trim())
                    .filter(Boolean);


            WNC.packs.update(
                pack.name,
                {
                    urls:urls
                }
            );

        }
    );


    settings.appendChild(urlLabel);

    settings.appendChild(urlInput);


    content.appendChild(settings);


    // --------------------------------------------------------
    // RULE TABLE
    // --------------------------------------------------------

    const table =
        document.createElement("table");

    table.className =
        "wnc-editor-table";


    table.innerHTML = `

        <thead>

            <tr>

                <th>On</th>
                <th>Find</th>
                <th>Replace</th>
                <th>Type</th>
                <th>Case</th>
                <th>Save</th>
                <th>Delete</th>

            </tr>

        </thead>

        <tbody></tbody>

    `;


    const tbody =
        table.querySelector("tbody");


    pack.rules
        .sort((a,b)=>a.order-b.order)
        .forEach(rule=>{

            tbody.appendChild(
                createRuleRow(
                    pack,
                    rule
                )
            );

        });


    content.appendChild(table);

}


// ============================================================
// CREATE RULE ROW
// ============================================================

function createRuleRow(pack,rule){

    const row =
        document.createElement("tr");


    // --------------------------------------------------------
    // Enabled
    // --------------------------------------------------------

    const enabled =
        makeCheckbox(
            rule.enabled,
            value=>{

                WNC.rules.update(
                    pack.name,
                    rule.order,
                    {
                        enabled:value
                    }
                );

            }
        );


    row.appendChild(
        makeCell(enabled)
    );


    // --------------------------------------------------------
    // Find
    // --------------------------------------------------------

    const find =
        document.createElement("input");

    find.type =
        "text";

    find.value =
        rule.find;


    row.appendChild(
        makeCell(find)
    );


    // --------------------------------------------------------
    // Replace
    // --------------------------------------------------------

    const replace =
        document.createElement("input");

    replace.type =
        "text";

    replace.value =
        rule.replace;


    row.appendChild(
        makeCell(replace)
    );


    // --------------------------------------------------------
    // Type
    // --------------------------------------------------------

    const type =
        document.createElement("select");


    [
        ["whole","Whole"],
        ["text","Text"],
        ["regex","Regex"]

    ].forEach(([value,label])=>{

        const option =
            document.createElement("option");

        option.value =
            value;

        option.textContent =
            label;

        type.appendChild(option);

    });


    type.value =
        rule.type || "whole";


    row.appendChild(
        makeCell(type)
    );


    // --------------------------------------------------------
    // Case
    // --------------------------------------------------------

    const caseSensitive =
        makeCheckbox(
            rule.caseSensitive,
            ()=>{}
        );


    row.appendChild(
        makeCell(caseSensitive)
    );


    // --------------------------------------------------------
    // Save
    // --------------------------------------------------------

    const save =
        makeButton(
            "Save",
            ()=>{

                WNC.rules.update(

                    pack.name,

                    rule.order,

                    {

                        find:
                            find.value,

                        replace:
                            replace.value,

                        type:
                            type.value,

                        caseSensitive:
                            caseSensitive.checked

                    }

                );


                WNC.replace.clearRegexCache();


                save.textContent =
                    "Saved";


                setTimeout(
                    ()=>{
                        save.textContent =
                            "Save";
                    },
                    800
                );

            }
        );


    row.appendChild(
        makeCell(save)
    );


    // --------------------------------------------------------
    // Delete
    // --------------------------------------------------------

    const remove =
        makeButton(
            "Delete",
            ()=>{

                if(!confirm(
                    "Delete this rule?"
                )){

                    return;

                }


                WNC.rules.remove(
                    pack.name,
                    rule.order
                );


                renderRules();

            }
        );


    row.appendChild(
        makeCell(remove)
    );


    return row;

}


// ============================================================
// ADD RULE
// ============================================================

function addRule(){

    WNC.rules.add(

        currentPack,

        {

            find:"",
            replace:"",
            type:"whole",
            caseSensitive:false,
            enabled:true

        }

    );


    renderRules();

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.editor = {

    open:openEditor

};


// ============================================================
// CSS
// ============================================================

const style =
    document.createElement("style");


style.textContent = `

#wnc-editor-panel {

    position:fixed;

    top:50px;

    left:50%;

    transform:translateX(-50%);

    width:1000px;

    max-width:calc(100vw - 40px);

    max-height:85vh;

    overflow:auto;

    z-index:999999;

    background:#222;

    color:#fff;

    border:1px solid #777;

    border-radius:6px;

    padding:12px;

    font:13px Arial,sans-serif;

    box-shadow:
        0 4px 20px rgba(0,0,0,.5);

}


#wnc-editor-panel * {

    box-sizing:border-box;

}


.wnc-editor-header {

    display:flex;

    justify-content:space-between;

    align-items:center;

    margin-bottom:10px;

}


.wnc-editor-header b {

    font-size:15px;

}


#wnc-editor-panel button {

    cursor:pointer;

    padding:4px 8px;

}


.wnc-editor-toolbar {

    display:flex;

    gap:6px;

    margin-bottom:10px;

    flex-wrap:wrap;

}


.wnc-editor-table {

    width:100%;

    border-collapse:collapse;

}


.wnc-editor-table th,
.wnc-editor-table td {

    border:1px solid #555;

    padding:5px;

    vertical-align:middle;

}


.wnc-editor-table th {

    background:#333;

}


.wnc-editor-table input,
.wnc-editor-table select {

    width:100%;

    min-width:60px;

    padding:4px;

}


.wnc-editor-table input[type="checkbox"] {

    width:auto;

}


.wnc-editor-pack-settings {

    display:flex;

    align-items:center;

    gap:8px;

    margin-bottom:12px;

    padding:8px;

    border:1px solid #555;

}


.wnc-editor-pack-settings label {

    font-weight:bold;

}


.wnc-editor-pack-settings input {

    flex:1;

    min-width:200px;

    padding:5px;

}


`;

document.head.appendChild(style);


// ============================================================
// LOG
// ============================================================

console.log(
    "[WNC] v5.0 Part 5 - Editor UI loaded"
);


})();
// ============================================================
// WNC v5.0 - PART 6/7
// SECTION: Scanner UI
//
// Scanner responsibilities:
//
//   • Scan the current page
//   • Find capitalized name-like phrases
//   • Group similar phrases temporarily
//   • Grouping is based on the right-most token
//   • Prefer the longest/fullest phrase as representative
//   • Do NOT modify the database
//   • Do NOT merge database rules
//
// The scanner is an analysis tool.
// ============================================================

(function(){

"use strict";


const WNC = unsafeWindow.WNC;


// ============================================================
// STATE
// ============================================================

let panel = null;

let lastResults = [];


// ============================================================
// STOP WORDS
// ============================================================

const stopWords = new Set([

    "A","About","Above","After","Again","Against",
    "All","Also","Although","Am","An","And","Any",
    "Around","As","Asked","At",

    "Back","Be","Because","Been","Before","Being",
    "Below","Between","Both","But","By",

    "Can","Cannot","Chapter","Could","Coming",
    "Counting",

    "Day","Did","Do","Does","Doing","Down",
    "During",

    "Each","Even","Every",

    "Few","For","From","Further",

    "Gets","Getting","Goes","Going","Got",

    "Had","Has","Have","Having","He","Her","Here",
    "Hers","Herself","Hey","Him","Himself","His",
    "How","However",

    "I","If","I'm","I've","In","Into","Is","It",
    "Its","It's","Itself",

    "Just",

    "Later","Left","Let","Like","Looking","Looks",

    "Made","Make","Making","Many","May","Me",
    "Meanwhile","More","Most","Much","Must","My",
    "Myself",

    "Neither","Never","No","Nor","Not","Nothing",
    "Now",

    "Of","Off","On","Once","One","Only","Or",
    "Other","Our","Ours","Ourselves","Out","Over",

    "Part","Perhaps","Prev","Probably",

    "Quite",

    "Rather","Really","Right",

    "Said","Same","Saw","She","She's","Should",
    "Since","So","Some","Soon","Still","Such",
    "Suddenly",

    "Than","That","That's","The","Their","Theirs",
    "Them","Themselves","Then","There","There's",
    "These","They","This","Those","Though",
    "Through","To","Too","Thought",

    "Under","Until","Up",

    "Very",

    "Was","Watching","We","Were","What","When",
    "Where","Which","While","Who","Why","Will",
    "With","Without","Would","Work",

    "Yes","Yet","You","Your","Yours","Yourself",
    "Yourselves"

]);


const ambiguousWords = new Set([

    "Ah",
    "An",
    "Do",
    "Ha",
    "He",
    "No",
    "Oh",
    "One"

]);


// ============================================================
// PANEL
// ============================================================

function createPanel(){

    if(panel)
        panel.remove();


    panel =
        document.createElement("div");


    panel.id =
        "wnc-scanner-panel";


    panel.innerHTML = `

        <div class="wnc-scanner-header">

            <b>WNC Scanner</b>

            <button
                type="button"
                id="wnc-scanner-close"
            >
                X
            </button>

        </div>

        <div class="wnc-scanner-toolbar">

            <button
                type="button"
                id="wnc-scanner-scan"
            >
                Scan Page
            </button>

            <span id="wnc-scanner-status">
                Ready
            </span>

        </div>

        <div
            id="wnc-scanner-results"
        ></div>

    `;


    document.body.appendChild(panel);


    panel.querySelector(
        "#wnc-scanner-close"
    ).onclick = close;


    panel.querySelector(
        "#wnc-scanner-scan"
    ).onclick = scan;


    return panel;

}


function close(){

    if(panel)
        panel.remove();

    panel = null;

}


// ============================================================
// TOKEN HELPERS
// ============================================================

function normalizeToken(token){

    return token
        .toLowerCase()
        .replace(
            /[\p{Pd}\-]/gu,
            ""
        )
        .trim();

}


function tokenize(name){

    return name
        .trim()
        .split(/\s+/)
        .filter(Boolean);

}


function rightToken(name){

    const tokens =
        tokenize(name);


    if(!tokens.length)
        return "";


    return normalizeToken(
        tokens[tokens.length - 1]
    );

}


// ============================================================
// CAPITALIZED PHRASE SCANNER
// ============================================================

function scanNames(){

    const text =
        document.body?.innerText || "";


    if(!text)
        return [];


    /*
        Sentence boundaries are useful because
        otherwise a capitalized word at the start
        of a sentence can accidentally absorb too
        much text.
    */

    const prepared =
        text.replace(
            /([.!?])\s+/g,
            "$1 | "
        );


    const regex =
        /\p{Lu}[\p{L}\p{M}'\-]*
        (?:[ \t-]+\p{Lu}[\p{L}\p{M}'\-]*){0,3}/gu;


    const counts =
        new Map();


    let match;


    while(
        (match = regex.exec(prepared))
    ){

        let name =
            match[0]
                .trim()
                .replace(
                    /^['"“‘„«»]+/,
                    ""
                )
                .replace(
                    /['’”"«»]+$/,
                    ""
                )
                .replace(
                    /['’]s\b/gi,
                    ""
                )
                .replace(
                    /[.,!?]+$/,
                    ""
                )
                .replace(
                    /['‘']/g,
                    ""
                )
                .replace(
                    /\s+/g,
                    " "
                )
                .trim();


        if(!name)
            continue;


        if(
            name.includes(".") ||
            name.includes("|")
        ){

            continue;

        }


        if(name.length < 2)
            continue;


        const parts =
            name
                .split(/\s+/)
                .map(token=>{

                    const hyphenParts =
                        token.split("-");


                    /*
                        Keep the name itself but
                        discard trailing fragments
                        such as punctuation artifacts.
                    */

                    if(
                        hyphenParts.length >= 3
                    ){

                        hyphenParts.pop();

                    }


                    return hyphenParts.join("-");

                });


        name =
            parts
                .join(" ")
                .trim();


        if(!name)
            continue;


        if(
            stopWords.has(name)
        ){

            continue;

        }


        if(
            stopWords.has(parts[0])
        ){

            continue;

        }


        if(
            parts.length > 1 &&
            stopWords.has(
                parts[parts.length - 1]
            )
        ){

            continue;

        }


        if(
            parts.length === 1 &&
            ambiguousWords.has(name)
        ){

            continue;

        }


        /*
            Avoid obvious translator / platform
            phrases.
        */

        if(
            parts.length > 2 &&
            (
                parts.includes("Translator") ||
                parts.includes("Patreon") ||
                parts.includes("Discord")
            )
        ){

            continue;

        }


        counts.set(
            name,
            (counts.get(name) || 0) + 1
        );

    }


    return Array.from(
        counts.entries()
    )
    .map(
        ([name,count])=>({

            name:name,

            count:count

        })
    )
    .sort(
        (a,b)=>b.count-a.count
    );

}


// ============================================================
// GROUPING
// ============================================================

function groupResults(results){

    /*
        The key is deliberately the RIGHT-MOST
        meaningful token.

        We are not declaring that these phrases
        are the same person.

        We are simply saying:

            "These phrases are similar enough
             to inspect together."
    */

    const groups =
        new Map();


    results.forEach(item=>{

        const key =
            rightToken(item.name);


        if(!key)
            return;


        if(!groups.has(key)){

            groups.set(
                key,
                {
                    key:key,
                    items:[]
                }
            );

        }


        groups
            .get(key)
            .items
            .push(item);

    });


    /*
        Representative = longest/fullest phrase.

        Example:

            Park
            Sang-pil
            Park Sang-pil
            Director Park Sang-pil

        representative:

            Director Park Sang-pil
    */

    return Array.from(
        groups.values()
    )
    .map(group=>{

        group.items.sort(
            (a,b)=>{

                const tokenDifference =
                    tokenize(b.name).length -
                    tokenize(a.name).length;


                if(tokenDifference !== 0)
                    return tokenDifference;


                return b.name.length -
                       a.name.length;

            }
        );


        group.representative =
            group.items[0]?.name ||
            group.key;


        group.count =
            group.items.reduce(
                (sum,item)=>
                    sum + item.count,
                0
            );


        return group;

    })
    .sort(
        (a,b)=>b.count-a.count
    );

}


// ============================================================
// SCAN
// ============================================================

function scan(){

    if(!panel)
        createPanel();


    const status =
        panel.querySelector(
            "#wnc-scanner-status"
        );


    status.textContent =
        "Scanning...";


    const results =
        scanNames();


    lastResults =
        groupResults(results);


    renderResults();


    status.textContent =
        `${lastResults.length} groups`;

}


// ============================================================
// RENDER
// ============================================================

function renderResults(){

    const output =
        panel.querySelector(
            "#wnc-scanner-results"
        );


    output.innerHTML = "";


    if(!lastResults.length){

        output.textContent =
            "No name-like phrases found.";

        return;

    }


    lastResults.forEach(
        group=>{

            const box =
                document.createElement("div");


            box.className =
                "wnc-scanner-group";


            // ------------------------------------------------
            // Header
            // ------------------------------------------------

            const header =
                document.createElement("div");


            header.className =
                "wnc-scanner-group-header";


            const title =
                document.createElement("b");


            title.textContent =
                group.representative;


            const meta =
                document.createElement("span");


            meta.textContent =
                `  ${group.count} hits`;


            header.appendChild(title);

            header.appendChild(meta);


            box.appendChild(header);


            // ------------------------------------------------
            // Group body
            // ------------------------------------------------

            const body =
                document.createElement("div");


            body.className =
                "wnc-scanner-group-body";


            /*
                The group is collapsed initially.

                This is the scanner grouping UI,
                not database merging.
            */

            body.style.display =
                "none";


            group.items.forEach(
                item=>{

                    const row =
                        document.createElement("div");


                    row.className =
                        "wnc-scanner-item";


                    const name =
                        document.createElement("span");


                    name.textContent =
                        item.name;


                    const count =
                        document.createElement("span");


                    count.textContent =
                        String(item.count);


                    row.appendChild(name);

                    row.appendChild(count);


                    body.appendChild(row);

                }
            );


            header.onclick = ()=>{

                const open =
                    body.style.display !==
                    "none";


                body.style.display =
                    open
                        ? "none"
                        : "block";

            };


            box.appendChild(body);


            output.appendChild(box);

        }
    );

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.scanner = {

    open:()=>{
        createPanel();
    },

    scan:scan,

    getResults:()=>{
        return lastResults;
    }

};


// ============================================================
// CSS
// ============================================================

const style =
    document.createElement("style");


style.textContent = `

#wnc-scanner-panel {

    position:fixed;

    top:50px;

    left:50%;

    transform:translateX(-50%);

    width:850px;

    max-width:calc(100vw - 40px);

    max-height:85vh;

    overflow:auto;

    z-index:999999;

    background:#222;

    color:#fff;

    border:1px solid #777;

    border-radius:6px;

    padding:12px;

    font:13px Arial,sans-serif;

    box-shadow:
        0 4px 20px rgba(0,0,0,.5);

}


#wnc-scanner-panel * {

    box-sizing:border-box;

}


.wnc-scanner-header {

    display:flex;

    justify-content:space-between;

    align-items:center;

    margin-bottom:10px;

}


.wnc-scanner-toolbar {

    display:flex;

    align-items:center;

    gap:10px;

    margin-bottom:12px;

}


.wnc-scanner-toolbar button {

    cursor:pointer;

    padding:5px 10px;

}


.wnc-scanner-group {

    border:1px solid #555;

    margin-bottom:6px;

}


.wnc-scanner-group-header {

    padding:7px;

    cursor:pointer;

    background:#333;

    user-select:none;

}


.wnc-scanner-group-header:hover {

    background:#3d3d3d;

}


.wnc-scanner-group-header span {

    color:#aaa;

}


.wnc-scanner-group-body {

    padding:4px 8px 8px 8px;

}


.wnc-scanner-item {

    display:flex;

    justify-content:space-between;

    padding:4px 2px;

    border-bottom:1px solid #444;

}


.wnc-scanner-item:last-child {

    border-bottom:0;

}

`;


document.head.appendChild(style);


// ============================================================
// LOG
// ============================================================

console.log(
    "[WNC] v5.0 Part 6 - Scanner UI loaded"
);


})();
// ============================================================
// WNC
// PART 7/7
// SECTION: Initialization + Menu
// ============================================================

(function(){

"use strict";

const WNC = unsafeWindow.WNC;


// ============================================================
// FILE DOWNLOAD
// ============================================================

function downloadJSON(data, filename){

    const blob = new Blob(
        [
            JSON.stringify(
                data,
                null,
                2
            )
        ],
        {
            type:"application/json"
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

    URL.revokeObjectURL(url);

}


// ============================================================
// EXPORT WNC DATABASE
// ============================================================

function exportDatabase(){

    downloadJSON(
        WNC.database.load(),
        "WNC-backup.json"
    );

}


// ============================================================
// FILE IMPORT
// ============================================================

function chooseJSONFile(callback){

    const input =
        document.createElement("input");

    input.type = "file";
    input.accept = ".json,application/json";

    input.onchange = () => {

        const file =
            input.files[0];

        if(!file)
            return;

        const reader =
            new FileReader();

        reader.onload = () => {

            try{

                const data =
                    JSON.parse(reader.result);

                callback(data);

            }
            catch(error){

                console.error(
                    "[WNC] JSON import failed:",
                    error
                );

                alert(
                    "Invalid JSON file."
                );

            }

        };

        reader.readAsText(file);

    };

    input.click();

}


// ============================================================
// IMPORT WNC DATABASE
// ============================================================

function importWNCDatabase(){

    chooseJSONFile(data => {

        if(
            !data ||
            !Array.isArray(data.packs)
        ){

            alert(
                "This does not appear to be a WNC database."
            );

            return;

        }

        if(
            !confirm(
                "Replace the current WNC database with this file?"
            )
        ){

            return;

        }

        WNC.database.save(
            WNC.database.migrate(data)
        );

        alert(
            "WNC database imported."
        );

    });

}


// ============================================================
// IMPORT FOXREPLACE
// ============================================================

function importFoxReplace(){

    chooseJSONFile(data => {

        if(
            !data ||
            !Array.isArray(data.groups)
        ){

            alert(
                "This does not appear to be a FoxReplace JSON file."
            );

            return;

        }

        const report =
            WNC.foxReplace.import(
                data
            );

        if(!report){

            alert(
                "FoxReplace import failed."
            );

            return;

        }

        alert(

            "FoxReplace Import Complete\n\n" +

            "Groups: " +
            report.groups +

            "\nNew Packs: " +
            report.newPacks +

            "\nMerged Packs: " +
            report.mergedPacks +

            "\nRules Added: " +
            report.addedRules +

            "\nDuplicates Skipped: " +
            report.skippedRules

        );

    });

}


// ============================================================
// TOOLS PANEL
// ============================================================

function openTools(){

    if(WNC.tools && WNC.tools.open){

        WNC.tools.open();

        return;

    }

    console.warn(
        "[WNC] Tools UI is not available."
    );

}


// ============================================================
// APPLY
// ============================================================

function apply(){

    if(
        WNC.replace &&
        WNC.replace.apply
    ){

        WNC.replace.apply();

    }

}


// ============================================================
// UNDO
// ============================================================

function undo(){

    if(
        WNC.replace &&
        WNC.replace.undo
    ){

        WNC.replace.undo();

    }

}


// ============================================================
// AUTO TOGGLE
// ============================================================

function toggleAuto(){

    const db =
        WNC.database.load();

    const packs =
        db.packs;

    if(!packs.length){

        alert(
            "No WNC packs exist."
        );

        return;

    }

    const currentlyOn =
        packs.some(
            pack => pack.auto !== false
        );

    const newValue =
        !currentlyOn;

    packs.forEach(pack => {

        pack.auto =
            newValue;

    });

    WNC.database.save(db);

    if(
        WNC.cleaner &&
        WNC.cleaner.restart
    ){

        WNC.cleaner.restart();

    }

    console.log(
        "[WNC] Auto:",
        newValue ? "ON" : "OFF"
    );

}


// ============================================================
// PAGE LOAD TOGGLE
// ============================================================

function togglePageLoad(){

    const db =
        WNC.database.load();

    const packs =
        db.packs;

    if(!packs.length){

        alert(
            "No WNC packs exist."
        );

        return;

    }

    const currentlyOn =
        packs.some(
            pack => pack.pageLoad !== false
        );

    const newValue =
        !currentlyOn;

    packs.forEach(pack => {

        pack.pageLoad =
            newValue;

    });

    WNC.database.save(db);

    console.log(
        "[WNC] Page Load:",
        newValue ? "ON" : "OFF"
    );

}


// ============================================================
// MENU HELPER
// ============================================================

function addMenu(name, action){

    GM_registerMenuCommand(
        name,
        action
    );

}


// ============================================================
// PRIMARY UI MENUS
// ============================================================

addMenu(
    "WNC - Editor",
    () => {

        if(
            WNC.editor &&
            WNC.editor.open
        ){

            WNC.editor.open();

        }

    }
);


addMenu(
    "WNC - Scanner",
    () => {

        if(
            WNC.scanner &&
            WNC.scanner.open
        ){

            WNC.scanner.open();

        }

    }
);


addMenu(
    "WNC - Tools",
    () => {

        openTools();

    }
);


// ============================================================
// ACTIONS
// ============================================================

addMenu(
    "WNC - Apply",
    () => {

        apply();

    }
);


addMenu(
    "WNC - Undo",
    () => {

        undo();

    }
);


addMenu(
    "WNC - Auto On/Off",
    () => {

        toggleAuto();

    }
);


addMenu(
    "WNC - Page Load On/Off",
    () => {

        togglePageLoad();

    }
);


// ============================================================
// QUICK IMPORT / EXPORT
// ============================================================

addMenu(
    "WNC - Import FoxReplace",
    () => {

        importFoxReplace();

    }
);


addMenu(
    "WNC - Import WNC Database",
    () => {

        importWNCDatabase();

    }
);


addMenu(
    "WNC - Export WNC Database",
    () => {

        exportDatabase();

    }
);


// ============================================================
// VERSION
// ============================================================

WNC.version = WNC_VERSION;


// ============================================================
// STARTUP
// ============================================================

console.log(
    "[WNC] Loaded version",
    WNC_VERSION
);

console.log(
    "[WNC] Menu commands ready:"
);

console.log(
    "  Editor"
);

console.log(
    "  Scanner"
);

console.log(
    "  Tools"
);

console.log(
    "  Apply"
);

console.log(
    "  Undo"
);

console.log(
    "  Auto On/Off"
);

console.log(
    "  Page Load On/Off"
);


// ============================================================
// COMPLETE
// ============================================================

})();


})();
