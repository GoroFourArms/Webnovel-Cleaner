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

// ============================================================
// DATABASE STORAGE KEYS
// ============================================================
//
// Canonical rule database format is native FoxReplace JSON.
// WNC does not maintain a separate rule schema.
// groups[] and substitutions[] array order define ordering.
// WNC-specific UI/runtime state belongs outside this database.
//

const FOXREPLACE_DB_KEY = "WNC_FOXREPLACE_DATABASE_V1";
const LEGACY_DB_KEY = "WNC_DATABASE_V5";  // For one-time migration only


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
//
// Native FoxReplace JSON structure.
// No version field inside the database itself.
//

const DEFAULT_DATABASE = {

    groups: []

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
// FOXREPLACE DATABASE NORMALIZATION
// ============================================================
//
// Normalizes native FoxReplace database structure.
// Does NOT convert to WNC-specific format.
// Enforces canonical structure with defaults.
//

function normalizeFoxReplaceDatabase(db) {

    if (
        !db ||
        typeof db !== "object"
    ) {

        db =
            clone(
                DEFAULT_DATABASE
            );

    }


    if (!Array.isArray(db.groups))
        db.groups = [];


    db.groups =
        db.groups.map(
            (group, groupIndex) => {

                if (
                    !group ||
                    typeof group !== "object"
                ) {

                    group = {};

                }


                if (!group.name)
                    group.name = `Group ${groupIndex + 1}`;
                else
                    group.name = String(group.name);


                if (!Array.isArray(group.urls))
                    group.urls = [];


                if (group.enabled === undefined)
                    group.enabled = true;


                if (group.pageLoad === undefined)
                    group.pageLoad = true;


                if (group.auto === undefined)
                    group.auto = true;


                if (!Array.isArray(group.substitutions))
                    group.substitutions = [];


                group.substitutions =
                    group.substitutions.map(
                        (substitution) => {

                            if (
                                !substitution ||
                                typeof substitution !== "object"
                            ) {

                                substitution = {};

                            }


                            if (substitution.input === undefined)
                                substitution.input = "";
                            else
                                substitution.input = String(substitution.input);


                            if (substitution.output === undefined)
                                substitution.output = "";
                            else
                                substitution.output = String(substitution.output);


                            if (!substitution.inputType)
                                substitution.inputType = "text";


                            if (
                                ![
                                    "text",
                                    "whole",
                                    "regexp"
                                ].includes(substitution.inputType)
                            ) {

                                substitution.inputType = "text";

                            }


                            if (substitution.caseSensitive === undefined)
                                substitution.caseSensitive = false;


                            if (substitution.enabled === undefined)
                                substitution.enabled = true;


                            return substitution;

                        }
                    );


                return group;

            }
        );


    return db;

}

// ============================================================
// DATABASE MIGRATION
// ============================================================

function migrateDatabase(db) {
    return normalizeFoxReplaceDatabase(db);
}


// ============================================================
// LOAD DATABASE
// ============================================================

function loadDatabase() {

    let raw =
        GM_getValue(
            FOXREPLACE_DB_KEY
        );


    if (!raw) {

        return clone(
            DEFAULT_DATABASE
        );

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
        normalizeFoxReplaceDatabase(db);


    return db;

}


// ============================================================
// SAVE DATABASE
// ============================================================

function saveDatabase(db) {

    const normalizedDatabase =
        normalizeFoxReplaceDatabase(
            clone(db)
        );


    GM_setValue(
        FOXREPLACE_DB_KEY,
        JSON.stringify(
            normalizedDatabase,
            null,
            2
        )
    );


    return normalizedDatabase;

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
