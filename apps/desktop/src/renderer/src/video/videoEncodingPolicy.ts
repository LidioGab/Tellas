import type { VideoQualityPreset } from '@stream-app/shared';

export interface AppliedVideoEncoding {
  maxBitrate: number;
  maxFramerate: number;
  scaleResolutionDownBy: number;
  contentHint: 'detail' | 'motion';
  degradationPreference: 'maintain-resolution' | 'maintain-framerate';
}

export function buildVideoEncodingPolicy(preset: VideoQualityPreset): AppliedVideoEncoding {
  return {
    maxBitrate: preset.maxBitrate * 1000,
    maxFramerate: preset.frameRate,
    scaleResolutionDownBy: 1,
    contentHint: preset.contentMode,
    degradationPreference: preset.contentMode === 'motion' ? 'maintain-framerate' : 'maintain-resolution',
  };
}

export async function applyVideoEncodingPolicy(
  sender: RTCRtpSender,
  track: MediaStreamTrack,
  preset: VideoQualityPreset,
): Promise<AppliedVideoEncoding> {
  const policy = buildVideoEncodingPolicy(preset);
  track.contentHint = policy.contentHint;

  const parameters = sender.getParameters();
  if (!parameters.encodings?.length) parameters.encodings = [{}];
  parameters.encodings[0].maxBitrate = policy.maxBitrate;
  parameters.encodings[0].maxFramerate = policy.maxFramerate;
  parameters.encodings[0].scaleResolutionDownBy = policy.scaleResolutionDownBy;
  parameters.encodings[0].priority = 'high';
  parameters.degradationPreference = policy.degradationPreference;
  await sender.setParameters(parameters);
  return policy;
}
