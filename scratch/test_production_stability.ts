import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { Server as SocketIOServer } from 'socket.io';
import { io as createClient, type Socket } from 'socket.io-client';
import { runAtomicPublishLifecycle } from '../apps/desktop/src/renderer/src/services/publishLifecycle';

process.env.NODE_ENV = 'test';

function emitWithAck<T>(socket: Socket, event: string, payload: unknown): Promise<T> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

async function connect(url: string): Promise<Socket> {
  const socket = createClient(url, { transports: ['websocket'], reconnection: false });
  if (!socket.connected) await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

async function main(): Promise<void> {
  const { resolveSessionSecret } = await import('../apps/backend/src/auth/session');
  assert.throws(() => resolveSessionSecret('production', undefined), /required in production/);
  assert.match(resolveSessionSecret('development', undefined), /development-only|tellas-dev-secret/);
  assert.equal(resolveSessionSecret('production', 'configured-test-secret'), 'configured-test-secret');
  const productionImport = spawnSync(process.execPath, [
    '--import',
    'tsx',
    '-e',
    `process.env.NODE_ENV='production'; delete process.env.TELLAS_SESSION_SECRET; import('${new URL('../apps/backend/src/auth/session.ts', import.meta.url).href}')`,
  ], { cwd: process.cwd(), encoding: 'utf8' });
  assert.notEqual(productionImport.status, 0);
  assert.match(`${productionImport.stderr}${productionImport.stdout}`, /TELLAS_SESSION_SECRET is required in production/);
  console.log('PASS I/J | production secret fails fast; development fallback remains explicit');

  let publishCalls = 0;
  await assert.rejects(() => runAtomicPublishLifecycle({
    reserve: async () => ({ success: false, code: 'ROOM_NOT_FOUND', error: 'Sala não encontrada' }),
    publish: async () => { publishCalls++; },
    confirm: async () => ({ success: true }),
    rollbackPublish: async () => undefined,
    releaseReservation: async () => ({ success: true }),
  }), /Sala não encontrada/);
  assert.equal(publishCalls, 0);
  console.log('PASS B | rejected reservation never calls Cloudflare publish');

  let releasedAfterPublishFailure = 0;
  let rolledBackAfterPublishFailure = 0;
  await assert.rejects(() => runAtomicPublishLifecycle({
    reserve: async () => ({ success: true }),
    publish: async () => { throw new Error('publish failed'); },
    confirm: async () => ({ success: true }),
    rollbackPublish: async () => { rolledBackAfterPublishFailure++; },
    releaseReservation: async () => { releasedAfterPublishFailure++; return { success: true }; },
  }), /publish failed/);
  assert.equal(rolledBackAfterPublishFailure, 1);
  assert.equal(releasedAfterPublishFailure, 1);
  console.log('PASS D | publish failure rolls back safely and releases reservation');

  let rollbackAfterConfirmFailure = 0;
  let releaseAfterConfirmFailure = 0;
  await assert.rejects(() => runAtomicPublishLifecycle({
    reserve: async () => ({ success: true }),
    publish: async () => undefined,
    confirm: async () => ({ success: false, code: 'ROOM_NOT_FOUND', error: 'Sala não encontrada' }),
    rollbackPublish: async () => { rollbackAfterConfirmFailure++; },
    releaseReservation: async () => { releaseAfterConfirmFailure++; return { success: true }; },
  }), /Sala não encontrada/);
  assert.equal(rollbackAfterConfirmFailure, 1);
  assert.equal(releaseAfterConfirmFailure, 1);
  console.log('PASS E | confirm failure stops publication and releases reservation');

  const { getRoom, resetRoomStore, setupSignaling, MAX_PUBLISHERS_PER_ROOM } = await import('../apps/backend/src/socket/signaling');
  const { cloudflareSessionRegistry } = await import('../apps/backend/src/media/cloudflareSessionRegistry');
  resetRoomStore();
  const server = createServer();
  const io = new SocketIOServer(server);
  setupSignaling(io);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const url = `http://127.0.0.1:${address.port}`;
  const sockets: Socket[] = [];

  try {
    const host = await connect(url);
    sockets.push(host);
    const created = await emitWithAck<any>(host, 'create-room', { identity: 'Host' });
    assert.equal(created.success, true);

    const firstReservation = await emitWithAck<any>(host, 'reserve-stream', { roomId: created.roomId });
    assert.equal(firstReservation.success, true);
    assert.equal(getRoom(created.roomId)?.reservedPublishers.has(created.participantId), true);
    console.log('PASS A | valid room reserves publisher');

    await emitWithAck(host, 'release-stream-reservation', { roomId: created.roomId });
    const missing = await emitWithAck<any>(host, 'reserve-stream', { roomId: 'ZZZZZZ' });
    assert.equal(missing.code, 'ROOM_NOT_FOUND');

    const participants = [{ socket: host, participantId: created.participantId }];
    for (let index = 1; index < MAX_PUBLISHERS_PER_ROOM + 1; index++) {
      const client = await connect(url);
      sockets.push(client);
      const joined = await emitWithAck<any>(client, 'join-room', { roomId: created.roomId, identity: `Guest ${index}` });
      assert.equal(joined.success, true);
      participants.push({ socket: client, participantId: joined.participantId });
    }

    const concurrent = await Promise.all(participants.map(({ socket }) =>
      emitWithAck<any>(socket, 'reserve-stream', { roomId: created.roomId })));
    assert.equal(concurrent.filter((response) => response.success).length, MAX_PUBLISHERS_PER_ROOM);
    assert.equal(concurrent.filter((response) => response.code === 'PUBLISHER_LIMIT_REACHED').length, 1);
    assert.equal(getRoom(created.roomId)?.reservedPublishers.size, MAX_PUBLISHERS_PER_ROOM);
    console.log('PASS C/G | active + reserved limit is atomic for concurrent requests');

    await Promise.all(participants.map(({ socket }) =>
      emitWithAck(socket, 'release-stream-reservation', { roomId: created.roomId })));

    let announced: any = null;
    participants[1].socket.once('stream-started', (payload) => { announced = payload; });
    const reserved = await emitWithAck<any>(host, 'reserve-stream', { roomId: created.roomId });
    assert.equal(reserved.success, true);
    cloudflareSessionRegistry.setSession({
      participantId: created.participantId,
      roomId: created.roomId,
      cloudflareSessionId: 'test-session',
      createdAt: Date.now(),
    });
    cloudflareSessionRegistry.setStream({
      participantId: created.participantId,
      roomId: created.roomId,
      cloudflareSessionId: 'test-session',
      videoTrackId: 'test-video',
      videoMid: '0',
      audioTrackId: null,
      audioMid: null,
    });
    const confirmed = await emitWithAck<any>(host, 'confirm-stream', { roomId: created.roomId });
    assert.equal(confirmed.success, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(announced?.participantId, created.participantId);
    assert.equal(getRoom(created.roomId)?.activeStreamers.has(created.participantId), true);
    console.log('PASS F | reserve + publish registry + confirm announces stream');

    const disconnecting = participants[2];
    const disconnectReservation = await emitWithAck<any>(disconnecting.socket, 'reserve-stream', { roomId: created.roomId });
    assert.equal(disconnectReservation.success, true);
    disconnecting.socket.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(getRoom(created.roomId)?.reservedPublishers.has(disconnecting.participantId), false);
    console.log('PASS H | disconnect clears pending reservation');
  } finally {
    for (const socket of sockets) socket.disconnect();
    resetRoomStore();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  }
}

main().catch((error) => {
  console.error('PRODUCTION STABILITY TEST FAILED', error);
  process.exitCode = 1;
});
