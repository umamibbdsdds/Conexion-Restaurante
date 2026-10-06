const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_super_segura_umami';

// Middlewares
app.use(cors());
app.use(express.json());

// Configuración de carpeta pública para cargar imágenes
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}
app.use('/uploads', express.static(uploadsDir));

// Configuración segura de Multer (Solo imágenes y límite de 5MB)
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`)
});

const fileFilter = (req, file, cb) => {
    const filetypes = /jpeg|jpg|png|webp/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

    if (mimetype && extname) {
        return cb(null, true);
    }
    cb(new Error('Solo se permiten imágenes (JPG, PNG, WEBP)'));
};

const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
    fileFilter
});

// ==========================================
// Conexión a la Base de Datos MySQL
// Compatible con Railway (MYSQL_URL / MYSQLHOST...) y variables propias (DB_*)
// ==========================================
let poolConfig;

if (process.env.MYSQL_URL) {
    // Railway expone una URL de conexión completa
    poolConfig = process.env.MYSQL_URL;
} else {
    poolConfig = {
        host: process.env.MYSQLHOST || process.env.DB_HOST || 'localhost',
        port: process.env.MYSQLPORT || process.env.DB_PORT || 3306,
        user: process.env.MYSQLUSER || process.env.DB_USER || 'root',
        password: process.env.MYSQLPASSWORD || process.env.DB_PASSWORD || '',
        database: process.env.MYSQLDATABASE || process.env.DB_NAME || 'restaurante_db',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };
}

const db = mysql.createPool(poolConfig);

// Middleware de Autenticación JWT
const verificarToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ status: 'error', mensaje: 'Acceso denegado: Token no proporcionado' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ status: 'error', mensaje: 'Token inválido o expirado' });
        }
        req.usuario = decoded;
        next();
    });
};

// Healthcheck para Railway
app.get('/', (req, res) => {
    res.json({ status: 'ok', mensaje: 'API Umami en línea' });
});

// ==========================================
// 1. AUTENTICACIÓN / LOGIN CON BCRYPT Y JWT
// ==========================================
app.post('/login', async (req, res) => {
    const { usuario, clave } = req.body;

    if (!usuario || !clave) {
        return res.status(400).json({ status: 'error', mensaje: 'Usuario y clave requeridos' });
    }

    try {
        const [rows] = await db.query(
            'SELECT id, usuario, clave, rol FROM usuarios WHERE usuario = ?',
            [usuario]
        );

        if (rows.length === 0) {
            return res.status(401).json({ status: 'error', mensaje: 'Credenciales incorrectas' });
        }

        const user = rows[0];

        // Verificación de contraseña (compatible con texto plano de prueba o hash de bcrypt)
        let esValida = false;
        if (user.clave.startsWith('$2b$')) {
            esValida = await bcrypt.compare(clave, user.clave);
        } else {
            esValida = (clave === user.clave); // Para pruebas con scripts legados
        }

        if (!esValida) {
            return res.status(401).json({ status: 'error', mensaje: 'Credenciales incorrectas' });
        }

        // Generar Token JWT
        const token = jwt.sign(
            { id: user.id, usuario: user.usuario, rol: user.rol },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            status: 'ok',
            id: user.id,
            usuario: user.usuario,
            rol: user.rol,
            token
        });
    } catch (err) {
        res.status(500).json({ status: 'error', mensaje: 'Error interno del servidor' });
    }
});

app.get('/usuarios/meseros', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, usuario FROM usuarios WHERE rol = 'Mesero'");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/usuarios/clientes', async (req, res) => {
    try {
        const [rows] = await db.query("SELECT id, usuario FROM usuarios WHERE rol = 'Cliente'");
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 2. GESTIÓN DE PLATILLOS
// ==========================================
app.get('/platillos', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM platillos ORDER BY id DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/platillos', upload.single('imagen'), async (req, res) => {
    const { nombre, precio, categoria } = req.body;
    const imagen = req.file ? req.file.filename : null;

    if (!nombre || !precio) {
        return res.status(400).json({ status: 'error', mensaje: 'Nombre y precio son obligatorios' });
    }

    try {
        await db.query(
            'INSERT INTO platillos (nombre, precio, categoria, imagen) VALUES (?, ?, ?, ?)',
            [nombre, parseFloat(precio), categoria || 'Platos Fuertes', imagen]
        );
        res.json({ status: 'ok', mensaje: 'Platillo registrado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/platillos/:id', async (req, res) => {
    const { id } = req.params;
    const { nombre, precio, categoria } = req.body;
    try {
        await db.query(
            'UPDATE platillos SET nombre = ?, precio = ?, categoria = ? WHERE id = ?',
            [nombre, parseFloat(precio), categoria, id]
        );
        res.json({ status: 'ok', mensaje: 'Platillo actualizado correctamente' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/platillos/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await db.query('DELETE FROM platillos WHERE id = ?', [id]);
        res.json({ status: 'ok', mensaje: 'Platillo eliminado' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 3. OPERACIONES SIMPLES
// ==========================================
app.post('/operaciones', async (req, res) => {
    const { platillo_id, cantidad, precio, total } = req.body;
    try {
        await db.query(
            'INSERT INTO operaciones (platillo_id, cantidad, precio, total) VALUES (?, ?, ?, ?)',
            [platillo_id, cantidad, precio, total]
        );
        res.json({ status: 'ok', mensaje: 'Operación registrada' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/operaciones', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT o.id, p.nombre, o.cantidad, o.precio, o.total
            FROM operaciones o
            JOIN platillos p ON o.platillo_id = p.id
            ORDER BY o.id DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 4. REGISTRO Y GESTIÓN DE ÓRDENES
// ==========================================
app.post('/ordenes', async (req, res) => {
    const { total, detalle, mesero_id, cliente_id } = req.body;

    if (!detalle || !Array.isArray(detalle) || detalle.length === 0) {
        return res.status(400).json({ status: 'error', mensaje: 'El detalle de la orden no puede estar vacío' });
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const [resOrden] = await connection.query(
            'INSERT INTO ordenes (mesero_id, cliente_id, total) VALUES (?, ?, ?)',
            [mesero_id || null, cliente_id || null, total]
        );
        const ordenId = resOrden.insertId;

        for (let item of detalle) {
            await connection.query(
                'INSERT INTO detalle_ordenes (orden_id, platillo_id, cantidad, precio, subtotal) VALUES (?, ?, ?, ?, ?)',
                [ordenId, item.platillo_id, item.cantidad, item.precio, item.subtotal]
            );
        }

        await connection.commit();
        res.json({ status: 'ok', mensaje: 'Orden procesada con éxito', orden_id: ordenId });
    } catch (err) {
        await connection.rollback();
        res.status(500).json({ status: 'error', mensaje: 'Error al procesar la orden: ' + err.message });
    } finally {
        connection.release();
    }
});

app.get('/historial', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                o.id AS orden_id, o.fecha, o.total,
                u_mesero.usuario AS mesero_nombre,
                u_cliente.usuario AS cliente_nombre,
                p.nombre AS platillo, d.cantidad, d.subtotal
            FROM ordenes o
            LEFT JOIN usuarios u_mesero ON o.mesero_id = u_mesero.id
            LEFT JOIN usuarios u_cliente ON o.cliente_id = u_cliente.id
            JOIN detalle_ordenes d ON o.id = d.orden_id
            JOIN platillos p ON d.platillo_id = p.id
            ORDER BY o.id DESC
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/ordenes/mesero/:id', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT o.id AS orden_id, o.total, u.usuario AS cliente_nombre, p.nombre AS platillo, d.cantidad, d.subtotal
            FROM ordenes o
            LEFT JOIN usuarios u ON o.cliente_id = u.id
            JOIN detalle_ordenes d ON o.id = d.orden_id
            JOIN platillos p ON d.platillo_id = p.id
            WHERE o.mesero_id = ? ORDER BY o.id DESC
        `, [req.params.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/ordenes/cliente/:id', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT o.id AS orden_id, o.total, p.nombre AS platillo, d.cantidad, d.subtotal
            FROM ordenes o
            JOIN detalle_ordenes d ON o.id = d.orden_id
            JOIN platillos p ON d.platillo_id = p.id
            WHERE o.cliente_id = ? ORDER BY o.id DESC
        `, [req.params.id]);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 5. REPORTES Y ESTADÍSTICAS
// ==========================================
app.get('/reportes/total', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT SUM(total) AS total_ventas FROM ordenes');
        res.json({ total_ventas: rows[0].total_ventas || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/reportes/promedio', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT AVG(precio) AS promedio_precio FROM platillos');
        res.json({ promedio_precio: rows[0].promedio_precio || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/reportes/masvendido', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT p.nombre, SUM(d.cantidad) as total_vendido
            FROM detalle_ordenes d
            JOIN platillos p ON d.platillo_id = p.id
            GROUP BY p.id
            ORDER BY total_vendido DESC LIMIT 1
        `);
        res.json(rows[0] || { nombre: 'N/A' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/admin/reporte-meseros', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.id AS mesero_id, u.usuario AS mesero_nombre, COUNT(o.id) AS total_ordenes, IFNULL(SUM(o.total), 0) AS total_ventas
            FROM usuarios u
            LEFT JOIN ordenes o ON u.id = o.mesero_id
            WHERE u.rol = 'Mesero'
            GROUP BY u.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/admin/reporte-clientes', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.id AS cliente_id, u.usuario AS cliente_nombre, COUNT(o.id) AS total_ordenes, IFNULL(SUM(o.total), 0) AS total_compras
            FROM usuarios u
            LEFT JOIN ordenes o ON u.id = o.cliente_id
            WHERE u.rol = 'Cliente'
            GROUP BY u.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/estadisticas/meseros', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.usuario, IFNULL(SUM(o.total), 0) AS ventas
            FROM usuarios u LEFT JOIN ordenes o ON u.id = o.mesero_id
            WHERE u.rol = 'Mesero' GROUP BY u.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/estadisticas/clientes', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT u.usuario, COUNT(o.id) AS pedidos
            FROM usuarios u LEFT JOIN ordenes o ON u.id = o.cliente_id
            WHERE u.rol = 'Cliente' GROUP BY u.id
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ==========================================
// 6. EXPORTACIÓN DE REPORTES (PDF Y EXCEL)
// ==========================================
app.get('/export/pdf', async (req, res) => {
    try {
        const [ordenes] = await db.query('SELECT * FROM ordenes ORDER BY id DESC');
        const doc = new PDFDocument({ margin: 30 });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename=reporte_ventas.pdf');
        doc.pipe(res);

        doc.fontSize(20).text('REPORTE DE VENTAS - RESTAURANTE UMAMI', { align: 'center' });
        doc.moveDown();

        ordenes.forEach(o => {
            doc.fontSize(12).text(`Orden #${o.id} - Total: $${o.total} - Fecha: ${o.fecha}`);
        });

        doc.end();
    } catch (err) {
        res.status(500).send("Error al generar el archivo PDF");
    }
});

app.get('/export/excel', async (req, res) => {
    try {
        const [ordenes] = await db.query('SELECT * FROM ordenes ORDER BY id DESC');
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Ventas');

        worksheet.columns = [
            { header: 'ID Orden', key: 'id', width: 10 },
            { header: 'Total ($)', key: 'total', width: 15 },
            { header: 'Fecha', key: 'fecha', width: 25 }
        ];

        ordenes.forEach(o => worksheet.addRow(o));

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=reporte_ventas.xlsx');

        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).send("Error al generar el archivo Excel");
    }
});

// Middleware Global para Errores Multer
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({ status: 'error', mensaje: `Error al subir archivo: ${err.message}` });
    } else if (err) {
        return res.status(400).json({ status: 'error', mensaje: err.message });
    }
    next();
});

// Inicializar Servidor
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor seguro ejecutándose en el puerto ${PORT}`);
});
