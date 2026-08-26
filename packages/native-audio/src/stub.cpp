#include <napi.h>

Napi::Value IsProcessLoopbackSupported(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), false);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(
        Napi::String::New(env, "isProcessLoopbackSupported"),
        Napi::Function::New(env, IsProcessLoopbackSupported)
    );
    return exports;
}

NODE_API_MODULE(native_audio, Init)
