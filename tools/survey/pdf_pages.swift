// Writes each page's text layer of a PDF to <outdir>/pNNN.txt, through Apple's PDFKit (macOS).
// Usage: swift tools/survey/pdf_pages.swift <in.pdf> <outdir>
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count == 3, let document = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: swift pdf_pages.swift <in.pdf> <outdir>\n".data(using: .utf8)!)
  exit(1)
}
let out = URL(fileURLWithPath: args[2])
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
for index in 0..<document.pageCount {
  let text = document.page(at: index)?.string ?? ""
  try text.write(to: out.appendingPathComponent(String(format: "p%03d.txt", index + 1)), atomically: true, encoding: .utf8)
}
print(document.pageCount)
