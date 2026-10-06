-- Esquema de base de datos para Railway MySQL
-- NOTA: En Railway la base de datos ya existe (variable MYSQLDATABASE / railway).
-- No ejecutes CREATE DATABASE ni USE; conecta a la base del plugin de MySQL
-- y ejecuta solo las tablas y los datos de prueba de abajo.

-- Tabla de Usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    clave VARCHAR(255) NOT NULL,
    rol ENUM('Administrador', 'Mesero', 'Cliente') NOT NULL
);

-- Tabla de Platillos
CREATE TABLE IF NOT EXISTS platillos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    precio DECIMAL(10, 2) NOT NULL,
    categoria VARCHAR(50) DEFAULT 'Platos Fuertes',
    imagen VARCHAR(255) DEFAULT NULL
);

-- Tabla de Operaciones Simples
CREATE TABLE IF NOT EXISTS operaciones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    platillo_id INT,
    cantidad INT NOT NULL,
    precio DECIMAL(10, 2) NOT NULL,
    total DECIMAL(10, 2) NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (platillo_id) REFERENCES platillos(id) ON DELETE CASCADE
);

-- Tabla de Órdenes / Pedidos
CREATE TABLE IF NOT EXISTS ordenes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mesero_id INT NULL,
    cliente_id INT NULL,
    total DECIMAL(10, 2) NOT NULL,
    fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (mesero_id) REFERENCES usuarios(id) ON DELETE SET NULL,
    FOREIGN KEY (cliente_id) REFERENCES usuarios(id) ON DELETE SET NULL
);

-- Tabla de Detalle de Órdenes
CREATE TABLE IF NOT EXISTS detalle_ordenes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    orden_id INT NOT NULL,
    platillo_id INT NOT NULL,
    cantidad INT NOT NULL,
    precio DECIMAL(10, 2) NOT NULL,
    subtotal DECIMAL(10, 2) NOT NULL,
    FOREIGN KEY (orden_id) REFERENCES ordenes(id) ON DELETE CASCADE,
    FOREIGN KEY (platillo_id) REFERENCES platillos(id) ON DELETE CASCADE
);

-- Insertar Datos Iniciales de Prueba
INSERT INTO usuarios (usuario, clave, rol) VALUES
('admin', '1234', 'Administrador'),
('mesero1', '1234', 'Mesero'),
('cliente1', '1234', 'Cliente');

INSERT INTO platillos (nombre, precio, categoria) VALUES
('Hamburguesa Doble', 8.50, 'Platos Fuertes'),
('Pizza Pepperoni', 12.00, 'Platos Fuertes'),
('Pastel de Chocolate', 4.50, 'Postres'),
('SDA Helada', 2.00, 'Bebidas');
