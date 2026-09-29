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

## Next Tasks
1. ...
2. ...
3. ...
