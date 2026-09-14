# Inicio rápido

## Probar sin credenciales

Ejecuta `npm ci` y después `npm run demo`.

El modo demo usa únicamente actividades sintéticas y no lee cuentas de COROS, Strava ni Garmin.

Ejecuta `npm run doctor` para comprobar Node.js, proveedores y configuración sin mostrar valores secretos.

## Datos reales

Copia `.env.example` a `.env`, configura solo los proveedores que uses y ejecuta:

```bash
npm ci
npm run build
npm run doctor
npm start
```

Endpoint MCP por defecto: `http://localhost:8787/mcp`.

## Proveedores

Usa `training_data_status` o `list_training_providers` mediante `coros_read` para ver qué está disponible. Las operaciones universales aceptan `providerId` como `coros`, `strava`, `garmin` o `demo`.

## Render

El archivo `render.yaml` define un servicio web Docker compatible con el plan gratuito. Guarda las credenciales como variables de entorno de Render y nunca subas un archivo `.env` al repositorio.
