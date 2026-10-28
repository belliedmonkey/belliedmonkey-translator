// tools/offline-video-asr/macos/extract.swift
//
// AVFoundation extractor for the stage-0 CLI. Not part of the iOS target and not
// pasted into the app: bootstrap-mac.sh compiles it, the CLI calls it first,
// and ffmpeg / afconvert are the fallback. stdout is one JSON object on failure.
import AudioToolbox
import AVFoundation
import CoreMedia
import Foundation

func emit(_ code: String) -> Never {
    var payload: [String: Any] = ["ok": false, "code": code]
    if code == "media_encrypted" {
        payload["drm"] = true
        payload["codes"] = ["media_encrypted", "drm"]
    }
    let data = try! JSONSerialization.data(withJSONObject: payload)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data([0x0A]))
    exit(1)
}

func classify(_ error: Error?) -> Never {
    let text = (error.map { String(describing: $0) } ?? "").lowercased()
    if text.contains("protect") || text.contains("encrypt") || text.contains("drm") || text.contains("fairplay") {
        emit("media_encrypted")
    }
    emit("codec_unsupported")
}

func writeWav(_ pcm: Data, to url: URL) throws {
    let rate: UInt32 = 16000
    let channels: UInt16 = 1
    let bits: UInt16 = 16
    let blockAlign = channels * bits / 8
    let byteRate = rate * UInt32(blockAlign)
    let dataSize = UInt32(pcm.count)
    var header = Data()
    func append32(_ value: UInt32) {
        var le = value.littleEndian
        withUnsafeBytes(of: &le) { header.append(contentsOf: $0) }
    }
    func append16(_ value: UInt16) {
        var le = value.littleEndian
        withUnsafeBytes(of: &le) { header.append(contentsOf: $0) }
    }
    header.append(contentsOf: "RIFF".utf8)
    append32(36 + dataSize)
    header.append(contentsOf: "WAVE".utf8)
    header.append(contentsOf: "fmt ".utf8)
    append32(16)
    append16(1)
    append16(channels)
    append32(rate)
    append32(byteRate)
    append16(blockAlign)
    append16(bits)
    header.append(contentsOf: "data".utf8)
    append32(dataSize)
    header.append(pcm)
    try header.write(to: url)
}

let args = CommandLine.arguments
if args.count != 3 { emit("codec_unsupported") }
let input = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])

let asset = AVURLAsset(url: input)
if asset.hasProtectedContent {
    emit("media_encrypted")
}
let tracks = asset.tracks(withMediaType: .audio)
if tracks.isEmpty {
    emit("no_audio_track")
}

let reader: AVAssetReader
do {
    reader = try AVAssetReader(asset: asset)
} catch {
    classify(error)
}
let settings: [String: Any] = [
    AVFormatIDKey: Int(kAudioFormatLinearPCM),
    AVSampleRateKey: 16000,
    AVNumberOfChannelsKey: 1,
    AVLinearPCMBitDepthKey: 16,
    AVLinearPCMIsFloatKey: false,
    AVLinearPCMIsBigEndianKey: false,
    AVLinearPCMIsNonInterleaved: false,
]
let trackOut = AVAssetReaderTrackOutput(track: tracks[0], outputSettings: settings)
trackOut.alwaysCopiesSampleData = true
if !reader.canAdd(trackOut) { emit("codec_unsupported") }
reader.add(trackOut)
if !reader.startReading() { classify(reader.error) }

var pcm = Data()
while let sample = trackOut.copyNextSampleBuffer() {
    guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
    let length = CMBlockBufferGetDataLength(block)
    if length <= 0 { continue }
    var chunk = Data(count: length)
    chunk.withUnsafeMutableBytes { raw in
        guard let base = raw.baseAddress else { return }
        CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: base)
    }
    pcm.append(chunk)
}
if reader.status == .failed { classify(reader.error) }
if pcm.isEmpty { emit("no_audio_track") }
do {
    try writeWav(pcm, to: output)
} catch {
    emit("codec_unsupported")
}
