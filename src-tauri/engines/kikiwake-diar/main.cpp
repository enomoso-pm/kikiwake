// Kikiwake の話者判定。NeMo-Speech.cpp の C の呼び出し口（nemo_speech_diar_*）を使う小さな実行ファイル。
//   kikiwake-diar <音声.wav> --model <gguf> [--preset v3-offline] [--gpu 0] [-o 出力.json] [--slice-sec 1]
//
// nemo-speech diarize（ストリーミングの状態機械・同じプリセット・既定の後処理）と同じ結果を、同じ JSON の形で書く。
// 違いは WAV を少しずつ読んで流し込むこと。nemo-speech diarize は録音全体を読み込んでから一度に流し込むので、
// 音声全体の写し（読み込み・変換・たまり場）と特徴量がすべて同時にメモリに載り、4.5 時間で 5.5GB になった（Phase 0）。
// 流し込み口は 20 分ぶんたまると古い部分を捨てるので、少しずつ渡せばメモリは録音の長さによらない。
//
// 進み具合は標準エラーに「progress <0〜100>」の行で出す。失敗したら終了コード 1 と理由を標準エラーに。
// ビルド: scripts/build_engines_mac.sh（NeMo のビルドに scripts/cmake/nemo_static.cmake から足す）
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "nemo_speech/asr.h"
#include "nemo_speech/diar.h"

namespace {

[[noreturn]] void
die(const std::string& msg) {
    std::fprintf(stderr, "kikiwake-diar: %s\n", msg.c_str());
    std::exit(1);
}

std::string
last_error() {
    const char* e = nemo_speech_asr_last_error();
    return e ? e : "?";
}

// nemo-speech の json_escape（app/cli_util.cpp）と同じ
std::string
json_escape(const std::string& value) {
    static constexpr char hex[] = "0123456789abcdef";
    std::string out;
    for (const unsigned char c : value) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    out += "\\u00";
                    out += hex[c >> 4];
                    out += hex[c & 0xf];
                } else {
                    out += static_cast<char>(c);
                }
        }
    }
    return out;
}

uint32_t
le32(const unsigned char* p) {
    return p[0] | (p[1] << 8) | (p[2] << 16) | (static_cast<uint32_t>(p[3]) << 24);
}

uint16_t
le16(const unsigned char* p) {
    return static_cast<uint16_t>(p[0] | (p[1] << 8));
}

// WAV を開き、data の先頭まで進める。PCM16 と float32、mono と stereo（nemo-speech の load_wav_file と同じ範囲）
struct Wav {
    FILE* f = nullptr;
    uint16_t format = 0, channels = 0, bits = 0;
    uint32_t rate = 0;
    uint64_t frames = 0;
};

Wav
open_wav(const std::string& path) {
    Wav w;
    w.f = std::fopen(path.c_str(), "rb");
    if (!w.f)
        die("開けない: " + path);
    unsigned char h[12];
    if (std::fread(h, 1, 12, w.f) != 12 || std::memcmp(h, "RIFF", 4) || std::memcmp(h + 8, "WAVE", 4))
        die("WAV ではない: " + path);
    bool fmt = false;
    for (;;) {
        unsigned char c[8];
        if (std::fread(c, 1, 8, w.f) != 8)
            die("data が無い: " + path);
        const uint32_t size = le32(c + 4);
        if (!std::memcmp(c, "fmt ", 4)) {
            std::vector<unsigned char> b(size);
            if (size < 16 || std::fread(b.data(), 1, size, w.f) != size)
                die("fmt が壊れている: " + path);
            w.format = le16(&b[0]);
            w.channels = le16(&b[2]);
            w.rate = le32(&b[4]);
            w.bits = le16(&b[14]);
            fmt = true;
            if (size & 1)
                std::fseek(w.f, 1, SEEK_CUR);
        } else if (!std::memcmp(c, "data", 4)) {
            if (!fmt)
                die("fmt より前に data がある: " + path);
            if (!((w.format == 1 && w.bits == 16) || (w.format == 3 && w.bits == 32)))
                die("PCM16 か float32 の WAV だけ扱える");
            if (w.channels != 1 && w.channels != 2)
                die("mono か stereo の WAV だけ扱える");
            w.frames = size / (w.bits / 8 * w.channels);
            return w;
        } else {
            std::fseek(w.f, size + (size & 1), SEEK_CUR);
        }
    }
}

}  // namespace

int
main(int argc, char** argv) {
    std::string audio, model_path, out_path, preset;
    int gpu = 0;
    double slice_sec = 1.0;
    for (int i = 1; i < argc; i++) {
        const std::string a = argv[i];
        auto next = [&]() -> std::string {
            if (i + 1 >= argc)
                die(a + " の値が無い");
            return argv[++i];
        };
        if (a == "--model")
            model_path = next();
        else if (a == "--preset")
            preset = next();
        else if (a == "--gpu")
            gpu = std::atoi(next().c_str());
        else if (a == "-o")
            out_path = next();
        else if (a == "--slice-sec")
            slice_sec = std::atof(next().c_str());
        else if (!a.empty() && a[0] != '-' && audio.empty())
            audio = a;
        else
            die("知らない引数: " + a);
    }
    if (audio.empty() || model_path.empty())
        die("使い方: kikiwake-diar <音声.wav> --model <gguf> [--preset v3-offline] [--gpu 0] [-o 出力.json] [--slice-sec 1]");

    Wav w = open_wav(audio);

    nemo_speech_diar_model_config cfg = {};
    cfg.size = sizeof(cfg);
    cfg.model_path = model_path.c_str();
    cfg.gpu = gpu;
    cfg.preset = preset.empty() ? nullptr : preset.c_str();
    nemo_speech_diar_model* model = nullptr;
    if (nemo_speech_diar_create(&cfg, &model) != NEMO_SPEECH_ASR_OK)
        die("モデルを読めない: " + last_error());
    nemo_speech_diar_stream* stream = nullptr;
    if (nemo_speech_diar_stream_open(model, &stream) != NEMO_SPEECH_ASR_OK)
        die("流し込みを始められない: " + last_error());

    // 少しずつ読み、load_wav_file と同じ変換（PCM16 は /32768、チャンネルは平均）で mono の float にして流し込む
    const size_t slice = std::max<size_t>(1, static_cast<size_t>(slice_sec * w.rate));
    const size_t bytes_per_frame = w.bits / 8 * w.channels;
    std::vector<unsigned char> raw(slice * bytes_per_frame);
    std::vector<float> mono(slice);
    uint64_t done = 0;
    int last_pct = -1;
    while (done < w.frames) {
        const size_t want = static_cast<size_t>(std::min<uint64_t>(slice, w.frames - done));
        const size_t got = std::fread(raw.data(), bytes_per_frame, want, w.f);
        if (got == 0)
            break;
        for (size_t i = 0; i < got; i++) {
            float sum = 0.0f;
            for (size_t c = 0; c < w.channels; c++) {
                const unsigned char* p = &raw[(i * w.channels + c) * (w.bits / 8)];
                float s;
                if (w.format == 1) {
                    s = static_cast<int16_t>(le16(p)) / 32768.0f;
                } else {
                    uint32_t u = le32(p);
                    std::memcpy(&s, &u, 4);
                }
                sum += s;
            }
            mono[i] = sum / w.channels;
        }
        if (nemo_speech_diar_stream_push_f32(stream, mono.data(), got, static_cast<int32_t>(w.rate)) != NEMO_SPEECH_ASR_OK)
            die("流し込みに失敗: " + last_error());
        done += got;
        const int pct = static_cast<int>(100 * done / w.frames);
        if (pct != last_pct) {
            std::fprintf(stderr, "progress %d\n", pct);
            std::fflush(stderr);
            last_pct = pct;
        }
    }
    std::fclose(w.f);
    if (nemo_speech_diar_stream_finish(stream) != NEMO_SPEECH_ASR_OK)
        die("最後の処理に失敗: " + last_error());

    size_t count = 0;
    if (nemo_speech_diar_segments(stream, nullptr, nullptr, 0, &count) != NEMO_SPEECH_ASR_OK)
        die("区間を取り出せない: " + last_error());
    std::vector<nemo_speech_diar_segment> segs(count);
    if (count > 0 && nemo_speech_diar_segments(stream, nullptr, segs.data(), segs.size(), &count) != NEMO_SPEECH_ASR_OK)
        die("区間を取り出せない: " + last_error());
    nemo_speech_diar_stream_close(stream);
    nemo_speech_diar_destroy(model);

    // nemo-speech diarize --format json（app/diarize.cpp の render_result）と同じ書き方。話者は 1 から
    std::string json = "{\n  \"file\": \"" + json_escape(audio) + "\",\n  \"segments\": [";
    char line[512];
    for (size_t i = 0; i < count; i++) {
        std::snprintf(line, sizeof(line), "%s\n    {\"start\": %.3f, \"end\": %.3f, \"speaker\": %d}", i ? "," : "",
                      segs[i].start_time, segs[i].end_time, segs[i].speaker);
        json += line;
    }
    json += count ? "\n  ]\n}\n" : "]\n}\n";

    if (out_path.empty()) {
        std::fwrite(json.data(), 1, json.size(), stdout);
        return 0;
    }
    // 途中で止められても壊れた JSON が残らないよう、別名で書いてから置き換える
    const std::string tmp = out_path + ".part";
    FILE* o = std::fopen(tmp.c_str(), "wb");
    if (!o || std::fwrite(json.data(), 1, json.size(), o) != json.size() || std::fclose(o) != 0)
        die("書き込めない: " + tmp);
    if (std::rename(tmp.c_str(), out_path.c_str()) != 0)
        die("書き込めない: " + out_path);
    return 0;
}
