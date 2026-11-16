import type * as React from 'react'
import { h, useEffect, useState } from '../runtime.js'
import { isAbortError, requestJson, toApiError } from '../lib/api.js'
import type { Commit, ResolvePayload, Translate } from '../types.js'
import { hideTooltip, showTooltip } from './Tooltip.js'
import { cls } from '../styles.js'

export interface CommitRefFieldProps {
  t: Translate
  /** Repository the ref is resolved in. */
  path: string
  label: string
  value: string
  /** Commit the field falls back to when it is empty. */
  fallback: Commit
  onChange(value: string): void
  /** Enter inside the field; the dialogs use it to submit. */
  onSubmit?(): void
}

/**
 * Editable commit/ref field. Whatever is typed is resolved against the
 * repository after a short pause, and the commit's short hash and subject are
 * shown right under the input.
 */
export function CommitRefField({ t, path, label, value, fallback, onChange, onSubmit }: CommitRefFieldProps): React.ReactElement {
  const [resolved, setResolved] = useState<ResolvePayload | null>(null)
  const [resolving, setResolving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const ref = value.trim()
    if (ref === '' || ref === fallback.shortHash || ref === fallback.hash) {
      setResolved({
        ok: true,
        hash: fallback.hash,
        shortHash: fallback.shortHash,
        author: fallback.author,
        date: fallback.date,
        subject: fallback.subject,
      })
      setResolving(false)
      setError(null)
      return undefined
    }
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setResolving(true)
      requestJson<ResolvePayload>({ mode: 'resolve', path, ref }, controller.signal)
        .then(payload => {
          if (controller.signal.aborted) return
          setResolved(payload)
          setError(null)
        })
        .catch((failure: unknown) => {
          if (controller.signal.aborted || isAbortError(failure)) return
          setResolved(null)
          setError(toApiError(failure).message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setResolving(false)
        })
    }, 350)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the fallback commit never changes while the dialog is open
  }, [value, path, fallback.hash, fallback.shortHash])

  const summary = resolving
    ? t('loadingCommit')
    : error !== null
      ? error
      : resolved === null
        ? ''
        : `${resolved.shortHash} · ${resolved.subject || t('noSubject')}`

  return (
    <label className={cls('dsh-gitlog-field')}>
      <span>{label}</span>
      <input
        type="text"
        value={value}
        onChange={event => onChange(event.target.value)}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
          event.preventDefault()
          onSubmit?.()
        }}
        placeholder={fallback.hash}
        spellCheck={false}
        autoComplete="off"
      />
      {summary === '' ? null : (
        <span
          className={cls(`dsh-gitlog-field-hint${error === null ? '' : ' is-error'}`)}
          onMouseEnter={event => {
            // Long subjects are clipped to one line; show the whole text on hover.
            const element = event.currentTarget
            if (element.scrollWidth <= element.clientWidth + 1) return
            showTooltip(summary, element.getBoundingClientRect())
          }}
          onMouseLeave={hideTooltip}
        >
          {summary}
        </span>
      )}
    </label>
  )
}

