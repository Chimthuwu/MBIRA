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
target_compile_definitions(rtaudio PRIVATE __WINDOWS_MM__=1)
target_link_libraries(rtaudio PUBLIC winmm)

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
  target_compile_options(mbira-poc PRIVATE -O2)
endif()
