// Form fields shared by sign-in, setup and settings.
import { useState, type InputHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import type { Translate } from './helpers'

/** A password field whose content can be shown, to check what was typed. */
export function PasswordInput({ tr, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { tr: Translate }) {
  const [visible, setVisible] = useState(false)
  return (
    <span className="password-field">
      <input {...props} type={visible ? 'text' : 'password'} spellCheck={false} />
      <button className="password-toggle" type="button" aria-pressed={visible} title={visible ? tr('Masquer le mot de passe', 'Hide the password') : tr('Afficher le mot de passe', 'Show the password')}
        aria-label={visible ? tr('Masquer le mot de passe', 'Hide the password') : tr('Afficher le mot de passe', 'Show the password')} onClick={() => setVisible(!visible)}>
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </span>
  )
}

export function RecoveryCode({ code, tr }: { code: string; tr: Translate }) {
  return (
    <div className="dk-recovery" role="status">
      <strong>{tr('Code de secours — notez-le maintenant', 'Recovery code — write it down now')}</strong>
      <code>{code}</code>
      <span>{tr('Il ne sera plus affiché. C’est le seul moyen de retrouver l’accès si le mot de passe est oublié.', 'It will not be shown again. It is the only way back in if the password is forgotten.')}</span>
    </div>
  )
}
