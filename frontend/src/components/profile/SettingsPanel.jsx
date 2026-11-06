import React, { useState } from 'react';
import { KeyRound, Upload } from 'lucide-react';
import { Avatar } from './Avatar.jsx';

function SettingsPanel({ text, user, userEmail, supabase }) {
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canUpdateAccount = Boolean(supabase && user?.id);

  async function uploadAvatar(file) {
    if (!file || !canUpdateAccount) return;
    setBusy(true);
    setError('');
    try {
      const extension = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/avatar-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from('avatars').upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('avatars').getPublicUrl(path);
      const { error: updateError } = await supabase.auth.updateUser({ data: { avatar_url: data.publicUrl } });
      if (updateError) throw updateError;
      setNotice(text.user.avatarSaved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function updatePassword() {
    if (!canUpdateAccount || password.length < 6) return;
    setBusy(true);
    setError('');
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setPassword('');
      setNotice(text.user.passwordSaved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {error && <div className="error-banner">{error}</div>}
      {notice && <div className="success-banner">{notice}</div>}
      {!canUpdateAccount && <div className="error-banner">{text.user.localOnly}</div>}

      <article className="account-card">
        <h2>{text.user.avatar}</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Avatar user={user} size={64} />
          <div>
            <p style={{ margin: 0, color: 'var(--muted)' }}>{userEmail}</p>
            <label className="secondary-button avatar-upload" style={{ marginTop: '8px' }}>
              <Upload size={16} /> {text.user.uploadAvatar}
              <input type="file" accept="image/*" disabled={!canUpdateAccount || busy} onChange={(event) => uploadAvatar(event.target.files?.[0])} />
            </label>
          </div>
        </div>
      </article>

      <article className="account-card">
        <h2>{text.user.password}</h2>
        <input type="password" placeholder={text.user.passwordHint} value={password} onChange={(event) => setPassword(event.target.value)} />
        <button className="primary-button" disabled={!canUpdateAccount || busy || password.length < 6} onClick={updatePassword}>
          <KeyRound size={16} /> {text.user.updatePassword}
        </button>
      </article>
    </div>
  );
}

export { SettingsPanel };
