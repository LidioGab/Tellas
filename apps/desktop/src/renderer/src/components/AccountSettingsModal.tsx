import React, { useEffect, useState } from 'react';
import { AtSign, Loader2, Lock, Mail, Save, ShieldCheck, User, X } from 'lucide-react';
import type { UserProfile } from '@stream-app/shared';
import { clientAuthService } from '../services/authService';

interface AccountSettingsModalProps {
  isOpen: boolean;
  user: UserProfile | null;
  onClose: () => void;
}

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({ isOpen, user, onClose }) => {
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !isOpen) return;
    setUsername(user.username);
    setAvatarUrl(user.avatarUrl || '');
    setCurrentPassword('');
    setNewPassword('');
    setMessage(null);
    setError(null);
  }, [isOpen, user]);

  if (!isOpen || !user) return null;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);
    try {
      await clientAuthService.updateProfile({
        username: username.trim(),
        avatarUrl: avatarUrl.trim(),
        ...(newPassword ? { currentPassword, newPassword } : {}),
      });
      if (newPassword) {
        await clientAuthService.logout();
        onClose();
        return;
      }
      setMessage('Perfil atualizado com sucesso.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível atualizar o perfil.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <form onSubmit={save} className="w-full max-w-md rounded-2xl border border-[#252A34] bg-[#16191F] p-5 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-[#F4F6F8]">Configurações da conta</h2>
            <p className="mt-1 text-xs text-[#687180]">Gerencie sua identidade e segurança no Tellas.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-[#687180] hover:bg-[#1D2129] hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        <div className="mb-5 flex items-center gap-3 rounded-xl border border-[#252A34] bg-[#101217] p-3">
          <img src={avatarUrl || `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(username)}`} alt={username} className="h-12 w-12 rounded-full border border-[#252A34] bg-[#16191F]" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5"><strong className="truncate text-sm text-[#F4F6F8]">{username}</strong><ShieldCheck className="h-3.5 w-3.5 text-[#34D399]" /></div>
            <div className="mt-1 flex items-center gap-1 text-xs text-[#687180]"><Mail className="h-3 w-3" />{user.email}</div>
          </div>
        </div>

        <div className="space-y-4">
          <label className="block space-y-1.5"><span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#687180]"><User className="h-3 w-3" />Nome de usuário</span><input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={30} required className="w-full rounded-lg border border-[#252A34] bg-[#101217] px-3 py-2 text-xs text-[#F4F6F8] outline-none focus:border-[#5B7CFA]" /></label>
          <label className="block space-y-1.5"><span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-[#687180]"><AtSign className="h-3 w-3" />Avatar</span><input value={avatarUrl} onChange={(e) => setAvatarUrl(e.target.value)} placeholder="https://..." className="w-full rounded-lg border border-[#252A34] bg-[#101217] px-3 py-2 text-xs text-[#F4F6F8] outline-none focus:border-[#5B7CFA]" /></label>

          <div className="border-t border-[#252A34] pt-4">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-[#F4F6F8]"><Lock className="h-3.5 w-3.5" />Alterar senha</p>
            <div className="grid gap-2 sm:grid-cols-2"><input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Senha atual" className="rounded-lg border border-[#252A34] bg-[#101217] px-3 py-2 text-xs text-[#F4F6F8] outline-none focus:border-[#5B7CFA]" /><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Nova senha" className="rounded-lg border border-[#252A34] bg-[#101217] px-3 py-2 text-xs text-[#F4F6F8] outline-none focus:border-[#5B7CFA]" /></div>
            <p className="mt-2 text-[10px] text-[#687180]">Ao trocar a senha, todas as sessões serão encerradas.</p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg border border-[#F87171]/30 bg-[#F87171]/10 px-3 py-2 text-xs text-[#F87171]">{error}</p>}
        {message && <p className="mt-4 rounded-lg border border-[#34D399]/30 bg-[#34D399]/10 px-3 py-2 text-xs text-[#34D399]">{message}</p>}

        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-[#9DA5B4] hover:bg-[#1D2129]">Cancelar</button><button disabled={loading} className="flex items-center gap-1.5 rounded-lg bg-[#5B7CFA] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Salvar alterações</button></div>
      </form>
    </div>
  );
};
