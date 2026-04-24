import Foundation
import Network

typealias RouteHandler = (String, String, [String: String], Data?) -> (Int, Data)

class HTTPServer {
    private let listener: NWListener
    private let token: String
    private let connQueue = DispatchQueue(label: "cu-helper.connections", attributes: .concurrent)
    var routeHandler: RouteHandler?

    init(port: UInt16, token: String) throws {
        self.token = token
        guard let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw HTTPServerError.invalidPort
        }
        self.listener = try NWListener(using: .tcp, on: nwPort)
    }

    func start() {
        listener.stateUpdateHandler = { state in
            switch state {
            case .ready:
                let p = self.listener.port?.rawValue ?? 0
                fputs("computer-use-helper listening on 127.0.0.1:\(p)\n", stderr)
            case .failed(let error):
                fputs("Server failed: \(error)\n", stderr)
                exit(1)
            default:
                break
            }
        }

        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }

        listener.start(queue: .main)
    }

    func stop() {
        listener.cancel()
    }

    private func accept(_ connection: NWConnection) {
        connection.stateUpdateHandler = { state in
            if case .failed = state { connection.cancel() }
        }
        connection.start(queue: connQueue)
        readRequest(connection: connection, buffer: Data())
    }

    private func readRequest(connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] content, _, isComplete, error in
            guard let self = self else { connection.cancel(); return }

            var buf = buffer
            if let content = content { buf.append(content) }

            if let parsed = self.parseHTTPRequest(buf) {
                let (method, path, headers, body) = parsed

                if !self.token.isEmpty && headers["x-token"] != self.token {
                    self.respond(connection: connection, status: 401,
                                 body: Data("{\"error\":\"unauthorized\"}".utf8))
                    return
                }

                DispatchQueue.global(qos: .userInitiated).async {
                    let (status, responseBody) = self.routeHandler?(method, path, headers, body)
                        ?? (404, Data("{\"error\":\"not found\"}".utf8))
                    self.respond(connection: connection, status: status, body: responseBody)
                }
            } else if isComplete || error != nil {
                connection.cancel()
            } else if buf.count > 10_000_000 {
                connection.cancel()
            } else {
                self.readRequest(connection: connection, buffer: buf)
            }
        }
    }

    private func parseHTTPRequest(_ data: Data) -> (String, String, [String: String], Data?)? {
        let separator = Data("\r\n\r\n".utf8)
        guard let headerEnd = data.range(of: separator) else { return nil }

        let headerData = data[data.startIndex..<headerEnd.lowerBound]
        guard let headerStr = String(data: headerData, encoding: .utf8) else { return nil }

        let lines = headerStr.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else { return nil }

        let parts = requestLine.split(separator: " ", maxSplits: 2)
        guard parts.count >= 2 else { return nil }

        let method = String(parts[0])
        let path = String(parts[1])

        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
            guard let colonIdx = line.firstIndex(of: ":") else { continue }
            let key = line[..<colonIdx].trimmingCharacters(in: .whitespaces).lowercased()
            let value = line[line.index(after: colonIdx)...].trimmingCharacters(in: .whitespaces)
            headers[key] = value
        }

        let bodyStart = headerEnd.upperBound
        if let clStr = headers["content-length"], let cl = Int(clStr), cl > 0 {
            let available = data.count - bodyStart
            if available < cl { return nil }
            let body = data[bodyStart..<(bodyStart + cl)]
            return (method, path, headers, Data(body))
        }

        return (method, path, headers, nil)
    }

    private func respond(connection: NWConnection, status: Int, body: Data) {
        let statusText: String
        switch status {
        case 200: statusText = "OK"
        case 400: statusText = "Bad Request"
        case 401: statusText = "Unauthorized"
        case 404: statusText = "Not Found"
        case 405: statusText = "Method Not Allowed"
        case 500: statusText = "Internal Server Error"
        default: statusText = "Error"
        }

        var header = "HTTP/1.1 \(status) \(statusText)\r\n"
        header += "Content-Type: application/json\r\n"
        header += "Content-Length: \(body.count)\r\n"
        header += "Connection: close\r\n"
        header += "\r\n"

        var responseData = Data(header.utf8)
        responseData.append(body)

        connection.send(content: responseData, completion: .contentProcessed { _ in
            connection.cancel()
        })
    }
}

enum HTTPServerError: Error {
    case invalidPort
}
