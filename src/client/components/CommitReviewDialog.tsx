/**
 * Pre-commit AI review dialog: streams a Markdown review of the staged diff and
 * lets the user copy it or drop it into the current session's composer.
 */
import type * as React from 'react'
import { h, useCallback, useEffect, useRef, useState } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { isAbortError, requestCommitReviewStream, requestStagedHash, toApiError } from '../lib/api.js'
import { resolvePrompt } from '../lib/ai-prompts.js'
import { sessionInsert } from '../sessionBridge.js'
import type { Translate } from '../types.js'
import { Button, DialogActions } from './Button.js'
import { DialogShell } from './DialogShell.js'
import { LoadingLine } from './States.js'
import { Markdown } from './Markdown.js'
import { cls } from '../styles.js'

export interface CommitReviewDialogProps {
  view: GitLogView
  t: Translate
  /** Session whose composer receives the review; absent when no chat session is bound. */
  sessionId?: string
  onClose(): void
}

/** Streaming review phase. */
type Phase = 'loading' | 'ready' | 'error'

/** One-shot AI review of the staged changes. */
export function CommitReviewDialog({ view, t, sessionId, onClose }: CommitReviewDialogProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>('loading')
  const [review, setReview] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<'copied' | 'inserted' | 'failed' | null>(null)
  const [attempt, setAttempt] = useState(1)
  /** Hash of the staged diff the shown review describes; empty until known. */
  const [reviewHash, setReviewHash] = useState('')
  /** The staged diff changed after this review was produced. */
  const [stale, setStale] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const start = useCallback((fresh = false): void => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setPhase('loading')
    setReview('')
    setError(null)
    setNotice(null)
    setAttempt(1)
    setStale(false)
    setReviewHash('')
    void requestCommitReviewStream(
      {
        path: view.repo?.repoRoot ?? view.pathInput.trim(),
        language: t('localeId'),
        fresh,
        prompt: resolvePrompt('commitReview', view.repo?.repoRoot ?? null).template,
      },
      event => {
        if (event.type === 'start') {
          setAttempt(event.attempt)
          if (typeof event.hash === 'string' && event.hash !== '') setReviewHash(event.hash)
        } else if (event.type === 'text') setReview(current => current + event.text)
        else if (event.type === 'done') {
          setReview(event.review)
          if (typeof event.hash === 'string' && event.hash !== '') setReviewHash(event.hash)
          setPhase('ready')
        }
      },
      controller.signal,
    )
      .then(payload => {
        setReview(payload.review)
        if (payload.hash !== '') setReviewHash(payload.hash)
        setPhase('ready')
      })
      .catch(failure => {
        if (isAbortError(failure)) return
        setError(toApiError(failure).message)
        setPhase('error')
      })
  }, [t, view.repo?.repoRoot, view.pathInput])

  useEffect(() => {
    start()
    return () => abortRef.current?.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one review per dialog open
  }, [])

  // Follow the stream so the newest text stays visible.
  useEffect(() => {
    const box = boxRef.current
    if (box !== null) box.scrollTop = box.scrollHeight
  }, [review])

  // Warn when the staged diff changes while the review is on screen: check once
  // right away, then every 15 seconds and whenever the window regains focus.
  useEffect(() => {
    if (reviewHash === '' || phase !== 'ready') return
    const controller = new AbortController()
    const check = async (): Promise<void> => {
      try {
        const payload = await requestStagedHash(
          { path: view.repo?.repoRoot ?? view.pathInput.trim() },
          controller.signal,
        )
        if (!controller.signal.aborted) setStale(payload.hash !== reviewHash)
      } catch {
        // A transient git failure keeps the current state.
      }
    }
    void check()
    const timer = window.setInterval(() => { void check() }, 15_000)
    const onFocus = (): void => { void check() }
    window.addEventListener('focus', onFocus)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [phase, reviewHash, view.repo?.repoRoot, view.pathInput])

  const copy = async (): Promise<void> => {
    // Only the settled review may be copied; a streamed prefix is incomplete.
    if (phase !== 'ready') return
    try {
      await navigator.clipboard.writeText(review)
      setNotice('copied')
    } catch {
      setNotice('failed')
    }
  }

  const insert = (): void => {
    if (phase !== 'ready' || sessionId === undefined) return
    const bridge = sessionInsert()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const name = `git-review-${stamp}.md`
    const ok = bridge !== null
      && (bridge.attachMarkdown(sessionId, name, review) || bridge.setDraft(sessionId, review))
    setNotice(ok ? 'inserted' : 'failed')
  }

  return (
    <DialogShell title={t('commitReviewTitle')} t={t} wide onClose={onClose}>
      {phase === 'loading'
        ? (
            <LoadingLine label={t('commitReviewRunning').replace('{attempt}', String(attempt))} />
          )
        : null}
      {phase === 'error' && error !== null
        ? <p className={cls('dsh-gitlog-note')} role="alert">{error}</p>
        : null}
      {stale
        ? (
            <p className={cls('dsh-gitlog-field-hint is-error')} role="status">
              {t('commitReviewStale')}
            </p>
          )
        : null}
      {review === ''
        ? null
        : (
            <div ref={boxRef} className={cls('dsh-gitlog-commit-review')}>
              <Markdown text={review} />
            </div>
          )}
      {notice === null
        ? null
        : (
            <p className={cls('dsh-gitlog-field-hint')} role="status">
              {t(notice === 'copied'
                ? 'commitReviewCopied'
                : notice === 'inserted' ? 'commitReviewInserted' : 'commitReviewInsertFailed')}
            </p>
          )}
      <DialogActions>
        <Button disabled={phase !== 'ready'} onClick={() => { void copy() }}>
          {t('commitReviewCopy')}
        </Button>
        <Button
          disabled={phase !== 'ready' || sessionId === undefined}
          title={sessionId === undefined ? t('commitReviewNoSession') : undefined}
          onClick={insert}
        >
          {t('commitReviewInsert')}
        </Button>
        <Button disabled={phase === 'loading'} onClick={() => start(true)}>
          {t('commitReviewRegenerate')}
        </Button>
        <Button variant="primary" onClick={onClose}>{t('close')}</Button>
      </DialogActions>
    </DialogShell>
  )
}
