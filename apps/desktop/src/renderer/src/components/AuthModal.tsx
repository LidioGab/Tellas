import React, { useState, useMemo } from 'react';
import {
  X,
  User,
  Mail,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Sparkles,
  RefreshCw,
  ShieldCheck,
  ArrowRight,
  Loader2,
} from 'lucide-react';
import { clientAuthService } from '../services/authService';
import type { UserProfile } from '@stream-app/shared';
import { TellasLogo } from './TellasLogo';

interface AuthFormProps {
  initialMode?: 'login' | 'register';
  onSuccess?: (user: UserProfile) => void;
  onClose?: () => void;
  isModal?: boolean;
}

const AVATAR_STYLES = ['bottts', 'adventurer', 'fun-emoji', 'thumbs', 'lorelei'];

export const AuthForm: React.FC<AuthFormProps> = ({
  initialMode = 'login',
  onSuccess,
  onClose,
  isModal = false,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [emailOrUsername, setEmailOrUsername] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Avatar generator seed
  const [avatarSeed, setAvatarSeed] = useState(() => Math.random().toString(36).substring(2, 8));
  const [avatarStyle, setAvatarStyle] = useState('bottts');

  const avatarUrl = useMemo(() => {
    const seed = username.trim() || avatarSeed;
    return `https://api.dicebear.com/7.x/${avatarStyle}/svg?seed=${encodeURIComponent(seed)}`;
  }, [avatarStyle, avatarSeed, username]);

  const randomizeAvatar = () => {
    const randomStyle = AVATAR_STYLES[Math.floor(Math.random() * AVATAR_STYLES.length)];
    setAvatarStyle(randomStyle);
    setAvatarSeed(Math.random().toString(36).substring(2, 9));
  };

  // Password strength checks
  const passwordChecks = useMemo(() => {
    return {
      length: password.length >= 8,
      upper: /[A-Z]/.test(password),
      lower: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: /[^a-zA-Z0-9]/.test(password),
      match: mode === 'register' ? password.length > 0 && password === confirmPassword : true,
    };
  }, [password, confirmPassword, mode]);

  const passwordScore = useMemo(() => {
    let score = 0;
    if (passwordChecks.length) score += 20;
    if (passwordChecks.upper) score += 20;
    if (passwordChecks.lower) score += 20;
    if (passwordChecks.number) score += 20;
    if (passwordChecks.special) score += 20;
    return score;
  }, [passwordChecks]);

  const getScoreColor = () => {
    if (passwordScore <= 40) return 'bg-[#F87171]';
    if (passwordScore <= 80) return 'bg-[#FBBF24]';
    return 'bg-[#34D399]';
  };

  const getScoreLabel = () => {
    if (password.length === 0) return '';
    if (passwordScore <= 40) return 'Fraca';
    if (passwordScore <= 80) return 'Média';
    return 'Forte';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      if (mode === 'register') {
        if (!passwordChecks.match) {
          throw new Error('As senhas digitadas não coincidem.');
        }
        if (passwordScore < 80) {
          throw new Error('Por favor, crie uma senha mais forte atendendo aos requisitos.');
        }

        const res = await clientAuthService.register({
          username: username.trim(),
          email: email.trim(),
          password,
          avatarUrl,
        });

        if (onSuccess) onSuccess(res.user);
        if (onClose) onClose();
      } else {
        const res = await clientAuthService.login({
          emailOrUsername: emailOrUsername.trim(),
          password,
        });

        if (onSuccess) onSuccess(res.user);
        if (onClose) onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Ocorreu um erro ao processar sua solicitação.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`w-full max-w-sm bg-[#16191F] p-7 rounded-xl border border-[#252A34] shadow-card space-y-5 ${isModal ? 'relative' : ''}`}>
      {isModal && onClose && (
        <button
          onClick={onClose}
          className="absolute top-4 right-4 rounded-lg p-1.5 text-[#687180] hover:bg-[#1D2129] hover:text-[#F4F6F8] transition"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      {/* Header Icon & Title */}
      <div className="text-center space-y-2">
        <div className="flex justify-center mb-1">
          <TellasLogo className="w-12 h-12" glow />
        </div>
        <h1 className="text-xl font-bold text-[#F4F6F8] tracking-tight">Tellas</h1>
        <p className="text-xs text-[#9DA5B4]">
          {mode === 'login'
            ? 'Entre na sua conta para criar ou acessar salas de transmissão.'
            : 'Crie sua conta para iniciar transmissões com áudio isolado.'}
        </p>
      </div>

      {/* Mode Switcher Tabs */}
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#101217] p-1 border border-[#252A34]">
        <button
          type="button"
          onClick={() => {
            setMode('login');
            setErrorMessage(null);
          }}
          className={`rounded-md py-1.5 text-xs font-semibold transition ${
            mode === 'login'
              ? 'bg-[#5B7CFA] text-white shadow-cta'
              : 'text-[#9DA5B4] hover:text-[#F4F6F8]'
          }`}
        >
          Entrar
        </button>
        <button
          type="button"
          onClick={() => {
            setMode('register');
            setErrorMessage(null);
          }}
          className={`rounded-md py-1.5 text-xs font-semibold transition ${
            mode === 'register'
              ? 'bg-[#5B7CFA] text-white shadow-cta'
              : 'text-[#9DA5B4] hover:text-[#F4F6F8]'
          }`}
        >
          Criar Conta
        </button>
      </div>

      {/* Error Alert */}
      {errorMessage && (
        <div className="flex items-start gap-2.5 rounded-lg border border-[#F87171]/20 bg-[#F87171]/10 p-2.5 text-xs text-[#F87171]">
          <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-[#F87171]" />
          <div className="flex-1 leading-relaxed">{errorMessage}</div>
        </div>
      )}

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-3.5">
        {mode === 'register' ? (
          <>
            {/* Avatar Preview */}
            <div className="flex items-center gap-2.5 rounded-lg border border-[#252A34] bg-[#101217] p-2.5">
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-full border border-[#252A34] bg-[#16191F]">
                <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#687180] flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-[#5B7CFA]" /> Avatar Gerado
                </span>
                <p className="text-[10px] text-[#505764] truncate">Baseado no seu usuário</p>
              </div>
              <button
                type="button"
                onClick={randomizeAvatar}
                title="Aleatorizar estilo"
                className="flex items-center justify-center rounded-md border border-[#252A34] bg-[#16191F] p-1.5 text-[#9DA5B4] hover:bg-[#1D2129] hover:text-[#F4F6F8] transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Username */}
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                Nome de Usuário
              </label>
              <div className="relative flex items-center">
                <User className="absolute left-3 w-3.5 h-3.5 text-[#687180]" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ex: gabriel"
                  maxLength={30}
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] text-xs placeholder:text-[#505764] focus:outline-none focus:border-[#5B7CFA] border border-[#252A34] transition"
                />
              </div>
            </div>

            {/* Email */}
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                E-mail
              </label>
              <div className="relative flex items-center">
                <Mail className="absolute left-3 w-3.5 h-3.5 text-[#687180]" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="seu.email@exemplo.com"
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] text-xs placeholder:text-[#505764] focus:outline-none focus:border-[#5B7CFA] border border-[#252A34] transition"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                  Senha
                </label>
                {getScoreLabel() && (
                  <span className="text-[10px] font-medium text-[#9DA5B4]">
                    Força: <span className={passwordScore >= 80 ? 'text-[#34D399]' : 'text-[#FBBF24]'}>{getScoreLabel()}</span>
                  </span>
                )}
              </div>
              <div className="relative flex items-center">
                <Lock className="absolute left-3 w-3.5 h-3.5 text-[#687180]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  className="w-full pl-8 pr-9 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] text-xs placeholder:text-[#505764] focus:outline-none focus:border-[#5B7CFA] border border-[#252A34] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 text-[#687180] hover:text-[#F4F6F8]"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>

              {/* Password checks */}
              {password.length > 0 && (
                <div className="pt-1 space-y-1">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-[#101217] border border-[#252A34]">
                    <div
                      className={`h-full transition-all duration-300 ${getScoreColor()}`}
                      style={{ width: `${passwordScore}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-0.5 text-[10px] text-[#687180]">
                    <span className={`flex items-center gap-1 ${passwordChecks.length ? 'text-[#34D399]' : 'text-[#687180]'}`}>
                      {passwordChecks.length ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />} 8+ caracteres
                    </span>
                    <span className={`flex items-center gap-1 ${passwordChecks.upper ? 'text-[#34D399]' : 'text-[#687180]'}`}>
                      {passwordChecks.upper ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />} Maiúscula
                    </span>
                    <span className={`flex items-center gap-1 ${passwordChecks.number ? 'text-[#34D399]' : 'text-[#687180]'}`}>
                      {passwordChecks.number ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />} Número
                    </span>
                    <span className={`flex items-center gap-1 ${passwordChecks.special ? 'text-[#34D399]' : 'text-[#687180]'}`}>
                      {passwordChecks.special ? <CheckCircle2 className="w-2.5 h-2.5" /> : <XCircle className="w-2.5 h-2.5" />} Símbolo (!@#$)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                Confirmar Senha
              </label>
              <div className="relative flex items-center">
                <Lock className="absolute left-3 w-3.5 h-3.5 text-[#687180]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repita sua senha"
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] text-xs placeholder:text-[#505764] focus:outline-none focus:border-[#5B7CFA] border border-[#252A34] transition"
                />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Login Username/Email */}
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                E-mail ou Usuário
              </label>
              <div className="relative flex items-center">
                <User className="absolute left-3 w-3.5 h-3.5 text-[#687180]" />
                <input
                  type="text"
                  required
                  value={emailOrUsername}
                  onChange={(e) => setEmailOrUsername(e.target.value)}
                  placeholder="seu.email@exemplo.com ou usuário"
                  className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] text-xs placeholder:text-[#505764] focus:outline-none focus:border-[#5B7CFA] border border-[#252A34] transition"
                />
              </div>
            </div>

            {/* Login Password */}
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-[#687180]">
                Senha
              </label>
              <div className="relative flex items-center">
                <Lock className="absolute left-3 w-3.5 h-3.5 text-[#687180]" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Digite sua senha"
                  className="w-full pl-8 pr-9 py-2 rounded-lg bg-[#101217] text-[#F4F6F8] text-xs placeholder:text-[#505764] focus:outline-none focus:border-[#5B7CFA] border border-[#252A34] transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 text-[#687180] hover:text-[#F4F6F8]"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </>
        )}

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2.5 px-4 rounded-lg bg-[#5B7CFA] hover:bg-[#6C89FF] active:bg-[#4F70EB] font-medium text-white text-xs shadow-cta flex items-center justify-center gap-1.5 transition transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 mt-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Processando...
            </>
          ) : mode === 'register' ? (
            <>
              Criar Minha Conta <ArrowRight className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              Entrar no Tellas <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </form>

      {/* Footer Security Badge */}
      <div className="pt-2 border-t border-[#1D2129] flex items-center justify-center gap-1.5 text-[10px] text-[#687180]">
        <ShieldCheck className="w-3 h-3 text-[#34D399]" />
        <span>Senha protegida com hash Bcrypt</span>
      </div>
    </div>
  );
};

export const AuthModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (user: UserProfile) => void;
  initialMode?: 'login' | 'register';
}> = ({ isOpen, onClose, onSuccess, initialMode = 'login' }) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <AuthForm
        initialMode={initialMode}
        onSuccess={onSuccess}
        onClose={onClose}
        isModal={true}
      />
    </div>
  );
};
