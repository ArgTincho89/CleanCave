# Changelog

## v1.4.1

- **Tareas globales**: eliminado checkbox innecesario de cada tarjeta.
- **Editar tarea global**: ahora con modal propio (nombre + descripción) igual que las tareas de Configurar tareas.

## v1.4.0

- **Tareas globales**: layout rediseñado — sin metadatos en la tarjeta, botones apilados verticalmente a la derecha.
- **Histórico de tareas globales**: desplegable al final de la página con trazabilidad de creación, finalización y eliminación.
- **Modal de avatar**: ahora tiene botón X para cerrar además del clic fuera.
- **Botón "Borrar caché"**: en pantalla de login para limpiar service worker sin reinstalar la PWA.

## v1.3.0

- **Tareas globales**: listado de tareas únicas del hogar sin incidencia en reparto, estadísticas ni histórico.
- **Historial de versiones**: modal con changelog visible desde la pantalla de login.
- **Cron fix**: reparto semanal solo se ejecuta los domingos a las 8:00 (Europe/Madrid), una sola vez por semana.
- **Auto-generación fix**: no genera tareas antes de las 8am del domingo ni los sábados.
- **9 tests nuevos**: cobertura de todas las rutas de la API de tareas globales.

## v1.2.0

- **Topbar refactor**: navegación separada del topbar como barra sticky independiente con scroll horizontal en mobile.
- **Avatar upload feedback**: muestra preview inmediato de la foto seleccionada y texto "Subiendo..." mientras se procesa.
- **README actualizado**: corrige descripción del layout a topbar + pestañas scrollables.
- **CHANGELOG iniciado**.

## v1.1.0

- **PWA**: service worker con app shell precacheado + cache-first/network-first.
- **OneSignal push notifications**: SDK integrado en frontend y backend.
- **Despliegue en Fly.io**: volumen persistente, secrets, Dockerfile, seed automático.
- **Mobile-first redesign**: CSS responsive con topbar + pestañas scrollables, touch targets 44px.
- Perfil como página (no modal). Avatar upload. Recuperación de contraseña por email.

## v1.0.0

- App base Express + vanilla JS frontend.
- Rotación semanal automática de tareas del hogar.
- Traslado de pendientes ("Atrasada").
- Intercambio de tareas entre integrantes.
- Histórico por semana.
- Estadísticas con gráficos de torta SVG.
- Login / registro de hogar con dos integrantes.
- Sesiones con express-session.
- Tests: 88 tests, >90% statement coverage.
