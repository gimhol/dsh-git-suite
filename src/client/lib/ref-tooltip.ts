/**
 * Tooltips for the ref chips on a commit row.
 *
 * `git --decorate=short` gives `HEAD -> main`, `origin/main`, `tag: v1.0`, or a
 * bare local branch name. The refs tree adds what the decoration cannot say:
 * whether a local branch tracks a remote and how far it has drifted, which
 * remote a tracking branch belongs to, and where a tag points.
 */
import type { Branch, RefsPayload, Translate } from '../types.js'

const HEAD = 'HEAD'
const HEAD_ARROW = 'HEAD -> '
const TAG_PREFIX = 'tag: '

/** Join the non-empty parts of one tooltip. */
function join(parts: string[]): string {
  return parts.filter(part => part !== '').join(' · ')
}

/** Describe a local branch: its upstream, drift, and whether it is checked out. */
function localTooltip(branch: Branch, checkedOut: boolean, t: Translate): string {
  const parts = [checkedOut || branch.current ? t('refTipCurrent') : t('refTipLocal')]
  if (branch.gone === true) {
    parts.push(t('refTipGone'))
  } else if (branch.upstream !== undefined && branch.upstream !== '') {
    parts.push(t('refTipTracks').replace('{upstream}', branch.upstream))
  } else {
    parts.push(t('refTipNoUpstream'))
  }
  const ahead = branch.ahead ?? 0
  const behind = branch.behind ?? 0
  if (ahead > 0) parts.push(t('refTipAhead').replace('{ahead}', String(ahead)))
  if (behind > 0) parts.push(t('refTipBehind').replace('{behind}', String(behind)))
  return join(parts)
}

/** Describe a tag by the commit it decorates. */
function tagTooltip(shortHash: string, t: Translate): string {
  return join([t('refTipTag'), shortHash === '' ? '' : t('refTipPointsAt').replace('{hash}', shortHash)])
}

/**
 * Build the tooltip of one decoration.
 * @param ref - the decoration as Git printed it.
 * @param tree - the refs tree, when loaded; enables upstream and remote details.
 * @param shortHash - the decorated commit's short hash, for tags and detached HEAD.
 * @param t - translator.
 * @returns the tooltip text, or null when the ref cannot be described.
 */
export function refTooltip(
  ref: string,
  tree: RefsPayload | null,
  shortHash: string,
  t: Translate,
): string | null {
  if (ref === '') return null
  if (ref === HEAD) return join([t('refTipDetached'), t('refTipPointsAt').replace('{hash}', shortHash)])
  const arrowName = ref.startsWith(HEAD_ARROW) ? ref.slice(HEAD_ARROW.length) : null
  const name = arrowName ?? ref
  const branches = tree?.branches ?? []
  const local = branches.find(branch => branch.kind === 'local' && branch.name === name)
  if (local !== undefined) return localTooltip(local, arrowName !== null, t)
  if (ref.startsWith(TAG_PREFIX)) return tagTooltip(shortHash, t)
  const remote = branches.find(branch => branch.kind === 'remote' && branch.name === name)
  if (remote !== undefined) {
    const remoteName = (tree?.remotes ?? [])
      .map(group => group.name)
      .find(candidate => candidate !== '' && name.startsWith(`${candidate}/`))
    // A remote branch says who follows it: the local branch, if any.
    const tracker = branches.find(branch => branch.kind === 'local' && branch.upstream === name)
    return join([
      t('refTipRemote'),
      remoteName === undefined ? '' : t('refTipRemoteName').replace('{remote}', remoteName),
      tracker === undefined ? t('refTipNotTracked') : t('refTipTrackedBy').replace('{branch}', tracker.name),
    ])
  }
  if ((tree?.tags ?? []).some(tag => tag.name === name)) return tagTooltip(shortHash, t)
  return null
}
