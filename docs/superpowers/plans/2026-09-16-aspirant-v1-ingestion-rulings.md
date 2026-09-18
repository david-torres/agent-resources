# Rulings — ENCLAVE: Aspirant V1 ingestion (plan 2)

Every decision taken while executing
`docs/superpowers/plans/2026-09-16-aspirant-v1-ingestion.md` that the plan did not
already settle, in the order it was taken. A plan under execution cannot stop for a
human on every conflict, so each of these was decided, recorded with its reason, and
carried forward. Most name what they cost if they are wrong; those costs are stated
as they were judged at the time.

40 rulings across the fourteen tasks. They are reproduced here because the
execution ledger they came from lives in a git-ignored scratch directory that is
deleted when the branch finishes, and these are the decisions someone reading this
work later will want to argue with.


## Task 1

1. the pre-release book's load is NOT fully applied on this local database and that drift is out of scope. Measured before any of this plan's work: `20 classes resolved (19 update, 1 create)`, Charlatan absent, and 3 rows (Ardent, Offdriver, Squire) differing on `tips` and `abilities`. My plan text claimed `20 update, 0 create, 0 differ`, which was wrong; Task 10 Step 6's expected output is corrected to the measured lines and carries an explicit "do NOT --apply the pre-release loader to make this match". Why: the check exists to prove the descriptor refactor changed nothing, not to converge the database — applying it would write content unrelated to this plan onto real rows. Cost if wrong: Task 10's regression check compares against a baseline that is itself drifted, so a refactor bug that happened to alter exactly these three rows' tips/abilities would hide inside the existing delta; mitigated because the field list (`tips`, `abilities` only, on exactly 3 named rows) is now pinned in the plan and any change to that shape is visible.

2. the reviewer's comment finding stands even though the sentence came verbatim from my plan's code block. Why: CLAUDE.md's comment rule ("never narrate history... that history belongs in git") is a standing project constraint and binds over the plan, which is only its argument; the plan block was my error and is corrected in the same wave so the sentence cannot be reintroduced by a later reader. Cost if wrong: a one-sentence comment, trivially reversible.


## Task 3

3. the implementer's deviation from my Step 3 pseudocode is accepted as written. Page-wide yMin grouping — which is what I specified — produces ~1990 false merges book-wide (credits columns, contents rows sharing a baseline) and collapses the rating tally to 557. Anchoring on detached-rating candidates plus an x-adjacency bound of 5pt is correct: measured real inter-word gaps are 1.3-2.1pt against 79pt+ to unrelated same-baseline lines, and the resulting merge count is exactly 21, matching the geometry document's enumerated table entry-for-entry. Plan text corrected in f36f004. Cost if wrong: a detached rating sitting further than 5pt from its host would be missed; bounded because all 21 known cases are enumerated in the geometry doc and all 21 are found.

4. `isSuperscript`'s height test changes from a band around 0.583 to an upper bound of 0.75, keeping the top-hang test at 0.65 ± 0.05 as the precise discriminator. Why: my geometry document claimed the 0.583 ratio was exact in all 601 inline cases and it is not — I verified against raw pdftotext that p21 `Deadlier L-H` sets the rating at 6.847 on a 13.050 line (ratio 0.5247), the superscript size of the 11.75 body bucket used on a 13.05 line. That word's top-hang is 0.6618, comfortably inside the band, so the precise test already accepts it and only the narrow height band rejected it. The semantic that matters is "markedly smaller than its body text", not "exactly 58.3% of it". Geometry doc corrected in f36f004. Cost if wrong: a loosened bound could admit some other small word as a rating — bounded because `markPowerRatings` additionally requires membership in the ten-string POWER_RATINGS set, and because body text sits at ratio 1.0, far outside the bound.

5. I am adding the p63 host-split unit test to fix round 2 even though the reviewer classed it Minor and it is not a spec miss. Why: p63 is one of only two places in the book where pdftotext splits the host line into fragments around the gap, and its correctness currently rests entirely on an out-of-band scratchpad script rather than on anything in the repo — a guard that does not live in the repo is not a guard. Cost if wrong: one extra test and a few minutes of implementer time; no production code changes.


## Task 4

6. my brief contained two mathematically indistinguishable tests — a lone line at xMin 90.72 expected to throw as an orphan, and a two-line wrapped note at the same xMin expected not to. Under baseX = min(xMin over note-start lines) a solitary note is always its own baseline and computes depth 0, so no implementation of the specified rule can separate them. The implementer satisfied both with a `rawLines.length < 2 -> throw` guard and flagged it. I am replacing that guard with real orphan detection (a note deeper than anything preceding it) and rewriting the test. Why: the line-count guard is a latent bug, not merely arbitrary — it rejects any genuinely single-note list, and a class with one Conduit tip is plausible content that would fail extraction with an error naming the tip's own text. Cost if wrong: if some real column does contain a true orphan that the depth rule cannot see, it is silently promoted to top level instead of throwing; bounded because the whole-book gate confirms max depth 1 across all 24 lists, meaning no depth-2 nesting exists for an orphan to fall out of.


## Task 5

7. all eight of the implementer's deviations from my brief are ACCEPTED, and the plan is corrected in 053290c. Each was forced by a measured counterexample; I verified the two load-bearing ones directly against pdftotext rather than taking them on report.

8. I am folding two Minors into this fix round rather than deferring them — a test asserting COLUMN_SPLIT_X against itself (would pass with signatureEntries deleted), and a test whose name claims dividers determine entry count when name blocks do. Why: both are in the test file already being edited this round, and a test whose name misdescribes its mechanism actively misleads the next reader. Cost if wrong: a few minutes of implementer time.

9. the implementer's disclosed CONTENT_MIN_Y 39->0 no-op is ACCEPTED as-is rather than sent back for a pinning test. Why: the re-reviewer traced the mechanism — the first entry's span starts at blockTop(firstNameBlock) - ENTRY_LEAD, so anything above it is dropped structurally regardless of CONTENT_MIN_Y — so no honest fixture can make that direction fail, and fabricating one would have produced a green table and a worthless test. The direction the brief actually warns about (39->60, which loses entries on p57 and p75) IS pinned. Cost if wrong: a lowered floor could admit header content on some page shape not present in this book; bounded by the structural drop the re-reviewer traced.


## Task 6

10. the implementer's replacement of noteTree's shared deriveThreshold with the geometry doc's `leading > 0.93 x lineHeight` is ACCEPTED. It fixes a real bug — 11 of the 70 ability entries with notes print no wrapped line, so min-leading-plus-margin collapsed their whole note run into a single note (p22 `Stick 'Em Up`: four notes became one). I verified the no-regression claim independently rather than on report: parsed the whole book under both the pre-Task-6 and post-Task-6 modules and diffed signatureEntries across all 24 signature pages — 144 entries, ZERO pages differ. Cost if wrong: the threshold governs note segmentation for signatures, abilities and tips; bounded by that byte-level diff plus Task 9's token-for-token verifier.

11. `dedication` is added to the ability record shape, not only to sample perks. p64 `Gravity Check` prints an In Honor of line under the ability name, 60pt above its Sample Perks heading; without the field the book's dedication count is 37 rather than 38. Plan record shape corrected in 599984e. Cost if wrong: an extra always-null key on 71 of 72 abilities, which the loader would carry into jsonb; trivially reversible.

12. ability-page indents are measured from each entry's own `Paired Action:` label rather than an absolute page frame, and shiftFor is not called on these pages. The geometry doc's §3b recto/verso table does not hold here — p37's first entry prints every structural x 10.56pt right of it, with two further frame offsets elsewhere, and absolute-x classification mis-files 15 of 72 entries. Cost if wrong: entry-relative measurement could drift if a page lacked its anchor label, but `Paired Action:` is verified to occur exactly 3 times on all 24 pages with zero exceptions.

13. I am folding five Minor comment-accuracy findings into a fix round rather than deferring them to the final review. Why: three later tasks read util/aspirant-extract.js, and this plan has already lost a round to exactly this class of defect — CONTENT_MAX_Y shipped with a stated mechanism that was false while the constant was genuinely needed. Two of the five state measurable falsehoods a later reader could rely on (a claimed >200pt entry gap that is really 180.14; a claimed exclusivity that `Sample Perks` breaks on p12). Cost if wrong: one short round on comment text with no production change.


## Task 7

14. all six of the implementer's deviations ACCEPTED, and independently confirmed by the reviewer. The load-bearing one: my "exact box 336.00-565.20" rule for the three prose paragraphs is false in BOTH directions — p60's Examples heading block is 336.000-565.199 at the same line height and contiguous (selects four), while p42 and p54 set their right edge at 565.201-565.205 (drops real paragraphs). The two edges are 0.001pt apart. Retracted in the plan (a20b0c5) and in the geometry document (cc47d5d).

15. I am folding two Minors into a fix round. (a) PROSE_OPENINGS[0] and [2] are unpinned — loosening either fails zero tests — leaving the cover's highest-consequence invariant two-thirds untested; this is the guard against Conduit guidance landing in the player-facing overview, which no count or token check catches. (b) listUnder silently drops list lines off-indent and silently drops child notes, while the prose band twenty lines above throws for exactly that hazard; the asymmetry is the one place this module trusts geometry without asserting it. Cost if wrong: one short round, no production behaviour change beyond added throws.

16. the implementer's refusal to add the requested child-note throw is UPHELD. Independently verified by the re-reviewer: once listBetween's indent assertion passes, every line in the band sits within ±1.0 of one x, so the widest spread is 2.0, and noteTree's depth = round(2.0/18.72) = 0 for every line — no floating-point slack approaches the 9.36 needed to round to 1. Depth is always 0, the parent lookup is never consulted, and a child cannot be constructed. Adding the throw would ship an unreachable branch that no test could pin, which the no-dead-code rule forbids. Cost if wrong: if some later change reorders the guards so the x-assertion no longer runs first, a dropped child note becomes silent again; bounded because the assertion and the noteTree call are adjacent in one function.


## Task 8

17. added `0-L`, `0-M`, `0-H` to POWER_RATINGS and nothing else. I swept every superscript-height token on pages 18-89 before ordering the change rather than patching the reported instances; the sweep found the complete set of 14 distinct tokens and turned up a fourteenth nobody had reported — `L-H,` on p45 with its comma fused into the superscript word. Marked ratings 606 -> 613; zero-bounded inside <sup> 0 -> 6; the fused mark now emits outside the tag. A test pins that a speculative `0-H+`, which the book does not print, reads as plain text. Cost if wrong: if some `0-` form exists that the sweep missed it renders plain; bounded by Task 9's token gate.

18. band-aware joinLines STAYS although it is now unobservable on this book (with every detached cell a known rating, a plain yMin sort serialises identically — verified byte-identical by md5). Why: Task 9 compares token multisets per entry, and a multiset structurally cannot see a word misordered inside its own paragraph, so this is the only guard for that defect class; deleting it would convert "POWER_RATINGS is complete" from a property into a silent correctness precondition, and this task just proved that set was incomplete for three strings. Reviewer independently agreed. Cost if wrong: four lines that currently change nothing.


## Task 9

19. DELETE RAISED_MAX_LENGTH although Task 8 ruled to KEEP band-aware joinLines under the same "unobservable on this book" heading. The two are not alike: joinLines is the only guard for a defect class a token multiset structurally cannot see, whereas repairRaisedRatings already fails loudly on a mis-placed repair — gluing two printed words together can only widen the difference from the record — so the length bound guards nothing and its comment claims a role the indent-uniqueness condition beside it actually performs. Cost if wrong: a lone long line at a unique indent could be mistaken for a stranded rating, which the token comparison then reports as a failure rather than passing.

20. the verifier's pure primitives move to a new util/aspirant-verify.js so its constants can be pinned at all. scripts/run-tests.mjs:54 scans only models, routes, services, test, util and views, so nothing in scripts/ can carry a unit test, which leaves MIN_GUTTER_WIDTH, the / {3,}\S/ inter-column threshold and RAISED_NOTATION untested in the file that is this project's correctness gate — and RAISED_NOTATION is the one check standing between <sup> around an ordinary word and a clean run. This is the arrangement the extractor already uses for the same reason. Independence is from the EXTRACTOR, not from util/: sharing a directory costs nothing, importing from util/aspirant-extract.js would cost everything. Cost if wrong: a file move and a thin CLI, reversible in one commit.

21. a skipped record must not leave exit 0 (reviewer's M4). A row without page_range is silently skipped, so this gate can print "11/12 classes verified" and still pass — the one way a gate fails at its whole purpose. The pre-release cross-check genuinely needs one skip (CHARLATAN, hand-appended, no page_range), so the skip becomes an explicit opt-in flag stated at the call site. Cost if wrong: the cross-check invocation grows an argument.

22. the implementer's substitution ACCEPTED and is better than both my order and the original — the length proxy is replaced by RAISED_NOTATION.test(), which excludes all 29 non-ratings and also a four-letter name the bound could not, and the now-unreachable STRANDED_MARK clause is deleted. The guard is invisible to the gate, so the unit test is its only pin: removing the guard fails 2 tests in util/aspirant-verify.test.js while the gate stays clean. F4's move into util/ paid for itself inside the same round — before it, this guard could not have been tested at all.

23. the "549 predicate-matched lines" count is DROPPED rather than corrected. Three readings of "a line a predicate matches" give 549, 493 and 529 because the module has no single definition of that set, while the load-bearing claim — no predicate-matched line contains a fused pair — is zero under all three. A comment number that cannot be re-derived to one value does not belong in the comment, and this plan has spent five rounds on numbers attached to the wrong mechanism. Cost if wrong: the comment states a weaker claim than it could.

24. the informational finding that the RAISED_NOTATION tightening rode inside the commit labelled a pure move is NOT worth a history rewrite. The re-review proved the tightening is zero-difference over the whole book and it is declared in the report; splitting it means rewriting six commits on a branch two later tasks already build on. Cost if wrong: one commit message understates its diff, discoverable in one `git show`.


## Task 10

25. the implementer is right that `rules_version` does NOT belong in a fork payload, and my plan text contradicted itself — its FORBIDDEN paragraph called the field required for forks while its own field list and its own Step-1 test both omit it. The insert supplies it from NEW_ROW_RULES_VERSION for creates and forks alike, which is exactly what keeps it out of every update payload. Plan corrected. Cost if wrong: nil — the dry run prints `+ rules_version: "v1"` under each FORK heading, so the value still reaches the row.

26. the inert `is_player_created` and parent-side `content_format` clauses STAY, unlike Task 9's inert RAISED_MAX_LENGTH. The distinction is what they defend against: a player naming their own class Berserker is an ordinary event a user can cause at any time, so the clause guards against data the product will produce, not against a hypothetical. The comments must stop implying either clause is doing work today. Cost if wrong: two conditions that cost nothing to evaluate and would abort a run rather than corrupt one.

27. `publish`'s redundant `plan` parameter is deleted and its comment corrected. It reads plan.payload.name after the payload has already been merged into cls, so cls.name is always the same string — which is why the reviewer's mutation of that line survives. What actually fixed the parent-publication defect is WHICH rows publish is applied to: only rows carrying a plan, and a fork plan's row is null so its parent has none. Cost if wrong: nil, the projection tests cover it.

28. NO dispatched re-review for this round. It changed no production behaviour but the deletion of one redundant parameter; every factual claim in its comments was a measurement I took myself before writing the brief; and I have now mutation-tested each of the three new pins and re-run both dry runs. An independent re-review would re-derive numbers I already hold. Cost if wrong: a comment inaccuracy slips to the final whole-branch review, which reads this file anyway.


## Task 11

29. the spec drift is MINE and corrected in b1b2aef. docs/.../2026-09-16-aspirant-v1-ingestion-design.md still said the roster gains six V1 ids in two places, contradicting the all-twelve decision the user took during planning. The spec is the binding authority this plan argues from, so leaving it saying six would have made every later reader resolve the conflict the wrong way. Cost if wrong: none; the plan, the code and the tests already agreed on twelve.


## Task 12

30. the fourth source change is ACCEPTED. util/class-structured-columns.integration.test.js asserted every row is content_format 'advent' — a pre-Aspirant census the load correctly falsified, and not on the known-failures list. Replacing it with the column invariant (never null, only advent or aspirant) is the right reading: a sibling test already covers the write-side CHECK, and a fresh census of 50/12 would simply break on the next book. No stronger invariant is available, because content_format and rules_edition are deliberately independent — the six pre-release Aspirant classes are rules_edition 'aspirant' with content_format 'advent', so any rule coupling the two axes is false. Cost if wrong: the test no longer notices a wholesale format change, which the census test beside it would also have missed.

31. the missing honest red on the new core-roster content_format assertion is ACCEPTED as disclosed. The load had already landed when the assertion was written, so it passed on first run; the implementer said so plainly instead of claiming a red it never saw, and proved teeth by mutation. That is the right way to handle an assertion about state that already exists. Cost if wrong: an assertion that passes vacuously, which the mutation check rules out.

32. the re-stamp defect is NOT fixed in this branch and is surfaced to the user instead. It lives in the character-save path (services/character/service.js, models/class.js, util/class-filter.js), which is a different subsystem from ingestion; the fix has a product decision inside it (when a fork and its parent share an item name, which class owns the name?); and the submitted string ALREADY carries the class half that the resolver throws away, so the repair is a real change with its own tests, not a one-liner to bury in an ingestion branch. Cost if wrong: on the next save of an affected character, ~611 rows re-point at a class the character does not hold, which flips `onClass` in util/character-derived.js:62 and gates descriptions on an unheld class id. It is reversible by re-running a corrective re-stamp, and it does not exist in production until this branch's load is run there -- which is the reason it must be decided before deployment, not after.

33. FIX IT IN THIS BRANCH, in the loader, now. It is in scope three times over — the plan's own Task 10 and Task 12 both state the undisturbed-pre-release-load gate, this branch's load is what broke it, and leaving it means the other book's ingestion is dead until someone rediscovers why. The fix is to scope the non-forking path to rows of the book's own content_format, which is the same boundary util/class-family.js draws when it refuses an edge whose ends disagree on format: a load resolves only against content of its own shape. Cost if wrong: a pre-release record could fail to find a row it should update and would be reported as a create instead, which the dry run shows before anything is written.

34. scope on content_format, NOT rules_edition. The pre-release descriptor is contentFormat 'advent' with rulesEdition null, and its nineteen rows span both editions — the six pre-release Aspirant classes are rules_edition 'aspirant' with content_format 'advent'. Scoping by edition would break the exact rows the fix exists to keep working. Cost if wrong: six of the nineteen stop resolving.

35. forkPlan keeps receiving UNSCOPED name matches. It does its own two-way scoping — existing-fork on content_format AND rules_edition, parent on FORK_PARENT — and a parent is by definition in a different format from its fork, so narrowing its input would destroy parent resolution. Cost if wrong: every fork resolution throws "no fork parent", loudly, on a dry run.

36. the implementer's refusal to write my fifth test is UPHELD and I verified their reason. They declined to add a test that the forking book still resolves correctly, on the ground that nine existing tests already pin it. I scoped forkPlan's input by content_format myself and exactly 9 tests went red, including "a class with an advent-format parent forks" and "v1 is the parent when a class has both a v1 and a v2 row". A tenth test would have been dead weight. My gate text was also wrong on a detail they caught: `0 classes written` is printed only by the --apply path, never by a dry run.


## Task 13

37. DO NOT write the migration. (1) It matches zero rows by construction in every environment, now and at deploy, so it is dead code with a permanent footprint -- migrations are forever and run on every fresh environment, which is the worst place to keep something that can never fire. (2) The distinction the migration was meant to restore is already recorded going forward: public/js/character-wizard.js carries `type: 'advanced'` on a pick and services/character/service.js:438 honours it as `submittedAbilityType(item.type) ?? storedTypes.get(...) ?? 'core'`. (3) Slice 2's Ruling 23 worried the core/advanced distinction was "not recoverable from the database" for the 916 stored rows -- but every one of those rows belongs to a character on a class with NO advanced abilities, so there is nothing to recover. The information was never lost; it never existed. Cost if wrong: if some future state does hold mis-tagged rows, the same UPDATE can be written then against real rows, with a measurement instead of a hope. This is a scope reduction, so it goes to the user explicitly rather than only into this ledger.


## Task 14

38. the implementer's deviation from my brief is CORRECT and I verified it in the template. I asked them to assert the pre-release parent renders "six signatures in columns 1-2"; it has no .signature-column at all, because views/class-view.handlebars:244 branches on content_format and the parent is 'advent', so its six items render through the older Base/Elective split. They asserted that shape instead — 2 .column.is-half, labels exactly ['Base Gear','Elective Gear'], 3 items each, 6 total — and added .signature-column count 0 to pin the branch itself, which is a stronger guard than what I asked for. Cost if wrong: nil.

39. the review's Minor 2 (the 3/3/3/3 distribution cannot distinguish stored `column` from list order) is ACCEPTED AS A LIMITATION, not fixed. Pinning it in e2e would mean writing data whose stored column disagrees with its array order, and 0 of the 144 stored items disagree today; what actually pins the stored value is Task 8's artifact verification, which re-derived all 144 items' column and position from the PDF's raw coordinates. Recording the limitation in the spec is the honest move. Cost if wrong: the page could group by list position and this spec would not notice, which the upstream verification makes harmless.

40. the implementer's refusal of half of F3 is UPHELD and I verified the fact behind it against the database. I asked for a name the parent has and the fork does not; there is none. For ALL SIX pre-release Aspirant classes, the parent's six Signatures are exactly the fork's first six, in order — V1 EXTENDS each class's Signature list rather than replacing it. That is a real finding about the book and it corroborates the fork model: the content did not change, the format did (six columns of gear became twelve across four columns). They asserted only the true direction and documented why. Cost if wrong: nil.
