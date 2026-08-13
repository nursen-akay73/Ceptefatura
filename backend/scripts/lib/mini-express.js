// TEST-ONLY sahte Express motoru.
//
// Gerçek 'express' npm paketinin YERİNE, sadece test-mock-integration.js çalışırken
// require-override.js aracılığıyla enjekte edilir. Amaç: app.js ve *.routes.js
// dosyalarını TEK SATIR DEĞİŞTİRMEDEN, gerçek middleware/router zincirini
// (requireAuth, asyncHandler, merkezi hata middleware'i, router mount sırası vb.)
// bellek içinde simüle edip test edebilmek.
//
// Üretimde KULLANILMAZ — npm install sonrası gerçek 'express' paketi devrededir,
// bu dosyaya hiç dokunulmaz.

function matchPath(routePath, actualPath) {
  const routeParts = routePath.split("/").filter(Boolean);
  const actualParts = actualPath.split("/").filter(Boolean);
  if (routeParts.length !== actualParts.length) return null;
  const params = {};
  for (let i = 0; i < routeParts.length; i++) {
    const rp = routeParts[i];
    const ap = decodeURIComponent(actualParts[i]);
    if (rp.startsWith(":")) {
      params[rp.slice(1)] = ap;
    } else if (rp !== ap) {
      return null;
    }
  }
  return params;
}

function stripPrefix(path, prefix) {
  const prefixParts = prefix.split("/").filter(Boolean);
  const pathParts = path.split("/").filter(Boolean);
  for (const pp of prefixParts) {
    if (pathParts[0] !== pp) return null;
    pathParts.shift();
  }
  return "/" + pathParts.join("/");
}

class MiniRouter {
  constructor() {
    this.stack = [];
  }
  use(a, b) {
    if (typeof a === "function" || a instanceof MiniRouter) {
      this.stack.push({ kind: "mw", path: null, target: a });
    } else {
      this.stack.push({ kind: "mw", path: a, target: b });
    }
  }
  _route(method, path, handlers) {
    this.stack.push({ kind: "route", method, path, handlers });
  }
  get(path, ...h) { this._route("GET", path, h); }
  post(path, ...h) { this._route("POST", path, h); }
  put(path, ...h) { this._route("PUT", path, h); }
  delete(path, ...h) { this._route("DELETE", path, h); }
}

// Express'in gerçek middleware/hata zincirini taklit eder: sırayla stack'i gezer,
// hata varsa sadece 4 parametreli ("errmw") katmanlara uğrar, mount edilmiş
// router'lar için path prefix'ini soyup alt stack'i çalıştırır.
function runStack(stack, req, res, onExhausted) {
  let i = 0;
  function next(err) {
    if (i >= stack.length) {
      onExhausted(err);
      return;
    }
    const layer = stack[i++];

    if (err) {
      if (layer.kind === "errmw") {
        try {
          layer.target(err, req, res, next);
        } catch (e) {
          next(e);
        }
      } else {
        next(err);
      }
      return;
    }

    if (layer.kind === "errmw") {
      next();
      return;
    }

    if (layer.kind === "mw") {
      if (layer.target instanceof MiniRouter) {
        const rest = layer.path ? stripPrefix(req.path, layer.path) : req.path;
        if (rest === null) {
          next();
          return;
        }
        const savedPath = req.path;
        req.path = rest;
        runStack(layer.target.stack, req, res, (subErr) => {
          req.path = savedPath;
          next(subErr);
        });
        return;
      }
      if (layer.path && matchPath(layer.path, req.path) === null) {
        next();
        return;
      }
      try {
        layer.target(req, res, next);
      } catch (e) {
        next(e);
      }
      return;
    }

    if (layer.kind === "route") {
      if (layer.method !== req.method) {
        next();
        return;
      }
      const params = matchPath(layer.path, req.path);
      if (params === null) {
        next();
        return;
      }
      req.params = params;
      runHandlers(layer.handlers, 0);
      function runHandlers(handlers, idx) {
        if (idx >= handlers.length) {
          next();
          return;
        }
        try {
          handlers[idx](req, res, (e) => {
            if (e) next(e);
            else runHandlers(handlers, idx + 1);
          });
        } catch (e) {
          next(e);
        }
      }
      return;
    }

    next();
  }
  next();
}

function createApp() {
  const router = new MiniRouter();
  const app = {
    use: (a, b) => {
      if (typeof a === "function" && a.length === 4) {
        router.stack.push({ kind: "errmw", target: a });
      } else {
        router.use(a, b);
      }
    },
    get: (path, ...h) => router._route("GET", path, h),
    post: (path, ...h) => router._route("POST", path, h),
    put: (path, ...h) => router._route("PUT", path, h),
    delete: (path, ...h) => router._route("DELETE", path, h),
    _router: router,
  };
  return app;
}

function noopMiddleware(_req, _res, next) {
  next();
}

function express() {
  return createApp();
}
express.Router = () => new MiniRouter();
express.json = () => noopMiddleware; // testte body zaten JS objesi olarak veriliyor
express.urlencoded = () => noopMiddleware;

// Gerçek bir HTTP sunucusu açmadan, app'in middleware/router zincirini simüle eder.
async function request(app, { method, path, headers = {}, body = null }) {
  const url = new URL("http://mock" + path);
  const req = {
    method: method.toUpperCase(),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams.entries()),
    params: {},
    headers,
    body,
  };

  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      _sent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        if (this._sent) return;
        this._sent = true;
        resolve({ status: this.statusCode, body: payload });
      },
      send(payload) {
        if (this._sent) return;
        this._sent = true;
        resolve({ status: this.statusCode, body: payload });
      },
    };

    runStack(app._router.stack, req, res, (err) => {
      if (res._sent) return; // yanıt zaten route içinde gönderilmiş olabilir
      if (err) {
        resolve({ status: 500, body: { error: err.message || "Sunucu hatası (yakalanmadı)" } });
      } else {
        resolve({ status: 404, body: { error: "Endpoint bulunamadı (mini-express fallback)" } });
      }
    });
  });
}

module.exports = express;
module.exports.request = request;
module.exports.MiniRouter = MiniRouter;
