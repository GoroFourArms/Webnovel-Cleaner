// ==UserScript==
// @name         FRScanner
// @namespace    frscanner
// @version      4.9
// @description  Full spec-compliant FR Scanner 2 with menu command opening, max token count sorting, 5% max token count hiding, and specialized Korean regex template logic.
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @updateURL    https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/FRScanner.js
// @downloadURL  https://raw.githubusercontent.com/GoroFourArms/Webnovel-Cleaner/main/FRScanner.js
// @run-at       document-idle
// ==/UserScript==
(function () {
    "use strict";
    const STORE_KEY = "frScanner.settings.v4.2";
    const PANEL_ID = "fr-scanner-panel";
    const STYLE_ID = "fr-scanner-style";
    const EXCLUDED_TAGS = new Set([
        "SCRIPT",
        "STYLE",
        "NOSCRIPT",
        "TEMPLATE",
        "SVG",
        "CANVAS",
        "IFRAME",
        "NAV",
        "FOOTER",
        "HEADER",
        "ASIDE",
        "BUTTON",
        "INPUT",
        "TEXTAREA",
        "SELECT",
        "OPTION"
    ]);
    const BLOCK_TAGS = new Set([
        "ADDRESS",
        "ARTICLE",
        "BLOCKQUOTE",
        "BR",
        "DD",
        "DIV",
        "DL",
        "DT",
        "FIGCAPTION",
        "FIGURE",
        "H1",
        "H2",
        "H3",
        "H4",
        "H5",
        "H6",
        "LI",
        "MAIN",
        "P",
        "PRE",
        "SECTION",
        "TD",
        "TH",
        "TR"
    ]);
    const NON_CHAPTER_SELECTOR = [
        "script",
        "style",
        "noscript",
        "nav",
        "footer",
        "aside",
        "form",
        "button",
        "input",
        "select",
        "textarea",
        '[role="navigation"]',
        '[role="menu"]',
        '[role="dialog"]',
        ".comments",
        "#comments",
        ".comment-section",
        ".chapter-nav",
        ".chapter-navigation",
        ".pagination",
        ".advertisement",
        ".ads"
    ].join(",");
    const WORD_FILTER = new Set(["An", "Do", "Ha", "He", "Ho", "I", "No", "Oh", "So", "You"]);
    const All_Words = new Set([
        "A",
        "Although",
        "After",
        "And",
        "Are",
        "As",
        "At",
        "Be",
        "But",
        "By",
        "Can",
        "Could",
        "Did",
        "Does",
        "For",
        "From",
        "Had",
        "Has",
        "Have",
        "Her",
        "Here",
        "Him",
        "His",
        "How",
        "However",
        "If",
        "In",
        "I'll",
        "I'm",
        "Into",
        "Is",
        "It",
        "Its",
        "Just",
        "May",
        "Me",
        "Might",
        "Must",
        "My",
        "Not",
        "Of",
        "On",
        "Once",
        "One",
        "Or",
        "Our",
        "Out",
        "Seeing",
        "She",
        "Should",
        "So",
        "Some",
        "That",
        "The",
        "Their",
        "Them",
        "Then",
        "There",
        "These",
        "They",
        "This",
        "Those",
        "Though",
        "Through",
        "To",
        "Too",
        "Up",
        "Us",
        "Was",
        "We",
        "Were",
        "What",
        "When",
        "Where",
        "Which",
        "While",
        "Who",
        "Why",
        "Will",
        "With",
        "Would",
        "Yes",
        "Yet",
        "You",
        "Your"
    ]);
    const ABBREVIATIONS = new Set([
        "Mr",
        "Mrs",
        "Ms",
        "Dr",
        "Prof",
        "Sr",
        "Jr",
        "St",
        "Rev",
        "Hon",
        "Gen",
        "Col",
        "Lt",
        "Sgt"
    ]);
    const TEMPLATES = ["Other", "Korean", "Japanese", "Japanese 2"];
    let settings = loadSettings();
    let highlightedElements = [];
    let highlightedNodeRecords = [];
    let currentCandidates = [];
    let highlightedCandidates = new Set();
    let accumulatedOccurrences = [];
    let nextOccurrencePos = 0;
    let observer = null;
    let processedNodeText = new WeakMap();
    let candidateMergeDiagnostics = [];
    function loadSettings() {
        const defaults = {
            x: 20,
            y: 20,
            template: "Other",
            edits: {},
            highlightedAll: false
        };
        try {
            const saved = GM_getValue(STORE_KEY, {});
            return { ...defaults, ...saved, edits: { ...(saved.edits || {}) } };
        } catch (_) {
            return defaults;
        }
    }
    function saveSettings() {
        try {
            GM_setValue(STORE_KEY, settings);
        } catch (_) {}
    }
    function isExcluded(element) {
        if (!element || element.nodeType !== 1) return false;
        if (EXCLUDED_TAGS.has(element.tagName)) return true;
        if (element.hidden || element.getAttribute("aria-hidden") === "true") return true;
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return true;
        return false;
    }
    function extractVisibleText(root = null) {
        root = root || document.body || document.documentElement;
        if (!root) return { text: "", segments: [] };
        const runs = [];
        let currentRun = { text: "", segments: [] };
        function finishRun() {
            if (currentRun.text) {
                runs.push(currentRun);
            }
            currentRun = { text: "", segments: [] };
        }
        function appendTextNode(node) {
            const originalText = node.nodeValue || "";
            if (!originalText) return;
            const start = currentRun.text.length;
            currentRun.text += originalText;
            currentRun.segments.push({
                node,
                start,
                end: currentRun.text.length,
                nodeStart: 0,
                nodeEnd: originalText.length,
                textSnapshot: originalText
            });
        }
        function walk(node) {
            if (node.nodeType === Node.TEXT_NODE) {
                appendTextNode(node);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) {
                return;
            }
            if (isExcluded(node) || node.matches(NON_CHAPTER_SELECTOR) || node.closest("#" + PANEL_ID)) {
                finishRun();
                return;
            }
            if (node.tagName === "BR") {
                finishRun();
                return;
            }
            const isBlock = BLOCK_TAGS.has(node.tagName);
            if (isBlock) {
                finishRun();
            }
            for (const child of node.childNodes) {
                walk(child);
            }
            if (isBlock) {
                finishRun();
            }
        }
        if (root.nodeType === Node.TEXT_NODE) {
            appendTextNode(root);
        } else {
            for (const child of root.childNodes) {
                walk(child);
            }
        }
        finishRun();
        return {
            text: runs.map((run) => run.text).join("\n"),
            segments: runs
        };
    }
    function normalizeToken(tokenStr, knownTokens) {
        let token = String(tokenStr || "")
            .trim()
            .replace(/[’‘]/g, "'")
            .replace(/\.+$/, "");
        // Expose the plural ending for normalization.
        // The s is preserved until the plural check is complete.
        if (/s'$/i.test(token)) {
            token = token.slice(0, -1);
        }
        // Normalize plurals only when the singular form is known.
        if (token.length > 1 && /s$/i.test(token) && knownTokens.has(token.slice(0, -1).toLowerCase())) {
            token = token.slice(0, -1);
        }
        // Normalize ordinary possessives after plural normalization.
        token = token.replace(/'s$/i, "").replace(/'$/, "");
        return token;
    }
    function buildKnownTokens(occurrences) {
        const knownTokens = new Set();
        for (const occ of occurrences) {
            for (const rawToken of String(occ.phrase || "").split(/\s+/)) {
                let token = rawToken.trim().replace(/[’‘]/g, "'").replace(/\.+$/, "");
                // Remove singular possessive endings, but preserve the s
                // in plural possessives such as "dogs'".
                token = token.replace(/'s$/i, "").replace(/'$/, "");
                if (token) {
                    knownTokens.add(token.toLowerCase());
                }
            }
        }
        return knownTokens;
    }
    function extractOccurrences(text, sourceNode = null, options = {}) {
        const occurrences = [];
        const diagnostics = options.diagnostics || null;
        const snapshot = String(text || "");
        const abbreviationPattern = [...ABBREVIATIONS]
            .sort((a, b) => b.length - a.length)
            .map((abbr) => abbr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join("|");
        const tokenPattern = String.raw`(?:${abbreviationPattern}\.?|[A-Z](?:\.[A-Z])+\..?|[A-Z]\.|[A-Z]{2,}|[A-ZÀ-ÖØ-ÞĀ-Ž][A-Za-zà-öø-ÿā-ž0-9'’-]*)`;
        const regex = new RegExp(`(${tokenPattern}(?: (?:(?:of(?: the)?) )*${tokenPattern})*)`, "g");
        let match;
        while ((match = regex.exec(snapshot)) !== null) {
            const phrase = match[1].trim();
            const parts = phrase.split(/\s+/);
            let rejectionReason = null;
            for (let i = 0; i < parts.length - 1; i++) {
                if (parts[i].endsWith(".") && !ABBREVIATIONS.has(parts[i].slice(0, -1))) {
                    rejectionReason = "non-abbreviation-period-before-final-token";
                    break;
                }
            }
            if (!rejectionReason && phrase.length <= 1) {
                rejectionReason = "phrase-too-short";
            }
            const occurrence = {
                phrase,
                sourceNode,
                startPos: match.index,
                endPos: match.index + match[1].length,
                accepted: rejectionReason === null,
                rejectionReason,
                textSnapshot: snapshot
            };
            if (occurrence.accepted) {
                occurrences.push(occurrence);
            }
            if (diagnostics) {
                diagnostics.push(occurrence);
            }
        }
        return occurrences;
    }
    function tokenizePhrase(phrase) {
        const expanded = String(phrase || "")
            .replace(/[’‘]/g, "'")
            .replace(/(?:[A-ZĀĒĪŌŪ]\.){2,}/g, (match) => match.replace(/\./g, " ").trim());
        const rawTokens = expanded.replace(/\./g, " ").trim().split(/\s+/).filter(Boolean);
        return rawTokens.map((original) => ({
            original,
            normalized: null,
            filterDecision: null,
            filterReason: null,
            identity: null
        }));
    }
    function normalizeTokens(tokens, knownTokens) {
        return tokens.map((record) => {
            const normalized = normalizeToken(record.original, knownTokens);
            return {
                ...record,
                normalized
            };
        });
    }
    function isContraction(tokenStr) {
        const token = String(tokenStr || "")
            .trim()
            .replace(/[’‘]/g, "'");
        // Common contractions that must be removed as whole tokens.
        if (/^[a-z]+(?:n't|'m|'re|'ve|'ll|'d)$/i.test(token)) {
            return true;
        }
        // Common contractions ending in 's.
        // Do not classify every word ending in 's as a contraction,
        // because names such as "Fred's" must survive possessive normalization.
        if (
            /^(?:he|she|it|that|there|here|what|who|where|when|why|how|let|everyone|everybody|someone|somebody|anyone|anybody|no one|one|whoever|whatever|whichever|nobody|nothing|something|anything|everything)'s$/i.test(
                token
            )
        ) {
            return true;
        }
        // Other common fixed contractions.
        return /^(?:y'all|let's|ma'am|o'clock)$/i.test(token);
    }
    function filterTokens(tokens) {
        return tokens.map((record) => {
            const token = record.normalized;
            // Check the original spelling so normalization does not hide
            // contractions such as "he's" by turning them into "he".
            const contractionMatch = isContraction(record.original);
            // Preserve existing filter behavior.
            const wordFilterMatch = tokens.length === 1 && WORD_FILTER.has(token);
            const allWordsMatch = All_Words.has(token);
            let filterReason = null;
            if (contractionMatch) {
                filterReason = "CONTRACTION";
            } else if (wordFilterMatch) {
                filterReason = "WORD_FILTER";
            } else if (allWordsMatch) {
                filterReason = "All_Words";
            }
            return {
                ...record,
                filterDecision: filterReason === null ? "keep" : "filter",
                filterReason
            };
        });
    }
    function getIdentityTokens(tokens) {
        return tokens
            .filter((record) => record.filterDecision === "keep" && record.normalized)
            .map((record) => ({
                ...record,
                identity: record.normalized.toLowerCase()
            }));
    }
    function meaningfulTokens(phrase, knownTokens) {
        const tokenized = tokenizePhrase(phrase);
        if (!tokenized.length) return [];
        const normalized = normalizeTokens(tokenized, knownTokens);
        const filtered = filterTokens(normalized);
        const identities = getIdentityTokens(filtered);
        return identities.map((record) => record.identity);
    }
    function mapOccurrenceToSourceSegments(occurrence, run) {
        const occurrenceStart = occurrence.startPos;
        const occurrenceEnd = occurrence.endPos;
        const sourceSegments = [];
        for (const segment of run.segments) {
            const overlapStart = Math.max(occurrenceStart, segment.start);
            const overlapEnd = Math.min(occurrenceEnd, segment.end);
            if (overlapStart >= overlapEnd) continue;
            const nodeStart = segment.nodeStart + (overlapStart - segment.start);
            const nodeEnd = segment.nodeStart + (overlapEnd - segment.start);
            sourceSegments.push({
                sourceNode: segment.node,
                startPos: nodeStart,
                endPos: nodeEnd,
                textSnapshot: segment.textSnapshot,
                text: segment.textSnapshot.slice(nodeStart, nodeEnd)
            });
        }
        return {
            ...occurrence,
            sourceNode: sourceSegments.length === 1 ? sourceSegments[0].sourceNode : null,
            sourceSegments
        };
    }
    function getOccurrenceSourceSegments(occurrence) {
        if (Array.isArray(occurrence.sourceSegments)) {
            return occurrence.sourceSegments;
        }
        if (occurrence.sourceNode) {
            return [
                {
                    sourceNode: occurrence.sourceNode,
                    startPos: occurrence.startPos,
                    endPos: occurrence.endPos,
                    textSnapshot: occurrence.textSnapshot,
                    text: occurrence.phrase
                }
            ];
        }
        return [];
    }
    function extractRunOccurrences(run) {
        const runOccurrences = extractOccurrences(run.text, null);
        return runOccurrences.map((occurrence) => ({
            ...mapOccurrenceToSourceSegments(occurrence, run),
            sourceNodes: run.segments.map((segment) => segment.node)
        }));
    }
    function processCandidates(occurrences) {
        candidateMergeDiagnostics = [];
        const knownTokens = buildKnownTokens(occurrences);
        const rawMap = new Map();
        for (const occ of occurrences) {
            const phrase = occ.phrase.trim();
            const tokens = meaningfulTokens(phrase, knownTokens);
            if (!tokens.length) continue;
            const identity = [...tokens].sort().join("|");
            if (!rawMap.has(identity)) {
                rawMap.set(identity, {
                    identity,
                    variants: new Map(),
                    sourceOccurrences: [],
                    firstPos: occ.startPos,
                    normalizedTokens: tokens,
                    distinctTokens: new Set(tokens)
                });
            }
            const cand = rawMap.get(identity);
            cand.sourceOccurrences.push(occ);
            cand.firstPos = Math.min(cand.firstPos, occ.startPos);
            const orderKey = tokens.join("|");
            if (!cand.variants.has(phrase)) {
                cand.variants.set(phrase, {
                    phrase,
                    orderKey,
                    count: 0,
                    firstPos: occ.startPos,
                    length: phrase.length
                });
            }
            const variant = cand.variants.get(phrase);
            variant.count++;
            variant.firstPos = Math.min(variant.firstPos, occ.startPos);
        }
        let candidates = [...rawMap.values()].map((cand) => {
            const orderCounts = new Map();
            for (const variant of cand.variants.values()) {
                const order = orderCounts.get(variant.orderKey) || {
                    count: 0,
                    firstPos: variant.firstPos
                };
                order.count += variant.count;
                order.firstPos = Math.min(order.firstPos, variant.firstPos);
                orderCounts.set(variant.orderKey, order);
            }
            const winningOrder = [...orderCounts.entries()].sort(
                (a, b) => b[1].count - a[1].count || a[1].firstPos - b[1].firstPos
            )[0]?.[0];
            const representative = [...cand.variants.values()]
                .filter((variant) => variant.orderKey === winningOrder)
                .sort((a, b) => a.length - b.length || b.count - a.count || a.firstPos - b.firstPos)[0];
            cand.phrase = representative?.phrase || "";
            cand.normalizedTokens = meaningfulTokens(cand.phrase, knownTokens);
            cand.distinctTokens = new Set(cand.normalizedTokens);
            cand.occurrences = [...cand.variants.values()].reduce((sum, variant) => sum + variant.count, 0);
            cand.orderVariants = [...cand.variants.values()]
                .filter((variant) => variant.orderKey === winningOrder)
                .map((variant) => variant.phrase);
            return cand;
        });
        // Merge candidates sharing exactly one token at different positions.
        // Existing merge criteria are intentionally unchanged.
        let merged = true;
        while (merged) {
            merged = false;
            outer: for (let i = 0; i < candidates.length; i++) {
                for (let j = i + 1; j < candidates.length; j++) {
                    const a = candidates[i];
                    const b = candidates[j];
                    const shared = [...a.distinctTokens].filter((token) => b.distinctTokens.has(token));
                    const sharedToken = shared.length === 1 ? shared[0] : null;
                    const aPosition = sharedToken === null ? -1 : a.normalizedTokens.indexOf(sharedToken);
                    const bPosition = sharedToken === null ? -1 : b.normalizedTokens.indexOf(sharedToken);
                    const tokenCandidateCount =
                        sharedToken === null
                            ? null
                            : candidates.filter((cand) => cand.distinctTokens.has(sharedToken)).length;
                    let decision = "reject";
                    let reason;
                    if (shared.length !== 1) {
                        reason = "shared-token-count-not-one";
                    } else if (tokenCandidateCount !== 2) {
                        reason = "shared-token-does-not-occur-in-exactly-two-candidates";
                    } else if (aPosition === bPosition) {
                        reason = "shared-token-position-is-the-same";
                    } else {
                        decision = "merge";
                        reason = "all-existing-merge-criteria-passed";
                    }
                    const diagnostic = {
                        type: "merge-pair",
                        candidateAKey: a.identity,
                        candidateBKey: b.identity,
                        candidateAIdentityKey: a.identityKey ?? null,
                        candidateBIdentityKey: b.identityKey ?? null,
                        candidateATokens: [...a.normalizedTokens],
                        candidateBTokens: [...b.normalizedTokens],
                        sharedTokens: [...shared],
                        sharedToken,
                        candidateAPosition: aPosition,
                        candidateBPosition: bPosition,
                        tokenCandidateCount,
                        decision,
                        reason
                    };
                    if (decision === "reject") {
                        candidateMergeDiagnostics.push(diagnostic);
                        continue;
                    }
                    const variants = new Map();
                    for (const source of [a.variants, b.variants]) {
                        for (const [phrase, variant] of source) {
                            const existing = variants.get(phrase);
                            if (existing) {
                                existing.count += variant.count;
                                existing.firstPos = Math.min(existing.firstPos, variant.firstPos);
                            } else {
                                variants.set(phrase, { ...variant });
                            }
                        }
                    }
                    const combinedTokens = [...new Set([...a.normalizedTokens, ...b.normalizedTokens])];
                    const combined = {
                        ...a,
                        variants,
                        sourceOccurrences: [...a.sourceOccurrences, ...b.sourceOccurrences],
                        normalizedTokens: combinedTokens,
                        distinctTokens: new Set(combinedTokens),
                        occurrences: a.occurrences + b.occurrences,
                        firstPos: Math.min(a.firstPos, b.firstPos),
                        orderVariants: [...new Set([...a.orderVariants, ...b.orderVariants])]
                    };
                    // Preserve the existing representative selection rule.
                    if (a.phrase.includes(b.phrase)) {
                        combined.phrase = a.phrase;
                    } else if (b.phrase.includes(a.phrase)) {
                        combined.phrase = b.phrase;
                    } else {
                        combined.phrase = a.phrase;
                    }
                    // Check whether the selected phrase represents the union
                    // of tokens. This is diagnostic only; it does not alter
                    // the current phrase selection or merge criteria.
                    const phraseTokens = meaningfulTokens(combined.phrase, knownTokens);
                    const phraseTokenSet = new Set(phraseTokens);
                    const unionTokenSet = new Set(combinedTokens);
                    const representativeCompatible =
                        phraseTokenSet.size === unionTokenSet.size &&
                        [...unionTokenSet].every((token) => phraseTokenSet.has(token));
                    combined.representativeCompatible = representativeCompatible;
                    combined.requiresInspection = !representativeCompatible;
                    combined.inspectionReason = representativeCompatible
                        ? null
                        : "representative-phrase-does-not-match-merged-token-union";
                    // Explicitly document the current identity policy:
                    // the merged candidate retains a.identity for now.
                    // Do not change persisted edit keys in this diagnostic step.
                    combined.identity = a.identity;
                    const mergedDiagnostic = {
                        ...diagnostic,
                        resultingCandidateKey: combined.identity,
                        resultingTokens: [...combined.normalizedTokens],
                        resultingPhrase: combined.phrase,
                        representativeCompatible,
                        requiresInspection: combined.requiresInspection,
                        inspectionReason: combined.inspectionReason,
                        resultingVariants: [...combined.variants.entries()].map(([phrase, variant]) => ({
                            phrase,
                            count: variant.count,
                            firstPos: variant.firstPos,
                            orderKey: variant.orderKey
                        })),
                        resultingOccurrenceCount: combined.occurrences,
                        resultingFirstPos: combined.firstPos
                    };
                    candidateMergeDiagnostics.push(mergedDiagnostic);
                    candidates.splice(j, 1);
                    candidates.splice(i, 1, combined);
                    merged = true;
                    break outer;
                }
            }
        }
        // Diagnose duplicate candidate identities without changing them.
        const identityGroups = new Map();
        for (const cand of candidates) {
            const key = cand.identity;
            if (!identityGroups.has(key)) {
                identityGroups.set(key, []);
            }
            identityGroups.get(key).push(cand);
        }
        for (const [key, group] of identityGroups) {
            if (group.length > 1) {
                candidateMergeDiagnostics.push({
                    type: "identity-collision",
                    candidateKey: key,
                    candidateCount: group.length,
                    tokenSets: group.map((cand) => [...cand.normalizedTokens]),
                    phrases: group.map((cand) => cand.phrase),
                    reason: "multiple-candidates-share-the-same-identity"
                });
            }
        }
        // Remove candidates whose distinct token sets are strict subsets
        // of other candidates. Record why each candidate is removed.
        // This comparison occurs after merging.
        const candidatesBeforeContainment = [...candidates];
        const removedCandidates = new Set();
        for (const cand of candidatesBeforeContainment) {
            for (const other of candidatesBeforeContainment) {
                if (other === cand) continue;
                const isStrictSubset =
                    other.distinctTokens.size > cand.distinctTokens.size &&
                    [...cand.distinctTokens].every((token) => other.distinctTokens.has(token));
                if (!isStrictSubset) continue;
                removedCandidates.add(cand);
                candidateMergeDiagnostics.push({
                    type: "containment-removal",
                    phase: "after-merging",
                    removedCandidate: {
                        key: cand.identity,
                        phrase: cand.phrase,
                        tokens: [...cand.distinctTokens],
                        occurrences: cand.occurrences
                    },
                    subsumingCandidate: {
                        key: other.identity,
                        phrase: other.phrase,
                        tokens: [...other.distinctTokens],
                        occurrences: other.occurrences
                    },
                    sharedTokens: [...cand.distinctTokens].filter((token) => other.distinctTokens.has(token)),
                    reason: "candidate-token-set-is-a-strict-subset"
                });
                // One subsuming candidate is enough to explain removal.
                break;
            }
        }
        candidates = candidates.filter((cand) => !removedCandidates.has(cand));
        const result = sortAndFilterCandidates(calculateCandidateCounts(candidates));
        for (const cand of result) {
            cand.identityKey = cand.identity;
        }
        return result;
    }
    function calculateCandidateCounts(candidates) {
        const tokenFreqs = new Map();
        const knownTokens = buildKnownTokens(accumulatedOccurrences);
        for (const occ of accumulatedOccurrences) {
            const tokenRecords = filterTokens(normalizeTokens(tokenizePhrase(occ.phrase), knownTokens));
            for (const record of tokenRecords) {
                if (record.filterDecision !== "keep") continue;
                const token = String(record.normalized || "").toLowerCase();
                if (!token) continue;
                tokenFreqs.set(token, (tokenFreqs.get(token) || 0) + 1);
            }
        }
        for (const cand of candidates) {
            const identityKey = cand.identityKey ?? cand.identity;
            const displayName = settings.edits[identityKey] ?? cand.phrase;
            const tokens = meaningfulTokens(displayName, knownTokens);
            const uniqueTokens = [...new Set(tokens.map((token) => token.toLowerCase()))];
            const tokenCounts = uniqueTokens.map((token) => tokenFreqs.get(token) || 0);
            cand.tokenCountsStr = tokenCounts.join(",");
            cand.maxTokenCount = Math.max(0, ...tokenCounts);
            cand.sortedTokenCounts = [...tokenCounts].sort((a, b) => b - a);
        }
        return candidates;
    }
    function sortAndFilterCandidates(candidates) {
        const globalMaxScore = Math.max(0, ...candidates.map((cand) => cand.maxTokenCount));
        const filtered =
            globalMaxScore > 0 ? candidates.filter((cand) => cand.maxTokenCount > globalMaxScore * 0.05) : candidates;
        filtered.sort((a, b) => {
            if (b.maxTokenCount !== a.maxTokenCount) {
                return b.maxTokenCount - a.maxTokenCount;
            }
            const aCounts = a.sortedTokenCounts || [];
            const bCounts = b.sortedTokenCounts || [];
            const length = Math.max(aCounts.length, bCounts.length);
            for (let i = 0; i < length; i++) {
                const difference = (bCounts[i] || 0) - (aCounts[i] || 0);
                if (difference !== 0) return difference;
            }
            return a.firstPos - b.firstPos;
        });
        return filtered;
    }
    const TRACE_REGEX = false;
    function generateRegex(phrase, template) {
        const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const boundaryStart = "(?<![a-z])";
        const boundaryEnd = "(?![a-z])";
        const tokens = phrase.trim().split(/\s+/).filter(Boolean);
        const trace = {
            displayName: phrase,
            template,
            tokens: [...tokens],
            escapedTokenPatterns: [],
            boundaries: {
                start: boundaryStart,
                end: boundaryEnd
            },
            separators: [],
            templateSpecificAlternatives: [],
            finalRegex: "",
            flags: "",
            compiles: null,
            compilationError: null
        };
        const finish = (regex) => {
            trace.finalRegex = regex;
            // The generated value is a regex string, not a RegExp object.
            // Test compilation with no flags, matching the default constructor behavior.
            try {
                new RegExp(regex, trace.flags);
                trace.compiles = true;
            } catch (error) {
                trace.compiles = false;
                trace.compilationError = error.message;
            }
            if (TRACE_REGEX) {
                console.group(`[FRScanner Regex] ${phrase} (${template})`);
                console.log("1. Display name:", trace.displayName);
                console.log("2. Selected template:", trace.template);
                console.log("3. Extracted tokens:", trace.tokens);
                console.log("4. Escaped token patterns:", trace.escapedTokenPatterns);
                console.log("5. Separators:", trace.separators);
                console.log("6. Boundaries:", trace.boundaries);
                console.log("7. Template-specific alternatives:", trace.templateSpecificAlternatives);
                console.log("8. Final regex:", trace.finalRegex);
                console.log("9. Flags:", trace.flags === "" ? "(none)" : trace.flags);
                console.log("10. Compiles:", trace.compiles);
                if (!trace.compiles) {
                    console.error("Compilation error:", trace.compilationError);
                }
                console.groupEnd();
            }
            return regex;
        };
        if (!tokens.length) {
            return finish("");
        }
        const cleanToken = (token) => token.replace(/[’‘]/g, "'").replace(/(?:'s|s')$/i, "");
        const tokenPattern = (token) => {
            const clean = cleanToken(token);
            const base = clean.replace(/\.+$/, "");
            let pattern;
            if (ABBREVIATIONS.has(base)) {
                pattern = escapeRegex(base) + "\\.?";
            } else if (/^[A-ZĀĒĪŌŪ]$/.test(base)) {
                pattern = escapeRegex(base) + "\\.?";
            } else {
                pattern = escapeRegex(base);
            }
            trace.escapedTokenPatterns.push({
                token,
                cleanedToken: clean,
                base,
                pattern
            });
            return pattern;
        };
        const joinTokens = () => {
            const result = [];
            for (let i = 0; i < tokens.length; i++) {
                result.push(tokenPattern(tokens[i]));
                if (i < tokens.length - 1) {
                    const a = cleanToken(tokens[i]).replace(/\.+$/, "");
                    const b = cleanToken(tokens[i + 1]).replace(/\.+$/, "");
                    const initials = /^[A-ZĀĒĪŌŪ]$/.test(a) && /^[A-ZĀĒĪŌŪ]$/.test(b);
                    const separator = initials ? "(?:\\s*\\.\\s*| )" : " ";
                    trace.separators.push({
                        between: [tokens[i], tokens[i + 1]],
                        pattern: separator
                    });
                    result.push(separator);
                }
            }
            return result.join("");
        };
        if (template === "Korean") {
            if (!phrase.includes("-")) {
                const joined = joinTokens();
                trace.templateSpecificAlternatives.push({
                    rule: "Korean template without hyphens",
                    pattern: joined
                });
                return finish(`${boundaryStart}${joined}${boundaryEnd}`);
            }
            const koreanTokens = tokens.map((token) =>
                escapeRegex(cleanToken(token).replace(/\.+$/, "")).replace(/-/g, "[- ]?")
            );
            trace.escapedTokenPatterns = koreanTokens.map((pattern, index) => ({
                token: tokens[index],
                pattern,
                rule: "Korean hyphen handling"
            }));
            const n = koreanTokens.length;
            if (n === 1) {
                trace.templateSpecificAlternatives.push({
                    rule: "Single Korean token",
                    pattern: koreanTokens[0]
                });
                return finish(`${boundaryStart}${koreanTokens[0]}${boundaryEnd}`);
            }
            if (n === 2) {
                const alternative = `(?:${koreanTokens[0]} )?${koreanTokens[1]}`;
                trace.templateSpecificAlternatives.push({
                    rule: "Two-token Korean pattern",
                    pattern: alternative
                });
                return finish(`${boundaryStart}${alternative}${boundaryEnd}`);
            }
            const prefix = koreanTokens.slice(0, n - 2).join(" ");
            const optionalPrefix = prefix ? `(?:${prefix} )?` : "";
            const optionalSecondToLast = `(?:${koreanTokens[n - 2]} )?`;
            const mainPattern = `${optionalPrefix}${optionalSecondToLast}${koreanTokens[n - 1]}`;
            const alternativePrefix = koreanTokens.slice(0, n - 3).join(" ");
            const optionalAlternativePrefix = alternativePrefix ? `(?:${alternativePrefix} )?` : "";
            const alternative = `${optionalAlternativePrefix}${koreanTokens[n - 3]} ${koreanTokens[n - 2]}`;
            trace.templateSpecificAlternatives.push(
                { rule: "Korean main pattern", pattern: mainPattern },
                { rule: "Korean alternative pattern", pattern: alternative }
            );
            return finish(`${boundaryStart}(?:${mainPattern}|${alternative})${boundaryEnd}`);
        }
        if ((template === "Japanese" || template === "Japanese 2") && tokens.length === 2) {
            const first = tokenPattern(tokens[0]);
            const second = tokenPattern(tokens[1]);
            const alternatives = [`${first} ${second}`, `${second} ${first}`];
            if (template === "Japanese 2") {
                alternatives.push(first);
            }
            trace.templateSpecificAlternatives = alternatives.map((pattern, index) => ({
                index: index + 1,
                pattern
            }));
            const body = alternatives.join("|");
            return finish(`${boundaryStart}(?:${body})${boundaryEnd}`);
        }
        const joined = joinTokens();
        return finish(`${boundaryStart}${joined}${boundaryEnd}`);
    }
    function withScanObserverPaused(callback) {
        const wasObserving = !!observer;
        if (wasObserving) observer.disconnect();
        try {
            callback();
        } finally {
            if (wasObserving && document.body) {
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    characterData: true
                });
            }
        }
    }
    function clearHighlights() {
        withScanObserverPaused(() => {
            for (const record of highlightedNodeRecords) {
                const { originalNode, replacementNodes, parent } = record;
                if (!parent || !replacementNodes.length) continue;
                if (!replacementNodes.every((node) => node.parentNode === parent)) continue;
                parent.replaceChild(originalNode, replacementNodes[0]);
                for (const node of replacementNodes.slice(1)) {
                    node.remove();
                }
            }
            highlightedNodeRecords = [];
            highlightedElements = [];
        });
    }
    function applyHighlights() {
        const traceHighlights = true;
        const trace = (...args) => {
            if (traceHighlights) console.debug("[FRScanner Highlight]", ...args);
        };
        clearHighlights();
        if ((!settings.highlightedAll && highlightedCandidates.size === 0) || currentCandidates.length === 0) {
            return;
        }
        const root = document.body;
        if (!root) return;
        const selectedCandidates = currentCandidates.filter(
            (cand) => settings.highlightedAll || highlightedCandidates.has(cand.identityKey)
        );
        trace(
            "Candidates selected for highlighting",
            selectedCandidates.map((cand) => ({
                phrase: cand.phrase,
                identityKey: cand.identityKey,
                sourceOccurrenceCount: (cand.sourceOccurrences || []).length
            }))
        );
        const textNodes = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const parent = node.parentElement;
                if (!parent || !node.nodeValue.trim()) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest("#" + PANEL_ID)) {
                    return NodeFilter.FILTER_REJECT;
                }
                if (parent.closest([...EXCLUDED_TAGS].map((tag) => tag.toLowerCase()).join(","))) {
                    return NodeFilter.FILTER_REJECT;
                }
                let current = parent;
                while (current && current !== root) {
                    if (current.hidden || current.getAttribute("aria-hidden") === "true") {
                        return NodeFilter.FILTER_REJECT;
                    }
                    const style = getComputedStyle(current);
                    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
                        return NodeFilter.FILTER_REJECT;
                    }
                    current = current.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });
        while (walker.nextNode()) {
            textNodes.push(walker.currentNode);
        }
        // Prepare individual-candidate matches against combined text runs.
        // This allows matches such as <span>Fred</span> <span>Smith</span>.
        const individualMatchesByNode = new Map();
        if (!settings.highlightedAll) {
            const runs = extractVisibleText(root).segments;
            for (const cand of selectedCandidates) {
                const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
                const regexStr = generateRegex(displayName, settings.template);
                console.debug("[FRScanner Regex Debug]", {
                    displayName,
                    regexStr,
                    template: settings.template
                });
                if (!regexStr) continue;
                let regex;
                try {
                    regex = new RegExp(regexStr, "g");
                } catch (error) {
                    console.warn("[FRScanner Highlight] Invalid candidate regex", {
                        displayName,
                        regexStr,
                        error
                    });
                    continue;
                }
                for (const run of runs) {
                    regex.lastIndex = 0;
                    let match;
                    while ((match = regex.exec(run.text)) !== null) {
                        if (!match[0]) {
                            regex.lastIndex++;
                            continue;
                        }
                        const mapped = mapOccurrenceToSourceSegments(
                            {
                                phrase: match[0],
                                startPos: match.index,
                                endPos: match.index + match[0].length,
                                textSnapshot: run.text
                            },
                            run
                        );
                        for (const segment of mapped.sourceSegments) {
                            if (!individualMatchesByNode.has(segment.sourceNode)) {
                                individualMatchesByNode.set(segment.sourceNode, []);
                            }
                            individualMatchesByNode.get(segment.sourceNode).push({
                                start: segment.startPos,
                                end: segment.endPos,
                                text: segment.text,
                                displayName
                            });
                        }
                    }
                }
            }
        }
        withScanObserverPaused(() => {
            for (const node of textNodes) {
                const originalText = node.nodeValue;
                const matches = [];
                for (const cand of selectedCandidates) {
                    if (settings.highlightedAll) {
                        // Highlight All uses the original scan occurrences.
                        for (const occ of cand.sourceOccurrences || []) {
                            for (const segment of getOccurrenceSourceSegments(occ)) {
                                if (segment.sourceNode !== node) continue;
                                const start = segment.startPos;
                                const end = segment.endPos;
                                const text = segment.text;
                                if (
                                    !text ||
                                    !Number.isInteger(start) ||
                                    !Number.isInteger(end) ||
                                    start < 0 ||
                                    end <= start ||
                                    end > originalText.length ||
                                    segment.textSnapshot !== originalText ||
                                    originalText.slice(start, end) !== text
                                ) {
                                    continue;
                                }
                                matches.push({
                                    start,
                                    end,
                                    text,
                                    displayName: cand.phrase
                                });
                            }
                        }
                    } else {
                        // Individual highlights use matches mapped from combined text runs.
                        const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
                        matches.push(
                            ...(individualMatchesByNode.get(node) || []).filter(
                                (match) => match.displayName === displayName
                            )
                        );
                    }
                }
                if (matches.length === 0) continue;
                matches.sort((a, b) => a.start - b.start || b.end - a.end);
                const nonOverlapping = [];
                let lastEnd = 0;
                for (const match of matches) {
                    if (
                        !Number.isInteger(match.start) ||
                        !Number.isInteger(match.end) ||
                        match.start < 0 ||
                        match.end <= match.start ||
                        match.end > originalText.length ||
                        originalText.slice(match.start, match.end) !== match.text
                    ) {
                        trace("Match skipped: invalid source range", {
                            match,
                            sourceText: originalText
                        });
                        continue;
                    }
                    if (match.start < lastEnd) {
                        trace("Match skipped: overlaps an earlier match", {
                            skippedMatch: match,
                            previousMatchEnd: lastEnd,
                            sourceText: originalText
                        });
                        continue;
                    }
                    nonOverlapping.push(match);
                    lastEnd = match.end;
                }
                if (nonOverlapping.length === 0) continue;
                const fragment = document.createDocumentFragment();
                let lastIndex = 0;
                for (const match of nonOverlapping) {
                    if (match.start > lastIndex) {
                        fragment.appendChild(document.createTextNode(originalText.slice(lastIndex, match.start)));
                    }
                    const span = document.createElement("span");
                    span.className =
                        match.text !== match.displayName && match.text.toLowerCase() === match.displayName.toLowerCase()
                            ? "fr-highlight-mark fr-highlight-case-mismatch"
                            : "fr-highlight-mark";
                    span.textContent = match.text;
                    fragment.appendChild(span);
                    highlightedElements.push(span);
                    trace("Highlight applied", {
                        text: match.text,
                        displayName: match.displayName,
                        start: match.start,
                        end: match.end,
                        className: span.className,
                        sourceText: originalText
                    });
                    lastIndex = match.end;
                }
                if (lastIndex < originalText.length) {
                    fragment.appendChild(document.createTextNode(originalText.slice(lastIndex)));
                }
                if (node.parentNode) {
                    const parent = node.parentNode;
                    const replacementNodes = Array.from(fragment.childNodes);
                    highlightedNodeRecords.push({
                        originalNode: node,
                        replacementNodes,
                        parent
                    });
                    parent.replaceChild(fragment, node);
                }
            }
            trace("Highlighting pass complete", {
                examinedTextNodes: textNodes.length,
                highlightedElements: highlightedElements.length
            });
        });
    }
    function ensureStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement("style");
        style.id = STYLE_ID;
        style.textContent = `
            #${PANEL_ID} {
                width: fit-content;
                max-width: calc(100vw - 24px);
                height: min(850px, calc(100vh - 24px));
                max-height: calc(100vh - 24px);
                position: fixed;
                z-index: 2147483647;
                display: flex;
                flex-direction: column;
                background: #1c1e22;
                color: #e8eaf0;
                border: 1px solid #45484e;
                border-radius: 6px;
                box-shadow: 0 5px 24px rgba(0, 0, 0, 0.5);
                font:
                    12px/1.4 Arial,
                    sans-serif;
                overflow: hidden;
                box-sizing: border-box;
            }
            #${PANEL_ID}.fr-minimized {
                width: max-content;
                height: auto;
                max-height: none;
            }
            #${PANEL_ID}.fr-minimized #fr-template,
            #${PANEL_ID}.fr-minimized #fr-scan,
            #${PANEL_ID}.fr-minimized #fr-empty,
            #${PANEL_ID}.fr-minimized #fr-highlight,
            #${PANEL_ID}.fr-minimized #fr-tablewrap {
                display: none;
            }
            #${PANEL_ID} * {
                box-sizing: border-box;
            }
            #${PANEL_ID} .fr-head {
                display: flex;
                align-items: center;
                gap: 6px;
                padding: 4px 8px;
                background: #292c32;
                border-bottom: 1px solid #45484e;
                cursor: move;
                user-select: none;
                flex-shrink: 0;
                min-height: 34px;
                overflow: visible;
                white-space: nowrap;
            }
            #${PANEL_ID} .fr-title {
                font-weight: bold;
                color: #e8eaf0;
                margin-right: 4px;
            }
            #${PANEL_ID} button,
            #${PANEL_ID} select {
                font: inherit;
                font-size: 11px;
                line-height: 1;
                padding: 2px 6px;
                background: #101216;
                color: #fff;
                border: 1px solid #555;
                border-radius: 3px;
                cursor: pointer;
            }
            #${PANEL_ID} button:hover {
                background: #363940;
            }
            #${PANEL_ID} .fr-tablewrap {
                overflow-x: auto;
                overflow-y: auto;
                flex: 1 1 auto;
                min-height: 0;
                min-width: 0;
                background: #1c1e22;
                scrollbar-gutter: stable;
            }
            #${PANEL_ID} table {
                border-collapse: collapse;
                width: max-content;
                min-width: 0;
                table-layout: auto;
            }
            #${PANEL_ID} th {
                position: sticky;
                top: 0;
                background: #25282e;
                color: #e8eaf0;
                border-bottom: 1px solid #363940;
                padding: 4px 6px;
                font-weight: bold;
                text-align: left;
                z-index: 1;
                white-space: nowrap;
            }
            #${PANEL_ID} td {
                border-bottom: 1px solid #363940;
                padding: 3px 6px;
                text-align: left;
                vertical-align: middle;
            }
            #${PANEL_ID} td input {
                display: block;
                field-sizing: content;
                width: auto;
                min-width: 200px;
                max-width: 300px;
                background: #101216;
                color: #fff;
                border: 1px solid #555;
                border-radius: 3px;
                padding: 3px 5px;
                font: inherit;
            }
            #${PANEL_ID} th,
            #${PANEL_ID} td {
                width: fit-content;
                max-width: 600px;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            #${PANEL_ID} .fr-regex {
                font-family: ui-monospace, monospace;
                font-size: 11px;
                color: #ce9178;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 600px;
            }
            #${PANEL_ID}.fr-hide-regex #fr-regex-header,
            #${PANEL_ID}.fr-hide-regex .fr-regex {
                display: none;
            }
            .fr-highlight-mark {
                background-color: rgba(255, 235, 59, 0.35) !important;
                border-bottom: 1px dashed #ffeb3b !important;
            }
            .fr-highlight-case-mismatch {
                background-color: rgba(255, 152, 0, 0.4) !important;
                border-bottom: 1px dashed #ff9800 !important;
            }
        `;
        document.head.appendChild(style);
    }
    function initializeTextSnapshots(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (
                !parent ||
                parent.closest(`#${PANEL_ID}`) ||
                parent.closest(".fr-highlight-mark") ||
                isExcluded(parent) ||
                parent.closest(NON_CHAPTER_SELECTOR)
            ) {
                continue;
            }
            if (!processedNodeText.has(node)) {
                processedNodeText.set(node, node.textContent || "");
            }
        }
    }
    function addOccurrences(occurrences, sourceNode = null) {
        for (const occ of occurrences) {
            accumulatedOccurrences.push({
                ...occ,
                sourceNode: occ.sourceNode || sourceNode,
                startPos: occ.startPos
            });
        }
    }
    function appendNewOccurrences(text, sourceNode = null) {
        const value = String(text || "");
        if (!sourceNode) {
            if (value.trim()) {
                addOccurrences(extractOccurrences(value));
            }
            return;
        }
        const previous = processedNodeText.get(sourceNode);
        if (previous === value) return;
        processedNodeText.set(sourceNode, value);
        accumulatedOccurrences = accumulatedOccurrences.filter((occ) => occ.sourceNode !== sourceNode);
        if (value.trim()) {
            const occurrences = extractOccurrences(value, sourceNode);
            addOccurrences(occurrences);
        }
    }
    function renderRows() {
        const tbody = document.getElementById("fr-rows");
        if (!tbody) return;
        // Render one consistent candidate version.
        const candidates = [...currentCandidates];
        tbody.innerHTML = "";
        if (candidates.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #888; padding: 15px;">No candidates found.</td></tr>`;
            return;
        }
        candidates.forEach((cand) => {
            const displayName = settings.edits[cand.identityKey] ?? cand.phrase;
            const regexStr = generateRegex(displayName, settings.template);
            const tr = document.createElement("tr");
            // Name Cell (Editable)
            const tdName = document.createElement("td");
            const input = document.createElement("input");
            input.type = "text";
            input.value = displayName;
            input.addEventListener("change", (e) => {
                settings.edits[cand.identityKey] = e.target.value.trim();
                saveSettings();
                currentCandidates = sortAndFilterCandidates(calculateCandidateCounts(currentCandidates));
                renderRows();
                applyHighlights();
            });
            tdName.appendChild(input);
            // Counts Cell
            const tdCounts = document.createElement("td");
            tdCounts.className = "fr-counts";
            tdCounts.textContent = cand.tokenCountsStr.split(",").slice(0, 4).join(",");
            // Regex Cell
            const tdRegex = document.createElement("td");
            tdRegex.className = "fr-regex";
            tdRegex.textContent = regexStr;
            tdRegex.title = regexStr;
            // Action Cell
            const tdAction = document.createElement("td");
            const btnCopy = document.createElement("button");
            btnCopy.textContent = "📋";
            btnCopy.title = "Copy Regular Expression";
            btnCopy.addEventListener("click", () => {
                navigator.clipboard.writeText(regexStr);
            });
            tdAction.appendChild(btnCopy);
            const tdHighlight = document.createElement("td");
            const btnHighlight = document.createElement("button");
            btnHighlight.textContent = highlightedCandidates.has(cand.identityKey) ? "🔆" : "🔍";
            btnHighlight.title = "Toggle Highlight for This Candidate";
            btnHighlight.addEventListener("click", () => {
                if (settings.highlightedAll) {
                    settings.highlightedAll = false;
                    highlightedCandidates.clear();
                    const allButton = document.getElementById("fr-highlight");
                    if (allButton) {
                        allButton.textContent = "🔦";
                        allButton.title = "Turn highlighting on";
                        allButton.setAttribute("aria-pressed", "false");
                    }
                }
                if (highlightedCandidates.has(cand.identityKey)) {
                    highlightedCandidates.delete(cand.identityKey);
                } else {
                    highlightedCandidates.add(cand.identityKey);
                }
                saveSettings();
                applyHighlights();
                renderRows();
            });
            tdHighlight.appendChild(btnHighlight);
            tr.append(tdHighlight, tdName, tdCounts, tdRegex, tdAction);
            tbody.appendChild(tr);
        });
    }
    function renderAccumulatedScan() {
        currentCandidates = processCandidates(accumulatedOccurrences);
        renderRows();
        applyHighlights();
    }
    function runScan() {
        if (isScanning) return;
        isScanning = true;
        try {
            const runs = extractVisibleText(document.body).segments;
            if (accumulatedOccurrences.length === 0) {
                nextOccurrencePos = 0;
                processedNodeText = new WeakMap();
                for (const run of runs) {
                    const occurrences = extractRunOccurrences(run);
                    for (const occurrence of occurrences) {
                        occurrence.position = nextOccurrencePos++;
                        accumulatedOccurrences.push(occurrence);
                    }
                    for (const segment of run.segments) {
                        processedNodeText.set(segment.node, segment.textSnapshot);
                    }
                }
            } else {
                for (const run of runs) {
                    const changed = run.segments.some(
                        (segment) => processedNodeText.get(segment.node) !== segment.textSnapshot
                    );
                    if (!changed) continue;
                    const occurrences = extractRunOccurrences(run);
                    for (const occurrence of occurrences) {
                        occurrence.position = nextOccurrencePos++;
                        accumulatedOccurrences.push(occurrence);
                    }
                    for (const segment of run.segments) {
                        processedNodeText.set(segment.node, segment.textSnapshot);
                    }
                }
            }
            renderAccumulatedScan();
            startScanObserver();
        } finally {
            isScanning = false;
        }
    }
    function startScanObserver() {
        if (observer) observer.disconnect();
        observer = new MutationObserver((mutations) => {
            if (isScanning) return;
            const affectedNodes = new Set();
            for (const mutation of mutations) {
                const target = mutation.target;
                const targetElement = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
                if (
                    targetElement?.closest(`#${PANEL_ID}`) ||
                    targetElement?.closest(".fr-highlight-mark") ||
                    (mutation.type === "childList" &&
                        [...mutation.addedNodes, ...mutation.removedNodes].some(
                            (node) =>
                                node.nodeType === Node.ELEMENT_NODE &&
                                (node.matches(".fr-highlight-mark") || node.closest(".fr-highlight-mark"))
                        ))
                ) {
                    continue;
                }
                if (mutation.type === "characterData") {
                    affectedNodes.add(target);
                } else if (mutation.type === "childList") {
                    affectedNodes.add(target);
                    for (const node of mutation.addedNodes) {
                        if (node.nodeType === Node.TEXT_NODE) {
                            affectedNodes.add(node);
                        } else if (node.nodeType === Node.ELEMENT_NODE) {
                            const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
                            let textNode;
                            while ((textNode = walker.nextNode())) {
                                affectedNodes.add(textNode);
                            }
                        }
                    }
                }
            }
            if (affectedNodes.size === 0) return;
            const runs = extractVisibleText(document.body).segments;
            const affectedRuns = runs.filter((run) =>
                run.segments.some((segment) => {
                    if (affectedNodes.has(segment.node) || affectedNodes.has(segment.node.parentElement)) {
                        return true;
                    }
                    for (const affectedNode of affectedNodes) {
                        if (
                            affectedNode.nodeType === Node.ELEMENT_NODE &&
                            (affectedNode.contains(segment.node) || segment.node.parentElement?.contains(affectedNode))
                        ) {
                            return true;
                        }
                    }
                    return false;
                })
            );
            let changed = false;
            for (const run of affectedRuns) {
                const isChanged = run.segments.some(
                    (segment) => processedNodeText.get(segment.node) !== segment.textSnapshot
                );
                if (!isChanged) continue;
                const occurrences = extractRunOccurrences(run);
                for (const occurrence of occurrences) {
                    occurrence.sourceNodes = run.segments.map((segment) => segment.node);
                    occurrence.position = nextOccurrencePos++;
                    accumulatedOccurrences.push(occurrence);
                }
                for (const segment of run.segments) {
                    processedNodeText.set(segment.node, segment.textSnapshot);
                }
                changed = true;
            }
            if (changed) {
                renderAccumulatedScan();
            }
        });
        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }
    function createPanel() {
        if (document.getElementById(PANEL_ID)) return;
        ensureStyle();
        const panel = document.createElement("div");
        panel.id = PANEL_ID;
        panel.style.left = `${Math.max(0, settings.x)}px`;
        panel.style.top = `${Math.max(0, settings.y)}px`;
        panel.innerHTML = `
            <div class="fr-head">
                <label style="display:flex; align-items:center; gap:4px; margin-left: auto;">
                    <select id="fr-template">
                        ${TEMPLATES.map(
                            (t) => `<option value="${t}" ${t === settings.template ? "selected" : ""}>${t}</option>`
                        ).join("")}
                    </select>
                </label>
                <button id="fr-scan" title="Scan the page">🔍</button>
                <button id="fr-empty" title="Clear accumulated scan data">🗑</button>
                <button id="fr-highlight" title="Toggle Highlight All">🔦</button>
                <button id="fr-hide-regex" title="Hide Regex column" aria-pressed="false">👁</button>
                <button id="fr-minimize" title="Minimize panel">−</button>
                <button id="fr-close" title="Close Panel">×</button>
            </div>
            <div class="fr-tablewrap" id="fr-tablewrap">
                <table id="fr-table">
                    <thead>
                        <tr>
                            <th>Hi</th>
                            <th>Name</th>
                            <th>Ct</th>
                            <th id="fr-regex-header">Regex</th>
                            <th>RC</th>
                        </tr>
                    </thead>
                    <tbody id="fr-rows"></tbody>
                </table>
            </div>
        `;
        const highlightAllButton = panel.querySelector("#fr-highlight");
        function updateHighlightAllButton() {
            highlightAllButton.textContent = settings.highlightedAll ? "🔦✓" : "🔦";
            highlightAllButton.title = settings.highlightedAll ? "Turn highlighting off" : "Turn highlighting on";
            highlightAllButton.setAttribute("aria-pressed", String(settings.highlightedAll));
        }
        updateHighlightAllButton();
        document.body.appendChild(panel);
        const hideRegexButton = panel.querySelector("#fr-hide-regex");
        hideRegexButton.addEventListener("click", () => {
            const hidden = panel.classList.toggle("fr-hide-regex");
            hideRegexButton.textContent = hidden ? "⊘" : "👁";
            hideRegexButton.title = hidden ? "Show Regex column" : "Hide Regex column";
            hideRegexButton.setAttribute("aria-pressed", String(hidden));
        });
        const minimizeButton = panel.querySelector("#fr-minimize");
        const tableWrap = panel.querySelector("#fr-tablewrap");
        minimizeButton.addEventListener("click", () => {
            const minimized = panel.classList.toggle("fr-minimized");
            minimizeButton.textContent = minimized ? "▢" : "—";
            minimizeButton.title = minimized ? "Restore panel" : "Minimize panel";
        });
        panel.querySelector("#fr-scan").addEventListener("click", runScan);
        panel.querySelector("#fr-empty").addEventListener("click", () => {
            clearHighlights();
            accumulatedOccurrences = [];
            nextOccurrencePos = 0;
            processedNodeText = new WeakMap();
            highlightedCandidates.clear();
            runScan();
        });
        panel.querySelector("#fr-highlight").addEventListener("click", () => {
            settings.highlightedAll = !settings.highlightedAll;
            saveSettings();
            updateHighlightAllButton();
            applyHighlights();
        });
        panel.querySelector("#fr-template").addEventListener("change", (e) => {
            settings.template = e.target.value;
            saveSettings();
            renderRows();
            applyHighlights();
        });
        panel.querySelector("#fr-close").addEventListener("click", () => {
            clearHighlights();
            panel.remove();
        });
        makeDraggable(panel, panel.querySelector(".fr-head"));
        runScan();
    }
    function makeDraggable(panel, handle) {
        let isDragging = false;
        let startX, startY, initialLeft, initialTop;
        let activePointerId = null;
        function stopDragging() {
            if (!isDragging) return;
            isDragging = false;
            activePointerId = null;
            settings.x = panel.offsetLeft;
            settings.y = panel.offsetTop;
            saveSettings();
        }
        handle.addEventListener("pointerdown", (e) => {
            if (e.target.closest("button, select, input, label")) return;
            if (e.button !== 0) return;
            isDragging = true;
            activePointerId = e.pointerId;
            startX = e.clientX;
            startY = e.clientY;
            initialLeft = panel.offsetLeft;
            initialTop = panel.offsetTop;
            e.preventDefault();
            panel.setPointerCapture(e.pointerId);
        });
        panel.addEventListener("pointermove", (e) => {
            if (!isDragging || e.pointerId !== activePointerId) return;
            panel.style.left = `${Math.max(0, initialLeft + e.clientX - startX)}px`;
            panel.style.top = `${Math.max(0, initialTop + e.clientY - startY)}px`;
        });
        panel.addEventListener("pointerup", (e) => {
            if (e.pointerId !== activePointerId) return;
            stopDragging();
            if (panel.hasPointerCapture(e.pointerId)) {
                panel.releasePointerCapture(e.pointerId);
            }
        });
        panel.addEventListener("pointercancel", stopDragging);
        panel.addEventListener("lostpointercapture", stopDragging);
        window.addEventListener("blur", stopDragging);
    }
    if (typeof GM_registerMenuCommand === "function") {
        GM_registerMenuCommand("Open", createPanel);
    }
})();
