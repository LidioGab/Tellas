#include <napi.h>
#include "process_loopback.h"
#include <memory>
#include <iostream>

class NativeAudioAddon : public Napi::ObjectWrap<NativeAudioAddon> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "ProcessLoopbackCapture", {
            InstanceMethod("start", &NativeAudioAddon::Start),
            InstanceMethod("stop", &NativeAudioAddon::Stop),
            InstanceMethod("isCapturing", &NativeAudioAddon::IsCapturing),
            StaticMethod("isSupported", &NativeAudioAddon::IsSupported)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("ProcessLoopbackCapture", func);
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
    }

private:
    static Napi::Value IsSupported(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Boolean::New(env, ProcessLoopbackCapture::IsSupported());
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

    Napi::Value Stop(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (m_capture) {
            m_capture->Stop();
        }
        return env.Undefined();
    }

    std::unique_ptr<ProcessLoopbackCapture> m_capture;
    Napi::ThreadSafeFunction m_tsfn;
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    return NativeAudioAddon::Init(env, exports);
}

NODE_API_MODULE(native_audio, InitAll)
