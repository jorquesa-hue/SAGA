/*
 * Read-only demo shim for the SAGA console.
 *
 * The console is a real client of a real API. This script lets the genuine
 * build run on any static host with no server behind it, by answering the
 * API calls from a snapshot captured against the seeded JQ Farm tenant.
 *
 * It patches window.fetch BEFORE the app's module bundle loads (it is a
 * blocking <script> in <head>, injected by scripts/demo/place-static-demo.mjs),
 * so every JkPlatformClient built later reads this patched fetch.
 *
 *   GET  /api/v1/<path>  → the captured response, or a 404 problem+json when the
 *                          path is outside the snapshot.
 *   other methods        → 501: this is a demonstration, writes need the API and
 *                          the database. Nothing here fakes a successful command.
 *
 * All data is synthetic (database/seeds/README.md). No secret or credential is
 * embedded — the snapshot is public read models of invented records.
 */
(function () {
  var BASE = "/api/v1/";
  var realFetch = window.fetch.bind(window);
  // One load, shared by every call; the app starts fetching immediately, so the
  // patched fetch awaits this rather than assuming the map is already present.
  var mapPromise = realFetch("/_demo/snapshot.json").then(function (r) {
    return r.json();
  });

  function problem(status, detail, code) {
    return new Response(JSON.stringify({ status: status, detail: detail, code: code }), {
      status: status,
      headers: { "content-type": "application/problem+json" },
    });
  }

  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : input && input.url ? input.url : "";
    var at = url.indexOf(BASE);
    if (at === -1) return realFetch(input, init);

    var method = ((init && init.method) || "GET").toUpperCase();
    if (method !== "GET") {
      return problem(
        501,
        "Demonstração somente leitura — comandos precisam da API e do banco de dados.",
        "DEMO-READ-ONLY",
      );
    }

    var path = url.slice(at + BASE.length);
    var q = path.indexOf("?");
    if (q !== -1) path = path.slice(0, q); // static hosting has no query
    path = path.replace(/\/+$/, "");

    var map = await mapPromise;
    var body = map[path];
    if (body === undefined) body = map[decodeURIComponent(path)];
    if (body === undefined) {
      return problem(
        404,
        "Este recurso não faz parte do recorte da demonstração.",
        "DEMO-READ-ONLY",
      );
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-correlation-id": "demo-" + Math.random().toString(36).slice(2, 10),
      },
    });
  };
})();
