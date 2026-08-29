#include <napi.h>
#include "process_loopback.h"
#include <memory>
#include <iostream>
#include <vector>
#include <unordered_map>
#include <string>
#include <windows.h>
#include <mmdeviceapi.h>
#include <audiopolicy.h>
#include <wrl/client.h>

using Microsoft::WRL::ComPtr;

class NativeAudioAddon : public Napi::ObjectWrap<NativeAudioAddon> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "ProcessLoopbackCapture", {
            InstanceMethod("start", &NativeAudioAddon::Start),
            InstanceMethod("stop", &NativeAudioAddon::Stop),
            InstanceMethod("isCapturing", &NativeAudioAddon::IsCapturing),
            InstanceMethod("setDiagnosticCallback", &NativeAudioAddon::SetDiagnosticCallback),
            StaticMethod("isOfficiallySupported", &NativeAudioAddon::IsOfficiallySupported),
            StaticMethod("isProbeEligible", &NativeAudioAddon::IsProbeEligible),
            StaticMethod("canAttemptProcessLoopback", &NativeAudioAddon::CanAttemptProcessLoopback),
            StaticMethod("isSupported", &NativeAudioAddon::IsSupported)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("ProcessLoopbackCapture", func);
        exports.Set(
            Napi::String::New(env, "getRenderAudioSessions"),
            Napi::Function::New(env, NativeAudioAddon::GetRenderAudioSessions)
        );
        return exports;
    }

    NativeAudioAddon(const Napi::CallbackInfo& info) : Napi::ObjectWrap<NativeAudioAddon>(info) {
        m_capture = std::make_unique<ProcessLoopbackCapture>();
    }

    ~NativeAudioAddon() {
        if (m_capture) {
            m_capture->Stop();
        }
        if (m_tsfn) {
            m_tsfn.Release();
            m_tsfn = nullptr;
        }
        if (m_diagTsfn) {
            m_diagTsfn.Release();
            m_diagTsfn = nullptr;
        }
    }

private:
    static Napi::Value IsOfficiallySupported(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Boolean::New(env, ProcessLoopbackCapture::IsOfficiallySupported());
    }

    static Napi::Value IsProbeEligible(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Boolean::New(env, ProcessLoopbackCapture::IsProbeEligible());
    }

    static Napi::Value CanAttemptProcessLoopback(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Boolean::New(env, ProcessLoopbackCapture::CanAttemptProcessLoopback());
    }

    static Napi::Value IsSupported(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Boolean::New(env, ProcessLoopbackCapture::IsSupported());
    }

    static Napi::Value GetRenderAudioSessions(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Array resultArr = Napi::Array::New(env);

        HRESULT hrCo = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        bool needCoUninit = SUCCEEDED(hrCo);

        std::unordered_map<DWORD, std::string> sessionMap;

        do {
            ComPtr<IMMDeviceEnumerator> deviceEnumerator;
            HRESULT hr = CoCreateInstance(
                __uuidof(MMDeviceEnumerator),
                nullptr,
                CLSCTX_ALL,
                __uuidof(IMMDeviceEnumerator),
                (void**)&deviceEnumerator
            );
            if (FAILED(hr) || !deviceEnumerator) break;

            ComPtr<IMMDeviceCollection> deviceCollection;
            hr = deviceEnumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &deviceCollection);
            if (FAILED(hr) || !deviceCollection) break;

            UINT deviceCount = 0;
            if (FAILED(deviceCollection->GetCount(&deviceCount))) break;

            for (UINT i = 0; i < deviceCount; ++i) {
                ComPtr<IMMDevice> device;
                if (FAILED(deviceCollection->Item(i, &device)) || !device) continue;

                ComPtr<IAudioSessionManager2> sessionManager;
                if (FAILED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr, (void**)&sessionManager)) || !sessionManager) {
                    continue;
                }

                ComPtr<IAudioSessionEnumerator> sessionEnumerator;
                if (FAILED(sessionManager->GetSessionEnumerator(&sessionEnumerator)) || !sessionEnumerator) {
                    continue;
                }

                int sessionCount = 0;
                if (FAILED(sessionEnumerator->GetCount(&sessionCount))) continue;

                for (int s = 0; s < sessionCount; ++s) {
                    ComPtr<IAudioSessionControl> sessionControl;
                    if (FAILED(sessionEnumerator->GetSession(s, &sessionControl)) || !sessionControl) continue;

                    ComPtr<IAudioSessionControl2> sessionControl2;
                    if (FAILED(sessionControl.As(&sessionControl2)) || !sessionControl2) continue;

                    DWORD pid = 0;
                    if (FAILED(sessionControl2->GetProcessId(&pid)) || pid == 0) continue;

                    AudioSessionState state = AudioSessionStateInactive;
                    sessionControl->GetState(&state);

                    std::string stateStr = "inactive";
                    if (state == AudioSessionStateActive) {
                        stateStr = "active";
                    } else if (state == AudioSessionStateExpired) {
                        stateStr = "expired";
                    }

                    auto it = sessionMap.find(pid);
                    if (it == sessionMap.end()) {
                        sessionMap[pid] = stateStr;
                    } else {
                        if (stateStr == "active") {
                            it->second = "active";
                        } else if (stateStr == "inactive" && it->second == "expired") {
                            it->second = "inactive";
                        }
                    }
                }
            }
        } while (false);

        if (needCoUninit) {
            CoUninitialize();
        }

        uint32_t idx = 0;
        for (const auto& kv : sessionMap) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("processId", Napi::Number::New(env, kv.first));
            obj.Set("state", Napi::String::New(env, kv.second));
            resultArr.Set(idx++, obj);
        }

        return resultArr;
    }

    Napi::Value IsCapturing(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Boolean::New(env, m_capture && m_capture->IsCapturing());
    }

    Napi::Value Start(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsFunction()) {
            Napi::TypeError::New(env, "Expected (targetPid: number, onData: function)").ThrowAsJavaScriptException();
            return env.Null();
        }

        DWORD targetPid = static_cast<DWORD>(info[0].As<Napi::Number>().Uint32Value());
        Napi::Function callback = info[1].As<Napi::Function>();

        if (m_tsfn) {
            m_tsfn.Release();
            m_tsfn = nullptr;
        }

        m_tsfn = Napi::ThreadSafeFunction::New(
            env,
            callback,
            "NativeAudioDataCallback",
            0,
            1
        );

        auto onData = [this](const float* pcmData, size_t sampleCount) {
            if (!this->m_capture || !this->m_capture->IsCapturing()) return;
            if (!this->m_tsfn) return;

            std::vector<float> bufferCopy(pcmData, pcmData + sampleCount);

            this->m_tsfn.NonBlockingCall([bufferCopy = std::move(bufferCopy)](Napi::Env env, Napi::Function jsCallback) {
                if (env == nullptr || jsCallback.IsEmpty()) return;
                Napi::Float32Array float32Arr = Napi::Float32Array::New(env, bufferCopy.size());
                float* dest = float32Arr.Data();
                std::memcpy(dest, bufferCopy.data(), bufferCopy.size() * sizeof(float));

                jsCallback.Call({ float32Arr });
            });
        };

        auto onError = [this](const std::string& err) {
            std::cerr << "[NativeAudioAddon] Error: " << err << std::endl;
        };

        bool success = m_capture->Start(targetPid, onData, onError);
        return Napi::Boolean::New(env, success);
    }

    Napi::Value SetDiagnosticCallback(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsFunction()) {
            return env.Undefined();
        }

        Napi::Function cb = info[0].As<Napi::Function>();
        if (m_diagTsfn) {
            m_diagTsfn.Release();
            m_diagTsfn = nullptr;
        }

        m_diagTsfn = Napi::ThreadSafeFunction::New(
            env,
            cb,
            "NativeAudioDiagnosticCallback",
            0,
            1
        );

        if (m_capture) {
            m_capture->SetDiagnosticCallback([this](const std::string& category, const std::string& message) {
                if (!this->m_diagTsfn) return;
                this->m_diagTsfn.NonBlockingCall([category, message](Napi::Env env, Napi::Function jsCallback) {
                    if (env == nullptr || jsCallback.IsEmpty()) return;
                    jsCallback.Call({ Napi::String::New(env, category), Napi::String::New(env, message) });
                });
            });
        }

        return env.Undefined();
    }

    Napi::Value Stop(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (m_capture) {
            m_capture->Stop();
        }
        return env.Undefined();
    }

    std::unique_ptr<ProcessLoopbackCapture> m_capture;
    Napi::ThreadSafeFunction m_tsfn;
    Napi::ThreadSafeFunction m_diagTsfn;
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return NativeAudioAddon::Init(env, exports);
}

NODE_API_MODULE(native_audio, InitAll)
