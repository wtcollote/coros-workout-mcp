# Empieza aquí: probar COROS Workout desde ChatGPT

Esta guía es para personas que usan ChatGPT pero no saben programar, no conocen GitHub y no quieren usar una terminal.

## Opción A — Probar la DEMO

No necesitas cuenta COROS, contraseña, GitHub ni instalar nada.

1. Abre ChatGPT.
2. Ve a **Configuración → Aplicaciones**.
3. Activa **Modo de desarrollador** si aparece en tu cuenta.
4. Elige **Crear aplicación / Añadir MCP personalizado**.
5. Pega esta dirección:

```text
https://coros-workout-demo.onrender.com/mcp
```

6. Haz que ChatGPT analice o descubra las herramientas y crea la aplicación.
7. Abre un chat nuevo y selecciona **COROS Workout Demo** entre las herramientas/aplicaciones disponibles.
8. Escribe, por ejemplo:

> Usa COROS Workout en modo demo y analiza el estado actual del atleta.

La demo usa actividades sintéticas de carrera, ciclismo y trail. No contiene datos de ninguna persona real.

### Qué puedes pedir en la demo

Puedes escribir preguntas normales, por ejemplo:

- “Hazme un resumen de la última semana.”
- “¿Cómo está evolucionando el entrenamiento?”
- “¿Cuáles son las mejores actividades?”
- “Busca actividades parecidas a la última salida.”
- “¿Hay alguna actividad que se salga de lo habitual?”
- “Busca ejercicios de fuerza para espalda sin material.”

La demo bloquea el inicio de sesión en COROS. Aunque alguien intente introducir credenciales, el servidor demo no permite autenticarse en una cuenta COROS real.

Si en ChatGPT no aparece el modo de desarrollador o la opción para añadir una aplicación MCP personalizada, esa función no está disponible en tu cuenta actualmente.

---

## Opción B — Usar tu cuenta COROS real

Esta opción crea **tu propio servidor privado**. Tus credenciales no se comparten con la demo pública.

### Paso 1 — Crear tu copia en Render

Abre este enlace:

```text
https://render.com/deploy?repo=https://github.com/wtcollote/coros-workout-mcp
```

Repositorio público:

```text
https://github.com/wtcollote/coros-workout-mcp
```

Render utilizará el archivo `render.yaml` incluido en el proyecto.

### Paso 2 — Rellenar tus datos

Render te pedirá las variables privadas necesarias:

- `COROS_EMAIL`: tu correo de COROS.
- `COROS_PASSWORD`: tu contraseña de COROS.
- `COROS_REGION`: normalmente `eu` en Europa.

Las otras opciones ya quedan preparadas por el proyecto:

- `COROS_ALLOW_UNOFFICIAL_MOBILE_LOGIN=false`
- `COROS_PUBLIC_DEMO=false`
- `TRAINING_DATA_PROVIDER_ID=coros`

No escribas tus credenciales en GitHub ni en archivos públicos.

### Paso 3 — Esperar a que Render termine

Cuando aparezca **Live**, Render te dará una dirección parecida a:

```text
https://tu-servicio.onrender.com
```

Tu dirección MCP será:

```text
https://tu-servicio.onrender.com/mcp
```

### Paso 4 — Conectarlo a ChatGPT

En ChatGPT:

1. **Configuración → Aplicaciones**.
2. Activa **Modo de desarrollador** si es necesario.
3. Crea una aplicación MCP personalizada.
4. Pega `https://tu-servicio.onrender.com/mcp`.
5. Haz que ChatGPT analice las herramientas.
6. Guarda la aplicación.
7. Abre un chat nuevo y selecciona COROS Workout.

Ya puedes escribir peticiones normales como:

> Analiza mis últimos entrenamientos.

> Hazme un resumen semanal.

> Busca ejercicios de fuerza para pecho y espalda.

> Crea un entrenamiento de fuerza de 40 minutos.

Las operaciones que modifiquen tu cuenta COROS siguen requiriendo confirmación explícita según las reglas del conector.

---

## ¿Qué opción debo elegir?

**Solo quieres ver cómo funciona:** usa la DEMO.

**Quieres analizar tus entrenamientos reales y utilizar las funciones de COROS:** crea tu servidor privado en Render.

No necesitas entender GitHub, Node.js ni MCP para seguir estos dos caminos.