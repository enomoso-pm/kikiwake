// Kikiwake の音声の取り出し（macOS 標準の AVFoundation。ffmpeg を同梱しない）。
//   decode-avf decode <入力> <出力.wav>   16kHz・mono・16bit の WAV を書き、長さ（秒）を標準出力に出す
//   decode-avf inspect <入力>             長さ・音声と映像の有無を JSON で標準出力に出す（ファイルの確認用）
//   decode-avf <入力> <出力.wav>          decode と同じ（Phase 0 の呼び方）
// 失敗したときの終了コード: 2 = 開けない・対応していない形式、3 = 音声トラックが無い、4 = 書き込めない、1 = その他
// ビルド: scripts/build_engines_mac.sh（xcrun swiftc -O -target arm64-apple-macos14.0）
//
// 取り出し方（2026-09-26 に7形式で測って決めた。Phase 0 の試作 spikes/decode-avf から変えた）:
//   音声トラックを元の形（周波数・チャンネル数）のまま読み、チャンネルの平均でモノラルにし（ffmpeg・Python 版と同じ）、
//   AVAudioConverter で 16kHz にする。変換には決まった大きさ（4096 標本）で区切って渡し、少しずつ流す（長い録音でもメモリは一定）。
//   試作のように AVAssetReaderAudioMixOutput に 16kHz・mono への変換まで任せると、AAC・HE-AAC は取り出すたびに少し違う出力になり
//   （5回で最大5種類、長さも最大 60ms 変わる）、変換の質も低かった（劣化の無い WAV でも元の音声との一致度 20.7dB。この方法は 44.4dB）。
//   時刻のずれは7形式ともこの方法で 0（編集リストに従う）。AVAudioFile は揺れないが、MOV で 23ms 遅れたので使わない。
//   HE-AAC だけは、OS の復号そのものが毎回少し違う（時刻と長さは正しい）。音声トラックが複数あるときは混ぜる部品に任せる。
import AVFoundation
import Foundation

func fail(_ code: Int32, _ msg: String) -> Never {
    FileHandle.standardError.write((msg + "\n").data(using: .utf8)!)
    exit(code)
}

/// async の読み込みを待つ（コマンドなので、終わるまで止めてよい）
func await_<T>(_ body: @escaping () async throws -> T) -> Result<T, Error> {
    let sema = DispatchSemaphore(value: 0)
    var result: Result<T, Error>!
    Task {
        do { result = .success(try await body()) } catch { result = .failure(error) }
        sema.signal()
    }
    sema.wait()
    return result
}

func wavHeader(dataBytes: UInt32, sampleRate: UInt32 = 16000) -> Data {
    var d = Data()
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }
    d.append("RIFF".data(using: .ascii)!); u32(36 + dataBytes)
    d.append("WAVE".data(using: .ascii)!)
    d.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1)
    u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16)
    d.append("data".data(using: .ascii)!); u32(dataBytes)
    return d
}

func inspect(_ path: String) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: path))
    let loaded = await_ { () async throws -> (Bool, CMTime, Int, Int) in
        let (readable, duration) = try await asset.load(.isReadable, .duration)
        let audio = try await asset.loadTracks(withMediaType: .audio)
        let video = try await asset.loadTracks(withMediaType: .video)
        return (readable, duration, audio.count, video.count)
    }
    guard case .success(let (readable, duration, audio, video)) = loaded else {
        if case .failure(let e) = loaded { fail(2, "読み込めない: \(e)") }
        fail(2, "読み込めない")
    }
    guard readable else { fail(2, "読み込めない形式") }
    let sec = duration.isNumeric ? CMTimeGetSeconds(duration) : 0
    print(String(format: "{\"durationSec\": %.3f, \"hasAudio\": %@, \"hasVideo\": %@}",
                 sec, audio > 0 ? "true" : "false", video > 0 ? "true" : "false"))
}

/// 読んだ音声（元の周波数のモノラル）をためておき、決まった大きさで変換に渡す
final class MonoSource {
    let output: AVAssetReaderOutput
    var fifo: [Float] = []
    var head = 0
    var rate = 0.0
    var eof = false
    init(_ output: AVAssetReaderOutput) { self.output = output }

    /// 次のサンプルバッファを読み、チャンネルの平均でモノラルにしてためる。読み終わりなら false
    func pull() -> Bool {
        guard !eof else { return false }
        guard let sb = output.copyNextSampleBuffer() else { eof = true; return false }
        guard let bb = CMSampleBufferGetDataBuffer(sb), let fd = CMSampleBufferGetFormatDescription(sb),
              let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fd)?.pointee else { return true }
        if rate == 0 { rate = asbd.mSampleRate } else if rate != asbd.mSampleRate { fail(2, "途中で周波数が変わる音声は扱えない") }
        let ch = Int(asbd.mChannelsPerFrame)
        let len = CMBlockBufferGetDataLength(bb)
        var f = [Float](repeating: 0, count: len / 4)
        f.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(bb, atOffset: 0, dataLength: len, destination: $0.baseAddress!) }
        if head > 0 && head >= fifo.count / 2 { fifo.removeFirst(head); head = 0 }
        if ch == 1 {
            fifo += f
        } else {
            fifo.reserveCapacity(fifo.count + f.count / ch)
            for i in stride(from: 0, to: f.count - ch + 1, by: ch) {
                var s: Float = 0
                for c in 0..<ch { s += f[i + c] }
                fifo.append(s / Float(ch))
            }
        }
        return true
    }

    var available: Int { fifo.count - head }
}

func decode(_ input: String, _ output: String) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: input))
    let loaded = await_ { try await asset.loadTracks(withMediaType: .audio) }
    guard case .success(let tracks) = loaded else {
        if case .failure(let e) = loaded { fail(2, "読み込めない: \(e)") }
        fail(2, "読み込めない")
    }
    guard !tracks.isEmpty else { fail(3, "音声トラックが無い") }

    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: asset) } catch { fail(2, "AVAssetReader: \(error)") }
    var settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
    ]
    let out: AVAssetReaderOutput
    if tracks.count == 1 {
        out = AVAssetReaderTrackOutput(track: tracks[0], outputSettings: settings)  // 元の周波数・チャンネル数のまま
    } else {
        settings[AVSampleRateKey] = 48000
        settings[AVNumberOfChannelsKey] = 1
        out = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: settings)
    }
    out.alwaysCopiesSampleData = false
    reader.add(out)
    guard reader.startReading() else { fail(2, "startReading: \(String(describing: reader.error))") }

    let src = MonoSource(out)
    while src.rate == 0 && src.pull() {}
    guard src.rate > 0 else { fail(3, "音声が空") }
    let block = 4096
    let inFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: src.rate, channels: 1, interleaved: false)!
    let outFmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!
    guard let conv = AVAudioConverter(from: inFmt, to: outFmt) else { fail(2, "変換を作れない（\(src.rate)Hz）") }
    conv.sampleRateConverterQuality = AVAudioQuality.max.rawValue
    conv.sampleRateConverterAlgorithm = AVSampleRateConverterAlgorithm_Normal
    let inBuf = AVAudioPCMBuffer(pcmFormat: inFmt, frameCapacity: AVAudioFrameCount(block))!
    let outBuf = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: AVAudioFrameCount(block * 2))!

    let outURL = URL(fileURLWithPath: output)
    guard FileManager.default.createFile(atPath: outURL.path, contents: wavHeader(dataBytes: 0)),
          let fh = try? FileHandle(forWritingTo: outURL) else { fail(4, "書き込めない: \(outURL.path)") }
    fh.seekToEndOfFile()
    var total: UInt64 = 0
    var pcm = [Int16](repeating: 0, count: block * 2)
    while true {
        var err: NSError?
        let st = conv.convert(to: outBuf, error: &err) { _, status in
            while src.available < block && src.pull() {}
            let k = min(block, src.available)
            if k == 0 { status.pointee = .endOfStream; return nil }
            inBuf.frameLength = AVAudioFrameCount(k)
            src.fifo.withUnsafeBufferPointer { inBuf.floatChannelData![0].update(from: $0.baseAddress! + src.head, count: k) }
            src.head += k
            status.pointee = .haveData
            return inBuf
        }
        if st == .error { fail(2, "変換に失敗: \(String(describing: err))") }
        let n = Int(outBuf.frameLength)
        if n > 0 {
            let f = outBuf.floatChannelData![0]
            for i in 0..<n { pcm[i] = Int16(max(-32768, min(32767, (f[i] * 32768).rounded()))) }
            do { try fh.write(contentsOf: pcm.withUnsafeBytes { Data($0.prefix(n * 2)) }) } catch { fail(4, "書き込めない: \(error)") }
            total += UInt64(n * 2)
            // WAV の大きさの欄は 32bit（16kHz・16bit で約 37 時間まで）
            if total > UInt64(UInt32.max - 36) { fail(2, "長すぎる（WAV に収まらない）") }
        }
        if st == .endOfStream { break }
    }
    if reader.status != .completed { fail(2, "読み取り失敗: \(String(describing: reader.error))") }
    fh.seek(toFileOffset: 0)
    fh.write(wavHeader(dataBytes: UInt32(total)))
    fh.closeFile()
    print(String(format: "%.2f", Double(total) / 2.0 / 16000.0))
}

let args = CommandLine.arguments
switch (args.count, args.count > 1 ? args[1] : "") {
case (3, "inspect"): inspect(args[2])
case (4, "decode"): decode(args[2], args[3])
case (3, _): decode(args[1], args[2])
default: fail(1, "usage: decode-avf decode <input> <output.wav> | decode-avf inspect <input>")
}
