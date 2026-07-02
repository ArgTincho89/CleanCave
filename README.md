# 🧹 CleanCave

App para repartir y rotar de forma justa las tareas del hogar entre vos y tu
pareja (o cualquier grupo de convivientes).

## Novedades de esta versión

- **Recuperar contraseña por email** desde el login.
- El perfil (contraseña, email, foto) ahora es una **página**, no un modal.
- Pestaña nueva de **Estadísticas** con gráficos de torta.
- Las tareas que quedan **sin completar al cerrar la semana se trasladan** a
  quien no las hizo, sumándose a su carga de la semana siguiente.
- Desde "Editar tarea" se puede **cargar manualmente cuándo se hizo por
  última vez y quién la hizo**, para arrancar la rotación con el historial
  real previo a usar la app.

## Cómo funciona la rotación

- Cada tarea tiene una frecuencia y una descripción opcional (tooltip en el
  dashboard).
- La lista de la semana se genera sola (al abrir la app y con un cron los
  domingos a las 8:00).
- **Tareas sin completar**: si al llegar el domingo alguien dejó tareas
  pendientes, esas mismas tareas pasan a la semana nueva asignadas a la
  misma persona (no rotan) y quedan marcadas como "Atrasada". Como cuentan
  para su carga de esa semana, el reparto de las tareas nuevas tiende a
  darle más a la otra persona — la consecuencia de no cumplir la sufre quien
  no cumplió, no su pareja.
- Al marcar una tarea como hecha se pide confirmación y **no se puede
  desmarcar**. Al llegar al 100% de la semana hay confeti 🎉 y le llega una
  notificación a tu pareja.
- Los intercambios de tareas dejan elegir **ambas tareas** (la tuya y la que
  querés a cambio) y quedan con mensajes en el Histórico.

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior.
- Los datos viven en `db/data.json` (sin base de datos externa).

## Instalación y primer uso

```bash
cd cleancave
npm install
npm run seed      # crea el hogar "Cueva" con Delfina y Martín + las tareas del Excel
npm start
```

Abrí **http://localhost:3000**. Usuarios: `delfina` / `martin`, contraseña
`cambiar123` para ambos.

### Si te tira un error raro al instalar o loguearte

- Confirmá con `dir` (Windows) que estás parado en la carpeta que tiene
  `server.js` adentro.
- Si actualizaste desde una versión anterior y ves errores raros de login o
  al guardar cosas, borrá `db/data.json` (`del db\data.json` en Windows) y
  corré `npm run seed` de nuevo — casi siempre es un esquema de datos viejo
  mezclado con el nuevo.

## Configurar el envío real de emails (recuperar contraseña)

Sin configuración, cuando alguien pide recuperar su contraseña, el link no
se manda por correo — aparece impreso en la consola donde corre `npm start`
(sirve para probar todo el flujo en local sin configurar nada). Para que mande
emails de verdad:

1. Copiá `.env.example` como `.env` en la carpeta del proyecto.
2. Completá `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`.
   Con Gmail: generá un "app password" en
   https://myaccount.google.com/apppasswords (no uses tu contraseña normal).
3. Reiniciá el servidor (`npm start`).

Cada usuario carga su email de recuperación desde su perfil (tocando su
nombre arriba a la derecha).

## Uso día a día

1. **Tu columna** (protagonista): tocá una tarea pendiente → confirmá → queda
   hecha con fecha/hora, sin poder desmarcarse. Pasá el mouse sobre el
   nombre para ver la descripción, si tiene.
2. **Columna de tu pareja** (compacta): progreso en % + botón "Ver tareas de
   [nombre]" para desplegar/ocultar el detalle. El tooltip de la barra
   muestra qué completó y cuándo.
3. **Intercambiar una tarea**: ícono 🔁 → elegís tu tarea a ofrecer y la
   tarea de tu pareja que querés a cambio, más un mensaje opcional. A tu
   pareja le llega una notificación con Aceptar/Rechazar y su propio
   mensaje de respuesta.
4. **Configurar tareas**: agregar, editar (nombre/frecuencia/descripción),
   desactivar (conserva historial) o eliminar (definitivo) tareas. Desde
   "Editar" también podés cargar cuándo se hizo por última vez esa tarea y
   quién la hizo, para corregir el punto de partida de la rotación.
5. **Histórico**: elegí una semana pasada y mirá qué le tocó a cada uno, qué
   se completó (con fecha/hora), qué quedó sin completar/se trasladó, los
   registros manuales, y los intercambios con sus mensajes.
6. **Estadísticas**: gráficos de torta (con tooltip al pasar el mouse) de
   cumplimiento general, quién completa más seguido sus semanas ("Versus"),
   y qué tareas se cumplen más y cuáles menos. Se calculan sobre semanas ya
   cerradas.
7. **Perfil**: tocando tu nombre (arriba a la derecha) — cambiar contraseña,
   guardar email de recuperación, subir foto de perfil.

## Qué falta para la versión "grande"

- Hosting gratuito (ver la respuesta sobre web vs. app Android más abajo en
  la conversación).
- Emails reales para el resumen semanal de los domingos (hoy es solo
  notificación in-app).

## Estructura del proyecto

```
cleancave/
  server.js
  .env.example           # config de SMTP para emails reales (copiar a .env)
  db/
    jsondb.js             # almacenamiento (archivo JSON)
    frequencies.js
    rotation.js           # reparto, rotación y traslado de pendientes
    stats.js               # cálculo de estadísticas
    mailer.js              # envío de emails (recuperar contraseña)
    seed.js
  public/
    index.html, style.css, app.js
    reset-password.html    # página del link que llega por email
```
