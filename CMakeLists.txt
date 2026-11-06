cmake_minimum_required(VERSION 3.20)
project(mbira-poc CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Pinned third-party sources (see deps/manifest.json)
set(ELEM_DIR ${CMAKE_CURRENT_SOURCE_DIR}/thirdparty/elementary)
set(RTAUDIO_DIR ${CMAKE_CURRENT_SOURCE_DIR}/deps/extract/rtaudio-6.0.1)
set(RTMIDI_DIR ${CMAKE_CURRENT_SOURCE_DIR}/deps/extract/rtmidi-6.0.0)

add_library(rtaudio STATIC ${RTAUDIO_DIR}/RtAudio.cpp)
target_include_directories(rtaudio PUBLIC ${RTAUDIO_DIR})
target_compile_definitions(rtaudio PRIVATE __WINDOWS_DS__=1)
target_link_libraries(rtaudio PUBLIC winmm dsound)

add_library(rtmidi STATIC ${RTMIDI_DIR}/RtMidi.cpp)
target_include_directories(rtmidi PUBLIC ${RTMIDI_DIR})
target_compile_definitions(rtmidi PRIVATE __WINDOWS_MM__=1)
target_link_libraries(rtmidi PUBLIC winmm)

add_executable(mbira-poc src/native/main.cpp)
target_include_directories(mbira-poc PRIVATE
  ${ELEM_DIR}/runtime
  ${ELEM_DIR}/cli/choc/text
  ${ELEM_DIR}/cli/choc/javascript
)
target_link_libraries(mbira-poc PRIVATE rtaudio rtmidi)
# MinGW: link stdc++exp? not needed; chrono/thread come with winpthreads (posix threads build)
if(MINGW)
  target_link_libraries(mbira-poc PRIVATE winmm ole32 ws2_32)
  # Fully static: the desktop shortcut runs outside the WinLibs PATH, so no
  # MinGW runtime DLLs (libwinpthread-1.dll etc.) may be needed at load time.
  target_link_options(mbira-poc PRIVATE -static)
  target_compile_options(mbira-poc PRIVATE -O2)
endif()


# ---------------------------------------------------------------------------
# MBIRA VST3 plugin (Milestone 1 spike) + VST3 SDK validator
# Configure: cmake -B build-vst3 -G Ninja -DWINLIBS_BIN=deps/bin/winlibs/mingw64/bin
# The plugin embeds build/dsp-bundle.js into the binary (no side files needed).

set(VST3SDK_DIR ${CMAKE_CURRENT_SOURCE_DIR}/deps/extract/vst3sdk)
if(EXISTS ${VST3SDK_DIR}/public.sdk/source/vst/vstaudioeffect.h)

  # Embed the DSP bundle as a C string
  set(MBIRA_BUNDLE_FILE ${CMAKE_CURRENT_SOURCE_DIR}/build/dsp-bundle.js)
  set(MBIRA_BUNDLE_DELIM MBIRAJS)
  file(READ ${MBIRA_BUNDLE_FILE} MBIRA_BUNDLE_CONTENT)
  set(MBIRA_BUNDLE_HEADER "bundle content check")
  if(MBIRA_BUNDLE_CONTENT MATCHES "\\)${MBIRA_BUNDLE_DELIM}\"")
    message(FATAL_ERROR "bundle content contains the raw-string delimiter; pick another")
  endif()
  file(READ ${CMAKE_CURRENT_SOURCE_DIR}/src/vst3/dsp_bundle.h.in MBIRA_HEADER_TPL)
  string(REPLACE "@@MBIRA_BUNDLE_CONTENT@@" "${MBIRA_BUNDLE_CONTENT}" MBIRA_HEADER_TPL "${MBIRA_HEADER_TPL}")
  file(WRITE ${CMAKE_CURRENT_BINARY_DIR}/generated/dsp_bundle.h "${MBIRA_HEADER_TPL}")

  set(SMTG_ENABLE_VST3_PLUGIN_EXAMPLES OFF CACHE BOOL "" FORCE)
  set(SMTG_ENABLE_VST3_HOSTING_EXAMPLES ON CACHE BOOL "" FORCE)  # builds the `validator` executable
  set(SMTG_ENABLE_VSTGUI_SUPPORT OFF CACHE BOOL "" FORCE)
  add_subdirectory(${VST3SDK_DIR} vst3sdk EXCLUDE_FROM_ALL)

  add_library(mbira_vst3 SHARED src/vst3/MbiraPlugin.cpp)
  target_include_directories(mbira_vst3 PRIVATE
    ${ELEM_DIR}/runtime
    ${ELEM_DIR}/cli/choc/text
    ${ELEM_DIR}/cli/choc/javascript
    ${CMAKE_CURRENT_BINARY_DIR}/generated
  )
  target_link_libraries(mbira_vst3 PRIVATE sdk base)
  target_compile_definitions(mbira_vst3 PRIVATE MBIRA_VST3=1)
  target_compile_options(mbira_vst3 PRIVATE -O2 -fpermissive)
  # Static MinGW runtime: hosts can't see libstdc++-6/libgcc_s/libwinpthread on PATH
  target_link_options(mbira_vst3 PRIVATE -static-libgcc -static-libstdc++ -static)
  set_target_properties(mbira_vst3 PROPERTIES PREFIX "")
  # Bundle layout: MBIRA.vst3/Contents/x86_64-win/MBIRA.vst3 (the DLL)
  set_target_properties(mbira_vst3 PROPERTIES
    RUNTIME_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/vst3/MBIRA.vst3/Contents/x86_64-win
    LIBRARY_OUTPUT_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/vst3/MBIRA.vst3/Contents/x86_64-win
    OUTPUT_NAME "MBIRA"
    SUFFIX ".vst3")

  # validator uses wmain() on Windows -> needs -municode under MinGW
  if(TARGET validator)
    target_compile_options(validator PRIVATE -municode)
    target_link_options(validator PRIVATE -municode)
  endif()

  # Offline smoke-test host: loads the .vst3 DLL, sends a note-on, asserts sound
  add_executable(mbira_vst3_smoke src/vst3/SmokeHost.cpp)
  target_link_libraries(mbira_vst3_smoke PRIVATE pluginterfaces sdk_hosting)
  target_compile_options(mbira_vst3_smoke PRIVATE -O2)
  add_dependencies(mbira_vst3_smoke mbira_vst3)
endif()
