The notes should now reflect the **current 6.1.29 state**, especially the automatic chapter-container system and the Part 2 fixes. I would replace the old notes with this cleaned version:

# Webnovel Cleaner — Development Notes

## Current Version

* Version: 6.1.29
* Current commit:
* Date: 2026-09-29

## Architecture

* Whole-page candidate scanning
* FoxReplace database is read-only
* WNC never applies FoxReplace rules
* Candidates → Groups → Conflicts
* Candidate normalization is separate from FoxReplace rule text
* Chapter text is obtained through automatic DOM-based chapter-container detection

## Candidate Detection

* Candidate detection uses observed capitalized words/phrases from chapter text.
* Normalization is applied before clustering and matching.
* Curly apostrophes are normalized before possessive processing.
* Possessives are normalized safely.
* Common plural forms are normalized to their singular form.
* Very short words are protected from unsafe singularization.
* Configured singularization exceptions are preserved.
* Candidate variants remain available for matching.
* Matching forms are trimmed and deduplicated.
* The 5% frequency cutoff applies only to genuinely isolated candidates.

## Clustering

* Roots are selected strictly by descending frequency.
* Each root absorbs only candidates directly linked to that root.
* Maximum two-token links are used for candidate relationships.
* Transitive chain expansion is not used.
* Unrelated candidates are not merged through an intermediate candidate.
* Frequency determines root-selection priority.
* Cluster members are sorted by frequency.
* The 5% filter applies only to genuinely isolated candidates.

## Classification

* Candidate = no exact or partial FoxReplace rule match.
* Group = exactly one exact rule match and no partial match.
* Conflict = all remaining match cases, including multiple matches and ambiguous exact/partial combinations.

## FoxReplace Matching

* Matching uses observed candidate variants.
* Matching forms are normalized to trimmed strings.
* Text rules use direct text matching.
* Whole-word rules use word boundaries.
* Whole-word rules are exact only when the complete candidate matches the rule input.
* A whole-word rule occurring inside a larger candidate is classified as partial.
* Regex rules require the entire candidate to match for an exact match.
* Zero-length regex matches are excluded from partial classification.
* Regex state is reset before repeated matching operations.
* Supplied regex flags are preserved except for the global flag.
* Candidate normalization does not modify FoxReplace rule text.

## Groups

* FoxReplace group order is preserved.
* FoxReplace rule order is preserved using `ruleIndex`.
* Only rules matching observed candidates are shown.
* Matched rules contain their matching candidates in `rule.candidates`.
* Duplicate candidates are prevented within a matched rule.
* Group membership is based on classification rather than candidate frequency.

## Conflicts

* Conflicts are always displayed.
* Conflicting candidates retain discovery order.
* Each conflicting rule produces an individual display conflict record.
* Conflict records retain candidate, group, and rule objects.
* Conflict records contain candidate name, frequency, cluster ID, match type, group name, rule input, and rule output.
* Affected FoxReplace group names are shown.
* Conflicts are not silently assigned to a group.
* Conflict rule entries are validated before use.
* Conflict rule keys are validated before clustering.
* Rule-output conflicts are clustered through shared source/target rule relationships.

## Generated Inputs

* Candidate normalization is separate from generated FoxReplace input.
* Generated input spacing is normalized.
* Other input uses the candidate's available display/name fields.
* Korean input uses the normalized candidate name.
* Japanese input generates escaped regex patterns.
* Japanese multi-token input supports forward and reversed token order.
* Japanese generated regexes use boundaries around Latin alphanumeric/apostrophe characters.
* Candidate template selection is validated against available templates.
* Generated inputs are regenerated when the template changes.

## Chapter Container

* Chapter-container detection is fully automatic.
* Site-specific selector storage has been removed.
* Fixed selector fallback lists have been removed.
* The detector evaluates usable DOM elements.
* Script, style, noscript, template, navigation, header, footer, aside, form, and SVG elements are excluded.
* Candidate containers require at least 100 characters of normalized text.
* Meaningful text-bearing child elements are counted.
* DOM depth is considered when selecting between otherwise suitable containers.
* Candidate containers are ranked by usable text length, meaningful child count, and depth.
* Parent containers are compared against their child containers.
* A parent remains eligible when it adds at least 10% additional usable text.
* A parent adding less than 10% additional usable text ends the selection climb.
* The document body remains the final fallback.
* `getChapterScanInfo()` returns the automatically selected container and normalized chapter text.

## UI

* The toolbar no longer contains a chapter CSS selector field.
* The toolbar no longer contains a selector Save button.
* Selector-related CSS has been removed.
* `renderWncWindow()` generates the WNC shell and active-tab content.
* `render()` places the generated markup into the overlay and binds events.
* Rule expansion keys use `group.index` and `rule.ruleIndex`.
* Rendered rule data attributes use `rule.ruleIndex`.
* Event-based rule lookup uses `rule.ruleIndex`.
* Group and rule sorting preserve original FoxReplace order through group indexes and rule indexes.

## Error Handling

* Analysis results use a consistent result structure.
* Empty analysis returns empty candidate, group, and conflict arrays.
* Safe analysis failure returns `chapterText`, `candidates`, `groupMatches`, `conflicts`, and `error`.
* Invalid or malformed match data is skipped safely.
* Invalid regex rules return no match instead of interrupting analysis.
* Missing conflict arrays and entries are handled safely.

## Removed / Deprecated

* Saved site-specific chapter selectors
* Fixed chapter-selector fallback hierarchy
* Manual chapter CSS selector UI
* Selector Save event handling
* Selector-related CSS
* Transitive candidate clustering
* Duplicate `analyzePage()` declaration
* Duplicate `render()` declaration
* Duplicate `readFileText()` declaration
* Redundant conflict-match construction
* Redundant selector state handling
* Nonessential executable-code comments

## Completed Fixes

* Fixed syntax error caused by an unclosed `registerWncMenuCommands()` function.
* Removed duplicate `analyzePage()` and `render()` declarations.
* Removed duplicate `readFileText()` declaration.
* Declared `chapterText` locally for strict-mode compatibility.
* Fixed possessive normalization.
* Added safer plural normalization.
* Prevented incorrect conversions such as:

  * `cases` → `cas`
  * `houses` → `hous`
  * `heroes` → `heroe`
* Added correct handling for:

  * `cities` → `city`
  * `stories` → `story`
  * `boxes` → `box`
  * `churches` → `church`
  * `wishes` → `wish`
  * `sizes` → `size`
  * `cases` → `case`
  * `houses` → `house`
  * `classes` → `class`
  * `heroes` → `hero`
  * `potatoes` → `potato`
* Preserved configured singularization exceptions.
* Normalized curly apostrophes before processing.
* Protected very short words from unsafe singularization.
* Separated candidate normalization from FoxReplace rule text.
* Changed clustering to strict descending-frequency root selection.
* Limited roots to directly linked candidates.
* Removed transitive chain expansion.
* Corrected whole-word exact/partial matching.
* Added candidate variant matching.
* Normalized matching forms before rule comparison.
* Added zero-length regex protection for partial matching.
* Added regex state resets.
* Corrected matched rule candidate storage from `matchedCandidates` to `candidates`.
* Corrected rule sorting and lookup from `rule.index` to `rule.ruleIndex`.
* Hardened conflict rule-key handling.
* Hardened rule-output conflict clustering.
* Corrected empty analysis result structure.
* Corrected safe analysis error result structure.
* Rebuilt chapter-container detection around automatic DOM analysis.
* Removed manual chapter-container configuration.
* Removed obsolete selector UI and event handling.
* Cleaned Japanese generated-input construction.
* Removed redundant conflict-match construction.
* Removed redundant try/catch around `parseImportedText()`.

## Validation

* `node --check WNC_6.1.29.js` passes.
* All seven script parts were validated as sequential slices of the same script.
* Part 1, Part 2, and Part 3 were reconciled during the 6.1.29 rebuild.

## Known Bugs

* Conflict `clusterId` assignment and conflict-cluster display integration remain an area for final verification.
* Automatic chapter-container selection should be tested against pages with nested article/content wrappers.
