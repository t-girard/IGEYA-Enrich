'use client';

import { useState, type FormEvent } from 'react';
import { useStore } from '@/lib/store';
import { Brand } from './ui';

export default function Login() {
  const login = useStore((s) => s.login);
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!em || !pw) {
      setErr('Saisissez votre e-mail et votre mot de passe.');
      return;
    }
    setBusy(true);
    const error = await login(em, pw);
    setBusy(false);
    if (error) setErr(error);
  }

  return (
    <div className="login">
      <section className="login-form-wrap">
        <form className="login-form" onSubmit={submit} noValidate>
          <Brand dark />
          <h1>Connexion</h1>
          <p className="muted">Accédez à la base de référence des professionnels de santé.</p>
          <div className="field">
            <label htmlFor="lg-email">E-mail professionnel</label>
            <input id="lg-email" type="email" autoComplete="username" placeholder="prenom.nom@igeya.fr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="lg-pw">Mot de passe</label>
            <div className="pw">
              <input id="lg-pw" type={show ? 'text' : 'password'} autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} />
              <button type="button" onClick={() => setShow((v) => !v)} aria-label="Afficher ou masquer le mot de passe">
                {show ? 'Masquer' : 'Afficher'}
              </button>
            </div>
          </div>
          {err && (
            <div className="form-err" role="alert">
              {err}
            </div>
          )}
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            {busy ? 'Connexion…' : 'Se connecter'}
          </button>
        </form>
      </section>
    </div>
  );
}
