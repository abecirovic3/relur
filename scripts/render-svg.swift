// Renders an SVG to a PNG with transparency (AppKit reads SVG since macOS 13).
//   swift scripts/render-svg.swift <in.svg> <out.png> <size>
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let size = Int(args[3]), let image = NSImage(contentsOfFile: args[1]) else {
  FileHandle.standardError.write("usage: render-svg <in.svg> <out.png> <size>\n".data(using: .utf8)!)
  exit(1)
}
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
  samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
  bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
NSColor.clear.set()
NSRect(x: 0, y: 0, width: size, height: size).fill()
image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: args[2]))
