// ============================================================
//  server.js  —  API UMAMI Restaurante (Versión Estable)
//  Backend para Railway (MySQL) + compatible con App Flutter
// ============================================================

const express  = require("express");
const mysql    = require("mysql2/promise");
const cors     = require("cors");
const ExcelJS  = require("exceljs");
const PDFDocument = require("pdfkit-table");
const os       = require("os");

const app = express();

// Configuración de Middlewares
app.use(cors());
app.use(express.json());

// ── Configuration de Conexión a MySQL ──
const connectionUrl =
    process.env.MYSQL_URL       ||
    process.env.DATABASE_URL    ||
    process.env.MYSQL_PUBLIC_URL ||
    null;

const pool = connectionUrl
    ? mysql.createPool({
          uri: connectionUrl,
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
      })
    : mysql.createPool({
          host:     process.env.MYSQLHOST     || process.env.DB_HOST     || "localhost",
          port:     Number(process.env.MYSQLPORT || process.env.DB_PORT) || 3306,
          user:     process.env.MYSQLUSER    || process.env.DB_USER     || "root",
          password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || "230223",
          database: process.env.MYSQLDATABASE || process.env.DB_NAME    || "UMAMI_DB",
          waitForConnections: true,
          connectionLimit: 10,
          queueLimit: 0,
      });

// ── Logger de Solicitudes ──
app.use((req, _res, next) => {
    console.log(`\n[REQ] [${new Date().toLocaleTimeString()}] ${req.method} ${req.url}`);
    if (req.body && Object.keys(req.body).length > 0) {
        console.log("   [BODY]", JSON.stringify(req.body));
    }
    next();
});

// ── Utilidades ──
function hoyLocal() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function fechaValida(f) {
    return /^\d{4}-\d{2}-\d{2}$/.test(f);
}

function responderError(res, contexto, err, status = 500) {
    console.error(`[ERROR] ${contexto}:`, err ? err.message : err);
    if (res.headersSent) return res.end();
    return res.status(status).json({ 
        status: "error", 
        mensaje: err ? err.message : "Error interno del servidor" 
    });
}

// ── Asegurar esquema mínimo ──
async function asegurarEsquema() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS usuarios (
                id       INT AUTO_INCREMENT PRIMARY KEY,
                usuario  VARCHAR(50) NOT NULL UNIQUE,
                clave    VARCHAR(255) NOT NULL,
                rol      ENUM('Administrador', 'Mesero', 'Cocinero', 'Cliente') NOT NULL,
                mesa_id  INT DEFAULT NULL,
                activo   TINYINT(1) NOT NULL DEFAULT 1,
                creado   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categorias (
                id       INT AUTO_INCREMENT PRIMARY KEY,
                nombre   VARCHAR(60) NOT NULL UNIQUE,
                orden    INT NOT NULL DEFAULT 0,
                creado   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS platillos (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                id_categoria INT NOT NULL,
                nombre       VARCHAR(120) NOT NULL,
                descripcion  TEXT,
                precio       DECIMAL(10,2) NOT NULL DEFAULT 0,
                foto_src     VARCHAR(500) DEFAULT NULL,
                disponible   TINYINT(1) NOT NULL DEFAULT 1,
                creado       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (id_categoria) REFERENCES categorias(id) ON DELETE RESTRICT
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS mesas (
                numero       INT PRIMARY KEY,
                capacidad    INT NOT NULL DEFAULT 4,
                estado       ENUM('libre','ordenando','en_cocina','lista','cuenta_pedida','pagada')
                             NOT NULL DEFAULT 'libre',
                qr_token     VARCHAR(100) DEFAULT NULL,
                qr_escaneado TINYINT(1) DEFAULT 0,
                creado       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedidos (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                mesa_numero  INT NOT NULL,
                estado       ENUM('recibido','preparando','listo','entregado','cancelado')
                             NOT NULL DEFAULT 'recibido',
                total        DECIMAL(10,2) DEFAULT 0,
                creado       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (mesa_numero) REFERENCES mesas(numero) ON DELETE CASCADE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pedido_items (
                id              INT AUTO_INCREMENT PRIMARY KEY,
                pedido_id       INT NOT NULL,
                platillo_id     INT NOT NULL,
                cantidad        INT NOT NULL DEFAULT 1,
                nota            VARCHAR(200) DEFAULT NULL,
                estado          ENUM('recibido','preparando','listo','entregado','cancelado')
                                NOT NULL DEFAULT 'recibido',
                precio_unitario DECIMAL(10,2) NOT NULL,
                FOREIGN KEY (pedido_id)   REFERENCES pedidos(id) ON DELETE CASCADE,
                FOREIGN KEY (platillo_id) REFERENCES platillos(id) ON DELETE RESTRICT
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS meseros (
                id       INT AUTO_INCREMENT PRIMARY KEY,
                nombre   VARCHAR(100) NOT NULL,
                activo   TINYINT(1) NOT NULL DEFAULT 1,
                creado   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS pagos (
                id           INT AUTO_INCREMENT PRIMARY KEY,
                mesa_numero  INT NOT NULL,
                pedido_id    INT NOT NULL,
                monto        DECIMAL(10,2) NOT NULL,
                metodo       ENUM('efectivo','tarjeta','transferencia','mixto') NOT NULL DEFAULT 'efectivo',
                estado       ENUM('pendiente','solicitado','autorizado','pagado') NOT NULL DEFAULT 'pendiente',
                creado       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                actualizado  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (mesa_numero) REFERENCES mesas(numero) ON DELETE CASCADE,
                FOREIGN KEY (pedido_id)   REFERENCES pedidos(id) ON DELETE CASCADE
            )
        `);
        console.log("[OK] [ESQUEMA] Tablas verificadas/creadas correctamente");
    } catch (err) {
        console.error("[ERROR] [ESQUEMA] No se pudo verificar el esquema:", err.message);
    }
}

// ── Salud del Servidor ──
app.get("/", (_req, res) => {
    res.json({ status: "ok", servicio: "UMAMI Restaurante API" });
});

app.get("/health", async (_req, res) => {
    try {
        await pool.query("SELECT 1");
        res.json({ status: "ok", database: "conectada" });
    } catch (err) {
        res.status(500).json({ status: "error", database: "desconectada", mensaje: err.message });
    }
});

// ============================================================
//  AUTENTICACIÓN Y USUARIOS
// ============================================================

app.post("/login", async (req, res) => {
    const { usuario, clave } = req.body;
    console.log(`   [LOGIN] Intento de login para usuario: ${usuario}`);

    if (!usuario || !clave) {
        return res.status(400).json({ status: "error", mensaje: "Ingresa usuario y contraseña" });
    }

    try {
        const [rows] = await pool.query(
            "SELECT id, usuario, clave, rol, mesa_id, activo FROM usuarios WHERE usuario = ?",
            [usuario]
        );

        if (rows.length === 0) {
            return res.status(401).json({ status: "error", mensaje: "Usuario o contraseña incorrectos" });
        }

        const user = rows[0];

        if (!user.activo) {
            return res.status(403).json({ status: "error", mensaje: "El usuario está inactivo" });
        }

        if (user.clave !== String(clave)) {
            return res.status(401).json({ status: "error", mensaje: "Usuario o contraseña incorrectos" });
        }

        delete user.clave;

        res.json({
            status: "ok",
            mensaje: "Inicio de sesión exitoso",
            usuario: user
        });
    } catch (err) {
        responderError(res, "Fallo al iniciar sesión", err);
    }
});

app.post("/registro", async (req, res) => {
    const { usuario, clave, rol, mesa_id } = req.body;

    if (!usuario || !clave || !rol) {
        return res.status(400).json({ status: "error", mensaje: "Faltan campos obligatorios" });
    }

    try {
        const [result] = await pool.query(
            "INSERT INTO usuarios (usuario, clave, rol, mesa_id, activo) VALUES (?, ?, ?, ?, 1)",
            [usuario, clave, rol, mesa_id || null]
        );

        res.status(201).json({
            status: "ok",
            mensaje: "Usuario registrado con éxito",
            id: result.insertId
        });
    } catch (err) {
        responderError(res, "Fallo al registrar usuario", err);
    }
});

// ============================================================
//  CATEGORÍAS
// ============================================================
app.get("/categorias", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT id, nombre, orden FROM categorias ORDER BY orden");
        res.json(rows);
    } catch (err) {
        responderError(res, "Fallo al listar categorías", err);
    }
});

// ============================================================
//  PLATILLOS
// ============================================================
app.get("/platillos", async (req, res) => {
    const cat = req.query.categoria;
    try {
        let sql = `
            SELECT p.id, p.id_categoria, p.nombre, p.descripcion,
                   p.precio, p.foto_src, p.disponible,
                   c.nombre AS categoria_nombre
            FROM platillos p
            JOIN categorias c ON p.id_categoria = c.id
            WHERE p.disponible = 1
        `;
        const params = [];
        if (cat) {
            sql += " AND p.id_categoria = ?";
            params.push(cat);
        }
        sql += " ORDER BY c.orden, p.nombre";

        const [rows] = await pool.query(sql, params);
        res.json(rows);
    } catch (err) {
        responderError(res, "Fallo al listar platillos", err);
    }
});

app.get("/platillo/:id", async (req, res) => {
    const id = req.params.id;
    try {
        const [rows] = await pool.query(
            `SELECT p.*, c.nombre AS categoria_nombre
             FROM platillos p
             JOIN categorias c ON p.id_categoria = c.id
             WHERE p.id = ?`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ status: "error", mensaje: "Platillo no encontrado" });
        }
        res.json(rows[0]);
    } catch (err) {
        responderError(res, `Fallo al buscar platillo ID ${id}`, err);
    }
});

// ============================================================
//  PEDIDOS
// ============================================================
app.post("/pedido", async (req, res) => {
    const { mesa, items } = req.body;

    if (!mesa || !items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ status: "error", mensaje: "Faltan datos (mesa o items)" });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const platilloIds = items.map(i => i.platillo_id);
        const [platillos] = await connection.query(
            "SELECT id, precio FROM platillos WHERE id IN (?)",
            [platilloIds]
        );

        if (platillos.length !== platilloIds.length) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({ status: "error", mensaje: "Uno o más platillos no existen" });
        }

        const precioMap = {};
        platillos.forEach(p => { precioMap[p.id] = Number(p.precio); });

        let total = 0;
        const enrichedItems = items.map(i => {
            const pu = precioMap[i.platillo_id];
            total += pu * (i.cantidad || 1);
            return { ...i, precio_unitario: pu };
        });

        const [pedidoRes] = await connection.query(
            "INSERT INTO pedidos (mesa_numero, estado, total) VALUES (?, 'recibido', ?)",
            [mesa, total]
        );
        const pedidoId = pedidoRes.insertId;

        for (const item of enrichedItems) {
            await connection.query(
                "INSERT INTO pedido_items (pedido_id, platillo_id, cantidad, nota, estado, precio_unitario) VALUES (?, ?, ?, ?, 'recibido', ?)",
                [pedidoId, item.platillo_id, item.cantidad || 1, item.nota || null, item.precio_unitario]
            );
        }

        await connection.query(
            "UPDATE mesas SET estado = 'en_cocina' WHERE numero = ?",
            [mesa]
        );

        await connection.commit();
        connection.release();

        res.status(201).json({
            status: "ok",
            mensaje: "Orden enviada",
            pedido_id: pedidoId,
            total
        });
    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        responderError(res, "Fallo al crear pedido", err);
    }
});

app.get("/pedido/:mesa", async (req, res) => {
    const mesa = req.params.mesa;
    try {
        const [pedidos] = await pool.query(
            `SELECT p.id, p.estado, p.total, p.creado, p.actualizado,
                    (SELECT JSON_ARRAYAGG(
                        JSON_OBJECT('id', pi.id, 'platillo_id', pi.platillo_id,
                                    'nombre', pl.nombre, 'cantidad', pi.cantidad,
                                    'nota', pi.nota, 'estado', pi.estado,
                                    'precio_unitario', pi.precio_unitario)
                     ) FROM pedido_items pi
                     JOIN platillos pl ON pi.platillo_id = pl.id
                     WHERE pi.pedido_id = p.id) AS items
             FROM pedidos p
             WHERE p.mesa_numero = ? AND p.estado NOT IN ('entregado','cancelado')
             ORDER BY p.creado DESC LIMIT 1`,
            [mesa]
        );
        if (pedidos.length === 0) {
            return res.json({ status: "ok", pedido: null });
        }
        const pedido = pedidos[0];
        if (typeof pedido.items === "string") {
            try { pedido.items = JSON.parse(pedido.items); } catch(e) { pedido.items = []; }
        }
        res.json({ status: "ok", pedido });
    } catch (err) {
        responderError(res, `Fallo al consultar pedido de mesa ${mesa}`, err);
    }
});

app.put("/pedido/:mesa/estado", async (req, res) => {
    const mesa = Number(req.params.mesa);
    const { estado } = req.body;
    const estadosValidos = ["recibido","preparando","listo","entregado","cancelado"];

    if (!estado || !estadosValidos.includes(estado)) {
        return res.status(400).json({ status: "error", mensaje: `Estado inválido. Válidos: ${estadosValidos.join(", ")}` });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [pedidos] = await connection.query(
            "SELECT id, estado FROM pedidos WHERE mesa_numero = ? AND estado NOT IN ('entregado','cancelado') ORDER BY creado DESC LIMIT 1",
            [mesa]
        );
        if (pedidos.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ status: "error", mensaje: "No hay pedido activo para esta mesa" });
        }

        const pedidoId = pedidos[0].id;
        await connection.query("UPDATE pedidos SET estado = ? WHERE id = ?", [estado, pedidoId]);

        let nuevoEstadoMesa = null;
        if (estado === "entregado") {
            nuevoEstadoMesa = "lista";
        } else if (estado === "preparando") {
            nuevoEstadoMesa = "en_cocina";
        } else if (estado === "cancelado") {
            const [otros] = await connection.query(
                "SELECT COUNT(*) AS total FROM pedidos WHERE mesa_numero = ? AND estado NOT IN ('entregado','cancelado') AND id != ?",
                [mesa, pedidoId]
            );
            nuevoEstadoMesa = otros[0].total > 0 ? "en_cocina" : "libre";
        }

        if (nuevoEstadoMesa) {
            await connection.query("UPDATE mesas SET estado = ? WHERE numero = ?", [nuevoEstadoMesa, mesa]);
        }

        await connection.commit();
        connection.release();

        res.json({ status: "ok", mensaje: `Pedido actualizado a ${estado}` });
    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        responderError(res, `Fallo al cambiar estado de pedido (mesa ${mesa})`, err);
    }
});

// ============================================================
//  MESAS
// ============================================================
app.get("/mesas", async (_req, res) => {
    try {
        const [rows] = await pool.query("SELECT numero, capacidad, estado, qr_escaneado FROM mesas ORDER BY numero");
        res.json(rows);
    } catch (err) {
        responderError(res, "Fallo al listar mesas", err);
    }
});

app.get("/mesa/:numero", async (req, res) => {
    const numero = req.params.numero;
    try {
        const [rows] = await pool.query("SELECT numero, capacidad, estado, qr_escaneado FROM mesas WHERE numero = ?", [numero]);
        if (rows.length === 0) {
            return res.status(404).json({ status: "error", mensaje: "Mesa no encontrada" });
        }
        res.json(rows[0]);
    } catch (err) {
        responderError(res, `Fallo al consultar mesa ${numero}`, err);
    }
});

// ============================================================
//  PAGO / CUENTA
// ============================================================
app.post("/solicitar-cuenta", async (req, res) => {
    const { mesa } = req.body;
    if (!mesa) return res.status(400).json({ status: "error", mensaje: "Falta número de mesa" });

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [pedidos] = await connection.query(
            "SELECT id, total FROM pedidos WHERE mesa_numero = ? AND estado NOT IN ('entregado','cancelado') ORDER BY creado DESC LIMIT 1",
            [mesa]
        );
        if (pedidos.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ status: "error", mensaje: "No hay pedido activo" });
        }

        const pedidoId = pedidos[0].id;
        const total = Number(pedidos[0].total);

        const [pagos] = await connection.query(
            "SELECT id FROM pagos WHERE mesa_numero = ? AND pedido_id = ? AND estado IN ('pendiente','solicitado') LIMIT 1",
            [mesa, pedidoId]
        );

        let pagoId;
        if (pagos.length > 0) {
            await connection.query("UPDATE pagos SET estado = 'solicitado', actualizado = NOW() WHERE id = ?", [pagos[0].id]);
            pagoId = pagos[0].id;
        } else {
            const [pagoRes] = await connection.query(
                "INSERT INTO pagos (mesa_numero, pedido_id, monto, metodo, estado) VALUES (?, ?, ?, 'efectivo', 'solicitado')",
                [mesa, pedidoId, total]
            );
            pagoId = pagoRes.insertId;
        }

        await connection.query("UPDATE mesas SET estado = 'cuenta_pedida' WHERE numero = ?", [mesa]);

        await connection.commit();
        connection.release();

        res.json({ status: "ok", mensaje: "Cuenta solicitada", pago_id: pagoId, total });
    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        responderError(res, `Fallo al solicitar cuenta para mesa ${mesa}`, err);
    }
});

app.put("/pago/:mesa/estado", async (req, res) => {
    const mesa = Number(req.params.mesa);
    const { estado, metodo } = req.body;
    const estadosValidos = ["pendiente","solicitado","autorizado","pagado"];

    if (!estado || !estadosValidos.includes(estado)) {
        return res.status(400).json({ status: "error", mensaje: `Estado inválido` });
    }

    let connection;
    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [pagos] = await connection.query(
            "SELECT id, pedido_id FROM pagos WHERE mesa_numero = ? AND estado IN ('pendiente','solicitado','autorizado') ORDER BY creado DESC LIMIT 1",
            [mesa]
        );
        if (pagos.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({ status: "error", mensaje: "No hay pago pendiente" });
        }

        const pagoId = pagos[0].id;
        const updateFields = [estado];
        let sql = "UPDATE pagos SET estado = ?";
        if (metodo) {
            sql += ", metodo = ?";
            updateFields.push(metodo);
        }
        sql += ", actualizado = NOW() WHERE id = ?";
        updateFields.push(pagoId);

        await connection.query(sql, updateFields);

        if (estado === "pagado") {
            await connection.query("UPDATE mesas SET estado = 'pagada', qr_escaneado = 0 WHERE numero = ?", [mesa]);
            await connection.query("UPDATE pedidos SET estado = 'entregado' WHERE id = ?", [pagos[0].pedido_id]);
        } else if (estado === "autorizado") {
            await connection.query("UPDATE mesas SET estado = 'cuenta_pedida' WHERE numero = ?", [mesa]);
        }

        await connection.commit();
        connection.release();

        res.json({ status: "ok", mensaje: `Pago actualizado a ${estado}` });
    } catch (err) {
        if (connection) {
            await connection.rollback();
            connection.release();
        }
        responderError(res, `Fallo al cambiar estado de pago (mesa ${mesa})`, err);
    }
});

app.get("/pago/:mesa", async (req, res) => {
    const mesa = req.params.mesa;
    try {
        const [rows] = await pool.query(
            "SELECT p.id, p.monto, p.metodo, p.estado, p.creado, p.actualizado FROM pagos p WHERE p.mesa_numero = ? ORDER BY p.creado DESC LIMIT 1",
            [mesa]
        );
        if (rows.length === 0) {
            return res.json({ status: "ok", pago: null });
        }
        res.json({ status: "ok", pago: rows[0] });
    } catch (err) {
        responderError(res, `Fallo al consultar pago de mesa ${mesa}`, err);
    }
});

// Manejador genérico de rutas no encontradas (Evita responder HTML 404)
app.use((_req, res) => {
    res.status(404).json({ status: "error", mensaje: "Ruta de API no encontrada" });
});

// ── Iniciar Servidor ──
const PORT = process.env.PORT || 3000;

asegurarEsquema().finally(() => {
    app.listen(PORT, "0.0.0.0", () => {
        console.log("\n=== Servidor UMAMI Restaurante Listo ===");
        console.log("    Puerto: " + PORT);
        console.log("========================================\n");
    });
});
