# 🧹 CleanCave

**Reparto y rotación justa de tareas del hogar en pareja.**

CleanCave distribuye automáticamente las tareas de la casa cada semana, rotando quién hace qué para que la carga sea equitativa. Si alguien no completa lo suyo, las tareas pendientes se trasladan a la semana siguiente **sin rotar** — la consecuencia la paga quien no cumplió.

## Características

- **Rotación semanal automática**: la app genera la lista de tareas cada domingo. Cada tarea se asigna a quien hace más tiempo no la hizo.
- **Traslado de pendientes**: las tareas sin completar pasan a la misma persona la semana siguiente, marcadas como "Atrasada".
- **Intercambio de tareas**: ofrecé una tarea tuya a cambio de una de tu pareja, con mensaje y confirmación.
- **Notificaciones push**: al completar toda la semana, al recibir/responder un intercambio. Vía OneSignal.
- **Estadísticas con gráficos**: cumplimiento general, versus entre integrantes, tareas más y menos cumplidas.
- **Histórico**: consultá semanas anteriores con detalle de completadas, pendientes, intercambios y registros manuales.
- **Perfil con foto**: cambiá contraseña, guardá email de recuperación, subí avatar.
- **Recuperación de contraseña**: por email con link temporal.
- **PWA instalable**: funciona como app en el teléfono (Android / iOS).
- **Responsive**: diseño mobile-first con topbar + pestañas scrollables.

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express |
| Frontend | HTML + CSS vanilla + JS (sin frameworks) |
| Datos | JSON file (`db/data.json`) |
| Sesiones | express-session |
| Push notifications | OneSignal |
| Email | nodemailer (SMTP) |
| Hosting | Fly.io |
| CI/CD | GitHub Actions |

## Requisitos

- Node.js 18 o superior

## Instalación y uso local

```bash
cd cleancave
npm install
npm run seed    # crea hogar "Cueva" con Delfina, Martín y 23 tareas
npm start       # http://localhost:3000
```

Usuarios: `delfina` / `martin` — contraseña `cambiar123` para ambos.

### Tests

```bash
npm test        # 88+ tests con cobertura > 90%
```

## Deploy en Fly.io

```bash
fly launch --no-deploy
fly volumes create cleancave_data --region iad --size 1
fly secrets set SESSION_SECRET=<uuid>
fly secrets set ONESIGNAL_APP_ID=<tu-app-id>
fly secrets set ONESIGNAL_API_KEY=<tu-api-key>
fly secrets set APP_URL=https://tu-app.fly.dev
fly deploy
```

## Configuración de email

Copiá `.env.example` como `.env` y completá las credenciales SMTP. Sin esto, los links de recuperación se muestran en la consola del servidor.

## Estructura del proyecto

```
cleancave/
├── server.js                 # Servidor Express (API + static)
├── db/
│   ├── jsondb.js             # Persistencia en archivo JSON
│   ├── frequencies.js        # Configuración de frecuencias
│   ├── rotation.js           # Algoritmo de reparto y rotación
│   ├── stats.js              # Cálculo de estadísticas
│   ├── push.js               # Integración OneSignal
│   ├── mailer.js             # Envío de emails
│   └── seed.js               # Datos iniciales
├── public/
│   ├── index.html            # SPA frontend
│   ├── style.css             # Estilos mobile-first
│   ├── app.js                # Lógica de frontend
│   ├── manifest.json         # PWA manifest
│   ├── sw.js                 # Service Worker (caching + push)
│   ├── OneSignalSDKWorker.js # OneSignal service worker
│   └── reset-password.html   # Página de reset de contraseña
├── __tests__/                # Tests (Jest + Supertest)
├── scripts/
│   ├── start.sh              # Entrypoint para Docker/Fly.io
│   └── generate-icons.js     # Generación de iconos PWA
├── Dockerfile                # Imagen Docker para Fly.io
└── fly.toml                  # Configuración Fly.io
```

## Licencia

Uso privado.
