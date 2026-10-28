// Renders every page of a PDF to <prefix>-<n>.png at 96 dpi, so one CSS px is one pixel.
// Usage: swift render.swift <in.pdf> <prefix>
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count == 3, let doc = CGPDFDocument(URL(fileURLWithPath: args[1]) as CFURL) else {
    FileHandle.standardError.write("usage: render.swift <in.pdf> <prefix>\n".data(using: .utf8)!)
    exit(2)
}
print(doc.numberOfPages)
for n in 1...max(doc.numberOfPages, 1) {
    guard let page = doc.page(at: n) else { exit(1) }
    let box = page.getBoxRect(.mediaBox)
    let scale = 96.0 / 72.0
    let w = Int((box.width * scale).rounded()), h = Int((box.height * scale).rounded())
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    ctx.drawPDFPage(page)
    let url = URL(fileURLWithPath: "\(args[2])-\(n).png") as CFURL
    let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    CGImageDestinationFinalize(dest)
}
