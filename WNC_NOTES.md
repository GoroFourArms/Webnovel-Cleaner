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
* Chapter text is obtained using a configurable site-specific CSS selector with fallback selectors

## Candidate Detection

* Candidate detection uses observed capitalized words/phrases from the chapter text.
* Normalization is applied before clustering and matching.
* Curly apostrophes are normalized before possessive processing.
* Possessives are normalized safely.
* Common plural forms are normalized to their singular form.
* Very short words are protected from unsafe singularization.
* Configured singularization exceptions are preserved.
* Candidate variants remain available for matching.
* The 5% frequency cutoff applies only to genuinely isolated candidates.

## Clustering

* Roots are selected strictly by descending frequency.
* Each root absorbs only candidates directly linked to that root.
* Maximum two-token links are used for candidate relationships.
* Transitive chain expansion is not used.
* Unrelated candidates are therefore not merged merely because they are connected through another candidate.
* Frequency determines root-selection priority.
* Cluster members are sorted by frequency.
* The 5% filter applies only to genuinely isolated candidates.

## Classification

* Candidate = no exact or partial FoxReplace rule match.
* Group = exactly one exact rule match and no partial match.
* Conflict = all remaining cases, including multiple matches or ambiguous exact/partial combinations.

## FoxReplace Matching

* Matching uses observed candidate variants.
* Whole-word rules are exact only when the entire candidate matches the rule input.
* A whole-word rule occurring inside a larger candidate is a partial match.
* Regex rules require the entire candidate to match for an exact match.
* Candidate normalization does not modify FoxReplace rule text.

## Groups

* FoxReplace group order is preserved.
* FoxReplace rule order is preserved.
* Only rules that match one or more observed candidates are shown.
* Matched rules are expanded to show their matched candidates.
* Group membership is based on the matching classification rather than candidate frequency.

## Conflicts

* Conflicts are always displayed.
* Conflicting candidates are clustered using the same direct-link clustering system.
* Discovery order is preserved.
* Affected FoxReplace group names are shown.
* Conflicts are not silently assigned to a group.

## Chapter Container

* Site-specific CSS selector storage is supported.
* The configured selector is used to locate chapter text.
* Default fallback selectors:

  * `.entry-content`
  * `.text-left`
  * `article`
  * `main`
  * `.prose`
* Falls back ultimately to `body` if no configured/default selector is found.
* A CSS selector field and Save button are available for configuring the site-specific selector.

## Removed / Deprecated

* Fixed/hard-coded chapter-container detection as the primary mechanism.
* Chapter selector as a fixed one-site-only assumption.
* Transitive clustering / chain expansion.
* Duplicate `analyzePage()` declaration.
* Duplicate `render()` declaration.
* Duplicate `readFileText()` declaration.
* Nonessential executable-code comments.

## Known Bugs

* None currently documented.

## Completed Fixes

* Fixed syntax error caused by an unclosed `registerWncMenuCommands()` function.
* Removed duplicate `analyzePage()` and `render()` declarations.
* Removed duplicate `readFileText()` declaration.
* Declared `chapterText` for strict-mode compatibility.
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
* Avoided singularizing very short words.
* Separated candidate normalization from FoxReplace rule text.
* Changed clustering to strict descending-frequency root selection.
* Limited each root to candidates directly linked to that root.
* Removed transitive chain expansion.
* Corrected whole-word exact/partial matching behavior.
* Added site-specific chapter CSS selector storage.
* Added default chapter-container selector fallbacks.
* Added final `body` fallback.
* Added CSS selector field and Save button.
* Removed nonessential executable comments.
* Validated syntax with `node --check WNC_6.1.29.js`.
* All seven script parts were validated as sequential slices of the same script.

## Validation

* `node --check WNC_6.1.29.js` passes.
* All seven parts are sequential slices of the same validated script.
