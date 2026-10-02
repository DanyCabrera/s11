/**
 * API de pedidos — ejemplo pequeño para explicar en clase.
 *
 * Historia: Ana y Luis compran por separado. Cada uno solo ve y cancela
 * sus propios pedidos. Los datos viven en memoria y se borran al reiniciar
 * o al llamar POST /test/reset.
 *
 * Operaciones:
 *   GET  /orders              lista paginada de mis pedidos
 *   POST /orders              crea un pedido (no es idempotente)
 *   GET  /orders/{id}         consulta un pedido mío
 *   PUT  /orders/{id}/cancel  cancela. Repetirla no cambia el pedido.
 */
const http = require("http");
const { randomUUID } = require("crypto");

const PORT = Number(process.env.PORT) || 3000;

const USERS = {
  "ana-local-token": { id: "ana", name: "Ana" },
  "luis-local-token": { id: "luis", name: "Luis" },
};

/** @type {Array<object>} */
let orders = [];
let sequence = 0;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  res.end(payload);
}

function sendError(res, status, code, message, details) {
  send(res, status, {
    error: {
      code,
      message,
      details: details || [],
    },
  });
}

function fail(status, code, message, details) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details || [];
  return error;
}

/**
 * Forma pública de un pedido.
 * Los nombres tienen que coincidir con components/schemas/Order del OpenAPI.
 * Si aquí se renombra un campo, la colección debe fallar: el contrato no se toca.
 */
function toOrder(order) {
  return {
    id: order.id,
    product: order.product,
    // El contrato OpenAPI exige la propiedad quantity.
    quantity: order.quantity,
    note: order.note,
    status: order.status,
    owner: order.owner,
    createdAt: order.createdAt,
    cancelledAt: order.cancelledAt,
    events: order.events.map((event) => ({ type: event.type, at: event.at })),
  };
}

function authenticate(req) {
  const header = req.headers.authorization || "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    throw fail(401, "UNAUTHORIZED", "Falta el token Bearer", [
      { field: "Authorization", issue: "required" },
    ]);
  }
  const user = USERS[match[1]];
  if (!user) {
    throw fail(401, "UNAUTHORIZED", "Token inválido", [
      { field: "Authorization", issue: "invalid" },
    ]);
  }
  return user;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(fail(400, "VALIDATION_ERROR", "El cuerpo es demasiado grande", [
          { field: "body", issue: "too_large" },
        ]));
        req.destroy();
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.trim() === "") {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(fail(400, "VALIDATION_ERROR", "El cuerpo no es JSON", [
          { field: "body", issue: "invalid_json" },
        ]));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Valida el cuerpo de POST /orders.
 * Esto es validación de entrada. No comprueba el esquema de la respuesta.
 */
function validateCreate(body) {
  const details = [];
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return [{ field: "body", issue: "must_be_object" }];
  }

  const allowed = new Set(["product", "quantity", "note"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) details.push({ field: key, issue: "unexpected" });
  }

  if (body.product === undefined) {
    details.push({ field: "product", issue: "required" });
  } else if (typeof body.product !== "string" || body.product.trim() === "") {
    details.push({ field: "product", issue: "must_be_non_empty_string" });
  } else if (body.product.trim().length > 80) {
    details.push({ field: "product", issue: "max_length_80" });
  }

  if (body.quantity === undefined) {
    details.push({ field: "quantity", issue: "required" });
  } else if (typeof body.quantity !== "number" || !Number.isInteger(body.quantity)) {
    details.push({ field: "quantity", issue: "must_be_integer" });
  } else if (body.quantity < 1 || body.quantity > 100) {
    details.push({ field: "quantity", issue: "must_be_between_1_and_100" });
  }

  if (body.note !== undefined) {
    if (typeof body.note !== "string") {
      details.push({ field: "note", issue: "must_be_string" });
    } else if (body.note.length > 200) {
      details.push({ field: "note", issue: "max_length_200" });
    }
  }

  return details;
}

function parsePageQuery(url) {
  const details = [];
  const pageRaw = url.searchParams.get("page");
  const limitRaw = url.searchParams.get("limit");

  let page = 1;
  let limit = 10;

  if (pageRaw !== null) {
    if (!/^[1-9]\d*$/.test(pageRaw)) {
      details.push({ field: "page", issue: "must_be_integer_gte_1" });
    } else {
      page = Number(pageRaw);
    }
  }

  if (limitRaw !== null) {
    if (!/^[1-9]\d*$/.test(limitRaw)) {
      details.push({ field: "limit", issue: "must_be_integer_gte_1" });
    } else {
      limit = Number(limitRaw);
      if (limit > 20) details.push({ field: "limit", issue: "must_be_lte_20" });
    }
  }

  return { page, limit, details };
}

function listMine(user, page, limit) {
  const mine = orders
    .filter((order) => order.owner === user.id)
    .sort((a, b) => a.seq - b.seq);
  const total = mine.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const items = mine.slice(start, start + limit).map(toOrder);
  return { page, limit, total, totalPages, items };
}

function createOrder(user, body) {
  const details = validateCreate(body);
  if (details.length > 0) {
    throw fail(400, "VALIDATION_ERROR", "El cuerpo no cumple el contrato", details);
  }

  const now = new Date().toISOString();
  const order = {
    seq: ++sequence,
    id: randomUUID(),
    product: body.product.trim(),
    quantity: body.quantity,
    note: body.note === undefined ? "" : body.note,
    status: "pending",
    owner: user.id,
    createdAt: now,
    cancelledAt: null,
    events: [{ type: "created", at: now }],
  };
  orders.push(order);
  return order;
}

function findVisible(user, id) {
  const order = orders.find((item) => item.id === id);
  if (!order) {
    throw fail(404, "NOT_FOUND", "Pedido no encontrado", [
      { field: "id", issue: "not_found" },
    ]);
  }
  if (order.owner !== user.id) {
    throw fail(403, "FORBIDDEN", "El pedido pertenece a otro usuario", [
      { field: "id", issue: "not_owner" },
    ]);
  }
  return order;
}

/**
 * Pone el pedido en estado cancelled.
 * Si ya estaba cancelado, no modifica cancelledAt ni agrega otro evento.
 * Por eso repetir la operación deja el mismo efecto final.
 */
function cancelOrder(order) {
  if (order.status === "pending") {
    const now = new Date().toISOString();
    order.status = "cancelled";
    order.cancelledAt = now;
    order.events.push({ type: "cancelled", at: now });
  }
  return order;
}

async function route(req, res, url) {
  const path = url.pathname;
  const method = req.method;

  if (method === "GET" && path === "/") {
    send(res, 200, {
      name: "API de pedidos",
      hint: "Ana y Luis solo ven sus propios pedidos. La cancelacion se puede repetir sin cambiar el resultado.",
    });
    return;
  }

  if (method === "POST" && path === "/test/reset") {
    authenticate(req);
    orders = [];
    send(res, 200, { ok: true });
    return;
  }

  if (path === "/orders") {
    const user = authenticate(req);
    if (method === "GET") {
      const query = parsePageQuery(url);
      if (query.details.length > 0) {
        sendError(res, 400, "VALIDATION_ERROR", "Los parámetros de paginación no cumplen el contrato", query.details);
        return;
      }
      send(res, 200, listMine(user, query.page, query.limit));
      return;
    }
    if (method === "POST") {
      const body = await readBody(req);
      const order = createOrder(user, body);
      send(res, 201, toOrder(order));
      return;
    }
  }

  const cancelMatch = /^\/orders\/([^/]+)\/cancel$/.exec(path);
  if (cancelMatch && method === "PUT") {
    const user = authenticate(req);
    const order = findVisible(user, cancelMatch[1]);
    cancelOrder(order);
    send(res, 200, toOrder(order));
    return;
  }

  const oneMatch = /^\/orders\/([^/]+)$/.exec(path);
  if (oneMatch && method === "GET") {
    const user = authenticate(req);
    const order = findVisible(user, oneMatch[1]);
    send(res, 200, toOrder(order));
    return;
  }

  sendError(res, 404, "NOT_FOUND", "Ruta no encontrada", [
    { field: "path", issue: "not_found" },
  ]);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  route(req, res, url).catch((error) => {
    if (error.status && error.code) {
      sendError(res, error.status, error.code, error.message, error.details);
      return;
    }
    console.error(error);
    sendError(res, 500, "INTERNAL", "Error interno", []);
  });
});

server.listen(PORT, () => {
  console.log(`API de pedidos escuchando en http://localhost:${PORT}`);
});
