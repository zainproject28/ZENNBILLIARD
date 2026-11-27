import React, { useEffect, useState } from 'react';
import { AlertCircle, ArrowRightIcon, Lock, MailIcon, UserIcon } from 'lucide-react';
import { LiquidMetalButton } from '@/components/ui/liquid-metal-button.tsx';
import {
  Button,
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  Waitlist04,
} from '@/components/ui/shadcn-studio-waitlist-04.tsx';
import {
  checkGoogleRedirectResult,
  getFirebaseAuthErrorMessage,
  isPopupBlockedError,
  loginAnonymouslyFirebase,
  loginWithEmail,
  loginWithGoogle,
  loginWithGoogleRedirect,
  registerWithEmail,
  resetPassword,
  syncFirebaseUserProfile,
} from '../services/firebase.ts';
import { createLocalGuestProfile, safeFetchJson, saveStoredGuestSession } from '../services/apiFallback.ts';
import { audioEngine } from '../services/audio.ts';
import type { UserProfile } from '../game/types.ts';
import { t, type Language } from '../services/i18n.ts';

interface AuthScreenProps {
  language?: Language;
  onLanguageChange?: (lang: Language) => void;
  onAuthenticated: (token: string, profile: UserProfile, isFirebase: boolean) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({
  language = 'en',
  onLanguageChange,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [guestName, setGuestName] = useState('');
  const [loading, setLoading] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isId = language === 'id';

  useEffect(() => {
    let active = true;
    void checkGoogleRedirectResult()
      .then(async (redirectUser) => {
        if (!active || !redirectUser) return;
        setLoading(true);
        try {
          const token = await redirectUser.getIdToken();
          const profile = await syncFirebaseUserProfile(redirectUser);
          if (active) onAuthenticated(token, profile, true);
        } catch {
          if (active) setError(t(language, 'profileSyncFailed'));
        } finally {
          if (active) setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (active) setError(getFirebaseAuthErrorMessage(err, language));
      });
    return () => {
      active = false;
    };
  }, [language, onAuthenticated]);

  const handleGoogle = async () => {
    audioEngine.unlock();
    audioEngine.playClick();
    setError(null);
    setInfo(null);
    setPopupBlocked(false);
    setLoading(true);
    try {
      const user = await loginWithGoogle();
      const token = await user.getIdToken();
      try {
        const profile = await syncFirebaseUserProfile(user);
        onAuthenticated(token, profile, true);
      } catch {
        setError(t(language, 'profileSyncFailed'));
      }
    } catch (err: unknown) {
      if (isPopupBlockedError(err)) {
        setPopupBlocked(true);
      }
      setError(getFirebaseAuthErrorMessage(err, language));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleRedirect = async () => {
    audioEngine.unlock();
    audioEngine.playClick();
    setError(null);
    setLoading(true);
    try {
      await loginWithGoogleRedirect();
    } catch (err: unknown) {
      setError(getFirebaseAuthErrorMessage(err, language));
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    audioEngine.unlock();
    audioEngine.playClick();
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError(isId ? 'Masukkan alamat email Anda.' : 'Please enter your email address.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'forgot') {
        await resetPassword(email.trim());
        setInfo(
          isId
            ? 'Tautan atur ulang kata sandi sudah dikirim ke email Anda.'
            : 'Password reset link has been sent to your email.',
        );
        setMode('login');
      } else if (mode === 'register') {
        if (password.length < 6) {
          setError(isId ? 'Kata sandi minimal 6 karakter.' : 'Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        const preferred = username.trim() || undefined;
        const user = await registerWithEmail(email.trim(), password, preferred);
        const token = await user.getIdToken();
        try {
          const profile = await syncFirebaseUserProfile(user, preferred);
          onAuthenticated(token, profile, true);
        } catch {
          setError(t(language, 'profileSyncFailed'));
        }
      } else {
        const user = await loginWithEmail(email.trim(), password);
        const token = await user.getIdToken();
        try {
          const profile = await syncFirebaseUserProfile(user);
          onAuthenticated(token, profile, true);
        } catch {
          setError(t(language, 'profileSyncFailed'));
        }
      }
    } catch (err: unknown) {
      setError(getFirebaseAuthErrorMessage(err, language));
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    audioEngine.unlock();
    audioEngine.playClick();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await safeFetchJson<{ token: string; profile: UserProfile }>('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: guestName.trim() || undefined }),
      });
      if (res.ok && res.data?.profile) {
        saveStoredGuestSession(res.data.token, res.data.profile);
        onAuthenticated(res.data.token, res.data.profile, false);
        return;
      }
      if (!res.isBackendAvailable) {
        try {
          const anonUser = await loginAnonymouslyFirebase();
          const anonToken = await anonUser.getIdToken();
          const anonProfile = await syncFirebaseUserProfile(anonUser, guestName.trim() || undefined);
          onAuthenticated(anonToken, anonProfile, true);
          return;
        } catch {
          const localProfile = createLocalGuestProfile(guestName.trim() || undefined);
          onAuthenticated('', localProfile, false);
          return;
        }
      }
      throw new Error(isId ? 'Gagal membuat sesi tamu.' : 'Could not create guest session.');
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message.replace(/[-–—]/g, ' ')
          : isId
            ? 'Login tamu gagal.'
            : 'Guest login failed.',
      );
    } finally {
      setLoading(false);
    }
  };

  const headerTitle =
    mode === 'register'
      ? isId
        ? 'Buat Akun ZENN BILLIARD'
        : 'Create ZENN BILLIARD Account'
      : mode === 'forgot'
        ? isId
          ? 'Atur Ulang Kata Sandi'
          : 'Reset Account Password'
        : isId
          ? 'Masuk ke ZENN BILLIARD'
          : 'Sign In to ZENN BILLIARD';

  const headerDesc =
    mode === 'register'
      ? isId
        ? 'Daftar gratis untuk bermain 8 Ball, 9 Ball, dan mabar online bersama teman.'
        : 'Register free to play 8 Ball, 9 Ball, and online friend matches.'
      : mode === 'forgot'
        ? isId
          ? 'Masukkan email terdaftar untuk menerima tautan pemulihan akun.'
          : 'Enter your registered email to receive a password recovery link.'
        : isId
          ? 'Mainkan 8 Ball dan 9 Ball bersama teman atau berlatih melawan komputer.'
          : 'Play 8 Ball and 9 Ball online with friends or practice against smart AI.';

  return (
    <Waitlist04
      brandName='ZENN BILLIARD'
      title={headerTitle}
      description={headerDesc}
      language={language}
      onLanguageChange={onLanguageChange}
    >
      <div className='w-full rounded-2xl neu-inset p-3 sm:p-3.5 text-left space-y-2.5'>
        {/* Mode Switcher */}
        <div className='flex items-center justify-between gap-2 border-b border-white/10 pb-2'>
          <span className='text-xs sm:text-sm font-bold text-zinc-100'>
            {mode === 'login'
              ? isId
                ? 'Masuk Akun'
                : 'Member Sign In'
              : mode === 'register'
                ? isId
                  ? 'Daftar Baru'
                  : 'Create Account'
                : isId
                  ? 'Pemulihan'
                  : 'Recovery'}
          </span>
          <div className='inline-flex items-center rounded-lg bg-[#161922] border border-white/10 p-0.5 gap-1'>
            <button
              type='button'
              data-testid='auth-tab-login'
              onClick={() => {
                setMode('login');
                setError(null);
                setInfo(null);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer border ${
                mode === 'login'
                  ? 'bg-[#222531] border-amber-400/70 text-amber-300 shadow-xs'
                  : 'border-transparent text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {isId ? 'Masuk' : 'Sign In'}
            </button>
            <button
              type='button'
              data-testid='auth-tab-register'
              onClick={() => {
                setMode('register');
                setError(null);
                setInfo(null);
              }}
              className={`px-2.5 py-1 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                mode === 'register'
                  ? 'bg-red-700 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              {isId ? 'Daftar' : 'Sign Up'}
            </button>
          </div>
        </div>

        {error && (
          <div
            role='alert'
            className='flex items-start gap-2 rounded-lg border border-red-500/35 bg-red-950/50 px-2.5 py-2 text-[11px] sm:text-xs text-red-200'
          >
            <AlertCircle className='size-3.5 shrink-0 mt-0.5 text-red-400' />
            <span>{error}</span>
          </div>
        )}

        {info && (
          <div className='rounded-lg border border-amber-400/35 bg-amber-950/40 px-2.5 py-2 text-[11px] sm:text-xs font-medium text-amber-200'>
            {info}
          </div>
        )}

        {/* Continue with Google */}
        <Button
          type='button'
          variant='outline'
          disabled={loading}
          onClick={handleGoogle}
          data-testid='google-login-btn'
          className='w-full h-9 bg-[#171a22] hover:bg-[#1f232e] border-white/14 text-zinc-100 font-bold text-xs sm:text-sm justify-center gap-2 shadow-xs'
        >
          <svg className='size-4 shrink-0' viewBox='0 0 24 24' aria-hidden='true'>
            <path
              fill='#4285F4'
              d='M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z'
            />
            <path
              fill='#34A853'
              d='M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z'
            />
            <path
              fill='#FBBC05'
              d='M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z'
            />
            <path
              fill='#EA4335'
              d='M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z'
            />
          </svg>
          <span>{isId ? 'Lanjutkan dengan Google' : 'Continue with Google'}</span>
        </Button>

        {popupBlocked && (
          <Button
            type='button'
            variant='outline'
            disabled={loading}
            onClick={handleGoogleRedirect}
            data-testid='google-redirect-btn'
            className='w-full h-8 bg-[#171a22] hover:bg-[#1f232e] border-amber-400/40 text-amber-300 font-bold text-xs justify-center'
          >
            {t(language, 'googleRedirectBtn')}
          </Button>
        )}

        <div className='flex items-center gap-2.5 text-[11px] font-medium text-zinc-500'>
          <div className='flex-1 h-px bg-white/10' />
          <span>{isId ? 'atau gunakan email' : 'or continue with email'}</span>
          <div className='flex-1 h-px bg-white/10' />
        </div>

        {/* Email Sign In / Sign Up Form */}
        <form onSubmit={handleEmailSubmit} className='space-y-2'>
          {mode === 'register' && (
            <div className='space-y-0.5'>
              <label htmlFor='auth-username' className='block text-[11px] font-semibold text-zinc-300'>
                Username
              </label>
              <InputGroup className='h-8.5'>
                <InputGroupAddon>
                  <UserIcon className='size-3.5 text-zinc-400' />
                </InputGroupAddon>
                <InputGroupInput
                  id='auth-username'
                  type='text'
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder='Username'
                  maxLength={24}
                  className='text-xs sm:text-sm'
                />
              </InputGroup>
            </div>
          )}

          <div className='space-y-0.5'>
            <label htmlFor='auth-email' className='block text-[11px] font-semibold text-zinc-300'>
              Email
            </label>
            <InputGroup className='h-8.5'>
              <InputGroupAddon>
                <MailIcon className='size-3.5 text-zinc-400' />
              </InputGroupAddon>
              <InputGroupInput
                id='auth-email'
                type='email'
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder='yourmail@gmail.com'
                className='text-xs sm:text-sm'
              />
            </InputGroup>
          </div>

          {mode !== 'forgot' && (
            <div className='space-y-0.5'>
              <div className='flex items-center justify-between'>
                <label htmlFor='auth-password' className='block text-[11px] font-semibold text-zinc-300'>
                  Password
                </label>
                {mode === 'login' && (
                  <button
                    type='button'
                    onClick={() => {
                      setMode('forgot');
                      setError(null);
                      setInfo(null);
                    }}
                    className='text-[11px] font-semibold text-amber-400 hover:text-amber-300 hover:underline cursor-pointer'
                  >
                    {isId ? 'Lupa Password?' : 'Forgot Password?'}
                  </button>
                )}
              </div>
              <InputGroup className='h-8.5'>
                <InputGroupAddon>
                  <Lock className='size-3.5 text-zinc-400' />
                </InputGroupAddon>
                <InputGroupInput
                  id='auth-password'
                  type='password'
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder='Password'
                  className='text-xs sm:text-sm'
                />
              </InputGroup>
            </div>
          )}

          {mode === 'forgot' && (
            <div className='flex justify-end'>
              <button
                type='button'
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className='text-xs font-semibold text-amber-400 hover:underline cursor-pointer'
              >
                {isId ? 'Kembali ke Masuk' : 'Back to Sign In'}
              </button>
            </div>
          )}

          <Button
            type='submit'
            disabled={loading}
            className='w-full h-9 gap-2 text-xs sm:text-sm font-extrabold neu-btn-blue shadow-sm'
          >
            <span>
              {mode === 'login'
                ? isId
                  ? 'Masuk'
                  : 'Sign In'
                : mode === 'register'
                  ? isId
                    ? 'Buat Akun'
                    : 'Create Account'
                  : isId
                    ? 'Kirim Tautan Reset'
                    : 'Send Reset Link'}
            </span>
            <ArrowRightIcon className='size-3.5' />
          </Button>
        </form>

        {/* Instant Guest Access with Liquid Metal Animated Border Button */}
        <div className='pt-2 border-t border-white/10 space-y-2'>
          <div className='flex items-center justify-between'>
            <span className='text-[11px] font-bold text-zinc-400'>
              {isId ? 'Akses Cepat Tamu' : 'Quick Guest Access'}
            </span>
            <span className='text-[10px] font-bold text-amber-400 tracking-wide'>
              {isId ? 'Langsung Main' : 'Instant Play'}
            </span>
          </div>
          <div className='flex items-center gap-2'>
            <InputGroup className='flex-1 h-10'>
              <InputGroupInput
                type='text'
                aria-label='Guest nickname'
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder='Guest nickname'
                maxLength={20}
                className='text-xs'
              />
            </InputGroup>
            <LiquidMetalButton
              label={isId ? 'Masuk Tamu' : 'Guest Login'}
              width={138}
              height={40}
              disabled={loading}
              onClick={() => void handleGuest()}
              testId='guest-login-btn'
              dataStart
              icon={<ArrowRightIcon className='size-3.5' />}
            />
          </div>
        </div>
      </div>
    </Waitlist04>
  );
};
