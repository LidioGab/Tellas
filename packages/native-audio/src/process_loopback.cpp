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

bool ProcessLoopbackCapture::IsSupported() {
    // Process loopback was introduced in Windows 10 Build 20348 (Windows Server 2022) / Windows 11
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

bool ProcessLoopbackCapture::Start(DWORD targetProcessId, AudioDataCallback onData, AudioErrorCallback onError) {
    if (m_isCapturing.load()) {
        Stop();
    }

    m_targetProcessId = targetProcessId;
    m_onData = onData;
    m_onError = onError;
    ResetEvent(m_hStopEvent);

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
        std::cerr << "[NativeAudio] Step that failed: CoTaskMemAlloc for m_pwfx" << std::endl;
        if (m_onError) m_onError("Memory allocation failed for m_pwfx");
        return false;
    }
    std::memcpy(m_pwfx, pTempFormat, formatSize);
    CoTaskMemFree(pTempFormat);

    // Release temporary physical endpoint COM objects
    tempAudioClient.Reset();
    defaultDevice.Reset();
    deviceEnumerator.Reset();

    std::cout << "[NativeAudio] Default render endpoint format acquired successfully" << std::endl;
    std::cout << "[NativeAudio] Sample rate: " << m_pwfx->nSamplesPerSec << std::endl;
    std::cout << "[NativeAudio] Channels: " << m_pwfx->nChannels << std::endl;
    std::cout << "[NativeAudio] Bits per sample: " << m_pwfx->wBitsPerSample << std::endl;

    // ─── Step 2: Setup Process Loopback Activation Params ───────────────────────
    AUDIOCLIENT_ACTIVATION_PARAMS audioClientParams = {};
    audioClientParams.ActivationType = AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK;
    audioClientParams.ProcessLoopbackParams.TargetProcessId = targetProcessId;
    audioClientParams.ProcessLoopbackParams.ProcessLoopbackMode = (targetProcessId > 0)
        ? PROCESS_LOOPBACK_MODE_EXCLUDE_TARGET_PROCESS_TREE
        : PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE;

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
    if (FAILED(hr) || !m_audioClient) {
        Cleanup();
        if (needCoUninit) CoUninitialize();
        std::string hexHr = FormatHResultHex(hr);
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: completionHandler->GetActivateResult" << std::endl;
        if (m_onError) m_onError("GetActivateResult failed with HRESULT: " + hexHr);
        return false;
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
        std::cerr << "[NativeAudio] HRESULT: " << hexHr << std::endl;
        std::cerr << "[NativeAudio] Step that failed: m_audioClient->SetEventHandle" << std::endl;
        if (m_onError) m_onError("SetEventHandle failed with HRESULT: " + hexHr);
        return false;
    }

    hr = m_audioClient->GetService(__uuidof(IAudioCaptureClient), (void**)&m_captureClient);
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
    if (!m_isCapturing.exchange(false)) {
        return;
    }

    if (m_hStopEvent) {
        SetEvent(m_hStopEvent);
    }

    if (m_captureThread.joinable()) {
        m_captureThread.join();
    }

    Cleanup();
}

void ProcessLoopbackCapture::Cleanup() {
    if (m_audioClient) {
        m_audioClient->Stop();
    }
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

    while (m_isCapturing.load()) {
        DWORD waitResult = WaitForMultipleObjects(2, waitEvents, FALSE, INFINITE);

        if (waitResult == WAIT_OBJECT_0) {
            // Stop event received
            break;
        } else if (waitResult == WAIT_OBJECT_0 + 1) {
            // Audio sample ready
            UINT32 nextPacketSize = 0;
            HRESULT hrPacket = m_captureClient->GetNextPacketSize(&nextPacketSize);

            while (SUCCEEDED(hrPacket) && nextPacketSize > 0 && m_isCapturing.load()) {
                BYTE* pData = nullptr;
                UINT32 numFramesAvailable = 0;
                DWORD flags = 0;

                HRESULT hrBuffer = m_captureClient->GetBuffer(
                    &pData,
                    &numFramesAvailable,
                    &flags,
                    nullptr,
                    nullptr
                );

                if (SUCCEEDED(hrBuffer) && pData && numFramesAvailable > 0) {
                    if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
                        AudioResampler::ConvertAndResample(
                            pData,
                            numFramesAvailable,
                            m_pwfx,
                            resampledBuffer
                        );

                        if (!resampledBuffer.empty() && m_onData) {
                            m_onData(resampledBuffer.data(), resampledBuffer.size());
                        }
                    }

                    m_captureClient->ReleaseBuffer(numFramesAvailable);
                }

                hrPacket = m_captureClient->GetNextPacketSize(&nextPacketSize);
            }
        }
    }

    if (hTask) {
        AvRevertMmThreadCharacteristics(hTask);
    }

    if (needCoUninit) {
        CoUninitialize();
    }
}
