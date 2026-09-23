export type PublishAuthorizationMode = 'initial' | 'recovery';

export interface PublishAuthorizationState {
  hasReservation: boolean;
  isActiveStreamer: boolean;
  hasRegisteredStream: boolean;
}

/**
 * Initial publishing requires a short-lived reservation. A confirmed publisher
 * may replace a lost Cloudflare session without acquiring a second reservation,
 * but only after the previous media registry entry has been removed.
 */
export function resolvePublishAuthorization(state: PublishAuthorizationState): PublishAuthorizationMode | null {
  if (state.hasReservation) return 'initial';
  if (state.isActiveStreamer && !state.hasRegisteredStream) return 'recovery';
  return null;
}
