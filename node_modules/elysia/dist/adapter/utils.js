"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: !0 });
}, __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: !0 }), mod);
var utils_exports = {};
__export(utils_exports, {
  createResponseHandler: () => createResponseHandler,
  createStreamHandler: () => createStreamHandler,
  handleFile: () => handleFile,
  handleSet: () => handleSet,
  mergeHeaders: () => mergeHeaders,
  mergeStatus: () => mergeStatus,
  parseSetCookies: () => parseSetCookies,
  responseToSetHeaders: () => responseToSetHeaders,
  streamResponse: () => streamResponse,
  tee: () => tee
});
module.exports = __toCommonJS(utils_exports);
var import_cookies = require('../cookies.js'), import_utils = require('../utils.js'), import_utils2 = require('../universal/utils.js');
const handleFile = (response, set, request) => {
  if (!import_utils2.isBun && response instanceof Promise)
    return response.then((res) => handleFile(res, set, request));
  const size = response.size, rangeHeader = request?.headers.get("range");
  if (rangeHeader) {
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      if (!match[1] && !match[2])
        return new Response(null, {
          status: 416,
          headers: mergeHeaders(
            new Headers({ "content-range": `bytes */${size}` }),
            set?.headers ?? {}
          )
        });
      let start, end;
      if (!match[1] && match[2]) {
        const suffix = parseInt(match[2]);
        start = Math.max(0, size - suffix), end = size - 1;
      } else
        start = match[1] ? parseInt(match[1]) : 0, end = match[2] ? Math.min(parseInt(match[2]), size - 1) : size - 1;
      if (start >= size || start > end)
        return new Response(null, {
          status: 416,
          headers: mergeHeaders(
            new Headers({ "content-range": `bytes */${size}` }),
            set?.headers ?? {}
          )
        });
      const contentLength = end - start + 1, rangeHeaders = new Headers({
        "accept-ranges": "bytes",
        "content-range": `bytes ${start}-${end}/${size}`,
        "content-length": String(contentLength)
      });
      return new Response(
        response.slice(start, end + 1, response.type),
        {
          status: 206,
          headers: mergeHeaders(rangeHeaders, set?.headers ?? {})
        }
      );
    }
  }
  const immutable = set && (set.status === 206 || set.status === 304 || set.status === 412 || set.status === 416), defaultHeader = immutable ? {} : {
    "accept-ranges": "bytes",
    "content-range": size ? `bytes 0-${size - 1}/${size}` : void 0
  };
  if (!set && !size) return new Response(response);
  if (!set)
    return new Response(response, {
      headers: defaultHeader
    });
  if (set.headers instanceof Headers) {
    for (const key of Object.keys(defaultHeader))
      key in set.headers && set.headers.append(key, defaultHeader[key]);
    return immutable && (set.headers.delete("content-length"), set.headers.delete("accept-ranges")), new Response(response, set);
  }
  return (0, import_utils.isNotEmpty)(set.headers) ? new Response(response, {
    status: set.status,
    headers: Object.assign(defaultHeader, set.headers)
  }) : new Response(response, {
    status: set.status,
    headers: defaultHeader
  });
}, parseSetCookies = (headers, setCookie) => {
  if (!headers) return headers;
  headers.delete("set-cookie");
  for (let i = 0; i < setCookie.length; i++) {
    const index = setCookie[i].indexOf("=");
    headers.append(
      "set-cookie",
      `${setCookie[i].slice(0, index)}=${setCookie[i].slice(index + 1) || ""}`
    );
  }
  return headers;
}, responseToSetHeaders = (response, set) => {
  if (set?.headers) {
    if (response)
      if (import_utils.hasHeaderShorthand)
        Object.assign(set.headers, response.headers.toJSON());
      else
        for (const [key, value] of response.headers.entries())
          key in set.headers && (set.headers[key] = value);
    return set.status === 200 && (set.status = response.status), set.headers["content-encoding"] && delete set.headers["content-encoding"], set;
  }
  if (!response)
    return {
      headers: {},
      status: set?.status ?? 200
    };
  if (import_utils.hasHeaderShorthand)
    return set = {
      headers: response.headers.toJSON(),
      status: set?.status ?? 200
    }, set.headers["content-encoding"] && delete set.headers["content-encoding"], set;
  set = {
    headers: {},
    status: set?.status ?? 200
  };
  for (const [key, value] of response.headers.entries())
    key !== "content-encoding" && key in set.headers && (set.headers[key] = value);
  return set;
}, enqueueBinaryChunk = (controller, chunk) => chunk instanceof Blob ? chunk.arrayBuffer().then((buffer) => (controller.enqueue(new Uint8Array(buffer)), !0)) : chunk instanceof Uint8Array ? (controller.enqueue(chunk), !0) : chunk instanceof ArrayBuffer ? (controller.enqueue(new Uint8Array(chunk)), !0) : ArrayBuffer.isView(chunk) ? (controller.enqueue(
  new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
), !0) : !1, createStreamHandler = ({ mapResponse, mapCompactResponse }) => async (generator, set, request, skipFormat) => {
  let init = generator.next?.();
  if (set && handleSet(set), init instanceof Promise && (init = await init), init?.value instanceof ReadableStream)
    generator = init.value;
  else if (init && (typeof init?.done > "u" || init?.done))
    return set ? mapResponse(init.value, set, request) : mapCompactResponse(init.value, request);
  const isSSE = !skipFormat && // @ts-ignore First SSE result is wrapped with sse()
  (init?.value?.sse ?? // @ts-ignore ReadableStream is wrapped with sse()
  generator?.sse ?? // User explicitly set content-type to SSE
  set?.headers["content-type"]?.startsWith("text/event-stream")), format = isSSE ? (data) => `data: ${data}

` : (data) => data, contentType = isSSE ? "text/event-stream" : init?.value && typeof init?.value == "object" ? "application/json" : "text/plain";
  set?.headers ? (set.headers["transfer-encoding"] || (set.headers["transfer-encoding"] = "chunked"), set.headers["content-type"] || (set.headers["content-type"] = contentType), set.headers["cache-control"] || (set.headers["cache-control"] = "no-cache")) : set = {
    status: 200,
    headers: {
      "content-type": contentType,
      "transfer-encoding": "chunked",
      "cache-control": "no-cache",
      connection: "keep-alive"
    }
  };
  const iterator = typeof generator.next == "function" ? generator : generator[Symbol.asyncIterator]();
  let end = !1;
  return new Response(
    new ReadableStream({
      start(controller) {
        if (request?.signal?.addEventListener("abort", () => {
          end = !0, iterator.return?.();
          try {
            controller.close();
          } catch {
          }
        }), !(!init || init.value instanceof ReadableStream || init.value === void 0 || init.value === null))
          if (init.value.toSSE)
            controller.enqueue(init.value.toSSE());
          else {
            if (enqueueBinaryChunk(controller, init.value)) return;
            if (typeof init.value == "object")
              try {
                controller.enqueue(
                  format(JSON.stringify(init.value))
                );
              } catch {
                controller.enqueue(format(init.value.toString()));
              }
            else controller.enqueue(format(init.value.toString()));
          }
      },
      async pull(controller) {
        if (end) {
          try {
            controller.close();
          } catch {
          }
          return;
        }
        try {
          const { value: chunk, done } = await iterator.next();
          if (done || end) {
            try {
              controller.close();
            } catch {
            }
            return;
          }
          if (chunk == null) return;
          if (chunk.toSSE)
            controller.enqueue(chunk.toSSE());
          else {
            if (enqueueBinaryChunk(controller, chunk)) return;
            if (typeof chunk == "object")
              try {
                controller.enqueue(
                  format(JSON.stringify(chunk))
                );
              } catch {
                controller.enqueue(format(chunk.toString()));
              }
            else controller.enqueue(format(chunk.toString()));
          }
        } catch (error) {
          console.warn(error);
          try {
            controller.close();
          } catch {
          }
        }
      },
      cancel() {
        end = !0, iterator.return?.();
      }
    }),
    set
  );
};
async function* streamResponse(response) {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader(), decoder = new TextDecoder();
  try {
    for (; ; ) {
      const { done, value } = await reader.read();
      if (done) break;
      typeof value == "string" ? yield value : yield decoder.decode(value);
    }
  } finally {
    reader.releaseLock();
  }
}
const handleSet = (set) => {
  if (typeof set.status == "string" && (set.status = import_utils.StatusMap[set.status]), set.cookie && (0, import_utils.isNotEmpty)(set.cookie)) {
    const cookie = (0, import_cookies.serializeCookie)(set.cookie);
    cookie && (set.headers["set-cookie"] = cookie);
  }
  set.headers["set-cookie"] && Array.isArray(set.headers["set-cookie"]) && (set.headers = parseSetCookies(
    new Headers(set.headers),
    set.headers["set-cookie"]
  ));
};
function mergeHeaders(responseHeaders, setHeaders) {
  const headers = new Headers(responseHeaders);
  if (setHeaders instanceof Headers)
    for (const key of setHeaders.keys())
      if (key === "set-cookie") {
        if (headers.has("set-cookie")) continue;
        for (const cookie of setHeaders.getSetCookie())
          headers.append("set-cookie", cookie);
      } else responseHeaders.has(key) || headers.set(key, setHeaders?.get(key) ?? "");
  else
    for (const key in setHeaders)
      key === "set-cookie" ? headers.append(key, setHeaders[key]) : responseHeaders.has(key) || headers.set(key, setHeaders[key]);
  return headers;
}
function mergeStatus(responseStatus, setStatus) {
  return typeof setStatus == "string" && (setStatus = import_utils.StatusMap[setStatus]), responseStatus === 200 ? setStatus : responseStatus;
}
const createResponseHandler = (handler) => {
  const handleStream = createStreamHandler(handler);
  return (response, set, request) => {
    const newResponse = new Response(response.body, {
      headers: mergeHeaders(response.headers, set.headers),
      status: mergeStatus(response.status, set.status)
    });
    return !newResponse.headers.has("content-length") && newResponse.headers.get("transfer-encoding") === "chunked" ? handleStream(
      streamResponse(newResponse),
      responseToSetHeaders(newResponse, set),
      request,
      !0
      // don't auto-format SSE for pre-formatted Response
    ) : newResponse;
  };
};
async function tee(source, branches = 2) {
  const buffer = [];
  let done = !1, waiting = [];
  (async () => {
    for await (const value of source)
      buffer.push(value), waiting.forEach((w) => w.resolve()), waiting = [];
    done = !0, waiting.forEach((w) => w.resolve());
  })();
  async function* makeIterator() {
    let i = 0;
    for (; ; )
      if (i < buffer.length)
        yield buffer[i++];
      else {
        if (done)
          return;
        await new Promise((resolve) => waiting.push({ resolve }));
      }
  }
  return Array.from({ length: branches }, makeIterator);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  createResponseHandler,
  createStreamHandler,
  handleFile,
  handleSet,
  mergeHeaders,
  mergeStatus,
  parseSetCookies,
  responseToSetHeaders,
  streamResponse,
  tee
});
