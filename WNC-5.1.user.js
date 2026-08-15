// ==UserScript==
// @name         WebNovel Cleaner 5.1
// @namespace    https://github.com/GoroFourArms
// @version      5.1.1
// @description  WebNovel Cleaner - replacement engine, scanner, editor and FoxReplace-compatible database
// @author       GoroFourArms
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        unsafeWindow
// @updateURL    https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC-5.1.user.js
// @downloadURL  https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/WNC-5.1.user.js
// @run-at       document-idle
// ==/UserScript==

(() => {

"use strict";

const WNC_VERSION = "5.1.0";
const DB_KEY = "WNC_DATABASE_V5";


// ============================================================
// WNC CORE
// ============================================================

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

    ui: {}

};


// Make the API available to the other WNC sections.

unsaeWindow.WNC = WNC;
window.WNC = WNC;


// ============================================================
// DATABASE
// ============================================================

const DEAULT_DATABASE = {

    version: WNC_VERSION,

    packs: []

};


// ------------------------------------------------------------
// Utility
// ------------------------------------------------------------

function clone(value) {

    return JSON.parse(
        JSON.stringify(value)
    );

}


function today() {

    return new Date()
        .toISOString()
        .slice(0, 10);

}


// ------------------------------------------------------------
// Rule migration
// ------------------------------------------------------------

function migrateRule(rule, index) {

    if (!rule || typeof rule !== "object") {
        rule = {};
    }

    if (rule.order === undefined)
        rule.order = index + 1;

    if (rule.find === undefined)
        rule.find = "";

    if (rule.replace === undefined)
        rule.replace = "";

    if (!rule.type)
        rule.type = "whole";

    if (rule.caseSensitive === undefined)
        rule.caseSensitive = false;

    if (rule.enabled === undefined)
        rule.enabled = true;

    if (rule.lastUsed === undefined)
        rule.lastUsed = null;

    if (rule.htmlMode === undefined)
        rule.htmlMode = "none";

    // Scanner/editor fields
    if (rule.template === undefined)
        rule.template = "";

    if (rule.generatedRegex === undefined)
        rule.generatedRegex = "";

    return rule;
}

// ------------------------------------------------------------
// Pack migration
// ------------------------------------------------------------

function migratePack(pack, index) {

    if (!pack || typeof pack !== "object") {

        pack = {};

    }


    if (!pack.name)
        pack.name = `Pack ${index + 1}`;


    if (!Array.isArray(pack.urls))
        pack.urls = [];


    if (!Array.isArray(pack.rules))
        pack.rules = [];


    if (pack.order === undefined)
        pack.order = index + 1;


    if (pack.enabled === undefined)
        pack.enabled = true;


    if (pack.pageLoad === undefined)
        pack.pageLoad = true;


    if (pack.auto === undefined)
        pack.auto = true;


    pack.rules =
        pack.rules.map(
            migrateRule
        );


    return pack;

}


// ------------------------------------------------------------
// Database migration
// ------------------------------------------------------------

function migrateDatabase(db) {

    if (!db || typeof db !== "object") {

        db = clone(
            DEFAULT_DATABASE
        );

    }


    if (!Array.isArray(db.packs))
        db.packs = [];


    db.packs =
        db.packs.map(
            migratePack
        );


    db.version =
        WNC_VERSION;


    return db;

}


// ------------------------------------------------------------
// Load
// ------------------------------------------------------------

function loadDatabase() {

    let raw =
        GM_getValue(DB_KEY);


    if (!raw) {

        const db =
            clone(DEFAULT_DATABASE);

        saveDatabase(db);

        return db;

    }


    let db;


    try {

        db =
            typeof raw === "string"
            ?
            JSON.parse(raw)
            :
            raw;

    }

    catch (error) {

        console.error(
            "[WNC] Database could not be parsed:",
            error
        );

        db =
            clone(DEFAULT_DATABASE);

    }


    db =
        migrateDatabase(db);


    saveDatabase(db);


    return db;

}


// ------------------------------------------------------------
// Save
// ------------------------------------------------------------

function saveDatabase(db) {

    db =
        migrateDatabase(
            clone(db)
        );


    GM_setValue(
        DB_KEY,
        JSON.stringify(
            db,
            null,
            2
        )
    );


    return db;

}


// ------------------------------------------------------------
// Orders
// ------------------------------------------------------------

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

                max =
                    pack.order;

            }

        }
    );


    return max + 1;

}


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

                max =
                    rule.order;

            }

        }
    );


    return max + 1;

}


// ============================================================
// PACK OPERATIONS
// ============================================================

function createPack(name) {

    name =
        String(name || "")
        .trim();


    if (!name)
        return null;


    const db =
        loadDatabase();


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


    db.packs.push(pack);


    saveDatabase(db);


    return pack;

}


function getPacks() {

    return loadDatabase()
        .packs
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
            p =>
                p.name === name
        );


    if (!pack)
        return false;


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


    const before =
        db.packs.length;


    db.packs =
        db.packs.filter(
            pack =>
                pack.name !== name
        );


    saveDatabase(db);


    return (
        db.packs.length !== before
    );

}


// ============================================================
// RULE OPERATIONS
// ============================================================

function addRule(packName, data = {}) {

    const db =
        loadDatabase();


    const pack =
        db.packs.find(
            p =>
                p.name === packName
        );


    if (!pack)
        return null;


    const rule = {

        order:
            nextRuleOrder(pack),

        find:
            String(
                data.find || ""
            ),

        replace:
            String(
                data.replace || ""
            ),

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


    pack.rules.push(rule);


    saveDatabase(db);


    return rule;

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
            p =>
                p.name === packName
        );


    if (!pack)
        return false;


    const rule =
        pack.rules.find(
            r =>
                r.order === order
        );


    if (!rule)
        return false;


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
            p =>
                p.name === packName
        );


    if (!pack)
        return false;


    const before =
        pack.rules.length;


    pack.rules =
        pack.rules.filter(
            r =>
                r.order !== order
        );


    saveDatabase(db);


    return (
        pack.rules.length !== before
    );

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


// ============================================================
// URL MATCHING
// ============================================================

function matchSite(
    pattern,
    url
) {

    if (!pattern)
        return true;


    pattern =
        String(pattern)
        .toLowerCase();


    url =
        String(url)
        .toLowerCase();


    if (pattern.includes("*")) {

        const escaped =
            pattern.replace(
                /[.+?^${}()|[\]\\]/g,
                "\\$&"
            );


        const regex =
            escaped.replace(
                /\*/g,
                ".*"
            );


        return new RegExp(
            "^" +
            regex +
            "$"
        ).test(url);

    }


    return url.includes(
        pattern
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
                    site =>
                        matchSite(
                            site,
                            url
                        )
                );

            }
        );

}


// ============================================================
// PUBLIC DATABASE API
// ============================================================

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

    update:
        updateRule,

    remove:
        removeRule,

    touch:
        touchRule

};


console.log(
    `[WNC] ${WNC_VERSION} Part 1 loaded`
);

})();
// ============================================================
// WNC 5.1 - PART 2
// SECTION: Replacement Engine + Undo
// ============================================================

(() => {

"use strict";

const WNC = unsafeWindow.WNC;


// ============================================================
// INTERNAL STATE
// ============================================================

let undoStack = [];

let applying = false;

const regexCache = new Map();


// ============================================================
// REGEX UTILITIES
// ============================================================

function escapeRegex(text) {

    return String(text)
        .replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&"
        );

}


// ------------------------------------------------------------
// Build a rule pattern
// ------------------------------------------------------------

function buildPattern(rule) {

    const cacheKey =
        JSON.stringify({
            find: rule.find,
            type: rule.type,
            caseSensitive: rule.caseSensitive
        });


    if (regexCache.has(cacheKey)) {

        return regexCache.get(
            cacheKey
        );

    }


    let pattern = null;


    const flags =
        rule.caseSensitive
            ? "g"
            : "gi";


    try {

        // ----------------------------------------------------
        // Regular expression
        // ----------------------------------------------------

        if (rule.type === "regex") {

            pattern =
                new RegExp(
                    rule.find,
                    flags
                );

        }


        // ----------------------------------------------------
        // Plain text anywhere
        // ----------------------------------------------------

        else if (rule.type === "text") {

            pattern =
                new RegExp(
                    escapeRegex(
                        rule.find
                    ),
                    flags
                );

        }


        // ----------------------------------------------------
        // Whole-word replacement
        // ----------------------------------------------------

        else {

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


// ============================================================
// REPLACEMENT
// ============================================================

function replaceValue(
    text,
    rule
) {

    if (!rule)
        return text;


    if (!rule.find)
        return text;


    if (rule.enabled === false)
        return text;


    const pattern =
        buildPattern(rule);


    if (!pattern)
        return text;


    try {

        return String(text)
            .replace(
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


// ============================================================
// TEXT NODE FILTERING
// ============================================================

function shouldIgnoreTextNode(node) {

    if (!node)
        return true;


    if (node.nodeType !== Node.TEXT_NODE)
        return true;


    const parent =
        node.parentElement;


    if (!parent)
        return true;


    const ignoredTags = new Set([

        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "TEXTAREA",
        "INPUT",
        "OPTION",
        "SELECT",
        "CODE",
        "PRE"

    ]);


    if (
        ignoredTags.has(
            parent.tagName
        )
    ) {

        return true;

    }


    if (!node.nodeValue.trim())
        return true;


    return false;

}


// ============================================================
// TEXT NODES
// ============================================================

function getTextNodes(root = document.body) {

    const nodes = [];


    if (!root)
        return nodes;


    const walker =
        document.createTreeWalker(

            root,

            NodeFilter.SHOW_TEXT

        );


    while (
        walker.nextNode()
    ) {

        const node =
            walker.currentNode;


        if (
            shouldIgnoreTextNode(
                node
            )
        ) {

            continue;

        }


        nodes.push(node);

    }


    return nodes;

}


// ============================================================
// ACTIVE RULES
// ============================================================

function getActiveRules(
    options = {}
) {

    const {

        respectPageLoad = true

    } = options;


    const url =
        location.hostname;


    const packs =
        WNC.packs.getMatched(
            url
        );


    const rules = [];


    packs.forEach(
        pack => {

            if (
                pack.enabled === false
            ) {

                return;

            }


            if (
                respectPageLoad &&
                pack.pageLoad === false
            ) {

                return;

            }


            const sortedRules =
                [...pack.rules]
                .filter(
                    rule =>
                        rule.enabled !== false
                )
                .sort(
                    (a, b) =>
                        a.order - b.order
                );


            sortedRules.forEach(
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


// ============================================================
// APPLY TO ONE TEXT NODE
// ============================================================

function applyToTextNode(
    node,
    rules
) {

    if (
        shouldIgnoreTextNode(
            node
        )
    ) {

        return null;

    }


    const before =
        node.nodeValue;


    let after =
        before;


    const changedRules = [];


    rules.forEach(
        item => {

            const result =
                replaceValue(
                    after,
                    item.rule
                );


            if (
                result !== after
            ) {

                changedRules.push(
                    item
                );

            }


            after = result;

        }
    );


    if (
        after === before
    ) {

        return null;

    }


    return {

        node,

        oldValue:
            before,

        newValue:
            after,

        rules:
            changedRules

    };

}


// ============================================================
// APPLY
// ============================================================

function apply() {

    if (applying)
        return 0;


    applying = true;


    undoStack = [];


    let changes = 0;


    try {

        const rules =
            getActiveRules();


        if (!rules.length) {

            return 0;

        }


        const nodes =
            getTextNodes();


        nodes.forEach(
            node => {

                const change =
                    applyToTextNode(
                        node,
                        rules
                    );


                if (!change)
                    return;


                node.nodeValue =
                    change.newValue;


                undoStack.push(
                    change
                );


                changes++;


                // --------------------------------------------
                // Update last-used date
                // --------------------------------------------

                const touched =
                    new Set();


                change.rules.forEach(
                    item => {

                        const key =
                            item.pack.name +
                            "\u0000" +
                            item.rule.order;


                        if (
                            touched.has(key)
                        ) {

                            return;

                        }


                        touched.add(key);


                        WNC.rules.touch(
                            item.pack.name,
                            item.rule.order
                        );

                    }
                );

            }
        );

    }

    finally {

        applying = false;

    }


    return changes;

}


// ============================================================
// UNDO
// ============================================================

function undo() {

    if (!undoStack.length)
        return 0;


    let restored = 0;


    // Reverse order is important when
    // multiple nodes were changed.

    [...undoStack]
        .reverse()
        .forEach(
            change => {

                if (!change.node)
                    return;


                // The node may have been removed
                // by the page itself.

                if (
                    !change.node.isConnected
                ) {

                    return;

                }


                change.node.nodeValue =
                    change.oldValue;


                restored++;

            }
        );


    undoStack = [];


    return restored;

}


// ============================================================
// CLEAR UNDO
// ============================================================

function clearUndo() {

    undoStack = [];

}


// ============================================================
// CHECK WHETHER UNDO IS AVAILABLE
// ============================================================

function canUndo() {

    return (
        undoStack.length > 0
    );

}


// ============================================================
// APPLY A SINGLE RULE TO TEXT
// ============================================================

function replaceSingle(
    text,
    rule
) {

    return replaceValue(
        text,
        rule
    );

}


// ============================================================
// TEST A RULE
// ============================================================

function testRule(
    text,
    rule
) {

    const result =
        replaceValue(
            text,
            rule
        );


    return {

        changed:
            result !== text,

        before:
            text,

        after:
            result

    };

}


// ============================================================
// CLEAR REGEX CACHE
// ============================================================

function clearRegexCache() {

    regexCache.clear();

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.replace = {

    apply,

    undo,

    clearUndo,

    canUndo,

    replaceValue:
        replaceSingle,

    testRule,

    getRules:
        getActiveRules,

    getTextNodes,

    clearRegexCache

};


// ============================================================
// DIAGNOSTIC MESSAGE
// ============================================================

console.log(
    "[WNC] 5.1 Part 2 - Replacement Engine loaded"
);


})();
// ============================================================
// WNC 5.1 - PART 3
// SECTION: FoxReplace Import / Export
// ============================================================

(() => {

"use strict";

const WNC = unsafeWindow.WNC;


// ============================================================
// FOXREPLACE TYPE CONVERSION
// ============================================================

function foxReplaceTypeToWNC(type) {

    switch (type) {

        case "regexp":
        case "regex":
            return "regex";

        case "text":
            return "text";

        case "whole":
        default:
            return "whole";

    }

}


// ============================================================
// WNC TYPE TO FOXREPLACE
// ============================================================

function wncTypeToFoxReplace(type) {

    switch (type) {

        case "regex":
            return "regexp";

        case "text":
            return "text";

        case "whole":
        default:
            return "whole";

    }

}


// ============================================================
// CONVERT ONE FOXREPLACE RULE
// ============================================================

function convertRule(
    substitution,
    index
) {

    substitution =
        substitution || {};


    return {

        order:
            index + 1,

        find:
            String(
                substitution.input || ""
            ),

        replace:
            String(
                substitution.output || ""
            ),

        type:
            foxReplaceTypeToWNC(
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


// ============================================================
// CONVERT ONE FOXREPLACE GROUP
// ============================================================

function convertPack(
    group,
    index
) {

    group =
        group || {};


    const substitutions =
        Array.isArray(
            group.substitutions
        )
            ? group.substitutions
            : [];


    return {

        name:
            String(
                group.name ||
                `Imported Pack ${index + 1}`
            ),

        order:
            index + 1,

        enabled:
            group.enabled !== false,

        pageLoad: true,

        auto: true,

        urls:
            Array.isArray(group.urls)
                ? [...group.urls]
                : [],

        rules:
            substitutions.map(
                convertRule
            )

    };

}


// ============================================================
// VALIDATE FOXREPLACE DATA
// ============================================================

function isFoxReplaceData(
    data
) {

    return (
        data &&
        typeof data === "object" &&
        Array.isArray(data.groups)
    );

}


// ============================================================
// CONVERT FOXREPLACE DATABASE
// ============================================================

function convertFoxReplace(
    data
) {

    if (
        !isFoxReplaceData(
            data
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


// ============================================================
// MERGE FOXREPLACE
// ============================================================

function mergeFoxReplace(
    data
) {

    const converted =
        convertFoxReplace(
            data
        );


    if (!converted)
        return null;


    const db =
        WNC.database.load();


    let addedPacks = 0;

    let addedRules = 0;


    converted.packs.forEach(
        importedPack => {

            // ----------------------------------------------
            // Find existing pack by name.
            //
            // Rules are added to that pack rather than
            // creating another pack with the same name.
            // ----------------------------------------------

            let pack =
                db.packs.find(
                    existing =>
                        existing.name ===
                        importedPack.name
                );


            if (!pack) {

                pack =
                    importedPack;


                pack.order =
                    nextPackOrderForDatabase(
                        db
                    );


                db.packs.push(
                    pack
                );


                addedPacks++;


                return;

            }


            // ----------------------------------------------
            // Existing pack
            // ----------------------------------------------

            importedPack.rules.forEach(
                importedRule => {

                    importedRule.order =
                        nextRuleOrderForDatabase(
                            pack
                        );


                    pack.rules.push(
                        importedRule
                    );


                    addedRules++;

                }
            );

        }
    );


    WNC.database.save(
        db
    );


    return {

        packs:
            converted.packs.length,

        addedPacks,

        addedRules

    };

}


// ============================================================
// REPLACE DATABASE WITH FOXREPLACE
// ============================================================

function replaceWithFoxReplace(
    data
) {

    const converted =
        convertFoxReplace(
            data
        );


    if (!converted)
        return null;


    WNC.database.save(
        converted
    );


    return {

        packs:
            converted.packs.length,

        rules:
            converted.packs.reduce(
                (total, pack) =>
                    total +
                    pack.rules.length,
                0
            )

    };

}


// ============================================================
// ORDER HELPERS
//
// These are deliberately local to Part 3.
// The database remains the owner of its data.
// ============================================================

function nextPackOrderForDatabase(
    db
) {

    let max = 0;


    db.packs.forEach(
        pack => {

            const order =
                Number(
                    pack.order
                );


            if (
                Number.isFinite(order) &&
                order > max
            ) {

                max = order;

            }

        }
    );


    return max + 1;

}


function nextRuleOrderForDatabase(
    pack
) {

    let max = 0;


    pack.rules.forEach(
        rule => {

            const order =
                Number(
                    rule.order
                );


            if (
                Number.isFinite(order) &&
                order > max
            ) {

                max = order;

            }

        }
    );


    return max + 1;

}


// ============================================================
// EXPORT WNC DATABASE AS WNC JSON
// ============================================================

function exportWNC() {

    return WNC.database.load();

}


// ============================================================
// EXPORT AS FOXREPLACE JSON
// ============================================================

function exportFoxReplace() {

    const db =
        WNC.database.load();


    return {

        groups:
            db.packs.map(
                pack => ({

                    name:
                        pack.name,

                    enabled:
                        pack.enabled !== false,

                    urls:
                        Array.isArray(
                            pack.urls
                        )
                            ? [...pack.urls]
                            : [],

                    substitutions:
                        pack.rules.map(
                            rule => ({

                                input:
                                    rule.find,

                                output:
                                    rule.replace,

                                inputType:
                                    wncTypeToFoxReplace(
                                        rule.type
                                    ),

                                caseSensitive:
                                    rule.caseSensitive === true

                            })
                        )

                })
            )

    };

}


// ============================================================
// DOWNLOAD JSON
// ============================================================

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


    setTimeout(
        () =>
            URL.revokeObjectURL(
                url
            ),
        1000
    );

}


// ============================================================
// EXPORT WNC BACKUP FILE
// ============================================================

function downloadWNCBackup() {

    downloadJSON(
        exportWNC(),
        "WNC-5.1-backup.json"
    );

}


// ============================================================
// EXPORT FOXREPLACE FILE
// ============================================================

function downloadFoxReplace() {

    downloadJSON(
        exportFoxReplace(),
        "WNC-FoxReplace-export.json"
    );

}


// ============================================================
// READ JSON FILE
// ============================================================

function readJSONFile(
    file
) {

    return new Promise(
        (resolve, reject) => {

            const reader =
                new FileReader();


            reader.onload =
                () => {

                    try {

                        const data =
                            JSON.parse(
                                reader.result
                            );


                        resolve(data);

                    }

                    catch (error) {

                        reject(
                            new Error(
                                "Invalid JSON file."
                            )
                        );

                    }

                };


            reader.onerror =
                () => {

                    reject(
                        new Error(
                            "Could not read file."
                        )
                    );

                };


            reader.readAsText(
                file
            );

        }
    );

}


// ============================================================
// OPEN FILE PICKER
// ============================================================

function chooseJSONFile(
    callback
) {

    const input =
        document.createElement(
            "input"
        );


    input.type =
        "file";


    input.accept =
        ".json,application/json";


    input.onchange =
        async () => {

            const file =
                input.files?.[0];


            if (!file)
                return;


            try {

                const data =
                    await readJSONFile(
                        file
                    );


                callback(
                    data
                );

            }

            catch (error) {

                console.error(
                    "[WNC] JSON import failed:",
                    error
                );


                alert(
                    error.message
                );

            }

        };


    input.click();

}


// ============================================================
// OPEN FOXREPLACE IMPORT
// ============================================================

function openFoxReplaceImport(
    mode = "merge"
) {

    chooseJSONFile(
        data => {

            if (
                !isFoxReplaceData(
                    data
                )
            ) {

                alert(
                    "This does not appear to be a FoxReplace JSON file."
                );


                return;

            }


            if (mode === "replace") {

                const confirmed =
                    confirm(
                        "Replace the current WNC database with this FoxReplace database?"
                    );


                if (!confirmed)
                    return;


                const result =
                    replaceWithFoxReplace(
                        data
                    );


                if (result) {

                    alert(
                        "FoxReplace database imported.\n\n" +
                        "Packs: " +
                        result.packs +
                        "\nRules: " +
                        result.rules
                    );

                }


                return;

            }


            const result =
                mergeFoxReplace(
                    data
                );


            if (result) {

                alert(
                    "FoxReplace packs imported.\n\n" +
                    "Imported packs: " +
                    result.packs +
                    "\nNew packs: " +
                    result.addedPacks +
                    "\nRules added: " +
                    result.addedRules
                );

            }

        }
    );

}


// ============================================================
// PUBLIC FOXREPLACE API
// ============================================================

WNC.foxReplace = {

    convert:
        convertFoxReplace,

    import:
        mergeFoxReplace,

    merge:
        mergeFoxReplace,

    replace:
        replaceWithFoxReplace,

    openImport:
        () =>
            openFoxReplaceImport(
                "merge"
            ),

    openReplace:
        () =>
            openFoxReplaceImport(
                "replace"
            ),

    export:
        exportFoxReplace,

    download:
        downloadFoxReplace,

    downloadWNC:
        downloadWNCBackup

};


// ============================================================
// DIAGNOSTIC
// ============================================================

console.log(
    "[WNC] 5.1 Part 3 - FoxReplace compatibility loaded"
);


})();
// ============================================================
// WNC 5.1 - PART 4
// SECTION: Page Cleaner + Auto Observer
// ============================================================

(() => {

"use strict";

const WNC = unsafeWindow.WNC;


// ============================================================
// STATE
// ============================================================

let observer = null;

let pageLoadRunning = false;

let autoRunning = false;


// ============================================================
// IGNORE RULES
// ============================================================

const IGNORED_TAGS = new Set([

    "SCRIPT",
    "STYLE",
    "NOSCRIPT",
    "INPUT",
    "TEXTAREA",
    "SELECT",
    "OPTION",
    "CODE",
    "PRE"

]);


function shouldIgnoreNode(node) {

    if (!node)
        return true;


    if (
        node.nodeType !==
        Node.TEXT_NODE
    ) {

        return true;

    }


    const parent =
        node.parentElement;


    if (!parent)
        return true;


    if (
        IGNORED_TAGS.has(
            parent.tagName
        )
    ) {

        return true;

    }


    if (!node.nodeValue)
        return true;


    if (!node.nodeValue.trim())
        return true;


    return false;

}


// ============================================================
// FIND TEXT NODES
// ============================================================

function collectTextNodes(
    root
) {

    const nodes = [];


    if (!root)
        return nodes;


    // A directly supplied text node.

    if (
        root.nodeType ===
        Node.TEXT_NODE
    ) {

        if (
            !shouldIgnoreNode(
                root
            )
        ) {

            nodes.push(root);

        }


        return nodes;

    }


    if (
        !root.ownerDocument
    ) {

        return nodes;

    }


    const walker =
        document.createTreeWalker(

            root,

            NodeFilter.SHOW_TEXT

        );


    while (
        walker.nextNode()
    ) {

        const node =
            walker.currentNode;


        if (
            shouldIgnoreNode(
                node
            )
        ) {

            continue;

        }


        nodes.push(node);

    }


    return nodes;

}


// ============================================================
// GET PACKS MATCHED TO CURRENT PAGE
// ============================================================

function getMatchedPacks() {

    return WNC.packs.getMatched(
        location.hostname
    );

}


// ============================================================
// GET RULES FOR A SPECIFIC PACK
// ============================================================

function getPackRules(
    pack
) {

    if (!pack)
        return [];


    if (
        pack.enabled === false
    ) {

        return [];

    }


    return [...pack.rules]
        .filter(
            rule =>
                rule.enabled !== false &&
                rule.find
        )
        .sort(
            (a, b) =>
                a.order - b.order
        );

}


// ============================================================
// APPLY PACKS TO ONE TEXT NODE
// ============================================================

function cleanTextNode(
    node,
    packs
) {

    if (
        shouldIgnoreNode(
            node
        )
    ) {

        return false;

    }


    if (!packs.length)
        return false;


    const before =
        node.nodeValue;


    let after =
        before;


    const changedRules = [];


    packs.forEach(
        pack => {

            const rules =
                getPackRules(
                    pack
                );


            rules.forEach(
                rule => {

                    const result =
                        WNC.replace.replaceValue(
                            after,
                            rule
                        );


                    if (
                        result !== after
                    ) {

                        changedRules.push({

                            pack,
                            rule

                        });

                    }


                    after = result;

                }
            );

        }
    );


    if (
        after === before
    ) {

        return false;

    }


    node.nodeValue =
        after;


    // --------------------------------------------------------
    // Record usage.
    // --------------------------------------------------------

    const touched =
        new Set();


    changedRules.forEach(
        item => {

            const key =
                item.pack.name +
                "\u0000" +
                item.rule.order;


            if (
                touched.has(key)
            ) {

                return;

            }


            touched.add(key);


            WNC.rules.touch(
                item.pack.name,
                item.rule.order
            );

        }
    );


    return true;

}


// ============================================================
// CLEAN A DOM ROOT
// ============================================================

function cleanRoot(
    root,
    packs
) {

    if (!root)
        return 0;


    if (!packs.length)
        return 0;


    const nodes =
        collectTextNodes(
            root
        );


    let changed = 0;


    nodes.forEach(
        node => {

            if (
                cleanTextNode(
                    node,
                    packs
                )
            ) {

                changed++;

            }

        }
    );


    return changed;

}


// ============================================================
// PAGE LOAD PACKS
// ============================================================

function getPageLoadPacks() {

    return getMatchedPacks()
        .filter(
            pack =>
                pack.enabled !== false &&
                pack.pageLoad !== false
        );

}


// ============================================================
// AUTO PACKS
// ============================================================

function getAutoPacks() {

    return getMatchedPacks()
        .filter(
            pack =>
                pack.enabled !== false &&
                pack.auto !== false
        );

}


// ============================================================
// CLEAN PAGE ON LOAD
// ============================================================

function cleanPage() {

    if (pageLoadRunning)
        return 0;


    if (!document.body)
        return 0;


    pageLoadRunning = true;


    let changed = 0;


    try {

        const packs =
            getPageLoadPacks();


        changed =
            cleanRoot(
                document.body,
                packs
            );

    }

    finally {

        pageLoadRunning = false;

    }


    return changed;

}


// ============================================================
// CLEAN ONE ADDED NODE
// ============================================================

function cleanAddedNode(
    node
) {

    if (!node)
        return 0;


    if (autoRunning)
        return 0;


    const packs =
        getAutoPacks();


    if (!packs.length)
        return 0;


    autoRunning = true;


    let changed = 0;


    try {

        changed =
            cleanRoot(
                node,
                packs
            );

    }

    finally {

        autoRunning = false;

    }


    return changed;

}


// ============================================================
// START MUTATION OBSERVER
// ============================================================

function startObserver() {

    if (observer)
        return;


    if (!document.body)
        return;


    observer =
        new MutationObserver(
            mutations => {

                if (autoRunning)
                    return;


                mutations.forEach(
                    mutation => {

                        mutation.addedNodes
                            .forEach(
                                node => {

                                    cleanAddedNode(
                                        node
                                    );

                                }
                            );

                    }
                );

            }
        );


    observer.observe(
        document.body,
        {

            childList: true,

            subtree: true

        }
    );


    console.log(
        "[WNC] Auto observer started"
    );

}


// ============================================================
// STOP MUTATION OBSERVER
// ============================================================

function stopObserver() {

    if (!observer)
        return;


    observer.disconnect();

    observer = null;


    console.log(
        "[WNC] Auto observer stopped"
    );

}


// ============================================================
// RESTART OBSERVER
// ============================================================

function restartObserver() {

    stopObserver();

    startObserver();

}


// ============================================================
// PAGE LOAD INITIALIZATION
// ============================================================

function initializePageLoad() {

    if (
        document.readyState ===
        "loading"
    ) {

        window.addEventListener(
            "load",
            () => {

                setTimeout(
                    () => {

                        cleanPage();

                        startObserver();

                    },
                    1000
                );

            },
            {
                once: true
            }
        );

    }

    else {

        setTimeout(
            () => {

                cleanPage();

                startObserver();

            },
            1000
        );

    }

}


// ============================================================
// MANUAL CLEAN ROOT
// ============================================================

function cleanElement(
    element
) {

    if (!element)
        return 0;


    const packs =
        getMatchedPacks();


    return cleanRoot(
        element,
        packs
    );

}


// ============================================================
// STATUS
// ============================================================

function getStatus() {

    return {

        observerRunning:
            observer !== null,

        pageLoadRunning:
            pageLoadRunning,

        autoRunning:
            autoRunning

    };

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.cleaner = {

    cleanPage,

    cleanElement,

    start:
        startObserver,

    stop:
        stopObserver,

    restart:
        restartObserver,

    status:
        getStatus

};


// ============================================================
// INITIALIZE
// ============================================================

initializePageLoad();


console.log(
    "[WNC] 5.1 Part 4 - Cleaner + Auto Observer loaded"
);


})();
// ============================================================
// WNC v5.1 - PART 5/7
// SECTION: Editor UI
// ============================================================

(function(){

"use strict";

const WNC = unsafeWindow.WNC;

let panel = null;
let currentPack = null;


// ============================================================
// HELPERS
// ============================================================

function button(text, action){

    const b = document.createElement("button");

    b.textContent = text;
    b.onclick = action;

    return b;

}


function checkbox(value, change){

    const input = document.createElement("input");

    input.type = "checkbox";
    input.checked = value !== false;

    input.onchange = () => {
        change(input.checked);
    };

    return input;

}


function cell(value){

    const td = document.createElement("td");

    td.appendChild(value);

    return td;

}


// ============================================================
// PANEL
// ============================================================

function createPanel(title){

    if(panel){
        panel.remove();
        panel = null;
    }

    panel = document.createElement("div");

    panel.id = "wnc-editor-panel";

    panel.innerHTML = `
        <div class="wnc-panel-header">
            <b>${title}</b>
            <button id="wnc-close">X</button>
        </div>

        <div id="wnc-editor-content"></div>
    `;

    document.body.appendChild(panel);

    panel.querySelector("#wnc-close").onclick = () => {
        panel.remove();
        panel = null;
    };

    return panel.querySelector("#wnc-editor-content");
}


// ============================================================
// OPEN EDITOR
// ============================================================

function openEditor(){

    if(panel){
        panel.remove();
        panel = null;
    }

    const content = createPanel("WNC Editor");

    renderPacks(content);
}


// ============================================================
// PACK LIST
// ============================================================

function renderPacks(content){

    content.innerHTML = "";


    const toolbar = document.createElement("div");

    toolbar.className = "wnc-toolbar";


    toolbar.appendChild(
        button(
            "New Pack",
            () => {

                const name = prompt("Pack name?");

                if(!name || !name.trim())
                    return;

                WNC.packs.create(name.trim());

                renderPacks(content);

            }
        )
    );


    content.appendChild(toolbar);


    const table = document.createElement("table");

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


    const tbody = table.querySelector("tbody");


    WNC.packs.getAll().forEach(pack => {

        const row = document.createElement("tr");


        // Enabled

        row.appendChild(
            cell(
                checkbox(
                    pack.enabled,
                    value => {

                        WNC.packs.update(
                            pack.name,
                            {
                                enabled: value
                            }
                        );

                    }
                )
            )
        );


        // Page Load

        row.appendChild(
            cell(
                checkbox(
                    pack.pageLoad,
                    value => {

                        WNC.packs.update(
                            pack.name,
                            {
                                pageLoad: value
                            }
                        );

                    }
                )
            )
        );


        // Auto

        row.appendChild(
            cell(
                checkbox(
                    pack.auto,
                    value => {

                        WNC.packs.update(
                            pack.name,
                            {
                                auto: value
                            }
                        );

                    }
                )
            )
        );


        // Pack name

        const nameCell = document.createElement("td");

        nameCell.textContent = pack.name;

        nameCell.style.cursor = "pointer";

        nameCell.onclick = () => {

            currentPack = pack.name;

            renderRules(content);

        };

        row.appendChild(nameCell);


        // Rule count

        const ruleCount = document.createElement("td");

        ruleCount.textContent = pack.rules.length;

        row.appendChild(ruleCount);


        // Delete

        row.appendChild(
            cell(
                button(
                    "Delete",
                    () => {

                        if(
                            !confirm(
                                `Delete pack "${pack.name}"?`
                            )
                        )
                            return;

                        WNC.packs.remove(pack.name);

                        renderPacks(content);

                    }
                )
            )
        );


        tbody.appendChild(row);

    });


    content.appendChild(table);

}


// ============================================================
// RULE EDITOR
// ============================================================

function renderRules(content){

    const pack = WNC.packs.get(currentPack);

    if(!pack){

        renderPacks(content);

        return;

    }


    content.innerHTML = "";


    const toolbar = document.createElement("div");

    toolbar.className = "wnc-toolbar";


    toolbar.appendChild(
        button(
            "< Back",
            () => renderPacks(content)
        )
    );


    toolbar.appendChild(
        button(
            "Add Rule",
            () => {

                addRule();

            }
        )
    );


    content.appendChild(toolbar);


    const title = document.createElement("h3");

    title.textContent = pack.name;

    content.appendChild(title);


    const table = document.createElement("table");

    table.innerHTML = `
        <thead>
            <tr>
                <th>Enabled</th>
                <th>Find</th>
                <th>Replace</th>
                <th>Type</th>
                <th>Case</th>
                <th>Delete</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;


    const tbody = table.querySelector("tbody");


    pack.rules
        .slice()
        .sort((a,b) => a.order - b.order)
        .forEach(rule => {

            tbody.appendChild(
                createRuleRow(
                    pack,
                    rule,
                    content
                )
            );

        });


    content.appendChild(table);

}


// ============================================================
// CREATE RULE ROW
// ============================================================

function createRuleRow(pack, rule, content){

    const row = document.createElement("tr");


    // Enabled

    row.appendChild(
        cell(
            checkbox(
                rule.enabled,
                value => {

                    WNC.rules.update(
                        pack.name,
                        rule.order,
                        {
                            enabled: value
                        }
                    );

                }
            )
        )
    );


    // Find

    const findInput =
        document.createElement("input");

    findInput.type = "text";
    findInput.value = rule.find;
    findInput.style.width = "220px";

    findInput.onchange = () => {

        WNC.rules.update(
            pack.name,
            rule.order,
            {
                find: findInput.value
            }
        );

    };

    row.appendChild(cell(findInput));


    // Replace

    const replaceInput =
        document.createElement("input");

    replaceInput.type = "text";
    replaceInput.value = rule.replace;
    replaceInput.style.width = "220px";

    replaceInput.onchange = () => {

        WNC.rules.update(
            pack.name,
            rule.order,
            {
                replace: replaceInput.value
            }
        );

    };

    row.appendChild(cell(replaceInput));


    // Type

    const typeSelect =
        document.createElement("select");

    ["whole", "text", "regex"].forEach(type => {

        const option =
            document.createElement("option");

        option.value = type;
        option.textContent = type;

        if(rule.type === type)
            option.selected = true;

        typeSelect.appendChild(option);

    });


    typeSelect.onchange = () => {

        WNC.rules.update(
            pack.name,
            rule.order,
            {
                type: typeSelect.value
            }
        );

    };


    row.appendChild(cell(typeSelect));


    // Case sensitive

    row.appendChild(
        cell(
            checkbox(
                rule.caseSensitive,
                value => {

                    WNC.rules.update(
                        pack.name,
                        rule.order,
                        {
                            caseSensitive: value
                        }
                    );

                }
            )
        )
    );


    // Delete

    row.appendChild(
        cell(
            button(
                "Delete",
                () => {

                    if(
                        !confirm(
                            "Delete this rule?"
                        )
                    )
                        return;

                    WNC.rules.remove(
                        pack.name,
                        rule.order
                    );

                    renderRules(content);

                }
            )
        )
    );


    return row;

}


// ============================================================
// ADD RULE
// ============================================================

function addRule(){

    const find = prompt("Find text:");

    if(find === null)
        return;


    const replace = prompt("Replace with:");

    if(replace === null)
        return;


    WNC.rules.add(
        currentPack,
        {
            find: find,
            replace: replace,
            type: "whole",
            caseSensitive: false,
            enabled: true
        }
    );


    const content =
        panel.querySelector(
            "#wnc-editor-content"
        );

    renderRules(content);

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.editor = {

    open: openEditor

};


console.log(
    "[WNC] v5.1 Editor loaded"
);


// ============================================================
// EDITOR CSS
// ============================================================

GM_addStyle(`

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


#wnc-editor-panel
.wnc-panel-header {

    display:flex;

    justify-content:space-between;

    align-items:center;

    margin-bottom:10px;

}


#wnc-editor-panel
.wnc-toolbar {

    display:flex;

    gap:6px;

    margin-bottom:10px;

}


#wnc-editor-panel table {

    width:100%;

    border-collapse:collapse;

}


#wnc-editor-panel th,
#wnc-editor-panel td {

    padding:6px;

    border:1px solid #555;

    vertical-align:middle;

    text-align:left;

}


#wnc-editor-panel input,
#wnc-editor-panel select,
#wnc-editor-panel button {

    box-sizing:border-box;

    font:13px Arial,sans-serif;

}


#wnc-editor-panel input,
#wnc-editor-panel select {

    padding:4px;

}


#wnc-editor-panel button {

    padding:5px 9px;

    cursor:pointer;

}


`);

})();// ============================================================
// WNC v5.1 - PART 6/7
// SECTION: Scanner + Inspector + Diagnostics
// ============================================================

(function(){

"use strict";

const WNC = unsafeWindow.WNC;

let toolPanel = null;
let scannerState = {
    selectedPack: "",
    template: "",
    results: []
};


// ============================================================
// GENERIC TOOL PANEL
// ============================================================

function createToolPanel(title){

    if(toolPanel){
        toolPanel.remove();
        toolPanel = null;
    }

    toolPanel = document.createElement("div");
    toolPanel.id = "wnc-tool-panel";

    toolPanel.innerHTML = `
        <div class="wnc-panel-header">
            <b>${title}</b>
            <button id="wnc-tool-close">X</button>
        </div>
        <div id="wnc-tool-content"></div>
    `;

    document.body.appendChild(toolPanel);

    toolPanel.querySelector("#wnc-tool-close").onclick = () => {
        toolPanel.remove();
        toolPanel = null;
    };

    return toolPanel.querySelector("#wnc-tool-content");
}


// ============================================================
// SCANNER HELPERS
// ============================================================

function scannerText(){

    return document.body?.innerText || "";

}


function escapeScannerRegex(text){

    return String(text)
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

}


function getMatchCount(text, rule){

    if(!rule || !rule.find)
        return 0;

    let regex;

    try {

        const flags =
            rule.caseSensitive
                ? "g"
                : "gi";

        if(rule.type === "regex"){

            regex = new RegExp(
                rule.find,
                flags
            );

        }
        else if(rule.type === "text"){

            regex = new RegExp(
                escapeScannerRegex(rule.find),
                flags
            );

        }
        else{

            regex = new RegExp(
                "(?<![\\w-])" +
                escapeScannerRegex(rule.find) +
                "(?![\\w-])",
                flags
            );

        }

    }
    catch(error){

        return 0;

    }

    let count = 0;

    for(const match of String(text).matchAll(regex)){

        count++;

        if(match[0] === "")
            regex.lastIndex++;

    }

    return count;

}


// ============================================================
// FIND EXISTING RULES
// ============================================================

function getScannerRules(){

    const rules = [];

    WNC.packs
        .getMatched(location.hostname)
        .forEach(pack => {

            if(pack.enabled === false)
                return;

            pack.rules
                .filter(rule =>
                    rule.enabled !== false &&
                    rule.find
                )
                .sort((a,b) =>
                    a.order - b.order
                )
                .forEach(rule => {

                    rules.push({
                        ruled: true,
                        pack: pack.name,
                        order: rule.order,
                        find: rule.find,
                        replace: rule.replace,
                        type: rule.type || "whole",
                        caseSensitive:
                            rule.caseSensitive === true,
                        rule
                    });

                });

        });

    return rules;

}


// ============================================================
// DISCOVER UNRULED PHRASES
// ============================================================

function discoverUnruled(text, rules){

    const ruledKeys = new Set();

    rules.forEach(item => {

        ruledKeys.add(
            item.find
                .trim()
                .toLocaleLowerCase()
        );

    });


    const counts = new Map();


    function addPhrase(value){

        value =
            String(value || "")
            .trim()
            .replace(/\s+/g, " ");

        if(!value)
            return;

        if(value.length < 2)
            return;

        const key =
            value.toLocaleLowerCase();

        if(ruledKeys.has(key))
            return;

        counts.set(
            key,
            {
                text: value,
                count:
                    (counts.get(key)?.count || 0) + 1
            }
        );

    }


    // --------------------------------------------------------
    // Korean / CJK runs
    // --------------------------------------------------------

    const cjkRuns =
        text.match(
            /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af]{2,}/g
        ) || [];

    cjkRuns.forEach(addPhrase);


    // --------------------------------------------------------
    // Capitalized / proper-name word groups
    // --------------------------------------------------------

    const words =
        text.match(
            /\b[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'-]*(?:\s+[A-ZÀ-ÖØ-Þ][A-Za-zÀ-ÖØ-öø-ÿ'-]*){1,3}\b/g
        ) || [];

    words.forEach(addPhrase);


    // --------------------------------------------------------
    // Hyphenated / apostrophe names
    // --------------------------------------------------------

    const names =
        text.match(
            /\b[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[-'][A-Za-zÀ-ÖØ-öø-ÿ]+)+\b/g
        ) || [];

    names.forEach(addPhrase);


    return [...counts.values()]
        .sort((a,b) =>
            b.count - a.count
        );

}


// ============================================================
// SCAN
// ============================================================

function scanPage(options = {}){

    const text =
        scannerText();

    const rules =
        getScannerRules();

    const results = [];


    // --------------------------------------------------------
    // Existing rules
    // --------------------------------------------------------

    rules.forEach(item => {

        const count =
            getMatchCount(
                text,
                item.rule
            );

        if(count <= 0)
            return;

        results.push({

            ruled: true,

            pack:
                item.pack,

            order:
                item.order,

            find:
                item.find,

            replace:
                item.replace,

            type:
                item.type,

            caseSensitive:
                item.caseSensitive,

            count,

            total:
                count,

            rule:
                item.rule

        });

    });


    // --------------------------------------------------------
    // Unruled discoveries
    // --------------------------------------------------------

    const discovered =
        discoverUnruled(
            text,
            rules
        );


    discovered.forEach(item => {

        results.push({

            ruled: false,

            pack: "",

            order: null,

            find:
                item.text,

            replace: "",

            type: "whole",

            caseSensitive: false,

            count:
                item.count,

            total:
                item.count,

            rule: null

        });

    });


    // --------------------------------------------------------
    // Highest count first
    // --------------------------------------------------------

    results.sort((a,b) => {

        if(b.count !== a.count)
            return b.count - a.count;

        if(a.ruled !== b.ruled)
            return a.ruled ? -1 : 1;

        return a.find.localeCompare(
            b.find
        );

    });


    return results;

}


// ============================================================
// PACK SEARCH
// ============================================================

function createPackSearch(){

    const wrap =
        document.createElement("div");

    wrap.className =
        "wnc-pack-search";


    const input =
        document.createElement("input");

    input.type = "text";
    input.placeholder = "Pack";
    input.value =
        scannerState.selectedPack;


    const list =
        document.createElement("div");

    list.className =
        "wnc-pack-results";


    function refresh(){

        list.innerHTML = "";

        const query =
            input.value
                .trim()
                .toLocaleLowerCase();


        WNC.packs
            .getAll()
            .filter(pack =>
                !query ||
                pack.name
                    .toLocaleLowerCase()
                    .includes(query)
            )
            .forEach(pack => {

                const button =
                    document.createElement("button");

                button.type = "button";
                button.textContent =
                    pack.name;


                button.onclick = () => {

                    scannerState.selectedPack =
                        pack.name;

                    input.value =
                        pack.name;

                    list.innerHTML = "";

                    renderScanner();

                };


                list.appendChild(button);

            });


        if(
            query &&
            !WNC.packs.get(query)
        ){

            const create =
                document.createElement("button");

            create.type = "button";

            create.textContent =
                "+ " + input.value;


            create.onclick = () => {

                const pack =
                    WNC.packs.create(
                        input.value.trim()
                    );

                if(!pack)
                    return;

                scannerState.selectedPack =
                    pack.name;

                input.value =
                    pack.name;

                list.innerHTML = "";

                renderScanner();

            };

            list.appendChild(create);

        }

    }


    input.onfocus = refresh;
    input.oninput = refresh;


    wrap.appendChild(input);
    wrap.appendChild(list);


    return wrap;

}


// ============================================================
// TYPE SWITCH
// ============================================================

function createTypeSwitch(
    value,
    callback
){

    const button =
        document.createElement("button");

    button.type = "button";
    button.className = "wnc-switch";

    const types = [
        "whole",
        "text",
        "regex"
    ];

    const labels = [
        "W",
        "T",
        "R"
    ];


    function render(){

        const index =
            Math.max(
                0,
                types.indexOf(value)
            );

        button.textContent =
            labels[index];

        button.title =
            types[index];

    }


    button.onclick = () => {

        let index =
            types.indexOf(value);

        index =
            (index + 1) %
            types.length;

        value =
            types[index];

        callback(value);

        render();

    };


    render();

    return button;

}


// ============================================================
// CASE SWITCH
// ============================================================

function createCaseSwitch(
    value,
    callback
){

    const button =
        document.createElement("button");

    button.type = "button";
    button.className = "wnc-switch";

    function render(){

        button.textContent =
            "C";

        button.dataset.on =
            value ? "1" : "0";

        button.title =
            value
                ? "Case sensitive"
                : "Case insensitive";

    }


    button.onclick = () => {

        value = !value;

        callback(value);

        render();

    };


    render();

    return button;

}


// ============================================================
// FIND COLLAPSE
// ============================================================

function createFindCell(
    value
){

    const cell =
        document.createElement("td");

    const wrap =
        document.createElement("div");

    wrap.className =
        "wnc-find";


    const toggle =
        document.createElement("button");

    toggle.type = "button";
    toggle.className =
        "wnc-find-toggle";

    toggle.textContent = "▶";


    const text =
        document.createElement("span");

    text.textContent =
        value;


    toggle.onclick = () => {

        const expanded =
            wrap.classList.toggle(
                "expanded"
            );

        toggle.textContent =
            expanded
                ? "▼"
                : "▶";

    };


    wrap.appendChild(toggle);
    wrap.appendChild(text);

    cell.appendChild(wrap);

    return cell;

}


// ============================================================
// TEMPLATE
// ============================================================

function createTemplateControl(){

    const wrap =
        document.createElement("div");

    wrap.className =
        "wnc-template-control";


    const input =
        document.createElement("input");

    input.type = "text";
    input.placeholder = "Te";


    input.value =
        scannerState.template;


    input.oninput = () => {

        scannerState.template =
            input.value;

    };


    const generate =
        document.createElement("button");

    generate.type = "button";
    generate.textContent = "G";
    generate.title =
        "Generate regex";


    generate.onclick = () => {

        const selected =
            scannerState.results.find(
                result =>
                    result._selected
            );


        if(!selected)
            return;


        if(!scannerState.template)
            return;


        const phrase =
            selected.find;


        const escaped =
            escapeScannerRegex(
                phrase
            );


        selected.replace =
            scannerState.template
                .replace(
                    /\{find\}/gi,
                    escaped
                )
                .replace(
                    /\{phrase\}/gi,
                    escaped
                );

        selected.type =
            "regex";

        selected._generated = true;

        renderScanner();

    };


    wrap.appendChild(input);
    wrap.appendChild(generate);

    return wrap;

}


// ============================================================
// APPLY NEW RULE
// ============================================================

function applyScannerRule(result){

    if(result.ruled)
        return;

    const packName =
        scannerState.selectedPack;

    if(!packName)
        return;


    if(!result.find)
        return;


    WNC.rules.add(
        packName,
        {
            find:
                result.find,

            replace:
                result.replace || "",

            type:
                result.type || "whole",

            caseSensitive:
                result.caseSensitive === true,

            enabled:
                true
        }
    );


    result.ruled = true;
    result.pack = packName;
    result._applied = true;

}


// ============================================================
// SCANNER RENDER
// ============================================================

function renderScanner(){

    if(!toolPanel)
        return;

    const content =
        toolPanel.querySelector(
            "#wnc-tool-content"
        );

    if(!content)
        return;


    content.innerHTML = "";


    // --------------------------------------------------------
    // Toolbar
    // --------------------------------------------------------

    const toolbar =
        document.createElement("div");

    toolbar.className =
        "wnc-scanner-toolbar";


    toolbar.appendChild(
        createPackSearch()
    );


    const template =
        createTemplateControl();

    toolbar.appendChild(
        template
    );


    const scanButton =
        document.createElement("button");

    scanButton.textContent =
        "Scan";


    scanButton.onclick = () => {

        scannerState.results =
            scanPage();

        renderScanner();

    };


    toolbar.appendChild(
        scanButton
    );


    content.appendChild(toolbar);


    // --------------------------------------------------------
    // No results
    // --------------------------------------------------------

    if(!scannerState.results.length){

        const empty =
            document.createElement("div");

        empty.textContent =
            "No scan results.";

        content.appendChild(empty);

        return;

    }


    // --------------------------------------------------------
    // Table
    // --------------------------------------------------------

    const table =
        document.createElement("table");

    table.className =
        "wnc-scanner-table";


    table.innerHTML = `
        <thead>
            <tr>
                <th>Pack</th>
                <th>Find</th>
                <th>Result</th>
                <th>Co</th>
                <th>C</th>
                <th>T</th>
                <th>Te</th>
                <th>A</th>
                <th>Del</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;


    const tbody =
        table.querySelector("tbody");


    scannerState.results
        .forEach(result => {

            const row =
                document.createElement("tr");


            if(!result.ruled)
                row.classList.add(
                    "wnc-unruled"
                );


            // ------------------------------------------------
            // Pack
            // ------------------------------------------------

            const packCell =
                document.createElement("td");

            packCell.textContent =
                result.pack ||
                "—";


            if(!result.ruled){

                packCell.title =
                    "New rules use the Pack selected in the top toolbar.";

            }


            row.appendChild(
                packCell
            );


            // ------------------------------------------------
            // Find
            // ------------------------------------------------

            row.appendChild(
                createFindCell(
                    result.find
                )
            );


            // ------------------------------------------------
            // Result
            // ------------------------------------------------

            const resultCell =
                document.createElement("td");

            const replaceInput =
                document.createElement("input");

            replaceInput.type =
                "text";

            replaceInput.value =
                result.replace || "";

            replaceInput.className =
                "wnc-result-input";


            replaceInput.oninput = () => {

                result.replace =
                    replaceInput.value;

            };


            resultCell.appendChild(
                replaceInput
            );

            row.appendChild(
                resultCell
            );


            // ------------------------------------------------
            // Count
            // ------------------------------------------------

            const countCell =
                document.createElement("td");

            countCell.textContent =
                `${result.count}/${result.total}`;

            row.appendChild(
                countCell
            );


            // ------------------------------------------------
            // Case
            // ------------------------------------------------

            const caseCell =
                document.createElement("td");

            caseCell.appendChild(
                createCaseSwitch(
                    result.caseSensitive,
                    value => {

                        result.caseSensitive =
                            value;

                    }
                )
            );

            row.appendChild(
                caseCell
            );


            // ------------------------------------------------
            // Type
            // ------------------------------------------------

            const typeCell =
                document.createElement("td");

            typeCell.appendChild(
                createTypeSwitch(
                    result.type,
                    value => {

                        result.type =
                            value;

                    }
                )
            );

            row.appendChild(
                typeCell
            );


            // ------------------------------------------------
            // Template
            // ------------------------------------------------

            const templateCell =
                document.createElement("td");

            const templateButton =
                document.createElement("button");

            templateButton.type =
                "button";

            templateButton.textContent =
                "Te";


            templateButton.onclick = () => {

                scannerState.template =
                    scannerState.template ||
                    "{find}";

                scannerState.results
                    .forEach(item => {

                        item._selected =
                            item === result;

                    });

                renderScanner();

            };


            templateCell.appendChild(
                templateButton
            );

            row.appendChild(
                templateCell
            );


            // ------------------------------------------------
            // Apply
            // ------------------------------------------------

            const applyCell =
                document.createElement("td");

            const applyButton =
                document.createElement("button");

            applyButton.type =
                "button";

            applyButton.textContent =
                "A";


            applyButton.disabled =
                result.ruled ||
                !scannerState.selectedPack;


            applyButton.title =
                result.ruled
                    ? "Existing rule"
                    : scannerState.selectedPack
                        ? `Add to ${scannerState.selectedPack}`
                        : "Select a Pack first";


            applyButton.onclick = () => {

                applyScannerRule(
                    result
                );

                scannerState.results =
                    scanPage();

                renderScanner();

            };


            applyCell.appendChild(
                applyButton
            );

            row.appendChild(
                applyCell
            );


            // ------------------------------------------------
            // Delete
            // ------------------------------------------------

            const deleteCell =
                document.createElement("td");


            if(result.ruled){

                const deleteButton =
                    document.createElement("button");

                deleteButton.type =
                    "button";

                deleteButton.textContent =
                    "X";


                deleteButton.onclick = () => {

                    if(!result.pack)
                        return;

                    if(
                        !confirm(
                            `Delete rule "${result.find}"?`
                        )
                    )
                        return;


                    WNC.rules.remove(
                        result.pack,
                        result.order
                    );


                    scannerState.results =
                        scanPage();

                    renderScanner();

                };


                deleteCell.appendChild(
                    deleteButton
                );

            }


            row.appendChild(
                deleteCell
            );


            tbody.appendChild(
                row
            );

        });


    content.appendChild(table);


    // --------------------------------------------------------
    // Selected template editor
    // --------------------------------------------------------

    const selected =
        scannerState.results.find(
            result =>
                result._selected
        );


    if(selected){

        const templateBar =
            document.createElement("div");

        templateBar.className =
            "wnc-template-bar";


        const label =
            document.createElement("span");

        label.textContent =
            "Te";


        const input =
            document.createElement("input");

        input.type = "text";

        input.value =
            scannerState.template ||
            "{find}";


        input.oninput = () => {

            scannerState.template =
                input.value;

        };


        const generate =
            document.createElement("button");

        generate.textContent =
            "G";

        generate.title =
            "Generate regex";


        generate.onclick = () => {

            const escaped =
                escapeScannerRegex(
                    selected.find
                );


            selected.replace =
                scannerState.template
                    .replace(
                        /\{find\}/gi,
                        escaped
                    )
                    .replace(
                        /\{phrase\}/gi,
                        escaped
                    );


            selected.type =
                "regex";

            selected._generated =
                true;

            renderScanner();

        };


        templateBar.appendChild(label);
        templateBar.appendChild(input);
        templateBar.appendChild(generate);

        content.appendChild(
            templateBar
        );

    }

}


// ============================================================
// OPEN SCANNER
// ============================================================

function openScanner(){

    const content =
        createToolPanel(
            "WNC Scanner"
        );


    scannerState.results =
        scanPage();


    renderScanner();

}


// ============================================================
// INSPECTOR
// ============================================================

function openInspector(){

    const content =
        createToolPanel(
            "WNC Inspector"
        );


    const table =
        document.createElement("table");


    table.innerHTML = `
        <thead>
            <tr>
                <th>Pack</th>
                <th>Enabled</th>
                <th>Page Load</th>
                <th>Auto</th>
                <th>URLs</th>
                <th>Rules</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;


    const tbody =
        table.querySelector("tbody");


    WNC.packs
        .getMatched(location.hostname)
        .forEach(pack => {

            const row =
                document.createElement("tr");


            const values = [

                pack.name,

                pack.enabled !== false
                    ? "Yes"
                    : "No",

                pack.pageLoad !== false
                    ? "Yes"
                    : "No",

                pack.auto !== false
                    ? "Yes"
                    : "No",

                pack.urls.length
                    ? pack.urls.join(", ")
                    : "All sites",

                String(pack.rules.length)

            ];


            values.forEach(value => {

                const td =
                    document.createElement("td");

                td.textContent =
                    value;

                row.appendChild(td);

            });


            tbody.appendChild(row);

        });


    content.appendChild(table);

}


// ============================================================
// DIAGNOSTICS
// ============================================================

function checkDatabase(){

    const report = [];

    const db =
        WNC.database.load();


    let packCount = 0;
    let ruleCount = 0;
    let emptyRules = 0;
    let badRegex = 0;


    db.packs.forEach(pack => {

        packCount++;


        if(!pack.name){

            report.push(
                "Pack with missing name."
            );

        }


        if(!Array.isArray(pack.rules)){

            report.push(
                `Pack "${pack.name}" has invalid rules.`
            );

            return;

        }


        pack.rules.forEach(rule => {

            ruleCount++;


            if(!rule.find)
                emptyRules++;


            if(rule.type === "regex"){

                try {

                    new RegExp(
                        rule.find
                    );

                }
                catch(error){

                    badRegex++;

                    report.push(
                        `Bad regex in "${pack.name}": ${rule.find}`
                    );

                }

            }

        });

    });


    report.unshift(
        "WNC Database Diagnostics",
        "",
        `Packs: ${packCount}`,
        `Rules: ${ruleCount}`,
        `Empty rules: ${emptyRules}`,
        `Bad regex: ${badRegex}`,
        ""
    );


    if(
        emptyRules === 0 &&
        badRegex === 0 &&
        report.length === 7
    ){

        report.push(
            "Database looks healthy."
        );

    }


    return report.join("\n");

}


// ============================================================
// DIAGNOSTICS UI
// ============================================================

function openDiagnostics(){

    const content =
        createToolPanel(
            "WNC Diagnostics"
        );


    const button =
        document.createElement("button");

    button.textContent =
        "Run Diagnostics";


    const output =
        document.createElement("pre");


    output.style.whiteSpace =
        "pre-wrap";


    button.onclick = () => {

        output.textContent =
            checkDatabase();

    };


    content.appendChild(button);
    content.appendChild(output);

}


// ============================================================
// PUBLIC API
// ============================================================

WNC.scanner = {

    open:
        openScanner,

    scan:
        scanPage

};


WNC.inspector = {

    open:
        openInspector

};


WNC.diagnostics = {

    open:
        openDiagnostics,

    check:
        checkDatabase

};


// ============================================================
// CSS
// ============================================================

GM_addStyle(`

#wnc-tool-panel {

    position:fixed;

    top:60px;
    left:50%;

    transform:translateX(-50%);

    width:max-content;

    min-width:900px;

    max-width:calc(100vw - 20px);

    max-height:80vh;

    overflow:auto;

    z-index:999999;

    background:#222;
    color:#fff;

    border:1px solid #777;
    border-radius:6px;

    padding:4px;

    font:12px Arial,sans-serif;

    box-shadow:
        0 4px 20px rgba(0,0,0,.5);

}


#wnc-tool-panel
.wnc-panel-header {

    position:sticky;

    top:0;

    z-index:10;

    display:flex;

    justify-content:space-between;

    align-items:center;

    background:#222;

    margin:0;

    padding:2px 0 4px;

}


#wnc-tool-panel
.wnc-scanner-toolbar {

    position:sticky;

    top:24px;

    z-index:9;

    display:flex;

    align-items:center;

    gap:3px;

    margin:0 0 3px;

    padding:2px 0;

    background:#222;

}


#wnc-tool-panel table {

    width:auto;

    min-width:100%;

    border-collapse:collapse;

    table-layout:auto;

}


#wnc-tool-panel th,
#wnc-tool-panel td {

    padding:2px 3px;

    border:1px solid #555;

    text-align:left;

    vertical-align:middle;

    white-space:nowrap;

}


#wnc-tool-panel th {

    position:sticky;

    top:50px;

    z-index:8;

    background:#222;

}


#wnc-tool-panel input,
#wnc-tool-panel button {

    box-sizing:border-box;

    font:12px Arial,sans-serif;

}


#wnc-tool-panel input {

    min-width:0;

    padding:2px 3px;

}


#wnc-tool-panel button {

    padding:2px 5px;

    cursor:pointer;

}


.wnc-pack-search {

    position:relative;

    display:flex;

}


.wnc-pack-search > input {

    width:180px;

}


.wnc-pack-results {

    position:absolute;

    top:100%;

    left:0;

    z-index:100;

    display:flex;

    flex-direction:column;

    min-width:180px;

    max-height:240px;

    overflow:auto;

    background:#222;

    border:1px solid #777;

}


.wnc-pack-results button {

    text-align:left;

    border:0;

    border-bottom:1px solid #444;

}


.wnc-result-input {

    width:180px;

}


.wnc-find {

    display:flex;

    align-items:flex-start;

    max-width:320px;

    overflow:hidden;

}


.wnc-find-toggle {

    flex:none;

    margin-right:2px;

    padding:0 2px !important;

}


.wnc-find span {

    display:block;

    max-width:280px;

    overflow:hidden;

    text-overflow:ellipsis;

    white-space:nowrap;

}


.wnc-find.expanded {

    max-width:600px;

}


.wnc-find.expanded span {

    max-width:560px;

    white-space:normal;

    overflow-wrap:anywhere;

}


.wnc-switch {

    min-width:20px;

    padding:1px 3px !important;

}


.wnc-unruled {

    opacity:.95;

}


.wnc-unruled td:first-child {

    color:#aaa;

}


.wnc-template-control {

    display:flex;

    gap:2px;

}


.wnc-template-control input {

    width:140px;

}


.wnc-template-bar {

    display:flex;

    gap:3px;

    align-items:center;

    margin-top:3px;

    padding:3px 0;

}


.wnc-template-bar input {

    width:260px;

}


#wnc-tool-panel pre {

    margin:8px 0 0;

}

`);

console.log(
    "[WNC] v5.1 Part 6 Scanner/Tools loaded"
);

})();// ============================================================
// WNC v5.1 - PART 7/7
// SECTION: Initialization + Menu + Tools
// ============================================================

(function(){

"use strict";

const WNC = unsafeWindow.WNC;


// ============================================================
// EXPORT DATABASE
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
            type: "application/json"
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


    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 1000);

}


function exportDatabase(){

    downloadJSON(
        WNC.database.load(),
        "WNC-backup.json"
    );

}


// ============================================================
// IMPORT FILE
// ============================================================

function chooseJSONFile(callback){

    const input =
        document.createElement("input");


    input.type = "file";
    input.accept = ".json,application/json";


    input.onchange = () => {

        const file =
            input.files?.[0];


        if(!file)
            return;


        const reader =
            new FileReader();


        reader.onload = () => {

            try {

                const data =
                    JSON.parse(
                        reader.result
                    );


                callback(data);

            }
            catch(error){

                console.error(
                    "[WNC] JSON import error:",
                    error
                );

                alert(
                    "Invalid JSON file."
                );

            }

        };


        reader.onerror = () => {

            alert(
                "Could not read the file."
            );

        };


        reader.readAsText(file);

    };


    input.click();

}


// ============================================================
// FOXREPLACE IMPORT
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
            WNC.foxReplace.import(data);


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
// MERGE FOXREPLACE
// ============================================================

function mergeFoxReplace(){

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


        const success =
            WNC.foxReplace.merge(data);


        if(success){

            alert(
                "FoxReplace packs merged."
            );

        }
        else{

            alert(
                "FoxReplace import failed."
            );

        }

    });

}


// ============================================================
// REPLACE DATABASE WITH FOXREPLACE
// ============================================================

function replaceWithFoxReplace(){

    if(
        !confirm(
            "Replace the current WNC database with the FoxReplace file?"
        )
    )
        return;


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


        const success =
            WNC.foxReplace.replace(data);


        if(success){

            alert(
                "WNC database replaced with FoxReplace data."
            );

        }
        else{

            alert(
                "Import failed."
            );

        }

    });

}


// ============================================================
// WNC DATABASE IMPORT
// ============================================================

function importWNCBackup(){

    chooseJSONFile(data => {

        if(
            !data ||
            !Array.isArray(data.packs)
        ){

            alert(
                "This does not appear to be a WNC backup."
            );

            return;

        }


        if(
            !confirm(
                "Replace the current WNC database with this backup?"
            )
        )
            return;


        try {

            WNC.database.save(
                WNC.database.migrate(data)
            );


            alert(
                "WNC database imported."
            );

        }
        catch(error){

            console.error(
                "[WNC] WNC import error:",
                error
            );

            alert(
                "WNC database import failed."
            );

        }

    });

}


// ============================================================
// APPLY / UNDO
// ============================================================

function apply(){

    WNC.replace.apply();

}


function undo(){

    WNC.replace.undo();

}


// ============================================================
// AUTO / PAGE LOAD STATE
// ============================================================

function getMatchedPacks(){

    return WNC.packs.getMatched(
        location.hostname
    );

}


function setAuto(enabled){

    const packs =
        getMatchedPacks();


    packs.forEach(pack => {

        WNC.packs.update(
            pack.name,
            {
                auto: enabled
            }
        );

    });


    WNC.cleaner.restart();

}


function setPageLoad(enabled){

    const packs =
        getMatchedPacks();


    packs.forEach(pack => {

        WNC.packs.update(
            pack.name,
            {
                pageLoad: enabled
            }
        );

    });

}


function autoOn(){

    setAuto(true);

}


function autoOff(){

    setAuto(false);

}


function pageLoadOn(){

    setPageLoad(true);

}


function pageLoadOff(){

    setPageLoad(false);

}


// ============================================================
// STATUS
// ============================================================

function showStatus(){

    const packs =
        getMatchedPacks();


    const auto =
        packs.some(
            pack => pack.auto !== false
        );


    const pageLoad =
        packs.some(
            pack => pack.pageLoad !== false
        );


    alert(

        "WNC Status\n\n" +

        "Matched Packs: " +
        packs.length +

        "\nAuto: " +
        (auto ? "ON" : "OFF") +

        "\nPage Load: " +
        (pageLoad ? "ON" : "OFF")

    );

}


// ============================================================
// MENU
// ============================================================
//
// Main UI:
//     WNC - Editor
//     WNC - Scanner
//     WNC - Tools
//
// Direct controls:
//     WNC - Apply
//     WNC - Undo
//     WNC - Auto On
//     WNC - Auto Off
//     WNC - Page Load On
//     WNC - Page Load Off
//
// ============================================================

GM_registerMenuCommand(
    "WNC - Editor",
    () => {

        WNC.editor.open();

    }
);


GM_registerMenuCommand(
    "WNC - Scanner",
    () => {

        WNC.scanner.open();

    }
);


GM_registerMenuCommand(
    "WNC - Tools",
    () => {

        openTools();

    }
);


GM_registerMenuCommand(
    "WNC - Apply",
    apply
);


GM_registerMenuCommand(
    "WNC - Undo",
    undo
);


GM_registerMenuCommand(
    "WNC - Auto On",
    autoOn
);


GM_registerMenuCommand(
    "WNC - Auto Off",
    autoOff
);


GM_registerMenuCommand(
    "WNC - Page Load On",
    pageLoadOn
);


GM_registerMenuCommand(
    "WNC - Page Load Off",
    pageLoadOff
);


GM_registerMenuCommand(
    "WNC - Status",
    showStatus
);


// ============================================================
// TOOLS PANEL
// ============================================================
//
// Database itself has NO UI panel.
// The Editor edits the database.
//
// Tools contains:
//     Import FoxReplace
//     Merge FoxReplace
//     Replace with FoxReplace
//     Import WNC Backup
//     Export WNC Backup
//     Diagnostics
//     Inspector
//
// ============================================================

let toolsPanel = null;


function openTools(){

    if(toolsPanel){

        toolsPanel.remove();
        toolsPanel = null;

    }


    toolsPanel =
        document.createElement("div");


    toolsPanel.id =
        "wnc-tools-panel";


    toolsPanel.innerHTML = `

        <div class="wnc-tools-header">

            <b>WNC Tools</b>

            <button id="wnc-tools-close">
                X
            </button>

        </div>


        <div class="wnc-tools-body">

            <button id="wnc-import-fox">
                Import FoxReplace
            </button>


            <button id="wnc-merge-fox">
                Merge FoxReplace
            </button>


            <button id="wnc-replace-fox">
                Replace with FoxReplace
            </button>


            <hr>


            <button id="wnc-import-backup">
                Import WNC Backup
            </button>


            <button id="wnc-export">
                Export WNC Backup
            </button>


            <hr>


            <button id="wnc-inspector">
                Inspector
            </button>


            <button id="wnc-diagnostics">
                Diagnostics
            </button>

        </div>

    `;


    document.body.appendChild(
        toolsPanel
    );


    toolsPanel.querySelector(
        "#wnc-tools-close"
    ).onclick = () => {

        toolsPanel.remove();
        toolsPanel = null;

    };


    toolsPanel.querySelector(
        "#wnc-import-fox"
    ).onclick =
        importFoxReplace;


    toolsPanel.querySelector(
        "#wnc-merge-fox"
    ).onclick =
        mergeFoxReplace;


    toolsPanel.querySelector(
        "#wnc-replace-fox"
    ).onclick =
        replaceWithFoxReplace;


    toolsPanel.querySelector(
        "#wnc-import-backup"
    ).onclick =
        importWNCBackup;


    toolsPanel.querySelector(
        "#wnc-export"
    ).onclick =
        exportDatabase;


    toolsPanel.querySelector(
        "#wnc-inspector"
    ).onclick = () => {

        WNC.inspector.open();

    };


    toolsPanel.querySelector(
        "#wnc-diagnostics"
    ).onclick = () => {

        WNC.diagnostics.open();

    };

}


// ============================================================
// TOOLS CSS
// ============================================================

GM_addStyle(`

#wnc-tools-panel {

    position:fixed;

    top:60px;
    left:50%;

    transform:translateX(-50%);

    width:420px;
    max-width:calc(100vw - 40px);

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


#wnc-tools-panel
.wnc-tools-header {

    display:flex;

    justify-content:space-between;

    align-items:center;

    margin-bottom:12px;

}


#wnc-tools-panel
.wnc-tools-body {

    display:flex;

    flex-direction:column;

    gap:7px;

}


#wnc-tools-panel button {

    padding:7px 10px;

    cursor:pointer;

    text-align:left;

    font:13px Arial,sans-serif;

}


#wnc-tools-panel hr {

    width:100%;

    border:0;

    border-top:1px solid #555;

    margin:5px 0;

}

`);


// ============================================================
// VERSION
// ============================================================

WNC.version = "5.1";


console.log(
    "[WNC] v5.1 COMPLETE"
);


})();
