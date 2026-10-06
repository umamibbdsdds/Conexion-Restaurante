# Backend Restaurante Umami — Despliegue en Railway

API en Node.js + Express + MySQL para la app del restaurante Umami.

## Contenido del proyecto

- `server.js` — servidor Express (listo para Railway, lee `PORT` y variables de MySQL).
- `package.json` — dependencias y scripts (`npm start`).
- `schema.sql` — tablas + datos de prueba para la base MySQL.
- `railway.json` / `Procfile` — configuración de arranque.
- `.env.example` — referencia de variables de entorno.
- `.gitignore` — ignora `node_modules`, `uploads`, `.env`.

## Pasos para subir a Railway

### 1. Crea el proyecto
1. Entra a https://railway.app y crea un **New Project**.
2. Elige **Deploy from GitHub repo** (sube antes esta carpeta a un repo) o usa el **Railway CLI**.

#### Opción con Railway CLI (sin GitHub)
```bash
npm i -g @railway/cli
railway login
cd umami-backend
railway init
railway up
```

### 2. Añade la base de datos MySQL
1. En el proyecto: **New → Database → Add MySQL**.
2. Railway crea automáticamente las variables `MYSQLHOST`, `MYSQLPORT`, `MYSQLUSER`, `MYSQLPASSWORD`, `MYSQLDATABASE` y `MYSQL_URL`.

### 3. Conecta las variables al servicio del backend
En el servicio Node, pestaña **Variables**, agrega (usando *Variable References* del plugin MySQL):

| Variable | Valor |
|---|---|
| `MYSQLHOST` | `${{MySQL.MYSQLHOST}}` |
| `MYSQLPORT` | `${{MySQL.MYSQLPORT}}` |
| `MYSQLUSER` | `${{MySQL.MYSQLUSER}}` |
| `MYSQLPASSWORD` | `${{MySQL.MYSQLPASSWORD}}` |
| `MYSQLDATABASE` | `${{MySQL.MYSQLDATABASE}}` |
| `JWT_SECRET` | *(una clave larga y secreta)* |

> El código también acepta `MYSQL_URL` directamente si prefieres usar esa.
> No definas `PORT`: Railway lo inyecta solo.

### 4. Carga el esquema de la base de datos
Abre la pestaña **Data / Query** del plugin MySQL (o con `mysql` desde tu PC usando los datos de conexión públicos) y ejecuta el contenido de `schema.sql`.

> En Railway la base ya existe (`railway`). Por eso `schema.sql` **no** incluye `CREATE DATABASE` ni `USE`: solo crea tablas e inserta datos de prueba.

### 5. Verifica el despliegue
- Railway te da una URL pública (**Settings → Networking → Generate Domain**).
- Prueba `GET https://TU-APP.up.railway.app/` → responde `{"status":"ok"}`.
- Prueba el login:
```bash
curl -X POST https://TU-APP.up.railway.app/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"admin","clave":"1234"}'
```

## Notas importantes

- **Usuarios de prueba:** `admin` / `mesero1` / `cliente1`, todos con clave `1234`. Cámbialas en producción.
- **Imágenes subidas:** se guardan en `uploads/`, que en Railway es **efímero** (se borra en cada redeploy). Para persistencia usa un **Volume** de Railway o un almacenamiento externo (S3, Cloudinary, etc.).
- Se añadieron `bcrypt` y `jsonwebtoken` a las dependencias (el código los usa pero faltaban en el `package.json` original).
