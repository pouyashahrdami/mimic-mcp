// Batch OCR helper for mimic-mcp: recognizes text in every image path given
// on the command line using Apple's Vision framework and prints one JSON
// array to stdout. Runs under `swift <this file>` — no compilation step.
import Foundation
import Vision
import CoreImage

struct Observation: Codable {
  let text: String
  let confidence: Double
  // Normalized, top-left origin: x/y/w/h in 0..1 of the image.
  let x: Double
  let y: Double
  let w: Double
  let h: Double
}

struct FileResult: Codable {
  let file: String
  let observations: [Observation]
}

var results: [FileResult] = []

for path in CommandLine.arguments.dropFirst() {
  let url = URL(fileURLWithPath: path)
  guard let image = CIImage(contentsOf: url) else {
    results.append(FileResult(file: path, observations: []))
    continue
  }
  let request = VNRecognizeTextRequest()
  request.recognitionLevel = .accurate
  request.usesLanguageCorrection = false
  let handler = VNImageRequestHandler(ciImage: image, options: [:])
  do {
    try handler.perform([request])
    let observations: [Observation] = (request.results ?? []).compactMap { obs in
      guard let candidate = obs.topCandidates(1).first else { return nil }
      let box = obs.boundingBox // Vision: normalized, bottom-left origin
      return Observation(
        text: candidate.string,
        confidence: Double(candidate.confidence),
        x: Double(box.origin.x),
        y: Double(1 - box.origin.y - box.height),
        w: Double(box.width),
        h: Double(box.height)
      )
    }
    results.append(FileResult(file: path, observations: observations))
  } catch {
    results.append(FileResult(file: path, observations: []))
  }
}

let encoder = JSONEncoder()
let data = try encoder.encode(results)
print(String(data: data, encoding: .utf8)!)
