# Project library: voluntary reader sessions

This is the remaining human validation for [issue #60](https://github.com/m9sh/galley/issues/60). The implemented interaction and state ownership are in [Project library](project-library.md). This protocol is ready to run; no sessions or improved outcomes are claimed here.

## Questions to answer

Can readers distinguish Chapters, Project library, Contents and Project map? Can they find a supporting decision, read it at the intended revision and return to the same paragraph and draft? Does the chosen layout suit prose, diagrams and discussion? Does the optional standalone sequence help without making ordinary reading harder?

## Participants and materials

Invite 5–8 willing readers who use GitHub or GitLab. Include both providers, people who review code and people who read project documents, and at least two phone sessions. Use a small review, a large review with code, tables and a diagram, and a standalone spec with explicit links to decisions or guides. Use public or participant-owned examples; do not collect tokens or confidential document text.

Compare the existing platform workflow with the joined Galley workflow on comparable tasks. Alternate which workflow goes first. Record observations manually, with permission; there is no product telemetry. Readers may stop whenever they want. Do not lead them to a control or explain a label until after the task attempt.

## Tasks

1. Start a chapter in the small review. Explain what belongs to it and how to reach all changed files.
2. In the large review, write an unsent comment on a paragraph. Find its supporting decision and explain why it is related and whether it is base or head.
3. Choose a layout for a diagram or table. Return to the review, find the same paragraph and draft, then continue the chapter. Explain whether any file was marked Viewed.
4. Attach a document heading for this session. Find it again and explain the difference between Added by you and source evidence.
5. Open a standalone spec. Read it without creating a chapter, then choose a sequence through the spec, a decision and a guide. Change the order, navigate a heading and return with Back.
6. Try an unavailable document or heading and a partial listing. Explain what can still be read and how to return. Check a newer commit and explain what happened to the standalone sequence.
7. Repeat navigation by keyboard or touch. Open and close the innermost layer with Escape where available, and check that focus and reading place make sense.

After each workflow, ask: What was confusing? Where did you lose your place? Which words would you change? How comfortable was reading, from 1 (uncomfortable) to 5 (comfortable), and why? Treat ratings and timings as session observations, not population-level claims.

## Recording sheet

| Field | Record |
| --- | --- |
| Session | Anonymous ID, date, provider, device/width, workflow order |
| Task | Example, starting paragraph, revision, intended destination |
| Outcome | Completed independently, needed help, or abandoned |
| Navigation mistakes | Wrong destination, label misunderstood, repeated Back, outline unavailable |
| State | Place, focus, draft, folds, layout and Viewed retained or lost |
| Comfort | Rating, chosen layout/text size/density, reader's explanation |
| Errors | Whether partial/missing content and recovery were understood |
| Observation | Exact wording with consent; no confidential repository text |
| Follow-up | Concrete change, severity, evidence and retest task |

## Reporting and completion

Keep results separate from this protocol. Report the number of completed sessions, recurring observations and contradictory feedback. Link resulting fixes and their retests to #60. A lost draft or place, inaccessible control, misleading relationship/revision, or unreadable phone layout requires a fix and a focused retest. Finish naming validation only after readers can explain the destinations in their own words without prompting. Keep #60 open until the sessions and any required follow-up work are complete.
