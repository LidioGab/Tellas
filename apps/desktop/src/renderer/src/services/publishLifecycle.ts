export interface PublishCommandResponse {
  success: boolean;
  code?: string;
  error?: string;
}

export interface AtomicPublishOperations {
  reserve(): Promise<PublishCommandResponse>;
  publish(): Promise<void>;
  confirm(): Promise<PublishCommandResponse>;
  rollbackPublish(): Promise<void>;
  releaseReservation(): Promise<PublishCommandResponse>;
  onCleanupError?(operation: 'rollback-publish' | 'release-reservation', error: unknown): void;
}

export function publishCommandError(response: PublishCommandResponse): Error & { code?: string } {
  return Object.assign(new Error(response.error || 'Operação de transmissão rejeitada.'), { code: response.code });
}

export async function runAtomicPublishLifecycle(operations: AtomicPublishOperations): Promise<void> {
  let reserved = false;
  let publishAttempted = false;
  try {
    const reservation = await operations.reserve();
    if (!reservation.success) throw publishCommandError(reservation);
    reserved = true;

    publishAttempted = true;
    await operations.publish();

    const confirmation = await operations.confirm();
    if (!confirmation.success) throw publishCommandError(confirmation);
    reserved = false; // Confirmation consumes the reservation server-side.
  } catch (error) {
    if (publishAttempted) {
      await operations.rollbackPublish().catch((cleanupError) => {
        operations.onCleanupError?.('rollback-publish', cleanupError);
      });
    }
    if (reserved) {
      await operations.releaseReservation().catch((cleanupError) => {
        operations.onCleanupError?.('release-reservation', cleanupError);
      });
    }
    throw error;
  }
}
