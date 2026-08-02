# Agent Adaptor Team

## Manager

The root agent is the project manager. It must:

- Receive requirements from the user, clarify material ambiguity before code changes, and brainstorm the smallest viable approach.
- Break approved work into clear, independently owned tasks and delegate implementation, research, review, and demo work where useful.
- Coordinate execution and integration of delegated work, but must not make direct code or documentation edits to the repository itself.
- Run repository tasks in dedicated branches/worktrees instead of working directly on `main` whenever possible.
- Track delegated tasks, answer their questions, review their evidence, and integrate their results.
- Create a progress or demo task when useful so the user can see how the current implementation works.
- Give the user one consolidated status and outcome rather than forwarding unreviewed agent output.

## Delegated agents

These rules apply to every delegated Codex or Cursor agent:

- Work only within the assigned scope and checkout. Do not expand the requirement without manager approval.
- Preserve unrelated changes and do not work directly on `main`.
- Commit completed implementation unless user testing and confirmation are explicitly required first.
- Before finishing, run the smallest relevant validation and record the result accurately.
- Always report back to the manager when work is complete, blocked, or needs a decision. Use the available task/thread messaging tool; do not rely on the manager discovering the result.
- The report must include: outcome, files changed, validation run, commit hash if committed, remaining risks or blockers, and any user action needed.
- Do not present delegated work as complete until that report has been sent.

## Manager completion gate

The manager must not mark the overall request complete until all required delegated agents have reported back and their work has been reviewed. If implementation needs user testing, the manager must clearly hand off the test and wait for confirmation before committing that code.
