# Flow Gantt clean-room specification - provenance record

This file records the kinds of sources consulted while writing `spec.md` (phase A of the clean-room process) and what was taken from them. Phase B (implementation) worked only from `spec.md` and public standards; its decisions are recorded in `decisions.md`.

- Spec author: phase A Claude Code session, for the repository owner.
- Date of all phase A work: 2026-11-16 (spec v1.0 and v1.1).
- The full source record (repository paths, revisions and environment details) is kept privately by the owner.

## 1. Statement

No source code, CSS, templates, documentation text, comments, data structures or algorithms of dhtmlxGantt or of any modified copy of it were read, copied, paraphrased or used while writing `spec.md`. The library's files were never opened. Its behaviour was observed only from the outside, through the host application's screen that embeds it. The class names it puts on rendered elements were seen while measuring the screen (section 4), and one browser console error included a stack trace through the bundled library; neither was copied into `spec.md` or used to design anything. The public API of Flow Gantt (section 13 of the spec) was designed from the host application's needs, not from the replaced library's API.

## 2. License review

- Source: the license terms of the replaced commercial library (its vendor's Enterprise License Terms), read in full on 2026-11-16.
- Findings:
  - The license allows use in up to 5 projects and allows modifications, but forbids distributing modified software or parts of it as a standalone application, forbids distributing the components in a way that allows reuse or redistribution, and forbids transfer, lease, assignment or sublicensing.
  - It grants the vendor a royalty-free right to use, modify and distribute the licensee's modifications.
  - It states that copying, adapting or compiling the documentation without authorisation is prohibited.
  - It contains **no clause that restricts reverse engineering, decompiling or analysis**.
- Consequence for this work: analysis was not prohibited by the license, but to keep the new library clearly independent the spec authors still limited themselves to (a) how the host application uses the library and (b) black-box behaviour of the running host screen. Nothing from the documentation was used.
- Taken into the spec: nothing (the license only shaped the method).

## 3. Sources consulted

| # | Source | What was looked at | What was taken | Allowed for phase B |
| --- | --- | --- | --- | --- |
| S1 | The host application's own integration code and data contract (private, not part of this repository) | Integration code, styling, tests, data loading and saving, editing rules | Requirements: which features are used, configuration values (row height, minute units, span 3, gap 0.5, zoom levels, 100 px columns), styling rules, events the host reacts to, data transforms, test cases | Yes (it is host code; never to learn the replaced library's internals) |
| S2 | Commit history metadata of the host's private copy of the replaced library | Commit titles and dates only | That the copy has no host-specific API additions | Not needed |
| S3 | Black-box observation of the host application's screen | Screenshots, element bounding boxes, computed colours and sizes, ARIA roles, console errors, DOM node counts, scroll timings, responses to clicks, right-clicks, drags, keys and wheel events | Behaviour and measurements, acceptance test expectations (section 16), defects that the spec now prevents | Only through `spec.md` |
| S4 | WAI-ARIA Authoring Practices (treegrid pattern) and WCAG 2.2 (target size, contrast), from general knowledge | Keyboard and ARIA expectations | Section 11 | Yes |
| S5 | Codex review (Codex CLI, read-only sandbox, 2026-11-16) given `spec.md` v1.0 and proposed answers to the open questions | Accept or replace each proposed answer; list contradictions and security risks | Final answers to Q1-Q10 (section 17), 14 spec fixes folded into v1.1 (duplicates, cycles on the combined graph, base unit, input bounds, diagnostics callbacks, hit areas, panning rule, keyboard linking, trusted-renderer boundary, SEC-3, SEC-4). Codex saw only the spec, never the replaced library | Yes (its output is reflected in `spec.md`) |

## 4. Observation method and limits

- Black-box observation was done with a browser: screenshots, pointer and keyboard actions, and read-only inspection scripts that measured geometry (`getBoundingClientRect`), computed styles, ARIA attributes, element counts and timings.
- Inspection scripts had to select rendered elements by the class names and attributes the replaced library outputs. Those names were used only inside the measurement scripts and were not written into `spec.md`; no markup or CSS was copied.
- Test data was synthetic and created only in a local development environment: a small example flow and a 600-row performance flow.
- Edit-mode experiments (selection, context menus, removing an item) were discarded; nothing was saved from the chart.
- Some interactions could not be confirmed in the automated browser: Ctrl+wheel zoom and grid row drag reordering produced no change, and creating an allowed dependency by dragging was not confirmed (the rule comes from the host's code, S1). Frame-rate numbers were replaced by synchronous per-step timings.

## 5. Not consulted

- The replaced library's source files, bundled code, type declarations, CSS, sample data, documentation website, API reference, forum, support material and change log.
- Any third-party clone, port or derivative of the replaced library.
- The replaced library's npm package contents (no file of the installed package was opened).
