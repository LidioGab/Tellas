{
  "targets": [
    {
      "target_name": "native_audio",
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "defines": [ "NAPI_CPP_EXCEPTIONS" ],
      "conditions": [
        ['OS=="win"', {
          "sources": [
            "src/addon.cpp",
            "src/process_loopback.cpp"
          ],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "AdditionalOptions": [ "/std:c++17" ]
            }
          },
          "libraries": [
            "Mmdevapi.lib",
            "Avrt.lib",
            "Ole32.lib"
          ]
        }, {
          "sources": [
            "src/stub.cpp"
          ]
        }]
      ]
    }
  ]
}
