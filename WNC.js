// ==UserScript==
// @name         WebNovel Cleaner
// @namespace    https://github.com/GoroFourArms
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
// @run-at       document-idle
// ==/UserScript==

// ============================================================
// WNC 5.2 - PART 1/7
// SECTION: Core + Database + Pack/Rule Operations
// ============================================================

(() => {

"use strict";

const WNC_VERSION = "5.2.0";
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
    cleaner: {},
    inspector: {},
    diagnostics: {},
    ui: {}

};

unsafeWindow.WNC = WNC;
window.WNC = WNC;


// ============================================================
// DEFAULT DATABASE
// ============================================================

const DEFAULT_DATABASE = {

    version: WNC_VERSION,

    packs: []

};


// ============================================================
// UTILITY
// ============================================================

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


// ============================================================
// NORMALIZE ORDER
// ============================================================
//
// Orders are always maintained as contiguous integers:
//
// Pack: 1, 2, 3, 4...
// Rule: 1, 2, 3, 4...
//
// This makes manual reordering predictable.
//

function normalizePackOrders(db) {

    db.packs
        .sort(
            (a, b) =>
                Number(a.order || 0) -
                Number(b.order || 0)
        )
        .forEach(
            (pack, index) => {

                pack.order =
                    index + 1;

            }
        );

}


function normalizeRuleOrders(pack) {

    if (!pack || !Array.isArray(pack.rules))
        return;


    pack.rules
        .sort(
            (a, b) =>
                Number(a.order || 0) -
                Number(b.order || 0)
        )
        .forEach(
            (rule, index) => {

                rule.order =
                    index + 1;

            }
        );

}


// ============================================================
// RULE MIGRATION
// ============================================================

function migrateRule(rule, index) {

    if (
        !rule ||
        typeof rule !== "object"
    ) {

        rule = {};

    }


    if (
        rule.order === undefined ||
        !Number.isFinite(
            Number(rule.order)
        )
    ) {

        rule.order =
            index + 1;

    }
    else {

        rule.order =
            Number(rule.order);

    }


    if (rule.find === undefined)
        rule.find = "";


    if (rule.replace === undefined)
        rule.replace = "";


    if (!rule.type)
        rule.type = "whole";


    // Normalize legacy type names.

    if (rule.type === "regexp")
        rule.type = "regex";


    if (
        ![
            "whole",
            "text",
            "regex"
        ].includes(rule.type)
    ) {

        rule.type = "whole";

    }


    if (rule.caseSensitive === undefined)
        rule.caseSensitive = false;


    if (rule.enabled === undefined)
        rule.enabled = true;


    if (rule.lastUsed === undefined)
        rule.lastUsed = null;


    if (rule.htmlMode === undefined)
        rule.htmlMode = "none";


    return rule;

}


// ============================================================
// PACK MIGRATION
// ============================================================

function migratePack(pack, index) {

    if (
        !pack ||
        typeof pack !== "object"
    ) {

        pack = {};

    }


    if (!pack.name)
        pack.name = `Pack ${index + 1}`;


    if (!Array.isArray(pack.urls))
        pack.urls = [];


    if (!Array.isArray(pack.rules))
        pack.rules = [];


    if (
        pack.order === undefined ||
        !Number.isFinite(
            Number(pack.order)
        )
    ) {

        pack.order =
            index + 1;

    }
    else {

        pack.order =
            Number(pack.order);

    }


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


    normalizeRuleOrders(pack);


    return pack;

}


// ============================================================
// DATABASE MIGRATION
// ============================================================

function migrateDatabase(db) {

    if (
        !db ||
        typeof db !== "object"
    ) {

        db =
            clone(
                DEFAULT_DATABASE
            );

    }


    if (!Array.isArray(db.packs))
        db.packs = [];


    db.packs =
        db.packs.map(
            migratePack
        );


    normalizePackOrders(db);


    db.version =
        WNC_VERSION;


    return db;

}


// ============================================================
// LOAD DATABASE
// ============================================================

function loadDatabase() {

    let raw =
        GM_getValue(
            DB_KEY
        );


    if (!raw) {

        const db =
            clone(
                DEFAULT_DATABASE
            );

        saveDatabase(db);

        return db;

    }


    let db;


    try {

        db =
            typeof raw === "string"
                ? JSON.parse(raw)
                : raw;

    }

    catch (error) {

        console.error(
            "[WNC] Database could not be parsed:",
            error
        );

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


// ============================================================
// SAVE DATABASE
// ============================================================

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


// ============================================================
// NEXT ORDERS
// ============================================================

function nextPackOrder(db) {

    if (!db.packs.length)
        return 1;


    return Math.max(
        ...db.packs.map(
            pack =>
                Number(pack.order) || 0
        )
    ) + 1;

}


function nextRuleOrder(pack) {

    if (!pack || !pack.rules.length)
        return 1;


    return Math.max(
        ...pack.rules.map(
            rule =>
                Number(rule.order) || 0
        )
    ) + 1;

}


// ============================================================
// PACK ORDER EDITING
// ============================================================
//
// Setting Pack 2 -> 5:
//
// 1,2,3,4,5
// becomes
// 1,3,4,5,2
//
// If the requested number is occupied, the existing
// pack is shifted automatically.
//

function setPackOrder(
    packName,
    requestedOrder
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


    let newOrder =
        Number(requestedOrder);


    if (
        !Number.isFinite(newOrder)
    ) {

        return false;

    }


    newOrder =
        Math.max(
            1,
            Math.floor(newOrder)
        );


    const oldOrder =
        Number(pack.order);


    if (newOrder === oldOrder)
        return true;


    normalizePackOrders(db);


    // Re-read after normalization.

    const currentPack =
        db.packs.find(
            p =>
                p.name === packName
        );


    if (!currentPack)
        return false;


    const maxOrder =
        db.packs.length;


    newOrder =
        Math.min(
            newOrder,
            maxOrder
        );


    if (newOrder < oldOrder) {

        db.packs.forEach(
            other => {

                if (
                    other.name !== packName &&
                    other.order >= newOrder &&
                    other.order < oldOrder
                ) {

                    other.order++;

                }

            }
        );

    }
    else {

        db.packs.forEach(
            other => {

                if (
                    other.name !== packName &&
                    other.order > oldOrder &&
                    other.order <= newOrder
                ) {

                    other.order--;

                }

            }
        );

    }


    currentPack.order =
        newOrder;


    normalizePackOrders(db);

    saveDatabase(db);


    return true;

}


// ============================================================
// RULE ORDER EDITING
// ============================================================
//
// Same behavior as packs, but scoped to one pack.
//

function setRuleOrder(
    packName,
    oldOrder,
    requestedOrder
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


    normalizeRuleOrders(pack);


    const rule =
        pack.rules.find(
            r =>
                Number(r.order) ===
                Number(oldOrder)
        );


    if (!rule)
        return false;


    let newOrder =
        Number(requestedOrder);


    if (
        !Number.isFinite(newOrder)
    ) {

        return false;

    }


    newOrder =
        Math.max(
            1,
            Math.floor(newOrder)
        );


    const currentOrder =
        Number(rule.order);


    if (newOrder === currentOrder)
        return true;


    const maxOrder =
        pack.rules.length;


    newOrder =
        Math.min(
            newOrder,
            maxOrder
        );


    if (newOrder < currentOrder) {

        pack.rules.forEach(
            other => {

                if (
                    other !== rule &&
                    other.order >= newOrder &&
                    other.order < currentOrder
                ) {

                    other.order++;

                }

            }
        );

    }
    else {

        pack.rules.forEach(
            other => {

                if (
                    other !== rule &&
                    other.order > currentOrder &&
                    other.order <= newOrder
                ) {

                    other.order--;

                }

            }
        );

    }


    rule.order =
        newOrder;


    normalizeRuleOrders(pack);

    saveDatabase(db);


    return true;

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


    normalizePackOrders(db);

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


function updatePack(
    name,
    data
) {

    const db =
        loadDatabase();


    const pack =
        db.packs.find(
            p =>
                p.name === name
        );


    if (!pack)
        return false;


    const requestedOrder =
        data &&
        data.order !== undefined
            ? data.order
            : null;


    const updateData =
        {
            ...data
        };


    delete updateData.order;


    Object.assign(
        pack,
        updateData
    );


    if (
        requestedOrder !== null
    ) {

        const result =
            setPackOrderInDatabase(
                db,
                pack.name,
                requestedOrder
            );


        if (!result)
            return false;

    }


    normalizePackOrders(db);

    saveDatabase(db);


    return true;

}


// Internal version used so updatePack
// does not load/save twice.

function setPackOrderInDatabase(
    db,
    packName,
    requestedOrder
) {

    const pack =
        db.packs.find(
            p =>
                p.name === packName
        );


    if (!pack)
        return false;


    let newOrder =
        Number(requestedOrder);


    if (!Number.isFinite(newOrder))
        return false;


    newOrder =
        Math.max(
            1,
            Math.floor(newOrder)
        );


    normalizePackOrders(db);


    const oldOrder =
        Number(pack.order);


    newOrder =
        Math.min(
            newOrder,
            db.packs.length
        );


    if (newOrder === oldOrder)
        return true;


    if (newOrder < oldOrder) {

        db.packs.forEach(
            other => {

                if (
                    other !== pack &&
                    other.order >= newOrder &&
                    other.order < oldOrder
                ) {

                    other.order++;

                }

            }
        );

    }
    else {

        db.packs.forEach(
            other => {

                if (
                    other !== pack &&
                    other.order > oldOrder &&
                    other.order <= newOrder
                ) {

                    other.order--;

                }

            }
        );

    }


    pack.order =
        newOrder;


    normalizePackOrders(db);


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


    normalizePackOrders(db);

    saveDatabase(db);


    return (
        db.packs.length !== before
    );

}


// ============================================================
// RULE OPERATIONS
// ============================================================

function addRule(
    packName,
    data = {}
) {

    const db =
        loadDatabase();


    const pack =
        db.packs.find(
            p =>
                p.name === packName
        );


    if (!pack)
        return null;


    normalizeRuleOrders(pack);


    const rule = {

        order:
            nextRuleOrder(pack),

        find:
            String(
                data.find ?? ""
            ),

        replace:
            String(
                data.replace ?? ""
            ),

        type:
            [
                "whole",
                "text",
                "regex"
            ].includes(data.type)
                ? data.type
                : "whole",

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


    normalizeRuleOrders(pack);

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


    normalizeRuleOrders(pack);


    const rule =
        pack.rules.find(
            r =>
                Number(r.order) ===
                Number(order)
        );


    if (!rule)
        return false;


    const requestedOrder =
        data &&
        data.order !== undefined
            ? data.order
            : null;


    const updateData =
        {
            ...data
        };


    delete updateData.order;


    Object.assign(
        rule,
        updateData
    );


    if (
        requestedOrder !== null
    ) {

        if (
            !setRuleOrderInDatabase(
                pack,
                rule,
                requestedOrder
            )
        ) {

            return false;

        }

    }


    normalizeRuleOrders(pack);

    saveDatabase(db);


    return true;

}


// Internal rule order setter.

function setRuleOrderInDatabase(
    pack,
    rule,
    requestedOrder
) {

    let newOrder =
        Number(requestedOrder);


    if (!Number.isFinite(newOrder))
        return false;


    newOrder =
        Math.max(
            1,
            Math.floor(newOrder)
        );


    normalizeRuleOrders(pack);


    const oldOrder =
        Number(rule.order);


    newOrder =
        Math.min(
            newOrder,
            pack.rules.length
        );


    if (newOrder === oldOrder)
        return true;


    if (newOrder < oldOrder) {

        pack.rules.forEach(
            other => {

                if (
                    other !== rule &&
                    other.order >= newOrder &&
                    other.order < oldOrder
                ) {

                    other.order++;

                }

            }
        );

    }
    else {

        pack.rules.forEach(
            other => {

                if (
                    other !== rule &&
                    other.order > oldOrder &&
                    other.order <= newOrder
                ) {

                    other.order--;

                }

            }
        );

    }


    rule.order =
        newOrder;


    normalizeRuleOrders(pack);


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
            rule =>
                Number(rule.order) !==
                Number(order)
        );


    normalizeRuleOrders(pack);

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
            lastUsed:
                today()
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

    setOrder:
        setPackOrder,

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

    setOrder:
        setRuleOrder,

    touch:
        touchRule

};


console.log(
    `[WNC] ${WNC_VERSION} Part 1 loaded`
);

})();
// ============================================================
// WNC 5.2 - PART 2/7
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


// ============================================================
// BUILD RULE PATTERN
// ============================================================

function buildPattern(rule) {

    const cacheKey =
        JSON.stringify({

            find:
                rule.find,

            type:
                rule.type,

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


    let pattern = null;


    const flags =
        rule.caseSensitive
            ? "g"
            : "gi";


    try {

        // ----------------------------------------------------
        // REGEX
        // ----------------------------------------------------

        if (
            rule.type === "regex"
        ) {

            pattern =
                new RegExp(
                    rule.find,
                    flags
                );

        }


        // ----------------------------------------------------
        // TEXT
        // ----------------------------------------------------

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


        // ----------------------------------------------------
        // WHOLE WORD
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


    if (
        rule.enabled === false
    ) {

        return text;

    }


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


    const ignoredTags =
        new Set([

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


    if (
        !node.nodeValue ||
        !node.nodeValue.trim()
    ) {

        return true;

    }


    return false;

}


// ============================================================
// TEXT NODES
// ============================================================

function getTextNodes(
    root = document.body
) {

    const nodes = [];


    if (!root)
        return nodes;


    if (
        root.nodeType ===
        Node.TEXT_NODE
    ) {

        if (
            !shouldIgnoreTextNode(
                root
            )
        ) {

            nodes.push(root);

        }


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
                            rule.enabled !== false &&
                            rule.find
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


            after =
                result;

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
                // Record last-used rules once.
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


    [...undoStack]
        .reverse()
        .forEach(
            change => {

                if (!change.node)
                    return;


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
// CAN UNDO
// ============================================================

function canUndo() {

    return (
        undoStack.length > 0
    );

}


// ============================================================
// APPLY ONE RULE
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
// TEST RULE
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
// CHECK RULE
// ============================================================
//
// Used by the scanner and editor without modifying
// the page.
//

function ruleMatchesText(
    text,
    rule
) {

    if (!rule || !rule.find)
        return false;


    const result =
        replaceValue(
            text,
            rule
        );


    return (
        result !== text
    );

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

    ruleMatchesText,

    getRules:
        getActiveRules,

    getTextNodes,

    clearRegexCache

};


// ============================================================
// DIAGNOSTIC
// ============================================================

console.log(
    "[WNC] 5.2 Part 2 - Replacement Engine loaded"
);

})();
// ============================================================
// WNC 5.2 - PART 3/7
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
                substitution.input ?? ""
            ),

        replace:
            String(
                substitution.output ?? ""
            ),

        type:
            foxReplaceTypeToWNC(
                substitution.inputType
            ),

        caseSensitive:
            substitution.caseSensitive === true,

        enabled:
            substitution.enabled !== false,

        htmlMode:
            substitution.html || "none",

        lastUsed:
            null

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

        pageLoad:
            group.pageLoad !== false,

        auto:
            group.auto !== false,

        urls:
            Array.isArray(
                group.urls
            )
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
        Array.isArray(
            data.groups
        )
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
// FIND UNIQUE PACK NAME
// ============================================================

function getUniquePackName(
    db,
    name
) {

    const base =
        String(
            name ||
            "Imported Pack"
        ).trim();


    if (
        !db.packs.some(
            pack =>
                pack.name === base
        )
    ) {

        return base;

    }


    let index = 2;


    while (
        db.packs.some(
            pack =>
                pack.name ===
                `${base} ${index}`
        )
    ) {

        index++;

    }


    return `${base} ${index}`;

}


// ============================================================
// RULE DUPLICATE CHECK
// ============================================================

function sameRule(
    a,
    b
) {

    return (

        String(a.find ?? "") ===
        String(b.find ?? "") &&

        String(a.replace ?? "") ===
        String(b.replace ?? "") &&

        String(a.type ?? "whole") ===
        String(b.type ?? "whole") &&

        Boolean(a.caseSensitive) ===
        Boolean(b.caseSensitive)

    );

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
    let mergedPacks = 0;
    let addedRules = 0;
    let skippedRules = 0;


    converted.packs.forEach(
        importedPack => {

            let pack =
                db.packs.find(
                    existing =>
                        existing.name ===
                        importedPack.name
                );


            // ------------------------------------------------
            // New pack
            // ------------------------------------------------

            if (!pack) {

                pack =
                    clonePackForImport(
                        importedPack
                    );


                pack.name =
                    getUniquePackName(
                        db,
                        pack.name
                    );


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


            // ------------------------------------------------
            // Existing pack
            // ------------------------------------------------

            mergedPacks++;


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


                    if (
                        duplicate
                    ) {

                        skippedRules++;

                        return;

                    }


                    importedRule =
                        {
                            ...importedRule,

                            order:
                                nextRuleOrderForDatabase(
                                    pack
                                )

                        };


                    pack.rules.push(
                        importedRule
                    );


                    addedRules++;

                }
            );

        }
    );


    normalizeImportedOrders(db);


    WNC.database.save(
        db
    );


    return {

        groups:
            converted.packs.length,

        addedPacks,

        mergedPacks,

        addedRules,

        skippedRules

    };

}


// ============================================================
// CLONE IMPORTED PACK
// ============================================================

function clonePackForImport(
    pack
) {

    return {

        name:
            String(
                pack.name
            ),

        order:
            Number(
                pack.order
            ) || 1,

        enabled:
            pack.enabled !== false,

        pageLoad:
            pack.pageLoad !== false,

        auto:
            pack.auto !== false,

        urls:
            Array.isArray(pack.urls)
                ? [...pack.urls]
                : [],

        rules:
            Array.isArray(pack.rules)
                ? pack.rules.map(
                    rule => ({
                        ...rule
                    })
                )
                : []

    };

}


// ============================================================
// ORDER HELPERS
// ============================================================

function nextPackOrderForDatabase(
    db
) {

    if (!db.packs.length)
        return 1;


    return Math.max(
        ...db.packs.map(
            pack =>
                Number(pack.order) || 0
        )
    ) + 1;

}


function nextRuleOrderForDatabase(
    pack
) {

    if (!pack.rules.length)
        return 1;


    return Math.max(
        ...pack.rules.map(
            rule =>
                Number(rule.order) || 0
        )
    ) + 1;

}


// ============================================================
// NORMALIZE IMPORTED ORDERS
// ============================================================

function normalizeImportedOrders(
    db
) {

    db.packs
        .sort(
            (a, b) =>
                Number(a.order || 0) -
                Number(b.order || 0)
        )
        .forEach(
            (pack, packIndex) => {

                pack.order =
                    packIndex + 1;


                pack.rules =
                    Array.isArray(
                        pack.rules
                    )
                        ? pack.rules
                        : [];


                pack.rules
                    .sort(
                        (a, b) =>
                            Number(a.order || 0) -
                            Number(b.order || 0)
                    )
                    .forEach(
                        (rule, ruleIndex) => {

                            rule.order =
                                ruleIndex + 1;

                        }
                    );

            }
        );

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


    const db =
        WNC.database.migrate(
            converted
        );


    WNC.database.save(
        db
    );


    return {

        packs:
            db.packs.length,

        rules:
            db.packs.reduce(
                (
                    total,
                    pack
                ) =>
                    total +
                    pack.rules.length,
                0
            )

    };

}


// ============================================================
// EXPORT WNC DATABASE
// ============================================================

function exportWNC() {

    return WNC.database.load();

}


// ============================================================
// EXPORT FOXREPLACE
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


    link.href =
        url;

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
// BACKUP DOWNLOADS
// ============================================================

function downloadWNCBackup() {

    downloadJSON(
        exportWNC(),
        "WNC-5.2-backup.json"
    );

}


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
        (
            resolve,
            reject
        ) => {

            const reader =
                new FileReader();


            reader.onload =
                () => {

                    try {

                        resolve(
                            JSON.parse(
                                reader.result
                            )
                        );

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
// FILE PICKER
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
// FOXREPLACE IMPORT UI
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


            if (
                mode === "replace"
            ) {

                if (
                    !confirm(
                        "Replace the current WNC database with this FoxReplace database?"
                    )
                ) {

                    return;

                }


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
                    "FoxReplace import complete.\n\n" +

                    "Groups: " +
                    result.groups +

                    "\nNew Packs: " +
                    result.addedPacks +

                    "\nMerged Packs: " +
                    result.mergedPacks +

                    "\nRules Added: " +
                    result.addedRules +

                    "\nDuplicates Skipped: " +
                    result.skippedRules
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
    "[WNC] 5.2 Part 3 - FoxReplace compatibility loaded"
);

})();
// ============================================================
// WNC 5.2 - PART 4/7
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


// ============================================================
// NODE FILTER
// ============================================================

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


    if (
        !node.nodeValue ||
        !node.nodeValue.trim()
    ) {

        return true;

    }


    return false;

}


// ============================================================
// COLLECT TEXT NODES
// ============================================================

function collectTextNodes(
    root
) {

    const nodes = [];


    if (!root)
        return nodes;


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
        !root.ownerDocument &&
        root !== document
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
// MATCHED PACKS
// ============================================================

function getMatchedPacks(){
    return WNC.packs.getMatched(
        location.href
    );
}


// ============================================================
// PACK RULES
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
                Number(a.order || 0) -
                Number(b.order || 0)
        );

}


// ============================================================
// APPLY PACKS TO TEXT NODE
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


                    after =
                        result;

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
    // Update rule usage once per rule.
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
// CLEAN ROOT
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
// CLEAN PAGE
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
// CLEAN ADDED NODE
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
// START OBSERVER
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

                                    if (
                                        node.nodeType !==
                                        Node.ELEMENT_NODE &&
                                        node.nodeType !==
                                        Node.TEXT_NODE
                                    ) {

                                        return;

                                    }


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

            childList:
                true,

            subtree:
                true

        }
    );


    console.log(
        "[WNC] Auto observer started"
    );

}


// ============================================================
// STOP OBSERVER
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
// INITIALIZE
// ============================================================

function initializePageLoad() {

    const initialize =
        () => {

            setTimeout(
                () => {

                    cleanPage();

                    startObserver();

                },
                1000
            );

        };


    if (
        document.readyState ===
        "loading"
    ) {

        window.addEventListener(
            "load",
            initialize,
            {
                once: true
            }
        );

    }

    else {

        initialize();

    }

}


// ============================================================
// MANUAL CLEAN ELEMENT
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
// INITIALIZE CLEANER
// ============================================================

initializePageLoad();


console.log(
    "[WNC] 5.2 Part 4 - Cleaner + Auto Observer loaded"
);

})();
// ============================================================
// WNC 5.2 - PART 5/7
// SECTION: Spreadsheet Editor UI
// ============================================================

(() => {

"use strict";

const WNC = unsafeWindow.WNC;

let panel = null;
let selectedPack = "";


// ============================================================
// HELPERS
// ============================================================

function makeButton(
    text,
    action
) {

    const button =
        document.createElement("button");

    button.textContent = text;

    button.type = "button";

    button.onclick =
        action;

    return button;

}


function makeInput(
    value = "",
    type = "text"
) {

    const input =
        document.createElement("input");

    input.type =
        type;

    input.value =
        value ?? "";

    return input;

}


function makeCell(
    value
) {

    const td =
        document.createElement("td");

    if (
        value instanceof Node
    ) {

        td.appendChild(
            value
        );

    }

    else {

        td.textContent =
            String(
                value ?? ""
            );

    }

    return td;

}


function saveAndRender(
    render
) {

    setTimeout(
        render,
        0
    );

}


// ============================================================
// PACK SELECTOR
// ============================================================

function getPackNames() {

    return WNC.packs
        .getAll()
        .map(
            pack =>
                pack.name
        );

}


function ensureSelectedPack() {

    const names =
        getPackNames();


    if (
        selectedPack &&
        names.includes(
            selectedPack
        )
    ) {

        return;

    }


    selectedPack =
        names[0] || "";

}


// ============================================================
// CREATE PACK
// ============================================================

function createNewPack() {

    const name =
        prompt(
            "Pack name:"
        );


    if (
        name === null
    ) {

        return;

    }


    const trimmed =
        name.trim();


    if (!trimmed) {

        return;

    }


    const existing =
        WNC.packs.get(
            trimmed
        );


    if (existing) {

        alert(
            "A pack with that name already exists."
        );

        selectedPack =
            trimmed;

        return;

    }


    const pack =
        WNC.packs.create(
            trimmed
        );


    if (!pack) {

        alert(
            "Could not create pack."
        );

        return;

    }


    selectedPack =
        pack.name;


    renderEditor();

}


// ============================================================
// DELETE PACK
// ============================================================

function deletePack(
    pack
) {

    if (!pack)
        return;


    if (
        !confirm(
            `Delete pack "${pack.name}"?`
        )
    ) {

        return;

    }


    WNC.packs.remove(
        pack.name
    );


    ensureSelectedPack();

    renderEditor();

}


// ============================================================
// PACK ORDER
// ============================================================

function setPackOrder(
    pack,
    value
) {

    const db =
        WNC.database.load();


    const oldOrder =
        Number(
            pack.order
        );


    let newOrder =
        Number(
            value
        );


    if (
        !Number.isInteger(
            newOrder
        ) ||
        newOrder < 1
    ) {

        return;

    }


    const packs =
        db.packs
            .slice()
            .sort(
                (a, b) =>
                    a.order - b.order
            );


    const currentIndex =
        packs.indexOf(
            pack
        );


    if (
        currentIndex < 0
    ) {

        return;

    }


    if (
        newOrder === oldOrder
    ) {

        return;

    }


    if (
        newOrder > packs.length
    ) {

        newOrder =
            packs.length;

    }


    const targetIndex =
        newOrder - 1;


    packs.splice(
        currentIndex,
        1
    );


    packs.splice(
        targetIndex,
        0,
        pack
    );


    packs.forEach(
        (item, index) => {

            item.order =
                index + 1;

        }
    );


    WNC.database.save(
        db
    );


    renderEditor();

}


// ============================================================
// RULE ORDER
// ============================================================

function setRuleOrder(
    pack,
    rule,
    value
) {

    const db =
        WNC.database.load();


    const dbPack =
        db.packs.find(
            p =>
                p.name ===
                pack.name
        );


    if (!dbPack)
        return;


    let newOrder =
        Number(
            value
        );


    if (
        !Number.isInteger(
            newOrder
        ) ||
        newOrder < 1
    ) {

        return;

    }


    const rules =
        dbPack.rules
            .slice()
            .sort(
                (a, b) =>
                    a.order - b.order
            );


    const currentIndex =
        rules.findIndex(
            item =>
                item.order ===
                rule.order
        );


    if (
        currentIndex < 0
    ) {

        return;

    }


    if (
        newOrder > rules.length
    ) {

        newOrder =
            rules.length;

    }


    rules.splice(
        currentIndex,
        1
    );


    rules.splice(
        newOrder - 1,
        0,
        rule
    );


    rules.forEach(
        (item, index) => {

            item.order =
                index + 1;

        }
    );


    dbPack.rules =
        rules;


    WNC.database.save(
        db
    );


    renderEditor();

}


// ============================================================
// TYPE SWITCH
// ============================================================

function createTypeSwitch(
    rule,
    onChange
) {

    const button =
        document.createElement(
            "button"
        );


    button.type =
        "button";


    const types = [
        "whole",
        "text",
        "regex"
    ];


    function update() {

        button.textContent =
            rule.type === "regex"
                ? "R"
                : rule.type === "text"
                    ? "T"
                    : "W";

        button.title =
            `Type: ${rule.type}`;

    }


    button.onclick =
        () => {

            const index =
                types.indexOf(
                    rule.type
                );


            rule.type =
                types[
                    (index + 1) %
                    types.length
                ];


            WNC.rules.update(
                onChange.pack.name,
                onChange.rule.order,
                {
                    type:
                        rule.type
                }
            );


            update();

        };


    update();


    return button;

}


// ============================================================
// CASE SWITCH
// ============================================================

function createCaseSwitch(
    pack,
    rule
) {

    const button =
        document.createElement(
            "button"
        );


    button.type =
        "button";


    function update() {

        button.textContent =
            rule.caseSensitive
                ? "C+"
                : "C-";

        button.title =
            rule.caseSensitive
                ? "Case sensitive"
                : "Case insensitive";

    }


    button.onclick =
        () => {

            rule.caseSensitive =
                !rule.caseSensitive;


            WNC.rules.update(
                pack.name,
                rule.order,
                {
                    caseSensitive:
                        rule.caseSensitive
                }
            );


            WNC.replace.clearRegexCache();

            update();

        };


    update();


    return button;

}


// ============================================================
// PANEL
// ============================================================

function createPanel() {

    if (panel) {

        panel.remove();

    }


    panel =
        document.createElement(
            "div"
        );


    panel.id =
        "wnc-editor-panel";


    document.body.appendChild(
        panel
    );


    return panel;

}


// ============================================================
// TOP TOOLBAR
// ============================================================

function createTopToolbar() {

    const toolbar =
        document.createElement(
            "div"
        );


    toolbar.className =
        "wnc-editor-topbar";


    // --------------------------------------------------------
    // Pack search
    // --------------------------------------------------------

    const packSearch =
        makeInput(
            selectedPack
        );


    packSearch.className =
        "wnc-pack-search";


    packSearch.placeholder =
        "Pack";


    const packList =
        document.createElement(
            "datalist"
        );


    packList.id =
        "wnc-pack-list";


    getPackNames()
        .forEach(
            name => {

                const option =
                    document.createElement(
                        "option"
                    );

                option.value =
                    name;

                packList.appendChild(
                    option
                );

            }
        );


    packSearch.setAttribute(
        "list",
        "wnc-pack-list"
    );


    packSearch.onchange =
        () => {

            const name =
                packSearch.value.trim();


            if (
                WNC.packs.get(
                    name
                )
            ) {

                selectedPack =
                    name;

                renderEditor();

            }

        };


    packSearch.onkeydown =
        event => {

            if (
                event.key !==
                "Enter"
            ) {

                return;

            }


            event.preventDefault();


            const name =
                packSearch.value.trim();


            if (
                WNC.packs.get(
                    name
                )
            ) {

                selectedPack =
                    name;

                renderEditor();

            }

        };


    toolbar.appendChild(
        packSearch
    );


    toolbar.appendChild(
        packList
    );


    // --------------------------------------------------------
    // New Pack
    // --------------------------------------------------------

    toolbar.appendChild(
        makeButton(
            "+ Pack",
            createNewPack
        )
    );


    // --------------------------------------------------------
    // Template
    // --------------------------------------------------------

    const templateInput =
        makeInput(
            ""
        );


    templateInput.placeholder =
        "Template";


    templateInput.className =
        "wnc-template";


    toolbar.appendChild(
        templateInput
    );


    // --------------------------------------------------------
    // Generate
    // --------------------------------------------------------

    toolbar.appendChild(
        makeButton(
            "Generate",
            () => {

                const pack =
                    WNC.packs.get(
                        selectedPack
                    );


                if (!pack) {

                    alert(
                        "Select a pack first."
                    );

                    return;

                }


                const value =
                    templateInput.value;


                if (!value) {

                    return;

                }


                const generated =
                    generateRuleFromTemplate(
                        value
                    );


                if (!generated) {

                    return;

                }


                addPendingRule(
                    pack,
                    generated
                );

            }
        )
    );


    // --------------------------------------------------------
    // Apply
    // --------------------------------------------------------

    toolbar.appendChild(
        makeButton(
            "Apply",
            () => {

                WNC.replace.apply();

            }
        )
    );


    // --------------------------------------------------------
    // Undo
    // --------------------------------------------------------

    toolbar.appendChild(
        makeButton(
            "Undo",
            () => {

                WNC.replace.undo();

            }
        )
    );


    return toolbar;

}


// ============================================================
// TEMPLATE GENERATION
// ============================================================

function generateRuleFromTemplate(
    template
) {

    const text =
        String(
            template || ""
        ).trim();


    if (!text)
        return null;


    // --------------------------------------------------------
    // Supported template syntax:
    //
    //   {find}
    //   {replace}
    //   {regex}
    //   {text}
    //   {whole}
    //
    // If no markers exist, the phrase itself becomes Find.
    // --------------------------------------------------------

    const rule = {

        find:
            text,

        replace:
            "",

        type:
            "whole",

        caseSensitive:
            false,

        enabled:
            true

    };


    const regexMatch =
        text.match(
            /\{regex\}\s*(.*)/i
        );


    const textMatch =
        text.match(
            /\{text\}\s*(.*)/i
        );


    const wholeMatch =
        text.match(
            /\{whole\}\s*(.*)/i
        );


    if (regexMatch) {

        rule.type =
            "regex";

        rule.find =
            regexMatch[1].trim();

    }

    else if (textMatch) {

        rule.type =
            "text";

        rule.find =
            textMatch[1].trim();

    }

    else if (wholeMatch) {

        rule.type =
            "whole";

        rule.find =
            wholeMatch[1].trim();

    }


    return rule;

}


// ============================================================
// ADD NEW RULE
// ============================================================

function addPendingRule(
    pack,
    data
) {

    if (!pack)
        return null;


    if (!data.find)
        return null;


    const rule =
        WNC.rules.add(
            pack.name,
            data
        );


    if (!rule)
        return null;


    renderEditor();


    return rule;

}


// ============================================================
// RENDER EDITOR
// ============================================================

function renderEditor() {

    ensureSelectedPack();


    const root =
        createPanel();


    const header =
        document.createElement(
            "div"
        );


    header.className =
        "wnc-panel-header";


    const title =
        document.createElement(
            "b"
        );


    title.textContent =
        "WNC Scanner / Editor";


    header.appendChild(
        title
    );


    header.appendChild(
        makeButton(
            "X",
            () => {

                panel.remove();

                panel = null;

            }
        )
    );


    root.appendChild(
        header
    );


    root.appendChild(
        createTopToolbar()
    );


    const pack =
        WNC.packs.get(
            selectedPack
        );


    if (!pack) {

        const empty =
            document.createElement(
                "div"
            );

        empty.textContent =
            "Create or select a pack.";

        root.appendChild(
            empty
        );

        return;

    }


    root.appendChild(
        renderPackTable(
            pack
        )
    );

}


// ============================================================
// PACK TABLE
// ============================================================

function renderPackTable(
    selected
) {

    const wrapper =
        document.createElement(
            "div"
        );


    wrapper.className =
        "wnc-table-wrap";


    const table =
        document.createElement(
            "table"
        );


    table.className =
        "wnc-spreadsheet";


    table.innerHTML = `

        <thead>

            <tr>

                <th>#</th>

                <th>Pack</th>

                <th>Enabled</th>

                <th>Page</th>

                <th>Auto</th>

                <th>Rules</th>

                <th>Delete</th>

            </tr>

        </thead>

        <tbody></tbody>

    `;


    const tbody =
        table.querySelector(
            "tbody"
        );


    WNC.packs
        .getAll()
        .forEach(
            pack => {

                const row =
                    document.createElement(
                        "tr"
                    );


                const order =
                    makeInput(
                        pack.order,
                        "number"
                    );


                order.className =
                    "wnc-order";


                order.onchange =
                    () => {

                        setPackOrder(
                            pack,
                            order.value
                        );

                    };


                row.appendChild(
                    makeCell(
                        order
                    )
                );


                const name =
                    makeInput(
                        pack.name
                    );


                name.onchange =
                    () => {

                        const newName =
                            name.value.trim();


                        if (
                            !newName ||
                            newName ===
                            pack.name
                        ) {

                            return;

                        }


                        if (
                            WNC.packs.get(
                                newName
                            )
                        ) {

                            alert(
                                "A pack with that name already exists."
                            );

                            renderEditor();

                            return;

                        }


                        const oldName =
                            pack.name;


                        WNC.packs.update(
                            oldName,
                            {
                                name:
                                    newName
                            }
                        );


                        if (
                            selectedPack ===
                            oldName
                        ) {

                            selectedPack =
                                newName;

                        }


                        renderEditor();

                    };


                row.appendChild(
                    makeCell(
                        name
                    )
                );


                row.appendChild(
                    makeCell(
                        checkboxButton(
                            pack.enabled !== false,
                            value => {

                                WNC.packs.update(
                                    pack.name,
                                    {
                                        enabled:
                                            value
                                    }
                                );

                            }
                        )
                    )
                );


                row.appendChild(
                    makeCell(
                        checkboxButton(
                            pack.pageLoad !== false,
                            value => {

                                WNC.packs.update(
                                    pack.name,
                                    {
                                        pageLoad:
                                            value
                                    }
                                );

                            }
                        )
                    )
                );


                row.appendChild(
                    makeCell(
                        checkboxButton(
                            pack.auto !== false,
                            value => {

                                WNC.packs.update(
                                    pack.name,
                                    {
                                        auto:
                                            value
                                    }
                                );

                            }
                        )
                    )
                );


                const rulesButton =
                    makeButton(
                        String(
                            pack.rules.length
                        ),
                        () => {

                            selectedPack =
                                pack.name;

                            renderEditor();

                        }
                    );


                row.appendChild(
                    makeCell(
                        rulesButton
                    )
                );


                row.appendChild(
                    makeCell(
                        makeButton(
                            "Delete",
                            () =>
                                deletePack(
                                    pack
                                )
                        )
                    )
                );


                if (
                    pack.name ===
                    selected.name
                ) {

                    row.classList.add(
                        "selected"
                    );

                }


                tbody.appendChild(
                    row
                );

            }
        );


    wrapper.appendChild(
        table
    );


    wrapper.appendChild(
        renderRulesTable(
            selected
        )
    );


    return wrapper;

}


// ============================================================
// SIMPLE CHECK BUTTON
// ============================================================

function checkboxButton(
    checked,
    onChange
) {

    const button =
        document.createElement(
            "button"
        );


    button.type =
        "button";


    function update() {

        button.textContent =
            checked
                ? "✓"
                : "—";

    }


    button.onclick =
        () => {

            checked =
                !checked;

            onChange(
                checked
            );

            update();

        };


    update();


    return button;

}


// ============================================================
// RULE TABLE
// ============================================================

function renderRulesTable(
    pack
) {

    const wrapper =
        document.createElement(
            "div"
        );


    wrapper.className =
        "wnc-rules-section";


    const table =
        document.createElement(
            "table"
        );


    table.className =
        "wnc-spreadsheet";


    table.innerHTML = `

        <thead>

            <tr>

                <th>#</th>

                <th>Pack</th>

                <th>Enabled</th>

                <th>Find</th>

                <th>Replace</th>

                <th>Type</th>

                <th>Case</th>

                <th>Apply</th>

                <th>Delete</th>

            </tr>

        </thead>

        <tbody></tbody>

    `;


    const tbody =
        table.querySelector(
            "tbody"
        );


    pack.rules
        .slice()
        .sort(
            (a, b) =>
                a.order - b.order
        )
        .forEach(
            rule => {

                tbody.appendChild(
                    createRuleRow(
                        pack,
                        rule
                    )
                );

            }
        );


    wrapper.appendChild(
        table
    );


    return wrapper;

}


// ============================================================
// RULE ROW
// ============================================================

function createRuleRow(
    pack,
    rule
) {

    const row =
        document.createElement(
            "tr"
        );


    // --------------------------------------------------------
    // Order
    // --------------------------------------------------------

    const order =
        makeInput(
            rule.order,
            "number"
        );


    order.className =
        "wnc-order";


    order.onchange =
        () => {

            setRuleOrder(
                pack,
                rule,
                order.value
            );

        };


    row.appendChild(
        makeCell(
            order
        )
    );


    // --------------------------------------------------------
    // Pack
    // --------------------------------------------------------

    const packInput =
        makeInput(
            pack.name
        );


    packInput.readOnly =
        true;


    packInput.className =
        "wnc-pack-readonly";


    row.appendChild(
        makeCell(
            packInput
        )
    );


    // --------------------------------------------------------
    // Enabled
    // --------------------------------------------------------

    row.appendChild(
        makeCell(
            checkboxButton(
                rule.enabled !== false,
                value => {

                    WNC.rules.update(
                        pack.name,
                        rule.order,
                        {
                            enabled:
                                value
                        }
                    );

                }
            )
        )
    );


    // --------------------------------------------------------
    // Find
    // --------------------------------------------------------

    const find =
        makeInput(
            rule.find
        );


    find.className =
        "wnc-find";


    find.onchange =
        () => {

            WNC.rules.update(
                pack.name,
                rule.order,
                {
                    find:
                        find.value
                }
            );


            WNC.replace.clearRegexCache();

        };


    row.appendChild(
        makeCell(
            find
        )
    );


    // --------------------------------------------------------
    // Replace
    // --------------------------------------------------------

    const replace =
        makeInput(
            rule.replace
        );


    replace.className =
        "wnc-replace";


    replace.onchange =
        () => {

            WNC.rules.update(
                pack.name,
                rule.order,
                {
                    replace:
                        replace.value
                }
            );

        };


    row.appendChild(
        makeCell(
            replace
        )
    );


    // --------------------------------------------------------
    // Type
    // --------------------------------------------------------

    row.appendChild(
        makeCell(
            createTypeSwitch(
                rule,
                {
                    pack,
                    rule
                }
            )
        )
    );


    // --------------------------------------------------------
    // Case
    // --------------------------------------------------------

    row.appendChild(
        makeCell(
            createCaseSwitch(
                pack,
                rule
            )
        )
    );


    // --------------------------------------------------------
    // Apply
    //
    // New rules are generated/edited here but are not
    // considered committed to a pack until Apply is pressed.
    //
    // Existing rules already belong to their stored pack.
    // --------------------------------------------------------

    row.appendChild(
        makeCell(
            makeButton(
                "Apply",
                () => {

                    WNC.replace.clearUndo();

                    const result =
                        WNC.replace.testRule(
                            document.body?.innerText ||
                            "",
                            rule
                        );


                    if (
                        result.changed
                    ) {

                        WNC.replace.apply();

                    }

                }
            )
        )
    );


    // --------------------------------------------------------
    // Delete
    // --------------------------------------------------------

    row.appendChild(
        makeCell(
            makeButton(
                "Delete",
                () => {

                    if (
                        !confirm(
                            "Delete this rule?"
                        )
                    ) {

                        return;

                    }


                    WNC.rules.remove(
                        pack.name,
                        rule.order
                    );


                    renderEditor();

                }
            )
        )
    );


    return row;

}


// ============================================================
// PUBLIC API
// ============================================================

function openEditor() {

    renderEditor();

}


WNC.editor = {

    open:
        openEditor,

    refresh:
        renderEditor

};


// ============================================================
// CSS
// ============================================================

GM_addStyle(`

#wnc-editor-panel {

    position:fixed;

    top:20px;
    left:50%;

    transform:translateX(-50%);

    width:1100px;
    max-width:calc(100vw - 20px);

    max-height:92vh;

    overflow:auto;

    z-index:999999;

    background:#222;

    color:#fff;

    border:1px solid #777;

    border-radius:4px;

    padding:5px;

    font:12px Arial,sans-serif;

    box-shadow:
        0 4px 20px rgba(0,0,0,.5);

}


#wnc-editor-panel
.wnc-panel-header {

    position:sticky;

    top:0;

    z-index:10;

    display:flex;

    justify-content:space-between;

    align-items:center;

    background:#222;

    padding:2px 0;

    margin:0;

}


#wnc-editor-panel
.wnc-editor-topbar {

    position:sticky;

    top:22px;

    z-index:9;

    display:flex;

    align-items:center;

    gap:3px;

    background:#222;

    padding:3px 0;

    margin:0;

    border-bottom:1px solid #555;

}


#wnc-editor-panel
.wnc-editor-topbar input {

    height:24px;

    padding:2px 4px;

}


#wnc-editor-panel
.wnc-pack-search {

    width:150px;

}


#wnc-editor-panel
.wnc-template {

    width:220px;

}


#wnc-editor-panel
button,
#wnc-editor-panel
input {

    box-sizing:border-box;

    font:12px Arial,sans-serif;

}


#wnc-editor-panel
button {

    height:24px;

    padding:2px 6px;

    cursor:pointer;

}


#wnc-editor-panel
input {

    min-width:0;

    padding:2px 4px;

}


#wnc-editor-panel
.wnc-table-wrap {

    margin:0;

}


#wnc-editor-panel
table {

    width:100%;

    border-collapse:collapse;

    table-layout:auto;

}


#wnc-editor-panel
th,
#wnc-editor-panel
td {

    padding:2px 3px;

    border:1px solid #555;

    vertical-align:middle;

    text-align:left;

    white-space:nowrap;

}


#wnc-editor-panel
th {

    position:sticky;

    z-index:5;

    background:#292929;

}


#wnc-editor-panel
.wnc-spreadsheet {

    width:max-content;

    min-width:100%;

}


#wnc-editor-panel
.wnc-spreadsheet
input {

    width:auto;

}


#wnc-editor-panel
.wnc-order {

    width:42px !important;

}


#wnc-editor-panel
.wnc-pack-readonly {

    width:130px;

}


#wnc-editor-panel
.wnc-find {

    width:260px;

}


#wnc-editor-panel
.wnc-replace {

    width:260px;

}


#wnc-editor-panel
.selected {

    outline:1px solid #888;

}


#wnc-editor-panel
.wnc-rules-section {

    margin-top:3px;

}


#wnc-editor-panel
input[type="number"] {

    -moz-appearance:textfield;

}


#wnc-editor-panel
input[type="number"]::-webkit-inner-spin-button,
#wnc-editor-panel
input[type="number"]::-webkit-outer-spin-button {

    margin:0;

}

`);


// ============================================================
// DIAGNOSTIC
// ============================================================

console.log(
    "[WNC] 5.2 Part 5 - Spreadsheet Editor loaded"
);

})();
// ============================================================
// WNC 5.1 - PART 6/7
// SECTION: Scanner + Inspector + Diagnostics
// ============================================================

(function(){

"use strict";

const WNC = unsafeWindow.WNC;

let toolPanel = null;


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

    toolPanel.querySelector(
        "#wnc-tool-close"
    ).onclick = () => {

        toolPanel.remove();
        toolPanel = null;

    };

    return toolPanel.querySelector(
        "#wnc-tool-content"
    );

}


// ============================================================
// SCANNER STATE
// ============================================================

let scannerState = {

    results: [],

    selectedPack: "",

    template: "",

    generated: new Map()

};


// ============================================================
// PACK HELPERS
// ============================================================

function getAllPacks(){

    return WNC.packs
        .getAll()
        .slice()
        .sort(
            (a,b) =>
                Number(a.order) -
                Number(b.order)
        );

}


function getPackByName(name){

    if(!name)
        return null;

    return WNC.packs.get(
        name
    );

}


// ============================================================
// RULE LOOKUP
// ============================================================

function getExistingRuleMap(){

    const map = new Map();

    getAllPacks().forEach(pack => {

        pack.rules
            .slice()
            .sort(
                (a,b) =>
                    Number(a.order) -
                    Number(b.order)
            )
            .forEach(rule => {

                if(!rule.find)
                    return;

                const key =
                    rule.type +
                    "\u0000" +
                    String(rule.find);

                if(!map.has(key)){

                    map.set(
                        key,
                        {
                            pack,
                            rule
                        }
                    );

                }

            });

    });

    return map;

}


// ============================================================
// SCAN TEXT
//
// Scanner deliberately looks for BOTH:
//
// 1. Existing rules.
// 2. Text that has no existing rule.
//
// This prevents unruled phrases from disappearing
// from the scanner.
// ============================================================

function scanPage(){

    const body =
        document.body;

    if(!body)
        return [];


    const text =
        body.innerText || "";


    const results = [];

    const existing =
        getExistingRuleMap();


    // --------------------------------------------------------
    // Existing rules
    // --------------------------------------------------------

    getAllPacks().forEach(pack => {

        pack.rules
            .slice()
            .sort(
                (a,b) =>
                    Number(a.order) -
                    Number(b.order)
            )
            .forEach(rule => {

                if(!rule.find)
                    return;


                const before =
                    text;


                const after =
                    WNC.replace.replaceValue(
                        before,
                        rule
                    );


                if(after === before)
                    return;


                const count =
                    countRuleMatches(
                        text,
                        rule
                    );


                results.push({

                    kind: "rule",

                    pack:
                        pack.name,

                    packOrder:
                        pack.order,

                    ruleOrder:
                        rule.order,

                    find:
                        rule.find,

                    replace:
                        rule.replace,

                    type:
                        rule.type,

                    caseSensitive:
                        rule.caseSensitive,

                    count,

                    existing: true

                });

            });

    });


    // --------------------------------------------------------
    // Unruled phrases
    //
    // The scanner identifies repeated meaningful text that
    // does not already have a rule.
    // --------------------------------------------------------

    const unruled =
        findUnruledPhrases(
            text,
            existing
        );


    unruled.forEach(item => {

        results.push({

            kind: "unruled",

            pack: "",

            packOrder: "",

            ruleOrder: "",

            find:
                item.text,

            replace: "",

            type: "whole",

            caseSensitive: false,

            count:
                item.count,

            existing: false

        });

    });


    return results;

}


// ============================================================
// COUNT RULE MATCHES
// ============================================================

function countRuleMatches(
    text,
    rule
){

    if(!text || !rule || !rule.find)
        return 0;


    const testRule = {

        ...rule,

        enabled: true

    };


    let count = 0;


    try {

        const pattern =
            buildScannerPattern(
                testRule
            );


        if(!pattern)
            return 0;


        const matches =
            text.match(pattern);


        count =
            matches
                ? matches.length
                : 0;

    }

    catch(error){

        console.warn(
            "[WNC] Scanner count failed:",
            error
        );

    }


    return count;

}


// ============================================================
// BUILD SCANNER REGEX
// ============================================================

function buildScannerPattern(rule){

    const flags =
        rule.caseSensitive
            ? "g"
            : "gi";


    if(rule.type === "regex"){

        return new RegExp(
            rule.find,
            flags
        );

    }


    const escaped =
        String(rule.find)
            .replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );


    if(rule.type === "text"){

        return new RegExp(
            escaped,
            flags
        );

    }


    return new RegExp(

        "(?<![\\w-])" +
        escaped +
        "(?![\\w-])",

        flags

    );

}


// ============================================================
// FIND UNRULED PHRASES
// ============================================================
//
// Conservative scanner:
// - ignores very short tokens
// - ignores numbers
// - ignores punctuation-only values
// - finds repeated words/phrases
// - existing rules are excluded
//
// These are suggestions only. They do not become rules until
// Apply is pressed.
// ============================================================

function findUnruledPhrases(
    text,
    existing
){

    const results = [];

    if(!text)
        return results;


    const normalized =
        text
            .replace(
                /\s+/g,
                " "
            )
            .trim();


    if(!normalized)
        return results;


    const counts = new Map();


    // --------------------------------------------------------
    // Single words
    // --------------------------------------------------------

    const words =
        normalized.match(
            /[A-Za-z][A-Za-z0-9'-]{2,}/g
        ) || [];


    words.forEach(word => {

        const value =
            word.trim();


        if(!value)
            return;


        if(/^\d+$/.test(value))
            return;


        const key =
            value.toLowerCase();


        if(!counts.has(key)){

            counts.set(
                key,
                {
                    text: value,
                    count: 0
                }
            );

        }


        counts.get(key).count++;

    });


    // --------------------------------------------------------
    // Two-word phrases
    // --------------------------------------------------------

    const phraseWords =
        normalized.match(
            /[A-Za-z][A-Za-z0-9'-]{1,}/g
        ) || [];


    for(
        let i = 0;
        i < phraseWords.length - 1;
        i++
    ){

        const phrase =
            phraseWords[i] +
            " " +
            phraseWords[i + 1];


        const key =
            phrase.toLowerCase();


        if(!counts.has(key)){

            counts.set(
                key,
                {
                    text: phrase,
                    count: 0
                }
            );

        }


        counts.get(key).count++;

    }


    counts.forEach(item => {

        if(item.count < 2)
            return;


        const key =
            "whole" +
            "\u0000" +
            item.text;


        if(existing.has(key))
            return;


        // Check case-insensitively against existing
        // rules of all types.

        let alreadyRuled = false;


        existing.forEach(entry => {

            if(alreadyRuled)
                return;


            const rule =
                entry.rule;


            if(
                rule.type === "regex"
            ){

                try {

                    const regex =
                        new RegExp(
                            rule.find,
                            rule.caseSensitive
                                ? "i"
                                : "i"
                        );


                    if(
                        regex.test(
                            item.text
                        )
                    ){

                        alreadyRuled = true;

                    }

                }

                catch(error){}

            }

            else if(
                rule.find
                    .toLowerCase() ===
                item.text.toLowerCase()
            ){

                alreadyRuled = true;

            }

        });


        if(alreadyRuled)
            return;


        results.push(item);

    });


    return results
        .sort(
            (a,b) =>
                b.count - a.count
        )
        .slice(
            0,
            250
        );

}


// ============================================================
// DISPLAY ABBREVIATIONS
// ============================================================

function typeLabel(type){

    switch(type){

        case "regex":
            return "R";

        case "text":
            return "T";

        case "whole":
        default:
            return "W";

    }

}


function caseLabel(value){

    return value
        ? "C"
        : "";

}


// ============================================================
// PACK SELECTOR
// ============================================================

function createPackSelector(){

    const wrap =
        document.createElement("div");

    wrap.className =
        "wnc-scanner-pack-selector";


    const label =
        document.createElement("span");

    label.textContent =
        "Pack";

    wrap.appendChild(label);


    const select =
        document.createElement("select");


    const blank =
        document.createElement("option");

    blank.value = "";

    blank.textContent =
        "— select pack —";

    select.appendChild(
        blank
    );


    getAllPacks().forEach(pack => {

        const option =
            document.createElement("option");

        option.value =
            pack.name;

        option.textContent =
            `${pack.order}. ${pack.name}`;

        select.appendChild(
            option
        );

    });


    const newOption =
        document.createElement("option");

    newOption.value =
        "__NEW__";

    newOption.textContent =
        "+ New Pack";

    select.appendChild(
        newOption
    );


    select.value =
        scannerState.selectedPack;


    select.onchange = () => {

        if(
            select.value ===
            "__NEW__"
        ){

            const name =
                prompt(
                    "New pack name:"
                );


            if(
                !name ||
                !name.trim()
            ){

                select.value =
                    scannerState.selectedPack;

                return;

            }


            const created =
                WNC.packs.create(
                    name.trim()
                );


            if(!created){

                alert(
                    "A pack with that name already exists."
                );


                select.value =
                    scannerState.selectedPack;

                return;

            }


            scannerState.selectedPack =
                created.name;

            refreshScanner();

            return;

        }


        scannerState.selectedPack =
            select.value;


        renderScannerTable();

    };


    wrap.appendChild(select);


    return wrap;

}


// ============================================================
// TOP TOOLBAR
// ============================================================

function createScannerToolbar(
    content
){

    const toolbar =
        document.createElement("div");

    toolbar.className =
        "wnc-scanner-toolbar";


    toolbar.appendChild(
        createPackSelector()
    );


    // --------------------------------------------------------
    // Template
    // --------------------------------------------------------

    const templateLabel =
        document.createElement("span");

    templateLabel.textContent =
        "Template";

    toolbar.appendChild(
        templateLabel
    );


    const templateInput =
        document.createElement("input");

    templateInput.type =
        "text";

    templateInput.placeholder =
        "replacement template";

    templateInput.value =
        scannerState.template || "";


    templateInput.oninput = () => {

        scannerState.template =
            templateInput.value;

    };


    toolbar.appendChild(
        templateInput
    );


    // --------------------------------------------------------
    // Generate
    // --------------------------------------------------------

    const generateButton =
        document.createElement("button");

    generateButton.textContent =
        "Generate";


    generateButton.onclick = () => {

        generateNewRules();

        renderScannerTable();

    };


    toolbar.appendChild(
        generateButton
    );


    // --------------------------------------------------------
    // Scan
    // --------------------------------------------------------

    const scanButton =
        document.createElement("button");

    scanButton.textContent =
        "Scan";


    scanButton.onclick = () => {

        scannerState.results =
            scanPage();

        renderScannerTable();

    };


    toolbar.appendChild(
        scanButton
    );


    // --------------------------------------------------------
    // Apply
    // --------------------------------------------------------

    const applyButton =
        document.createElement("button");

    applyButton.textContent =
        "Apply";


    applyButton.className =
        "wnc-primary-button";


    applyButton.onclick = () => {

        applySelectedRows();

    };


    toolbar.appendChild(
        applyButton
    );


    return toolbar;

}


// ============================================================
// GENERATE NEW RULES
// ============================================================
//
// Generation is ONLY for unruled rows.
//
// Once Apply creates the rule, the generated replacement is
// stored in the database and no longer changes when the
// template changes.
// ============================================================

function generateNewRules(){

    const template =
        scannerState.template || "";


    scannerState.results
        .filter(
            result =>
                result.kind === "unruled"
        )
        .forEach(result => {

            const key =
                result.find;


            const generated =
                applyTemplate(
                    template,
                    result
                );


            scannerState.generated.set(
                key,
                generated
            );

        });

}


// ============================================================
// APPLY TEMPLATE
// ============================================================

function applyTemplate(
    template,
    result
){

    if(!template)
        return "";


    return String(template)
        .replace(
            /\{find\}/gi,
            result.find
        )
        .replace(
            /\{text\}/gi,
            result.find
        )
        .replace(
            /\{count\}/gi,
            String(result.count)
        );

}


// ============================================================
// APPLY SELECTED / GENERATED RULES
// ============================================================

function applySelectedRows(){

    const packName =
        scannerState.selectedPack;


    if(!packName){

        alert(
            "Select a pack before applying a new rule."
        );

        return;

    }


    const pack =
        getPackByName(
            packName
        );


    if(!pack){

        alert(
            "Selected pack no longer exists."
        );

        return;

    }


    let added = 0;


    scannerState.results
        .filter(
            result =>
                result.kind === "unruled"
        )
        .forEach(result => {

            const replacement =
                scannerState.generated.has(
                    result.find
                )
                    ? scannerState.generated.get(
                        result.find
                    )
                    : "";


            // Blank generated replacements are allowed.
            // The important part is that the rule is now
            // explicitly committed to the selected pack.

            WNC.rules.add(
                pack.name,
                {

                    find:
                        result.find,

                    replace:
                        replacement,

                    type:
                        result.type || "whole",

                    caseSensitive:
                        result.caseSensitive === true,

                    enabled:
                        true

                }
            );


            added++;

        });


    if(added){

        scannerState.results =
            scanPage();

        scannerState.generated.clear();

        renderScannerTable();

    }

}


// ============================================================
// CREATE SCANNER ROW
// ============================================================

function createScannerRow(
    result,
    index
){

    const row =
        document.createElement("tr");


    row.dataset.index =
        String(index);


    // --------------------------------------------------------
    // Select
    // --------------------------------------------------------

    const selectCell =
        document.createElement("td");


    const checkbox =
        document.createElement("input");

    checkbox.type =
        "checkbox";

    checkbox.checked =
        result.kind === "unruled";


    checkbox.dataset.scannerSelect =
        "true";


    selectCell.appendChild(
        checkbox
    );


    row.appendChild(
        selectCell
    );


    // --------------------------------------------------------
    // Pack order
    // --------------------------------------------------------

    const packOrder =
        document.createElement("td");

    packOrder.textContent =
        result.packOrder === ""
            ? ""
            : String(
                result.packOrder
            );

    row.appendChild(
        packOrder
    );


    // --------------------------------------------------------
    // Rule order
    // --------------------------------------------------------

    const ruleOrder =
        document.createElement("td");

    ruleOrder.textContent =
        result.ruleOrder === ""
            ? ""
            : String(
                result.ruleOrder
            );

    row.appendChild(
        ruleOrder
    );


    // --------------------------------------------------------
    // Pack
    // --------------------------------------------------------

    const packCell =
        document.createElement("td");

    packCell.textContent =
        result.pack || "";

    row.appendChild(
        packCell
    );


    // --------------------------------------------------------
    // Find
    // --------------------------------------------------------

    const findCell =
        document.createElement("td");


    const findInput =
        document.createElement("input");

    findInput.type =
        "text";

    findInput.value =
        result.find || "";


    findInput.className =
        "wnc-scanner-find";


    // Existing rules are editable here.
    // New scanner identities are also editable here.

    findInput.onchange = () => {

        result.find =
            findInput.value;

    };


    findCell.appendChild(
        findInput
    );

    row.appendChild(
        findCell
    );


    // --------------------------------------------------------
    // Replace
    // --------------------------------------------------------

    const replaceCell =
        document.createElement("td");


    const replaceInput =
        document.createElement("input");

    replaceInput.type =
        "text";


    replaceInput.className =
        "wnc-scanner-replace";


    if(result.kind === "unruled"){

        replaceInput.value =
            scannerState.generated.has(
                result.find
            )
                ? scannerState.generated.get(
                    result.find
                )
                : "";

    }
    else{

        replaceInput.value =
            result.replace || "";

    }


    replaceInput.oninput = () => {

        result.replace =
            replaceInput.value;


        if(
            result.kind === "unruled"
        ){

            scannerState.generated.set(
                result.find,
                replaceInput.value
            );

        }

    };


    replaceCell.appendChild(
        replaceInput
    );

    row.appendChild(
        replaceCell
    );


    // --------------------------------------------------------
    // Type
    // --------------------------------------------------------

    const typeCell =
        document.createElement("td");


    const typeSwitch =
        document.createElement("button");


    typeSwitch.type =
        "button";


    typeSwitch.className =
        "wnc-type-switch";


    const types = [
        "whole",
        "text",
        "regex"
    ];


    let typeIndex =
        Math.max(
            0,
            types.indexOf(
                result.type
            )
        );


    function updateType(){

        result.type =
            types[typeIndex];


        typeSwitch.textContent =
            typeLabel(
                result.type
            );


        typeSwitch.title =
            result.type;

    }


    typeSwitch.onclick = () => {

        typeIndex =
            (
                typeIndex + 1
            ) %
            types.length;


        updateType();

    };


    updateType();


    typeCell.appendChild(
        typeSwitch
    );


    row.appendChild(
        typeCell
    );


    // --------------------------------------------------------
    // Case
    // --------------------------------------------------------

    const caseCell =
        document.createElement("td");


    const caseSwitch =
        document.createElement("button");


    caseSwitch.type =
        "button";


    caseSwitch.className =
        "wnc-case-switch";


    function updateCase(){

        caseSwitch.textContent =
            caseLabel(
                result.caseSensitive
            );


        caseSwitch.title =
            result.caseSensitive
                ? "Case sensitive"
                : "Case insensitive";

    }


    caseSwitch.onclick = () => {

        result.caseSensitive =
            !result.caseSensitive;


        updateCase();

    };


    updateCase();


    caseCell.appendChild(
        caseSwitch
    );


    row.appendChild(
        caseCell
    );


    // --------------------------------------------------------
    // Count
    // --------------------------------------------------------

    const countCell =
        document.createElement("td");


    countCell.textContent =
        String(
            result.count || 0
        );


    row.appendChild(
        countCell
    );


    // --------------------------------------------------------
    // Status
    // --------------------------------------------------------

    const statusCell =
        document.createElement("td");


    statusCell.textContent =
        result.kind === "rule"
            ? "Rule"
            : "New";


    statusCell.className =
        result.kind === "rule"
            ? "wnc-status-existing"
            : "wnc-status-new";


    row.appendChild(
        statusCell
    );


    return row;

}


// ============================================================
// SCANNER TABLE
// ============================================================

function renderScannerTable(){

    const output =
        toolPanel?.querySelector(
            "#wnc-scanner-output"
        );


    if(!output)
        return;


    output.innerHTML = "";


    const results =
        scannerState.results;


    if(!results.length){

        output.textContent =
            "No rule matches or unruled repeated phrases found.";

        return;

    }


    const table =
        document.createElement("table");


    table.className =
        "wnc-scanner-table";


    table.innerHTML = `
        <thead>
            <tr>
                <th>Select</th>
                <th>P#</th>
                <th>R#</th>
                <th>Pack</th>
                <th>Find</th>
                <th>Replace</th>
                <th>Type</th>
                <th>Case</th>
                <th>Co</th>
                <th>Status</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;


    const tbody =
        table.querySelector(
            "tbody"
        );


    results.forEach(
        (result,index) => {

            tbody.appendChild(
                createScannerRow(
                    result,
                    index
                )
            );

        }
    );


    output.appendChild(
        table
    );

}


// ============================================================
// SCANNER
// ============================================================

function openScanner(){

    const content =
        createToolPanel(
            "WNC Scanner"
        );


    const toolbar =
        createScannerToolbar(
            content
        );


    content.appendChild(
        toolbar
    );


    const output =
        document.createElement("div");


    output.id =
        "wnc-scanner-output";


    content.appendChild(
        output
    );


    scannerState.results =
        scanPage();


    renderScannerTable();

}


// ============================================================
// REFRESH SCANNER
// ============================================================

function refreshScanner(){

    if(!toolPanel)
        return;


    const content =
        toolPanel.querySelector(
            "#wnc-tool-content"
        );


    if(!content)
        return;


    content.innerHTML = "";


    const toolbar =
        createScannerToolbar(
            content
        );


    content.appendChild(
        toolbar
    );


    const output =
        document.createElement("div");


    output.id =
        "wnc-scanner-output";


    content.appendChild(
        output
    );


    scannerState.results =
        scanPage();


    renderScannerTable();

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
                <th>P#</th>
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
        table.querySelector(
            "tbody"
        );


    getAllPacks()
        .filter(
            pack =>
                WNC.packs
                    .getMatched(
                        location.hostname
                    )
                    .some(
                        matched =>
                            matched.name ===
                            pack.name
                    )
        )
        .forEach(pack => {

            const row =
                document.createElement("tr");


            const values = [

                String(
                    pack.order
                ),

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

                String(
                    pack.rules.length
                )

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


    content.appendChild(
        table
    );

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
    let duplicatePackOrders = 0;
    let duplicateRuleOrders = 0;


    const packOrders =
        new Set();


    db.packs.forEach(pack => {

        packCount++;


        if(
            packOrders.has(
                pack.order
            )
        ){

            duplicatePackOrders++;

            report.push(
                `Duplicate pack order: ${pack.order}`
            );

        }


        packOrders.add(
            pack.order
        );


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


        const ruleOrders =
            new Set();


        pack.rules.forEach(rule => {

            ruleCount++;


            if(
                ruleOrders.has(
                    rule.order
                )
            ){

                duplicateRuleOrders++;

                report.push(
                    `Duplicate rule order ${rule.order} in pack "${pack.name}".`
                );

            }


            ruleOrders.add(
                rule.order
            );


            if(!rule.find){

                emptyRules++;

            }


            if(
                rule.type === "regex"
            ){

                try {

                    new RegExp(
                        rule.find
                    );

                }

                catch(error){

                    badRegex++;

                    report.push(
                        `Bad regex in "${pack.name}" #${rule.order}: ${rule.find}`
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

        `Duplicate pack orders: ${duplicatePackOrders}`,

        `Duplicate rule orders: ${duplicateRuleOrders}`,

        ""

    );


    if(
        emptyRules === 0 &&
        badRegex === 0 &&
        duplicatePackOrders === 0 &&
        duplicateRuleOrders === 0
    ){

        report.push(
            "Database looks healthy."
        );

    }


    return report.join(
        "\n"
    );

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


    content.appendChild(
        button
    );


    content.appendChild(
        output
    );

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
//
// Spreadsheet-style scanner:
// - minimal padding
// - fixed header
// - compact columns
// - horizontal scrolling when necessary
// - top toolbar remains visible
// ============================================================

GM_addStyle(`

#wnc-tool-panel {

    position:fixed;

    top:40px;
    left:50%;

    transform:translateX(-50%);

    width:min(1400px,calc(100vw - 20px));

    max-width:calc(100vw - 20px);

    height:calc(100vh - 80px);

    overflow:hidden;

    z-index:999999;

    background:#222;
    color:#fff;

    border:1px solid #777;

    border-radius:4px;

    padding:6px;

    box-sizing:border-box;

    font:12px Arial,sans-serif;

    box-shadow:
        0 4px 20px rgba(0,0,0,.5);

}


#wnc-tool-panel
.wnc-panel-header {

    height:26px;

    display:flex;

    justify-content:space-between;

    align-items:center;

    margin:0 0 4px 0;

}


#wnc-tool-panel
.wnc-panel-header button {

    padding:2px 6px;

}


#wnc-tool-panel
#wnc-tool-content {

    height:calc(100% - 30px);

    overflow:auto;

}


#wnc-tool-panel
.wnc-scanner-toolbar {

    position:sticky;

    top:0;

    z-index:20;

    display:flex;

    align-items:center;

    gap:4px;

    min-height:30px;

    padding:3px 0;

    background:#222;

    border-bottom:1px solid #555;

}


#wnc-tool-panel
.wnc-scanner-toolbar span {

    white-space:nowrap;

}


#wnc-tool-panel
.wnc-scanner-toolbar input {

    width:180px;

    min-width:80px;

}


#wnc-tool-panel
.wnc-scanner-toolbar select {

    width:180px;

}


#wnc-tool-panel
.wnc-scanner-toolbar button,
#wnc-tool-panel
.wnc-scanner-toolbar input,
#wnc-tool-panel
.wnc-scanner-toolbar select {

    height:24px;

    box-sizing:border-box;

    font:12px Arial,sans-serif;

}


#wnc-tool-panel
.wnc-scanner-table {

    width:max-content;

    min-width:100%;

    border-collapse:collapse;

    table-layout:auto;

}


#wnc-tool-panel
.wnc-scanner-table th {

    position:sticky;

    top:30px;

    z-index:10;

    background:#2a2a2a;

}


#wnc-tool-panel
.wnc-scanner-table th,
#wnc-tool-panel
.wnc-scanner-table td {

    padding:2px 4px;

    height:24px;

    border:1px solid #4d4d4d;

    vertical-align:middle;

    white-space:nowrap;

}


#wnc-tool-panel
.wnc-scanner-table th {

    text-align:left;

    font-weight:bold;

}


#wnc-tool-panel
.wnc-scanner-table td:nth-child(1) {

    width:40px;

    text-align:center;

}


#wnc-tool-panel
.wnc-scanner-table td:nth-child(2),
#wnc-tool-panel
.wnc-scanner-table td:nth-child(3) {

    width:40px;

    text-align:center;

}


#wnc-tool-panel
.wnc-scanner-table td:nth-child(4) {

    width:1%;

}


#wnc-tool-panel
.wnc-scanner-find,
#wnc-tool-panel
.wnc-scanner-replace {

    width:100%;

    min-width:180px;

    max-width:500px;

    height:22px;

    padding:1px 3px;

    box-sizing:border-box;

    border:1px solid #555;

    background:#111;

    color:#fff;

    font:12px Arial,sans-serif;

}


#wnc-tool-panel
.wnc-scanner-table td:nth-child(5) {

    min-width:200px;

    width:28vw;

}


#wnc-tool-panel
.wnc-scanner-table td:nth-child(6) {

    min-width:180px;

    width:24vw;

}


#wnc-tool-panel
.wnc-type-switch,
#wnc-tool-panel
.wnc-case-switch {

    min-width:28px;

    height:22px;

    padding:1px 5px;

    border:1px solid #666;

    background:#333;

    color:#fff;

    cursor:pointer;

    font:bold 11px Arial,sans-serif;

}


#wnc-tool-panel
.wnc-status-existing {

    font-weight:bold;

}


#wnc-tool-panel
.wnc-status-new {

    font-weight:bold;

}


#wnc-tool-panel
.wnc-primary-button {

    font-weight:bold;

}


#wnc-tool-panel
button {

    cursor:pointer;

    font:12px Arial,sans-serif;

}


#wnc-tool-panel
pre {

    margin-top:8px;

}


`);

console.log(
    "[WNC] v5.1 Part 6 Scanner/Tools loaded"
);

})();
// ============================================================
// WNC v5.1 - PART 7/7
// SECTION: Initialization + Menu + Tools
// ============================================================

(function(){

"use strict";

const WNC = unsafeWindow.WNC;


// ============================================================
// INTERNAL UI REFRESH EVENT
// ============================================================

function notifyDatabaseChanged(){

    try {

        window.dispatchEvent(
            new CustomEvent(
                "wnc:database-changed"
            )
        );

    }
    catch(error){

        console.warn(
            "[WNC] UI refresh notification failed:",
            error
        );

    }

}


// ============================================================
// DOWNLOAD JSON
// ============================================================

function downloadJSON(
    data,
    filename
){

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


    link.href =
        url;

    link.download =
        filename;


    document.body.appendChild(
        link
    );


    link.click();


    link.remove();


    setTimeout(
        () => {

            URL.revokeObjectURL(
                url
            );

        },
        1000
    );

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
// CHOOSE JSON FILE
// ============================================================

function chooseJSONFile(
    callback
){

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


            if(!file)
                return;


            try {

                const text =
                    await file.text();


                const data =
                    JSON.parse(
                        text
                    );


                callback(
                    data
                );

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


    input.click();

}


// ============================================================
// VALID FOXREPLACE DATA
// ============================================================

function isFoxReplaceData(
    data
){

    return (
        data &&
        typeof data === "object" &&
        Array.isArray(data.groups)
    );

}


// ============================================================
// IMPORT FOXREPLACE
// ============================================================

function importFoxReplace(){

    chooseJSONFile(
        data => {

            if(
                !isFoxReplaceData(
                    data
                )
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


            notifyDatabaseChanged();


            alert(

                "FoxReplace Import Complete\n\n" +

                "Imported Packs: " +
                report.packs +

                "\nNew Packs: " +
                report.addedPacks +

                "\nRules Added: " +
                report.addedRules

            );

        }
    );

}


// ============================================================
// MERGE FOXREPLACE
// ============================================================

function mergeFoxReplace(){

    chooseJSONFile(
        data => {

            if(
                !isFoxReplaceData(
                    data
                )
            ){

                alert(
                    "This does not appear to be a FoxReplace JSON file."
                );

                return;

            }


            const report =
                WNC.foxReplace.merge(
                    data
                );


            if(!report){

                alert(
                    "FoxReplace merge failed."
                );

                return;

            }


            notifyDatabaseChanged();


            alert(

                "FoxReplace Merge Complete\n\n" +

                "Imported Packs: " +
                report.packs +

                "\nNew Packs: " +
                report.addedPacks +

                "\nRules Added: " +
                report.addedRules

            );

        }
    );

}


// ============================================================
// REPLACE DATABASE WITH FOXREPLACE
// ============================================================

function replaceWithFoxReplace(){

    if(
        !confirm(
            "Replace the current WNC database with the FoxReplace file?"
        )
    ){

        return;

    }


    chooseJSONFile(
        data => {

            if(
                !isFoxReplaceData(
                    data
                )
            ){

                alert(
                    "This does not appear to be a FoxReplace JSON file."
                );

                return;

            }


            const result =
                WNC.foxReplace.replace(
                    data
                );


            if(!result){

                alert(
                    "FoxReplace replacement failed."
                );

                return;

            }


            notifyDatabaseChanged();


            alert(

                "WNC database replaced.\n\n" +

                "Packs: " +
                result.packs +

                "\nRules: " +
                result.rules

            );

        }
    );

}


// ============================================================
// IMPORT WNC BACKUP
// ============================================================

function importWNCBackup(){

    chooseJSONFile(
        data => {

            if(
                !data ||
                !Array.isArray(
                    data.packs
                )
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
            ){

                return;

            }


            try {

                const migrated =
                    WNC.database.migrate(
                        data
                    );


                WNC.database.save(
                    migrated
                );


                notifyDatabaseChanged();


                alert(
                    "WNC database imported."
                );

            }
            catch(error){

                console.error(
                    "[WNC] WNC backup import failed:",
                    error
                );


                alert(
                    "WNC database import failed."
                );

            }

        }
    );

}


// ============================================================
// APPLY
// ============================================================

function apply(){

    const changes =
        WNC.replace.apply();


    if(
        changes > 0
    ){

        console.log(
            `[WNC] Applied ${changes} change(s).`
        );

    }

}


// ============================================================
// UNDO
// ============================================================

function undo(){

    const restored =
        WNC.replace.undo();


    if(
        restored > 0
    ){

        console.log(
            `[WNC] Undid ${restored} change(s).`
        );

    }

}


// ============================================================
// MATCHED PACKS
// ============================================================

function getMatchedPacks(){

    return WNC.packs.getMatched(
        location.hostname
    );

}


// ============================================================
// SET AUTO
// ============================================================

function setAuto(
    enabled
){

    const packs =
        getMatchedPacks();


    packs.forEach(
        pack => {

            WNC.packs.update(
                pack.name,
                {
                    auto:
                        enabled
                }
            );

        }
    );


    WNC.cleaner.restart();

}


// ============================================================
// SET PAGE LOAD
// ============================================================

function setPageLoad(
    enabled
){

    const packs =
        getMatchedPacks();


    packs.forEach(
        pack => {

            WNC.packs.update(
                pack.name,
                {
                    pageLoad:
                        enabled
                }
            );

        }
    );

}


// ============================================================
// STATUS
// ============================================================

function showStatus(){

    const packs =
        getMatchedPacks();


    const auto =
        packs.some(
            pack =>
                pack.auto !== false
        );


    const pageLoad =
        packs.some(
            pack =>
                pack.pageLoad !== false
        );


    const enabled =
        packs.filter(
            pack =>
                pack.enabled !== false
        ).length;


    alert(

        "WNC Status\n\n" +

        "Matched Packs: " +
        packs.length +

        "\nEnabled Packs: " +
        enabled +

        "\nAuto: " +
        (
            auto
                ? "ON"
                : "OFF"
        ) +

        "\nPage Load: " +
        (
            pageLoad
                ? "ON"
                : "OFF"
        )

    );

}


// ============================================================
// TOOLS PANEL
// ============================================================

let toolsPanel = null;


function closeTools(){

    if(!toolsPanel)
        return;


    toolsPanel.remove();

    toolsPanel = null;

}


function openTools(){

    closeTools();


    toolsPanel =
        document.createElement(
            "div"
        );


    toolsPanel.id =
        "wnc-tools-panel";


    toolsPanel.innerHTML = `

        <div class="wnc-tools-header">

            <b>WNC Tools</b>

            <button
                id="wnc-tools-close"
                type="button"
            >
                X
            </button>

        </div>


        <div class="wnc-tools-body">

            <button
                id="wnc-import-fox"
                type="button"
            >
                Import FoxReplace
            </button>


            <button
                id="wnc-merge-fox"
                type="button"
            >
                Merge FoxReplace
            </button>


            <button
                id="wnc-replace-fox"
                type="button"
            >
                Replace with FoxReplace
            </button>


            <hr>


            <button
                id="wnc-import-backup"
                type="button"
            >
                Import WNC Backup
            </button>


            <button
                id="wnc-export"
                type="button"
            >
                Export WNC Backup
            </button>


            <hr>


            <button
                id="wnc-inspector"
                type="button"
            >
                Inspector
            </button>


            <button
                id="wnc-diagnostics"
                type="button"
            >
                Diagnostics
            </button>

        </div>

    `;


    document.body.appendChild(
        toolsPanel
    );


    toolsPanel.querySelector(
        "#wnc-tools-close"
    ).onclick =
        closeTools;


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
    ).onclick =
        () => {

            WNC.inspector.open();

        };


    toolsPanel.querySelector(
        "#wnc-diagnostics"
    ).onclick =
        () => {

            WNC.diagnostics.open();

        };

}


// ============================================================
// MENU COMMANDS
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
    openTools
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
    () => {

        setAuto(true);

    }
);


GM_registerMenuCommand(
    "WNC - Auto Off",
    () => {

        setAuto(false);

    }
);


GM_registerMenuCommand(
    "WNC - Page Load On",
    () => {

        setPageLoad(true);

    }
);


GM_registerMenuCommand(
    "WNC - Page Load Off",
    () => {

        setPageLoad(false);

    }
);


GM_registerMenuCommand(
    "WNC - Status",
    showStatus
);


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
    max-width:calc(100vw - 24px);

    max-height:calc(100vh - 80px);

    overflow:auto;

    z-index:999999;

    background:#222;
    color:#fff;

    border:1px solid #777;

    border-radius:6px;

    padding:8px;

    font:13px Arial,sans-serif;

    box-shadow:
        0 4px 20px rgba(0,0,0,.5);

}


#wnc-tools-panel
.wnc-tools-header {

    display:flex;

    justify-content:space-between;

    align-items:center;

    margin:0 0 8px 0;

}


#wnc-tools-panel
.wnc-tools-body {

    display:flex;

    flex-direction:column;

    gap:5px;

}


#wnc-tools-panel
button {

    box-sizing:border-box;

    width:100%;

    padding:5px 8px;

    cursor:pointer;

    text-align:left;

    font:13px Arial,sans-serif;

}


#wnc-tools-panel
.wnc-tools-header button {

    width:auto;

    text-align:center;

}


#wnc-tools-panel
hr {

    width:100%;

    border:0;

    border-top:1px solid #555;

    margin:3px 0;

}

`);


// ============================================================
// VERSION / READY
// ============================================================

WNC.version =
    "5.1";


WNC.tools = {

    open:
        openTools,

    close:
        closeTools,

    export:
        exportDatabase,

    importWNC:
        importWNCBackup,

    importFoxReplace:
        importFoxReplace,

    mergeFoxReplace:
        mergeFoxReplace,

    replaceFoxReplace:
        replaceWithFoxReplace

};


console.log(
    "[WNC] v5.1 COMPLETE"
);


})();
