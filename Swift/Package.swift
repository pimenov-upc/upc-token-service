// swift-tools-version: 5.7
import PackageDescription

let package = Package(
    name: "UpcTokenService",
    platforms: [.macOS(.v12), .iOS(.v15)],
    products: [.library(name: "UpcTokenService", targets: ["UpcTokenService"])],
    targets: [.target(name: "UpcTokenService", path: "Sources/UpcTokenService")]
)
