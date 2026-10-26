const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { getFaults, getQuestions, openDatabase, saveAssessment } = require("./database");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3000;
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function readRequestBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 10_000) {
      throw Object.assign(new Error("El envío supera el tamaño permitido."), { status: 413 });
    }
  }
  try {
    return JSON.parse(body);
  } catch {
    throw Object.assign(new Error("El contenido enviado no es JSON válido."), { status: 400 });
  }
}

async function handleApi(request, response, url, database) {
  if (request.method === "GET" && url.pathname === "/api/faults") {
    const category = url.searchParams.get("category");
    return sendJson(response, 200, getFaults(database, category));
  }

  if (request.method === "GET" && url.pathname === "/api/questions") {
    const questions = getQuestions(database).map(({ correctIndex, ...question }) => question);
    return sendJson(response, 200, questions);
  }

  if (request.method === "POST" && url.pathname === "/api/assessments") {
    const { answers } = await readRequestBody(request);
    if (!Array.isArray(answers) || answers.length < 1 || answers.length > 20) {
      return sendJson(response, 400, { error: "Envía de 1 a 20 respuestas." });
    }
    if (answers.some((answer) => typeof answer?.questionId !== "string" || !Number.isInteger(answer.selectedIndex))) {
      return sendJson(response, 400, { error: "Revisa el formato de las respuestas enviadas." });
    }

    const uniqueIds = new Set(answers.map((answer) => answer.questionId));
    if (uniqueIds.size !== answers.length) {
      return sendJson(response, 400, { error: "Hay preguntas duplicadas o desconocidas." });
    }

    if (answers.some(({ selectedIndex }) => selectedIndex < 0)) {
      return sendJson(response, 400, { error: "Hay una opción de respuesta fuera de rango." });
    }
    const assessment = saveAssessment(database, answers);
    if (!assessment) return sendJson(response, 400, { error: "Hay preguntas desconocidas u opciones fuera de rango." });
    return sendJson(response, 200, assessment);
  }

  return sendJson(response, 404, { error: "Ruta de API no encontrada." });
}

function createServer(databasePath) {
  const database = openDatabase(databasePath);
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    try {
      if (url.pathname.startsWith("/api/")) {
        await handleApi(request, response, url, database);
        return;
      }

      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }

      const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const filePath = path.resolve(ROOT, `.${pathname}`);
      if (!filePath.startsWith(`${ROOT}${path.sep}`)) {
        response.writeHead(403);
        response.end();
        return;
      }

      const content = await fs.readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "no-referrer"
      });
      response.end(request.method === "HEAD" ? undefined : content);
    } catch (error) {
      if (error.code === "ENOENT") {
        response.writeHead(404);
        response.end("No encontrado");
        return;
      }
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, error.status || 500, { error: error.message || "Error interno del servidor." });
    }
  });
  server.once("close", () => database.close());
  return server;
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`CECyTO Vial disponible en http://localhost:${PORT}`);
  });
}

module.exports = { createServer, handleApi };
