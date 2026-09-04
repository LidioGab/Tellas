import React from 'react';
import { Eye } from 'lucide-react';
import type { StreamViewerInfo } from '@stream-app/shared';

interface ViewerPresenceProps {
  viewers: StreamViewerInfo[];
  compact?: boolean;
}

export const ViewerPresence: React.FC<ViewerPresenceProps> = ({ viewers, compact = false }) => {
  if (viewers.length === 0) return null;
  const names = viewers.map((viewer) => viewer.identity).join(', ');

  return (
    <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[#B2B8C3]" title={`Assistindo: ${names}`}>
      <div className="flex -space-x-1">
        {viewers.slice(0, 3).map((viewer) => (
          <span key={viewer.participantId} className="flex h-5 w-5 items-center justify-center rounded-full border border-[#101217] bg-[#2A303A] text-[9px] font-semibold uppercase text-[#EDEFF3]">
            {viewer.identity.charAt(0) || '?'}
          </span>
        ))}
      </div>
      <span className="flex shrink-0 items-center gap-1">
        <Eye className="h-3 w-3" />
        {compact ? viewers.length : `${viewers.length} assistindo`}
      </span>
    </div>
  );
};
