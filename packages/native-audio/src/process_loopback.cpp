#include "process_loopback.h"
#include "audio_resampler.h"
#include <audioclientactivationparams.h>
#include <avrt.h>
#include <iostream>
#include <iomanip>
#include <sstream>

using namespace Microsoft::WRL;

// Helper to format HRESULT as 0xXXXXXXXX
static std::string FormatHResultHex(HRESULT hr) {
    std::stringstream ss;
    ss << "0x" << std::uppercase << std::setfill('0') << std::setw(8) << std::hex << static_cast<unsigned long>(hr);
    return ss.str();
}

// Activation completion handler implementing IActivateAudioInterfaceCompletionHandler
class ActivateAudioInterfaceCompletionHandler :
    public RuntimeClass<RuntimeClassFlags<ClassicCom>, FtmBase, IActivateAudioInterfaceCompletionHandler>
{
public:
    ActivateAudioInterfaceCompletionHandler() : m_hCompleted(CreateEvent(nullptr, FALSE, FALSE, nullptr)) {}
    ~ActivateAudioInterfaceCompletionHandler() {
        if (m_hCompleted) {
            CloseHandle(m_hCompleted);
        }
    }

    STDMETHOD(ActivateCompleted)(IActivateAudioInterfaceAsyncOperation* pAsyncOp) override {
        m_asyncOp = pAsyncOp;
        SetEvent(m_hCompleted);
        return S_OK;
    }

    HRESULT GetActivateResult(ComPtr<IAudioClient>& audioClient) {
        if (WaitForSingleObject(m_hCompleted, 5000) != WAIT_OBJECT_0) {
            return HRESULT_FROM_WIN32(ERROR_TIMEOUT);
        }

        HRESULT hrActivate = S_OK;
        ComPtr<IUnknown> punkAudioInterface;
        HRESULT hr = m_asyncOp->GetActivateResult(&hrActivate, &punkAudioInterface);
        if (FAILED(hr)) return hr;
        if (FAILED(hrActivate)) return hrActivate;

        return punkAudioInterface.As(&audioClient);
    }

private:
    HANDLE m_hCompleted = NULL;
    ComPtr<IActivateAudioInterfaceAsyncOperation> m_asyncOp;
};

ProcessLoopbackCapture::ProcessLoopbackCapture() {
    m_hStopEvent = CreateEvent(nullptr, TRUE, FALSE, nullptr);
    m_hAudioSampleReadyEvent = CreateEvent(nullptr, FALSE, FALSE, nullptr);
}

ProcessLoopbackCapture::~ProcessLoopbackCapture() {
    Stop();
    if (m_hStopEvent) {
        CloseHandle(m_hStopEvent);
        m_hStopEvent = NULL;
    }
    if (m_hAudioSampleReadyEvent) {
        CloseHandle(m_hAudioSampleReadyEvent);
        m_hAudioSampleReadyEvent = NULL;
    }
}

bool ProcessLoopbackCapture::IsOfficiallySupported() {
    // Process loopback is officially supported starting in Windows 10 Build 20348 (Windows Server 2022) and Windows 11
    OSVERSIONINFOEX osvi = { sizeof(OSVERSIONINFOEX) };
    typedef LONG(WINAPI* RtlGetVersionPtr)(RTL_OSVERSIONINFOEXW*);
    HMODULE hNtdll = GetModuleHandleW(L"ntdll.dll");
    if (hNtdll) {
        RtlGetVersionPtr pRtlGetVersion = (RtlGetVersionPtr)GetProcAddress(hNtdll, "RtlGetVersion");
        if (pRtlGetVersion) {
            RTL_OSVERSIONINFOEXW rosvi = { 0 };
            rosvi.dwOSVersionInfoSize = sizeof(rosvi);
            if (pRtlGetVersion(&rosvi) == 0) {
                return (rosvi.dwMajorVersion > 10) || (rosvi.dwMajorVersion == 10 && rosvi.dwBuildNumber >= 20348);
            }
        }
    }
    return false;
}

bool ProcessLoopbackCapture::IsProbeEligible() {
    // Probe eligibility starts on Windows 10 2004 (Build 19041)
    OSVERSIONINFOEX osvi = { sizeof(OSVERSIONINFOEX) };
    typedef LONG(WINAPI* RtlGetVersionPtr)(RTL_OSVERSIONINFOEXW*);
    HMODULE hNtdll = GetModuleHandleW(L"ntdll.dll");
    if (hNtdll) {
        RtlGetVersionPtr pRtlGetVersion = (RtlGetVersionPtr)GetProcAddress(hNtdll, "RtlGetVersion");
        if (pRtlGetVersion) {
            RTL_OSVERSIONINFOEXW rosvi = { 0 };
            rosvi.dwOSVersionInfoSize = sizeof(rosvi);
            if (pRtlGetVersion(&rosvi) == 0) {
                return (rosvi.dwMajorVersion > 10) || (rosvi.dwMajorVersion == 10 && rosvi.dwBuildNumber >= 19041);
            }
        }
    }
    return false;
}

bool ProcessLoopbackCapture::CanAttemptProcessLoopback() {
    return IsProbeEligible();
}

bool ProcessLoopbackCapture::IsSupported() {
    return IsProbeEligible();
}

#include <chrono>
#include <cmath>
#include <sstream>
#include <iomanip>

void ProcessLoopbackCapture::EmitDiagnostic(const std::string& category, const std::string& message) {
    if (m_onDiagnostic) {
        m_onDiagnostic(category, message);
    }
}

bool ProcessLoopbackCapture::Start(DWORD targetProcessId, AudioDataCallback onData, AudioErrorCallback onError) {
    if (m_isCapturing.load()) {
        Stop();
    }

    m_targetProcessId = targetProcessId;
    m_onData = onData;
    m_onError = onError;
    ResetEvent(m_hStopEvent);

    // ─── Step 0: Diagnostic Kernel OS Query ───
    typedef LONG(WINAPI* RtlGetVersionPtr)(RTL_OSVERSIONINFOEXW*);
    HMODULE hNtdll = GetModuleHandleW(L"ntdll.dll");
    if (hNtdll) {
        RtlGetVersionPtr pRtlGetVersion = (RtlGetVersionPtr)GetProcAddress(hNtdll, "RtlGetVersion");
        if (pRtlGetVersion) {
            RTL_OSVERSIONINFOEXW rosvi = { 0 };
            rosvi.dwOSVersionInfoSize = sizeof(rosvi);
            if (pRtlGetVersion(&rosvi) == 0) {
                std::string osInfo = "nativeMajor=" + std::to_string(rosvi.dwMajorVersion) +
                                     "\nnativeMinor=" + std::to_string(rosvi.dwMinorVersion) +
                                     "\nnativeBuild=" + std::to_string(rosvi.dwBuildNumber) +
                                     "\nservicePack=" + std::to_string(rosvi.wServicePackMajor);
                EmitDiagnostic("OS", osInfo);
            }
        }
    }

    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool needCoUninit = SUCCEEDED(hr);

    // ─── Step 1: Obtain mix format from default physical render endpoint ───────
    ComPtr<IMMDeviceEnumerator> deviceEnumerator;
    hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator),
        nullptr,
        CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator),
        (void**)&deviceEnumerator
    );

    if (FAILED(hr) || !deviceEnumerator) {
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        EmitDiagnostic("ENDPOINT_ERROR", "CoCreateInstance(MMDeviceEnumerator) failed: " + hexHr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: CoCreateInstance(MMDeviceEnumerator)" << std::endl;
        if (m_onError) m_onError("CoCreateInstance(MMDeviceEnumerator) failed with HRESULT: " + hexHr);
        return false;
    }

    ComPtr<IMMDevice> defaultDevice;
    hr = deviceEnumerator->GetDefaultAudioEndpoint(eRender, eConsole, &defaultDevice);
    if (FAILED(hr) || !defaultDevice) {
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        EmitDiagnostic("ENDPOINT_ERROR", "GetDefaultAudioEndpoint failed: " + hexHr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: GetDefaultAudioEndpoint(eRender, eConsole)" << std::endl;
        if (m_onError) m_onError("GetDefaultAudioEndpoint failed with HRESULT: " + hexHr);
        return false;
    }

    ComPtr<IAudioClient> tempAudioClient;
    hr = defaultDevice->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&tempAudioClient);
    if (FAILED(hr) || !tempAudioClient) {
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        EmitDiagnostic("ENDPOINT_ERROR", "defaultDevice->Activate(IAudioClient) failed: " + hexHr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: defaultDevice->Activate(IAudioClient)" << std::endl;
        if (m_onError) m_onError("defaultDevice->Activate failed with HRESULT: " + hexHr);
        return false;
    }

    WAVEFORMATEX* pTempFormat = nullptr;
    hr = tempAudioClient->GetMixFormat(&pTempFormat);
    if (FAILED(hr) || !pTempFormat) {
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        EmitDiagnostic("ENDPOINT_ERROR", "tempAudioClient->GetMixFormat failed: " + hexHr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: tempAudioClient->GetMixFormat" << std::endl;
        if (m_onError) m_onError("GetMixFormat on default endpoint failed with HRESULT: " + hexHr);
        return false;
    }

    // Safely copy WAVEFORMATEX / WAVEFORMATEXTENSIBLE including cbSize
    size_t formatSize = sizeof(WAVEFORMATEX) + pTempFormat->cbSize;
    m_pwfx = (WAVEFORMATEX*)CoTaskMemAlloc(formatSize);
    if (!m_pwfx) {
        CoTaskMemFree(pTempFormat);
        if (needCoUninit) CoUninitialize();
        EmitDiagnostic("ENDPOINT_ERROR", "CoTaskMemAlloc for m_pwfx failed");
        std::cerr << "[NativeAudio] Step that failed: CoTaskMemAlloc for m_pwfx" << std::endl;
        if (m_onError) m_onError("Memory allocation failed for m_pwfx");
        return false;
    }
    std::memcpy(m_pwfx, pTempFormat, formatSize);

    std::string formatTagStr = (m_pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE) ? "WAVE_FORMAT_EXTENSIBLE" : (m_pwfx->wFormatTag == WAVE_FORMAT_IEEE_FLOAT ? "WAVE_FORMAT_IEEE_FLOAT" : "WAVE_FORMAT_PCM");
    std::string subFormatStr = "N/A";
    if (m_pwfx->wFormatTag == WAVE_FORMAT_EXTENSIBLE && m_pwfx->cbSize >= 22) {
        WAVEFORMATEXTENSIBLE* pExt = reinterpret_cast<WAVEFORMATEXTENSIBLE*>(m_pwfx);
        if (IsEqualGUID(pExt->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT)) {
            subFormatStr = "KSDATAFORMAT_SUBTYPE_IEEE_FLOAT";
        } else if (IsEqualGUID(pExt->SubFormat, KSDATAFORMAT_SUBTYPE_PCM)) {
            subFormatStr = "KSDATAFORMAT_SUBTYPE_PCM";
        } else {
            subFormatStr = "OTHER_GUID";
        }
    }

    std::string endpointInfo = "CoCreateInstance=0x00000000\nGetDefaultAudioEndpoint=0x00000000\nendpointRole=eRender/eConsole\nActivateIAudioClient=0x00000000\nGetMixFormat=0x00000000\nsampleRate=" + std::to_string(m_pwfx->nSamplesPerSec) +
                               "\nchannels=" + std::to_string(m_pwfx->nChannels) +
                               "\nbitsPerSample=" + std::to_string(m_pwfx->wBitsPerSample) +
                               "\nformatTag=" + formatTagStr +
                               "\ncbSize=" + std::to_string(m_pwfx->cbSize) +
                               "\nsubFormat=" + subFormatStr;
    EmitDiagnostic("ENDPOINT", endpointInfo);

    CoTaskMemFree(pTempFormat);

    if (targetProcessId > 0) {
        // ─── Step 2: Setup Process Loopback Activation Params (Discord Exclusion) ───
        tempAudioClient.Reset();
        defaultDevice.Reset();
        deviceEnumerator.Reset();

        AUDIOCLIENT_ACTIVATION_PARAMS audioClientParams = {};
        audioClientParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
        audioClientParams.ProcessLoopbackParams.TargetProcessId = targetProcessId;
        audioClientParams.ProcessLoopbackParams.ProcessLoopbackMode = PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE;

        PROPVARIANT activateParams = {};
        activateParams.vt = VT_BLOB;
        activateParams.blob.cbSize = sizeof(audioClientParams);
        activateParams.blob.pBlobData = reinterpret_cast<BYTE*>(&audioClientParams);

        auto completionHandler = Make<ActivateAudioInterfaceCompletionHandler>();
        ComPtr<IActivateAudioInterfaceAsyncOperation> asyncOp;

        hr = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            __uuidof(IAudioClient),
            &activateParams,
            completionHandler.Get(),
            &asyncOp
        );

        std::string actCallInfo = "targetPid=" + std::to_string(targetProcessId) +
                                  "\nmode=EXCLUDE_TARGET_PROCESS_TREE" +
                                  "\nactivationType=AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK" +
                                  "\nActivateAudioInterfaceAsync=" + FormatHResultHex(hr);
        EmitDiagnostic("ACTIVATE", actCallInfo);

        if (FAILED(hr)) {
            Cleanup();
            if (needCoUninit) CoUninitialize();
            std::string hexHr = FormatHResultHex(hr);
            std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
            std::cerr << "[NativeAudio] Step that failed: ActivateAudioInterfaceAsync(VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK)" << std::endl;
            if (m_onError) m_onError("ActivateAudioInterfaceAsync failed with HRESULT: " + hexHr);
            return false;
        }

        hr = completionHandler->GetActivateResult(m_audioClient);
        std::string asyncResInfo = "GetActivateResult=" + FormatHResultHex(hr) +
                                   "\naudioClientReturned=" + (m_audioClient ? "true" : "false");
        EmitDiagnostic("ASYNC_RESULT", asyncResInfo);

        if (FAILED(hr) || !m_audioClient) {
            Cleanup();
            if (needCoUninit) CoUninitialize();
            std::string hexHr = FormatHResultHex(hr);
            std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
            std::cerr << "[NativeAudio] Step that failed: completionHandler->GetActivateResult" << std::endl;
            if (m_onError) m_onError("GetActivateResult failed with HRESULT: " + hexHr);
            return false;
        }
    } else {
        // ─── Step 2 Alt: Use Standard Default Device Loopback (Full System Audio) ───
        m_audioClient = tempAudioClient;
        tempAudioClient.Reset();
        defaultDevice.Reset();
        deviceEnumerator.Reset();
        EmitDiagnostic("ACTIVATE", "mode=DEFAULT_DEVICE_RENDER_LOOPBACK\ntargetPid=0");
        std::cout << "[NativeAudio] Using standard WASAPI default render endpoint loopback (Full System Audio)" << std::endl;
    }

    // ─── Step 3: Initialize Virtual Process Loopback IAudioClient ──────────────
    hr = m_audioClient->Initialize(
        AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
        0,
        0,
        m_pwfx,
        nullptr
    );

    std::string initInfo = "Initialize=" + FormatHResultHex(hr) +
                           "\nshareMode=AUDCLNT_SHAREMODE_SHARED" +
                           "\nstreamFlags=AUDCLNT_STREAMFLAGS_LOOPBACK|AUDCLNT_STREAMFLAGS_EVENTCALLBACK|AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM" +
                           "\nbufferDuration=0\nperiodicity=0";
    EmitDiagnostic("INITIALIZE", initInfo);

    if (FAILED(hr)) {
        Cleanup();
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: m_audioClient->Initialize" << std::endl;
        if (m_onError) m_onError("IAudioClient::Initialize failed with HRESULT: " + hexHr);
        return false;
    }

    std::cout << "[NativeAudio] Process Loopback audio client initialized successfully" << std::endl;

    // ─── Step 4: Setup event handle and capture client ─────────────────────────
    hr = m_audioClient->SetEventHandle(m_hAudioSampleReadyEvent);
    if (FAILED(hr)) {
        Cleanup();
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        EmitDiagnostic("SET_EVENT_ERROR", "SetEventHandle failed: " + hexHr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: m_audioClient->SetEventHandle" << std::endl;
        if (m_onError) m_onError("SetEventHandle failed with HRESULT: " + hexHr);
        return false;
    }

    hr = m_audioClient->GetService(__uuidof(IAudioCaptureClient), (void**)&m_captureClient);
    std::string getServiceInfo = "GetService=" + FormatHResultHex(hr) +
                                 "\ncaptureClient=" + (m_captureClient ? "true" : "false");
    EmitDiagnostic("GET_SERVICE", getServiceInfo);

    if (FAILED(hr) || !m_captureClient) {
        Cleanup();
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: m_audioClient->GetService(IAudioCaptureClient)" << std::endl;
        if (m_onError) m_onError("GetService(IAudioCaptureClient) failed with HRESULT: " + hexHr);
        return false;
    }

    hr = m_audioClient->Start();
    std::string startInfo = "Start=" + FormatHResultHex(hr) +
                            "\ncaptureStarted=" + (SUCCEEDED(hr) ? "true" : "false");
    EmitDiagnostic("START", startInfo);

    if (FAILED(hr)) {
        Cleanup();
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: m_audioClient->Start" << std::endl;
        if (m_onError) m_onError("IAudioClient::Start failed with HRESULT: " + hexHr);
        return false;
    }

    if (needCoUninit) {
        CoUninitialize();
    }

    m_isCapturing = true;
    m_captureThread = std::thread(&ProcessLoopbackCapture::CaptureThreadFunc, this);
    std::cout << "[NativeAudio] Process Loopback capture thread started" << std::endl;

    return true;
}

void ProcessLoopbackCapture::Stop() {
    std::cout << "[NativeAudio] ProcessLoopbackCapture::Stop called" << std::endl;
    if (!m_isCapturing.exchange(false)) {
        std::cout << "[NativeAudio] Not capturing, returning from Stop" << std::endl;
        return;
    }

    if (m_hStopEvent) {
        std::cout << "[NativeAudio] Setting stop event" << std::endl;
        SetEvent(m_hStopEvent);
    }

    if (m_captureThread.joinable()) {
        std::cout << "[NativeAudio] Joining capture thread..." << std::endl;
        m_captureThread.join();
        std::cout << "[NativeAudio] Capture thread joined." << std::endl;
    }

    Cleanup();
    std::cout << "[NativeAudio] Stop finished." << std::endl;
}

void ProcessLoopbackCapture::Cleanup() {
    m_captureClient.Reset();
    m_audioClient.Reset();

    if (m_pwfx) {
        CoTaskMemFree(m_pwfx);
        m_pwfx = nullptr;
    }
}

void ProcessLoopbackCapture::CaptureThreadFunc() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    bool needCoUninit = SUCCEEDED(hr);

    DWORD taskIndex = 0;
    HANDLE hTask = AvSetMmThreadCharacteristicsW(L"Audio", &taskIndex);

    HANDLE waitEvents[2] = { m_hStopEvent, m_hAudioSampleReadyEvent };
    std::vector<float> resampledBuffer;

    auto startTime = std::chrono::steady_clock::now();
    auto lastReportTime = startTime;
    uint64_t totalPackets = 0;
    uint64_t totalFrames = 0;
    uint64_t silentPackets = 0;
    uint64_t nonSilentPackets = 0;
    bool firstNonSilentPcmLogged = false;
    bool resamplerInfoLogged = false;

    while (m_isCapturing.load()) {
        DWORD waitResult = WaitForMultipleObjects(2, waitEvents, FALSE, INFINITE);

        if (waitResult == WAIT_OBJECT_0) {
            // Stop event received
            break;
        } else if (waitResult == WAIT_OBJECT_0 + 1) {
            // Audio sample ready
            UINT32 nextPacketSize = 0;
            HRESULT hrPacket = m_captureClient ? m_captureClient->GetNextPacketSize(&nextPacketSize) : E_FAIL;

            while (SUCCEEDED(hrPacket) && nextPacketSize > 0 && m_isCapturing.load()) {
                BYTE* pData = nullptr;
                UINT32 numFramesAvailable = 0;
                DWORD flags = 0;

                HRESULT hrBuffer = m_captureClient ? m_captureClient->GetBuffer(
                    &pData,
                    &numFramesAvailable,
                    &flags,
                    nullptr,
                    nullptr
                ) : E_FAIL;

                if (SUCCEEDED(hrBuffer) && pData && numFramesAvailable > 0) {
                    totalPackets++;
                    totalFrames += numFramesAvailable;

                    if (flags & AUDCLNT_BUFFERFLAGS_SILENT) {
                        silentPackets++;
                    } else {
                        nonSilentPackets++;

                        AudioResampler::ConvertAndResample(
                            pData,
                            numFramesAvailable,
                            m_pwfx,
                            resampledBuffer
                        );

                        if (!resamplerInfoLogged && m_pwfx) {
                            resamplerInfoLogged = true;
                            std::string resInfo = "inputSampleRate=" + std::to_string(m_pwfx->nSamplesPerSec) +
                                                  "\ninputChannels=" + std::to_string(m_pwfx->nChannels) +
                                                  "\noutputSampleRate=48000\noutputChannels=2\noutputFormat=Float32";
                            EmitDiagnostic("RESAMPLER", resInfo);
                        }

                        if (!resampledBuffer.empty()) {
                            float peak = 0.0f;
                            double sumSq = 0.0;
                            for (float s : resampledBuffer) {
                                float absVal = std::fabs(s);
                                if (absVal > peak) peak = absVal;
                                sumSq += (double)(s * s);
                            }
                            float rms = (float)std::sqrt(sumSq / resampledBuffer.size());

                            if (!firstNonSilentPcmLogged) {
                                firstNonSilentPcmLogged = true;
                                std::string pcmData = "samples=" + std::to_string(resampledBuffer.size()) +
                                                      "\npeak=" + std::to_string(peak) +
                                                      "\nrms=" + std::to_string(rms) +
                                                      "\nnonZero=" + (peak > 0.00001f ? "true" : "false");
                                EmitDiagnostic("PCM", pcmData);
                            }

                            if (m_onData) {
                                m_onData(resampledBuffer.data(), resampledBuffer.size());
                            }
                        }
                    }

                    if (m_captureClient) {
                        m_captureClient->ReleaseBuffer(numFramesAvailable);
                    }
                }

                auto now = std::chrono::steady_clock::now();
                auto elapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime).count();
                if (elapsedMs <= 10000 && std::chrono::duration_cast<std::chrono::milliseconds>(now - lastReportTime).count() >= 1000) {
                    lastReportTime = now;
                    std::string capData = "elapsedMs=" + std::to_string(elapsedMs) +
                                          "\npackets=" + std::to_string(totalPackets) +
                                          "\nframes=" + std::to_string(totalFrames) +
                                          "\nsilentPackets=" + std::to_string(silentPackets) +
                                          "\nnonSilentPackets=" + std::to_string(nonSilentPackets) +
                                          "\nlastPacketFrames=" + std::to_string(numFramesAvailable);
                    EmitDiagnostic("CAPTURE", capData);
                }

                hrPacket = m_captureClient ? m_captureClient->GetNextPacketSize(&nextPacketSize) : E_FAIL;
            }
        }
    }

    auto now = std::chrono::steady_clock::now();
    auto totalElapsedMs = std::chrono::duration_cast<std::chrono::milliseconds>(now - startTime).count();
    std::string finalCap = "totalElapsedMs=" + std::to_string(totalElapsedMs) +
                          "\ntotalPackets=" + std::to_string(totalPackets) +
                          "\ntotalFrames=" + std::to_string(totalFrames) +
                          "\nsilentPackets=" + std::to_string(silentPackets) +
                          "\nnonSilentPackets=" + std::to_string(nonSilentPackets);
    EmitDiagnostic("CAPTURE_FINAL", finalCap);

    if (m_audioClient) {
        m_audioClient->Stop();
    }
    m_captureClient.Reset();
    m_audioClient.Reset();

    if (hTask) {
        AvRevertMmThreadCharacteristics(hTask);
    }

    if (needCoUninit) {
        CoUninitialize();
    }
}
