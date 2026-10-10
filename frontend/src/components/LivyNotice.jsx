import { useStore } from '../store/useStore.js'
import { livyNoticeIds } from '../lib/livy.js'
import { t, tn } from '../lib/i18n.js'
import Icon from './Icon.jsx'

// Shown once the profile holds Livy entries this device has not dismissed. Undo removes exactly
// those entries (source livy, those ids) and remembers the ids so a retry does not put them back.
export default function LivyNotice() {
  const ready = useStore(s => s.ready)
  const S = useStore(s => s.S)
  const dismissLivyNotice = useStore(s => s.dismissLivyNotice)
  const undoLivyNotice = useStore(s => s.undoLivyNotice)
  if (!ready) return null
  const ids = livyNoticeIds(S)
  if (!ids.length) return null
  const n = ids.length
  return <div className="livy-note" role="status">
    <span className="livy-note-t">{tn('1 entry added by Livy', '{0} entries added by Livy', n)}</span>
    <button type="button" className="livy-note-undo" onClick={() => undoLivyNotice()}>{t('Undo')}</button>
    <button type="button" className="livy-note-x iconbtn" onClick={() => dismissLivyNotice()} aria-label={t('Dismiss')}><Icon name="xmark" /></button>
  </div>
}
