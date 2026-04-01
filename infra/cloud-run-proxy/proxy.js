const http = require("http");

const TARGET = process.env.TARGET_URL || "http://34.59.124.147:3100";
const PORT = parseInt(process.env.PORT || "8080");

http.createServer((req, res) => {
  let body = [];
  req.on("data", (chunk) => body.push(chunk));
  req.on("end", () => {
    const url = new URL(req.url, TARGET);
    const opts = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: req.method,
      headers: { ...req.headers, host: url.host },
    };
    const proxy = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxy.on("error", (err) => {
      res.writeHead(502);
      res.end("Bad Gateway: " + err.message);
    });
    proxy.write(Buffer.concat(body));
    proxy.end();
  });
}).listen(PORT, () => console.log("Proxy on port " + PORT));
