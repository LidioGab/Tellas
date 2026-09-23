import assert from 'node:assert/strict';
import { resolvePublishAuthorization } from '../src/media/publishAuthorization';

assert.equal(resolvePublishAuthorization({
  hasReservation: true,
  isActiveStreamer: false,
  hasRegisteredStream: false,
}), 'initial');

assert.equal(resolvePublishAuthorization({
  hasReservation: false,
  isActiveStreamer: true,
  hasRegisteredStream: false,
}), 'recovery');

assert.equal(resolvePublishAuthorization({
  hasReservation: false,
  isActiveStreamer: true,
  hasRegisteredStream: true,
}), null, 'must not duplicate an already registered stream');

assert.equal(resolvePublishAuthorization({
  hasReservation: false,
  isActiveStreamer: false,
  hasRegisteredStream: false,
}), null, 'ordinary participants still require a reservation');

console.log('publish recovery authorization tests passed');
