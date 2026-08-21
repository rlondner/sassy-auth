### Workflow Preferences
- Git worktree directory: .worktrees/

### Repository visibility — do not change it

**Never make this repository public.** Do not run `gh repo edit --visibility public`,
change it through the API, or ask for it to be done. Raphael will flip it manually
when he decides the time is right.

This holds even when the work you are doing is explicitly public-release
preparation, and even if a plan you or someone else wrote lists "make public" as a
step: prepare everything up to that point, then stop and hand over. Publishing is
irreversible in practice — once the repository is visible, the code can be cloned,
forked, cached and indexed regardless of whether it is later made private again.

Everything else about release preparation is fair game: licence and policy files,
docs, tags, release notes, CI, and metadata such as description and topics.
