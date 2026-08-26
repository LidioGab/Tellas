#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <vector>
#include <cmath>
#include <algorithm>
#include <cstdint>
#include <windows.h>
#include <mmreg.h>

/**
 * AudioResampler & Normalizer
 * Converts any incoming WASAPI audio format to:
 * - 48,000 Hz sample rate
 * - 2 channels (Stereo interleaved: L, R, L, R...)
 * - Float32Array range [-1.0, 1.0]
 */
class AudioResampler {
public:
    static void ConvertAndResample(
        const BYTE* inputBuffer,
        UINT32 inputFrames,
        const WAVEFORMATEX* pwfx,
        std::vector<float>& outputStereo48k
    ) {
        if (!inputBuffer || inputFrames == 0 || !pwfx) {
            return;
        }

        const UINT32 inSampleRate = pwfx->nSamplesPerSec;
        const WORD inChannels = pwfx->nChannels;
        const WORD inBits = pwfx->wBitsPerSample;

        bool isFloat = false;
        if (pwfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT) {
            isFloat = true;
        } else if (pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
            const WAVEFORMATEXTENSIBLE* pExt = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(pwfx);
            if (IsEqualGUID(pExt->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
                isFloat = true;
            }
        }

        // Step 1: Decode incoming samples to standard Float32 intermediate buffer
        std::vector<float> decodedStereo;
        decodedStereo.reserve(inputFrames * 2);

        for (UINT32 i = 0; i < inputFrames; ++i) {
            float left = 0.0f;
            float right = 0.0f;

            if (isFloat && inBits == 32) {
                const float* floatPtr = reinterpret_cast<const float*>(inputBuffer + (i * pwfx->nBlockAlign));
                if (inChannels == 1) {
                    left = right = floatPtr[0];
                } else if (inChannels == 2) {
                    left = floatPtr[0];
                    right = floatPtr[1];
                } else {
                    // Multi-channel downmix (5.1/7.1): L = FL + 0.707*C + 0.707*SL, R = FR + 0.707*C + 0.707*SR
                    left = floatPtr[0] + 0.707f * floatPtr[2] + 0.707f * floatPtr[4];
                    right = floatPtr[1] + 0.707f * floatPtr[2] + 0.707f * floatPtr[5];
                }
            } else if (!isFloat && inBits == 16) {
                const int16_t* int16Ptr = reinterpret_cast<const int16_t*>(inputBuffer + (i * pwfx->nBlockAlign));
                if (inChannels == 1) {
                    left = right = int16Ptr[0] / 32768.0f;
                } else if (inChannels == 2) {
                    left = int16Ptr[0] / 32768.0f;
                    right = int16Ptr[1] / 32768.0f;
                } else {
                    left = (int16Ptr[0] + 0.707f * int16Ptr[2] + 0.707f * int16Ptr[4]) / 32768.0f;
                    right = (int16Ptr[1] + 0.707f * int16Ptr[2] + 0.707f * int16Ptr[5]) / 32768.0f;
                }
            } else if (!isFloat && inBits == 24) {
                const uint8_t* bytePtr = inputBuffer + (i * pwfx->nBlockAlign);
                auto readInt24 = [](const uint8_t* p) -> float {
                    int32_t val = (p[0] << 8) | (p[1] << 16) | (p[2] << 24);
                    return val / 2147483648.0f;
                };

                if (inChannels == 1) {
                    left = right = readInt24(bytePtr);
                } else {
                    left = readInt24(bytePtr);
                    right = readInt24(bytePtr + 3);
                }
            } else {
                // Fallback default
                left = 0.0f;
                right = 0.0f;
            }

            // Clamp to [-1.0, 1.0]
            left = std::clamp(left, -1.0f, 1.0f);
            right = std::clamp(right, -1.0f, 1.0f);

            decodedStereo.push_back(left);
            decodedStereo.push_back(right);
        }

        // Step 2: Resample to 48,000 Hz if necessary
        const UINT32 targetSampleRate = 48000;
        if (inSampleRate == targetSampleRate) {
            outputStereo48k = std::move(decodedStereo);
            return;
        }

        // Linear interpolation resampling
        const double resampleRatio = static_cast<double>(targetSampleRate) / static_cast<double>(inSampleRate);
        const UINT32 outputFrames = static_cast<UINT32>(std::floor(inputFrames * resampleRatio));
        outputStereo48k.clear();
        outputStereo48k.resize(outputFrames * 2);

        for (UINT32 outIdx = 0; outIdx < outputFrames; ++outIdx) {
            const double inPos = outIdx / resampleRatio;
            const UINT32 inIdx0 = static_cast<UINT32>(std::floor(inPos));
            const UINT32 inIdx1 = (std::min)(inIdx0 + 1, inputFrames - 1);
            const float frac = static_cast<float>(inPos - inIdx0);

            const float l0 = decodedStereo[inIdx0 * 2];
            const float r0 = decodedStereo[inIdx0 * 2 + 1];
            const float l1 = decodedStereo[inIdx1 * 2];
            const float r1 = decodedStereo[inIdx1 * 2 + 1];

            outputStereo48k[outIdx * 2] = l0 + frac * (l1 - l0);
            outputStereo48k[outIdx * 2 + 1] = r0 + frac * (r1 - r0);
        }
    }
};
