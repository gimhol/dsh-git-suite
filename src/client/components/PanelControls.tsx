import type * as React from 'react'
import { h } from '../runtime.js'
import type { GitLogView } from '../hooks/useGitLogView.js'
import { projectDropdownOptions } from '../lib/project-dropdown.js'
import type { Translate } from '../types.js'
import { Dropdown } from './Dropdown.js'
import { Button } from './Button.js'
import { RepositoryMenu } from './RepositoryMenu.js'
import { cls } from '../styles.js'

/** Project and path controls above the commit list; page size lives in Settings. */
export function PanelControls({ view, t }: { view: GitLogView; t: Translate }): React.ReactElement {
  return (
    <div className={cls('dsh-gitlog-controls')}>
      <Dropdown
        className={cls('dsh-gitlog-field project')}
        value={view.selectedProjectPath}
        options={projectDropdownOptions(view, t)}
        onChange={view.selectProjectPath}
        disabled={view.projectsStatus === 'loading'}
        ariaLabel={t('project')}
        placeholder={t('selectProject')}
        searchable
        searchPlaceholder={t('search')}
        noMatchesLabel={t('noMatches')}
      />
      {view.repo !== null && view.repo.superproject !== null
        ? (
            <Button
              title={t('backToParent')}
              className={cls('dsh-gitlog-parent-btn')}
              onClick={() => view.openPath(view.repo?.superproject ?? '')}
            >
              {t('backToParent')}
            </Button>
          )
        : null}
      <label className={cls('dsh-gitlog-field grow')}>
        <input
          type="text"
          value={view.pathInput}
          onChange={event => view.changePathText(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
            event.preventDefault()
            view.submitPath()
          }}
          placeholder={t('pathPlaceholder')}
          spellCheck={false}
          autoComplete="off"
          aria-label={t('path')}
        />
      </label>
      <RepositoryMenu view={view} t={t} />
    </div>
  )
}
