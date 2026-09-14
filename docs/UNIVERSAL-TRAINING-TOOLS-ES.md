# Operaciones universales de datos de entrenamiento

**Idioma:** [English](UNIVERSAL-TRAINING-TOOLS.md) · **Español**

Estas operaciones permiten utilizar el conector con COROS, Strava, Garmin y archivos FIT mediante la capa neutral de proveedores existente.

**No son nuevas herramientas MCP de nivel superior.** El catálogo visible se mantiene estable en 56 herramientas. Se descubren con `coros_capabilities` y se ejecutan mediante `coros_read`.

## Operaciones

### `training_data_status`
Devuelve el proveedor predeterminado, proveedores registrados, disponibilidad y capacidades sin mostrar valores secretos.

```json
{"operation":"training_data_status","input":{}}
```

### `setup_check`
Realiza un diagnóstico seguro de instalación/configuración: versión de Node, presencia de credenciales COROS, proveedores opcionales Strava/Garmin y análisis de archivos FIT.

```json
{"operation":"setup_check","input":{}}
```

No devuelve contraseñas, tokens ni valores de credenciales.

### `list_training_providers`
Lista los proveedores registrados y sus capacidades.

```json
{"operation":"list_training_providers","input":{}}
```

COROS es el proveedor predeterminado. Strava y Garmin son opcionales. El proveedor `file` aporta capacidades de análisis FIT/GPX.

### `list_provider_activities`
Devuelve resúmenes normalizados de actividades desde cualquier proveedor que implemente la capacidad `activities`.

```json
{
  "operation":"list_provider_activities",
  "input":{
    "providerId":"coros",
    "startDate":"2026-08-01",
    "endDate":"2026-09-14",
    "page":1,
    "size":100
  }
}
```

Puede usarse `strava` o `garmin` en lugar de `coros` cuando estén configurados.

### `training_trends`
Agrega volumen y carga normalizados en ventanas configurables, por ejemplo 7, 28 y 90 días.

```json
{
  "operation":"training_trends",
  "input":{
    "providerId":"coros",
    "endDate":"2026-09-14",
    "windows":[7,28,90]
  }
}
```

El resultado incluye número de actividades, duración, distancia, desnivel, carga disponible, FC/potencia medias, velocidad media y desglose por deporte.

### `compare_activities`
Compara hasta 10 actividades normalizadas. La primera actividad seleccionada se utiliza como referencia para los cambios porcentuales.

```json
{
  "operation":"compare_activities",
  "input":{
    "providerId":"strava",
    "startDate":"2026-08-01",
    "endDate":"2026-09-14",
    "activityIds":["123","456"]
  }
}
```

Si se omite `activityIds`, se comparan las primeras actividades devueltas en el rango solicitado.

### `import_activity_file`
Analiza un archivo FIT sin necesitar una cuenta de plataforma deportiva. Los bytes FIT se envían en base64.

```json
{
  "operation":"import_activity_file",
  "input":{
    "fitBase64":"<BYTES FIT EN BASE64>",
    "name":"Salida de mañana"
  }
}
```

El resultado contiene el análisis FIT detallado y un resumen de actividad normalizado que puede utilizarse en procesos posteriores comunes.

## Reglas de datos

- Los campos que un proveedor no entregue permanecen en `null`; no se inventan.
- COROS sigue siendo el proveedor predeterminado salvo que se solicite otro `providerId`.
- Strava y Garmin requieren su propia configuración.
- La importación FIT funciona mediante el proveedor local `file` y no necesita COROS, Strava ni Garmin.
- `import_activity_file` importa actualmente actividades FIT. GPX sigue gestionándose mediante las operaciones de análisis de rutas.
- La paginación está acotada y las lecturas históricas informan cuando los datos devueltos están truncados.

## Primeras llamadas recomendadas

Después de instalar:

1. `coros_capabilities`
2. `coros_read(operation="setup_check")`
3. `coros_read(operation="training_data_status")`
4. `coros_read(operation="list_training_providers")`

Después puede elegirse cualquier proveedor configurado para actividades, tendencias y comparaciones.
