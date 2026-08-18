# Development history

SassyAuth was built almost entirely by AI coding agents working against a
human-reviewed plan, with a bug-numbering discipline that ran from `bug-0001`
to the 0250s. This directory is the archive of that process, kept because the
record is more interesting than the tidy version of it.

None of it is required to run, understand, or contribute to the project — start
from the [README](../../README.md) for that. Nothing here is maintained; treat
every document as a snapshot of what was true on the date in its name.

## What's in here

| Path | What it is |
| --- | --- |
| [`plans-and-specs/`](plans-and-specs/) | The design docs and implementation plans behind each feature, written before the code. `specs/` is the design discussion, `plans/` the step-by-step implementation plan handed to an agent. |
| [`bugs/`](bugs/) | The bug catalog. `BUGS_<date>.md` files are the daily review sweeps; `bug-<n>.md` files are individual writeups. Numbering is continuous and referenced from commit messages (`fix(bug-0234): …`). |
| [`code-reviews/`](code-reviews/) | Daily code review reports produced during the build. |
| [`todo/`](todo/) | Daily follow-up lists — the working queue between review sweeps. |
| [`brainstorms/`](brainstorms/) | HTML brainstorming artifacts from early design sessions (data model, auth flows, admin UI layout). |
| [`PRD.md`](PRD.md) | The original product requirements document the project started from. |
| [`OVERNIGHT_REPORT_2026-07-08.md`](OVERNIGHT_REPORT_2026-07-08.md) | Report from an unattended overnight agent run. |
| [`BUGS_QUEUE.md`](BUGS_QUEUE.md) | A one-off triage of 35 open bug PRs on 2026-06-18. |
| [`BUGs.md`](BUGs.md) | The original flat bug list, superseded by `bugs/`. |
| [`jules-palette.md`](jules-palette.md) | Design-palette notes used by the Jules agent. |

## Reading it as a record

A few things this archive shows that the commit log alone does not:

- **Bugs were catalogued before they were fixed.** Most `bug-NNNN` entries have a
  written reproduction and impact assessment predating the fix commit.
- **The known-limitations list in the main README is drawn from here.** Gaps that
  were found but consciously deferred stayed visible rather than being quietly
  dropped.
- **Not everything worked.** `BUGS_QUEUE.md` documents a mass-merge that left 35
  PRs with empty diffs and had to be untangled by hand.

For the current state of the project — including what is still broken — see
[Known Limitations](../../README.md#known-limitations) and
[SECURITY.md](../../SECURITY.md).
