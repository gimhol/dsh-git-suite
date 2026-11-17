# Structure and build

English | [中文](STRUCTURE.zh.md)

The README keeps installation and usage; this document records the layout, module responsibilities, and build pipeline.

## Layout

```text
src/
  host/
    index.ts
    resource.ts
    switch-handler.ts
    workspace-action.ts
    clone-handler.ts
    commit-actions.ts
    forge-post.ts
    generate-handler.ts
    pick-handler.ts
    pr-ai-review-handler.ts
    pr-create-handler.ts
    pr-delete-handler.ts
    pr-gitee-decision-handler.ts
    pr-handler.ts
    pr-review-context.ts
    sync-handler.ts
    remote-handler.ts
    remote-url.ts
    branch-action-handler.ts
    http.ts
    git.ts
    repository.ts
    scan.ts
    parsers.ts
    lfs.ts
    types.ts
    dsh.ts
    errors.ts
    routes/
      branches.ts
      refs.ts
      log.ts
      commit.ts
      status.ts
      workspace-diff.ts
      switch.ts
  client/
    index.tsx
    plugin.ts
    runtime.ts
    dsh.ts
    GitLogPanel.tsx
    SidebarPanel.tsx
    hooks/
      useGitLogView.ts
      useWorkspace.ts
    components/
      AddBranchDialog.tsx
      AddRemoteDialog.tsx
      AddTagDialog.tsx
      BranchDialogs.tsx
      BranchMenu.tsx
      Button.tsx
      CommitActions.tsx
      CommitColumnsMenu.tsx
      CommitGraph.tsx
      CommitList.tsx
      CommitRefField.tsx
      CommitRow.tsx
      DeleteRemoteBranchDialog.tsx
      DeleteRemoteDialog.tsx
      DeleteTagDialog.tsx
      DetailPane.tsx
      DialogShell.tsx
      Dropdown.tsx
      EditRemoteDialog.tsx
      EditTagDialog.tsx
      ForcePushTagDialog.tsx
      FetchTagDialog.tsx
      FileActionDialog.tsx
      ErrorState.tsx
      FetchDialog.tsx
      GitLogIcon.tsx
      IgnoreFileDialog.tsx
      LfsDiff.tsx
      PanelControls.tsx
      PushDialog.tsx
      Refs.tsx
      RefsTree.tsx
      RemoteBranchMenu.tsx
      RemoteMenu.tsx
      RepoActions.tsx
      RepositoryMenu.tsx
      SettingsDialog.tsx
      Splitter.tsx
      States.tsx
      Switch.tsx
      SyncDialog.tsx
      TagMenu.tsx
      Toast.tsx
      Tooltip.tsx
      TreeIcons.tsx
      WorkspacePane.tsx
    lib/
      api.ts
      format.ts
      graph.ts
      patch.ts
      projects.ts
      recent-projects.ts
      refs-tree.ts
      selection.ts
      ui-state.ts
    locales/
      en.ts
      zh.ts
    styles.module.scss
    styles.ts
scripts/build-client.mjs
tsconfig.json
tsconfig.host.json
cordis.patch.yml
locale/
icon.svg
docs/
  STRUCTURE.md
  STRUCTURE.zh.md
README.md
README.zh.md
LICENSE
```

## Host half

| File | Responsibility |
|---|---|
| `host/index.ts` | Registers the read-only `/git-suite` route and the POST handlers for switch, actions, clone, message generation, directory picking, tag, branch, checkout, sync, remote, branch actions, credentials, pull-request checkout, close, reopen, creation, merge, AI review, Gitee approvals, and deletion |
| `host/resource.ts` | Admits requests, dispatches read modes, and maps errors to responses |
| `host/switch-handler.ts` | Node handler for branch switching (DSH resource routes are GET/HEAD only; a POST needs a handler) |
| `host/workspace-action.ts` | Node handler for stage/unstage, stage or unstage individual hunks or selected lines (`stage-hunks` / `unstage-hunks` / `stage-lines` / `unstage-lines` via `git apply --cached [--reverse] --recount --unidiff-zero` on a patch built by `host/patch.ts`), discard one file's unstaged changes (`checkout --`), delete one untracked file, append an ignore pattern to `.gitignore`, commit (optionally amend), and the optional push; LFS pointer files stage only as a whole (`409 lfs-file` for hunk/line staging), so a pointer cannot be corrupted |
| `host/clone-handler.ts` | Node handler that validates the remote URL and destination, clones into a staging directory beside the destination, and renames it into place |
| `host/commit-actions.ts` | Validates names, creates tags and branches (at a commit hash or a ref), and checks out a local branch, a commit hash, or any ref as a detached HEAD (never forced) |
| `host/commit-ops.ts` | `POST /git-suite/commit-op`: cherry-pick or revert one commit, reset the current branch (soft/mixed/hard) to a commit, continue/skip/abort a stopped merge/rebase/cherry-pick/revert (`409 operation-conflict` reports which operation is pending), and resolve one unmerged file with `--ours`/`--theirs` |
| `host/routes/operation.ts` | `mode=operation`: the in-progress merge/rebase/cherry-pick/revert (or null) plus each unmerged path with which stages still exist |
| `host/routes/reflog.ts` | `mode=reflog`: the last 80 HEAD movements (hash, selector, action, author, date) for recovering lost commits |
| `host/routes/session-repo.ts` | `mode=session-repo&session=…`: the Git repository of one Session's working directory (read from the Host `sessions` store), or `path: null` when the host has no such Session or its directory is not inside a repository |
| `host/stash-handler.ts` | `POST /git-suite/stash`: `save` (`stash push`, optional `--include-untracked` and `-m`), `apply`, `pop`, `drop`; only `stash@{n}` refs are accepted |
| `host/generate-handler.ts` | Node handler that reads the staged/unstaged diff (LFS pointer sections replaced by an object id/size note via `annotateLfsPatch`) and calls `ctx.llm` with the default model |
| `host/pick-handler.ts` | Opens the native `ctx.directoryPicker`; `mode: 'repo'` (default) resolves the Git root and checks the DSH workspace, while `mode: 'directory'` returns a plain directory for clone destinations |
| `host/sync-handler.ts` | `POST /git-suite/sync`: fetch supports fetchAll/prune/tags/forceTags (or one remote), pull a chosen remote branch (the checked-out one runs `git pull`; any other branch is fast-forwarded to its fetched tip without touching the worktree, `409 diverged` when it cannot, `409 branch-checked-out` when another worktree holds it), push per-ref local→remote mappings with optional tracking, single tags (`tagRefs`), all tags, and force; `fetch-tag` force-replaces one local tag from the remote; an authentication failure becomes `401 auth-required` annotated with the remote, its URL scheme, and the configured credential helper |
| `host/remote-handler.ts` | `POST /git-suite/remote`: add (`action: 'add'`), rename and/or replace the URL (`action: 'set-url'`), or remove (`action: 'remove'`) one configured remote after validating the names, the URL, and whether they already exist |
| `host/branch-action-handler.ts` | `POST /git-suite/branch-action`: merge, rebase, rename, or delete a local branch; rebase the current branch onto any ref (`rebase-onto`, target resolved with `rev-parse --verify`, `409 operation-conflict` when it stops on conflicts); check out a remote-tracking branch as a new tracking branch (`track`): an unrelated local branch already owning the default name yields `409 local-branch-exists` with `local`/`remote`/`upstream` and a free `suggested` name, an existing branch that already tracks that ref is simply switched to, and an explicit `newName` creates the tracking branch under it; repoint a local branch at another remote-tracking branch or stop tracking (`upstream`, `branch --set-upstream-to` / `--unset-upstream`, `404 upstream-not-found`, `409 no-upstream`); delete a branch on a remote (`delete-remote`, `push --delete`); with validation and git error details |
| `host/dsh.ts` | Local DSH host types, including `webServer`, workspaces, `directoryPicker`, `llm`, and `agentDefaultModel` |
| `host/http.ts` | JSON responses, error serialization, same-origin and private-header checks; `readJsonBody` (declared/actual size limits) and `sendResponse` (closed-response guard) |
| `host/forge-post.ts` | Shared forge-write flow: private header, POST, body limit, timeout, repository/remote/forge/token resolution, and error response |
| `host/git.ts` | Runs read-only git commands and maps failures to error codes; LFS failures (smudge/clean filters, missing objects, quota, a remote refusing LFS uploads) map to `409 lfs-failed` |
| `host/repository.ts` | Validates paths and resolves the repository root with `rev-parse` |
| `host/remote-url.ts` | Accepts https/ssh/git/file and absolute local remotes; rejects `ext::`-style transports |
| `host/reveal-handler.ts` | `POST /git-suite/reveal`: keeps the path inside the repository, reports `file-missing`, and opens the OS file browser with the file selected |
| `host/open-handler.ts` | `POST /git-suite/open`: opens a terminal (`cmd.exe`/`open -a Terminal`/`x-terminal-emulator`), the OS file manager (`explorer.exe`/`open`/`xdg-open`), or VS Code at the repository root; on Windows it launches `Code.exe` from `host/vscode.ts` directly, because the `code` `.cmd` shim needs cmd.exe and flashes a console window; on macOS it opens the detected app bundle (`/Applications` or `~/Applications`, regular or Insiders), so a non-standard install still launches; a launch that never starts returns `400 launch-failed` with the exit or spawn code |
| `host/launch.ts` | Detached launch shared by the open actions: the child environment drops the Electron switches the plugin host itself runs under (`ELECTRON_RUN_AS_NODE` would turn an Electron-based editor into a silent Node process), GUI programs are not started hidden (a hidden first window makes a working launch look dead), and the process is watched briefly so a spawn error or a non-zero exit becomes a reported failure instead of a button that does nothing |
| `host/routes/commit-messages.ts` | `mode=commit-messages`: the 40 newest distinct commit messages (`git log -n 120 --format=%B`), used by the ArrowUp history in the commit box |
| `host/registry.ts` | Windows registry view used by editor detection: `App Paths` (`Code.exe`, `devenv.exe`, `studio64.exe`, the JetBrains `*64.exe` shims …), uninstall entries via `DisplayIcon`/`InstallLocation`, the Android Studio installer key, and `vswhere` for Visual Studio; the uninstall subtree is cached for ten minutes |
| `host/editors.ts` | One table of supported editors (VS Code, Insiders, Cursor, Windsurf, VSCodium, Zed, Sublime Text, TextMate, IntelliJ IDEA, WebStorm, PyCharm, GoLand, Visual Studio, Android Studio): per-platform detection (Windows install paths incl. JetBrains Toolbox, macOS app bundles in `/Applications` and `~/Applications`, Linux commands on `PATH`) and launch (executable, `open -a`, or the command) through `host/launch.ts`, which reports `not-installed`, the spawn error code, or the exit code so the panel can say why nothing opened |
| `host/routes/apps.ts` | `mode=apps`: lists the editors `host/editors.ts` detects (id + name, priority order) plus the `vscode` flag older clients read; the client shows one icon per detected editor and re-detects on every repository change |
| `host/credential-handler.ts` | `POST /git-suite/credential`: stores an HTTPS username/token through the repository's credential helper (`git credential approve`, secret only on stdin), after checking the remote is HTTPS and a helper is configured (`409 no-credential-helper` otherwise); with `forge: true` an SSH remote is accepted too and the token is stored as an HTTPS credential for the forge host; never returns the secret |
| `host/forge/` | Forge adapters: `detect.ts` maps a remote URL to GitHub/Gitee/GitLab (including `github.*`, `gitlab.*`, and `gitee.*` self-hosted instances) and derives the API base; `token.ts` resolves a token from environment variables, `gh auth token`, or `git credential fill` (five-minute cache); `http.ts` owns timeouts, response limits, auth headers, rate-limit/401/404 mapping, and a 60-second cache; `github.ts`/`gitee.ts`/`gitlab.ts` normalize each payload into `PullSummary`/`PullDetail`; `remote.ts` picks the default remote (current upstream → origin → first) |
| `host/routes/pulls.ts` | `mode=pulls`: one remote's pull/merge requests (`state=open|closed|all`, up to 30, `hasMore` when older ones may exist); `mode=pull&number=N`: one request with its description, files, and commits; `400 forge-unsupported` for other hosts and `401 forge-auth-required` when the forge rejects the token |
| `host/pr-handler.ts` | `POST /git-suite/pr`: with `action: 'checkout'` (the default) it checks out a pull request — it tries `refs/pull/N/head` (GitLab: `refs/merge-requests/N/head`), the remote's source branch, and the fork's source branch in order, fetching into `refs/remotes/<remote>/pr/N`, then creates or reuses the local `pr/N` branch and runs `git switch` (`409 worktree-dirty` when the tree is dirty); `POST /git-suite/pr-close`, `POST /git-suite/pr-reopen`, and `POST /git-suite/pr-merge` reuse the same handler (with `close` / `reopen` / `merge` as the default action): close/reopen change the state and keep the source branch, while merge supports merge/squash/rebase (rebase only on GitHub) and optional branch deletion; no token returns `401 forge-auth-required` |
| `host/pr-create-handler.ts` | `POST /git-suite/pr-create`: validates title/description; the `remote` body field names the target repository, while the head comes from the current branch's upstream remote and branch; both remotes must share the forge and host. Verifies head/base exist on their remotes, requires a token (`401 forge-auth-required` otherwise), sends the branch for same-repository requests and `owner:branch` (GitHub/Gitee) or resolves `source_project_id` (GitLab) for cross-repository ones; an unpushed branch returns `409 branch-not-pushed` |
| `host/pr-gitee-decision-handler.ts` | `POST /git-suite/pr-gitee-decision`: marks Gitee review/test as passed; Gitee-only |
| `host/pr-delete-handler.ts` | `POST /git-suite/pr-delete`: deletes a GitLab MR (GitHub/Gitee are close-only); GitLab-only |
| `host/pr-ai-review-handler.ts` | `POST /git-suite/pr-ai-review`: splits the model's `contextWindow` dynamically between patches and full-file context (source-first, 120k/80k fallback), serves either JSON or `stream:true` NDJSON (`start`/`reasoning`/`text`/`retry`/`done`/`error`), and never posts to the forge |
| `host/pr-review-context.ts` | Reads complete files in the chosen mode: temporary worktree (no execution, removed immediately), forge contents API, or diff only; caps file count, per-file size, and total characters |
| `host/scan.ts` | Scans workspaces for Git projects with depth and entry limits |
| `host/parsers.ts` | Parses log output, commit headers, numstat, and refs |
| `host/lfs.ts` | Git LFS pointers: parses pointer files, rebuilds the before/after pointers of a hunk, and reads objects through the smudge filter (`git cat-file --filters`), so an LFS file is reported as an object id/size change instead of three lines of pointer text; also reads `git check-attr` for tracked paths and finds pointers through `cat-file --batch-check` + `--batch` (which covers binary-attribute LFS files), and swaps pointer sections in prompts for an object note (`annotateLfsPatch`) |
| `host/routes/` | Readers for branches, the refs tree, paged log, commit detail, working-tree status/diff, plus local branch switching |
| `host/routes/status.ts` | Working-tree status: staged/unstaged files, branch/upstream/ahead/behind, and the Git author; LFS-tracked paths carry an `lfs` flag (`git check-attr`) so the list shows LFS instead of pointer line counts |
| `host/routes/workspace-diff.ts` | Per-file staged/unstaged diff; synthesizes an added-file patch for untracked files; reads both image/audio sides through the smudge filter (reporting a reason when the LFS object is missing) and reports LFS files as a pointer change (`lfs`) with no hunk/line staging |
| `host/routes/switch.ts` | Runs `git switch` for a local-branch double-click (POST, local-only, never forced) |
| `host/routes/tag.ts` | `mode=tag`: one tag's commit, short hash, subject, annotation message, and whether it is annotated |
| `host/routes/tag-status.ts` | `mode=tag-status`: compares local tags with one remote (`ls-remote --tags`, annotated tags peeled to commits) and reports same/different/local-only plus remote-only names |
| `host/routes/version.ts` | `mode=version`: reads the installed version from `package.json` and compares it with the latest `dsh-git-suite` release on npm (20s timeout, `502 registry-unreachable` when offline) |
| `host/routes/resolve.ts` | `mode=resolve`: turns any ref (`HEAD~2`, a branch, a tag, a short hash) into its commit hash, short hash, author, date, and subject |
| `host/types.ts` | Host payload types |
| `host/errors.ts` | `RouteError` with status, code, and details |

## Client half

| File | Responsibility |
|---|---|
| `client/index.tsx` | Registers the lazy factory with `window.__ModuleLoader__` |
| `client/plugin.ts` | Registers the `gitSuite` dictionaries, the `main` panel, the `sidebar.panellist` entry, and the right-sidebar `git` tab type |
| `client/runtime.ts` | Binds the React instance from DSH and exposes `h` plus hook wrappers |
| `client/dsh.ts` | Local declarations for the DSH client API used here |
| `client/GitLogPanel.tsx` | Panel shell: header, controls, notes, history/commit view switch, and body |
| `client/SidebarPanel.tsx` | Right-sidebar tab wrapper with the narrow single-column layout |
| `client/hooks/useGitLogView.ts` | Project scan, refs tree, paged log, detail selection, and actions |
| `client/hooks/useWorkspace.ts` | Working-tree status, per-file diff, stage/unstage, commit actions, and AI message generation |
| `client/hooks/usePulls.ts` | PR view state: supported remotes and the default remote, open/closed/all filtering, list and detail requests, the token prompt on 401, and the refresh after a checkout; nothing is requested while another view is visible |
| `client/components/PullsPane.tsx` | PR page: remote/filter toolbar, virtualized list, and detail (description, discussion, AI review, CI status, commits, files with a switchable diff layout), open-in-browser, checkout, merge, close, and reopen actions; a numbered entry appears when the current branch already has an open request |
| `client/components/MergePullDialog.tsx` | Merge confirmation with method, source-branch deletion, blocked/failing-checks warnings; Gitee also shows **Approve review** and **Mark test passed** |
| `client/components/DeletePullDialog.tsx` | GitLab MR deletion confirmation requiring an explicit irreversible-action check |
| `client/components/PullApprovalBadges.tsx` | Gitee review/test state badges (not assigned, pending, partial, passed) |
| `client/components/PullChecksBadge.tsx` | CI rollup pill linking to the forge's checks page |
| `client/components/PullReviewBadge.tsx` | Read-only review summary: approved / changes requested / pending |
| `client/components/Markdown.tsx` | Safe Markdown rendering for discussion and AI reviews: headings, paragraphs, lists, quotes, code blocks (Prism), tables, inline code/links/emphasis; no raw HTML, links limited to http(s) |
| `client/components/AiReviewDialog.tsx` | Asks for the AI review context mode (worktree / full files / diff only) |
| `client/components/CreatePullDialog.tsx` | Create-PR form: read-only source branch, target-branch dropdown, title/description/draft, and a head/base remote hint for cross-repository requests |
| `client/components/VirtualList.tsx` | Fixed-height windowed list component: owns the scroll container, measures with `ResizeObserver`, renders the visible slice plus overscan, uses top/bottom spacers, scrolls back on `resetKey`, and exposes `onReachEnd` / `onViewportChange`; both the PR list and the commit list use it |
| `client/components/` | Presentational components for the list, rows, graph, history toolbar (branch/remotes/sort plus a right-aligned refresh), refs tree (double-click switches branches, **+** in the branches and remotes rows adds one), draggable splitters, detail, settings dialog (page size, the configurable open shortcut with a key recorder, and version/update check), working-tree/commit pane, second-line action row (Ant Design 5 style text buttons — no border or fill at rest, a neutral hover fill, a stronger neutral while pressed; the history/commit `Switch` keeps a bordered track with text labels, the rest are icon-only with tooltips: pull/push/fetch, terminal, the platform-named file manager, and VS Code when `mode=apps` reports it), repository + menu (clone/select), add/delete remote dialogs, edit remote dialog (name + URL), add-branch dialog, `Dropdown` (optional name search, enabled for repositories), commit context menu (tag/branch/checkout/cherry-pick/revert/reset/reflog), tag context menu (checkout), stash context menu (apply/pop/drop), remote-branch context menu (checkout/merge/rebase/pull/delete), column-visibility menu, file context menu (open in file explorer), `Spinner` (one SVG loading animation, with `useMinimumSpin` keeping it on screen for three full revolutions so it never flashes), toast (`ToastHost` mounted once plus a module-level `toast(text, kind)` with info/error styles), `DiffView` (unified or side-by-side diff with a sticky old/new gutter, coloured rows, incremental "show more", gutter selection, and per-hunk/line actions; the layout is switched with an icon toggle that persists as `diffMode`), commit-ref field (editable commit id with live resolution), shared `Button`/`DialogActions` (28px/12px), errors, and states |
| `client/lib/api.ts` | Fetch wrapper with the private header and `AbortSignal` |
| `client/lib/graph.ts` | Lane layout and geometry for the commit graph |
| `client/lib/patch.ts` | Splits a commit's combined patch into one section per file for the file list |
| `client/lib/highlight.ts` | Prism highlighting for diffs and Markdown code fences: picks a grammar from the file path or fence language, covering TS/TSX, JS/JSX, JSON/JSON5, CSS/SCSS/Less, HTML/XML, Markdown, Python, Go, Rust, Java/Kotlin/Scala/Groovy, Swift, C#/F#, C/C++/Objective-C, PHP, Ruby, Perl, Lua, Dart, Elixir, Haskell, Erlang, Clojure, Julia, OCaml, Pascal, Shell/PowerShell/Batch, YAML/TOML/INI/Properties, SQL, Dockerfile, Makefile, CMake, Nix/HCL, GraphQL, Protobuf, Solidity, LaTeX, HTTP, Git, and more; tokenizes each side's whole text so multi-line constructs stay correct, skips patches over 6000 lines, and falls back to plain text for unknown languages |
| `client/lib/diff.ts` | `parseDiff`: turns unified diff text into typed lines (file/hunk/add/del/context/note) with old/new line numbers and addition/deletion counts |
| `client/lib/use-split-size.ts` | `useSplitSize`: drag start value, bounds (number or measured lazily), optional axis/invert/ratio conversion, and debounced persistence; every splitter in the panel uses it |
| `client/lib/refs-tree.ts` | Branch folder folding, remote/stash nodes, and tree search filtering |
| `client/lib/selection.ts` | Maps the selection model to request parameters and labels |
| `client/lib/projects.ts` | Pure helpers for project groups, labels, and branch labels |
| `client/lib/recent-projects.ts` | Recent-project persistence across localStorage and a cookie |
| `client/lib/ui-state.ts` | Persisted panel state in localStorage, bucketed per repository (`repos[normalizeRepoKey(repoRoot)]`: view, filters, splitters, tree expansion, draft) plus the global preferences (diff layout, open shortcut); flat values from older builds stay the fallback for every repository |
| `client/lib/format.ts` | Absolute date-time formatting (`2026-10-25 03:10:45` in Chinese, `Oct 25, 2026, 03:10:45` in English) |
| `client/locales/` | English and Chinese strings, with the English key set as the source of truth |
| `client/styles.module.scss` | CSS Module stylesheet source; esbuild hashes its class names |
| `client/styles.ts` | Mounts the hashed stylesheet text and exposes `cls()` for class names |

## Refs tree

The tree reads `mode=tree`, which returns local branches, tags, remote groups, stashes, and submodules. On the client, `buildRefSections` folds names like `feat/x` into folders and `filterTree` implements search; the history refresh button sits at the right end of the search row (the commit view uses its own working-tree refresh instead); tags, stashes, or submodules with no entries produce no section, and the submodule section sits last. Clicking a ref node produces a `Selection` (`head` / `all` / `remotes` / `branch` / `tag` / `stash`) that `selectionParams` turns into log request parameters; clicking a submodule node opens that submodule directory (`openPath`). The log payload reports `superproject` via `git rev-parse --show-superproject-working-tree`; opening a submodule shows `[submodule]name` in the project selector and a **← Parent** button back to the superproject.

- Branches and tags → `ref=<ref>`; tags may use `refs/tags/*`.
- Stashes → `scope=stash&ref=<commit hash>`; the host runs `--no-walk -n 1` to load only that commit, and its detail still uses `mode=commit`. Right-clicking a stash offers **Apply**, **Pop**, and **Drop** (confirmation) through `POST /git-suite/stash`; creating a stash is the **Stash changes…** button in the unstaged section head (message + optionally untracked files, `409 nothing-to-stash` when the tree is clean).
- Branch groups list local branches directly; remote groups list their remote branches directly; the tree no longer offers "all branches" or "all remotes" entries.
- A local branch row shows `↑N` / `↓N` after its name when it is ahead of or behind its upstream (read from `%(upstream:track)`), and `gone` when the upstream no longer exists.
- Tag rows are compared with the upstream remote (or the first remote) automatically once the tree loads and again whenever the tag set changes; the **+** on the tags row opens the new-tag dialog instead of a manual compare. Tags that exist only locally get an upload-arrow icon and tags whose commit differs get an inequality icon; there is no summary line. Comparisons stay silent when the remote is unreachable.
- The **Remotes** section row ends with a **+** button that opens the add-remote dialog and POSTs `{ action: 'add', name, url }` to `/git-suite/remote`; the section opens itself when a remote is added.
- The **Branches** section row carries the same **+** button: the new-branch dialog sends `{ name, base }` to `/git-suite/branch`, where `base` defaults to `HEAD` and may be any branch, tag, or revision.
- Right-clicking a remote-tracking branch offers **Checkout** (as a new tracking branch), merge / rebase it into the current branch, pull it into the current branch (through `/git-suite/sync`), and delete it on the remote (confirmation, `push --delete`).
- Right-clicking the **current** branch adds **Rebase onto any commit or tag…**, which opens `RebaseDialog`: a `CommitRefField` resolves any commit, tag, or branch live, and the host runs `git rebase <target>` (`rebase-onto`). The commit context menu has the same action prefilled with the clicked commit (`Rebase onto this commit…`). A stopped rebase reports `409 operation-conflict` and the conflict strip takes over (continue / skip / abort).
- Right-clicking a remote group opens fetch / pull / push, **Edit remote** (rename and URL, `POST /git-suite/remote { action: 'set-url', newName }`), and remove; hovering the group row shows its configured URL.
- Right-clicking the log header opens a checkbox menu for the graph, date, author, and commit columns (the description column always stays); the choice is persisted and a panel narrower than 760px forces the author and commit columns off.
- Row hints (remote URL, submodule path, branch switch hint, and truncated labels) plus every control tooltip use the plugin's own tooltip: one `TooltipHost` mounted per panel, a single bubble element appended to `document.body` that measures the anchor, corrects its own placement from the rendered rectangles (so a scaled, transformed, or zoomed shell cannot misplace it), keeps an 8px gap, and flips above the control using the measured height, `tooltipProps(text)` on elements, and `Button` converts its `title` prop into the same tooltip (no native `title` bubble anywhere). The bubble fades in (120ms) and out (110ms); the host keeps it mounted during the fade.
- Right-clicking a tag opens **Checkout {tag}**, **Edit {tag}**, **Push {tag}** / **Force push {tag}**, **Replace local {tag} with the remote** (only when the automatic comparison reports a mismatch), and **Delete {tag}**: checkout detaches HEAD at the tag through `POST /git-suite/checkout { ref }`; edit loads the tag through `mode=tag` and saves a rename, a new commit, and/or a rewritten message; push sends `{ action: 'push', tagRefs: [name] }`; force push and the remote→local replacement both rewrite a tag, so each goes through a warning dialog first; delete runs `POST /git-suite/tag { action: 'delete' }` after a confirmation.

While viewing HEAD, the tree highlights the checked-out branch (`head` itself has no node).

## Branch switching

Double-clicking a **local branch** in the tree POSTs to `/git-suite/switch`:

- Only `refs/heads/*` is accepted; remote branches, tags, and stashes never switch.
- The host runs `git switch <branch>` and never adds `--force`; a switch that would overwrite local changes returns 409 `worktree-dirty` and leaves the branch unchanged.
- On success the client reloads HEAD and the refs tree, resets the selection to `head`, and moves the current-branch highlight.
- The route accepts POST only (GET returns 405) and still requires the same-origin check and the private request header.

## Working tree and commits

The history list keeps its header (filters, column labels, resizers) outside the scrolling element, so the scrollbar only spans the rows. The second row's **History / Commit** switch changes between history and the commit/file-status view in the same page (`WorkspacePane` + `useWorkspace`), sharing the repository/path controls, refs tree, and branch switching:

- `GET /git-suite?mode=status` reads `git status --porcelain=v2 -z --branch -uall`, plus staged/unstaged numstat and untracked line counts, returning staged/unstaged files, the branch, upstream, ahead/behind, and the Git author.
- `GET /git-suite?mode=workspace-diff&file=…&scope=staged|unstaged|untracked` returns one file's diff; untracked files get a synthesized `/dev/null → file` patch, capped at 400k characters per file. Both the working-tree diff and the commit diff render through `DiffView`, which colours additions/deletions, keeps the old/new line numbers sticky while scrolling sideways, and renders 800 lines at a time with a **Show N more lines** button. Each diff header has an icon toggle between the unified (three bars) and side-by-side (two columns) layouts (persisted as `diffMode`); split mode pairs deletions with additions in two wrapped columns. Dragging a gutter (unified) or a row (split) selects lines in both layouts; a split row maps to exactly the old and new line it pairs, so staging a pair never drags in a neighbouring unpaired line, and header rows are not selectable. Pressing a line number and dragging selects a row range (the gutter is one sticky track, rows get an accent tint, and the selection auto-scrolls near the edges); **Ctrl/Cmd+C** copies the selected lines, and right-clicking the selection offers **Stage selected lines** / **Unstage selected lines** (`POST /git-suite/action { action: 'stage-lines' | 'unstage-lines', paths: [file], lines: [patch line indexes] }`, which rebuilds a zero-context patch with recalculated headers). In the working tree each hunk header carries a **Stage this hunk** / **Unstage this hunk** button (`POST /git-suite/action { action: 'stage-hunks' | 'unstage-hunks', paths: [file], hunks: [index] }`).
- `POST /git-suite/action` (a Node handler, because DSH resource routes are GET/HEAD only) accepts JSON:
  - `stage` / `unstage` with `paths` or `all`, running `git add -A` / `git reset -q HEAD`.
  - `commit` with `message`, `amend`, and `push`, running `git commit -m` (optionally `--amend`) and optionally `git push` to the configured upstream.
- Staging is file-level (hunk-level staging is not available yet); each file row ends with a **+** (stage this file) or **−** (unstage it) button, and double-clicking a row flips it between staged and unstaged (its text is `user-select: none` so the double-click never selects the label). A successful commit refreshes the status and reloads HEAD/the refs tree. The toolbar's pull/push can pick a remote and branch, and force push is used only when explicitly checked; the push after committing still targets the configured upstream only.
- Status letters are coloured: **M** yellow, **U** (untracked, previously `?`) green, **D** red, **R**/**C** blue, **A** green. Unmerged paths carry an explicit `unmerged` flag from `mode=status`: the status letter stays (unmerged shows `U`) and a red warning icon appears beside it.
- The commit message box keeps a per-repository draft in the repository's `ui-state` bucket (localStorage, debounced, cleared only after a successful commit). Its header row shows the message label on the left and the configured Git author (`Name <email>`) on the right. **ArrowUp at position 0** starts walking that repository's recent messages (`mode=commit-messages`), newest first; once a message has been inserted, **ArrowDown at the end of the unedited text** keeps walking, and after the oldest entry the text typed before the walk comes back. Any edit counts as a new message and resets the walk.
- Hovering a file row shows the plugin tooltip `<absolute path> - <status word>` (renames append `(from <old path>)`); the row's own hint replaces the per-path tooltip.
- **Generate with AI** beside the commit message POSTs to `/git-suite/generate-message`, which reads the staged (otherwise unstaged) diff and calls `ctx.llm.stream()` with the provider/model from `ctx.agentDefaultModel.currentSelection()`; the file list and diff are sent to the configured model provider, and the generated text only fills the input. Missing default model, no changes, and model failures return explicit errors.
- The **+** menu beside the repository/path controls (click or hover) offers **Clone remote repository** and **Select local repository**: cloning POSTs to `/git-suite/clone`, which validates the URL (https / ssh / git / file / absolute local paths, rejecting `ext::` and similar) and the destination (absolute, existing parent, not already present), runs `git clone`; the clone dialog's destination can use `POST /git-suite/pick-directory` with `mode: 'directory'` to pick a parent folder and append the repository name. The select-local dialog offers **Choose folder** (`mode: 'repo'` native picker), scanned repositories, and a manual path; **Open** only opens the repository in this panel. Use DSH's own Workspaces add flow to register a DSH workspace. A non-native picker asks for a typed path.
- Right-clicking a changed file opens **Open in file explorer** plus one destructive entry: **Discard changes** for an unstaged modification (`git checkout --`, warning dialog) and **Delete file** for an untracked file (warning dialog; the host refuses tracked paths with `409 tracked-file`). Untracked files also offer **Ignore**, which appends one pattern to `.gitignore`: the exact path, the bare file name (matches at any depth), or `*.ext` for the extension. Staged files only offer the reveal action.
- Right-clicking a changed file opens a menu with **Open in file explorer** (`POST /git-suite/reveal`): the host refuses paths outside the repository, answers `404 file-missing` when the file is gone, and otherwise opens the OS browser with the file selected (`explorer /select,`, `open -R`, `xdg-open`). A missing file shows a toast instead of an inline error.
- Every write remains POST + same-origin + private request header; errors return as JSON and render in the workspace.
- The commit view is resizable: the file column and the diff pane split vertically, and the column itself is three resizable regions — the staged list, the unstaged list, and the commit message form — separated by two horizontal splitters. Sizes live in `useSplitSize` and persist through `commitFilesWidth` / `commitStagedHeight` / `commitFormHeight`; the message field itself is not resizable, it fills the form (which scrolls when the form is shorter than its content). In the stacked narrow/sidebar layout the file column and the diff are separated by a draggable splitter (persisted as `commitFilesHeight`), and the form is the last row of the body — below the lists and the diff — separated by another draggable splitter (drag up to grow the form, double-click to reset, persisted as `commitNarrowHeight`); until it is dragged the form keeps its content height.

## Commit context actions

Right-clicking a commit row opens the **Tag / Branch / Checkout** menu (`CommitActions`):

- **Tag** → `POST /git-suite/tag` (title **New tag**): validates with `git check-ref-format refs/tags/<name>`; a non-empty message uses `git tag -a -m`, otherwise a lightweight tag; `-f` is added only when `force: true` (the **Force an existing tag** checkbox) is set. Its commit field is prefilled with the right-clicked commit, editable, and resolves live like the branch dialog.
- **Branch** → `POST /git-suite/branch`: validates with `git check-ref-format --branch`, then runs `git branch <name> <start>`. The dialog's start-point field is prefilled with the right-clicked commit and stays editable; typing another ref resolves it live through `mode=resolve` and shows that commit's short hash and subject under the field. An empty field falls back to the clicked commit.
- **Checkout** → `POST /git-suite/checkout`: `branch` runs `git switch <branch>`, `hash` runs `git switch --detach <hash>`; never forced; a working tree that would be overwritten returns 409 `worktree-dirty`. The client asks for confirmation first, warns explicitly for a detached HEAD, and mentions the working-tree risk for a branch.
- **Cherry-pick** runs `git cherry-pick <hash>` and **Revert** runs `git revert --no-edit <hash>` through `POST /git-suite/commit-op`; a conflict returns `409 operation-conflict`, and the dialog offers **Abort and restore**, which runs `git cherry-pick --abort` (or the matching `--abort`).
- **Reset** opens a dialog with soft/mixed/hard; hard shows a warning and uses the danger button.
- **Reflog** loads `mode=reflog` and lets you create a branch at an old commit (default name `reflog-<short>`) or hard-reset to it after ticking the confirmation box.
- Tag/branch/checkout refresh the log and refs tree; checkout resets the selection to HEAD.
- Right-clicking a branch or tag **chip** inside a commit row opens the same menu the refs tree uses (local branch menu, remote-tracking branch menu, or tag menu with its checkout/edit/push/replace/delete entries); unrelated refs fall back to the commit menu.
- All of these routes are POST + same-origin + the private request header.

## Conflicts

While a merge, rebase, cherry-pick, or revert is stopped, `mode=operation` reports it with the unmerged files. The conflicted files themselves are listed in the **Unstaged** section (unmerged paths are excluded from the staged list, since `U` is a conflict marker, not a staged change) keeping git's status letter and adding a red warning icon beside it; their row button marks them resolved (`git add`) and their context menu adds **Take ours** / **Take theirs** (`git checkout --ours|--theirs` + `git add`, disabled when that side no longer exists).

A compact strip above the list carries the operation name, the remaining conflict count, and:

- **Continue** runs the matching `--continue` (a merge continues with `git commit --no-edit`; rebase uses `-c core.editor=true` so the editor never opens).
- **Skip** runs `--skip` for rebase/cherry-pick/revert; a merge has no skip (`400 skip-unsupported`).
- **Abort** restores the state before the operation.

The strip refreshes when the repository changes, when a sync finishes, and after every conflict action.

## Pull requests

The second-row view switch gains **PR** only when `mode=tree` reports at least one supported remote (`remotes[].forge` is non-null); local repositories, SSH remotes to unsupported hosts, and `file://`-only repositories never see the entry. The host derives `forge` while reading the refs tree, so no extra probe request is needed.

- **Remote**: the current branch's upstream remote first, then `origin`, then the first supported remote; a remote dropdown appears when several are available.
- **Loading**: `mode=pulls` runs only while the PR view is visible; the first request fetches 30 rows, and scrolling to the bottom (or a viewport that is not full) fetches the next `page` and appends it (the client caps the list at 300). The list is windowed at a fixed row height, rendering only the visible slice. The refresh button resets to page 1 with `fresh=1` to bypass the host cache; the open/closed/all filter and remote changes also reset paging.
- **List**: number, title, author, source → target branch, updated time, and a state badge (open/draft/merged/closed); the toolbar search box filters the loaded rows by number, title, author, or branch; rows have a fixed height and the list is virtualized.
- **Resizing**: a draggable splitter sits between the list and the detail; it changes the list width in the wide layout and its height in the stacked layout, double-click resets it, and the size is remembered per repository.
- **Detail**: `mode=pull&number=…` returns the description, discussion, changed files with patches, commits, CI status, and mergeability. The description, discussion, and AI review are rendered as safe Markdown; each module (description, AI review, files, commits, discussion) has a collapsible header row, with discussion pinned last. File diffs reuse `DiffView` with the file path passed in for syntax highlighting; the unified/split layout follows the global `diffMode` preference. The detail meta shows the repository (cross-repository requests show `head → base`), and the toolbar shows the current list repository as a pill so multiple remotes/forks stay unambiguous. **Open in browser** is a plain link restricted to http(s); **Check out** posts to `/git-suite/pr` and first runs `git status --porcelain`, returning `409 worktree-dirty` with the files/count when the tree is dirty (no fetch or branch switch happens). an open request shows **Merge** (`POST /git-suite/pr-merge`, with merge/squash/rebase and optional source-branch deletion) and **Close** (`POST /git-suite/pr-close`), while a closed one shows **Reopen** (`POST /git-suite/pr-reopen`); all ask for confirmation. The toolbar's **New PR** opens a form whose source is the checked-out branch (it must exist on the remote), target is chosen from the remote branches, and title/description/draft are submitted to `POST /git-suite/pr-create`. Clicking the detail's **AI review** first opens a dialog to choose the context mode (temporary worktree, forge API, or diff only; stored in localStorage), then calls `POST /git-suite/pr-ai-review`; the host reads complete files as requested (the worktree is removed immediately and nothing executed), then asks the default `ctx.llm` model for a read-only Markdown review, which is never posted to the forge. The client shows loading/errors/results and can review again or stop/clear; the NDJSON stream pushes live `reasoning`/`text` progress and emits `retry` before a second attempt. While the view is active, the first page and the selected detail refresh quietly every 60 seconds.
- **Authentication**: a 401 opens `ForgeAuthDialog`; the token is required and the account name is optional (a Gitee personal repository pre-fills the owner; leaving it empty makes the host resolve the real login through `/user`). The token goes through `POST /git-suite/credential { forge: true }` into the repository's credential helper (an SSH remote stores it as an HTTPS credential for the forge host) and the request retries. `GITHUB_TOKEN`/`GITEE_TOKEN`/`GITLAB_TOKEN`, or `gh`'s stored login, work too; the token stays in the host process.
- **Checkout**: after success the working tree and refs tree reload; the local branch is always `pr/<number>` and an existing branch is switched to without moving it.

## Right-sidebar tab

The right sidebar's Start page belongs to `ui-sidebar-right`. The plugin joins it through the same two-stage registration any tab type uses:

1. `ctx.sidebarRightTabs.register(...)` registers the page type (`id` is the package name, `kind: 'git'`) and its Start-page entry; the entry's `order: 40` places it after files (10), terminal (20), and browser (30).
2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id, locale: 'gitSuite' }, SidebarGitLogPanel)` registers the tab body; `key` must equal the type's `id`.

The registration runs inside `ctx.inject(['sidebarRightTabs'], …)`, so the right sidebar is an optional dependency: without it, the main panel and the left-sidebar entry still work. The wrapper class `.dsh-gitlog-sidebar` switches the panel to the narrow layout (smaller padding, single-column list and detail); the project/path controls only wrap when the row truly runs out of room. The tab opens (or focuses) from anywhere through the DSH shortcut catalog: the client registers the command `gitSuite.open` (default **Ctrl/Cmd+Shift+G**, rebound in DSH's own keyboard settings) and the guide entry names it as `commandId`, so the Start page card shows the effective keycap next to the title. The command runs `sidebarRight.openTab('git')`. The tab is Session-scoped, so DSH passes `sessionId` to the body; the panel asks `mode=session-repo` for that Session's working directory and opens **the repository the current workspace belongs to**, falling back to the most recent or first scanned project when the lookup yields nothing.

## Build pipeline

`pnpm build` runs, in order:

1. `tsc -p tsconfig.json` typechecks everything (`noEmit`).
2. `tsc -p tsconfig.host.json` compiles `src/host/` into `dist/`, with `dist/index.js` as the entry.
3. `node scripts/build-client.mjs` compiles `src/client/styles.module.scss` to `styles.module.css` with `sass.compile()`, runs one esbuild pass so `.module.css` is treated as a CSS Module (every class name hashed), writes that hashed stylesheet to `src/client/styles.generated.css`, then bundles `src/client/index.tsx` into `dist/client.js` (plus a source map) with esbuild; `--loader:.css=text` inlines the hashed CSS into the artifact. A class-name check fails the build for a `cls()` name the stylesheet does not define or a raw `dsh-gitlog-*` string outside `cls()`.

### Why the client is still bundled

DSH loads exactly one lazy factory per package through `exports["./client"]` (`window.__ModuleLoader__.load({ id, factory })`), and the browser does not resolve the plugin's internal relative imports as ESM. The split `src/client/` sources therefore have to be bundled into a single `dist/client.js`. React comes from the factory's `require('react')` (DSH's module table) and is not bundled.

### Artifacts and development

- `dist/`, `src/client/styles.module.css`, and `src/client/styles.generated.css` are build artifacts and are ignored by Git. After cloning, run `pnpm install && pnpm build` first; DSH Plugin Manager does not build a local directory for you.
- `pnpm watch:client` watches `src/client/`; any change reruns the stylesheet, hash, and bundle steps, and DSH HMR watches `dist/client.js` to reload the plugin on the page.
- Changing entry paths in `package.json` requires restarting DSH (or disabling and re-enabling the plugin row), because the running Host caches the plugin manifest.



































