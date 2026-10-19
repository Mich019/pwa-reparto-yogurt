CREATE TABLE `Clientes`(
    `id_cliente` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `nombre` VARCHAR(100) NOT NULL,
    `direccion` TEXT NOT NULL,
    `latitud` DECIMAL(10, 8) NULL COMMENT 'Para el pin del mapa de Ubicación',
    `longitud` DECIMAL(11, 8) NULL COMMENT 'Para el pin del mapa de Ubicación',
    `telefono` VARCHAR(20) NULL
);
CREATE TABLE `Productos`(
    `id_producto` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `nombre` VARCHAR(100) NOT NULL COMMENT 'Ej. Producto base',
    `sabor` VARCHAR(100) NOT NULL COMMENT 'Sabor o especialidad',
    `precio_unitario` DECIMAL(10, 2) NOT NULL,
    `disponible` BOOLEAN NULL DEFAULT 1
);
CREATE TABLE `Pedidos`(
    `id_pedido` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `id_cliente` INT NOT NULL,
    `fecha` DATETIME NOT NULL DEFAULT NOW(), `estado` VARCHAR(30) NULL DEFAULT 'pendiente' COMMENT 'pendiente, en_camino, entregado', `total` DECIMAL(10, 2) NULL);
CREATE TABLE `Detalle_Pedido`(
    `id_detalle_pedido` INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    `id_pedido` INT NOT NULL,
    `id_producto` INT NOT NULL,
    `cantidad` INT NOT NULL,
    `precio_unitario` DOUBLE NOT NULL,
    `subtotal` DOUBLE NOT NULL COMMENT 'precio_unitario*cantidad'
);
ALTER TABLE
    `Detalle_Pedido` ADD CONSTRAINT `detalle_pedido_id_pedido_foreign` FOREIGN KEY(`id_pedido`) REFERENCES `Pedidos`(`id_pedido`);
ALTER TABLE
    `Detalle_Pedido` ADD CONSTRAINT `detalle_pedido_id_producto_foreign` FOREIGN KEY(`id_producto`) REFERENCES `Productos`(`id_producto`);
ALTER TABLE
    `Pedidos` ADD CONSTRAINT `pedidos_id_cliente_foreign` FOREIGN KEY(`id_cliente`) REFERENCES `Clientes`(`id_cliente`);