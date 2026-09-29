# Webnovel Cleaner — Development Notes

## Current Version
- Version:
- Current commit:
- Date:

## Architecture
- Whole-page scanning
- FoxReplace database is read-only
- WNC never applies FoxReplace rules
- Candidates → Groups → Conflicts

## Candidate Detection
- Regex:
- Normalization:
- Possessives/plurals:
- Frequency:
- 5% cutoff:

## Clustering
- Highest-frequency unclustered candidate becomes root
- Subsequent roots are selected by frequency
- Maximum two token links
- Chains are allowed
- Cluster members sorted by frequency

## Classification
- Candidate = no exact/partial rule match
- Group = exactly one exact match and no partial
- Conflict = everything else

## Groups
- Preserve FoxReplace group/rule order
- Show only matched rules
- Expand rules to matched candidates

## Conflicts
- Always displayed
- Clustered
- Discovery order preserved
- Show affected group names

## Removed / Deprecated
- Chapter-container detection
- Chapter selector
- ...

## Known Bugs
- ...

## Completed Fixes
- ...
## normalizeCandidateToken()

### Changes
- Fixed possessive normalization.
- Added safer plural normalization.
- Prevents incorrect conversions such as:
  - `cases` → `cas`
  - `houses` → `hous`
  - `heroes` → `heroe`
- Added handling for:
  - `cities` → `city`
  - `stories` → `story`
  - `boxes` → `box`
  - `churches` → `church`
  - `wishes` → `wish`
  - `sizes` → `size`
  - `cases` → `case`
  - `houses` → `house`
  - `classes` → `class`
  - `heroes` → `hero`
  - `potatoes` → `potato`
- Preserves configured singularization exceptions.
- Normalizes curly apostrophes before processing.
- Avoids singularizing very short words.
## Next Tasks
1. ...
2. # WNC 6.1.29 Audit and Update Notes

## Structural fixes
- Fixed the syntax error caused by an unclosed `registerWncMenuCommands()` function.
- Removed duplicate `analyzePage()` and `render()` declarations.
- Removed the duplicate `readFileText()` declaration.
- Declared `chapterText` for strict-mode compatibility.

## Candidate normalization
- Possessives and plurals are normalized before clustering.
- Preserves singularization exceptions.
- Handles common plural forms.
- Keeps candidate normalization separate from FoxReplace rule text.

## Clustering
- Roots are selected strictly by descending frequency.
- Each root absorbs only candidates directly linked to that root.
- Removed transitive chain expansion that could incorrectly merge unrelated candidates.
- Frequency remains the clustering hierarchy.
- The 5% filter applies only to genuinely isolated candidates.

## Matching
- Whole-word rules are exact only when the entire candidate equals the rule input.
- Whole-word matches inside a larger candidate are partial.
- Regex rules require the entire candidate for an exact match.
- Matching uses observed candidate variants.

## Chapter container
- Added site-specific CSS selector storage.
- Default selectors:
  `.entry-content`
  `.text-left`
  `article`
  `main`
  `.prose`
- Falls back through the defaults and ultimately to `body`.
- Added a CSS selector field and Save button.

## Cleanup
- Removed nonessential comments from executable code.
- Kept only the required userscript metadata header.
- Version: 6.1.29

## Validation
- `node --check WNC_6.1.29.js` passes.
- All seven parts are sequential slices of the same validated script.
3. ...
4. ...
