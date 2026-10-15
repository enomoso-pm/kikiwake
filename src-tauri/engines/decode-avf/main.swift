// Kikiwake の音声の取り出し（macOS 標準の AVFoundation。ffmpeg を同梱しない）と、マニュアルの素材の画面の絵（2026-10-12 から）。
//   decode-avf decode <入力> <出力.wav>   16kHz・mono・16bit の WAV を書き、長さ（秒）を標準出力に出す
//   decode-avf inspect <入力>             長さ・音声と映像の有無を JSON で標準出力に出す（ファイルの確認用）
//   decode-avf <入力> <出力.wav>          decode と同じ（Phase 0 の呼び方）
//   decode-avf frames-scan <入力> <出力>   1 秒に 1 枚、小さな升の明るさと顔の位置（Vision）を書く（形は core/src/screens.rs の SCAN_MAGIC）
//   decode-avf frames-export <入力> <指示.json>  決めた時刻の絵を取り出し、（指示があれば共有した画面の部分だけを切り出して）
//                                                四角を黒く塗って JPEG に書く（書き出す名前が .jpg 以外なら PNG）
// 失敗したときの終了コード: 2 = 開けない・対応していない形式、3 = 音声トラックが無い、4 = 書き込めない、5 = 映像トラックが無い、1 = その他
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
import ImageIO
import Vision

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

// ---- マニュアルの素材: 画面の絵（2026-10-12） ---------------------------------------------------------
// 判定は Rust（core/src/screens.rs）。ここは録画を読んで数を書くだけ、と、決めた時刻の絵を書き出すだけ。

/// 小さな升の明るさ（横 sw × 縦 sh の、それぞれの範囲の明るさ Y の平均）。1080p・横 160 なら 12×12 画素ずつ。
/// 横 1920 を超える絵（4K など）は、1 画素おきに数える（平均はほぼ同じで、4 倍速い）
func signature(_ pb: CVPixelBuffer, _ sw: Int, _ sh: Int) -> [UInt8] {
    CVPixelBufferLockBaseAddress(pb, .readOnly)
    defer { CVPixelBufferUnlockBaseAddress(pb, .readOnly) }
    let planar = CVPixelBufferIsPlanar(pb)
    let w = planar ? CVPixelBufferGetWidthOfPlane(pb, 0) : CVPixelBufferGetWidth(pb)
    let h = planar ? CVPixelBufferGetHeightOfPlane(pb, 0) : CVPixelBufferGetHeight(pb)
    let stride = planar ? CVPixelBufferGetBytesPerRowOfPlane(pb, 0) : CVPixelBufferGetBytesPerRow(pb)
    guard let raw = planar ? CVPixelBufferGetBaseAddressOfPlane(pb, 0) : CVPixelBufferGetBaseAddress(pb) else {
        return [UInt8](repeating: 0, count: sw * sh)
    }
    let base = raw.assumingMemoryBound(to: UInt8.self)
    let step = max(1, w / 1920 + (w % 1920 > 0 && w > 1920 ? 1 : 0))
    let xb = (0...sw).map { $0 * w / sw }
    let yb = (0...sh).map { $0 * h / sh }
    var sig = [UInt8](repeating: 0, count: sw * sh)
    var acc = [UInt32](repeating: 0, count: sw)
    var cnt = [UInt32](repeating: 0, count: sw)
    for by in 0..<sh {
        for i in 0..<sw { acc[i] = 0; cnt[i] = 0 }
        var y = yb[by]
        while y < yb[by + 1] {
            let row = base + y * stride
            for bx in 0..<sw {
                var s: UInt32 = 0
                var k: UInt32 = 0
                var x = xb[bx]
                while x < xb[bx + 1] { s += UInt32(row[x]); k += 1; x += step }
                acc[bx] += s
                cnt[bx] += k
            }
            y += step
        }
        for bx in 0..<sw where cnt[bx] > 0 { sig[by * sw + bx] = UInt8((acc[bx] + cnt[bx] / 2) / cnt[bx]) }
    }
    return sig
}

/// 顔の位置（Vision。左上が原点、幅と高さに対する割合）
func faces(_ pb: CVPixelBuffer) -> [CGRect] {
    let req = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cvPixelBuffer: pb, orientation: .up, options: [:])
    do { try handler.perform([req]) } catch { return [] }
    return (req.results ?? []).map { o in
        let b = o.boundingBox  // Vision は左下が原点
        return CGRect(x: b.minX, y: 1 - b.maxY, width: b.width, height: b.height)
    }
}

func le<T: FixedWidthInteger>(_ v: T, _ d: inout Data) { withUnsafeBytes(of: v.littleEndian) { d.append(contentsOf: $0) } }

/// 1 秒に 1 枚（その時刻に見えている絵）について、小さな升の明るさと顔の位置を書く。
/// 映像は全部のコマを順にほどく（圧縮の仕組み上、間のコマも要る）。画面共有の録画は止まっている間コマが来ないことがあるので、
/// 次のコマが来るまでの秒は前のコマで数える
func framesScan(_ input: String, _ output: String) {
    let asset = AVURLAsset(url: URL(fileURLWithPath: input))
    let loaded = await_ { () async throws -> ([AVAssetTrack], CMTime) in
        (try await asset.loadTracks(withMediaType: .video), try await asset.load(.duration))
    }
    guard case .success(let (tracks, duration)) = loaded else {
        if case .failure(let e) = loaded { fail(2, "読み込めない: \(e)") }
        fail(2, "読み込めない")
    }
    guard let track = tracks.first else { fail(5, "映像トラックが無い") }
    let reader: AVAssetReader
    do { reader = try AVAssetReader(asset: asset) } catch { fail(2, "AVAssetReader: \(error)") }
    let out = AVAssetReaderTrackOutput(
        track: track,
        outputSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarFullRange])
    out.alwaysCopiesSampleData = false
    reader.add(out)
    guard reader.startReading() else { fail(2, "startReading: \(String(describing: reader.error))") }
    guard FileManager.default.createFile(atPath: output, contents: nil),
          let fh = FileHandle(forWritingAtPath: output) else { fail(4, "書き込めない: \(output)") }
    let total = duration.isNumeric ? CMTimeGetSeconds(duration) : 0
    let sw = 160
    var sh = 0
    var nextT = 0
    var count = 0
    var lastPct = -1
    var last: CVPixelBuffer?
    var cached: Data?  // last の 1 枚分（時刻を除く）

    func record(_ pb: CVPixelBuffer) -> Data {
        var d = Data()
        let fs = faces(pb).prefix(255)
        d.append(UInt8(fs.count))
        let q = { (v: CGFloat) -> UInt16 in UInt16(max(0, min(10000, (v * 10000).rounded()))) }
        for f in fs { for v in [f.minX, f.minY, f.width, f.height] { le(q(v), &d) } }
        d.append(contentsOf: signature(pb, sw, sh))
        return d
    }
    func emit(upTo limit: Double) {
        guard let lp = last else { return }
        while Double(nextT) < limit - 0.0005 {
            if cached == nil { cached = record(lp) }
            var d = Data()
            le(UInt32(nextT * 1000), &d)
            d.append(cached!)
            do { try fh.write(contentsOf: d) } catch { fail(4, "書き込めない: \(error)") }
            nextT += 1
            count += 1
            if total > 0 {
                let pct = min(100, Int(Double(nextT) / total * 100))
                if pct != lastPct { lastPct = pct; print("progress \(pct)"); fflush(stdout) }
            }
        }
    }

    while let sb = out.copyNextSampleBuffer() {
        guard let pb = CMSampleBufferGetImageBuffer(sb) else { continue }
        if sh == 0 {
            let (w, h) = (CVPixelBufferGetWidth(pb), CVPixelBufferGetHeight(pb))
            sh = max(2, Int((Double(sw) * Double(h) / Double(max(1, w))).rounded()))
            if sh % 2 == 1 { sh += 1 }
            var head = Data("KWS1".utf8)
            le(UInt32(w), &head); le(UInt32(h), &head); le(UInt16(sw), &head); le(UInt16(sh), &head)
            do { try fh.write(contentsOf: head) } catch { fail(4, "書き込めない: \(error)") }
        }
        let pts = CMTimeGetSeconds(CMSampleBufferGetPresentationTimeStamp(sb))
        emit(upTo: pts)
        last = pb
        cached = nil
    }
    if reader.status == .failed { fail(2, "読み取り失敗: \(String(describing: reader.error))") }
    guard last != nil else { fail(5, "映像が空") }
    emit(upTo: max(total, Double(nextT) + 1))
    try? fh.close()
    print("done \(count)")
}

struct MaskRect: Decodable { let x: Double; let y: Double; let w: Double; let h: Double }
/// crop: 絵にする所（録画全体に対する割合。無ければ全体）。masks: 黒く塗る四角（切り出したあとの絵に対する割合）
struct ExportItem: Decodable { let t: Double; let out: String; let crop: MaskRect?; let masks: [MaskRect] }
struct ExportSpec: Decodable { let maxWidth: Int?; let quality: Double?; let items: [ExportItem] }

/// 決めた時刻の絵を取り出し、四角を黒で塗りつぶして書く（ぼかしは使わない。ぼかしでは誰か分かることがある）。
/// 切り出しの指示（crop）があれば、先にその部分だけにする（2026-10-13: 会議アプリの参加者の枠などを外す）。
/// 形式は書き出す名前で決める: .jpg は JPEG（品質は指示の quality。既定 0.85。2026-10-12 決定: 1 枚が PNG の半分ほどで、文字の読みやすさはほぼ同じ）、ほかは PNG。
/// 向きは読み取りと同じ（映像の回転の指定は当てない。四角の位置がずれないように）
func framesExport(_ input: String, _ specPath: String) {
    let spec: ExportSpec
    do { spec = try JSONDecoder().decode(ExportSpec.self, from: Data(contentsOf: URL(fileURLWithPath: specPath))) } catch {
        fail(1, "指示を読めない: \(error)")
    }
    let asset = AVURLAsset(url: URL(fileURLWithPath: input))
    let gen = AVAssetImageGenerator(asset: asset)
    gen.appliesPreferredTrackTransform = false
    gen.requestedTimeToleranceBefore = .zero
    gen.requestedTimeToleranceAfter = .zero
    let maxW = Double(spec.maxWidth ?? 1920)
    let quality = spec.quality ?? 0.85
    // 映像トラックの終わり。読み取りは録画の長さ（音声を含む）の最後の秒まで数えるので、最後の 1 枚の時刻が映像の終わりを
    // わずかに過ぎることがある（実物の録画: 映像 8919.83 秒・最後の 1 枚 8920 秒で「開けない」）。終わりの少し手前に寄せる
    var videoEnd = Double.greatestFiniteMagnitude
    if case .success(let tracks) = await_({ try await asset.loadTracks(withMediaType: .video) }), let track = tracks.first,
       case .success(let range) = await_({ try await track.load(.timeRange) }) {
        videoEnd = CMTimeGetSeconds(CMTimeRangeGetEnd(range))
    }
    for (k, it) in spec.items.enumerated() {
        let time = CMTime(seconds: max(0, min(it.t, videoEnd - 0.05)), preferredTimescale: 6000)
        var got = await_ { try await gen.image(at: time).image }
        if case .failure = got {
            // ちょうどの時刻で取り出せないときは、前後 0.5 秒のゆとりを持たせてもう一度（読み取りと同じ 1 秒の中の絵になる）
            gen.requestedTimeToleranceBefore = CMTime(seconds: 0.5, preferredTimescale: 6000)
            gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 6000)
            got = await_ { try await gen.image(at: time).image }
            gen.requestedTimeToleranceBefore = .zero
            gen.requestedTimeToleranceAfter = .zero
        }
        guard case .success(let whole) = got else {
            if case .failure(let e) = got { fail(2, "絵を取り出せない（\(it.t) 秒）: \(e)") }
            fail(2, "絵を取り出せない")
        }
        // 共有した画面の部分だけにする（割合 → 画素は四捨五入。cropping の四角は絵の左上が原点）
        var cg = whole
        if let c = it.crop {
            let (W, H) = (Double(whole.width), Double(whole.height))
            let (x0, y0) = ((c.x * W).rounded(), (c.y * H).rounded())
            let (x1, y1) = (((c.x + c.w) * W).rounded(), ((c.y + c.h) * H).rounded())
            if x1 - x0 >= 1, y1 - y0 >= 1, let cut = whole.cropping(to: CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)) {
                cg = cut
            }
        }
        let scale = min(1.0, maxW / Double(cg.width))
        let (w, h) = (Int((Double(cg.width) * scale).rounded()), Int((Double(cg.height) * scale).rounded()))
        guard let space = CGColorSpace(name: CGColorSpace.sRGB),
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space,
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { fail(1, "絵を作れない") }
        ctx.interpolationQuality = .high
        ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        ctx.setFillColor(CGColor(gray: 0, alpha: 1))
        for m in it.masks {
            // 左上が原点の割合 → CoreGraphics（左下が原点）の画素
            ctx.fill(CGRect(x: m.x * Double(w), y: (1 - m.y - m.h) * Double(h), width: m.w * Double(w), height: m.h * Double(h)).integral)
        }
        let jpeg = it.out.lowercased().hasSuffix(".jpg") || it.out.lowercased().hasSuffix(".jpeg")
        guard let img = ctx.makeImage(),
              let dest = CGImageDestinationCreateWithURL(
                URL(fileURLWithPath: it.out) as CFURL, (jpeg ? "public.jpeg" : "public.png") as CFString, 1, nil)
        else { fail(4, "書き込めない: \(it.out)") }
        let props = jpeg ? [kCGImageDestinationLossyCompressionQuality as String: quality] as CFDictionary : nil
        CGImageDestinationAddImage(dest, img, props)
        guard CGImageDestinationFinalize(dest) else { fail(4, "書き込めない: \(it.out)") }
        print("progress \(k + 1)/\(spec.items.count)")
        fflush(stdout)
    }
}

let args = CommandLine.arguments
switch (args.count, args.count > 1 ? args[1] : "") {
case (3, "inspect"): inspect(args[2])
case (4, "decode"): decode(args[2], args[3])
case (4, "frames-scan"): framesScan(args[2], args[3])
case (4, "frames-export"): framesExport(args[2], args[3])
case (3, _): decode(args[1], args[2])
default: fail(1, "usage: decode-avf decode <input> <output.wav> | decode-avf inspect <input> | decode-avf frames-scan <input> <out> | decode-avf frames-export <input> <spec.json>")
}
