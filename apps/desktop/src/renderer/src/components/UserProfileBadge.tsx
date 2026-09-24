import React, { useState } from 'react';
import { LogOut, ChevronDown, UserPlus, LogIn, ShieldCheck, Settings } from 'lucide-react';
import type { UserProfile } from '@stream-app/shared';

interface UserProfileBadgeProps {
  user: UserProfile | null;
  onOpenAuth: (mode: 'login' | 'register') => void;
  onLogout: () => void;
  onOpenSettings: () => void;
}

export const UserProfileBadge: React.FC<UserProfileBadgeProps> = ({
  user,
  onOpenAuth,
  onLogout,
  onOpenSettings,
}) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  if (!user) {
    return (
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onOpenAuth('login')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] text-[#9DA5B4] hover:text-[#F4F6F8] transition text-xs font-medium"
        >
          <LogIn className="w-3 h-3" />
          <span>Entrar</span>
        </button>
        <button
          onClick={() => onOpenAuth('register')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#5B7CFA] hover:bg-[#6C89FF] active:bg-[#4F70EB] text-white shadow-cta transition text-xs font-medium"
        >
          <UserPlus className="w-3 h-3" />
          <span>Criar Conta</span>
        </button>
      </div>
    );
  }

  const avatar =
    user.avatarUrl ||
    `https://api.dicebear.com/7.x/bottts/svg?seed=${encodeURIComponent(user.username)}`;

  return (
    <div className="relative">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="flex items-center gap-2 px-2 py-1 rounded-md bg-[#16191F] hover:bg-[#1D2129] border border-[#252A34] transition"
      >
        <div className="w-5 h-5 rounded-full overflow-hidden border border-[#252A34] bg-[#101217] flex items-center justify-center shrink-0">
          <img src={avatar} alt={user.username} className="h-full w-full object-cover" />
        </div>
        <span className="hidden sm:block text-xs font-medium text-[#F4F6F8] max-w-[110px] truncate">{user.username}</span>
        <ChevronDown className="w-3 h-3 text-[#687180]" />
      </button>

      {/* Dropdown menu */}
      {dropdownOpen && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
          <div className="absolute right-0 mt-1.5 z-50 w-52 rounded-xl bg-[#16191F] border border-[#252A34] p-2 shadow-2xl animate-in zoom-in-95 duration-100">
            <div className="px-2.5 py-2 border-b border-[#1D2129] mb-1">
              <div className="flex items-center gap-1.5">
                <p className="text-xs font-semibold text-[#F4F6F8] truncate">{user.username}</p>
                <ShieldCheck className="w-3 h-3 text-[#34D399]" />
              </div>
            </div>

            <button onClick={() => { setDropdownOpen(false); onOpenSettings(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#C8CDD5] hover:bg-[#1D2129] transition-colors font-medium"><Settings className="w-3.5 h-3.5" />Configurações</button>

            <button
              onClick={() => {
                setDropdownOpen(false);
                onLogout();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs text-[#F87171] hover:bg-[#F87171]/10 transition-colors font-medium"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sair da Conta
            </button>
          </div>
        </>
      )}
    </div>
  );
};
