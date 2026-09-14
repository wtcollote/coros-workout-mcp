# Guía de conexión sin coste de hosting

Esta guía separa dos cosas distintas:

1. **Ejecutar el servidor MCP sin pagar hosting**.
2. **Conectarlo a un cliente MCP** (ChatGPT u otro cliente compatible).

El servidor puede ejecutarse por **0 €**. La disponibilidad de MCP en ChatGPT depende del plan de ChatGPT y puede cambiar; no confundas "hosting gratis" con "todas las funciones de ChatGPT gratis".

## Opción A — 100% local, 0 € y sin hosting

Es la opción más barata y privada.

### Requisitos

- Node.js 22 recomendado.
- Git.
- Una cuenta COROS.
- Un cliente MCP que admita servidores locales por `stdio`.

### Pasos

```bash
git clone https://github.com/OWNER/REPO.git
cd REPO
npm ci
npm run build
```

Crea un `.env` local a partir de `.env.example` y añade tus propias credenciales. **No subas `.env` a GitHub.**

Ejemplo mínimo:

```env
COROS_EMAIL=tu-correo@example.com
COROS_PASSWORD=tu-clave
COROS_REGION=eu
COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false
```

Para ejecutar por `stdio`:

```bash
npm start
```

Si tu cliente MCP permite declarar un comando local, configura Node para lanzar la salida compilada del servidor. No necesitas dominio, servidor cloud ni tarjeta bancaria.

### Ventajas

- 0 € de hosting.
- Tus credenciales se quedan en tu equipo.
- No expones el endpoint MCP a Internet.
- Ideal para pruebas y uso personal.

### Limitación

ChatGPT no se conecta directamente a un MCP local ordinario. La documentación oficial de OpenAI indica que los servidores locales requieren un mecanismo de túnel compatible; la disponibilidad de MCP completo también depende del plan. Si tu objetivo es exclusivamente ChatGPT, usa una de las opciones remotas siguientes y comprueba primero que tu plan permita la capacidad que necesitas.

Referencia oficial: https://help.openai.com/es-es/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

---

## Opción B — Render Free, 0 € de hosting para pruebas/hobby

Render ofrece servicios web gratuitos con limitaciones y los presenta como adecuados para pruebas, hobby y demos, no para producción crítica.

Referencia oficial: https://render.com/docs/free

### Despliegue

1. Haz fork o clona este repositorio en tu cuenta.
2. En Render, crea un **Web Service** desde el repositorio.
3. El proyecto incluye `Dockerfile`, así que puedes usar despliegue Docker.
4. Añade las variables de entorno en el panel de Render, nunca en Git:

```text
COROS_EMAIL
COROS_PASSWORD
COROS_REGION=eu
COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false
```

5. Despliega.
6. Comprueba primero la raíz del servicio y después el endpoint MCP:

```text
https://TU-SERVICIO.onrender.com/
https://TU-SERVICIO.onrender.com/mcp
```

### Coste

- Hosting: 0 € mientras permanezcas dentro de las condiciones del plan gratuito.
- No necesitas pagar una instancia para hacer pruebas personales.

### Limitaciones

- El servicio gratuito puede suspenderse cuando no se usa y tardar en reactivarse.
- No lo uses como infraestructura crítica.
- No hagas público un endpoint MCP con credenciales de una cuenta personal sin una capa de autenticación adecuada.

---

## Opción C — GitHub Codespaces, 0 € dentro de la cuota incluida

Las cuentas personales de GitHub incluyen una cuota mensual gratuita de Codespaces. A fecha de septiembre de 2026, GitHub Free incluye 120 horas de computación y 15 GB-mes de almacenamiento para cuentas personales.

Referencias oficiales:

- https://docs.github.com/es/billing/concepts/product-billing/github-codespaces
- https://docs.github.com/es/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository

### Pasos

1. Abre el repositorio en GitHub.
2. `Code` → `Codespaces` → crea un Codespace.
3. En la terminal:

```bash
npm ci
npm run build
npm start
```

4. Define las credenciales como secretos del entorno o variables del Codespace. No las escribas en archivos versionados.
5. Si necesitas acceso remoto, publica/reenruta el puerto que use el servidor siguiendo los controles de visibilidad de Codespaces.

### Coste

0 € mientras no superes la cuota gratuita mensual incluida en tu cuenta. Si no configuras gasto adicional, GitHub bloquea el uso cuando se agota la cuota en vez de seguir cobrando, según su documentación.

---

## ¿Y Cloudflare Workers?

Workers tiene un plan gratuito generoso (por ejemplo, 100.000 solicitudes/día según la documentación actual), pero **este proyecto no es un Worker nativo**: usa Node.js, sistema de archivos local y un servidor MCP pensado para un proceso persistente. Portarlo a Workers requeriría cambios de arquitectura y almacenamiento. No es la vía recomendada para empezar.

Referencia oficial: https://developers.cloudflare.com/workers/platform/limits/

---

# Conexión con ChatGPT

La parte de servidor puede costar 0 €, pero el acceso MCP de ChatGPT depende del plan.

Según la documentación oficial de OpenAI vigente en septiembre de 2026:

- MCP completo con acciones de escritura/modificación está desplegándose para Business, Enterprise y Edu.
- Pro puede usar conexiones MCP con permisos de lectura/obtención en modo desarrollador.
- ChatGPT necesita un **servidor MCP remoto**; no conecta directamente a un servidor MCP local ordinario.

Referencia: https://help.openai.com/es-es/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt

Por tanto, **no es correcto prometer ChatGPT + MCP completo + escritura por 0 € para cualquier cuenta**. Lo que sí puede ser 100% gratuito es el servidor y su ejecución local o en una capa gratuita de hosting.

## Configuración remota típica en ChatGPT

Cuando tu plan/espacio de trabajo permita aplicaciones MCP personalizadas:

1. Despliega el servidor y obtén una URL HTTPS.
2. Verifica que `/mcp` responde.
3. En ChatGPT, entra en la configuración de Apps/Aplicaciones y habilita el modo desarrollador si tu plan lo permite.
4. Crea una app/conector MCP personalizado.
5. Introduce como endpoint:

```text
https://TU-DOMINIO/mcp
```

6. Analiza las herramientas y revisa cuidadosamente los permisos antes de habilitar acciones de escritura.

No compartas el endpoint de una instancia personal con credenciales COROS embebidas o variables privadas.

---

# Ruta recomendada para gastar 0 €

Para una persona que solo quiere probar el proyecto:

**Local (`stdio`) → 0 €**.

Para tener una URL remota de pruebas:

**Render Free → 0 € de hosting, con las limitaciones del plan gratuito**.

Para desarrollo temporal en la nube:

**GitHub Codespaces → 0 € dentro de la cuota incluida**.

Para ChatGPT específicamente:

**Comprueba primero la disponibilidad MCP de tu plan.** El repositorio y el hosting pueden ser gratuitos, pero el plan de ChatGPT puede ser el factor limitante.

---

# Seguridad mínima

- Nunca subas `.env`.
- No publiques `COROS_EMAIL`, `COROS_PASSWORD`, tokens Strava ni tokens Garmin.
- Usa una instancia por usuario/cuenta mientras el proyecto mantenga almacenamiento local de tokens.
- Mantén `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false` salvo que entiendas el riesgo de conflicto de sesión.
- No expongas una instancia con acciones de escritura sin autenticación.
- Antes de aceptar un Pull Request que toque autenticación, endpoints o almacenamiento de tokens, revisa el diff y ejecuta los tests.
