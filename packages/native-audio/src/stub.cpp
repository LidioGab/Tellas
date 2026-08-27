#include <napi.h>

Napi::Value IsProcessLoopbackSupported(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Value GetRenderAudioSessions(const Napi::CallbackInfo& info) {
    return Napi::Array::New(info.Env(), 0);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(
        Napi::String::New(env, "isProcessLoopbackSupported"),
        Napi::Function::New(env, IsProcessLoopbackSupported)
    );
    exports.Set(
        Napi::String::New(env, "getRenderAudioSessions"),
        Napi::Function::New(env, GetRenderAudioSessions)
    );
    return exports;
}

NODE_API_MODULE(native_audio, Init)
