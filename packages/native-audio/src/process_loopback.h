#pragma once

#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audioclientactivationparams.h>
#include <wrl/client.h>
#include <wrl/implements.h>
#include <thread>
#include <atomic>
#include <functional>
#include <vector>
#include <string>
#include <memory>

using Microsoft::WRL::ComPtr;
using Microsoft::WRL::RuntimeClass;
using Microsoft::WRL::RuntimeClassFlags;
using Microsoft::WRL::ClassicCom;
using Microsoft::WRL::FtmBase;

typedef std::function<void(const float* pcmData, size_t sampleCount)> AudioDataCallback;
typedef std::function<void(const std::string& errorMessage)> AudioErrorCallback;
typedef std::function<void(const std::string& category, const std::string& message)> AudioDiagnosticCallback;

class ProcessLoopbackCapture {
public:
    ProcessLoopbackCapture();
    ~ProcessLoopbackCapture();

    // Starts capture excluding the specified process tree PID
    // targetProcessId: PID of the root process to exclude (e.g. Discord parent PID)
    bool Start(DWORD targetProcessId, AudioDataCallback onData, AudioErrorCallback onError);
    void Stop();
    bool IsCapturing() const { return m_isCapturing.load(); }

    void SetDiagnosticCallback(AudioDiagnosticCallback diagCb) { m_onDiagnostic = diagCb; }

    static bool IsOfficiallySupported();
    static bool IsProbeEligible();
    static bool CanAttemptProcessLoopback();
    static bool IsSupported();

private:
    void CaptureThreadFunc();
    void Cleanup();
    void EmitDiagnostic(const std::string& category, const std::string& message);

    std::atomic<bool> m_isCapturing{ false };
    std::thread m_captureThread;
    HANDLE m_hStopEvent = NULL;
    HANDLE m_hAudioSampleReadyEvent = NULL;

    DWORD m_targetProcessId = 0;
    AudioDataCallback m_onData;
    AudioErrorCallback m_onError;
    AudioDiagnosticCallback m_onDiagnostic;

    ComPtr<IAudioClient> m_audioClient;
    ComPtr<IAudioCaptureClient> m_captureClient;
    WAVEFORMATEX* m_pwfx = nullptr;
};
