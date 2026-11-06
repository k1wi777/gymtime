# Manual del administrador

Todo lo del [manual del asistente](manual_asistente.md) más las secciones del menú reservadas a administradores. El asistente no las ve ni puede abrirlas.

## Periodos

Un periodo (por ejemplo «2026-2») agrupa los horarios semanales de un semestre.

1. **Periodos → Nuevo periodo**: nombre, primer y último día (AAAA-MM-DD). Los periodos no se cruzan, estén activos o no.
2. **Activar**: solo uno puede estar activo a la vez; activar otro desactiva el anterior.
3. **Días sin servicio** (festivos, semana santa): agréguelos con rango y motivo. Ese día no habrá sesión ni se esperará a nadie.
4. Cada cambio muestra cuántas sesiones se **crearon, borraron, ajustaron o conservaron**. Una sesión con asistencia, con alarma o ya iniciada nunca se borra.
5. Eliminar un periodo solo es posible si no tiene horarios.

## Gestión de horarios

- **Nuevo horario**: nombre, día de la semana, inicio y fin (hora de Colombia) dentro del periodo elegido. No puede cruzarse con otro del mismo día y periodo; horarios contiguos sí.
- **Estudiantes**: asigne uno a uno (con fecha de inicio opcional), por lista de documentos (pegada o desde un archivo de texto; informa los que no existen, están de baja o ya estaban) o copiando los de otro horario.
- **Vista semanal**: cuadrícula de la semana con los días sin servicio marcados y el número de estudiantes de cada horario.
- Un horario con asistencia registrada no se puede eliminar; edítelo o déjelo.

## Estudiantes

- La tabla se filtra en el servidor por nombre, documento, carrera, estado y huella (útil: «Sin huella»).
- **Consentimiento**: el botón abre el texto vigente del servidor; se registra su versión, la fecha y quién lo hizo.
- **Importar CSV** (cuatro pasos): archivo, columnas (se sugieren por el encabezado), vista previa con fila y motivo de cada error, y resultado. Solo se importan las filas válidas; los datos de las filas no se guardan, solo cuántas se importaron. Descargue la plantilla desde el primer paso. Los importados quedan sin consentimiento ni huella.

## Usuarios del panel

Cree cuentas, cambie nombre o rol, desactive y restablezca contraseñas. La **contraseña temporal** se muestra una sola vez en una ventana: anótela y ciérrela; no se puede volver a ver. Nadie puede desactivarse ni cambiar su propio rol, y el sistema nunca queda sin un administrador activo.

## Historial y auditoría

- **Historial → Ingresos y egresos**: filtros por fecha, horario, origen (huella o manual), estado y estudiante. Los registros manuales muestran el motivo y quién los hizo.
- **Alarma y mensajes** y **Alarmas**: qué orden se envió al lector, quién y con qué resultado; cómo y cuándo terminó cada alarma.
- **Auditoría**: quién hizo qué y cuándo (filtre por tipo, que busca por prefijo como `student.`, por usuario y por fecha). Nunca contiene huellas, contraseñas ni datos de contacto.

## Desde la línea de comandos

- `gym schedule create … --period <id|nombre>` crea un horario semanal dentro de un periodo.
- `gym student edit <documento> --consented` registra el consentimiento del texto vigente; `gym enroll start` lo exige.
