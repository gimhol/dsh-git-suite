# 结构与构建

[English](STRUCTURE.md) | 中文

README 只保留安装与使用说明；本文记录目录布局、模块职责和构建管线。

## 目录

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

## 宿主端

| 文件 | 职责 |
|---|---|
| `host/index.ts` | 注册 `/git-suite` 只读资源路由，以及 switch / action / clone / generate-message / pick-directory / tag / branch / checkout / sync / remote / branch-action / credential / pr / pr-close / pr-reopen / pr-create / pr-merge / pr-ai-review / pr-gitee-decision / pr-delete POST handler |
| `host/resource.ts` | 校验请求、按 `mode` 分发只读请求并统一错误响应 |
| `host/switch-handler.ts` | 分支切换的 Node handler（DSH resource 路由只接受 GET/HEAD；POST 必须走 handler） |
| `host/workspace-action.ts` | POST `/git-suite/action`：暂存/取消暂存、按 hunk 或按选中行暂存/取消暂存（`stage-hunks` / `unstage-hunks` / `stage-lines` / `unstage-lines`，由 `host/patch.ts` 组装补丁后 `git apply --cached [--reverse] --recount --unidiff-zero`）、重置单个文件的未暂存改动（`checkout --`）、删除单个未跟踪文件、提交（可 amend）、可选 push 的 Node handler |
| `host/clone-handler.ts` | POST `/git-suite/clone`：校验远端 URL 与目标目录后，先克隆到目标同级的临时目录，成功后改名到目标目录 |
| `host/commit-actions.ts` | POST `/git-suite/tag`、`/branch`、`/checkout`：校验标签/分支名，创建标签/分支（可指定提交或任意引用作为起点），检出本地分支、指定提交或任意引用（分离 HEAD，不 force） |
| `host/commit-ops.ts` | `POST /git-suite/commit-op`：拣选或反向提交单个提交、把当前分支重置到某提交（soft/mixed/hard）、对停住的 merge/rebase/cherry-pick/revert 执行 继续/跳过/中止（`409 operation-conflict` 会说明是哪种操作）、用 `--ours`/`--theirs` 解决单个冲突文件 |
| `host/routes/operation.ts` | `mode=operation`：当前进行中的 merge/rebase/cherry-pick/revert（或 null），以及每个未合并路径仍存在哪些阶段 |
| `host/routes/reflog.ts` | `mode=reflog`：最近 80 次 HEAD 变动（哈希、selector、动作、作者、时间），用于找回丢失的提交 |
| `host/routes/session-repo.ts` | `mode=session-repo&session=…`：某个 Session 工作目录所属的 Git 仓库（从 Host `sessions` 存储读取其 `header.cwd`）；Session 不存在或其目录不在仓库内时返回 `path: null` |
| `host/stash-handler.ts` | `POST /git-suite/stash`：`save`（`stash push`，可选 `--include-untracked` 与 `-m`）、`apply`、`pop`、`drop`；只接受 `stash@{n}` 形式的引用 |
| `host/generate-handler.ts` | POST `/git-suite/generate-message`：读取 staged/unstaged diff，调用 `ctx.llm`（默认模型）生成提交信息 |
| `host/pick-handler.ts` | POST `/git-suite/pick-directory`：调用 `ctx.directoryPicker` 的原生选择器；`mode: 'repo'`（默认）解析 Git 根并检查 DSH 工作区，`mode: 'directory'` 返回普通目录供克隆目标使用 |
| `host/sync-handler.ts` | `POST /git-suite/sync`：`fetch` 支持 `fetchAll`/`prune`/`tags`/`forceTags`（对应 `--all`/`--prune`/`--tags`/`--force`），也可只获取指定 `remote`；`pull` 按所选 `remote`/`branch` 拉取：当前分支走 `git pull`，非当前分支只把该分支快进到抓取到的提交（不动工作区），无法快进返回 `409 diverged`，该分支被其它 worktree 占用返回 `409 branch-checked-out`；`push` 按 `refs`（本地分支→远程分支，可逐项 `track`）推送，支持单个标签（`tagRefs`）、全部标签（`tags`）与 `force`；`fetch-tag` 用远端覆盖单个本地标签；认证失败返回 `401 auth-required`，附带远端名、URL 协议与已配置的凭据助手 |
| `host/remote-handler.ts` | `POST /git-suite/remote`：新增（`action: 'add'`）、改名和/或修改地址（`action: 'set-url'`）或删除（`action: 'remove'`）指定远端，会校验名称、地址格式以及是否已存在 |
| `host/branch-action-handler.ts` | `POST /git-suite/branch-action`：本地分支的 `merge`/`rebase`/`rename`/`delete`；把当前分支变基到任意引用（`rebase-onto`，目标用 `rev-parse --verify` 解析，遇到冲突返回 `409 operation-conflict`）；以远端分支为起点检出为本地跟踪分支（`track`）：默认名已被无关本地分支占用时返回 `409 local-branch-exists`，带 `local`/`remote`/`upstream` 与一个可用的 `suggested` 名称；已有本地分支正好跟踪该远端引用时直接切换过去；显式传 `newName` 则按该名建跟踪分支；把本地分支改为跟踪另一条远端分支，或取消跟踪（`upstream`，即 `branch --set-upstream-to` / `--unset-upstream`，找不到远端分支返回 `404 upstream-not-found`，本来就没有上游返回 `409 no-upstream`）；删除远端上的分支（`delete-remote`，即 `push --delete`）；校验分支名/远端名，失败返回 git 错误详情 |
| `host/dsh.ts` | 本插件使用的 DSH host 类型，包括 `webServer`、工作区、`directoryPicker`、`llm` 与 `agentDefaultModel` |
| `host/http.ts` | JSON 响应、错误序列化、同源与私有头校验；`readJsonBody`（Content-Length/实际字节上限）与 `sendResponse`（已关闭响应保护） |
| `host/forge-post.ts` | 写操作路由公共流程：私有头、POST、body 上限、超时、repository/remote/forge/token 解析与错误回写 |
| `host/git.ts` | 执行只读 git 命令并把失败映射为错误码 |
| `host/repository.ts` | 校验路径并用 `rev-parse` 解析仓库根目录 |
| `host/remote-url.ts` | 接受 https/ssh/git/file 与绝对本地路径，拒绝 `ext::` 之类的命令型传输 |
| `host/reveal-handler.ts` | `POST /git-suite/reveal`：校验路径在仓库内、文件存在，然后在系统文件浏览器中选中该文件 |
| `host/open-handler.ts` | `POST /git-suite/open`：在仓库根目录打开命令行（`cmd.exe`/`open -a Terminal`/`x-terminal-emulator`）、系统文件管理器（`explorer.exe`/`open`/`xdg-open`）或 VS Code；Windows 上由 `host/vscode.ts` 直接启动 `Code.exe`，因为 `code` 的 `.cmd` shim 必须经过 cmd.exe，会闪一个控制台窗口；macOS 上打开检测到的 .app（`/Applications` 或 `~/Applications`，含 Insiders），非标准安装也能启动；启动不起来时返回 `400 launch-failed` 并带上退出码或 spawn 错误码 |
| `host/launch.ts` | 打开类动作共用的分离启动：子进程环境会去掉插件宿主自身的 Electron 开关（继承 `ELECTRON_RUN_AS_NODE` 会让基于 Electron 的编辑器变成一个不出窗口的 Node 进程），GUI 程序不以隐藏窗口启动（首个窗口被隐藏会让成功的启动看起来毫无反应），并在短时间内观察子进程，把 spawn 失败或非零退出变成可上报的失败，而不是一个点了没反应的按钮 |
| `host/routes/commit-messages.ts` | `mode=commit-messages`：最近 40 条不重复的提交信息（`git log -n 120 --format=%B`），供提交框的 ArrowUp 历史使用 |
| `host/registry.ts` | 编辑器探测用的 Windows 注册表视图：`App Paths`（`Code.exe`、`devenv.exe`、`studio64.exe`、JetBrains 的 `*64.exe` 等）、卸载项里的 `DisplayIcon`/`InstallLocation`、Android Studio 的安装键，以及 Visual Studio 的 `vswhere`；卸载树缓存 10 分钟 |
| `host/editors.ts` | 支持的编辑器表（VS Code、Insiders、Cursor、Windsurf、VSCodium、Zed、Sublime Text、TextMate、IntelliJ IDEA、WebStorm、PyCharm、GoLand、Visual Studio、Android Studio）：按平台探测（Windows 先查注册表，再查标准安装路径与 JetBrains Toolbox；macOS 的 `/Applications` 与 `~/Applications` 应用包；Linux 的 `PATH` 命令）并通过 `host/launch.ts` 启动（可执行文件、`open -a` 或命令），返回 `not-installed`、spawn 错误码或退出码，让面板能说明为什么没有打开 |
| `host/routes/apps.ts` | `mode=apps`：返回 `host/editors.ts` 探测到的编辑器（id + 显示名，按优先级）以及旧客户端读取的 `vscode` 布尔值；客户端为每个探测到的编辑器渲染一个图标，切换仓库时重新探测 |
| `host/credential-handler.ts` | `POST /git-suite/credential`：把 HTTPS 的用户名/令牌交给仓库配置的凭据助手保存（`git credential approve`，密码只走 stdin），保存前校验远端为 HTTPS 且存在 helper（否则 `409 no-credential-helper`）；`forge: true` 时也接受 SSH 远端，把令牌按平台 host 存成 HTTPS 凭据；接口从不回传密码 |
| `host/forge/` | 托管平台适配层：`detect.ts` 从 remote URL 识别 GitHub/Gitee/GitLab（含 `github.*`、`gitlab.*`、`gitee.*` 自建实例）并推导 API 基址；`token.ts` 按环境变量 → `gh auth token` → `git credential fill` 取令牌（5 分钟缓存）；`http.ts` 负责超时、大小上限、鉴权头、限流/401/404 映射与 60 秒缓存；`github.ts`/`gitee.ts`/`gitlab.ts` 把各自 payload 归一成 `PullSummary`/`PullDetail`；`remote.ts` 解析默认远端（当前分支 upstream → origin → 第一个） |
| `host/routes/pulls.ts` | `mode=pulls`：某个远端的 PR/MR 列表（`state=open|closed|all`，最多 30 条，`hasMore` 表示可能还有）；`mode=pull&number=N`：单个 PR 的描述、文件与提交；远端不支持时返回 `400 forge-unsupported`，令牌无效时返回 `401 forge-auth-required` |
| `host/pr-handler.ts` | `POST /git-suite/pr`：`action: 'checkout'`（默认）检出 PR——依次尝试 `refs/pull/N/head`（GitLab 为 `refs/merge-requests/N/head`）、远端源分支、fork 仓库的源分支，把提交取到 `refs/remotes/<remote>/pr/N`，然后创建或复用本地 `pr/N` 分支并 `git switch`（工作区有冲突改动时返回 `409 worktree-dirty`）；`POST /git-suite/pr-close`、`POST /git-suite/pr-reopen` 与 `POST /git-suite/pr-merge` 复用同一个 handler（默认 `close` / `reopen` / `merge`）：前两者调平台 API 改变状态并保留源分支，合并按 merge/squash/rebase（仅 GitHub 支持 rebase）并可删除源分支；缺少令牌时返回 `401 forge-auth-required` |
| `host/pr-create-handler.ts` | `POST /git-suite/pr-create`：校验标题/描述，目标远端由 `remote` 指定；源分支取当前分支的 upstream 远端与分支名，两个远端必须同平台同主机。校验 head/base 都存在于各自远端，缺少令牌返回 `401 forge-auth-required`；同仓库时直接提交分支，跨仓库时 GitHub/Gitee 提交 `owner:branch`、GitLab 先解析 `source_project_id`；分支未推送返回 `409 branch-not-pushed` |
| `host/pr-gitee-decision-handler.ts` | `POST /git-suite/pr-gitee-decision`：把 Gitee PR 的审查/测试标记为通过；provider 必须是 Gitee |
| `host/pr-delete-handler.ts` | `POST /git-suite/pr-delete`：删除 GitLab MR（GitHub/Gitee 只能关闭）；provider 必须是 GitLab |
| `host/pr-ai-review-handler.ts` | `POST /git-suite/pr-ai-review`：按模型的 `contextWindow` 动态分配 diff/完整文件预算（源码优先，无元数据时回退 120k/80k），按 `context` 获取上下文，调用默认模型；支持 JSON 或 `stream:true` 的 NDJSON（`start`/`reasoning`/`text`/`retry`/`done`/`error`）；不写平台 |
| `host/pr-review-context.ts` | 按用户选择读取完整文件：临时 worktree（不执行代码，随即清理）、平台 contents API 或仅 diff；限制文件数/单文件/总字符数 |
| `host/scan.ts` | 有界扫描工作区中的 Git 项目 |
| `host/parsers.ts` | 解析 log、commit header、numstat 和 ref |
| `host/routes/` | 分支、引用树、日志分页、提交详情、文件状态/diff 读取，以及本地分支切换 |
| `host/routes/status.ts` | `git status --porcelain=v2` + staged/unstaged numstat：已暂存/未暂存文件、分支/上游/ahead/behind 与作者 |
| `host/routes/workspace-diff.ts` | 单文件 staged/unstaged diff；未跟踪文件合成新增补丁 |
| `host/routes/switch.ts` | 双击本地分支时执行 `git switch`（POST、仅本地分支、不 force） |
| `host/routes/tag.ts` | `mode=tag`：单个标签指向的提交、短哈希、标题、附注说明，以及是否为附注标签 |
| `host/routes/tag-status.ts` | `mode=tag-status`：把本地标签与某个远端比较（`ls-remote --tags`，附注标签解析到提交），给出 相同/不同/仅本地 与仅远端的标签名 |
| `host/routes/version.ts` | `mode=version`：读取自身 `package.json` 版本并与 npm 上 `dsh-git-suite` 的最新版比较（20 秒超时，离线返回 `502 registry-unreachable`） |
| `host/routes/resolve.ts` | `mode=resolve`：把任意引用（`HEAD~2`、分支、标签、短哈希）解析成提交哈希、短哈希、作者、日期与标题 |
| `host/types.ts` | 宿主端 payload 类型 |
| `host/errors.ts` | `RouteError`（状态码、错误码、details） |

## 客户端

| 文件 | 职责 |
|---|---|
| `client/index.tsx` | 向 `window.__ModuleLoader__` 注册惰性工厂 |
| `client/plugin.ts` | 注册 `gitSuite` 字典、`main` 面板、`sidebar.panellist` 入口，以及右侧栏 `git` 标签页类型 |
| `client/runtime.ts` | 绑定 DSH 提供的 React，提供 `h` 与 hooks 包装 |
| `client/dsh.ts` | 本插件使用的 DSH client API 声明 |
| `client/GitLogPanel.tsx` | 面板骨架：头部、控件、提示、历史/提交视图切换与主体 |
| `client/SidebarPanel.tsx` | 右侧栏标签页外壳，使用窄栏单列样式 |
| `client/hooks/useGitLogView.ts` | 项目扫描、引用树、分页日志、详情选择与分页动作 |
| `client/hooks/useWorkspace.ts` | 工作区状态、单文件 diff、暂存/取消暂存、提交动作与 AI 生成提交信息 |
| `client/hooks/usePulls.ts` | PR 视图状态：受支持的远端与默认远端、开放中/已关闭/全部筛选、列表与详情请求、401 时的令牌对话框、检出后的刷新；只有 PR 视图可见时才请求 |
| `client/components/PullsPane.tsx` | PR 页面：远端/筛选工具栏、虚拟列表、详情（描述、讨论、AI 审查、CI 状态、提交、文件与可切换布局的差异）、在浏览器打开、检出、合并、关闭/重新打开；当前分支已有 PR 时显示编号入口 |
| `client/components/MergePullDialog.tsx` | 合并确认：合并方式、删除源分支、阻止合并/检查失败提示；Gitee 额外提供「审查通过」「测试通过」按钮 |
| `client/components/DeletePullDialog.tsx` | GitLab MR 的危险删除确认，必须勾选不可恢复提示 |
| `client/components/PullApprovalBadges.tsx` | Gitee 审查/测试状态徽章（未指派/待通过/部分通过/已通过） |
| `client/components/PullChecksBadge.tsx` | CI 汇总胶囊，带平台检查页链接 |
| `client/components/PullReviewBadge.tsx` | 评审只读汇总：已批准/有修改意见/待评审 |
| `client/components/Markdown.tsx` | 安全 Markdown 渲染：标题、段落、列表、引用、代码块（Prism 高亮）、表格、行内代码/链接/粗斜体；不渲染原始 HTML，链接仅允许 http(s)；用于讨论与 AI 审查 |
| `client/components/AiReviewDialog.tsx` | AI 审查前询问上下文方式（临时检出/完整文件/仅 Diff） |
| `client/components/CreatePullDialog.tsx` | 创建 PR 表单：源分支只读、目标分支下拉、标题/描述/草稿，跨仓库时提示 head/base 远端 |
| `client/components/VirtualList.tsx` | 固定行高的窗口化列表组件：自管滚动容器、`ResizeObserver` 测量、可见切片 + overscan、上下占位高度、`resetKey` 回顶、`onReachEnd`、`onViewportChange`；PR 列表与提交列表都使用它 |
| `client/components/` | 提交列表、提交行、路线图、提交历史工具栏（分支/远端/排序，右侧另有刷新按钮）、引用树（双击切换分支，分支/远端分组右侧「+」添加分支/远端）、可拖拽分割线、详情、设置弹窗（每页条数、可录制的打开快捷键、版本检查更新）、工作区/提交面板、第二行操作栏（Ant Design 5 风格 text 按钮：默认无边框无背景，悬停出现中性底色，按下时底色更重；「历史/提交」是带边框轨道的 `Switch`，保留文字标签，其余只保留图标 + tooltip：拉取/推送/获取、命令行、按平台命名的文件管理器，以及 `mode=apps` 探测到时的 VS Code）、仓库 + 菜单（克隆/选择）、添加/删除远端弹窗、编辑远端弹窗（名称 + 地址）、新建分支弹窗、`Dropdown`（可选搜索：搜索框在控件上，仓库下拉按名字过滤）、提交右键菜单（标签/分支/检出/拣选/反向提交/重置/最近操作）、标签右键菜单（检出）、贮藏右键菜单（应用/弹出/丢弃）、远端分支右键菜单（检出/合并/变基/拉取/删除）、提交列表的列显隐菜单、文件右键菜单（在文件资源管理器中显示）、`Spinner`（唯一的加载动画组件，配合 `useMinimumSpin` 保证转满三圈才消失，避免闪烁）、toast（`ToastHost` 只挂一次 + 模块级 `toast(text, kind)`，支持 info/error 两种样式）、`DiffView`（统一或左右分栏 diff：粘性新旧行号栏、增删着色、分批「显示更多」、行号拖选、hunk/行级操作；布局用图标按钮切换，偏好持久化为 `diffMode`）、可编辑的提交引用字段（实时解析）、`Button`/`DialogActions` 统一按钮（28px/12px）、错误与状态等展示组件 |
| `client/lib/api.ts` | 带私有头和 `AbortSignal` 的取数封装 |
| `client/lib/graph.ts` | 泳道路由图布局与几何计算 |
| `client/lib/patch.ts` | 把提交的合并补丁拆成每个文件一段，供文件列表切换 |
| `client/lib/highlight.ts` | diff 与 Markdown 代码块的 Prism 高亮：按文件路径或 fence 语言选语法，覆盖 TS/TSX、JS/JSX、JSON/JSON5、CSS/SCSS/Less、HTML/XML、Markdown、Python、Go、Rust、Java/Kotlin/Scala/Groovy、Swift、C#/F#、C/C++/Objective-C、PHP、Ruby、Perl、Lua、Dart、Elixir、Haskell、Erlang、Clojure、Julia、OCaml、Pascal、Shell/PowerShell/Batch、YAML/TOML/INI/Properties、SQL、Dockerfile、Makefile、CMake、Nix/HCL、GraphQL、Protobuf、Solidity、LaTeX、HTTP、Git 等；对整侧文本一次性分词以正确处理跨行结构，超过 6000 行则跳过高亮，未知语言回退纯文本 |
| `client/lib/diff.ts` | `parseDiff`：把统一 diff 文本解析为带类型的行（file/hunk/add/del/context/note），并计算新旧行号与增删行数 |
| `client/lib/use-split-size.ts` | `useSplitSize`：拖动起始值、上下限（数字或延迟测量）、可选的轴/反向/比例换算，以及去抖持久化；面板里所有分割线都基于它 |
| `client/lib/refs-tree.ts` | 分支目录折叠、远程/贮藏节点与树搜索过滤 |
| `client/lib/selection.ts` | 选择模型到请求参数、标签文字的映射 |
| `client/lib/projects.ts` | 项目分组、标签、分支标签等纯函数 |
| `client/lib/recent-projects.ts` | 最近项目在 localStorage 与 cookie 间的读写 |
| `client/lib/ui-state.ts` | 面板状态持久化（localStorage）：按仓库分桶（`repos[normalizeRepoKey(repoRoot)]`，含视图、过滤、分栏尺寸、树展开、草稿）+ 真正全局的偏好（diff 布局、打开快捷键）；旧版扁平字段继续作为每个仓库的回退值 |
| `client/lib/format.ts` | 绝对日期时间格式化（中文 `2026-10-25 03:10:45`，英文 `Oct 25, 2026, 03:10:45`） |
| `client/locales/` | 英文与中文文案，key 集合由英文定义 |
| `client/styles.module.scss` | CSS Module 样式源文件，类名由 esbuild 哈希 |
| `client/styles.ts` | 挂载已哈希的样式文本，并导出 `cls()` 解析类名 |

## 引用树

`mode=tree` 返回本地分支、标签、远程分组、贮藏和子模块。客户端 `buildRefSections` 把 `feat/x` 这样的分支名折叠成目录，`filterTree` 负责搜索过滤；历史页的刷新按钮位于搜索框右侧（提交页改用其顶部的工作区刷新）；标签、贮藏或子模块为空时不生成对应分组，子模块分组位于最后。点击引用节点产生一个 `Selection`（`head` / `all` / `remotes` / `branch` / `tag` / `stash`），`selectionParams` 再把它变成日志请求参数；点击子模块节点则打开子模块目录（`openPath`）。日志接口通过 `git rev-parse --show-superproject-working-tree` 返回 `superproject`；打开子模块后，项目选择显示 `[submodule]名称`，并出现「← 父仓库」按钮切回父仓库。

- 分支、标签 → `ref=<ref>`；标签允许 `refs/tags/*`。
- 贮藏 → `scope=stash&ref=<commit hash>`，宿主用 `--no-walk -n 1` 只取该提交；详情仍走 `mode=commit`。右键贮藏节点提供「应用」「弹出」「丢弃」（丢弃需确认），都走 `POST /git-suite/stash`；创建贮藏用「未暂存」分组标题右侧的「贮藏更改…」按钮（可填说明、可选包含未跟踪文件；工作区干净时返回 `409 nothing-to-stash`）。
- 分支分组直接列出本地分支；远端分组直接列出各远端分支；树中不再提供“所有分支/所有远端”入口。
- 本地分支领先/落后上游时，名称后显示 `↑N` / `↓N`（取自 `%(upstream:track)`）；上游已不存在时显示「上游已删除」。
- 标签会自动与上游所属远端（没有上游则第一个远端）比较：树加载完成后自动比对一次，标签集合变化时再自动比对；标签分组行不再放对比按钮，改放「+」打开新建标签弹窗。仅本地存在的标签显示上传箭头图标，提交与远端不同的显示不等号图标；不再显示汇总行。远端不可达时静默失败。
- 远端分组行尾有「+」按钮：打开添加远端弹窗，向 `/git-suite/remote` POST `{ action: 'add', name, url }`；添加成功后该分组会自动展开。
- 分支分组行尾有同样的「+」按钮：打开新建分支弹窗，向 `/git-suite/branch` POST `{ name, base }`；`base` 留空表示 `HEAD`，也可以填分支、标签或任意版本表达式。
- 远端分支右键菜单：检出为本地跟踪分支、合并/变基到当前分支、拉取到当前分支（走 `/git-suite/sync`）、删除远端分支（二次确认，`push --delete`）。
- 右键**当前分支**多出「变基到任意提交/标签…」，打开 `RebaseDialog`：`CommitRefField` 可实时解析提交、标签或分支，宿主执行 `git rebase <target>`（`rebase-onto`）。提交右键菜单也有同样动作并预填被点击的提交（「变基到此提交…」）。变基因冲突停下时返回 `409 operation-conflict`，由冲突横幅接管（继续 / 跳过 / 中止）。
- 远端分组右键打开菜单：获取 / 拉取 / 推送、**编辑远端**（可改名并改地址，`POST /git-suite/remote { action: 'set-url', newName }`）、删除；悬停该行会显示已配置的远端地址。
- 右键提交列表表头打开复选菜单，选择显示图表 / 日期 / 作者 / 提交列（描述列始终显示）；选择会持久化，面板宽度小于 760px 时自动隐藏作者与提交列并在菜单中禁用这两项。
- 行内提示（远端地址、子模块路径、切换分支提示、被截断的分支名）与所有控件提示都使用插件自己的 tooltip：每个面板挂载一个 `TooltipHost`，气泡本身是挂在 `document.body` 上的单个元素：先测锚点、再测量自身落点并做位置修正（缩放/变换/zoom 都不会让它错位），与控件保持 8px 间距，靠近底部时按自身实测高度翻到控件上方，元素用 `tooltipProps(text)`，`Button` 的 `title` 属性也会转换成同一套 tooltip（界面里不再出现浏览器原生 `title` 气泡）。气泡淡入 120ms、淡出 110ms，淡出期间宿主保持挂载。
- 标签节点右键菜单：「检出 {tag}」「编辑 {tag}」「推送 {tag}」「强制推送 {tag}」「用远端覆盖本地 {tag}」（仅当自动比对发现不一致时出现）「删除 {tag}」。检出通过 `POST /git-suite/checkout { ref }` 分离 HEAD；编辑先用 `mode=tag` 读取该标签，再保存改名、改提交或改说明；推送走 `/git-suite/sync { action: 'push', tagRefs: [名称] }`；强制推送与「用远端覆盖本地」（`fetch-tag`）都会改写标签指向，因此各自先进警告确认框；删除经二次确认后执行 `POST /git-suite/tag { action: 'delete' }`。

查看 HEAD 时，树会高亮当前分支（`head` 本身没有节点）。

## 分支切换

双击引用树中的**本地分支**会向 `/git-suite/switch` 发 POST 请求：

- 只接受 `refs/heads/*`；远程分支、标签和贮藏不会触发切换。
- 宿主执行 `git switch <branch>`，从不加 `--force`；工作区有会被覆盖的改动时返回 409 `worktree-dirty`，分支保持不变。
- 成功后客户端重新加载 HEAD 提交和引用树，选择回到 `head`，当前分支高亮移动。
- 该路由只接受 POST（GET 返回 405），并且仍受同源校验与私有请求头保护。

## 文件状态与提交

历史列表把头部（筛选、列标题、列宽拖拽）放在滚动容器之外，滚动条只覆盖提交行。第二行的「历史 / 提交」在同一页内切换提交历史与提交/文件状态（`WorkspacePane` + `useWorkspace`），共用仓库/路径、引用树和分支切换：

- `GET /git-suite?mode=status` 读取 `git status --porcelain=v2 -z --branch -uall`，加上 staged/unstaged numstat 和未跟踪文件行数，返回已暂存/未暂存列表、当前分支、上游、ahead/behind 与 Git 用户。
- `GET /git-suite?mode=workspace-diff&file=…&scope=staged|unstaged|untracked` 返回单个文件的 diff；未跟踪文件由宿主合成 `/dev/null → file` 补丁，单文件补丁上限 400k 字符。工作区差异与提交差异都通过 `DiffView` 渲染：增删行着色、横向滚动时新旧行号栏保持粘性、每次渲染 800 行并提供「显示剩余 N 行」按钮。diff 头部有图标按钮在统一视图（三条通栏）与分栏视图（左右两列）之间切换（持久化为 `diffMode`）：分栏模式把删除与新增左右配对、长行自动折行。两种布局都能拖选：统一视图拖行号列、分栏视图拖整行；分栏的每一行只对应它配对的新旧两行，因此暂存一对不会带进相邻未配对的行，表头行不可选。按下行号列即可选中该行，拖动可跨行选择（行号列是一条粘性轨道，选中行用强调色标注，靠近上下边缘时自动滚动）；选中后 **Ctrl/Cmd+C** 复制所选行；右键选中行可「暂存选中行 / 取消暂存选中行」（`POST /git-suite/action { action: 'stage-lines' | 'unstage-lines', paths: [file], lines: [diff 行号] }`，会重新计算 hunk 头并生成零上下文补丁）。工作区里每个 hunk 头带「暂存此块 / 取消暂存此块」按钮（`POST /git-suite/action { action: 'stage-hunks' | 'unstage-hunks', paths: [file], hunks: [index] }`）。
- `POST /git-suite/action`（Node handler，因为 DSH resource 路由只接受 GET/HEAD）接受 JSON：
  - `stage` / `unstage`，带 `paths` 或 `all`，分别执行 `git add -A` / `git reset -q HEAD`。
  - `commit`，带 `message`、`amend`、`push`，执行 `git commit -m`（可选 `--amend`），可选 `git push` 到当前上游。
- 暂存以文件为单位（暂不提供 hunk/区块级暂存）；每个文件行最右侧有 **+**（暂存该文件）或 **−**（取消暂存）按钮，双击文件行也会在已暂存/未暂存之间切换（行文字 `user-select: none`，双击不会选中文本）；提交成功后刷新状态并重新加载 HEAD/引用树。工具栏的拉取/推送可选择远端与分支，强制推送仅在明确勾选时使用；提交后的推送仍只推送到当前上游。
- 状态字母带颜色：**M** 黄、**U**（未跟踪，原先显示 `?`）绿、**D** 红、**R**/**C** 蓝、**A** 绿。未合并路径由 `mode=status` 的 `unmerged` 标志标识：状态字母保留（未合并显示 `U`），旁边另加红色警告图标。
- 提交信息输入框按仓库保存草稿（存于该仓库的 `ui-state` 分桶，去抖写入，只有提交成功后才清空）。标题行左侧是「提交信息」，右侧显示已配置的 Git 作者（`姓名 <邮箱>`）。**光标在 0 位按 ↑** 开始遍历该仓库最近的提交信息（`mode=commit-messages`，新→旧）；插入后**光标在末位、且未编辑时按 ↓** 继续遍历，遍历完最旧一条后回到开始遍历前输入的内容。任何编辑都视为新提交信息并重置遍历。
- 悬停文件行显示插件 tooltip，格式为 `<绝对路径> - <状态词>`（重命名会追加 `(from <旧路径>)`）；行的提示取代了原先只在路径上的提示。
- 提交信息旁的 **AI 生成** 通过 `POST /git-suite/generate-message` 读取 staged（无暂存时 unstaged）diff，调用 `ctx.llm.stream()`（provider/model 来自 `ctx.agentDefaultModel.currentSelection()`）生成提交信息；文件列表与 diff 会发送给配置的模型提供方，生成结果只填入输入框，不写仓库。没有默认模型、没有改动或模型失败时返回明确错误。
- 仓库/路径旁的 **+** 菜单（点击或悬停）提供「克隆远端仓库」和「选择本地仓库」：克隆通过 `POST /git-suite/clone` 校验 URL（https / ssh / git / file / 绝对本地路径，拒绝 `ext::` 等）与目标（绝对路径、父目录存在、目标不存在）后执行 `git clone`；克隆对话框的「克隆到」可用 `POST /git-suite/pick-directory` 的 `mode: 'directory'` 选择父目录并自动追加仓库名。选择本地仓库弹窗提供「选择目录」（`mode: 'repo'` 的原生选择器）、已扫描仓库和手动路径；点「打开」只在当前面板打开仓库。如需加入 DSH 工作区，请使用 DSH 自带的 Workspaces 添加入口。目录选择器不是 native 时提示手动输入路径。
- 改动文件右键菜单在「在文件资源管理器中显示」之外多一项危险操作：未暂存的已修改文件是「重置更改」（`git checkout --`，带警告确认），未跟踪文件是「删除文件」（带警告确认；宿主对已跟踪路径返回 `409 tracked-file`）。未跟踪文件还提供「忽略」：向 `.gitignore` 追加一条规则，可选仅该路径、仅同名文件（任意目录）、或 `*.后缀`；已暂存文件只提供定位。
- 改动文件右键打开菜单，提供「在文件资源管理器中显示」（`POST /git-suite/reveal`）：宿主拒绝仓库外路径，文件不存在时返回 `404 file-missing`，否则用系统文件浏览器选中该文件（`explorer /select,`、`open -R`、`xdg-open`）。文件缺失时以 toast 提示，不占用行内错误区。
- 所有写入仍是 POST + 同源 + 私有请求头；错误以 JSON 返回并在工作区显示。
- 提交页可调整尺寸：文件列与差异区之间是竖向分割线；文件列内部又是三个可调区域——已暂存列表、未暂存列表、提交信息表单——由两条横向分割线分开。尺寸由 `useSplitSize` 管理，并持久化为 `commitFilesWidth` / `commitStagedHeight` / `commitFormHeight`；提交信息输入框本身不再可拖拽，而是填满表单（表单高度不足时内部滚动）。在窄屏/侧栏堆叠布局下，文件列与差异区之间是可拖拽分割线（持久化为 `commitFilesHeight`），提交信息表单是 body 的最后一行（在列表与差异区之下），上方也是可拖拽分割线（向上拖增大表单，双击复位，持久化为 `commitNarrowHeight`）；未拖动前表单保持内容高度。

## 提交右键操作

提交列表的每一行右键打开「标签 / 分支 / 检出 / 拣选 / 反向提交 / 重置 / 最近操作」菜单（`CommitActions`）：

- **标签** → `POST /git-suite/tag`（弹窗标题为「新建标签」）：`git check-ref-format refs/tags/<name>` 校验名称；`message` 非空时用 `git tag -a -m`，否则轻量标签；只有 `force: true`（勾选「覆盖同名标签」）才加 `-f`。它的提交字段预填右键选中的提交、可编辑，并像分支弹窗一样实时解析。
- **分支** → `POST /git-suite/branch`：`git check-ref-format --branch` 校验后执行 `git branch <name> <起点>`。弹窗的「起点」预填右键选中的提交且可编辑；改成别的引用时会通过 `mode=resolve` 实时解析，并在输入框下方显示该提交的短哈希与标题；清空则回退到该提交。
- **检出** → `POST /git-suite/checkout`：`branch` 走 `git switch <branch>`，`hash` 走 `git switch --detach <hash>`；不 force；工作区有会被覆盖的改动时返回 409 `worktree-dirty`。客户端在检出前显示确认弹窗，分离 HEAD 会明确警告，分支也会提示工作区改动风险。
- **拣选** 执行 `git cherry-pick <hash>`，**反向提交** 执行 `git revert --no-edit <hash>`，都走 `POST /git-suite/commit-op`；冲突时返回 `409 operation-conflict`，弹窗提供「中止并恢复」（执行对应的 `--abort`）。
- **重置** 弹窗可选 soft/mixed/hard 三种方式；hard 显示警告并使用危险按钮。
- **最近操作** 读取 `mode=reflog`，可在旧提交上新建分支（默认名 `reflog-<短哈希>`），或勾选确认后硬重置到该提交。
- 标签/分支/检出成功后刷新日志和引用树；检出后选择回到 HEAD。
- 提交行里的分支/标签 **chip** 右键打开与引用树相同的菜单（本地分支菜单、远端分支菜单，或标签的 检出/编辑/推送/用远端覆盖/删除）；无法归类的装饰仍落到提交菜单。
- 以上路由仍是 POST + 同源 + 私有请求头。

## 冲突善后

当 merge / rebase / cherry-pick / revert 停在半途时，`mode=operation` 会返回该状态与未合并文件。冲突文件**直接出现在「未暂存」列表里**（未合并路径不再进入已暂存列表——`U` 是冲突标记而不是已暂存的改动），状态字母保留，旁边显示红色警告图标；行末按钮用于标记已解决（`git add`），右键菜单多出「用 ours」「用 theirs」（`git checkout --ours|--theirs` 后 `git add`，该侧不存在时置灰）。

列表上方保留一条紧凑提示条，显示操作名称、剩余冲突数与：

- **继续**：执行对应的 `--continue`（merge 用 `git commit --no-edit`；rebase 带 `-c core.editor=true`，不会弹编辑器）。
- **跳过**：rebase/cherry-pick/revert 支持 `--skip`；merge 没有跳过（返回 `400 skip-unsupported`）。
- **中止**：恢复到操作前的状态。

提示条会在仓库变化、同步结束以及每次冲突操作后刷新。

## PR 页面

第二行的视图切换在 **历史 / 提交** 之外增加 **PR**，但它只在 `mode=tree` 报告至少一个受支持的远端（`remotes[].forge` 非空）时出现；本地仓库、SSH 到不支持的主机，以及只有 `file://` 远端的仓库都不会看到这个入口。`forge` 由宿主在读取引用树时顺带算好，因此不需要额外探测请求。

- **远端**：默认取当前分支 upstream 所属远端，其次 `origin`，再其次第一个受支持远端；有多个时工具栏出现远端下拉。
- **加载**：只有 PR 视图可见时才请求 `mode=pulls`；首次取 30 条，滚到底或列表未填满时自动用 `page` 取下一页并追加（客户端上限 300 条）。列表按固定行高虚拟滚动，只渲染可见窗口；刷新按钮重置到第一页并带 `fresh=1` 跳过宿主缓存，开放中/已关闭/全部筛选和切换远端也会重置分页。
- **列表**：编号、标题、作者、源分支 → 目标分支、更新时间与状态胶囊（打开/草稿/已合并/已关闭）；工具栏搜索框按编号/标题/作者/分支过滤已加载的条目；行高固定，列表虚拟滚动。
- **调整大小**：列表与详情之间是一条可拖拽分割线；宽布局调列表宽度，窄布局调列表高度，双击复位，尺寸按仓库分别记住。
- **详情**：`mode=pull&number=…` 返回描述、讨论、改动文件（含补丁）、提交、CI 状态与可合并状态；描述、讨论和 AI 审查都用安全 Markdown 渲染；每个模块（描述/AI 审查/文件/提交/讨论）都有可收起的标题行，讨论固定在最后。文件差异复用 `DiffView`，并把文件路径传给它做语法高亮；分栏/统一布局沿用全局 `diffMode` 偏好。详情元信息显示仓库归属（跨仓库为 `head → base`），工具栏也以胶囊显示当前列表所属仓库，避免多远端/ fork 场景下混淆。「在浏览器打开」是普通链接（只接受 http/https），「检出」走 `POST /git-suite/pr`；检出前先执行 `git status --porcelain`，有未提交内容直接返回 `409 worktree-dirty`（带文件和数量），不会先 fetch/切分支。打开状态显示「合并」（`POST /git-suite/pr-merge`，可选 merge/squash/rebase 与删除源分支）和「关闭」（`POST /git-suite/pr-close`），已关闭状态显示「重新打开」（`POST /git-suite/pr-reopen`），都会先二次确认。工具栏的「创建 PR」打开表单：源分支为当前分支（必须是远端已有分支），目标分支从远端分支中选择，可填标题/描述/草稿，提交走 `POST /git-suite/pr-create`。详情工具栏的「AI 审查」点击后先弹窗选择上下文方式（临时 worktree / 平台 API / 仅 diff，选择持久化到 localStorage），再调用 `POST /git-suite/pr-ai-review`；宿主按所选方式读取完整文件（临时 worktree 读取后立即删除、不执行代码），再用 `ctx.llm` 的默认模型生成只读 Markdown，不写平台；客户端显示 loading/错误/结果，可重新审查或停止/清除；流式 NDJSON 会实时推送 `reasoning`/`text` 进度，重试时先发 `retry`。列表与详情在视图活跃时每 60 秒静默刷新第一页与当前详情。
- **认证**：平台返回 401 时弹出 `ForgeAuthDialog`；令牌是必填项，账号名可选（Gitee 个人仓库会预填 owner，留空时宿主调用平台 `/user` 解析出真实登录名）。令牌经 `POST /git-suite/credential { forge: true }` 交给仓库的凭据助手保存（SSH 远端也按平台 host 存成 HTTPS 凭据），随后自动重试。也可以改用 `GITHUB_TOKEN`/`GITEE_TOKEN`/`GITLAB_TOKEN` 或 `gh` 的登录态；令牌只在宿主进程使用。
- **检出**：成功后刷新工作区与引用树；本地分支名固定为 `pr/<编号>`，已存在时直接切换而不移动它。

## 右侧栏标签页

右侧栏的「开始」页由 `ui-sidebar-right` 提供。插件用 DSH 的两阶段注册接入：

1. `ctx.sidebarRightTabs.register(...)` 注册页类型（`id` 为包名、`kind: 'git'`）和「开始」页入口；`guide` 的 `order: 40` 排在 files（10）、terminal（20）、browser（30）之后。
2. `ctx.slots.register({ name: 'sidebar.right.pane.tab', key: id, locale: 'gitSuite' }, SidebarGitLogPanel)` 注册标签页内容；`key` 必须等于页类型的 `id`。

注册包在 `ctx.inject(['sidebarRightTabs'], …)` 里，右侧栏因此是**可选依赖**：未启用右侧栏时，主面板和左侧栏入口仍然工作。`SidebarGitLogPanel` 的外层 `.dsh-gitlog-sidebar` 把面板切换为窄栏布局（更小的内边距、单列列表/详情）；仓库/路径控件仅在当前行确实放不下时才换行。右侧面板的提交页默认不显示分支树（标题栏的分支树按钮可随时打开），历史页与主面板保持显示。任意位置可通过 DSH 快捷键目录打开（或聚焦）该 tab：客户端注册命令 `gitSuite.open`（默认 **Ctrl/Cmd+Shift+G**，可在 DSH 自己的键盘快捷键设置里重新绑定），开始页条目用 `commandId` 指向它，因此卡片会在标题右侧显示当前键帽；命令内部调用 `sidebarRight.openTab('git')`。右侧栏 tab 是 Session 作用域，DSH 会把 `sessionId` 作为属性传入，面板据此请求 `mode=session-repo` 并**默认打开当前 Session 工作目录所在的仓库**（查询失败或该目录不在仓库内时，回退到最近使用/扫描到的仓库）。

## 构建管线

`pnpm build` 依次执行：

1. `tsc -p tsconfig.json` 做全量类型检查（`noEmit`）。
2. `tsc -p tsconfig.host.json` 把 `src/host/` 编译到 `dist/`，入口是 `dist/index.js`。
3. `node scripts/build-client.mjs`：先用 `sass.compile()` 把 `src/client/styles.module.scss` 编译为 `styles.module.css`，跑一次 esbuild 让 `.module.css` 按 CSS Module 处理（类名全部哈希），把哈希后的样式写入 `src/client/styles.generated.css`，再调用 esbuild 把 `src/client/index.tsx` 打包为 `dist/client.js`（含 source map），CSS 通过 `--loader:.css=text` 内联进产物。构建期还有类名校验：`cls()` 里出现样式表没定义的类名、或 `cls()` 之外出现原始 `dsh-gitlog-*` 字符串，都会让构建失败。

### 为什么客户端仍要打包

DSH 每个包只通过 `exports["./client"]` 加载一个惰性工厂（`window.__ModuleLoader__.load({ id, factory })`），浏览器不会按 ESM 去解析插件内部的相对导入，所以拆分后的 `src/client/` 必须打包成单个 `dist/client.js`。React 来自工厂收到的 `require('react')`，即 DSH 的模块表，不进入产物。

### 产物与开发

- `dist/`、`src/client/styles.module.css` 和 `src/client/styles.generated.css` 都是构建产物，已被 Git 忽略；克隆后先 `pnpm install && pnpm build`，DSH 插件管理器不会替你构建。
- `pnpm watch:client` 监听 `src/client/`，任何改动都会重跑样式、哈希与打包；DSH HMR 监听 `dist/client.js`，重建后页面会重新加载该插件。
- 修改 `package.json` 的入口路径后，需要重启 DSH（或在插件页禁用再启用该插件），因为运行中的 Host 会缓存插件清单。


































